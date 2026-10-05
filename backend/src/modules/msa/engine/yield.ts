/**
 * Redução de produtividade por estresse hídrico e resumo por janela.
 *
 * Fonte: DOORENBOS, J.; KASSAM, A. H. (1979). Yield response to water. FAO
 * Irrigation and Drainage Paper 33, Eq. 3.2 (1 − Ya/Ym = Ky (1 − ETa/ETm)),
 * aplicada por janela com ETa/ETm ≈ Ks médio; `docs/msa/algoritmos.md` §6.
 */
import type { CultivarParams, DailyBalanceRow, PhaseSummary, YieldPhase } from './types';
import { YIELD_PHASES } from './types';

/**
 * Redução relativa de produtividade da janela: RY = Ky · (1 − Ks̄), em [0, 1].
 * FAO-33 Eq. 3.2 simplificada (`docs/msa/algoritmos.md` §6).
 */
export function yieldReduction(ksMean: number, ky: number): number {
  const reduction = ky * (1 - ksMean);
  return reduction < 0 ? 0 : reduction > 1 ? 1 : reduction;
}

function kyFor(phase: YieldPhase, cultivar: CultivarParams): number {
  switch (phase) {
    case 'F1':
      return cultivar.kyF1;
    case 'F2':
      return cultivar.kyF2;
    case 'F3':
      return cultivar.kyF3;
    case 'F4':
      return cultivar.kyF4;
  }
}

/**
 * Resumo por janela fenológica: dias, Ks médio, ETc_adj e precipitação
 * acumuladas e redução de produtividade (%) pela Eq. 3.2 do FAO-33.
 * Sempre devolve F1–F4 em ordem; janela sem dias tem `days = 0` e `ksMean` /
 * `yieldReductionPct` nulos. Dias COMPLETED são ignorados.
 */
export function summarizeByPhase(
  series: ReadonlyArray<DailyBalanceRow>,
  cultivar: CultivarParams,
): PhaseSummary[] {
  const days = [0, 0, 0, 0];
  const ksSum = [0, 0, 0, 0];
  const etcAdj = [0, 0, 0, 0];
  const precip = [0, 0, 0, 0];

  for (let i = 0; i < series.length; i++) {
    const row = series[i]!;
    if (row.phase === 'COMPLETED') continue;
    const idx = YIELD_PHASES.indexOf(row.phase);
    days[idx]!++;
    ksSum[idx]! += row.ks;
    etcAdj[idx]! += row.etcAdj;
    precip[idx]! += row.precipitation;
  }

  return YIELD_PHASES.map((phase, idx) => {
    const n = days[idx]!;
    const ksMean = n > 0 ? ksSum[idx]! / n : null;
    return {
      phase,
      days: n,
      ksMean,
      etcAdjAccum: etcAdj[idx]!,
      precipAccum: precip[idx]!,
      yieldReductionPct: ksMean === null ? null : yieldReduction(ksMean, kyFor(phase, cultivar)) * 100,
    };
  });
}
