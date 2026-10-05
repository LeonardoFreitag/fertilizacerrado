/**
 * Balanço hídrico diário da zona radicular (modelo de depleção FAO-56).
 *
 * Fonte: FAO-56 cap. 8 — Eq. 82 (TAW), 83 (RAW), 84 (Ks), 85 (balanço);
 * `docs/msa/algoritmos.md` §5 (forma simplificada sem irrigação, escoamento
 * nem ascensão capilar).
 */
import { referenceET0WithGamma, atmosphericPressure, psychrometricConstant } from './et0';
import { dailyGDA } from './gda';
import { kcForPhase } from './kc';
import { phaseFromGDA, rootDepth } from './phenology';
import type {
  BalanceOptions,
  CultivarParams,
  DailyBalanceRow,
  DailyWeather,
  SoilParams,
} from './types';

/**
 * Total de água disponível na zona radicular (mm):
 * TAW = 1000 (θFC − θWP) Zr. FAO-56 Eq. 82.
 */
export function totalAvailableWater(thetaFC: number, thetaWP: number, zr: number): number {
  return 1000 * (thetaFC - thetaWP) * zr;
}

/** Água prontamente disponível (mm): RAW = p · TAW. FAO-56 Eq. 83. */
export function readilyAvailableWater(depletionFraction: number, taw: number): number {
  return depletionFraction * taw;
}

/**
 * Coeficiente de estresse hídrico:
 * Ks = 1 se Dr ≤ RAW; (TAW − Dr)/(TAW − RAW) se RAW < Dr ≤ TAW; 0 se Dr > TAW.
 * FAO-56 Eq. 84. Sempre em [0, 1]; no caso degenerado RAW = TAW não divide por zero.
 */
export function stressCoefficient(dr: number, taw: number, raw: number): number {
  if (dr <= raw) return 1;
  if (dr >= taw) return 0;
  // Aqui raw < dr < taw, logo taw > raw e a divisão é segura.
  return (taw - dr) / (taw - raw);
}

function assertFinite(value: number, name: string, index: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Dia ${index}: ${name} inválido (${String(value)})`);
  }
}

/**
 * Balanço hídrico diário desde a emergência.
 *
 * Para cada dia d, nesta ordem:
 *  1. GDA_d e GDA acumulado (ao fim do dia) → fase, Zr, Kc;
 *  2. TAW_d e RAW_d pelo Zr do dia (Eq. 82, 83) — a depleção não é alterada
 *     quando a raiz aprofunda;
 *  3. Ks com a depleção do início do dia (Eq. 84); ET₀ (Eq. 6); ETc = Kc·ET₀
 *     (Eq. 58); ETc_adj = Ks·ETc (Eq. 81);
 *  4. Dr_d = clamp(Dr_{d−1} − P_d + ETc_adj, 0, TAW_d) (Eq. 85 simplificada:
 *     chuva acima da depleção percola; Dr não excede TAW).
 *
 * Determinístico; um único laço com variáveis escalares, sem estruturas
 * intermediárias além da linha de saída de cada dia (é chamado ~1.000× pelo
 * Monte Carlo). `docs/msa/algoritmos.md` §5.
 */
export function runDailyBalance(
  days: ReadonlyArray<DailyWeather>,
  cultivar: CultivarParams,
  soil: SoilParams,
  options: BalanceOptions,
): DailyBalanceRow[] {
  assertFinite(options.altitude, 'altitude', -1);
  assertFinite(soil.thetaFC, 'thetaFC', -1);
  assertFinite(soil.thetaWP, 'thetaWP', -1);
  if (soil.thetaFC <= soil.thetaWP) {
    throw new RangeError('thetaFC deve ser maior que thetaWP');
  }

  const gamma = psychrometricConstant(atmosphericPressure(options.altitude));
  const rows = new Array<DailyBalanceRow>(days.length);

  let gdaAccum = 0;
  let dr = options.initialDepletion ?? 0;
  assertFinite(dr, 'initialDepletion', -1);
  if (dr < 0) throw new RangeError('initialDepletion não pode ser negativa');

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    assertFinite(day.tmax, 'tmax', i);
    assertFinite(day.tmin, 'tmin', i);
    assertFinite(day.tdew, 'tdew', i);
    assertFinite(day.u2, 'u2', i);
    assertFinite(day.rn, 'rn', i);
    assertFinite(day.precipitation, 'precipitation', i);
    if (day.tmean !== undefined) assertFinite(day.tmean, 'tmean', i);

    const gda = dailyGDA(day.tmax, day.tmin, cultivar.tBase);
    gdaAccum += gda;
    const phase = phaseFromGDA(gdaAccum, cultivar);
    const zr = rootDepth(gdaAccum, cultivar);
    const kc = kcForPhase(phase, gdaAccum, cultivar);

    const taw = totalAvailableWater(soil.thetaFC, soil.thetaWP, zr);
    const raw = readilyAvailableWater(cultivar.depletionFraction, taw);

    const ks = stressCoefficient(dr, taw, raw);
    const et0 = referenceET0WithGamma(day.tmax, day.tmin, day.tmean, day.tdew, day.u2, day.rn, gamma);
    const etc = kc * et0;
    const etcAdj = ks * etc;

    let next = dr - day.precipitation + etcAdj;
    if (next < 0) next = 0;
    else if (next > taw) next = taw;
    dr = next;

    rows[i] = {
      date: day.date,
      phase,
      gda,
      gdaAccum,
      zr,
      et0,
      kc,
      etc,
      precipitation: day.precipitation,
      dr,
      ks,
      etcAdj,
      taw,
      raw,
    };
  }

  return rows;
}
