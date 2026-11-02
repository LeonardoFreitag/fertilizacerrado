/**
 * Orquestra o MSA por safra: era5.repository → engine → banco → API.
 * Run determinística (balanço diário + resumos por janela + índice do ciclo);
 * a predição de produtividade usa a Ym da safra no momento. `docs/modulos/msa.md`.
 */
import type { MsaRun, MsaRunReason } from '@prisma/client';
import { qmRepository, type QmCalibrationSummary } from '../admin-qm/qm.repository';
import { AppError } from '../../utils/app-error';
import { CULTIVAR_PARAM_KEYS } from '../cultivars/dtos/cultivar-params.schema';
import { harvestService } from '../harvests/harvest.service';
import type { AuthUser } from '../properties/property.service';
import {
  ENGINE_VERSION,
  cycleYieldIndex,
  dailyGDA,
  predictedYield,
  runDailyBalance,
  summarizeByPhase,
  type CultivarParams,
  type CycleYield,
  type DailyBalanceRow,
  type DailyWeather,
  type Phase,
  type PhaseSummary,
} from './engine';
import { era5Repository } from './era5.repository';
import {
  msaRepository,
  type DailyCreate,
  type HarvestForProcessing,
  type RunWithSummaries,
  type SummaryCreate,
} from './msa.repository';

/** Lag do ERA5-Land (~5 dias) com margem — o mesmo do ETL (`ingest --latest`). */
export const DATA_LAG_DAYS = 6;
/** Latossolo Vermelho do Cerrado (`docs/msa/algoritmos.md` §5). */
export const DEFAULT_SOIL = { thetaFC: 0.28, thetaWP: 0.12 } as const;
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
}

export interface ProcessOptions {
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
  /** Ym da safra no momento da run (sc/ha), ou null */
  expectedYield: number | null;
  /** Π_j [1 − Ky_j (1 − Ks̄_j)] sobre as janelas alcançadas; null em NEEDS_DATA/FAILED */
  yieldIndex: number | null;
  /** expectedYield × yieldIndex (sc/ha); null sem Ym */
  predictedYield: number | null;
  /** Janelas F1–F4 com dias na série (0–4) */
  phasesReached: number | null;
  engineVersion: string;
  cultivarSnapshot: unknown;
  soilSnapshot: unknown;
  missingDates: unknown;
  error: string | null;
  triggeredById: string | null;
  /** Calibração QM ativa da célula no momento do processamento (reprodutibilidade) */
  qmCalibrationId: string | null;
  qmCalibration: QmCalibrationSummary | null;
}

export interface ProcessResult {
  run: RunView;
  phases: PhaseView[] | null;
  currentPhase: Phase | null;
}

/** GET /msa: o último resultado mais o aviso de cultivar alterada desde a run. */
export interface LatestResult extends ProcessResult {
  /** true quando algum parâmetro científico da cultivar atual difere do cultivarSnapshot da run */
  cultivarChangedSinceRun: boolean;
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
    expectedYield: run.expectedYield,
    yieldIndex: run.yieldIndex,
    predictedYield: run.predictedYield,
    phasesReached: run.phasesReached,
    engineVersion: run.engineVersion,
    cultivarSnapshot: run.cultivarSnapshot,
    soilSnapshot: run.soilSnapshot,
    missingDates: run.missingDates,
    error: run.error,
    triggeredById: run.triggeredById,
    qmCalibrationId: run.qmCalibrationId,
    qmCalibration: null, // preenchido por withCalibration()
  };
}

async function runView(run: MsaRun): Promise<RunView> {
  return (await withCalibration([toRunView(run)]))[0]!;
}

/** Anexa o resumo da calibração (estação, anos, distância) às views. */
async function withCalibration<T extends { qmCalibrationId: string | null; qmCalibration: QmCalibrationSummary | null }>(views: T[]): Promise<T[]> {
  const ids = [...new Set(views.map((v) => v.qmCalibrationId).filter((id): id is string => !!id))];
  const summaries = new Map(await Promise.all(ids.map(async (id) => [id, await qmRepository.summaryById(id)] as const)));
  return views.map((v) => ({ ...v, qmCalibration: v.qmCalibrationId ? (summaries.get(v.qmCalibrationId) ?? null) : null }));
}

export function toPhaseView(s: RunWithSummaries['phaseSummaries'][number]): PhaseView {
  return {
    phase: s.phase,
    days: s.days,
    ksMean: s.ksMean,
    etcAdjAccum: s.etcAdjAccum,
    precipAccum: s.precipAccum,
    yieldReductionPct: s.yieldReductionPct,
  };
}

/**
 * A cultivar mudou desde a run? Itera sobre a união das chaves numéricas do
 * snapshot e da cultivar atual (não sobre uma lista fixa): chave ausente de um
 * lado conta como null, logo um parâmetro novo em `CultivarParams` (ex.: `tUpper`)
 * presente só na cultivar atual ou só no snapshot já conta como mudança.
 * Chaves de identificação (`id`, `name`, `crop`) e demais não numéricas são ignoradas.
 */
export function cultivarChangedSinceRun(snapshot: unknown, current: Record<string, unknown>): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const snap = snapshot as Record<string, unknown>;
  const numericOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const keys = new Set([...Object.keys(snap), ...Object.keys(current)]);
  for (const key of keys) {
    const before = numericOrNull(snap[key]);
    const now = numericOrNull(current[key]);
    if (before === null && now === null) continue; // não numérica dos dois lados (id, name, crop, datas…)
    if (before !== now) return true;
  }
  return false;
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

function summaryRows(summaries: PhaseSummary[]): SummaryCreate[] {
  return summaries.map((s) => ({
    phase: s.phase, days: s.days, ksMean: s.ksMean, etcAdjAccum: s.etcAdjAccum, precipAccum: s.precipAccum,
    yieldReductionPct: s.yieldReductionPct,
  }));
}

/** Campos da run derivados do índice do ciclo e da Ym da safra. */
export function yieldFields(cycle: CycleYield, expectedYield: number | null) {
  return {
    expectedYield,
    yieldIndex: cycle.yieldIndex,
    phasesReached: cycle.phasesReached,
    predictedYield: expectedYield === null ? null : predictedYield(expectedYield, cycle.yieldIndex),
  };
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
    const cell = await era5Repository.getCell(harvest.field.id);
    const calibration = cell ? await qmRepository.activeForCell(cell.cellLat, cell.cellLon) : null;
    const startedAt = new Date();
    const base = {
      harvestId, startedAt, dateFrom: toDate(interval.from), dateTo: toDate(interval.to),
      cultivarSnapshot: cultivar as object, soilSnapshot: soil as object, engineVersion: ENGINE_VERSION,
      triggeredById, reason: options.reason ?? 'MANUAL', jobId: options.jobId ?? null,
      qmCalibrationId: calibration?.id ?? null,
    };

    if (interval.missingDates.length > 0) {
      const run = await msaRepository.createRun({ ...base, status: 'NEEDS_DATA', finishedAt: new Date(), missingDates: interval.missingDates });
      return { run: await runView(run), phases: null, currentPhase: null };
    }

    try {
      const series = runDailyBalance(interval.days, cultivar, soil, { altitude: soil.altitudeM, initialDepletion: 0 });
      const summaries = summarizeByPhase(series, cultivar);
      const cycle = cycleYieldIndex(summaries);
      const run = await msaRepository.createSucceededRun(
        { ...base, status: 'SUCCEEDED', finishedAt: new Date(), ...yieldFields(cycle, harvest.expectedYield) },
        dailyRows(series),
        summaryRows(summaries),
      );
      const last = series[series.length - 1];
      return { run: await runView(run), phases: run.phaseSummaries.map(toPhaseView), currentPhase: last?.phase ?? null };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const failed = await msaRepository.createRun({ ...base, status: 'FAILED', finishedAt: new Date(), error: message });
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

  async getLatest(user: AuthUser, harvestId: string): Promise<LatestResult> {
    const harvest = await accessibleHarvest(user, harvestId);
    const run = await msaRepository.latestSucceededRun(harvestId);
    if (!run) throw noResult();
    const daily = await msaRepository.dailyResults(run.id);
    const last = daily[daily.length - 1];
    return {
      run: await runView(run),
      phases: run.phaseSummaries.map(toPhaseView),
      currentPhase: (last?.phase as Phase) ?? null,
      cultivarChangedSinceRun: cultivarChangedSinceRun(run.cultivarSnapshot, harvest.cultivar as unknown as Record<string, unknown>),
    };
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
    return withCalibration((await msaRepository.listRuns(harvestId)).map(toRunView));
  },
};
