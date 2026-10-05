import { z } from 'zod';
import { polygonSchema } from '../../../utils/geojson.util';
import { altitudeSchema, areaHaSchema, thetaSchema } from './create-field.dto';

// thetaFC > thetaWP é validado no service sobre o estado resultante (atual + patch).
export const updateFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    areaHa: areaHaSchema,
    soilType: z.string().trim().min(1).max(60).nullable(),
    notes: z.string().trim().min(1).max(2000).nullable(),
    geometry: polygonSchema,
    altitudeM: altitudeSchema.nullable(),
    thetaFC: thetaSchema.nullable(),
    thetaWP: thetaSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'informe ao menos um campo');

export type UpdateFieldDto = z.infer<typeof updateFieldSchema>;
