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

/**
 * Teto de sanidade da produtividade potencial (Ym), sc/ha. O recorde brasileiro
 * de soja fica abaixo de 150; o valor é uma constante para ser trocado num lugar
 * só (o frontend repete o mesmo número em `lib/api/types.ts`).
 */
export const EXPECTED_YIELD_MAX_SC_HA = 250;

/** Produtividade potencial informada pelo técnico: número finito, > 0 e ≤ teto. */
export const expectedYieldSchema = z
  .number({ invalid_type_error: 'deve ser um número' })
  .finite()
  .positive('deve ser maior que zero')
  .max(EXPECTED_YIELD_MAX_SC_HA, `deve ser no máximo ${EXPECTED_YIELD_MAX_SC_HA} sc/ha`);

export const createHarvestSchema = z.object({
  fieldId: z.string().uuid('identificador inválido'),
  cultivarId: z.string().uuid('identificador inválido'),
  emergenceDate: calendarDateSchema,
  season: seasonSchema,
  expectedYield: expectedYieldSchema.optional(),
  notes: harvestNotesSchema.optional(),
});

export type CreateHarvestDto = z.infer<typeof createHarvestSchema>;
