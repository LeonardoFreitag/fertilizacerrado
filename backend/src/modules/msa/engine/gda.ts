/**
 * Graus-dia acumulados (GDA).
 *
 * Fonte: OMETO, J. C. (1981). Bioclimatologia vegetal. Ed. Agronômica Ceres;
 * `docs/msa/algoritmos.md` §1.
 */

/**
 * GDA do dia: GDA_d = max((Tmax + Tmin) / 2 − Tbase, 0).
 * `docs/msa/algoritmos.md` §1, primeira equação. Nunca negativo.
 */
export function dailyGDA(tmax: number, tmin: number, tBase: number): number {
  return Math.max((tmax + tmin) / 2 - tBase, 0);
}

/**
 * GDA acumulado desde a emergência: GDA_acum(D) = Σ_{d=1..D} GDA_d.
 * `docs/msa/algoritmos.md` §1, segunda equação. Devolve uma série do mesmo
 * tamanho da entrada, com o acumulado ao fim de cada dia.
 */
export function accumulateGDA(
  series: ReadonlyArray<{ tmax: number; tmin: number }>,
  tBase: number,
): number[] {
  const out = new Array<number>(series.length);
  let accum = 0;
  for (let i = 0; i < series.length; i++) {
    const day = series[i]!;
    accum += dailyGDA(day.tmax, day.tmin, tBase);
    out[i] = accum;
  }
  return out;
}
