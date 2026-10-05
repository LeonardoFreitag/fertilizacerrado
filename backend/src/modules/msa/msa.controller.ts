import type { Request, Response } from 'express';
import { AppError } from '../../utils/app-error';
import { harvestService } from '../harvests/harvest.service';
import { jobsService } from '../jobs/jobs.service';
import { currentUser } from '../properties/property.controller';
import { dailyQuerySchema, decisionQuerySchema, msaParamsSchema, processQuerySchema, recordDecisionSchema } from './dtos/msa.dto';
import { msaService } from './msa.service';

export const msaController = {
  /** Padrão: enfileira (202). `?sync=true` (só ADMIN) processa inline: 201/200/422/500. */
  async process(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    const { seed, sync } = processQuerySchema.parse(req.query);
    const user = currentUser(req);

    if (sync) {
      if (user.role !== 'ADMIN') {
        throw new AppError(403, 'SYNC_ADMIN_ONLY', 'Processamento síncrono é restrito a administradores; use o padrão (fila).');
      }
      const result = await msaService.processHarvest(user, id, { seed, reason: 'MANUAL' });
      res.status(result.run.status === 'SUCCEEDED' ? 201 : 200).json(result);
      return;
    }

    await harvestService.getAccessible(user, id); // 404 fora do escopo, antes de enfileirar
    const job = await jobsService.enqueueProcess({ harvestId: id, seed, reason: 'MANUAL' });
    res.status(202).json({ ...job, status: 'queued' });
  },

  async latest(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    res.status(200).json(await msaService.getLatest(currentUser(req), id));
  },

  async daily(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    const { runId } = dailyQuerySchema.parse(req.query);
    res.status(200).json(await msaService.getDaily(currentUser(req), id, runId));
  },

  async runs(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    res.status(200).json(await msaService.listRuns(currentUser(req), id));
  },

  async decision(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    const query = decisionQuerySchema.parse(req.query);
    res.status(200).json(await msaService.decisionScenarios(currentUser(req), id, query));
  },

  async recordDecision(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    const dto = recordDecisionSchema.parse(req.body);
    res.status(201).json(await msaService.recordDecision(currentUser(req), id, dto));
  },

  async decisions(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    res.status(200).json(await msaService.listDecisions(currentUser(req), id));
  },
};
