import { z } from 'zod';
import { cultivarParamsShape, refineCultivarParams } from './cultivar-params.schema';

/** Campo que o cliente não pode enviar; o erro sai no path do campo. */
export function forbiddenField(message: string) {
  return z.undefined({ invalid_type_error: message });
}

export const cultivarNameSchema = z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120);
export const cycleDescriptionSchema = z.string().trim().min(1).max(500);

export const createCultivarSchema = z
  .object({
    name: cultivarNameSchema,
    cycleDescription: cycleDescriptionSchema.optional(),
    ...cultivarParamsShape,
    // Só soja na Fase 1: o servidor grava SOJA; o cliente não escolhe cultura.
    crop: forbiddenField('não pode ser informado; o sistema só trabalha com soja'),
    // Só o seed marca cultivares de referência.
    isDefault: forbiddenField('não pode ser informado'),
  })
  .superRefine(refineCultivarParams);

export type CreateCultivarDto = z.infer<typeof createCultivarSchema>;

export const SYNC_REFERENCE_MODES = ['unchanged', 'all'] as const;
export type SyncReferenceMode = (typeof SYNC_REFERENCE_MODES)[number];

/** `unchanged`: só os campos iguais ao referenceSnapshot; `all`: os 15. */
export const syncReferenceSchema = z.object({
  mode: z.enum(SYNC_REFERENCE_MODES, { errorMap: () => ({ message: 'use "unchanged" ou "all"' }) }),
});

export type SyncReferenceDto = z.infer<typeof syncReferenceSchema>;
