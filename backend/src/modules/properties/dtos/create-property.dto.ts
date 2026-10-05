import { z } from 'zod';

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const propertyFieldsSchema = z.object({
  name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120),
  state: z.enum(UFS, { errorMap: () => ({ message: 'UF inválida' }) }),
  city: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120),
  car: z.string().trim().min(1).max(60).optional(),
  nirf: z.string().trim().min(1).max(60).optional(),
});

export const createPropertySchema = propertyFieldsSchema.extend({
  ownerId: z.string().uuid().optional(),
  agronomistId: z.string().uuid().optional(),
});

export type CreatePropertyDto = z.infer<typeof createPropertySchema>;
