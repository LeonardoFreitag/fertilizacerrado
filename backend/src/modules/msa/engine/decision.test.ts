import { describe, expect, it } from 'vitest';
import { syntheticSeason } from '../synthetic-season';
import { generateDecisionScenarios, nextPhase } from './decision';
import { LATOSSOLO, SOJA } from './test-fixtures';
import type { DecisionInput } from './types';
import { runDailyBalance } from './water-balance';

const SERIES = runDailyBalance(syntheticSeason(150, 2026), SOJA, LATOSSOLO, { altitude: 741 });
const base: DecisionInput = { phase: 'F2', ksP50: 0.72, baselineSeries: SERIES, cultivar: SOJA, doseBase: 100, efficiencyBase: 0.6 };

describe('nextPhase', () => {
  it('encadeia F1→F2→F3→F4→null', () => {
    expect(nextPhase('F1')).toBe('F2');
    expect(nextPhase('F3')).toBe('F4');
    expect(nextPhase('F4')).toBeNull();
  });
});

describe('generateDecisionScenarios (algoritmos.md §8)', () => {
  it('(a) e (c) são proporcionais ao Ks mediano', () => {
    const s = generateDecisionScenarios(base);
    expect(s.a.doseAdjusted).toBeCloseTo(72, 10);
    expect(s.a.reductionPct).toBeCloseTo(28, 10);
    expect(s.c.efficiencyAdjusted).toBeCloseTo(0.432, 10);
    expect(s.phase).toBe('F2');
    expect(s.ksP50).toBe(0.72);
  });

  it('ksP50 = 1 mantém dose e eficiência', () => {
    const s = generateDecisionScenarios({ ...base, ksP50: 1 });
    expect(s.a.doseAdjusted).toBe(100);
    expect(s.a.reductionPct).toBe(0);
    expect(s.c.efficiencyAdjusted).toBe(0.6);
  });

  it('(b) parcela a janela seguinte: soma a dose, metades ceil(n/2)', () => {
    const s = generateDecisionScenarios(base);
    const b = s.b!;
    const n = SERIES.filter((r) => r.phase === 'F3').length;
    expect(b.nextPhase).toBe('F3');
    expect(b.days1).toBe(Math.ceil(n / 2));
    expect(b.days2).toBe(n - b.days1);
    expect(b.dose1 + b.dose2).toBeCloseTo(100, 10);
    expect(b.fraction1 + b.fraction2).toBeCloseTo(1, 12);
    expect(b.fraction1).toBeCloseTo(b.etc1 / (b.etc1 + b.etc2), 12);
    expect(s.bUnavailableReason).toBeNull();
  });

  it('(b) com ETc constante e n par divide meio a meio', () => {
    const flat = SERIES.filter((r) => r.phase === 'F3').slice(0, 10).map((r) => ({ ...r, etc: 5 }));
    const s = generateDecisionScenarios({ ...base, baselineSeries: flat });
    expect(s.b!.fraction1).toBeCloseTo(0.5, 12);
    expect(s.b!.dose1).toBeCloseTo(50, 10);
  });

  it('(b) é null na última janela', () => {
    const s = generateDecisionScenarios({ ...base, phase: 'F4' });
    expect(s.b).toBeNull();
    expect(s.bUnavailableReason).toMatch(/última janela/);
  });

  it('(b) é null quando a série não alcança a janela seguinte ou tem 1 dia nela', () => {
    const noF4 = SERIES.filter((r) => r.phase !== 'F4' && r.phase !== 'COMPLETED');
    const s1 = generateDecisionScenarios({ ...base, phase: 'F3', baselineSeries: noF4 });
    expect(s1.b).toBeNull();
    expect(s1.bUnavailableReason).toMatch(/não alcança F4/);

    const oneF4 = [...noF4, SERIES.find((r) => r.phase === 'F4')!];
    const s2 = generateDecisionScenarios({ ...base, phase: 'F3', baselineSeries: oneF4 });
    expect(s2.b).toBeNull();
    expect(s2.bUnavailableReason).toMatch(/apenas 1 dia/);
  });

  it('racionais descrevem o cálculo sem recomendar', () => {
    const s = generateDecisionScenarios(base);
    for (const text of [s.a.rationale, s.b!.rationale, s.c.rationale]) {
      expect(text.length).toBeGreaterThan(20);
      expect(text.toLowerCase()).not.toContain('recomenda');
    }
    expect(s.a.rationale).toContain('0.72');
    expect(s.a.rationale).toContain('F2');
  });

  it('rejeita entradas inválidas', () => {
    expect(() => generateDecisionScenarios({ ...base, ksP50: 1.2 })).toThrow(RangeError);
    expect(() => generateDecisionScenarios({ ...base, ksP50: -0.1 })).toThrow(RangeError);
    expect(() => generateDecisionScenarios({ ...base, doseBase: -10 })).toThrow(RangeError);
    expect(() => generateDecisionScenarios({ ...base, efficiencyBase: -1 })).toThrow(RangeError);
    expect(() => generateDecisionScenarios({ ...base, phase: 'COMPLETED' as never })).toThrow(RangeError);
  });
});
