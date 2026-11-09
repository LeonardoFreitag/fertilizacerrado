import { describe, expect, it } from 'vitest';
import {
  KS_OK,
  KS_WARNING,
  LOSS_CRITICAL_PCT,
  LOSS_WARNING_PCT,
  attributeYieldLoss,
  daySeverity,
  detectStressEvents,
  windowSeverity,
} from './stress';
import { SOJA } from './test-fixtures';
import type { DailyBalanceRow, Phase, PhaseSummary, YieldPhase } from './types';

const PARAMS = { ksThreshold: 0.7, minDays: 3 };

function row(date: string, phase: Phase, ks: number, etc = 5): DailyBalanceRow {
  return {
    date, phase, gda: 10, gdaAccum: 0, zr: 0.5, et0: etc, kc: 1, etc, precipitation: 0,
    dr: 0, ks, etcAdj: etc * ks, taw: 100, raw: 50,
  };
}

/** Série de dias consecutivos a partir de 2026-01-01 com fase e Ks dados por índice. */
function series(spec: Array<[Phase, number, number?]>): DailyBalanceRow[] {
  const out: DailyBalanceRow[] = [];
  let day = Date.UTC(2026, 0, 1);
  for (const [phase, ks, etc] of spec) {
    out.push(row(new Date(day).toISOString().slice(0, 10), phase, ks, etc));
    day += 86_400_000;
  }
  return out;
}

function repeat(phase: Phase, ks: number, n: number, etc?: number): Array<[Phase, number, number?]> {
  return Array.from({ length: n }, () => [phase, ks, etc]);
}

describe('detectStressEvents', () => {
  it('série sem estresse ⇒ nenhum evento', () => {
    const s = series([...repeat('F1', 1, 5), ...repeat('F2', 1, 10), ...repeat('F3', 0.9, 10)]);
    expect(detectStressEvents(s, SOJA, PARAMS)).toEqual([]);
  });

  it('cinco dias de F3 com Ks 0,6 ⇒ um evento com déficit Σ(etc − etcAdj)', () => {
    const s = series([...repeat('F2', 1, 3), ...repeat('F3', 0.6, 5, 4), ...repeat('F3', 1, 3)]);
    const events = detectStressEvents(s, SOJA, PARAMS);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.start).toBe('2026-01-04');
    expect(e.end).toBe('2026-01-08');
    expect(e.days).toBe(5);
    expect(e.dominantPhase).toBe('F3');
    expect(e.phases).toEqual([{ phase: 'F3', days: 5 }]);
    expect(e.ksMin).toBeCloseTo(0.6, 12);
    expect(e.ksMean).toBeCloseTo(0.6, 12);
    expect(e.deficitMm).toBeCloseTo(5 * (4 - 4 * 0.6), 9);
    expect(e.kyDominant).toBe(SOJA.kyF3);
  });

  it('dois dias abaixo do limiar ⇒ nenhum evento com minDays 3', () => {
    const s = series([...repeat('F2', 1, 3), ...repeat('F2', 0.5, 2), ...repeat('F2', 1, 3)]);
    expect(detectStressEvents(s, SOJA, PARAMS)).toEqual([]);
    expect(detectStressEvents(s, SOJA, { ksThreshold: 0.7, minDays: 2 })).toHaveLength(1);
  });

  it('evento que cruza a fronteira F2→F3 não é dividido; dominante é a de mais dias', () => {
    const s = series([...repeat('F2', 1, 2), ...repeat('F2', 0.5, 4), ...repeat('F3', 0.5, 3), ...repeat('F3', 1, 2)]);
    const events = detectStressEvents(s, SOJA, PARAMS);
    expect(events).toHaveLength(1);
    expect(events[0]!.days).toBe(7);
    expect(events[0]!.phases).toEqual([{ phase: 'F2', days: 4 }, { phase: 'F3', days: 3 }]);
    expect(events[0]!.dominantPhase).toBe('F2');
  });

  it('empate em dias ⇒ a janela de maior Ky (F3 1,0 > F2 0,8)', () => {
    const s = series([...repeat('F2', 0.5, 3), ...repeat('F3', 0.5, 3), ...repeat('F3', 1, 1)]);
    const [e] = detectStressEvents(s, SOJA, PARAMS);
    expect(e!.dominantPhase).toBe('F3');
    expect(e!.kyDominant).toBe(1);
  });

  it('dias PRE e COMPLETED não contam nem conectam', () => {
    const s = series([...repeat('PRE', 0.3, 10), ...repeat('F1', 0.5, 2), ...repeat('F1', 1, 1), ...repeat('F4', 0.5, 2), ...repeat('COMPLETED', 0.5, 5)]);
    expect(detectStressEvents(s, SOJA, PARAMS)).toEqual([]);
    const s2 = series([...repeat('PRE', 0.3, 10), ...repeat('F1', 0.5, 3)]);
    const [e] = detectStressEvents(s2, SOJA, PARAMS);
    expect(e!.start).toBe('2026-01-11');
    expect(e!.days).toBe(3);
  });

  it('dois eventos separados por um dia sem estresse', () => {
    const s = series([...repeat('F3', 0.5, 3), ...repeat('F3', 0.9, 1), ...repeat('F3', 0.6, 4)]);
    const events = detectStressEvents(s, SOJA, PARAMS);
    expect(events.map((e) => e.days)).toEqual([3, 4]);
  });

  it('limiar é estrito: Ks igual ao limiar não é estresse', () => {
    const s = series(repeat('F3', 0.7, 5));
    expect(detectStressEvents(s, SOJA, PARAMS)).toEqual([]);
  });

  it('parâmetros inválidos ⇒ RangeError', () => {
    const s = series(repeat('F3', 0.5, 5));
    expect(() => detectStressEvents(s, SOJA, { ksThreshold: 0, minDays: 3 })).toThrow(RangeError);
    expect(() => detectStressEvents(s, SOJA, { ksThreshold: 1.2, minDays: 3 })).toThrow(RangeError);
    expect(() => detectStressEvents(s, SOJA, { ksThreshold: 0.7, minDays: 0 })).toThrow(RangeError);
    expect(() => detectStressEvents(s, SOJA, { ksThreshold: 0.7, minDays: 2.5 })).toThrow(RangeError);
  });
});

function summary(phase: YieldPhase, reductionPct: number | null): PhaseSummary {
  return { phase, days: reductionPct === null ? 0 : 10, ksMean: reductionPct === null ? null : 1, etcAdjAccum: 0, precipAccum: 0, yieldReductionPct: reductionPct };
}

describe('attributeYieldLoss', () => {
  const canonical = [summary('F1', 0), summary('F2', 8), summary('F3', 20), summary('F4', 0)];

  it('exemplo canônico: f = [1; 0,92; 0,80; 1], Ym 65 ⇒ perdas [0; 5,2; 11,96; 0], total 17,16 = 65 − 47,84', () => {
    const r = attributeYieldLoss(canonical, 65);
    expect(r.phases.map((p) => p.factor)).toEqual([1, 0.92, 0.8, 1]);
    expect(r.phases.map((p) => p.lossScHa!)).toEqual([0, expect.closeTo(5.2, 9), expect.closeTo(11.96, 9), 0]);
    expect(r.totalLossScHa).toBeCloseTo(17.16, 9);
    expect(r.predictedYield).toBeCloseTo(47.84, 9);
    expect(r.totalLossScHa!).toBeCloseTo(65 - r.predictedYield!, 9);
    expect(r.yieldIndex).toBeCloseTo(0.736, 9);
    expect(r.totalLossPct).toBeCloseTo(26.4, 9);
  });

  it('quatro janelas estressadas: Σ perdas = Ym − predita (soma telescópica)', () => {
    const r = attributeYieldLoss([summary('F1', 4), summary('F2', 12), summary('F3', 35), summary('F4', 7)], 72);
    const sum = r.phases.reduce((acc, p) => acc + p.lossScHa!, 0);
    expect(sum).toBeCloseTo(72 - r.predictedYield!, 9);
    expect(r.phases.reduce((acc, p) => acc + p.lossPct, 0)).toBeCloseTo((1 - r.yieldIndex) * 100, 9);
  });

  it('sem Ym: percentuais calculados, sacas nulas', () => {
    const r = attributeYieldLoss(canonical, null);
    expect(r.ym).toBeNull();
    expect(r.predictedYield).toBeNull();
    expect(r.totalLossScHa).toBeNull();
    expect(r.phases.every((p) => p.lossScHa === null)).toBe(true);
    expect(r.phases[2]!.lossPct).toBeCloseTo(18.4, 9); // 0,92 × 0,20 × 100
    expect(r.totalLossPct).toBeCloseTo(26.4, 9);
  });

  it('janela não alcançada ⇒ fator 1 e perda 0', () => {
    const r = attributeYieldLoss([summary('F1', 0), summary('F2', 10), summary('F3', null), summary('F4', null)], 50);
    expect(r.phases[2]).toEqual({ phase: 'F3', factor: 1, lossPct: 0, lossScHa: 0 });
    expect(r.totalLossScHa).toBeCloseTo(5, 9);
  });

  it('Ym inválida ⇒ RangeError', () => {
    expect(() => attributeYieldLoss(canonical, 0)).toThrow(RangeError);
    expect(() => attributeYieldLoss(canonical, NaN)).toThrow(RangeError);
    expect(() => attributeYieldLoss(canonical, -5)).toThrow(RangeError);
  });
});

describe('severidades', () => {
  it('constantes de convenção (#4, #14)', () => {
    expect([LOSS_WARNING_PCT, LOSS_CRITICAL_PCT, KS_OK, KS_WARNING]).toEqual([5, 15, 0.85, 0.7]);
  });

  it('janela: 3 % ok, 10 % atenção, 20 % crítico; limites 5 e 15 são atenção; nulo pendente', () => {
    expect([3, 10, 20].map(windowSeverity)).toEqual(['ok', 'warning', 'critical']);
    expect([5, 15].map(windowSeverity)).toEqual(['warning', 'warning']);
    expect(windowSeverity(null)).toBe('pending');
    expect(windowSeverity(undefined)).toBe('pending');
    expect(windowSeverity(NaN)).toBe('pending');
  });

  it('dia: 0,9 ok, 0,75 atenção, 0,5 crítico', () => {
    expect([0.9, 0.75, 0.5].map(daySeverity)).toEqual(['ok', 'warning', 'critical']);
    expect(daySeverity(0.85)).toBe('ok');
    expect(daySeverity(0.7)).toBe('warning');
  });
});
