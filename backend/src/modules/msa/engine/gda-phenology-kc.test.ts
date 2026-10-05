import { describe, expect, it } from 'vitest';
import { accumulateGDA, dailyGDA } from './gda';
import { kcForPhase } from './kc';
import { phaseFromGDA, rootDepth } from './phenology';
import { SOJA } from './test-fixtures';

describe('dailyGDA / accumulateGDA (algoritmos.md §1)', () => {
  it('calcula o GDA do dia acima da base', () => {
    expect(dailyGDA(30, 20, 10)).toBe(15);
  });

  it('nunca é negativo em dia frio', () => {
    expect(dailyGDA(12, 6, 10)).toBe(0);
    expect(dailyGDA(10, 10, 10)).toBe(0);
  });

  it('acumula dia a dia', () => {
    const series = [
      { tmax: 30, tmin: 20 }, // 15
      { tmax: 12, tmin: 6 }, // 0
      { tmax: 28, tmin: 16 }, // 12
    ];
    expect(accumulateGDA(series, 10)).toEqual([15, 15, 27]);
    expect(accumulateGDA([], 10)).toEqual([]);
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
