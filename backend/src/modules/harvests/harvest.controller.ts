import type { Request, Response } from 'express';
import { currentUser } from '../properties/property.controller';
import { createHarvestSchema } from './dtos/create-harvest.dto';
import {
  fieldHarvestsParamsSchema,
  harvestIdParamsSchema,
  listHarvestsQuerySchema,
} from './dtos/params.dto';
import { updateHarvestSchema } from './dtos/update-harvest.dto';
import { harvestService } from './harvest.service';

export const harvestController = {
  async create(req: Request, res: Response): Promise<void> {
    const dto = createHarvestSchema.parse(req.body);
    res.status(201).json(await harvestService.create(currentUser(req), dto));
  },

  async list(req: Request, res: Response): Promise<void> {
    const query = listHarvestsQuerySchema.parse(req.query);
    res.status(200).json(await harvestService.list(currentUser(req), query));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = harvestIdParamsSchema.parse(req.params);
    res.status(200).json(await harvestService.get(currentUser(req), id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = harvestIdParamsSchema.parse(req.params);
    const dto = updateHarvestSchema.parse(req.body);
    res.status(200).json(await harvestService.update(currentUser(req), id, dto));
  },

  /** GET /properties/:propertyId/fields/:fieldId/harvests */
  async listByField(req: Request, res: Response): Promise<void> {
    const { propertyId, fieldId } = fieldHarvestsParamsSchema.parse(req.params);
    res.status(200).json(await harvestService.listByField(currentUser(req), propertyId, fieldId));
  },
};
