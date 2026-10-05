/**
 * Tipos do motor agrometeorológico. Sem dependência de Prisma: um registro
 * `Cultivar` do banco satisfaz `CultivarParams` estruturalmente.
 *
 * Unidades: temperaturas em °C, pressões em kPa, radiação em MJ m⁻² dia⁻¹,
 * vento em m s⁻¹, lâminas de água em mm, Zr em m, GDA em °C·dia.
 */

/** Janela fenológica. `COMPLETED` = ciclo encerrado (GDA ≥ gdaTotal). */
export type Phase = 'F1' | 'F2' | 'F3' | 'F4' | 'COMPLETED';

/** Janelas com coeficiente Ky (as que entram no resumo de produtividade). */
export type YieldPhase = Exclude<Phase, 'COMPLETED'>;

export const YIELD_PHASES: readonly YieldPhase[] = ['F1', 'F2', 'F3', 'F4'];

/** Parâmetros da cultivar consumidos pelo motor (mesmos nomes do model Cultivar). */
export interface CultivarParams {
  /** Temperatura-base (°C) */
  tBase: number;
  /** GDA total do ciclo (°C·dia) */
  gdaTotal: number;
  /** GDA acumulado que encerra F1 */
  gdaF1End: number;
  /** GDA acumulado que encerra F2 (início de F3 = Zr máximo) */
  gdaF2End: number;
  /** GDA acumulado que encerra F3 */
  gdaF3End: number;
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  /** Fração de depleção permitida sem estresse (p) */
  depletionFraction: number;
  /** Profundidade radicular na emergência (m) */
  zrIni: number;
  /** Profundidade radicular máxima (m) */
  zrMax: number;
  kyF1: number;
  kyF2: number;
  kyF3: number;
  kyF4: number;
}

/** Propriedades físico-hídricas do solo (m³ m⁻³). */
export interface SoilParams {
  /** Umidade volumétrica na capacidade de campo */
  thetaFC: number;
  /** Umidade volumétrica no ponto de murcha permanente */
  thetaWP: number;
}

/** Entrada da ET₀ FAO-56 Penman-Monteith (Eq. 6). */
export interface ET0Input {
  tmax: number;
  tmin: number;
  /** Omitido → (tmax + tmin) / 2 (FAO-56, Eq. 9) */
  tmean?: number;
  /** Temperatura do ponto de orvalho (°C) → ea pela Eq. 14 */
  tdew: number;
  /** Velocidade do vento a 2 m (m s⁻¹) */
  u2: number;
  /** Saldo de radiação à superfície (MJ m⁻² dia⁻¹) */
  rn: number;
  /** Altitude (m) → pressão atmosférica (Eq. 7) e γ (Eq. 8) */
  altitude: number;
}

/** ET₀ com os intermediários da Eq. 6, para depuração e validação. */
export interface ET0Detail {
  et0: number;
  tmean: number;
  /** Pressão de vapor saturado média (kPa) */
  es: number;
  /** Pressão de vapor atual (kPa) */
  ea: number;
  /** Declividade da curva de pressão de vapor (kPa °C⁻¹) */
  delta: number;
  /** Pressão atmosférica (kPa) */
  pressure: number;
  /** Constante psicrométrica (kPa °C⁻¹) */
  gamma: number;
}

/** Clima diário de um talhão, como entregue pelo ETL ERA5-Land. */
export interface DailyWeather {
  /** Data-calendário YYYY-MM-DD */
  date: string;
  tmax: number;
  tmin: number;
  tmean?: number;
  tdew: number;
  u2: number;
  rn: number;
  /** Precipitação do dia (mm) */
  precipitation: number;
}

export interface BalanceOptions {
  /** Altitude do talhão (m) — obrigatória: entra em P e γ */
  altitude: number;
  /** Depleção inicial (mm). Padrão 0 = solo na capacidade de campo */
  initialDepletion?: number;
}

/** Uma linha do balanço hídrico diário. */
export interface DailyBalanceRow {
  date: string;
  phase: Phase;
  /** GDA do dia */
  gda: number;
  /** GDA acumulado ao fim do dia */
  gdaAccum: number;
  /** Profundidade radicular do dia (m) */
  zr: number;
  et0: number;
  kc: number;
  /** ETc = Kc · ET₀ */
  etc: number;
  precipitation: number;
  /** Depleção ao fim do dia (mm) */
  dr: number;
  /** Coeficiente de estresse, calculado com a depleção do início do dia */
  ks: number;
  /** ETc ajustada = Ks · ETc */
  etcAdj: number;
  taw: number;
  raw: number;
}

/** Resumo de uma janela fenológica (FAO-33). */
export interface PhaseSummary {
  phase: YieldPhase;
  days: number;
  /** Ks médio da janela; null se a janela não teve dias */
  ksMean: number | null;
  etcAdjAccum: number;
  precipAccum: number;
  /** Ky · (1 − Ks médio) × 100; null se a janela não teve dias */
  yieldReductionPct: number | null;
}

// ---------------------------------------------------------------------------
// Monte Carlo (`docs/msa/algoritmos.md` §7)
// ---------------------------------------------------------------------------

export interface MonteCarloOptions {
  /** Iterações (padrão 1000) */
  iterations?: number;
  /** Semente do PRNG — obrigatória; quem persistir o resultado deve gravá-la */
  seed: number;
  /** Desvio-padrão do fator multiplicativo da precipitação (padrão 0,30) */
  sigmaPrecip?: number;
  /** Desvio-padrão do deslocamento térmico, °C (padrão 0,6) */
  sigmaTemp?: number;
  altitude: number;
  initialDepletion?: number;
}

/** Percentis tipo 7 (interpolação linear; R `quantile` type 7 / NumPy `linear`). */
export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface PhasePercentiles {
  phase: YieldPhase;
  /** Iterações em que a janela teve dias; percentis calculados só sobre elas */
  validIterations: number;
  ksMean: Percentiles | null;
  yieldReductionPct: Percentiles | null;
  etcAdjAccum: Percentiles | null;
}

export interface MonteCarloResult {
  iterations: number;
  seed: number;
  sigmaPrecip: number;
  sigmaTemp: number;
  /** Resumo por janela sem perturbação */
  baseline: PhaseSummary[];
  /** Balanço diário sem perturbação — entrada do cenário de parcelamento */
  baselineSeries: DailyBalanceRow[];
  phases: PhasePercentiles[];
}

// ---------------------------------------------------------------------------
// Cenários de decisão (`docs/msa/algoritmos.md` §8)
// ---------------------------------------------------------------------------

export interface DecisionInput {
  /** Janela atual ou recém-encerrada */
  phase: YieldPhase;
  /** P50 do Ks médio da janela (Monte Carlo) */
  ksP50: number;
  baselineSeries: ReadonlyArray<DailyBalanceRow>;
  cultivar: CultivarParams;
  /** Dose planejada do insumo (unidade do técnico, ex.: kg/ha) */
  doseBase: number;
  /** Eficiência de uso do nutriente planejada (0–1) */
  efficiencyBase: number;
}

/** (a) Redução de dose proporcional ao Ks mediano. */
export interface ScenarioA {
  doseBase: number;
  ksP50: number;
  doseAdjusted: number;
  reductionPct: number;
  rationale: string;
}

/** (b) Parcelamento pela razão de ETc das duas metades da janela seguinte. */
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

/** (c) Fator de eficiência proporcional ao Ks mediano. */
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
  /** Preenchido quando `b` é null */
  bUnavailableReason: string | null;
  c: ScenarioC;
}
