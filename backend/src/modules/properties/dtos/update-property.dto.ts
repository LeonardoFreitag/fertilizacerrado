import { z } from 'zod';
import { propertyFieldsSchema } from './create-property.dto';

/** Campos que só ADMIN pode alterar. */
export const ADMIN_ONLY_PROPERTY_FIELDS = ['ownerId', 'agronomistId'] as const;

export const updatePropertySchema = propertyFieldsSchema
  .extend({
    car: z.string().trim().min(1).max(60).nullable(),
    nirf: z.string().trim().min(1).max(60).nullable(),
    ownerId: z.string().uuid(),
    agronomistId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'informe ao menos um campo');

export type UpdatePropertyDto = z.infer<typeof updatePropertySchema>;
