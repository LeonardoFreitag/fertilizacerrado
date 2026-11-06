import { describe, expect, it } from 'vitest';
import { LATOSSOLO, SOJA } from './test-fixtures';
import type { DailyWeather } from './types';
import { runDailyBalance } from './water-balance';
import { ENGINE_VERSION } from './index';
import type { PhaseSummary, YieldPhase } from './types';
import { cycleYieldIndex, predictedYield, summarizeByPhase, yieldReduction } from './yield';

describe('yieldReduction (FAO-33 Eq. 3.2)', () => {
  it('é zero sem estresse, qualquer Ky', () => {
    expect(yieldReduction(1, 0.2)).toBe(0);
    expect(yieldReduction(1, 1.5)).toBe(0);
  });

  it('é Ky · (1 − Ks médio)', () => {
    expect(yieldReduction(0.7, 1.0)).toBeCloseTo(0.3, 10);
    expect(yieldReduction(0.5, 0.4)).toBeCloseTo(0.2, 10);
  });

  it('fica em [0, 1]', () => {
    expect(yieldReduction(0, 1.5)).toBe(1);
    expect(yieldReduction(1.2, 1)).toBe(0);
  });
});

describe('summarizeByPhase', () => {
  const days: DailyWeather[] = Array.from({ length: 45 }, (_, i) => ({
    date: `2025-11-${String(10 + (i % 20)).padStart(2, '0')}`,
    tmax: 30,
    tmin: 20, // GDA 15/dia → F1 até dia 8, F2 até dia 30, F3 a partir do 30
    tdew: 18,
    u2: 2,
    rn: 14,
    precipitation: i % 7 === 0 ? 10 : 0,
  }));

  it('resume F1–F3 e marca F4 como não alcançada', () => {
    const series = runDailyBalance(days, SOJA, LATOSSOLO, { altitude: 750 });
    const summary = summarizeByPhase(series, SOJA);

    expect(summary.map((s) => s.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(summary.map((s) => s.days)).toEqual([7, 22, 16, 0]);
    expect(summary.reduce((acc, s) => acc + s.days, 0)).toBe(45);

    for (const s of summary.slice(0, 3)) {
      const rows = series.filter((r) => r.phase === s.phase);
      const ksMean = rows.reduce((acc, r) => acc + r.ks, 0) / rows.length;
      expect(s.ksMean).toBeCloseTo(ksMean, 10);
      expect(s.etcAdjAccum).toBeCloseTo(rows.reduce((acc, r) => acc + r.etcAdj, 0), 10);
      expect(s.precipAccum).toBeCloseTo(rows.reduce((acc, r) => acc + r.precipitation, 0), 10);
    }

    const f3 = summary[2]!;
    expect(f3.yieldReductionPct).toBeCloseTo(SOJA.kyF3 * (1 - f3.ksMean!) * 100, 10);

    const f4 = summary[3]!;
    expect(f4.days).toBe(0);
    expect(f4.ksMean).toBeNull();
    expect(f4.yieldReductionPct).toBeNull();
    expect(f4.etcAdjAccum).toBe(0);
  });

  it('ignora dias COMPLETED', () => {
    const long = Array.from({ length: 100 }, (_, i) => ({ ...days[0]!, precipitation: i % 3 === 0 ? 15 : 0 }));
    const series = runDailyBalance(long, SOJA, LATOSSOLO, { altitude: 750 });
    const completed = series.filter((r) => r.phase === 'COMPLETED').length;
    expect(completed).toBeGreaterThan(0);
    expect(summarizeByPhase(series, SOJA).reduce((acc, s) => acc + s.days, 0)).toBe(100 - completed);
  });

  it('série vazia devolve quatro janelas vazias', () => {
    expect(summarizeByPhase([], SOJA)).toEqual(
      ['F1', 'F2', 'F3', 'F4'].map((phase) => ({
        phase,
        days: 0,
        ksMean: null,
        etcAdjAccum: 0,
        precipAccum: 0,
        yieldReductionPct: null,
      })),
    );
  });
});

/** Resumo sintético: `ks` nulo ⇒ janela não alcançada. */
function phase(p: YieldPhase, ks: number | null, ky: number): PhaseSummary {
  return {
    phase: p,
    days: ks === null ? 0 : 10,
    ksMean: ks,
    etcAdjAccum: 0,
    precipAccum: 0,
    yieldReductionPct: ks === null ? null : yieldReduction(ks, ky) * 100,
  };
}

describe('cycleYieldIndex (FAO-33, combinação multiplicativa)', () => {
  const SOJA_KY: Record<YieldPhase, number> = { F1: 0.2, F2: 0.8, F3: 1.0, F4: 0.4 };
  const all = (ks: Partial<Record<YieldPhase, number | null>>) =>
    (['F1', 'F2', 'F3', 'F4'] as const).map((p) => phase(p, ks[p] === undefined ? 1 : ks[p]!, SOJA_KY[p]));

  it('sem estresse ⇒ índice 1, quatro janelas', () => {
    expect(cycleYieldIndex(all({}))).toEqual({ yieldIndex: 1, phasesReached: 4, factors: [1, 1, 1, 1] });
  });

  it('estresse só na floração (Ks̄ 0,70, Ky 1,0) ⇒ 0,70', () => {
    expect(cycleYieldIndex(all({ F3: 0.7 })).yieldIndex).toBeCloseTo(0.7, 9);
  });

  it('F2 0,90/Ky 0,8 e F3 0,80/Ky 1,0 ⇒ 0,92 × 0,80 = 0,736', () => {
    const r = cycleYieldIndex(all({ F2: 0.9, F3: 0.8 }));
    expect(r.factors[0]).toBeCloseTo(1, 9);
    expect(r.factors[1]).toBeCloseTo(0.92, 9);
    expect(r.factors[2]).toBeCloseTo(0.8, 9);
    expect(r.factors[3]).toBeCloseTo(1, 9);
    expect(r.yieldIndex).toBeCloseTo(0.736, 9);
    expect(r.phasesReached).toBe(4);
  });

  it('janela não alcançada entra com fator 1 e reduz phasesReached', () => {
    const r = cycleYieldIndex(all({ F1: 0.95, F2: 0.9, F3: null, F4: null }));
    expect(r.factors[2]).toBe(1);
    expect(r.factors[3]).toBe(1);
    expect(r.phasesReached).toBe(2);
    expect(r.yieldIndex).toBeCloseTo((1 - 0.2 * 0.05) * (1 - 0.8 * 0.1), 9);
  });

  it('aceita os resumos em qualquer ordem e exige as quatro janelas', () => {
    expect(cycleYieldIndex([...all({ F3: 0.7 })].reverse()).yieldIndex).toBeCloseTo(0.7, 9);
    expect(() => cycleYieldIndex(all({}).slice(0, 3))).toThrow(RangeError);
  });

  it('série real: índice coerente com os resumos de summarizeByPhase', () => {
    const days: DailyWeather[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2025-11-${String(1 + (i % 28)).padStart(2, '0')}`, tmax: 32, tmin: 20, tdew: 16, u2: 2, rn: 16,
      precipitation: i % 9 === 0 ? 12 : 0,
    }));
    const summary = summarizeByPhase(runDailyBalance(days, SOJA, LATOSSOLO, { altitude: 750 }), SOJA);
    const r = cycleYieldIndex(summary);
    const expected = summary.reduce((acc, s) => acc * (s.days > 0 ? 1 - s.yieldReductionPct! / 100 : 1), 1);
    expect(r.yieldIndex).toBeCloseTo(expected, 12);
    expect(r.yieldIndex).toBeGreaterThanOrEqual(0);
    expect(r.yieldIndex).toBeLessThanOrEqual(1);
    expect(r.phasesReached).toBe(summary.filter((s) => s.days > 0).length);
  });
});

describe('predictedYield', () => {
  it('Ya = Ym × índice: predictedYield(65, 0,736) = 47,84', () => {
    expect(predictedYield(65, 0.736)).toBeCloseTo(47.84, 9);
    expect(predictedYield(65, 1)).toBe(65);
  });

  it('rejeita Ym ≤ 0 ou não finito e índice fora de [0, 1]', () => {
    expect(() => predictedYield(0, 0.9)).toThrow(RangeError);
    expect(() => predictedYield(-5, 0.9)).toThrow(RangeError);
    expect(() => predictedYield(NaN, 0.9)).toThrow(RangeError);
    expect(() => predictedYield(65, 1.2)).toThrow(RangeError);
    expect(() => predictedYield(65, -0.1)).toThrow(RangeError);
  });
});

describe('versão do motor', () => {
  it('é 2.1.0 (graus-dia de Ometto; interface compatível)', () => {
    expect(ENGINE_VERSION).toBe('2.1.0');
  });
});
