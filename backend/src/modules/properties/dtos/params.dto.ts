import { z } from 'zod';

const uuid = z.string().uuid('identificador inválido');

export const propertyIdParamsSchema = z.object({ id: uuid });

export const fieldListParamsSchema = z.object({ propertyId: uuid });

export const fieldParamsSchema = fieldListParamsSchema.extend({ id: uuid });
