import { Router } from 'express';
import { authorize } from '../../middleware/auth.middleware';
import { msaController } from './msa.controller';

const manage = authorize('AGRONOMO', 'ADMIN');

/** Montado em harvest.routes sob /:id/msa (o authenticate vem do router pai). */
export const msaRoutes = Router({ mergeParams: true });

msaRoutes.post('/process', manage, msaController.process);
msaRoutes.get('/', msaController.latest);
msaRoutes.get('/daily', msaController.daily);
msaRoutes.get('/runs', msaController.runs);
msaRoutes.get('/decision', msaController.decision);
msaRoutes.post('/decisions', manage, msaController.recordDecision);
msaRoutes.get('/decisions', msaController.decisions);
