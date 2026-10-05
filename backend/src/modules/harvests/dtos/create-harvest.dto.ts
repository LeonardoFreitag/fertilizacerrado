import { z } from 'zod';

export const HARVEST_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

/** Data-calendário sem hora, para não depender de fuso. Rejeita 2025-02-30. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'data inexistente');

/** Safra agrícola "AAAA/AA", com o segundo ano igual ao primeiro mais um. */
export const seasonSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}$/, 'use o formato AAAA/AA, ex.: 2025/26')
  .refine((value) => {
    const [start, end] = value.split('/');
    return (Number(start) + 1) % 100 === Number(end);
  }, 'o segundo ano deve ser o seguinte ao primeiro');

export const harvestNotesSchema = z.string().trim().min(1).max(2000);

export const createHarvestSchema = z.object({
  fieldId: z.string().uuid('identificador inválido'),
  cultivarId: z.string().uuid('identificador inválido'),
  emergenceDate: calendarDateSchema,
  season: seasonSchema,
  notes: harvestNotesSchema.optional(),
});

export type CreateHarvestDto = z.infer<typeof createHarvestSchema>;
