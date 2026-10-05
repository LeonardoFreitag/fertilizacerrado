import { describe, expect, it } from 'vitest';
import { referenceET0 } from './et0';
import { LATOSSOLO, SOJA } from './test-fixtures';
import type { CultivarParams, DailyWeather } from './types';
import {
  readilyAvailableWater,
  runDailyBalance,
  stressCoefficient,
  totalAvailableWater,
} from './water-balance';

const ALTITUDE = 750;

/** Dia típico de verão no Cerrado; GDA 15 por dia. */
function day(index: number, precipitation = 0, overrides: Partial<DailyWeather> = {}): DailyWeather {
  const d = new Date(Date.UTC(2025, 10, 10 + index));
  return {
    date: d.toISOString().slice(0, 10),
    tmax: 30,
    tmin: 20,
    tdew: 18,
    u2: 2,
    rn: 14,
    precipitation,
    ...overrides,
  };
}

function series(n: number, precipitation: (i: number) => number = () => 0): DailyWeather[] {
  return Array.from({ length: n }, (_, i) => day(i, precipitation(i)));
}

/** Cultivar com uma única fase longa e raiz fixa: ETc constante dia a dia. */
const FLAT: CultivarParams = { ...SOJA, gdaF1End: 1e6, gdaF2End: 2e6, gdaF3End: 3e6, gdaTotal: 4e6, zrIni: 0.5, zrMax: 0.5 };

describe('TAW, RAW e Ks (FAO-56 Eq. 82–84)', () => {
  it('calcula TAW e RAW', () => {
    expect(totalAvailableWater(0.28, 0.12, 0.95)).toBeCloseTo(152, 10);
    expect(readilyAvailableWater(0.5, 152)).toBe(76);
  });

  it('Ks = 1 até RAW, decresce linearmente até TAW, 0 além', () => {
    expect(stressCoefficient(0, 100, 50)).toBe(1);
    expect(stressCoefficient(50, 100, 50)).toBe(1);
    expect(stressCoefficient(75, 100, 50)).toBeCloseTo(0.5, 10);
    expect(stressCoefficient(100, 100, 50)).toBe(0);
    expect(stressCoefficient(130, 100, 50)).toBe(0);
  });

  it('não divide por zero quando RAW = TAW', () => {
    expect(stressCoefficient(80, 100, 100)).toBe(1);
    expect(stressCoefficient(100, 100, 100)).toBe(1); // Dr ≤ RAW vale primeiro
    expect(stressCoefficient(100.001, 100, 100)).toBe(0);
    expect(stressCoefficient(120, 100, 100)).toBe(0);
  });
});

describe('runDailyBalance (FAO-56 cap. 8; algoritmos.md §5)', () => {
  it('sem chuva: Ks = 1 enquanto Dr ≤ RAW, depois estresse no dia previsto analiticamente', () => {
    const rows = runDailyBalance(series(60), FLAT, LATOSSOLO, { altitude: ALTITUDE });
    const etc = rows[0]!.etc;
    const raw = rows[0]!.raw;
    // Dia k (1-based) começa com Dr = (k−1)·etc; o primeiro dia com Dr > RAW é floor(raw/etc) + 2.
    const expectedDay = Math.floor(raw / etc) + 2;

    expect(rows[0]!.ks).toBe(1);
    expect(rows[0]!.dr).toBeCloseTo(etc, 10);
    const firstStress = rows.findIndex((r) => r.ks < 1) + 1;
    expect(firstStress).toBe(expectedDay);
    for (let i = 0; i < firstStress - 1; i++) expect(rows[i]!.ks).toBe(1);
  });

  it('Ks → 0 quando a depleção inicial do dia é igual a TAW', () => {
    const rows = runDailyBalance(series(1), FLAT, LATOSSOLO, { altitude: ALTITUDE, initialDepletion: 80 });
    expect(rows[0]!.taw).toBeCloseTo(80, 10);
    expect(rows[0]!.ks).toBeCloseTo(0, 10);
    expect(rows[0]!.etcAdj).toBeCloseTo(0, 10);
    expect(rows[0]!.dr).toBeCloseTo(80, 10);
  });

  it('Dr fica em [0, TAW]; chuva acima da depleção zera Dr', () => {
    const rows = runDailyBalance(series(40, (i) => (i === 20 ? 200 : 0)), SOJA, LATOSSOLO, { altitude: ALTITUDE });
    for (const row of rows) {
      expect(row.dr).toBeGreaterThanOrEqual(0);
      expect(row.dr).toBeLessThanOrEqual(row.taw + 1e-9);
    }
    expect(rows[19]!.dr).toBeGreaterThan(0);
    expect(rows[20]!.dr).toBe(0);
    expect(rows[21]!.ks).toBe(1);
  });

  it('ETc_adj = ETc sem estresse e ET₀ coincide com referenceET0', () => {
    const rows = runDailyBalance(series(3), SOJA, LATOSSOLO, { altitude: ALTITUDE });
    const d = day(0);
    const et0 = referenceET0({ tmax: d.tmax, tmin: d.tmin, tdew: d.tdew, u2: d.u2, rn: d.rn, altitude: ALTITUDE });
    for (const row of rows) {
      expect(row.et0).toBeCloseTo(et0, 10);
      expect(row.etc).toBeCloseTo(row.kc * row.et0, 10);
      expect(row.etcAdj).toBeCloseTo(row.etc, 10);
    }
  });

  it('raiz aprofunda: TAW e RAW crescem e Dr do início do dia é o Dr do fim do anterior', () => {
    const rows = runDailyBalance(series(40), SOJA, LATOSSOLO, { altitude: ALTITUDE });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (cur.zr > prev.zr) {
        expect(cur.taw).toBeGreaterThan(prev.taw);
        expect(cur.raw).toBeGreaterThan(prev.raw);
      }
      // Ks do dia usa Dr do fim do dia anterior
      const expectedKs = prev.dr <= cur.raw ? 1 : prev.dr >= cur.taw ? 0 : (cur.taw - prev.dr) / (cur.taw - cur.raw);
      expect(cur.ks).toBeCloseTo(expectedKs, 10);
    }
    expect(rows[0]!.zr).toBeGreaterThan(0.3); // GDA de 15 no 1º dia já move Zr
    expect(rows[39]!.zr).toBe(0.95); // GDA 600 > gdaF2End
  });

  it('fase, GDA acumulado e Zr seguem a fenologia', () => {
    const rows = runDailyBalance(series(90), SOJA, LATOSSOLO, { altitude: ALTITUDE });
    expect(rows[0]!.gda).toBe(15);
    expect(rows[7]!.gdaAccum).toBe(120);
    expect(rows[6]!.phase).toBe('F1');
    expect(rows[7]!.phase).toBe('F2');
    expect(rows[29]!.phase).toBe('F3'); // GDA 450
    expect(rows[59]!.phase).toBe('F4'); // GDA 900
    expect(rows[79]!.phase).toBe('COMPLETED'); // GDA 1200
    expect(rows[89]!.kc).toBe(SOJA.kcEnd);
  });

  it('é determinístico', () => {
    const input = series(50, (i) => (i % 5 === 0 ? 12 : 0));
    const a = runDailyBalance(input, SOJA, LATOSSOLO, { altitude: ALTITUDE });
    const b = runDailyBalance(input, SOJA, LATOSSOLO, { altitude: ALTITUDE });
    expect(a).toEqual(b);
  });

  it('rejeita entradas inválidas indicando o dia', () => {
    const bad = series(3);
    bad[1] = day(1, Number.NaN);
    expect(() => runDailyBalance(bad, SOJA, LATOSSOLO, { altitude: ALTITUDE })).toThrow(/Dia 1: precipitation/);
    expect(() => runDailyBalance(series(1), SOJA, LATOSSOLO, { altitude: Number.NaN })).toThrow(RangeError);
    expect(() => runDailyBalance(series(1), SOJA, { thetaFC: 0.1, thetaWP: 0.2 }, { altitude: 0 })).toThrow(RangeError);
    expect(() => runDailyBalance(series(1), SOJA, LATOSSOLO, { altitude: 0, initialDepletion: -1 })).toThrow(RangeError);
  });

  it('série vazia devolve série vazia', () => {
    expect(runDailyBalance([], SOJA, LATOSSOLO, { altitude: ALTITUDE })).toEqual([]);
  });
});
