/**
 * Redução de produtividade por estresse hídrico e resumo por janela.
 *
 * Fonte: DOORENBOS, J.; KASSAM, A. H. (1979). Yield response to water. FAO
 * Irrigation and Drainage Paper 33, Eq. 3.2 (1 − Ya/Ym = Ky (1 − ETa/ETm)),
 * aplicada por janela com ETa/ETm ≈ Ks médio; `docs/msa/algoritmos.md` §6.
 */
import type { CultivarParams, CycleYield, DailyBalanceRow, PhaseSummary, YieldPhase } from './types';
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
 * `yieldReductionPct` nulos. Dias PRE (entressafra) e COMPLETED são ignorados.
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
    if (row.phase === 'COMPLETED' || row.phase === 'PRE') continue; // fora das janelas com Ky
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

/**
 * Índice de produtividade do ciclo: combinação multiplicativa das janelas,
 * Ya/Ym = Π_j [1 − Ky_j · (1 − Ks̄_j)] (FAO-33, Doorenbos & Kassam 1979,
 * resposta a déficits em estádios sucessivos; `docs/msa/algoritmos.md` §6).
 * Reaproveita `yieldReductionPct` de `summarizeByPhase`; janela sem dias
 * (não alcançada) entra com fator 1 — "o restante do ciclo sem estresse".
 * `phasesReached` é o número de janelas com dias.
 */
export function cycleYieldIndex(summaries: ReadonlyArray<PhaseSummary>): CycleYield {
  const factors: [number, number, number, number] = [1, 1, 1, 1];
  let phasesReached = 0;
  for (const phase of YIELD_PHASES) {
    const s = summaries.find((x) => x.phase === phase);
    if (!s) throw new RangeError(`Resumo da janela ${phase} ausente`);
    if (s.days > 0) {
      phasesReached++;
      const reduction = s.yieldReductionPct ?? 0;
      if (!Number.isFinite(reduction)) throw new RangeError(`yieldReductionPct inválido em ${phase}: ${reduction}`);
      const f = 1 - reduction / 100;
      factors[YIELD_PHASES.indexOf(phase)] = f < 0 ? 0 : f > 1 ? 1 : f;
    }
  }
  const yieldIndex = factors[0] * factors[1] * factors[2] * factors[3];
  return { yieldIndex, phasesReached, factors };
}

/**
 * Produtividade predita: Ya = Ym × índice do ciclo (FAO-33 Eq. 3.2 invertida
 * para Ya; `docs/msa/algoritmos.md` §6). `ym` em sc/ha (ou qualquer unidade
 * de Ya); o resultado sai na mesma unidade.
 */
export function predictedYield(ym: number, yieldIndex: number): number {
  if (!Number.isFinite(ym) || ym <= 0) throw new RangeError(`ym deve ser finito e > 0: ${ym}`);
  if (!Number.isFinite(yieldIndex) || yieldIndex < 0 || yieldIndex > 1) {
    throw new RangeError(`yieldIndex deve estar em [0, 1]: ${yieldIndex}`);
  }
  return ym * yieldIndex;
}
