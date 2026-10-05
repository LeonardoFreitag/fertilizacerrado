import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { userController } from './user.controller';

/** /api/v1/users — diretório mínimo (escopo por role no serviço). */
export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.get('/', userController.list);
