import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { fieldHarvestRoutes } from '../harvests/harvest.routes';
import { fieldController } from './field.controller';
import { propertyController } from './property.controller';

const manage = authorize('AGRONOMO', 'ADMIN');

// mergeParams: o sub-router enxerga :propertyId do router pai.
const fieldRoutes = Router({ mergeParams: true });

fieldRoutes.get('/', fieldController.list);
fieldRoutes.post('/', manage, fieldController.create);
fieldRoutes.get('/:id', fieldController.get);
fieldRoutes.patch('/:id', manage, fieldController.update);
fieldRoutes.delete('/:id', manage, fieldController.remove);

export const propertyRoutes = Router();

propertyRoutes.use(authenticate);

propertyRoutes.get('/', propertyController.list);
propertyRoutes.post('/', manage, propertyController.create);
propertyRoutes.get('/:id', propertyController.get);
propertyRoutes.patch('/:id', manage, propertyController.update);
propertyRoutes.delete('/:id', authorize('ADMIN'), propertyController.remove);

// Antes de fieldRoutes, para que /:propertyId/fields/:fieldId/harvests não
// caia em fieldRoutes.get('/:id').
propertyRoutes.use('/:propertyId/fields/:fieldId/harvests', fieldHarvestRoutes);
propertyRoutes.use('/:propertyId/fields', fieldRoutes);
