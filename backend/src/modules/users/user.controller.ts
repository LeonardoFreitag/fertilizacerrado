import type { Request, Response } from 'express';
import { currentUser } from '../properties/property.controller';
import { listUsersQuerySchema } from './dtos/list-users.dto';
import { changePasswordSchema, updateUserSchema, userIdParamsSchema } from './dtos/user.dto';
import { userService } from './user.service';

export const userController = {
  async list(req: Request, res: Response): Promise<void> {
    const query = listUsersQuerySchema.parse(req.query);
    res.status(200).json(await userService.list(currentUser(req), query));
  },

  async get(req: Request, res: Response): Promise<void> {
    const { id } = userIdParamsSchema.parse(req.params);
    res.status(200).json(await userService.get(currentUser(req), id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = userIdParamsSchema.parse(req.params);
    const dto = updateUserSchema.parse(req.body);
    res.status(200).json(await userService.update(currentUser(req), id, dto));
  },

  async deactivate(req: Request, res: Response): Promise<void> {
    const { id } = userIdParamsSchema.parse(req.params);
    res.status(200).json(await userService.setActive(currentUser(req), id, false));
  },

  async reactivate(req: Request, res: Response): Promise<void> {
    const { id } = userIdParamsSchema.parse(req.params);
    res.status(200).json(await userService.setActive(currentUser(req), id, true));
  },

  async resendVerification(req: Request, res: Response): Promise<void> {
    const { id } = userIdParamsSchema.parse(req.params);
    await userService.resendVerification(id);
    res.status(204).end();
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const dto = changePasswordSchema.parse(req.body);
    await userService.changePassword(currentUser(req), dto);
    res.status(204).end();
  },
};
