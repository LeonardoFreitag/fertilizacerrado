/**
 * Tipos do motor agrometeorológico. Sem dependência de Prisma: um registro
 * `Cultivar` do banco satisfaz `CultivarParams` estruturalmente.
 *
 * Unidades: temperaturas em °C, pressões em kPa, radiação em MJ m⁻² dia⁻¹,
 * vento em m s⁻¹, lâminas de água em mm, Zr em m, GDA em °C·dia.
 */

/**
 * Fase do dia no balanço. `PRE` = entressafra (spin-up antes da emergência, sem
 * cultura); F1–F4 = janelas fenológicas; `COMPLETED` = ciclo encerrado (GDA ≥ gdaTotal).
 */
export type Phase = 'PRE' | 'F1' | 'F2' | 'F3' | 'F4' | 'COMPLETED';

/** Fases com cultura (o que `phaseFromGDA` devolve; `kcForPhase` e `rootDepth` só aceitam estas). */
export type CropPhase = Exclude<Phase, 'PRE'>;

/** Janelas com coeficiente Ky (as que entram no resumo de produtividade). */
export type YieldPhase = Exclude<CropPhase, 'COMPLETED'>;

export const YIELD_PHASES: readonly YieldPhase[] = ['F1', 'F2', 'F3', 'F4'];

/** Parâmetros da cultivar consumidos pelo motor (mesmos nomes do model Cultivar). */
export interface CultivarParams {
  /** Temperatura-base inferior Tb (°C) */
  tBase: number;
  /** Temperatura-base superior TB (°C) do método de Ometto; null = sem limite superior (casos 1–3) */
  tUpper: number | null;
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

/** Entressafra (spin-up) antes da emergência: dias com `date < until` não têm cultura. */
export interface PreSeasonOptions {
  /** Data de emergência (AAAA-MM-DD): primeiro dia com cultura */
  until: string;
  /** Kc constante da entressafra (solo com palhada); padrão 1,0 = ETP direta (Thornthwaite-Mather) */
  kc: number;
  /** Profundidade do perfil balanceado na entressafra (m); zrMax ou zrIni da cultivar */
  zr: number;
}

export interface BalanceOptions {
  /** Altitude do talhão (m) — obrigatória: entra em P e γ */
  altitude: number;
  /** Depleção inicial (mm) no primeiro dia da série (o início do spin-up quando há preSeason). Padrão 0 = capacidade de campo */
  initialDepletion?: number;
  /** Segmento de entressafra antes da emergência; omitido = série começa na emergência */
  preSeason?: PreSeasonOptions;
}

/** Uma linha do balanço hídrico diário (dias `PRE` têm gda e gdaAccum 0 e Zr/Kc da entressafra). */
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

// ---------------------------------------------------------------------------
// Eventos de estresse, atribuição de perda e severidades (`docs/msa/algoritmos.md` §6.5 e §7)
// ---------------------------------------------------------------------------

/** Parâmetros da detecção de eventos (do ambiente: STRESS_KS_THRESHOLD / STRESS_MIN_DAYS; gravados na run). */
export interface StressParams {
  /** Dia de estresse quando `ks < ksThreshold` (estrito); em (0, 1] */
  ksThreshold: number;
  /** Duração mínima (dias consecutivos) para a sequência virar evento; inteiro ≥ 1 */
  minDays: number;
}

/** Episódio contíguo de dias de cultura com Ks abaixo do limiar (não é dividido na fronteira de janela). */
export interface StressEvent {
  /** Primeiro e último dia (AAAA-MM-DD) */
  start: string;
  end: string;
  days: number;
  ksMin: number;
  ksMean: number;
  /** Σ (ETc − ETc_adj) dos dias do evento: a água que a cultura deixou de transpirar (mm) */
  deficitMm: number;
  /** Janelas atravessadas, em ordem, com os dias em cada uma */
  phases: { phase: YieldPhase; days: number }[];
  /** Janela com mais dias (empate → maior Ky) */
  dominantPhase: YieldPhase;
  /** Ky da janela dominante (para ordenar eventos por `deficitMm × kyDominant` sem conhecer a cultivar) */
  kyDominant: number;
}

/** Perda atribuída a uma janela pela decomposição sequencial do índice do ciclo. */
export interface YieldLossPhase {
  phase: YieldPhase;
  /** Fator da janela (1 − Ky (1 − Ks̄); 1 quando não alcançada) */
  factor: number;
  /** (Π_{k<j} f_k)(1 − f_j) × 100 */
  lossPct: number;
  /** ym × lossPct / 100 (sc/ha); null sem Ym */
  lossScHa: number | null;
}

/** Resultado de `attributeYieldLoss`: Σ lossScHa = ym − predictedYield (soma telescópica). */
export interface YieldLossAttribution {
  ym: number | null;
  yieldIndex: number;
  predictedYield: number | null;
  totalLossScHa: number | null;
  /** (1 − yieldIndex) × 100 */
  totalLossPct: number;
  phases: [YieldLossPhase, YieldLossPhase, YieldLossPhase, YieldLossPhase];
}

/** Severidade exibida no painel: da janela (por perda) e do dia (por Ks). */
export type Severity = 'ok' | 'warning' | 'critical' | 'pending';
