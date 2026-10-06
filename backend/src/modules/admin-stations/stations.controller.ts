import fs from 'node:fs';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { jobsService } from '../jobs/jobs.service';

export const uploadBodySchema = z.object({
  format: z.enum(['bdmep', 'generic']),
  /** Genérico: "codigo;nome;FONTE;lat;lon[;alt]" ou "nome;FONTE;lat;lon[;alt]" (código vindo do CSV) */
  stationMeta: z.string().trim().min(1).max(200).optional(),
});

export interface StationView {
  code: string;
  name: string;
  source: string;
  lat: number;
  lon: number;
  altitudeM: number | null;
  active: boolean;
  obsCount: number;
  obsFrom: string | null;
  obsTo: string | null;
}

export const stationsController = {
  async list(_req: Request, res: Response): Promise<void> {
    const rows = await prisma.$queryRaw<
      { code: string; name: string; source: string; lat: number; lon: number; altitude_m: number | null; active: boolean; obs_count: bigint; obs_from: Date | null; obs_to: Date | null }[]
    >`
      SELECT s.code, s.name, s.source::text AS source, s.lat, s.lon, s.altitude_m, s.active,
             count(o.date) AS obs_count, min(o.date) AS obs_from, max(o.date) AS obs_to
      FROM weather_stations s
      LEFT JOIN station_daily_obs o ON o.station_code = s.code
      GROUP BY s.code ORDER BY s.code`;
    const view: StationView[] = rows.map((r) => ({
      code: r.code,
      name: r.name,
      source: r.source,
      lat: r.lat,
      lon: r.lon,
      altitudeM: r.altitude_m,
      active: r.active,
      obsCount: Number(r.obs_count),
      obsFrom: r.obs_from ? r.obs_from.toISOString().slice(0, 10) : null,
      obsTo: r.obs_to ? r.obs_to.toISOString().slice(0, 10) : null,
    }));
    res.status(200).json(view);
  },

  async upload(req: Request, res: Response): Promise<void> {
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'Envie o arquivo no campo "file".', undefined, { file: ['obrigatório'] });
    const body = uploadBodySchema.parse(req.body);
    fs.chmodSync(req.file.path, 0o666); // o etl (outro uid) precisa ler e remover
    const job = await jobsService.enqueueIngest({ kind: 'station-import', path: req.file.path, format: body.format, stationMeta: body.stationMeta });
    res.status(202).json({ ...job, status: 'queued', file: req.file.filename, size: req.file.size });
  },
};
