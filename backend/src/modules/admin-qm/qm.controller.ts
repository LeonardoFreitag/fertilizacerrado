import type { Request, Response } from 'express';
import { z } from 'zod';
import { jobsService } from '../jobs/jobs.service';
import { qmRepository } from './qm.repository';

export const calibrateBodySchema = z
  .object({
    auto: z.boolean().optional(),
    cell: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
    station: z.string().trim().min(1).max(40).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.auto === true || v.cell !== undefined, { message: 'informe auto: true ou cell {lat, lon}', path: ['cell'] });

export const qmController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await qmRepository.list());
  },

  async calibrate(req: Request, res: Response): Promise<void> {
    const body = calibrateBodySchema.parse(req.body);
    const job = await jobsService.enqueueIngest(
      body.auto ? { kind: 'qm-calibrate', auto: true, from: body.from, to: body.to } : { kind: 'qm-calibrate', cell: body.cell!, station: body.station, from: body.from, to: body.to },
    );
    res.status(202).json({ ...job, status: 'queued' });
  },
};
