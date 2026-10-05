import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { cultivarController } from './cultivar.controller';

const manage = authorize('AGRONOMO', 'ADMIN');

export const cultivarRoutes = Router();

cultivarRoutes.use(authenticate);

cultivarRoutes.get('/', cultivarController.list);
cultivarRoutes.post('/', manage, cultivarController.create);
cultivarRoutes.get('/:id', cultivarController.get);
cultivarRoutes.patch('/:id', manage, cultivarController.update);
cultivarRoutes.delete('/:id', manage, cultivarController.remove);
