/**
 * Definições puras dos jobs e flows (sem Redis): nomes, payloads, ids
 * determinísticos, árvore do flow semanal e do backfill, e a decisão
 * cobertura → backfill na criação de safra.
 */
import type { FlowJob, JobsOptions } from 'bullmq';
import type { MsaRunReason } from '@prisma/client';
import { QUEUES } from '../../config/queue';

/** Segunda-feira 02:00 no horário de Brasília. */
export const WEEKLY_CRON = '0 2 * * 1';
export const WEEKLY_TZ = 'America/Sao_Paulo';
export const WEEKLY_SCHEDULER_ID = 'msa-weekly-trigger';

/** Lag do ERA5-Land com margem — o mesmo do ETL e do msa.service. */
export const DATA_LAG_DAYS = 6;

export type IngestJobData =
  | { kind: 'latest' }
  | { kind: 'range'; from: string; to: string; bbox?: [number, number, number, number] }
  | { kind: 'cell'; lat: number; lon: number; from: string; to: string };

export interface ProcessJobData {
  harvestId: string;
  seed?: number;
  reason: MsaRunReason;
}

export const JOB_NAMES = { ingest: 'ingest', process: 'process', weeklyTrigger: 'trigger', weeklyRun: 'run' } as const;

/** Ids determinísticos: reexecuções não duplicam jobs. */
/** Ids determinísticos (dedupe). O BullMQ proíbe `:` em ids customizados. */
export const jobIds = {
  weeklyRun: (date: string) => `weekly_${date}`,
  weeklyIngest: (date: string) => `ingest-latest_${date}`,
  weeklyProcess: (date: string, harvestId: string) => `weekly_${date}_${harvestId}`,
  backfill: (harvestId: string) => `backfill_${harvestId}`,
};

/** A fila do CDS oscila: 3 tentativas com backoff exponencial a partir de 5 min. */
export const INGEST_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5 * 60 * 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/** O processamento é determinístico: repetir sem mudar nada só repete a falha. */
export const PROCESS_JOB_OPTS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/** Pai `msa-weekly:run` só executa depois que `era5-ingest latest` conclui. */
export function buildWeeklyFlow(date: string): FlowJob {
  return {
    name: JOB_NAMES.weeklyRun,
    queueName: QUEUES.weekly,
    data: { date },
    opts: { jobId: jobIds.weeklyRun(date), ...PROCESS_JOB_OPTS },
    children: [
      {
        name: JOB_NAMES.ingest,
        queueName: QUEUES.ingest,
        data: { kind: 'latest' } satisfies IngestJobData,
        opts: { jobId: jobIds.weeklyIngest(date), ...INGEST_JOB_OPTS, failParentOnFailure: true },
      },
    ],
  };
}

/** Pai `msa-process BACKFILL` com filho `era5-ingest cell` da célula do talhão. */
export function buildBackfillFlow(
  harvestId: string,
  cell: { lat: number; lon: number },
  from: string,
  to: string,
): FlowJob {
  return {
    name: JOB_NAMES.process,
    queueName: QUEUES.process,
    data: { harvestId, reason: 'BACKFILL' } satisfies ProcessJobData,
    opts: { jobId: jobIds.backfill(harvestId), ...PROCESS_JOB_OPTS },
    children: [
      {
        name: JOB_NAMES.ingest,
        queueName: QUEUES.ingest,
        data: { kind: 'cell', lat: cell.lat, lon: cell.lon, from, to } satisfies IngestJobData,
        opts: { ...INGEST_JOB_OPTS, failParentOnFailure: true },
      },
    ],
  };
}

export type HarvestJobPlan = 'process' | 'backfill' | 'process-only-lag';

/**
 * Decisão na criação da safra: emergência dentro do lag ⇒ só processar (vira
 * NEEDS_DATA, deixando rastro); lacuna de cobertura ⇒ ingerir a célula antes;
 * cobertura completa ⇒ só processar.
 */
export function planHarvestJobs(
  coverage: { missingDates: string[] } | null,
  from: string,
  limit: string,
): HarvestJobPlan {
  if (from > limit) return 'process-only-lag';
  if (!coverage || coverage.missingDates.length > 0) return 'backfill';
  return 'process';
}

/** Data corrente no fuso do agendador, YYYY-MM-DD. */
export function todayInTz(tz: string = WEEKLY_TZ, now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: tz });
}
