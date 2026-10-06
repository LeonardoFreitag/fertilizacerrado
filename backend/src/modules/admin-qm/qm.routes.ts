import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { qmController } from './qm.controller';

/** /api/v1/admin/qm — calibrações de Quantile Mapping (ADMIN). */
export const qmRoutes = Router();

qmRoutes.use(authenticate, authorize('ADMIN'));
qmRoutes.get('/calibrations', qmController.list);
qmRoutes.post('/calibrate', qmController.calibrate);
