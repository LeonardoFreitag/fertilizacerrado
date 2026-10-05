import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { jobsController } from './jobs.controller';

/** /api/v1/admin/jobs — operação das filas; só ADMIN. */
export const jobsRoutes = Router();

jobsRoutes.use(authenticate, authorize('ADMIN'));

jobsRoutes.get('/queues', jobsController.queues);
jobsRoutes.get('/:queue/:id', jobsController.job);
jobsRoutes.post('/ingest-latest', jobsController.ingestLatest);
jobsRoutes.post('/backfill-region', jobsController.backfillRegion);
jobsRoutes.post('/process-all', jobsController.processAll);
