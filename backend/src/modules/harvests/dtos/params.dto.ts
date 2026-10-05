import { z } from 'zod';
import { HARVEST_STATUSES } from './create-harvest.dto';

const uuid = z.string().uuid('identificador inválido');

export const harvestIdParamsSchema = z.object({ id: uuid });

export const fieldHarvestsParamsSchema = z.object({ propertyId: uuid, fieldId: uuid });

export const listHarvestsQuerySchema = z.object({
  fieldId: uuid.optional(),
  status: z.enum(HARVEST_STATUSES).optional(),
});

export type ListHarvestsQuery = z.infer<typeof listHarvestsQuerySchema>;
