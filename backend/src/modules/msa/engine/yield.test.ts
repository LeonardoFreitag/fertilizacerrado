import { describe, expect, it } from 'vitest';
import { LATOSSOLO, SOJA } from './test-fixtures';
import type { DailyWeather } from './types';
import { runDailyBalance } from './water-balance';
import { summarizeByPhase, yieldReduction } from './yield';

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
