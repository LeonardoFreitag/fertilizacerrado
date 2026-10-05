import { z } from 'zod';
import { polygonSchema } from '../../../utils/geojson.util';

export const MIN_AREA_HA = 0.01;
export const MAX_AREA_HA = 1_000_000;

export const areaHaSchema = z
  .number()
  .min(MIN_AREA_HA, `deve ser no mínimo ${MIN_AREA_HA} ha`)
  .max(MAX_AREA_HA, `deve ser no máximo ${MAX_AREA_HA} ha`);

/** Altitude em metros (Brasil: 0–3000; folga para pegar erros grosseiros). */
export const altitudeSchema = z.number().min(-100, 'deve ser no mínimo -100 m').max(5000, 'deve ser no máximo 5000 m');
/** Umidade volumétrica (m³/m³) em (0, 1). */
export const thetaSchema = z.number().gt(0, 'deve ser maior que 0').lt(1, 'deve ser menor que 1');

/** thetaFC > thetaWP quando ambos presentes; o erro aponta o campo informado. */
export function refineSoilWater(
  value: { thetaFC?: number | null; thetaWP?: number | null },
  ctx: z.RefinementCtx,
  path: 'thetaFC' | 'thetaWP' = 'thetaFC',
): void {
  if (value.thetaFC != null && value.thetaWP != null && value.thetaFC <= value.thetaWP) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: 'thetaFC deve ser maior que thetaWP' });
  }
}

export const fieldFieldsSchema = z.object({
  name: z.string().trim().min(1, 'obrigatório').max(120),
  areaHa: areaHaSchema.optional(),
  soilType: z.string().trim().min(1).max(60).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
  altitudeM: altitudeSchema.optional(),
  thetaFC: thetaSchema.optional(),
  thetaWP: thetaSchema.optional(),
});

export const createFieldSchema = fieldFieldsSchema
  .extend({
    geometry: polygonSchema,
  })
  .superRefine((value, ctx) => refineSoilWater(value, ctx));

export type CreateFieldDto = z.infer<typeof createFieldSchema>;
