/**
 * Persistência do MSA: runs, série baseline, resumos por janela e decisões.
 */
import type { MsaRun, MsaRunStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export const harvestForProcessingSelect = {
  id: true,
  status: true,
  emergenceDate: true,
  latestRunId: true,
  field: { select: { id: true, name: true, propertyId: true, altitudeM: true, thetaFC: true, thetaWP: true } },
  cultivar: true,
} satisfies Prisma.HarvestSelect;

export type HarvestForProcessing = Prisma.HarvestGetPayload<{ select: typeof harvestForProcessingSelect }>;

const runWithSummaries = { phaseSummaries: { orderBy: { phase: 'asc' } } } satisfies Prisma.MsaRunInclude;
export type RunWithSummaries = Prisma.MsaRunGetPayload<{ include: typeof runWithSummaries }>;

const decisionInclude = {
  decidedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MsaDecisionInclude;
export type DecisionWithUser = Prisma.MsaDecisionGetPayload<{ include: typeof decisionInclude }>;

export type RunCreate = Omit<Prisma.MsaRunUncheckedCreateInput, 'status'> & { status: MsaRunStatus };
export type DailyCreate = Omit<Prisma.MsaDailyResultCreateManyInput, 'runId'>;
export type SummaryCreate = Omit<Prisma.MsaPhaseSummaryCreateManyInput, 'runId'>;

export const msaRepository = {
  findHarvestForProcessing(harvestId: string): Promise<HarvestForProcessing | null> {
    return prisma.harvest.findUnique({ where: { id: harvestId }, select: harvestForProcessingSelect });
  },

  /** Run SUCCEEDED com série e resumos, e latestRunId da safra, em uma transação. */
  createSucceededRun(run: RunCreate, daily: DailyCreate[], summaries: SummaryCreate[]): Promise<RunWithSummaries> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.msaRun.create({ data: run });
      await tx.msaDailyResult.createMany({ data: daily.map((d) => ({ ...d, runId: created.id })) });
      await tx.msaPhaseSummary.createMany({ data: summaries.map((s) => ({ ...s, runId: created.id })) });
      await tx.harvest.update({ where: { id: run.harvestId }, data: { latestRunId: created.id } });
      return tx.msaRun.findUniqueOrThrow({ where: { id: created.id }, include: runWithSummaries });
    });
  },

  /** Runs NEEDS_DATA e FAILED: só o registro, sem tocar em latestRunId. */
  createRun(run: RunCreate): Promise<MsaRun> {
    return prisma.msaRun.create({ data: run });
  },

  listRuns(harvestId: string): Promise<MsaRun[]> {
    return prisma.msaRun.findMany({ where: { harvestId }, orderBy: { startedAt: 'desc' } });
  },

  findRun(harvestId: string, runId: string): Promise<RunWithSummaries | null> {
    return prisma.msaRun.findFirst({ where: { id: runId, harvestId }, include: runWithSummaries });
  },

  async latestSucceededRun(harvestId: string): Promise<RunWithSummaries | null> {
    const harvest = await prisma.harvest.findUnique({ where: { id: harvestId }, select: { latestRunId: true } });
    if (!harvest?.latestRunId) return null;
    return prisma.msaRun.findUnique({ where: { id: harvest.latestRunId }, include: runWithSummaries });
  },

  dailyResults(runId: string) {
    return prisma.msaDailyResult.findMany({ where: { runId }, orderBy: { date: 'asc' } });
  },

  createDecision(data: Prisma.MsaDecisionUncheckedCreateInput): Promise<DecisionWithUser> {
    return prisma.msaDecision.create({ data, include: decisionInclude });
  },

  listDecisions(harvestId: string): Promise<DecisionWithUser[]> {
    return prisma.msaDecision.findMany({ where: { harvestId }, include: decisionInclude, orderBy: { createdAt: 'desc' } });
  },
};
