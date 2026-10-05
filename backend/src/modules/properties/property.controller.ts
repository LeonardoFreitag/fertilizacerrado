import type { Request, Response } from 'express';
import { AppError } from '../../utils/app-error';
import { createPropertySchema } from './dtos/create-property.dto';
import { propertyIdParamsSchema } from './dtos/params.dto';
import { updatePropertySchema } from './dtos/update-property.dto';
import { propertyService, type AuthUser } from './property.service';

/** `authenticate` sempre precede estas rotas; a checagem cobre uso indevido. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente ou inválido.');
  return req.user;
}

export const propertyController = {
  async list(req: Request, res: Response): Promise<void> {
    res.status(200).json(await propertyService.listProperties(currentUser(req)));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = propertyIdParamsSchema.parse(req.params);
    res.status(200).json(await propertyService.getProperty(currentUser(req), id));
  },

  async create(req: Request, res: Response): Promise<void> {
    const dto = createPropertySchema.parse(req.body);
    res.status(201).json(await propertyService.createProperty(currentUser(req), dto));
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = propertyIdParamsSchema.parse(req.params);
    const dto = updatePropertySchema.parse(req.body);
    res.status(200).json(await propertyService.updateProperty(currentUser(req), id, dto));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { id } = propertyIdParamsSchema.parse(req.params);
    await propertyService.deleteProperty(currentUser(req), id);
    res.status(204).end();
  },
};
