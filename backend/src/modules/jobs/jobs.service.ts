/**
 * Enfileiramento (lado produtor). A API só enfileira; quem consome é
 * `src/worker.ts` (Node) e `backend/etl` (Python).
 */
import { randomUUID } from 'node:crypto';
import type { MsaRunReason } from '@prisma/client';
import type { Job, JobState } from 'bullmq';
import { prisma } from '../../config/database';
import { getFlowProducer, getQueue, QUEUES, QUEUE_NAMES, type QueueName } from '../../config/queue';
import { era5Repository } from '../msa/era5.repository';
import {
  DATA_LAG_DAYS,
  INGEST_JOB_OPTS,
  JOB_NAMES,
  PROCESS_JOB_OPTS,
  WEEKLY_SCHEDULER_ID,
  buildBackfillFlow,
  jobIds,
  planHarvestJobs,
  type IngestJobData,
  type ProcessJobData,
} from './flows';

export interface EnqueuedJob {
  jobId: string;
  queue: QueueName;
}

export interface JobView {
  id: string;
  queue: QueueName;
  name: string;
  state: JobState | 'unknown';
  data: unknown;
  progress: unknown;
  attemptsMade: number;
  failedReason: string | null;
  returnvalue: unknown;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}

const COUNT_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;

function dateUtc(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function toView(job: Job, state: JobState | 'unknown', queue: QueueName): JobView {
  return {
    id: String(job.id),
    queue,
    name: job.name,
    state,
    data: job.data,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason || null,
    returnvalue: job.returnvalue ?? null,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
  };
}

export const jobsService = {
  async enqueueProcess(data: ProcessJobData, jobId?: string): Promise<EnqueuedJob> {
    const job = await getQueue(QUEUES.process).add(JOB_NAMES.process, data, { ...PROCESS_JOB_OPTS, jobId: jobId ?? randomUUID() });
    return { jobId: String(job.id), queue: QUEUES.process };
  },

  async enqueueIngest(data: IngestJobData, jobId?: string): Promise<EnqueuedJob> {
    const job = await getQueue(QUEUES.ingest).add(JOB_NAMES.ingest, data, { ...INGEST_JOB_OPTS, jobId: jobId ?? randomUUID() });
    return { jobId: String(job.id), queue: QUEUES.ingest };
  },

  /**
   * Ao criar a safra: decide entre backfill (flow ingest → process) e só
   * processamento. Falha no Redis não desfaz a criação: loga e devolve null.
   */
  async scheduleHarvestProcessing(harvest: { id: string; fieldId: string; emergenceDate: Date }): Promise<string | null> {
    try {
      const from = harvest.emergenceDate.toISOString().slice(0, 10);
      const limit = dateUtc(-DATA_LAG_DAYS);
      const coverage = from > limit ? null : await era5Repository.getCoverage(harvest.fieldId, from, limit);
      const plan = planHarvestJobs(coverage, from, limit);

      if (plan === 'backfill') {
        const cell = await prisma.era5Cell.findUnique({ where: { fieldId: harvest.fieldId } });
        if (!cell) throw new Error(`talhão ${harvest.fieldId} sem célula ERA5`);
        const flow = await getFlowProducer().add(
          buildBackfillFlow(harvest.id, { lat: Number(cell.cellLat), lon: Number(cell.cellLon) }, from, limit),
        );
        return String(flow.job.id);
      }
      const { jobId } = await this.enqueueProcess({ harvestId: harvest.id, reason: 'BACKFILL' }, jobIds.backfill(harvest.id));
      return jobId;
    } catch (error) {
      console.error(`[jobs] falha ao enfileirar processamento da safra ${harvest.id}:`, error instanceof Error ? error.message : error);
      return null;
    }
  },

  enqueueIngestLatest(): Promise<EnqueuedJob> {
    return this.enqueueIngest({ kind: 'latest' });
  },

  enqueueBackfillRegion(input: { bbox: [number, number, number, number]; from: string; to: string }): Promise<EnqueuedJob> {
    return this.enqueueIngest({ kind: 'range', from: input.from, to: input.to, bbox: input.bbox });
  },

  async enqueueProcessAll(reason: MsaRunReason = 'MANUAL'): Promise<EnqueuedJob[]> {
    const harvests = await prisma.harvest.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    const jobs = await getQueue(QUEUES.process).addBulk(
      harvests.map((h) => ({ name: JOB_NAMES.process, data: { harvestId: h.id, reason } satisfies ProcessJobData, opts: { ...PROCESS_JOB_OPTS, jobId: randomUUID() } })),
    );
    return jobs.map((j) => ({ jobId: String(j.id), queue: QUEUES.process }));
  },

  async queueCounts(): Promise<{ queues: Record<string, Record<string, number>>; weekly: { nextRun: string | null; pattern: string | null; tz: string | null } }> {
    const queues: Record<string, Record<string, number>> = {};
    for (const name of QUEUE_NAMES) {
      queues[name] = await getQueue(name).getJobCounts(...COUNT_STATES);
    }
    const schedulers = await getQueue(QUEUES.weekly).getJobSchedulers();
    const weekly = schedulers.find((s) => s.key === WEEKLY_SCHEDULER_ID || s.id === WEEKLY_SCHEDULER_ID);
    return {
      queues,
      weekly: {
        nextRun: weekly?.next ? new Date(weekly.next).toISOString() : null,
        pattern: weekly?.pattern ?? null,
        tz: weekly?.tz ?? null,
      },
    };
  },

  async getJob(queue: QueueName, id: string): Promise<JobView | null> {
    const job = await getQueue(queue).getJob(id);
    if (!job) return null;
    const state = await job.getState();
    return toView(job, state, queue);
  },
};
