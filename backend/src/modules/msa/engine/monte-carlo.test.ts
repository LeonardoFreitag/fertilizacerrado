import { describe, expect, it } from 'vitest';
import { syntheticSeason } from '../synthetic-season';
import { percentile, runMonteCarlo } from './monte-carlo';
import { mulberry32, sampleNormal } from './random';
import { LATOSSOLO, SOJA } from './test-fixtures';
import type { MonteCarloOptions, Percentiles } from './types';

const SEASON = syntheticSeason(150, 2026);
const BASE: MonteCarloOptions = { seed: 42, altitude: 741 };

function ordered(p: Percentiles | null): void {
  expect(p).not.toBeNull();
  expect(p!.p10).toBeLessThanOrEqual(p!.p50);
  expect(p!.p50).toBeLessThanOrEqual(p!.p90);
}

describe('percentile (tipo 7)', () => {
  it('interpola linearmente como R/NumPy', () => {
    const x = [1, 2, 3, 4];
    expect(percentile(x, 0.1)).toBeCloseTo(1.3, 12);
    expect(percentile(x, 0.5)).toBeCloseTo(2.5, 12);
    expect(percentile(x, 0.9)).toBeCloseTo(3.7, 12);
    expect(percentile(x, 0)).toBe(1);
    expect(percentile(x, 1)).toBe(4);
    expect(percentile([7], 0.5)).toBe(7);
  });

  it('rejeita amostra vazia e p fora de [0, 1]', () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });
});

describe('runMonteCarlo', () => {
  it('a série sintética produz estresse (o teste é informativo)', () => {
    const r = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 1 });
    const stressed = r.baseline.filter((s) => s.days > 0 && s.ksMean !== null && s.ksMean < 0.98);
    expect(stressed.length).toBeGreaterThan(0);
    expect(r.baseline.map((s) => s.days > 0)).toEqual([true, true, true, true]);
  });

  it('é determinístico para a mesma semente', () => {
    const a = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 200 });
    const b = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 200 });
    expect(a).toEqual(b);
  });

  it('sementes diferentes ⇒ percentis diferentes', () => {
    const a = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 200, seed: 1 });
    const b = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 200, seed: 2 });
    expect(a.phases.map((p) => p.ksMean?.p50)).not.toEqual(b.phases.map((p) => p.ksMean?.p50));
    expect(a.baseline).toEqual(b.baseline); // o baseline não depende da semente
  });

  it('sigma zero ⇒ p10 = p50 = p90 = baseline em todas as janelas', () => {
    const r = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 50, sigmaPrecip: 0, sigmaTemp: 0 });
    r.phases.forEach((p, i) => {
      const base = r.baseline[i]!;
      expect(p.validIterations).toBe(50);
      for (const [key, value] of [['ksMean', base.ksMean], ['yieldReductionPct', base.yieldReductionPct], ['etcAdjAccum', base.etcAdjAccum]] as const) {
        const pct = p[key]!;
        expect(pct.p10).toBeCloseTo(value!, 12);
        expect(pct.p50).toBeCloseTo(value!, 12);
        expect(pct.p90).toBeCloseTo(value!, 12);
      }
    });
  });

  it('1000 iterações: p10 ≤ p50 ≤ p90, Ks em [0, 1], metadados', () => {
    const r = runMonteCarlo(SEASON, SOJA, LATOSSOLO, BASE);
    expect(r.iterations).toBe(1000);
    expect(r.seed).toBe(42);
    expect(r.sigmaPrecip).toBe(0.3);
    expect(r.sigmaTemp).toBe(0.6);
    expect(r.baselineSeries).toHaveLength(150);
    for (const p of r.phases) {
      expect(p.validIterations).toBeLessThanOrEqual(1000);
      expect(p.validIterations).toBeGreaterThan(0);
      ordered(p.ksMean);
      ordered(p.yieldReductionPct);
      ordered(p.etcAdjAccum);
      expect(p.ksMean!.p10).toBeGreaterThanOrEqual(0);
      expect(p.ksMean!.p90).toBeLessThanOrEqual(1);
    }
    // com perturbação há dispersão em janelas com estresse
    expect(r.phases.some((p) => p.ksMean!.p90 - p.ksMean!.p10 > 0.01)).toBe(true);
  });

  it('fator de precipitação truncado em zero', () => {
    // σP enorme: muitos sorteios negativos; nenhuma precipitação negativa pode aparecer
    const r = runMonteCarlo(SEASON.slice(0, 30), SOJA, LATOSSOLO, { ...BASE, iterations: 300, sigmaPrecip: 5 });
    for (const p of r.phases) if (p.etcAdjAccum) expect(p.etcAdjAccum.p10).toBeGreaterThanOrEqual(0);
    const rand = mulberry32(42);
    let negatives = 0;
    for (let i = 0; i < 10_000; i++) if (Math.max(0, sampleNormal(rand, 1, 5)) === 0) negatives++;
    expect(negatives).toBeGreaterThan(0);
  });

  it('janela alcançada só em parte das iterações', () => {
    // série que termina logo depois de entrar em F4 no baseline: δ negativo tira F4 de algumas iterações
    const base = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 1 }).baselineSeries;
    const firstF4 = base.findIndex((r) => r.phase === 'F4');
    const trimmed = SEASON.slice(0, firstF4 + 1);
    const r = runMonteCarlo(trimmed, SOJA, LATOSSOLO, { ...BASE, iterations: 400, sigmaTemp: 1.5 });
    const f4 = r.phases[3]!;
    expect(f4.validIterations).toBeGreaterThan(0);
    expect(f4.validIterations).toBeLessThan(400);
    expect(f4.ksMean).not.toBeNull();
    for (const p of r.phases.slice(0, 3)) expect(p.validIterations).toBe(400);
  });

  it('janela nunca alcançada ⇒ validIterations 0 e percentis null', () => {
    const r = runMonteCarlo(SEASON.slice(0, 20), SOJA, LATOSSOLO, { ...BASE, iterations: 50 });
    expect(r.phases[2]!.validIterations).toBe(0);
    expect(r.phases[2]!.ksMean).toBeNull();
    expect(r.phases[3]!.yieldReductionPct).toBeNull();
    expect(r.phases[0]!.validIterations).toBe(50);
  });

  it('rejeita opções inválidas', () => {
    expect(() => runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 0 })).toThrow(RangeError);
    expect(() => runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 2.5 })).toThrow(RangeError);
    expect(() => runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, sigmaPrecip: -0.1 })).toThrow(RangeError);
    expect(() => runMonteCarlo(SEASON, SOJA, LATOSSOLO, { altitude: 741 } as MonteCarloOptions)).toThrow(RangeError);
  });

  it('1000 iterações × 150 dias em menos de 2 s', () => {
    const t0 = performance.now();
    runMonteCarlo(SEASON, SOJA, LATOSSOLO, BASE);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('convergência (Caso 3): |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ < 0,5 % por janela', () => {
    const r500 = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 500 });
    const r1000 = runMonteCarlo(SEASON, SOJA, LATOSSOLO, { ...BASE, iterations: 1000 });
    r1000.phases.forEach((p, i) => {
      const a = r500.phases[i]!.ksMean!.p50;
      const b = p.ksMean!.p50;
      expect(Math.abs(a - b) / b).toBeLessThan(0.005);
    });
  });
});
