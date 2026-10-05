import { z } from 'zod';

export const cultivarIdParamsSchema = z.object({
  id: z.string().uuid('identificador inválido'),
});
