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
// Índice de produtividade do ciclo (`docs/msa/algoritmos.md` §6)
// ---------------------------------------------------------------------------

/** Combinação multiplicativa das janelas (FAO-33) — resultado de `cycleYieldIndex`. */
export interface CycleYield {
  /** Π_j (1 − Ky_j · (1 − Ks̄_j)) sobre as janelas alcançadas; em [0, 1] */
  yieldIndex: number;
  /** Janelas com dias na série (0–4); janela não alcançada entra com fator 1 */
  phasesReached: number;
  /** Fator de cada janela F1–F4 (1 quando não alcançada) */
  factors: [number, number, number, number];
}
