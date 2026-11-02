import { describe, expect, it } from 'vitest';
import { computeMetrics, meetsCriteria, relativeError } from './metrics';

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

describe('relativeError (Caso 2 — produtividade predita × observada)', () => {
  it('(predita − observada) / observada', () => {
    expect(relativeError(47.84, 52)).toBeCloseTo(-0.08, 9);
    expect(relativeError(52, 52)).toBe(0);
    expect(relativeError(57.2, 52)).toBeCloseTo(0.1, 9);
  });

  it('observado ≤ 0 ou não finito ⇒ RangeError', () => {
    expect(() => relativeError(47.84, 0)).toThrow(RangeError);
    expect(() => relativeError(47.84, -1)).toThrow(RangeError);
    expect(() => relativeError(NaN, 52)).toThrow(RangeError);
  });
});
