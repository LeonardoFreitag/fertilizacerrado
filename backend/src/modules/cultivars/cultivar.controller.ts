import type { Request, Response } from 'express';
import { currentUser } from '../properties/property.controller';
import { cultivarService } from './cultivar.service';
import { createCultivarSchema, syncReferenceSchema } from './dtos/create-cultivar.dto';
import { cultivarIdParamsSchema } from './dtos/params.dto';
import { updateCultivarSchema } from './dtos/update-cultivar.dto';

export const cultivarController = {
  async list(req: Request, res: Response): Promise<void> {
    res.status(200).json(await cultivarService.list(currentUser(req)));
  },

  async reference(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await cultivarService.getReference());
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = cultivarIdParamsSchema.parse(req.params);
    res.status(200).json(await cultivarService.get(currentUser(req), id));
  },

  async create(req: Request, res: Response): Promise<void> {
    const dto = createCultivarSchema.parse(req.body);
    res.status(201).json(await cultivarService.create(currentUser(req), dto));
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = cultivarIdParamsSchema.parse(req.params);
    const dto = updateCultivarSchema.parse(req.body);
    res.status(200).json(await cultivarService.update(currentUser(req), id, dto));
  },

  async syncReference(req: Request, res: Response): Promise<void> {
    const { id } = cultivarIdParamsSchema.parse(req.params);
    const { mode } = syncReferenceSchema.parse(req.body);
    const { cultivar, updatedFields } = await cultivarService.syncReference(currentUser(req), id, mode);
    res.status(200).json({ ...cultivar, updatedFields });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { id } = cultivarIdParamsSchema.parse(req.params);
    await cultivarService.delete(currentUser(req), id);
    res.status(204).end();
  },
};
