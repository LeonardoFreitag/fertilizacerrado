import { describe, expect, it } from 'vitest';
import { computeMetrics, meetsCriteria } from './metrics';

describe('computeMetrics (validacao.md)', () => {
  const observed = [3.1, 4.2, 5.0, 3.8, 4.6];

  it('séries idênticas: RMSE 0, R² 1, NSE 1, PBIAS 0', () => {
    const m = computeMetrics(observed, observed);
    expect(m.rmse).toBe(0);
    expect(m.r2).toBeCloseTo(1, 10);
    expect(m.nse).toBe(1);
    expect(m.pbias).toBe(0);
    expect(meetsCriteria(m)).toEqual({ rmse: true, r2: true, nse: true, pbias: true });
  });

  it('viés constante de +0,5: RMSE 0,5, R² 1, PBIAS negativo, NSE < 1', () => {
    const m = computeMetrics(observed.map((o) => o + 0.5), observed);
    expect(m.rmse).toBeCloseTo(0.5, 10);
    expect(m.r2).toBeCloseTo(1, 10);
    expect(m.pbias).toBeLessThan(0);
    expect(m.pbias).toBeCloseTo((-0.5 * 5) / observed.reduce((a, b) => a + b, 0) * 100, 10);
    expect(m.nse).toBeLessThan(1);
  });

  it('R² e NSE ficam NaN com série constante', () => {
    const m = computeMetrics([1, 1, 1], [2, 2, 2]);
    expect(Number.isNaN(m.r2)).toBe(true);
    expect(Number.isNaN(m.nse)).toBe(true);
    expect(m.rmse).toBe(1);
  });

  it('rejeita séries de tamanhos diferentes ou vazias', () => {
    expect(() => computeMetrics([1], [1, 2])).toThrow(RangeError);
    expect(() => computeMetrics([], [])).toThrow(RangeError);
  });
});
