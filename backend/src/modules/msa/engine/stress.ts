/**
 * Eventos de estresse hídrico, atribuição da perda de produtividade por janela
 * e severidades (`docs/msa/algoritmos.md` §6.5 e §7).
 *
 * - Um **evento** é uma sequência contígua de dias de cultura (F1–F4) com
 *   `ks < ksThreshold` que dura ao menos `minDays`; não é dividido quando cruza
 *   a fronteira entre janelas (um veranico é um só episódio para quem está no campo).
 * - A **perda por janela** decompõe `Ym − Ya` em ordem do ciclo:
 *   `loss_j = Ym · (Π_{k<j} f_k)(1 − f_j)`, com `f_j` os fatores de `cycleYieldIndex`;
 *   a soma é telescópica e fecha exatamente em `Ym (1 − índice)`.
 * - **Severidade** da janela pela perda (`LOSS_WARNING_PCT`/`LOSS_CRITICAL_PCT`) e
 *   do dia pelo Ks (`KS_OK`/`KS_WARNING`). Os valores são convenção
 *   (`docs/msa/questoes-abertas.md` #4 e #14) e estão espelhados em
 *   `frontend/src/lib/msa/msa.ts`.
 */
import type {
  CultivarParams,
  DailyBalanceRow,
  PhaseSummary,
  Severity,
  StressEvent,
  StressParams,
  YieldLossAttribution,
  YieldLossPhase,
  YieldPhase,
} from './types';
import { YIELD_PHASES } from './types';
import { cycleYieldIndex } from './yield';

/** Perda da janela (%) a partir da qual ela fica "atenção" (inclusive). */
export const LOSS_WARNING_PCT = 5;
/** Perda da janela (%) acima da qual ela fica "crítico" (exclusivo). */
export const LOSS_CRITICAL_PCT = 15;
/** Ks diário ≥ KS_OK: sem estresse relevante. */
export const KS_OK = 0.85;
/** Ks diário em [KS_WARNING, KS_OK): atenção; abaixo: crítico. */
export const KS_WARNING = 0.7;

export function kyOf(phase: YieldPhase, cultivar: CultivarParams): number {
  switch (phase) {
    case 'F1':
      return cultivar.kyF1;
    case 'F2':
      return cultivar.kyF2;
    case 'F3':
      return cultivar.kyF3;
    case 'F4':
      return cultivar.kyF4;
  }
}

function isYieldPhase(phase: string): phase is YieldPhase {
  return (YIELD_PHASES as readonly string[]).includes(phase);
}

/**
 * Detecta os eventos de estresse da série (§7). Dias `PRE` e `COMPLETED` não
 * contam nem conectam sequências. Lança `RangeError` para parâmetros inválidos.
 */
export function detectStressEvents(
  series: ReadonlyArray<DailyBalanceRow>,
  cultivar: CultivarParams,
  params: StressParams,
): StressEvent[] {
  const { ksThreshold, minDays } = params;
  if (!Number.isFinite(ksThreshold) || ksThreshold <= 0 || ksThreshold > 1) {
    throw new RangeError(`ksThreshold deve estar em (0, 1]: ${ksThreshold}`);
  }
  if (!Number.isInteger(minDays) || minDays < 1) {
    throw new RangeError(`minDays deve ser inteiro ≥ 1: ${minDays}`);
  }

  const events: StressEvent[] = [];
  let runStart = -1;

  const flush = (endExclusive: number) => {
    if (runStart < 0) return;
    const length = endExclusive - runStart;
    if (length >= minDays) events.push(buildEvent(series, runStart, endExclusive, cultivar));
    runStart = -1;
  };

  for (let i = 0; i < series.length; i++) {
    const row = series[i]!;
    const stressed = isYieldPhase(row.phase) && row.ks < ksThreshold;
    if (stressed) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(series.length);
  return events;
}

function buildEvent(series: ReadonlyArray<DailyBalanceRow>, from: number, to: number, cultivar: CultivarParams): StressEvent {
  const counts = new Map<YieldPhase, number>();
  let ksMin = Infinity;
  let ksSum = 0;
  let deficit = 0;
  for (let i = from; i < to; i++) {
    const row = series[i]!;
    const phase = row.phase as YieldPhase;
    counts.set(phase, (counts.get(phase) ?? 0) + 1);
    if (row.ks < ksMin) ksMin = row.ks;
    ksSum += row.ks;
    deficit += row.etc - row.etcAdj;
  }
  const phases = YIELD_PHASES.filter((p) => counts.has(p)).map((p) => ({ phase: p, days: counts.get(p)! }));
  let dominant = phases[0]!;
  for (const p of phases.slice(1)) {
    if (p.days > dominant.days || (p.days === dominant.days && kyOf(p.phase, cultivar) > kyOf(dominant.phase, cultivar))) {
      dominant = p;
    }
  }
  const days = to - from;
  return {
    start: series[from]!.date,
    end: series[to - 1]!.date,
    days,
    ksMin,
    ksMean: ksSum / days,
    deficitMm: deficit < 0 ? 0 : deficit,
    phases,
    dominantPhase: dominant.phase,
    kyDominant: kyOf(dominant.phase, cultivar),
  };
}

/**
 * Atribuição sequencial da perda por janela (§6.5): `lossPct_j = (Π_{k<j} f_k)(1 − f_j) × 100`,
 * `lossScHa_j = ym × lossPct_j / 100`. Com `ym` nulo só os percentuais são devolvidos.
 */
export function attributeYieldLoss(summaries: ReadonlyArray<PhaseSummary>, ym: number | null): YieldLossAttribution {
  if (ym !== null && (!Number.isFinite(ym) || ym <= 0)) throw new RangeError(`ym deve ser finito e > 0 (ou null): ${ym}`);
  const cycle = cycleYieldIndex(summaries);
  let survived = 1;
  const phases = YIELD_PHASES.map((phase, j): YieldLossPhase => {
    const factor = cycle.factors[j]!;
    const lossPct = survived * (1 - factor) * 100;
    survived *= factor;
    return { phase, factor, lossPct, lossScHa: ym === null ? null : (ym * lossPct) / 100 };
  }) as YieldLossAttribution['phases'];
  const totalLossPct = (1 - cycle.yieldIndex) * 100;
  return {
    ym,
    yieldIndex: cycle.yieldIndex,
    predictedYield: ym === null ? null : ym * cycle.yieldIndex,
    totalLossScHa: ym === null ? null : (ym * totalLossPct) / 100,
    totalLossPct,
    phases,
  };
}

/** Severidade da janela pela redução potencial de produtividade (%); nulo = não alcançada. */
export function windowSeverity(yieldReductionPct: number | null | undefined): Severity {
  if (yieldReductionPct == null || Number.isNaN(yieldReductionPct)) return 'pending';
  if (yieldReductionPct < LOSS_WARNING_PCT) return 'ok';
  if (yieldReductionPct <= LOSS_CRITICAL_PCT) return 'warning';
  return 'critical';
}

/** Severidade do dia pelo Ks (gráficos e eventos). */
export function daySeverity(ks: number): Severity {
  if (ks >= KS_OK) return 'ok';
  if (ks >= KS_WARNING) return 'warning';
  return 'critical';
}
