/** Espelho de backend/src/modules/harvests/dtos. */
import { z } from 'zod';
import { EXPECTED_YIELD_MAX_SC_HA } from '../api/types';
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

/** Ym em sc/ha: vazio ⇒ undefined; aceita vírgula decimal; > 0 e ≤ teto. */
export const expectedYieldSchema = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z
    .number({ invalid_type_error: `informe um valor entre 0 e ${EXPECTED_YIELD_MAX_SC_HA}` })
    .positive(`informe um valor entre 0 e ${EXPECTED_YIELD_MAX_SC_HA}`)
    .max(EXPECTED_YIELD_MAX_SC_HA, `informe um valor entre 0 e ${EXPECTED_YIELD_MAX_SC_HA}`)
    .optional(),
);

export const harvestSchema = z.object({
  fieldId: z.string().uuid('escolha o talhão'),
  cultivarId: z.string().uuid('escolha a cultivar'),
  emergenceDate: calendarDateSchema.refine((v) => v <= todayIso(), 'não pode ser futura'),
  season: seasonSchema,
  expectedYield: expectedYieldSchema,
  notes: z
    .string()
    .trim()
    .max(2000, 'deve ter no máximo 2000 caracteres')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type HarvestForm = z.infer<typeof harvestSchema>;
