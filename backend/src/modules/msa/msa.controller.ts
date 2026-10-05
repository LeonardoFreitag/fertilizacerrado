import type { Request, Response } from 'express';
import { currentUser } from '../properties/property.controller';
import { dailyQuerySchema, decisionQuerySchema, msaParamsSchema, processQuerySchema, recordDecisionSchema } from './dtos/msa.dto';
import { msaService } from './msa.service';

export const msaController = {
  async process(req: Request, res: Response): Promise<void> {
    const { id } = msaParamsSchema.parse(req.params);
    const { seed } = processQuerySchema.parse(req.query);
    const result = await msaService.processHarvest(currentUser(req), id, { seed });
    res.status(result.run.status === 'SUCCEEDED' ? 201 : 200).json(result);
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
