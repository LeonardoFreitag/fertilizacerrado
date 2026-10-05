/**
 * Métricas do protocolo de validação (`docs/msa/validacao.md`):
 * RMSE, R², NSE (Nash & Sutcliffe, 1970) e PBIAS (Moriasi et al., 2007).
 * S = simulado, O = observado/referência.
 */

export interface ValidationMetrics {
  n: number;
  rmse: number;
  r2: number;
  nse: number;
  pbias: number;
}

/** Critérios de aceitação para ET₀ (`docs/msa/validacao.md`). */
export const ET0_CRITERIA = { rmse: 0.5, r2: 0.95, nse: 0.8, pbiasAbs: 10 } as const;

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function computeMetrics(simulated: readonly number[], observed: readonly number[]): ValidationMetrics {
  if (simulated.length !== observed.length || simulated.length === 0) {
    throw new RangeError('séries simulada e observada devem ter o mesmo tamanho, maior que zero');
  }
  const n = simulated.length;
  const sMean = mean(simulated);
  const oMean = mean(observed);

  let sumSqErr = 0;
  let sumObsDev = 0;
  let cov = 0;
  let sVar = 0;
  let oVar = 0;
  let sumObs = 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    const s = simulated[i]!;
    const o = observed[i]!;
    sumSqErr += (s - o) ** 2;
    sumObsDev += (o - oMean) ** 2;
    cov += (s - sMean) * (o - oMean);
    sVar += (s - sMean) ** 2;
    oVar += (o - oMean) ** 2;
    sumObs += o;
    sumDiff += o - s;
  }

  const rmse = Math.sqrt(sumSqErr / n);
  // R² = (Pearson)²; indefinido quando uma das séries é constante
  const r2 = sVar > 0 && oVar > 0 ? (cov / Math.sqrt(sVar * oVar)) ** 2 : Number.NaN;
  const nse = sumObsDev > 0 ? 1 - sumSqErr / sumObsDev : Number.NaN;
  const pbias = sumObs !== 0 ? (sumDiff / sumObs) * 100 : Number.NaN;

  return { n, rmse, r2, nse, pbias };
}

export function meetsCriteria(m: ValidationMetrics) {
  return {
    rmse: m.rmse <= ET0_CRITERIA.rmse,
    r2: m.r2 >= ET0_CRITERIA.r2,
    nse: m.nse >= ET0_CRITERIA.nse,
    pbias: Math.abs(m.pbias) <= ET0_CRITERIA.pbiasAbs,
  };
}
