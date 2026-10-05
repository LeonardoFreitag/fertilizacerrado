import { z } from 'zod';
import { forbiddenField } from '../../cultivars/dtos/create-cultivar.dto';
import { HARVEST_STATUSES, harvestNotesSchema, seasonSchema } from './create-harvest.dto';

export const updateHarvestSchema = z
  .object({
    status: z.enum(HARVEST_STATUSES),
    notes: harvestNotesSchema.nullable(),
    season: seasonSchema,
  })
  .partial()
  .extend({
    // Trocar talhão, cultivar ou emergência invalidaria resultados do MSA:
    // cancela-se a safra e cria-se outra.
    fieldId: forbiddenField('não pode ser alterado; cancele a safra e crie outra'),
    cultivarId: forbiddenField('não pode ser alterado; cancele a safra e crie outra'),
    emergenceDate: forbiddenField('não pode ser alterado; cancele a safra e crie outra'),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    'informe ao menos um campo',
  );

export type UpdateHarvestDto = z.infer<typeof updateHarvestSchema>;
