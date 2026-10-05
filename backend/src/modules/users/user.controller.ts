import type { Request, Response } from 'express';
import { currentUser } from '../properties/property.controller';
import { listUsersQuerySchema } from './dtos/list-users.dto';
import { userService } from './user.service';

export const userController = {
  async list(req: Request, res: Response): Promise<void> {
    const query = listUsersQuerySchema.parse(req.query);
    res.status(200).json(await userService.list(currentUser(req), query));
  },
};
