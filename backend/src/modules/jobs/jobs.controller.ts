import type { Request, Response } from 'express';
import type { QueueName } from '../../config/queue';
import { AppError } from '../../utils/app-error';
import { backfillRegionSchema, jobParamsSchema } from './dtos/jobs.dto';
import { jobsService } from './jobs.service';

export const jobsController = {
  async queues(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await jobsService.queueCounts());
  },

  async job(req: Request, res: Response): Promise<void> {
    const { queue, id } = jobParamsSchema.parse(req.params);
    const job = await jobsService.getJob(queue as QueueName, id);
    if (!job) throw new AppError(404, 'NOT_FOUND', `Job ${id} não encontrado na fila ${queue}.`);
    res.status(200).json(job);
  },

  async ingestLatest(_req: Request, res: Response): Promise<void> {
    res.status(202).json(await jobsService.enqueueIngestLatest());
  },

  async backfillRegion(req: Request, res: Response): Promise<void> {
    const dto = backfillRegionSchema.parse(req.body);
    res.status(202).json(await jobsService.enqueueBackfillRegion(dto));
  },

  async processAll(_req: Request, res: Response): Promise<void> {
    const jobs = await jobsService.enqueueProcessAll('MANUAL');
    res.status(202).json({ queue: 'msa-process', count: jobs.length, jobs });
  },
};
