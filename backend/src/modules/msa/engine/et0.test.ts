import { describe, expect, it } from 'vitest';
import {
  actualVapourPressureFromDewpoint,
  actualVapourPressureFromMeanRH,
  actualVapourPressureFromPsychrometer,
  actualVapourPressureFromRH,
  atmosphericPressure,
  clearSkyRadiation,
  daylightHours,
  dewpointFromVapourPressure,
  extraterrestrialRadiation,
  meanSaturationVapourPressure,
  netLongwaveRadiation,
  netRadiationFromSolar,
  netShortwaveRadiation,
  psychrometricConstant,
  referenceET0,
  referenceET0Detailed,
  saturationVapourPressure,
  slopeVapourPressureCurve,
  solarRadiationFromSunshine,
  windSpeedAt2m,
} from './et0';

/** Tolerância dos intermediários impressos no FAO-56: 1 % ou 0,01, o maior. */
function expectNear(actual: number, printed: number): void {
  const tolerance = Math.max(Math.abs(printed) * 0.01, 0.01);
  expect(Math.abs(actual - printed)).toBeLessThanOrEqual(tolerance);
}

describe('FAO-56 cap. 3 — exemplos trabalhados', () => {
  it('Exemplo 2: pressão e constante psicrométrica a 1800 m', () => {
    const p = atmosphericPressure(1800);
    expectNear(p, 81.8);
    expectNear(psychrometricConstant(p), 0.054);
  });

  it('Exemplo 3: pressão de vapor saturado média (Eq. 11, 12)', () => {
    expectNear(saturationVapourPressure(24.5), 3.075);
    expectNear(saturationVapourPressure(15), 1.705);
    expectNear(meanSaturationVapourPressure(24.5, 15), 2.39);
  });

  it('Exemplo 4: ea por psicrômetro aspirado a 1200 m (Eq. 15, 16)', () => {
    const ea = actualVapourPressureFromPsychrometer(25.6, 19.5, atmosphericPressure(1200));
    expectNear(ea, 1.91);
  });

  it('Exemplo 5: ea por UR máxima e mínima (Eq. 17)', () => {
    expectNear(actualVapourPressureFromRH(25, 18, 82, 54), 1.7);
  });

  it('Eq. 19 (UR média) coincide com Eq. 17 quando RHmax = RHmin', () => {
    expect(actualVapourPressureFromMeanRH(25, 18, 60)).toBeCloseTo(
      actualVapourPressureFromRH(25, 18, 60, 60),
      10,
    );
  });

  it('ponto de orvalho e ea são inversos (Eq. 14)', () => {
    for (const tdew of [-5, 0, 12.06, 23.2, 30]) {
      const back = dewpointFromVapourPressure(actualVapourPressureFromDewpoint(tdew));
      expect(Math.abs(back - tdew)).toBeLessThan(1e-9);
    }
  });

  it('Eq. 47: fator 0,748 para vento medido a 10 m', () => {
    expect(Math.abs(windSpeedAt2m(1, 10) - 0.748)).toBeLessThan(0.001);
    expect(windSpeedAt2m(3, 2)).toBeCloseTo(3, 2); // a Eq. 47 não é identidade exata em z = 2 m
  });
});

describe('FAO-56 Exemplo 18 — Uccle/Bruxelas, 6 de julho (dados diários)', () => {
  const lat = 50.8;
  const altitude = 100;
  const doy = 187;
  const tmax = 21.5;
  const tmin = 12.3;

  const u2 = windSpeedAt2m(2.78, 10);
  const ea = actualVapourPressureFromRH(tmax, tmin, 84, 63);
  const ra = extraterrestrialRadiation(lat, doy);
  const n = daylightHours(lat, doy);
  const rs = solarRadiationFromSunshine(9.25, n, ra);
  const rso = clearSkyRadiation(ra, altitude);
  const rns = netShortwaveRadiation(rs);
  const rnl = netLongwaveRadiation(tmax, tmin, ea, rs, rso);
  const rn = netRadiationFromSolar(rs, tmax, tmin, ea, lat, doy, altitude);

  it('reproduz os intermediários impressos', () => {
    expectNear(u2, 2.078);
    expectNear(atmosphericPressure(altitude), 100.1);
    expectNear(slopeVapourPressureCurve(16.9), 0.122);
    expectNear(psychrometricConstant(atmosphericPressure(altitude)), 0.0666);
    expectNear(meanSaturationVapourPressure(tmax, tmin), 1.997);
    expectNear(ea, 1.409);
    expectNear(ra, 41.09);
    expectNear(n, 16.1);
    expectNear(rs, 22.07);
    expectNear(rso, 30.9);
    expectNear(rns, 17.0);
    expectNear(rnl, 3.71);
    expectNear(rn, 13.28);
  });

  it('ET₀ = 3,9 ± 0,1 mm/dia', () => {
    const detail = referenceET0Detailed({
      tmax,
      tmin,
      tdew: dewpointFromVapourPressure(ea),
      u2,
      rn,
      altitude,
    });
    expect(Math.abs(detail.et0 - 3.9)).toBeLessThanOrEqual(0.1);
    expectNear(detail.tmean, 16.9);
    expectNear(detail.ea, 1.409);
  });
});

describe('FAO-56 Exemplo 17 — Bangkok, abril (dados mensais)', () => {
  const lat = 13.73;
  const altitude = 2;
  const doy = 105;
  const tmax = 34.8;
  const tmin = 25.6;
  const ea = 2.85;

  const ra = extraterrestrialRadiation(lat, doy);
  const n = daylightHours(lat, doy);
  const rs = solarRadiationFromSunshine(8.5, n, ra);
  const rso = clearSkyRadiation(ra, altitude);
  const rn = netRadiationFromSolar(rs, tmax, tmin, ea, lat, doy, altitude);

  it('reproduz os intermediários impressos', () => {
    expectNear(slopeVapourPressureCurve(30.2), 0.246);
    expectNear(psychrometricConstant(atmosphericPressure(altitude)), 0.0674);
    expectNear(meanSaturationVapourPressure(tmax, tmin), 4.42);
    expectNear(ra, 38.06);
    expectNear(n, 12.31);
    expectNear(rs, 22.65);
    expectNear(rso, 28.54);
    expectNear(netShortwaveRadiation(rs), 17.44);
    expectNear(netLongwaveRadiation(tmax, tmin, ea, rs, rso), 3.11);
    expectNear(rn, 14.33);
  });

  it('ET₀ = 5,72 ± 0,1 mm/dia (G = 0 em vez do 0,14 mensal do livro)', () => {
    const et0 = referenceET0({
      tmax,
      tmin,
      tmean: 30.2,
      tdew: dewpointFromVapourPressure(ea),
      u2: 2,
      rn,
      altitude,
    });
    expect(Math.abs(et0 - 5.72)).toBeLessThanOrEqual(0.1);
  });
});

describe('referenceET0', () => {
  it('tmean omitido equivale a (tmax + tmin) / 2', () => {
    const base = { tmax: 30, tmin: 18, tdew: 15, u2: 2, rn: 14, altitude: 750 };
    expect(referenceET0(base)).toBe(referenceET0({ ...base, tmean: 24 }));
  });

  it('é maior com mais radiação, vento ou déficit de vapor', () => {
    const base = { tmax: 30, tmin: 18, tdew: 15, u2: 2, rn: 14, altitude: 750 };
    const et0 = referenceET0(base);
    expect(referenceET0({ ...base, rn: 18 })).toBeGreaterThan(et0);
    expect(referenceET0({ ...base, u2: 4 })).toBeGreaterThan(et0);
    expect(referenceET0({ ...base, tdew: 8 })).toBeGreaterThan(et0);
  });
});
