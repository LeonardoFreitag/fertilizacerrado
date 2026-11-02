import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { cultivarController } from './cultivar.controller';

const manage = authorize('AGRONOMO', 'ADMIN');

export const cultivarRoutes = Router();

cultivarRoutes.use(authenticate);

cultivarRoutes.get('/', cultivarController.list);
// Antes de /:id, senão "reference" seria tratado como id inválido.
cultivarRoutes.get('/reference', cultivarController.reference);
cultivarRoutes.post('/', manage, cultivarController.create);
cultivarRoutes.get('/:id', cultivarController.get);
cultivarRoutes.patch('/:id', manage, cultivarController.update);
cultivarRoutes.post('/:id/sync-reference', manage, cultivarController.syncReference);
cultivarRoutes.delete('/:id', manage, cultivarController.remove);
