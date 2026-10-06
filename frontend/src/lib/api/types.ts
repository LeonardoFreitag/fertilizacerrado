/** Espelho das respostas da API (backend/src/modules/*). */
import type { Point, Polygon } from 'geojson';

export type Role = 'ADMIN' | 'AGRONOMO' | 'PRODUTOR';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  AGRONOMO: 'Agrônomo',
  PRODUTOR: 'Produtor',
};

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface UserDirectoryEntry extends UserSummary {
  role: Role;
}

/** Visão administrativa (ADMIN e o próprio usuário) */
export interface UserAdminView extends UserDirectoryEntry {
  active: boolean;
  emailVerified: boolean;
  phone: string | null;
  crea: string | null;
  document: string | null;
  createdAt: string;
}

export interface UsersPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, 'ADMIN'>;
  personType: 'PF' | 'PJ';
  cpf?: string;
  cnpj?: string;
  crea?: string;
  phone?: string;
}

export interface PropertyResponse {
  id: string;
  name: string;
  state: string;
  city: string;
  car: string | null;
  nirf: string | null;
  ownerId: string;
  agronomistId: string | null;
  owner: UserSummary;
  agronomist: UserSummary | null;
  fieldsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyPayload {
  name: string;
  state: string;
  city: string;
  car?: string;
  nirf?: string;
  ownerId?: string;
}

export interface FieldResponse {
  id: string;
  name: string;
  propertyId: string;
  areaHa: number;
  geometry: Polygon;
  centroid: Point;
  soilType: string | null;
  notes: string | null;
  altitudeM: number | null;
  thetaFC: number | null;
  thetaWP: number | null;
  era5Cell: { lat: number; lon: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldPayload {
  name: string;
  geometry?: Polygon;
  areaHa?: number;
  soilType?: string;
  notes?: string;
  altitudeM?: number;
  thetaFC?: number;
  thetaWP?: number;
}

export interface SchedulerView {
  nextRun: string | null;
  pattern: string | null;
  tz: string | null;
}

export interface QueueCounts {
  queues: Record<string, Record<string, number>>;
  weekly: SchedulerView;
  annual: SchedulerView;
}

// --- cultivares, safras e MSA --------------------------------------------------

export type Crop = 'SOJA' | 'MILHO';
export const CROP_LABELS: Record<Crop, string> = { SOJA: 'Soja', MILHO: 'Milho' };

export const CULTIVAR_PARAM_KEYS = [
  'tBase', 'gdaTotal', 'gdaF1End', 'gdaF2End', 'gdaF3End',
  'kcIni', 'kcMid', 'kcEnd',
  'depletionFraction', 'zrIni', 'zrMax',
  'kyF1', 'kyF2', 'kyF3', 'kyF4',
] as const;
export type CultivarParamKey = (typeof CULTIVAR_PARAM_KEYS)[number];
export type CultivarParams = Record<CultivarParamKey, number>;

export interface CultivarResponse extends CultivarParams {
  id: string;
  name: string;
  crop: Crop;
  cycleDescription: string | null;
  isDefault: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CultivarPayload = Partial<CultivarParams> & { name?: string; crop?: Crop; cycleDescription?: string | null };

export type HarvestStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export const HARVEST_STATUS_LABELS: Record<HarvestStatus, string> = { ACTIVE: 'Ativa', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' };

export interface HarvestResponse {
  /** Só na criação */
  msaJobId?: string | null;
  id: string;
  fieldId: string;
  cultivarId: string;
  emergenceDate: string;
  season: string;
  status: HarvestStatus;
  notes: string | null;
  field: { id: string; name: string; propertyId: string };
  cultivar: { id: string; name: string; crop: Crop };
  createdAt: string;
  updatedAt: string;
}

export interface HarvestPayload {
  fieldId: string;
  cultivarId: string;
  emergenceDate: string;
  season: string;
  notes?: string;
}

export type Phase = 'F1' | 'F2' | 'F3' | 'F4' | 'COMPLETED';
export type YieldPhase = Exclude<Phase, 'COMPLETED'>;
export const YIELD_PHASES: YieldPhase[] = ['F1', 'F2', 'F3', 'F4'];
export const PHASE_LABELS: Record<Phase, string> = {
  F1: 'F1 — Germinação/estabelecimento',
  F2: 'F2 — Crescimento vegetativo',
  F3: 'F3 — Floração/enchimento',
  F4: 'F4 — Maturação',
  COMPLETED: 'Ciclo encerrado',
};

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface PhaseView {
  phase: YieldPhase;
  days: number;
  ksMean: number | null;
  etcAdjAccum: number;
  precipAccum: number;
  yieldReductionPct: number | null;
  validIterations: number;
  percentiles: {
    ksMean: Percentiles | null;
    yieldReductionPct: Percentiles | null;
    etcAdjAccum: Percentiles | null;
  };
}

export type MsaRunStatus = 'SUCCEEDED' | 'FAILED' | 'NEEDS_DATA';
export type MsaRunReason = 'WEEKLY' | 'BACKFILL' | 'MANUAL';
export const RUN_REASON_LABELS: Record<MsaRunReason, string> = { WEEKLY: 'Semanal', BACKFILL: 'Criação da safra', MANUAL: 'Manual' };

export interface RunView {
  id: string;
  harvestId: string;
  status: MsaRunStatus;
  reason: MsaRunReason;
  jobId: string | null;
  startedAt: string;
  finishedAt: string;
  dateFrom: string;
  dateTo: string;
  seed: number | null;
  iterations: number | null;
  sigmaPrecip: number | null;
  sigmaTemp: number | null;
  engineVersion: string;
  cultivarSnapshot: unknown;
  soilSnapshot: unknown;
  missingDates: string[] | null;
  error: string | null;
  triggeredById: string | null;
  qmCalibrationId: string | null;
  qmCalibration: QmCalibrationSummary | null;
}

export interface QmCalibrationSummary {
  id: string;
  stationCode: string;
  stationName: string;
  years: number;
  distanceKm: number;
  periodFrom: string;
  periodTo: string;
  method: string;
}

export interface QmCalibrationView extends QmCalibrationSummary {
  cellLat: number;
  cellLon: number;
  variable: string;
  active: boolean;
  createdAt: string;
}

export interface WeatherStation {
  code: string;
  name: string;
  source: 'INMET' | 'ANA' | 'OUTRA';
  lat: number;
  lon: number;
  altitudeM: number | null;
  active: boolean;
  obsCount: number;
  obsFrom: string | null;
  obsTo: string | null;
}

export interface MsaLatest {
  run: RunView;
  phases: PhaseView[] | null;
  currentPhase: Phase | null;
}

export interface DailyRow {
  date: string;
  phase: Phase;
  gda: number;
  gdaAccum: number;
  zr: number;
  et0: number;
  kc: number;
  etc: number;
  precipitation: number;
  dr: number;
  ks: number;
  etcAdj: number;
  taw: number;
  raw: number;
}

export interface DailySeries {
  runId: string;
  days: DailyRow[];
}

export type ScenarioCode = 'A' | 'B' | 'C';

export interface ScenarioA {
  doseBase: number;
  ksP50: number;
  doseAdjusted: number;
  reductionPct: number;
  rationale: string;
}
export interface ScenarioB {
  nextPhase: YieldPhase;
  days1: number;
  days2: number;
  etc1: number;
  etc2: number;
  fraction1: number;
  fraction2: number;
  dose1: number;
  dose2: number;
  rationale: string;
}
export interface ScenarioC {
  efficiencyBase: number;
  ksP50: number;
  efficiencyAdjusted: number;
  rationale: string;
}
export interface DecisionScenarios {
  phase: YieldPhase;
  ksP50: number;
  a: ScenarioA;
  b: ScenarioB | null;
  bUnavailableReason: string | null;
  c: ScenarioC;
}

/** Resposta de GET /msa/decision */
export interface DecisionScenariosResponse {
  runId: string;
  scenarios: DecisionScenarios;
}

export interface DecisionView {
  id: string;
  harvestId: string;
  runId: string;
  phase: YieldPhase;
  scenario: ScenarioCode;
  doseBase: number;
  efficiencyBase: number;
  justification: string;
  scenarioPayload: unknown;
  decidedById: string;
  decidedBy: UserSummary;
  createdAt: string;
}

export interface RecordDecisionPayload {
  phase: YieldPhase;
  scenario: ScenarioCode;
  doseBase: number;
  efficiencyBase: number;
  justification: string;
  runId?: string;
}

export interface EnqueuedJob {
  jobId: string;
  queue: string;
  status?: string;
  count?: number;
  jobs?: { jobId: string; queue: string }[];
}

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'waiting-children' | 'prioritized' | 'unknown';

export interface JobView {
  id: string;
  queue: string;
  name: string;
  state: JobState;
  data: unknown;
  progress: unknown;
  attemptsMade: number;
  failedReason: string | null;
  returnvalue: unknown;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}
