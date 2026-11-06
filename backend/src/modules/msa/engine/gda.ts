/**
 * Graus-dia acumulados (GDA) pelo método de Ometto.
 *
 * Fonte: OMETTO, J. C. (1981). Bioclimatologia vegetal. São Paulo: Editora
 * Agronômica Ceres — cinco situações em função das temperaturas-base inferior
 * (Tb) e superior (TB); `docs/msa/algoritmos.md` §1.
 */

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} deve ser um número finito: ${value}`);
}

/**
 * GDA do dia (°C·dia) pelas cinco situações de Ometto (1981), com Tb = `tBase`
 * e TB = `tUpper` (opcional):
 *
 * 1. Tb < Tmin ≤ Tmax            → (Tmax − Tmin)/2 + (Tmin − Tb)
 * 2. Tmin < Tb < Tmax            → (Tmax − Tb)² / [2 (Tmax − Tmin)]
 * 3. Tb ≥ Tmax                   → 0
 * 4. Tb < Tmin ≤ TB < Tmax       → [2 (Tmax − Tmin)(Tmin − Tb) + (Tmax − Tmin)² − (Tmax − TB)²] / [2 (Tmax − Tmin)]
 * 5. Tmin < Tb < TB < Tmax       → ½ [(Tmax − Tb)² − (Tmax − TB)²] / (Tmax − Tmin)
 *
 * Convenções (`docs/msa/algoritmos.md` §1): sem TB só os casos 1–3; TB só atua
 * quando Tmax > TB (com Tmax = TB os casos 4/5 coincidem com 1/2); Tmin ≥ TB ⇒
 * teto TB − Tb; Tmax = Tmin cai nos casos 1 ou 3 (não há divisão). O resultado
 * fica em [0, TB − Tb] com TB e em [0, +∞) sem TB. O método residual do motor
 * 1.x/2.0 ((Tmax + Tmin)/2 − Tb) é o caso 1.
 */
export function dailyGDA(tmax: number, tmin: number, tBase: number, tUpper?: number | null): number {
  assertFinite(tmax, 'tmax');
  assertFinite(tmin, 'tmin');
  assertFinite(tBase, 'tBase');
  if (tmax < tmin) throw new RangeError(`tmax (${tmax}) menor que tmin (${tmin})`);
  const hasUpper = tUpper !== undefined && tUpper !== null;
  if (hasUpper) {
    assertFinite(tUpper, 'tUpper');
    if (tUpper <= tBase) throw new RangeError(`tUpper (${tUpper}) deve ser maior que tBase (${tBase})`);
  }

  // caso 3
  if (tBase >= tmax) return 0;

  const cap = hasUpper && tmax > tUpper;
  let gd: number;
  if (cap && tmin >= tUpper) {
    gd = tUpper - tBase; // teto: todo o dia acima de TB
  } else if (tmin >= tBase) {
    gd = cap
      ? (2 * (tmax - tmin) * (tmin - tBase) + (tmax - tmin) ** 2 - (tmax - tUpper) ** 2) / (2 * (tmax - tmin)) // caso 4
      : (tmax - tmin) / 2 + (tmin - tBase); // caso 1
  } else {
    gd = cap
      ? 0.5 * ((tmax - tBase) ** 2 - (tmax - tUpper) ** 2) / (tmax - tmin) // caso 5
      : (tmax - tBase) ** 2 / (2 * (tmax - tmin)); // caso 2
  }

  if (gd < 0) return 0;
  if (hasUpper && gd > tUpper - tBase) return tUpper - tBase;
  return gd;
}

/**
 * GDA acumulado desde a emergência: GDA_acum(D) = Σ_{d=1..D} GDA_d, com o
 * mesmo método de `dailyGDA`. Devolve uma série do mesmo tamanho da entrada,
 * com o acumulado ao fim de cada dia.
 */
export function accumulateGDA(
  series: ReadonlyArray<{ tmax: number; tmin: number }>,
  tBase: number,
  tUpper?: number | null,
): number[] {
  const out = new Array<number>(series.length);
  let accum = 0;
  for (let i = 0; i < series.length; i++) {
    const day = series[i]!;
    accum += dailyGDA(day.tmax, day.tmin, tBase, tUpper);
    out[i] = accum;
  }
  return out;
}
