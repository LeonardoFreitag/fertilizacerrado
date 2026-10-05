import { z } from 'zod';
import { cultivarParamsShape, refineCultivarParams } from './cultivar-params.schema';

export const CROPS = ['SOJA', 'MILHO'] as const;

/** Campo que o cliente não pode enviar; o erro sai no path do campo. */
export function forbiddenField(message: string) {
  return z.undefined({ invalid_type_error: message });
}

export const cultivarNameSchema = z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120);
export const cycleDescriptionSchema = z.string().trim().min(1).max(500);

export const createCultivarSchema = z
  .object({
    name: cultivarNameSchema,
    crop: z.enum(CROPS),
    cycleDescription: cycleDescriptionSchema.optional(),
    ...cultivarParamsShape,
    // Só o seed marca cultivares de referência.
    isDefault: forbiddenField('não pode ser informado'),
  })
  .superRefine(refineCultivarParams);

export type CreateCultivarDto = z.infer<typeof createCultivarSchema>;

export const listCultivarsQuerySchema = z.object({
  crop: z.enum(CROPS).optional(),
});
