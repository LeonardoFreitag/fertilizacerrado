import type { Request, Response } from 'express';
import { createFieldSchema } from './dtos/create-field.dto';
import { fieldListParamsSchema, fieldParamsSchema } from './dtos/params.dto';
import { updateFieldSchema } from './dtos/update-field.dto';
import { currentUser } from './property.controller';
import { propertyService } from './property.service';

export const fieldController = {
  async list(req: Request, res: Response): Promise<void> {
    const { propertyId } = fieldListParamsSchema.parse(req.params);
    res.status(200).json(await propertyService.listFields(currentUser(req), propertyId));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { propertyId, id } = fieldParamsSchema.parse(req.params);
    res.status(200).json(await propertyService.getField(currentUser(req), propertyId, id));
  },

  async create(req: Request, res: Response): Promise<void> {
    const { propertyId } = fieldListParamsSchema.parse(req.params);
    const dto = createFieldSchema.parse(req.body);
    res.status(201).json(await propertyService.createField(currentUser(req), propertyId, dto));
  },

  async update(req: Request, res: Response): Promise<void> {
    const { propertyId, id } = fieldParamsSchema.parse(req.params);
    const dto = updateFieldSchema.parse(req.body);
    res.status(200).json(await propertyService.updateField(currentUser(req), propertyId, id, dto));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { propertyId, id } = fieldParamsSchema.parse(req.params);
    await propertyService.deleteField(currentUser(req), propertyId, id);
    res.status(204).end();
  },
};
