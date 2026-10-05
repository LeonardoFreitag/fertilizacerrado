/**
 * Processo worker: consome as filas `msa-process` e `msa-weekly` e registra o
 * agendador semanal. As réplicas da API não rodam nada disto — só enfileiram.
 * Mesma imagem da API; `node dist/worker.js`.
 */
import { Worker, type Job } from 'bullmq';
import { env } from './config/env';
import { prisma } from './config/database';
import { closeQueues, getFlowProducer, getQueue, queueConnectionOptions, QUEUES } from './config/queue';
import { closeRedis } from './config/redis';
import {
  JOB_NAMES,
  PROCESS_JOB_OPTS,
  WEEKLY_CRON,
  WEEKLY_SCHEDULER_ID,
  WEEKLY_TZ,
  buildWeeklyFlow,
  jobIds,
  todayInTz,
  type ProcessJobData,
} from './modules/jobs/flows';
import { msaService } from './modules/msa/msa.service';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const log = (msg: string) => console.log(`[worker] ${msg}`);

const connection = queueConnectionOptions();

/** msa-process: um processamento por job; 4 em paralelo (o limite é o banco). */
const processWorker = new Worker<ProcessJobData>(
  QUEUES.process,
  async (job) => {
    const { harvestId, seed, reason } = job.data;
    log(`msa-process ${job.id}: safra ${harvestId} (${reason})`);
    const result = await msaService.processHarvestAsSystem(harvestId, { seed, reason, jobId: String(job.id) });
    log(`msa-process ${job.id}: run ${result.run.id} ${result.run.status}`);
    return { runId: result.run.id, status: result.run.status, dateTo: result.run.dateTo };
  },
  { connection, concurrency: 4 },
);

/**
 * msa-weekly: `trigger` (repetível) cria o flow pai+filho; `run` (pai) só
 * executa quando `era5-ingest latest` concluiu e enfileira um processamento
 * por safra ativa, com ids determinísticos.
 */
const weeklyWorker = new Worker(
  QUEUES.weekly,
  async (job: Job) => {
    if (job.name === JOB_NAMES.weeklyTrigger) {
      const date = todayInTz();
      const flow = await getFlowProducer().add(buildWeeklyFlow(date));
      log(`msa-weekly trigger: flow ${flow.job.id} criado (ingest latest → processar safras ativas)`);
      return { date, flowJobId: flow.job.id };
    }
    if (job.name === JOB_NAMES.weeklyRun) {
      const date = String((job.data as { date?: string }).date ?? todayInTz());
      const harvests = await prisma.harvest.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      const jobs = await getQueue(QUEUES.process).addBulk(
        harvests.map((h) => ({
          name: JOB_NAMES.process,
          data: { harvestId: h.id, reason: 'WEEKLY' } satisfies ProcessJobData,
          opts: { ...PROCESS_JOB_OPTS, jobId: jobIds.weeklyProcess(date, h.id) },
        })),
      );
      log(`msa-weekly run ${date}: ${jobs.length} safra(s) ativa(s) enfileirada(s)`);
      return { date, enqueued: jobs.length };
    }
    throw new Error(`job desconhecido na fila msa-weekly: ${job.name}`);
  },
  { connection, concurrency: 1 },
);

for (const w of [processWorker, weeklyWorker]) {
  w.on('failed', (job, err) => console.error(`[worker] ${w.name} ${job?.id ?? '?'} falhou: ${err.message}`));
  w.on('error', (err) => console.error(`[worker] ${w.name}: ${err.message}`));
}

async function registerWeeklyScheduler(): Promise<void> {
  // Idempotente: substitui o scheduler se já existir.
  await getQueue(QUEUES.weekly).upsertJobScheduler(
    WEEKLY_SCHEDULER_ID,
    { pattern: WEEKLY_CRON, tz: WEEKLY_TZ },
    { name: JOB_NAMES.weeklyTrigger, data: {}, opts: PROCESS_JOB_OPTS },
  );
  log(`agendador semanal registrado: "${WEEKLY_CRON}" ${WEEKLY_TZ}`);
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} recebido; concluindo jobs ativos e recusando novos...`);
  setTimeout(() => {
    console.error('[worker] encerramento excedeu o tempo limite, forçando saída.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    await Promise.all([processWorker.close(), weeklyWorker.close()]);
    await closeQueues();
    await prisma.$disconnect();
    await closeRedis();
    log('encerrado.');
    process.exit(0);
  } catch (error) {
    console.error('[worker] erro no encerramento:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

registerWeeklyScheduler()
  .then(() => log(`no ar (${env.NODE_ENV}): msa-process ×4, msa-weekly ×1`))
  .catch((error) => {
    console.error('[worker] falha ao registrar o agendador:', error);
    process.exit(1);
  });
