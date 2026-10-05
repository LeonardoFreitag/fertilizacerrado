import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { msaRoutes } from '../msa/msa.routes';
import { harvestController } from './harvest.controller';

const manage = authorize('AGRONOMO', 'ADMIN');

export const harvestRoutes = Router();

harvestRoutes.use(authenticate);

// Antes de /:id, para que /:id/msa/... não caia nas rotas de safra.
harvestRoutes.use('/:id/msa', msaRoutes);

harvestRoutes.get('/', harvestController.list);
harvestRoutes.post('/', manage, harvestController.create);
harvestRoutes.get('/:id', harvestController.get);
harvestRoutes.patch('/:id', manage, harvestController.update);
// Sem DELETE: safra é cancelada (status), preservando o histórico.

/** Montado em property.routes sob /:propertyId/fields/:fieldId/harvests. */
export const fieldHarvestRoutes = Router({ mergeParams: true });

fieldHarvestRoutes.get('/', harvestController.listByField);
