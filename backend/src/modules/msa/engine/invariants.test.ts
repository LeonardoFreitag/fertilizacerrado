import type { Cultivar } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import * as engine from './index';
import { mulberry32, uniform } from './test-fixtures';
import type { CultivarParams, DailyWeather, SoilParams } from './types';
import { runDailyBalance } from './water-balance';
import { cycleYieldIndex, summarizeByPhase } from './yield';

const CASES = 200;

function randomCultivar(rand: () => number): CultivarParams {
  const gdaTotal = uniform(rand, 800, 2500);
  const cuts = [rand(), rand(), rand()].sort((a, b) => a - b).map((f) => 0.05 + 0.9 * f);
  const zrIni = uniform(rand, 0.1, 0.5);
  const tBase = uniform(rand, 5, 15);
  return {
    tBase,
    tUpper: rand() < 0.5 ? null : uniform(rand, tBase + 5, 45),
    gdaTotal,
    gdaF1End: cuts[0]! * gdaTotal,
    gdaF2End: cuts[1]! * gdaTotal,
    gdaF3End: cuts[2]! * gdaTotal,
    kcIni: uniform(rand, 0.1, 0.6),
    kcMid: uniform(rand, 0.8, 1.4),
    kcEnd: uniform(rand, 0.2, 0.9),
    depletionFraction: uniform(rand, 0.3, 0.7),
    zrIni,
    zrMax: uniform(rand, zrIni, 1.5),
    kyF1: uniform(rand, 0, 1.5),
    kyF2: uniform(rand, 0, 1.5),
    kyF3: uniform(rand, 0, 1.5),
    kyF4: uniform(rand, 0, 1.5),
  };
}

function randomSoil(rand: () => number): SoilParams {
  const thetaFC = uniform(rand, 0.2, 0.45);
  return { thetaFC, thetaWP: thetaFC - uniform(rand, 0.05, 0.18) };
}

function randomSeries(rand: () => number, n: number): DailyWeather[] {
  const out = new Array<DailyWeather>(n);
  for (let i = 0; i < n; i++) {
    const tmax = uniform(rand, 20, 38);
    const tmin = tmax - uniform(rand, 5, 15);
    out[i] = {
      date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      tmax,
      tmin,
      tdew: tmin - uniform(rand, 0, 6),
      u2: uniform(rand, 0.3, 5),
      rn: uniform(rand, 4, 22),
      precipitation: rand() < 0.7 ? 0 : uniform(rand, 0, 60),
    };
  }
  return out;
}

describe('invariantes do motor com entradas aleatórias (semente fixa)', () => {
  it(`${CASES} casos: 0 ≤ Ks ≤ 1, ETc_adj ≤ ETc, 0 ≤ Dr ≤ TAW, Zr e GDA não decrescentes, 0 ≤ GDA ≤ TB − Tb, ET₀ ≥ 0, 0 ≤ índice ≤ 1`, () => {
    const rand = mulberry32(20261005);
    let rowsChecked = 0;

    for (let c = 0; c < CASES; c++) {
      const cultivar = randomCultivar(rand);
      const soil = randomSoil(rand);
      const days = randomSeries(rand, 20 + Math.floor(rand() * 150));
      // Metade dos casos com entressafra: emergência em algum dia da série, Kc e Zr plausíveis.
      const preSeason = rand() < 0.5 ? undefined : { until: days[Math.floor(rand() * days.length)]!.date, kc: uniform(rand, 0.3, 1.2), zr: rand() < 0.5 ? cultivar.zrMax : cultivar.zrIni };
      const rows = runDailyBalance(days, cultivar, soil, {
        altitude: uniform(rand, 0, 1500),
        initialDepletion: rand() < 0.5 ? 0 : uniform(rand, 0, 60),
        preSeason,
      });

      let prevZr = -Infinity;
      let prevGda = -Infinity;
      for (const row of rows) {
        expect(row.ks).toBeGreaterThanOrEqual(0);
        expect(row.ks).toBeLessThanOrEqual(1);
        expect(row.etcAdj).toBeLessThanOrEqual(row.etc + 1e-12);
        expect(row.dr).toBeGreaterThanOrEqual(0);
        expect(row.dr).toBeLessThanOrEqual(row.taw + 1e-9);
        if (row.phase !== 'PRE') expect(row.zr).toBeGreaterThanOrEqual(prevZr);
        expect(row.gdaAccum).toBeGreaterThanOrEqual(prevGda);
        expect(row.gda).toBeGreaterThanOrEqual(0);
        if (row.phase === 'PRE') {
          expect(row.gda).toBe(0);
          expect(row.gdaAccum).toBe(0);
          expect(row.kc).toBe(preSeason!.kc);
        }
        if (cultivar.tUpper !== null) expect(row.gda).toBeLessThanOrEqual(cultivar.tUpper - cultivar.tBase + 1e-9);
        expect(row.et0).toBeGreaterThanOrEqual(0);
        expect(row.raw).toBeLessThanOrEqual(row.taw);
        expect(Number.isFinite(row.et0 + row.etc + row.etcAdj + row.dr)).toBe(true);
        prevZr = row.phase === 'PRE' ? -Infinity : row.zr; // Zr da entressafra (zrMax) pode ser maior que zrIni
        prevGda = row.gdaAccum;
        rowsChecked++;
      }

      const { yieldIndex, phasesReached } = cycleYieldIndex(summarizeByPhase(rows, cultivar));
      expect(yieldIndex).toBeGreaterThanOrEqual(0);
      expect(yieldIndex).toBeLessThanOrEqual(1);
      expect(phasesReached).toBeGreaterThanOrEqual(0);
      expect(phasesReached).toBeLessThanOrEqual(4);
    }

    expect(rowsChecked).toBeGreaterThan(CASES * 20);
  });
});

describe('motor determinístico', () => {
  it('não exporta PRNG, Monte Carlo nem cenários', () => {
    const exported = engine as Record<string, unknown>;
    for (const name of ['mulberry32', 'sampleNormal', 'uniform', 'runMonteCarlo', 'percentile', 'generateDecisionScenarios']) {
      expect(exported[name]).toBeUndefined();
    }
    expect(typeof engine.cycleYieldIndex).toBe('function');
    expect(typeof engine.predictedYield).toBe('function');
  });
});

describe('compatibilidade de tipos com o Prisma', () => {
  it('um registro Cultivar satisfaz CultivarParams sem conversão', () => {
    const fromDb = {
      id: 'x', name: 'Soja', crop: 'SOJA', cycleDescription: null, isDefault: true, createdById: null, referenceSnapshot: null,
      createdAt: new Date(), updatedAt: new Date(),
      tBase: 10, tUpper: 30, gdaTotal: 1200, gdaF1End: 120, gdaF2End: 450, gdaF3End: 900,
      kcIni: 0.2, kcMid: 1.15, kcEnd: 0.5, depletionFraction: 0.5, zrIni: 0.3, zrMax: 0.95,
      kyF1: 0.2, kyF2: 0.8, kyF3: 1, kyF4: 0.4,
    } satisfies Cultivar;
    const params: CultivarParams = fromDb; // compila: tipagem estrutural
    expect(params.gdaTotal).toBe(1200);
  });
});
