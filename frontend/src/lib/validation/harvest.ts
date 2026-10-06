/** Espelho de backend/src/modules/harvests/dtos. */
import { z } from 'zod';
import { todayIso } from '../msa/msa';

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'data inexistente');

export const seasonSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}$/, 'use o formato AAAA/AA, ex.: 2025/26')
  .refine((v) => {
    const [start, end] = v.split('/');
    return (Number(start) + 1) % 100 === Number(end);
  }, 'o segundo ano deve ser o seguinte ao primeiro');

export const harvestSchema = z.object({
  fieldId: z.string().uuid('escolha o talhão'),
  cultivarId: z.string().uuid('escolha a cultivar'),
  emergenceDate: calendarDateSchema.refine((v) => v <= todayIso(), 'não pode ser futura'),
  season: seasonSchema,
  notes: z
    .string()
    .trim()
    .max(2000, 'deve ter no máximo 2000 caracteres')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type HarvestForm = z.infer<typeof harvestSchema>;
