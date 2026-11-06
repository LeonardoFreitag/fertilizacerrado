import { describe, expect, it } from 'vitest';
import { accumulateGDA, dailyGDA } from './gda';
import { kcForPhase } from './kc';
import { phaseFromGDA, rootDepth } from './phenology';
import { SOJA } from './test-fixtures';

describe('dailyGDA — método de Ometto (algoritmos.md §1), Tb 10, TB 30', () => {
  it('caso 1: dia dentro das bases', () => {
    expect(dailyGDA(28, 18, 10, 30)).toBeCloseTo(13, 9);
    expect(dailyGDA(30, 20, 10)).toBe(15);
  });

  it('caso 2: mínima abaixo de Tb', () => {
    expect(dailyGDA(20, 6, 10, 30)).toBeCloseTo(3.571, 3);
  });

  it('caso 3: dia frio nunca é negativo', () => {
    expect(dailyGDA(8, 2, 10)).toBe(0);
    expect(dailyGDA(8, 2, 10, 30)).toBe(0);
    expect(dailyGDA(10, 10, 10)).toBe(0);
  });

  it('caso 4: máxima acima de TB acumula menos que o residual', () => {
    expect(dailyGDA(34, 20, 10, 30)).toBeCloseTo(16.43, 2);
    expect(dailyGDA(34, 20, 10)).toBe(17);
  });

  it('caso 5: mínima abaixo de Tb e máxima acima de TB', () => {
    expect(dailyGDA(34, 8, 10, 30)).toBeCloseTo(10.77, 2);
  });

  it('teto: mínima acima de TB ⇒ TB − Tb', () => {
    expect(dailyGDA(32, 31, 10, 30)).toBe(20);
    expect(dailyGDA(40, 30, 10, 30)).toBe(20);
  });

  it('máxima igual à mínima não divide por zero', () => {
    expect(dailyGDA(25, 25, 10, 30)).toBe(15);
    expect(dailyGDA(35, 35, 10, 30)).toBe(20);
    expect(dailyGDA(5, 5, 10, 30)).toBe(0);
  });

  it('bordas contínuas: Tmin = Tb (casos 1/2) e Tmax = TB (casos 4/1)', () => {
    expect(dailyGDA(24, 10, 10, 30)).toBeCloseTo((24 - 10) / 2, 9);
    expect(dailyGDA(24, 10 + 1e-9, 10, 30)).toBeCloseTo(dailyGDA(24, 10 - 1e-9, 10, 30), 6);
    expect(dailyGDA(30, 20, 10, 30)).toBeCloseTo(dailyGDA(30, 20, 10), 9); // TB não atua com Tmax = TB
    expect(dailyGDA(30 + 1e-9, 20, 10, 30)).toBeCloseTo(15, 6);
  });

  it('regressão: sem TB e Tmin ≥ Tb é o residual do motor 2.0.0', () => {
    for (const [tmax, tmin] of [[30, 20], [28, 12], [36, 24], [15, 10]] as const) {
      expect(dailyGDA(tmax, tmin, 10)).toBeCloseTo((tmax + tmin) / 2 - 10, 9);
      expect(dailyGDA(tmax, tmin, 10, null)).toBeCloseTo((tmax + tmin) / 2 - 10, 9);
    }
  });

  it('resultado sempre em [0, TB − Tb]', () => {
    for (let tmin = -5; tmin <= 45; tmin += 2.5) {
      for (let tmax = tmin; tmax <= 50; tmax += 2.5) {
        const gd = dailyGDA(tmax, tmin, 10, 30);
        expect(gd).toBeGreaterThanOrEqual(0);
        expect(gd).toBeLessThanOrEqual(20 + 1e-9);
      }
    }
  });

  it('entradas inválidas lançam RangeError', () => {
    expect(() => dailyGDA(18, 28, 10, 30)).toThrow(RangeError);
    expect(() => dailyGDA(NaN, 20, 10)).toThrow(RangeError);
    expect(() => dailyGDA(28, 20, 10, 10)).toThrow(RangeError);
    expect(() => dailyGDA(28, 20, 10, 8)).toThrow(RangeError);
  });

  it('acumula dia a dia, com e sem TB', () => {
    const series = [
      { tmax: 30, tmin: 20 },
      { tmax: 10, tmin: 4 },
      { tmax: 28, tmin: 16 },
    ];
    expect(accumulateGDA(series, 10)).toEqual([15, 15, 27]);
    expect(accumulateGDA([], 10)).toEqual([]);
    const hot = [
      { tmax: 34, tmin: 20 },
      { tmax: 28, tmin: 18 },
      { tmax: 34, tmin: 8 },
    ];
    const acc = accumulateGDA(hot, 10, 30);
    expect(acc[0]).toBeCloseTo(16.43, 2);
    expect(acc[1]).toBeCloseTo(29.43, 2);
    expect(acc[2]).toBeCloseTo(40.2, 2);
  });
});

describe('phaseFromGDA (algoritmos.md §2)', () => {
  it.each([
    [0, 'F1'], [119.99, 'F1'], [120, 'F2'], [449.99, 'F2'], [450, 'F3'],
    [899.99, 'F3'], [900, 'F4'], [1199.99, 'F4'], [1200, 'COMPLETED'], [5000, 'COMPLETED'],
  ])('GDA %s → %s', (gda, phase) => {
    expect(phaseFromGDA(gda, SOJA)).toBe(phase);
  });
});

describe('rootDepth (algoritmos.md §5; FAO-56 Tabela 22)', () => {
  it('é linear de zrIni a zrMax até o início de F3 e constante depois', () => {
    expect(rootDepth(0, SOJA)).toBe(0.3);
    expect(rootDepth(225, SOJA)).toBeCloseTo(0.625, 10);
    expect(rootDepth(450, SOJA)).toBe(0.95);
    expect(rootDepth(1000, SOJA)).toBe(0.95);
    expect(rootDepth(-5, SOJA)).toBe(0.3);
  });

  it('nunca decresce', () => {
    let previous = -Infinity;
    for (let gda = 0; gda <= 1500; gda += 7.3) {
      const zr = rootDepth(gda, SOJA);
      expect(zr).toBeGreaterThanOrEqual(previous);
      previous = zr;
    }
  });
});

describe('kcForPhase (FAO-56 cap. 6; algoritmos.md §4)', () => {
  const kcAt = (gda: number) => kcForPhase(phaseFromGDA(gda, SOJA), gda, SOJA);

  it('é contínuo nas quatro transições', () => {
    for (const boundary of [SOJA.gdaF1End, SOJA.gdaF2End, SOJA.gdaF3End, SOJA.gdaTotal]) {
      expect(Math.abs(kcAt(boundary - 1e-9) - kcAt(boundary))).toBeLessThan(1e-6);
    }
  });

  it('interpola linearmente em F2 e F4', () => {
    expect(kcAt((SOJA.gdaF1End + SOJA.gdaF2End) / 2)).toBeCloseTo(0.675, 10);
    expect(kcAt((SOJA.gdaF3End + SOJA.gdaTotal) / 2)).toBeCloseTo(0.825, 10);
  });

  it('é constante em F1 e F3 e igual a kcEnd após o ciclo', () => {
    expect(kcAt(0)).toBe(0.2);
    expect(kcAt(100)).toBe(0.2);
    expect(kcAt(450)).toBe(1.15);
    expect(kcAt(899)).toBe(1.15);
    expect(kcAt(1200)).toBe(0.5);
    expect(kcAt(3000)).toBe(0.5);
  });
});
