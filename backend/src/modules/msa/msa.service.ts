/**
 * Orquestra o MSA por safra: era5.repository → engine → banco → API.
 * Processamento síncrono (o Monte Carlo leva ~0,1 s); fila e agendamento
 * ficam para a próxima change. `docs/modulos/msa.md`.
 */
import { randomInt } from 'node:crypto';
import type { MsaDecision, MsaRun, MsaRunReason, MsaScenario } from '@prisma/client';
import { AppError } from '../../utils/app-error';
import { CULTIVAR_PARAM_KEYS } from '../cultivars/dtos/cultivar-params.schema';
import { harvestService } from '../harvests/harvest.service';
import type { AuthUser } from '../properties/property.service';
import {
  ENGINE_VERSION,
  dailyGDA,
  generateDecisionScenarios,
  runMonteCarlo,
  type CultivarParams,
  type DailyBalanceRow,
  type DailyWeather,
  type DecisionScenarios,
  type MonteCarloResult,
  type Phase,
  type YieldPhase,
} from './engine';
import { era5Repository } from './era5.repository';
import {
  msaRepository,
  type DailyCreate,
  type DecisionWithUser,
  type HarvestForProcessing,
  type RunWithSummaries,
  type SummaryCreate,
} from './msa.repository';

/** Lag do ERA5-Land (~5 dias) com margem — o mesmo do ETL (`ingest --latest`). */
export const DATA_LAG_DAYS = 6;
/** Latossolo Vermelho do Cerrado (`docs/msa/algoritmos.md` §5). */
export const DEFAULT_SOIL = { thetaFC: 0.28, thetaWP: 0.12 } as const;
const ITERATIONS = 1000;
const MAX_SEED = 2 ** 31 - 1;
const DAY_MS = 86_400_000;

export interface CultivarSnapshot extends CultivarParams {
  id: string;
  name: string;
  crop: string;
}

export interface SoilSnapshot {
  thetaFC: number;
  thetaWP: number;
  altitudeM: number;
  /** true quando thetaFC/thetaWP vieram do default regional, não do talhão */
  soilDefaults: boolean;
}

export interface PhaseView {
  phase: string;
  days: number;
  ksMean: number | null;
  etcAdjAccum: number;
  precipAccum: number;
  yieldReductionPct: number | null;
  validIterations: number;
  percentiles: {
    ksMean: { p10: number; p50: number; p90: number } | null;
    yieldReductionPct: { p10: number; p50: number; p90: number } | null;
    etcAdjAccum: { p10: number; p50: number; p90: number } | null;
  };
}

export interface ProcessOptions {
  seed?: number;
  reason?: MsaRunReason;
  jobId?: string;
}

export interface RunView {
  id: string;
  harvestId: string;
  status: MsaRun['status'];
  reason: MsaRunReason;
  jobId: string | null;
  startedAt: Date;
  finishedAt: Date;
  dateFrom: string;
  dateTo: string;
  seed: number | null;
  iterations: number | null;
  sigmaPrecip: number | null;
  sigmaTemp: number | null;
  engineVersion: string;
  cultivarSnapshot: unknown;
  soilSnapshot: unknown;
  missingDates: unknown;
  error: string | null;
  triggeredById: string | null;
}

export interface ProcessResult {
  run: RunView;
  phases: PhaseView[] | null;
  currentPhase: Phase | null;
}

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function toStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number): string {
  return toStr(new Date(toDate(s).getTime() + n * DAY_MS));
}
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toRunView(run: MsaRun): RunView {
  return {
    id: run.id,
    harvestId: run.harvestId,
    status: run.status,
    reason: run.reason,
    jobId: run.jobId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    dateFrom: toStr(run.dateFrom),
    dateTo: toStr(run.dateTo),
    seed: run.seed,
    iterations: run.iterations,
    sigmaPrecip: run.sigmaPrecip,
    sigmaTemp: run.sigmaTemp,
    engineVersion: run.engineVersion,
    cultivarSnapshot: run.cultivarSnapshot,
    soilSnapshot: run.soilSnapshot,
    missingDates: run.missingDates,
    error: run.error,
    triggeredById: run.triggeredById,
  };
}

const pct = (p10: number | null, p50: number | null, p90: number | null) =>
  p10 === null || p50 === null || p90 === null ? null : { p10, p50, p90 };

export function toPhaseView(s: RunWithSummaries['phaseSummaries'][number]): PhaseView {
  return {
    phase: s.phase,
    days: s.days,
    ksMean: s.ksMean,
    etcAdjAccum: s.etcAdjAccum,
    precipAccum: s.precipAccum,
    yieldReductionPct: s.yieldReductionPct,
    validIterations: s.validIterations,
    percentiles: {
      ksMean: pct(s.ksMeanP10, s.ksMeanP50, s.ksMeanP90),
      yieldReductionPct: pct(s.yieldReductionP10, s.yieldReductionP50, s.yieldReductionP90),
      etcAdjAccum: pct(s.etcAdjAccumP10, s.etcAdjAccumP50, s.etcAdjAccumP90),
    },
  };
}

/** Snapshot = os 15 parâmetros + identificação; o motor recebe o snapshot, não o registro. */
export function snapshotCultivar(cultivar: HarvestForProcessing['cultivar']): CultivarSnapshot {
  const params = Object.fromEntries(CULTIVAR_PARAM_KEYS.map((k) => [k, cultivar[k]])) as unknown as CultivarParams;
  return { ...params, id: cultivar.id, name: cultivar.name, crop: cultivar.crop };
}

export function snapshotSoil(field: HarvestForProcessing['field']): SoilSnapshot {
  if (field.altitudeM === null) {
    throw new AppError(422, 'MISSING_FIELD_ALTITUDE', `O talhão "${field.name}" não tem altitude cadastrada; informe altitudeM antes de processar.`);
  }
  const soilDefaults = field.thetaFC === null || field.thetaWP === null;
  return {
    thetaFC: soilDefaults ? DEFAULT_SOIL.thetaFC : field.thetaFC!,
    thetaWP: soilDefaults ? DEFAULT_SOIL.thetaWP : field.thetaWP!,
    altitudeM: field.altitudeM,
    soilDefaults,
  };
}

export interface Interval {
  from: string;
  to: string;
  days: DailyWeather[];
  missingDates: string[];
}

/**
 * Intervalo de processamento: da emergência até o menor entre `limit`
 * (hoje − 6) e o dia em que o GDA acumulado atinge gdaTotal. O GDA é somado
 * sobre os dias presentes — com lacunas é uma estimativa por baixo do fim do
 * ciclo, usada só para delimitar o intervalo: lacunas depois dele não
 * bloqueiam, lacunas dentro dele viram NEEDS_DATA (nunca se interpola) e o
 * cálculo em si só acontece com a série completa.
 */
export function resolveInterval(
  from: string,
  limit: string,
  series: DailyWeather[],
  cultivar: CultivarParams,
): Interval {
  if (from > limit) return { from, to: from, days: [], missingDates: [from] };

  let to = limit;
  let gdaAccum = 0;
  for (const day of series) {
    if (day.date < from || day.date > limit) continue;
    gdaAccum += dailyGDA(day.tmax, day.tmin, cultivar.tBase);
    if (gdaAccum >= cultivar.gdaTotal) {
      to = day.date;
      break;
    }
  }

  const days = series.filter((d) => d.date >= from && d.date <= to);
  const present = new Set(days.map((d) => d.date));
  const missingDates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!present.has(d)) missingDates.push(d);
  return { from, to, days, missingDates };
}

function dailyRows(series: DailyBalanceRow[]): DailyCreate[] {
  return series.map((r) => ({
    date: toDate(r.date), phase: r.phase, gda: r.gda, gdaAccum: r.gdaAccum, zr: r.zr, et0: r.et0, kc: r.kc, etc: r.etc,
    precipitation: r.precipitation, dr: r.dr, ks: r.ks, etcAdj: r.etcAdj, taw: r.taw, raw: r.raw,
  }));
}

function summaryRows(result: MonteCarloResult): SummaryCreate[] {
  return result.baseline.map((b, i) => {
    const p = result.phases[i]!;
    return {
      phase: b.phase, days: b.days, ksMean: b.ksMean, etcAdjAccum: b.etcAdjAccum, precipAccum: b.precipAccum,
      yieldReductionPct: b.yieldReductionPct, validIterations: p.validIterations,
      ksMeanP10: p.ksMean?.p10 ?? null, ksMeanP50: p.ksMean?.p50 ?? null, ksMeanP90: p.ksMean?.p90 ?? null,
      yieldReductionP10: p.yieldReductionPct?.p10 ?? null, yieldReductionP50: p.yieldReductionPct?.p50 ?? null, yieldReductionP90: p.yieldReductionPct?.p90 ?? null,
      etcAdjAccumP10: p.etcAdjAccum?.p10 ?? null, etcAdjAccumP50: p.etcAdjAccum?.p50 ?? null, etcAdjAccumP90: p.etcAdjAccum?.p90 ?? null,
    };
  });
}

function noResult(): AppError {
  return new AppError(404, 'NO_MSA_RESULT', 'A safra ainda não tem processamento do MSA concluído.');
}

async function accessibleHarvest(user: AuthUser, harvestId: string): Promise<HarvestForProcessing> {
  await harvestService.getAccessible(user, harvestId); // 404 fora do escopo
  const harvest = await msaRepository.findHarvestForProcessing(harvestId);
  if (!harvest) throw new AppError(404, 'NOT_FOUND', 'Safra não encontrada.');
  return harvest;
}

/** Núcleo do processamento, compartilhado pela API (inline) e pelo worker. */
async function runProcessing(harvest: HarvestForProcessing, options: ProcessOptions, triggeredById: string | null): Promise<ProcessResult> {
    const harvestId = harvest.id;
    const soil = snapshotSoil(harvest.field); // 422 sem altitude, antes de qualquer run
    const cultivar = snapshotCultivar(harvest.cultivar);

    const from = toStr(harvest.emergenceDate);
    const limit = addDays(todayUtc(), -DATA_LAG_DAYS);
    const series = from > limit ? [] : await era5Repository.getDailySeriesForField(harvest.field.id, from, limit);
    if (series === null) {
      throw new AppError(422, 'FIELD_WITHOUT_ERA5_CELL', `O talhão "${harvest.field.name}" não tem célula ERA5-Land.`);
    }
    const interval = resolveInterval(from, limit, series, cultivar);
    const startedAt = new Date();
    const base = {
      harvestId, startedAt, dateFrom: toDate(interval.from), dateTo: toDate(interval.to),
      cultivarSnapshot: cultivar as object, soilSnapshot: soil as object, engineVersion: ENGINE_VERSION,
      triggeredById, reason: options.reason ?? 'MANUAL', jobId: options.jobId ?? null,
    };

    if (interval.missingDates.length > 0) {
      const run = await msaRepository.createRun({ ...base, status: 'NEEDS_DATA', finishedAt: new Date(), missingDates: interval.missingDates });
      return { run: toRunView(run), phases: null, currentPhase: null };
    }

    const seed = options.seed ?? randomInt(0, MAX_SEED + 1);
    try {
      const result = runMonteCarlo(interval.days, cultivar, soil, {
        iterations: ITERATIONS, seed, altitude: soil.altitudeM, initialDepletion: 0,
      });
      const run = await msaRepository.createSucceededRun(
        { ...base, status: 'SUCCEEDED', finishedAt: new Date(), seed, iterations: result.iterations, sigmaPrecip: result.sigmaPrecip, sigmaTemp: result.sigmaTemp },
        dailyRows(result.baselineSeries),
        summaryRows(result),
      );
      const last = result.baselineSeries[result.baselineSeries.length - 1];
      return { run: toRunView(run), phases: run.phaseSummaries.map(toPhaseView), currentPhase: last?.phase ?? null };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const failed = await msaRepository.createRun({ ...base, status: 'FAILED', finishedAt: new Date(), seed, iterations: ITERATIONS, error: message });
      throw new AppError(500, 'MSA_PROCESSING_FAILED', `Falha no processamento (run ${failed.id}): ${message}`);
    }
}

export const msaService = {
  /** Inline (API): escopo do usuário e triggeredById preenchido. */
  async processHarvest(user: AuthUser, harvestId: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    const harvest = await accessibleHarvest(user, harvestId);
    return runProcessing(harvest, options, user.id);
  },

  /** Worker: o job já foi autorizado por quem o enfileirou; sem escopo, triggeredById nulo. */
  async processHarvestAsSystem(harvestId: string, options: ProcessOptions): Promise<ProcessResult> {
    const harvest = await msaRepository.findHarvestForProcessing(harvestId);
    if (!harvest) throw new AppError(404, 'NOT_FOUND', `Safra ${harvestId} não encontrada.`);
    return runProcessing(harvest, options, null);
  },

  async getLatest(user: AuthUser, harvestId: string): Promise<ProcessResult> {
    await accessibleHarvest(user, harvestId);
    const run = await msaRepository.latestSucceededRun(harvestId);
    if (!run) throw noResult();
    const daily = await msaRepository.dailyResults(run.id);
    const last = daily[daily.length - 1];
    return { run: toRunView(run), phases: run.phaseSummaries.map(toPhaseView), currentPhase: (last?.phase as Phase) ?? null };
  },

  async getDaily(user: AuthUser, harvestId: string, runId?: string) {
    await accessibleHarvest(user, harvestId);
    const run = runId ? await msaRepository.findRun(harvestId, runId) : await msaRepository.latestSucceededRun(harvestId);
    if (!run) throw runId ? new AppError(404, 'NOT_FOUND', 'Run não encontrada para esta safra.') : noResult();
    const rows = await msaRepository.dailyResults(run.id);
    return { runId: run.id, days: rows.map(({ runId: _r, date, ...rest }) => ({ date: toStr(date), ...rest })) };
  },

  async listRuns(user: AuthUser, harvestId: string): Promise<RunView[]> {
    await accessibleHarvest(user, harvestId);
    return (await msaRepository.listRuns(harvestId)).map(toRunView);
  },

  /** Cenários sobre uma run (padrão: a última SUCCEEDED); nada é persistido. */
  async decisionScenarios(
    user: AuthUser,
    harvestId: string,
    input: { phase: YieldPhase; doseBase: number; efficiencyBase: number; runId?: string },
  ): Promise<{ runId: string; scenarios: DecisionScenarios }> {
    await accessibleHarvest(user, harvestId);
    const run = input.runId ? await msaRepository.findRun(harvestId, input.runId) : await msaRepository.latestSucceededRun(harvestId);
    if (!run) throw input.runId ? new AppError(404, 'NOT_FOUND', 'Run não encontrada para esta safra.') : noResult();
    if (run.status !== 'SUCCEEDED') throw new AppError(422, 'RUN_WITHOUT_RESULTS', `A run ${run.id} não tem resultados (${run.status}).`);

    const summary = run.phaseSummaries.find((s) => s.phase === input.phase);
    if (!summary || summary.ksMeanP50 === null) {
      throw new AppError(422, 'PHASE_NOT_REACHED', `A janela ${input.phase} não foi alcançada nesta run.`);
    }
    const daily = await msaRepository.dailyResults(run.id);
    const baselineSeries = daily.map(({ runId: _r, date, phase, ...rest }) => ({ date: toStr(date), phase: phase as Phase, ...rest }));
    const scenarios = generateDecisionScenarios({
      phase: input.phase, ksP50: summary.ksMeanP50, baselineSeries,
      cultivar: run.cultivarSnapshot as unknown as CultivarParams,
      doseBase: input.doseBase, efficiencyBase: input.efficiencyBase,
    });
    return { runId: run.id, scenarios };
  },

  async recordDecision(
    user: AuthUser,
    harvestId: string,
    input: { phase: YieldPhase; scenario: MsaScenario; doseBase: number; efficiencyBase: number; justification: string; runId?: string },
  ): Promise<DecisionWithUser> {
    const { runId, scenarios } = await this.decisionScenarios(user, harvestId, input);
    const payload = input.scenario === 'A' ? scenarios.a : input.scenario === 'B' ? scenarios.b : scenarios.c;
    if (!payload) {
      throw new AppError(422, 'SCENARIO_UNAVAILABLE', scenarios.bUnavailableReason ?? 'Cenário indisponível para esta janela.');
    }
    return msaRepository.createDecision({
      harvestId, runId, phase: input.phase, scenario: input.scenario, doseBase: input.doseBase,
      efficiencyBase: input.efficiencyBase, scenarioPayload: payload as object, justification: input.justification, decidedById: user.id,
    });
  },

  async listDecisions(user: AuthUser, harvestId: string): Promise<DecisionWithUser[]> {
    await accessibleHarvest(user, harvestId);
    return msaRepository.listDecisions(harvestId);
  },
};

export type { MsaDecision };
