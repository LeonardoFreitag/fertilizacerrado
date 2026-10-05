import { z } from 'zod';
import { cultivarParamsShape } from './cultivar-params.schema';
import { cultivarNameSchema, cycleDescriptionSchema, forbiddenField } from './create-cultivar.dto';

// Parciais aqui; as relações cruzadas são validadas no service sobre o
// estado resultante (atual + patch).
export const updateCultivarSchema = z
  .object({
    name: cultivarNameSchema,
    cycleDescription: cycleDescriptionSchema.nullable(),
    ...cultivarParamsShape,
  })
  .partial()
  .extend({
    crop: forbiddenField('não pode ser alterado; crie outra cultivar'),
    isDefault: forbiddenField('não pode ser alterado'),
    createdById: forbiddenField('não pode ser alterado'),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    'informe ao menos um campo',
  );

export type UpdateCultivarDto = z.infer<typeof updateCultivarSchema>;
