import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { userController } from './user.controller';

/** /api/v1/users — diretório, administração e perfil próprio (escopo no serviço). */
export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.get('/', userController.list);
// `/me/password` antes de `/:id` para não ser capturado pelo parâmetro
userRoutes.patch('/me/password', userController.changePassword);
userRoutes.get('/:id', userController.get);
userRoutes.patch('/:id', userController.update);
userRoutes.post('/:id/deactivate', authorize('ADMIN'), userController.deactivate);
userRoutes.post('/:id/reactivate', authorize('ADMIN'), userController.reactivate);
userRoutes.post('/:id/resend-verification', authorize('ADMIN'), userController.resendVerification);
