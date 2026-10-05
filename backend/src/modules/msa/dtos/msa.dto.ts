import { z } from 'zod';

const uuid = z.string().uuid('identificador inválido');
const YIELD_PHASES = ['F1', 'F2', 'F3', 'F4'] as const;

export const msaParamsSchema = z.object({ id: uuid });

export const processQuerySchema = z.object({
  seed: z.coerce.number().int().min(0).max(2 ** 31 - 1).optional(),
  /** true ⇒ processa inline (só ADMIN); padrão enfileira */
  sync: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const dailyQuerySchema = z.object({ runId: uuid.optional() });

export const decisionQuerySchema = z.object({
  phase: z.enum(YIELD_PHASES),
  doseBase: z.coerce.number().min(0, 'deve ser ≥ 0'),
  /** Eficiência de uso do nutriente, fração em [0, 1] */
  efficiencyBase: z.coerce.number().min(0, 'deve ser ≥ 0').max(1, 'deve ser ≤ 1'),
  runId: uuid.optional(),
});

export const recordDecisionSchema = z.object({
  phase: z.enum(YIELD_PHASES),
  scenario: z.enum(['A', 'B', 'C']),
  doseBase: z.number().min(0),
  efficiencyBase: z.number().min(0).max(1),
  justification: z.string().trim().min(3, 'deve ter no mínimo 3 caracteres').max(2000),
  runId: uuid.optional(),
});

export type DecisionQuery = z.infer<typeof decisionQuerySchema>;
export type RecordDecisionDto = z.infer<typeof recordDecisionSchema>;
