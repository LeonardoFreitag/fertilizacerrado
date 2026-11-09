import { describe, expect, it } from 'vitest';
import { referenceCultivar } from '../../src/modules/cultivars/reference-cultivars';
import { syntheticSeason } from '../../src/modules/msa/synthetic-season';
import { preSeasonSensitivity } from './preseason-validate';

const SOJA = referenceCultivar('SOJA');
const SOIL = { thetaFC: 0.28, thetaWP: 0.12 };
// 1º de fevereiro a 31 de outubro de 2025 (273 dias), com estação seca maio–setembro.
const DAYS = syntheticSeason(273, 2026, '2025-02-01');

describe('preSeasonSensitivity (Caso 2 / questão #11)', () => {
  it('Dr na emergência cresce com o Kc e fica em [0, TAW]', () => {
    const rows = preSeasonSensitivity(DAYS, SOJA, SOIL, 741, [0.4, 0.7, 1.0], 'zrMax', '2025-11-01');
    expect(rows.map((r) => r.kc)).toEqual([0.4, 0.7, 1.0]);
    expect(rows.every((r) => r.days === 273 && r.zr === SOJA.zrMax)).toBe(true);
    expect(rows[0]!.drPreMm).toBeLessThanOrEqual(rows[1]!.drPreMm);
    expect(rows[1]!.drPreMm).toBeLessThanOrEqual(rows[2]!.drPreMm);
    for (const r of rows) {
      expect(r.drIniPct).toBeGreaterThanOrEqual(0);
      expect(r.drIniPct).toBeLessThanOrEqual(100);
      expect(r.drIniMm).toBeCloseTo((r.drPreMm * 48) / 152, 9); // proporção pela TAW
      expect(r.rainMm).toBeGreaterThan(0);
    }
    expect(rows[2]!.drIniPct).toBeGreaterThan(0); // estação seca antes da emergência
  });

  it('zrIni: sem conversão (Dr fim = Dr emergência)', () => {
    const [r] = preSeasonSensitivity(DAYS, SOJA, SOIL, 741, [1.0], 'zrIni', '2025-11-01');
    expect(r!.zr).toBe(SOJA.zrIni);
    expect(r!.drIniMm).toBeCloseTo(r!.drPreMm, 9);
  });
});
