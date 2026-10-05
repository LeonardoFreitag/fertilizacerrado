/**
 * Análise de risco por Monte Carlo sobre o balanço hídrico.
 *
 * Fonte: `docs/msa/algoritmos.md` §7 (perturbação de precipitação εP ~ N(0;
 * 0,30²) multiplicativa e de temperatura εT ~ N(0; 0,6²) aditiva; percentis
 * P10/P50/P90 do Ks médio por janela); Metropolis & Ulam (1949); Hersbach et
 * al. (2020) para a incerteza do ERA5-Land.
 */
import { mulberry32, sampleNormal } from './random';
import type {
  CultivarParams,
  DailyWeather,
  MonteCarloOptions,
  MonteCarloResult,
  Percentiles,
  PhasePercentiles,
  SoilParams,
} from './types';
import { YIELD_PHASES } from './types';
import { runDailyBalance } from './water-balance';
import { summarizeByPhase } from './yield';

export const DEFAULT_ITERATIONS = 1000;
export const DEFAULT_SIGMA_PRECIP = 0.3;
export const DEFAULT_SIGMA_TEMP = 0.6;

/**
 * Percentil por interpolação linear entre ordens — tipo 7 de Hyndman & Fan
 * (1996), o padrão de R (`quantile`) e NumPy (`linear`): h = (n − 1)·p,
 * resultado = x[⌊h⌋] + (h − ⌊h⌋)(x[⌊h⌋+1] − x[⌊h⌋]). `sorted` ascendente, n ≥ 1.
 */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) throw new RangeError('percentil de amostra vazia');
  if (p < 0 || p > 1) throw new RangeError(`p fora de [0, 1]: ${p}`);
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

function percentiles(values: Float64Array, count: number): Percentiles | null {
  if (count === 0) return null;
  const sorted = values.subarray(0, count).slice().sort();
  return { p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) };
}

function assertOptions(options: MonteCarloOptions): { iterations: number; sigmaPrecip: number; sigmaTemp: number } {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const sigmaPrecip = options.sigmaPrecip ?? DEFAULT_SIGMA_PRECIP;
  const sigmaTemp = options.sigmaTemp ?? DEFAULT_SIGMA_TEMP;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError(`iterations deve ser inteiro ≥ 1: ${String(iterations)}`);
  }
  if (!Number.isFinite(options.seed)) throw new RangeError('seed é obrigatória e deve ser um número finito');
  if (!(sigmaPrecip >= 0)) throw new RangeError(`sigmaPrecip deve ser ≥ 0: ${String(sigmaPrecip)}`);
  if (!(sigmaTemp >= 0)) throw new RangeError(`sigmaTemp deve ser ≥ 0: ${String(sigmaTemp)}`);
  return { iterations, sigmaPrecip, sigmaTemp };
}

/**
 * Executa `iterations` balanços hídricos perturbados e devolve P10/P50/P90 por
 * janela de `ksMean`, `yieldReductionPct` e `etcAdjAccum`.
 *
 * Por iteração i sorteiam-se, nesta ordem, f_i = max(0, N(1, σP²)) e
 * δ_i = N(0, σT²); f_i multiplica a precipitação de todos os dias e δ_i
 * soma-se a tmax, tmin e tmean de todos os dias (tdew e rn ficam). A
 * perturbação é sistemática por iteração — representa viés da reanálise e
 * variabilidade interanual, correlacionados no tempo; ruído diário
 * independente se cancelaria na soma da janela e estreitaria o P10–P90
 * (design, Decisão 2).
 *
 * Os percentis de cada janela consideram só as iterações em que a janela teve
 * dias (`validIterations`). Determinístico para a mesma semente. Um único
 * array de rascunho é mutado a cada iteração; não há alocação por dia além
 * das linhas que `runDailyBalance` devolve.
 */
export function runMonteCarlo(
  days: ReadonlyArray<DailyWeather>,
  cultivar: CultivarParams,
  soil: SoilParams,
  options: MonteCarloOptions,
): MonteCarloResult {
  const { iterations, sigmaPrecip, sigmaTemp } = assertOptions(options);
  const balanceOptions = { altitude: options.altitude, initialDepletion: options.initialDepletion };

  const baselineSeries = runDailyBalance(days, cultivar, soil, balanceOptions);
  const baseline = summarizeByPhase(baselineSeries, cultivar);

  // Rascunho reutilizado: só os campos perturbados mudam a cada iteração.
  const scratch: DailyWeather[] = days.map((d) => ({ ...d }));

  const ks = YIELD_PHASES.map(() => new Float64Array(iterations));
  const yieldPct = YIELD_PHASES.map(() => new Float64Array(iterations));
  const etcAdj = YIELD_PHASES.map(() => new Float64Array(iterations));
  const counts = [0, 0, 0, 0];

  const rand = mulberry32(options.seed);

  for (let it = 0; it < iterations; it++) {
    const factor = Math.max(0, sampleNormal(rand, 1, sigmaPrecip));
    const shift = sampleNormal(rand, 0, sigmaTemp);

    for (let i = 0; i < days.length; i++) {
      const src = days[i]!;
      const dst = scratch[i]!;
      dst.tmax = src.tmax + shift;
      dst.tmin = src.tmin + shift;
      dst.tmean = src.tmean === undefined ? undefined : src.tmean + shift;
      dst.precipitation = src.precipitation * factor;
    }

    const summary = summarizeByPhase(runDailyBalance(scratch, cultivar, soil, balanceOptions), cultivar);
    for (let p = 0; p < 4; p++) {
      const s = summary[p]!;
      if (s.days === 0 || s.ksMean === null || s.yieldReductionPct === null) continue;
      const idx = counts[p]!++;
      ks[p]![idx] = s.ksMean;
      yieldPct[p]![idx] = s.yieldReductionPct;
      etcAdj[p]![idx] = s.etcAdjAccum;
    }
  }

  const phases: PhasePercentiles[] = YIELD_PHASES.map((phase, p) => ({
    phase,
    validIterations: counts[p]!,
    ksMean: percentiles(ks[p]!, counts[p]!),
    yieldReductionPct: percentiles(yieldPct[p]!, counts[p]!),
    etcAdjAccum: percentiles(etcAdj[p]!, counts[p]!),
  }));

  return { iterations, seed: options.seed, sigmaPrecip, sigmaTemp, baseline, baselineSeries, phases };
}
