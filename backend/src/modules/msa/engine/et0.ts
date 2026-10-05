/**
 * Evapotranspiração de referência FAO-56 Penman-Monteith e equações auxiliares.
 *
 * Fonte: ALLEN, R. G.; PEREIRA, L. S.; RAES, D.; SMITH, M. (1998). Crop
 * evapotranspiration — Guidelines for computing crop water requirements.
 * FAO Irrigation and Drainage Paper 56. Os números de equação citados em cada
 * função são os do livro. `docs/msa/algoritmos.md` §3.
 */
import type { ET0Detail, ET0Input } from './types';

/** Constante solar (MJ m⁻² min⁻¹), FAO-56 Eq. 21. */
export const SOLAR_CONSTANT = 0.082;
/** Constante de Stefan-Boltzmann (MJ K⁻⁴ m⁻² dia⁻¹), FAO-56 Eq. 39. */
export const STEFAN_BOLTZMANN = 4.903e-9;
/** Albedo da cultura de referência (grama), FAO-56 Eq. 38. */
export const REFERENCE_ALBEDO = 0.23;
/** Coeficiente do psicrômetro aspirado (°C⁻¹), FAO-56 Eq. 16. */
export const PSYCHROMETER_ASPIRATED = 0.000662;

const DEG_TO_RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Pressão atmosférica e constante psicrométrica
// ---------------------------------------------------------------------------

/**
 * Pressão atmosférica (kPa) pela altitude z (m):
 * P = 101,3 · ((293 − 0,0065 z) / 293)^5,26. FAO-56 Eq. 7.
 */
export function atmosphericPressure(altitude: number): number {
  return 101.3 * Math.pow((293 - 0.0065 * altitude) / 293, 5.26);
}

/**
 * Constante psicrométrica (kPa °C⁻¹): γ = 0,000665 · P. FAO-56 Eq. 8
 * (cp = 1,013·10⁻³ MJ kg⁻¹ °C⁻¹, ε = 0,622, λ = 2,45 MJ kg⁻¹).
 */
export function psychrometricConstant(pressure: number): number {
  return 0.000665 * pressure;
}

// ---------------------------------------------------------------------------
// Pressão de vapor
// ---------------------------------------------------------------------------

/**
 * Pressão de vapor saturado (kPa) à temperatura T (°C):
 * e°(T) = 0,6108 · exp(17,27 T / (T + 237,3)). FAO-56 Eq. 11.
 */
export function saturationVapourPressure(t: number): number {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/**
 * Pressão de vapor saturado média do dia (kPa):
 * es = [e°(Tmax) + e°(Tmin)] / 2. FAO-56 Eq. 12.
 */
export function meanSaturationVapourPressure(tmax: number, tmin: number): number {
  return (saturationVapourPressure(tmax) + saturationVapourPressure(tmin)) / 2;
}

/**
 * Declividade da curva de pressão de vapor saturado (kPa °C⁻¹) em Tmean:
 * Δ = 4098 · e°(T) / (T + 237,3)². FAO-56 Eq. 13.
 */
export function slopeVapourPressureCurve(tmean: number): number {
  return (4098 * saturationVapourPressure(tmean)) / Math.pow(tmean + 237.3, 2);
}

/**
 * Pressão de vapor atual (kPa) pela temperatura do ponto de orvalho:
 * ea = e°(Tdew). FAO-56 Eq. 14.
 */
export function actualVapourPressureFromDewpoint(tdew: number): number {
  return saturationVapourPressure(tdew);
}

/**
 * Pressão de vapor atual (kPa) por psicrômetro:
 * ea = e°(Twet) − γpsy (Tdry − Twet), γpsy = apsy · P. FAO-56 Eq. 15 e 16
 * (apsy = 0,000662 aspirado; 0,000800 ventilação natural; 0,001200 abrigo).
 */
export function actualVapourPressureFromPsychrometer(
  tdry: number,
  twet: number,
  pressure: number,
  aPsy: number = PSYCHROMETER_ASPIRATED,
): number {
  return saturationVapourPressure(twet) - aPsy * pressure * (tdry - twet);
}

/**
 * Pressão de vapor atual (kPa) por UR máxima e mínima:
 * ea = [e°(Tmin) · RHmax/100 + e°(Tmax) · RHmin/100] / 2. FAO-56 Eq. 17.
 */
export function actualVapourPressureFromRH(
  tmax: number,
  tmin: number,
  rhMax: number,
  rhMin: number,
): number {
  return (
    (saturationVapourPressure(tmin) * (rhMax / 100) +
      saturationVapourPressure(tmax) * (rhMin / 100)) /
    2
  );
}

/**
 * Pressão de vapor atual (kPa) por UR média:
 * ea = RHmean/100 · [e°(Tmax) + e°(Tmin)] / 2. FAO-56 Eq. 19.
 */
export function actualVapourPressureFromMeanRH(tmax: number, tmin: number, rhMean: number): number {
  return (rhMean / 100) * meanSaturationVapourPressure(tmax, tmin);
}

/**
 * Temperatura do ponto de orvalho (°C) a partir de ea (kPa): inversa algébrica
 * da Eq. 11 com ea = e°(Tdew) (Eq. 14):
 * Tdew = 237,3 · ln(ea/0,6108) / [17,27 − ln(ea/0,6108)].
 * Equivale à expressão do Anexo 3 do FAO-56 (Tdew = [116,91 + 237,3 ln ea] /
 * [16,78 − ln ea]) dentro de ~0,01 °C; a forma exata garante que
 * e°(Tdew(ea)) = ea e permite alimentar o motor com dados em UR.
 */
export function dewpointFromVapourPressure(ea: number): number {
  const x = Math.log(ea / 0.6108);
  return (237.3 * x) / (17.27 - x);
}

// ---------------------------------------------------------------------------
// Radiação
// ---------------------------------------------------------------------------

/** Distância relativa inversa Terra-Sol: dr = 1 + 0,033 cos(2πJ/365). FAO-56 Eq. 23. */
function inverseRelativeDistance(doy: number): number {
  return 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
}

/** Declinação solar (rad): δ = 0,409 sin(2πJ/365 − 1,39). FAO-56 Eq. 24. */
function solarDeclination(doy: number): number {
  return 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
}

/** Ângulo horário do pôr do sol (rad): ωs = arccos(−tan φ tan δ). FAO-56 Eq. 25. */
function sunsetHourAngle(latitudeRad: number, declination: number): number {
  return Math.acos(-Math.tan(latitudeRad) * Math.tan(declination));
}

/**
 * Radiação extraterrestre (MJ m⁻² dia⁻¹) para latitude (graus, N positivo)
 * e dia do ano J:
 * Ra = (24·60/π) Gsc dr [ωs sin φ sin δ + cos φ cos δ sin ωs]. FAO-56 Eq. 21
 * (com Eq. 22 para φ em radianos, 23, 24 e 25).
 */
export function extraterrestrialRadiation(latitudeDeg: number, doy: number): number {
  const phi = latitudeDeg * DEG_TO_RAD;
  const dr = inverseRelativeDistance(doy);
  const delta = solarDeclination(doy);
  const ws = sunsetHourAngle(phi, delta);
  return (
    ((24 * 60) / Math.PI) *
    SOLAR_CONSTANT *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** Duração máxima da insolação (h): N = (24/π) ωs. FAO-56 Eq. 34. */
export function daylightHours(latitudeDeg: number, doy: number): number {
  const ws = sunsetHourAngle(latitudeDeg * DEG_TO_RAD, solarDeclination(doy));
  return (24 / Math.PI) * ws;
}

/**
 * Radiação solar (MJ m⁻² dia⁻¹) por horas de sol (Ångström):
 * Rs = (as + bs n/N) Ra, as = 0,25, bs = 0,50 na ausência de calibração.
 * FAO-56 Eq. 35.
 */
export function solarRadiationFromSunshine(
  sunshineHours: number,
  daylight: number,
  ra: number,
  as = 0.25,
  bs = 0.5,
): number {
  return (as + (bs * sunshineHours) / daylight) * ra;
}

/**
 * Radiação solar de céu claro (MJ m⁻² dia⁻¹):
 * Rso = (0,75 + 2·10⁻⁵ z) Ra. FAO-56 Eq. 37.
 */
export function clearSkyRadiation(ra: number, altitude: number): number {
  return (0.75 + 2e-5 * altitude) * ra;
}

/** Saldo de radiação de ondas curtas: Rns = (1 − α) Rs, α = 0,23. FAO-56 Eq. 38. */
export function netShortwaveRadiation(rs: number, albedo: number = REFERENCE_ALBEDO): number {
  return (1 - albedo) * rs;
}

/**
 * Saldo de radiação de ondas longas (MJ m⁻² dia⁻¹):
 * Rnl = σ [(Tmax,K⁴ + Tmin,K⁴)/2] (0,34 − 0,14 √ea) (1,35 Rs/Rso − 0,35).
 * FAO-56 Eq. 39. Rs/Rso é limitado a 1,0 como recomenda o texto.
 */
export function netLongwaveRadiation(
  tmax: number,
  tmin: number,
  ea: number,
  rs: number,
  rso: number,
): number {
  const tmaxK4 = Math.pow(tmax + 273.16, 4);
  const tminK4 = Math.pow(tmin + 273.16, 4);
  const relative = Math.min(rs / rso, 1);
  return STEFAN_BOLTZMANN * ((tmaxK4 + tminK4) / 2) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * relative - 0.35);
}

/**
 * Saldo de radiação (MJ m⁻² dia⁻¹) a partir da radiação solar medida:
 * Rn = Rns − Rnl, com Rso pela Eq. 37, Rns pela Eq. 38 e Rnl pela Eq. 39.
 * FAO-56 Eq. 40. Para dados de estação/CROPWAT; o ERA5-Land já entrega Rn.
 */
export function netRadiationFromSolar(
  rs: number,
  tmax: number,
  tmin: number,
  ea: number,
  latitudeDeg: number,
  doy: number,
  altitude: number,
): number {
  const ra = extraterrestrialRadiation(latitudeDeg, doy);
  const rso = clearSkyRadiation(ra, altitude);
  return netShortwaveRadiation(rs) - netLongwaveRadiation(tmax, tmin, ea, rs, rso);
}

// ---------------------------------------------------------------------------
// Vento
// ---------------------------------------------------------------------------

/**
 * Velocidade do vento a 2 m (m s⁻¹) a partir da medida na altura z (m):
 * u2 = uz · 4,87 / ln(67,8 z − 5,42). FAO-56 Eq. 47. Para z = 10 m o fator
 * é 0,748 — o valor citado em `docs/msa/algoritmos.md` §3.
 */
export function windSpeedAt2m(uz: number, measurementHeight = 10): number {
  return (uz * 4.87) / Math.log(67.8 * measurementHeight - 5.42);
}

// ---------------------------------------------------------------------------
// ET₀
// ---------------------------------------------------------------------------

/**
 * Núcleo da Eq. 6 com Δ, γ, es e ea já calculados e G = 0 (FAO-56 Eq. 42,
 * fluxo de calor no solo desprezível no passo diário):
 * ET₀ = [0,408 Δ (Rn − G) + γ · 900/(T + 273) · u2 (es − ea)] / [Δ + γ (1 + 0,34 u2)].
 */
export function penmanMonteith(
  tmean: number,
  delta: number,
  gamma: number,
  u2: number,
  rn: number,
  es: number,
  ea: number,
): number {
  const soilHeatFlux = 0; // Eq. 42
  const radiationTerm = 0.408 * delta * (rn - soilHeatFlux);
  const aerodynamicTerm = gamma * (900 / (tmean + 273)) * u2 * (es - ea);
  return (radiationTerm + aerodynamicTerm) / (delta + gamma * (1 + 0.34 * u2));
}

/**
 * ET₀ (mm dia⁻¹) com γ pré-calculado — para laços em que a altitude é fixa
 * (balanço hídrico, Monte Carlo) e não se quer recalcular P e γ a cada dia.
 * Temperatura média omitida → (Tmax + Tmin) / 2 (FAO-56 Eq. 9).
 */
export function referenceET0WithGamma(
  tmax: number,
  tmin: number,
  tmean: number | undefined,
  tdew: number,
  u2: number,
  rn: number,
  gamma: number,
): number {
  const t = tmean ?? (tmax + tmin) / 2;
  return penmanMonteith(
    t,
    slopeVapourPressureCurve(t),
    gamma,
    u2,
    rn,
    meanSaturationVapourPressure(tmax, tmin),
    actualVapourPressureFromDewpoint(tdew),
  );
}

/**
 * Evapotranspiração de referência FAO-56 Penman-Monteith (mm dia⁻¹).
 * FAO-56 Eq. 6, com Δ (Eq. 13), γ (Eq. 7–8), es (Eq. 12), ea (Eq. 14) e
 * G = 0 (Eq. 42). `docs/msa/algoritmos.md` §3.
 */
export function referenceET0(input: ET0Input): number {
  return referenceET0Detailed(input).et0;
}

/** Mesma Eq. 6, devolvendo também os intermediários. */
export function referenceET0Detailed(input: ET0Input): ET0Detail {
  const tmean = input.tmean ?? (input.tmax + input.tmin) / 2;
  const pressure = atmosphericPressure(input.altitude);
  const gamma = psychrometricConstant(pressure);
  const delta = slopeVapourPressureCurve(tmean);
  const es = meanSaturationVapourPressure(input.tmax, input.tmin);
  const ea = actualVapourPressureFromDewpoint(input.tdew);
  const et0 = penmanMonteith(tmean, delta, gamma, input.u2, input.rn, es, ea);
  return { et0, tmean, es, ea, delta, pressure, gamma };
}
