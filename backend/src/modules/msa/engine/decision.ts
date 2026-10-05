/**
 * Cenários de intervenção a partir do P50 do Ks da janela.
 *
 * Fonte: `docs/msa/algoritmos.md` §8 — (a) redução de dose, (b) parcelamento
 * pela razão de ETc das duas metades da janela seguinte, (c) fator de
 * eficiência. A interpretação agronômica e a escolha são do técnico; o motor
 * descreve, não recomenda.
 */
import type { CultivarParams, DecisionInput, DecisionScenarios, ScenarioB, YieldPhase } from './types';

const NEXT_PHASE: Record<YieldPhase, YieldPhase | null> = { F1: 'F2', F2: 'F3', F3: 'F4', F4: null };

/** Janela seguinte à informada; null para F4. */
export function nextPhase(phase: YieldPhase): YieldPhase | null {
  return NEXT_PHASE[phase];
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

const f2 = (v: number) => v.toFixed(2);

function assertInput(input: DecisionInput): void {
  if (!(input.phase in NEXT_PHASE)) throw new RangeError(`fase inválida: ${String(input.phase)}`);
  if (!(input.ksP50 >= 0 && input.ksP50 <= 1)) throw new RangeError(`ksP50 fora de [0, 1]: ${String(input.ksP50)}`);
  if (!(input.doseBase >= 0)) throw new RangeError(`doseBase deve ser ≥ 0: ${String(input.doseBase)}`);
  if (!(input.efficiencyBase >= 0)) {
    throw new RangeError(`efficiencyBase deve ser ≥ 0: ${String(input.efficiencyBase)}`);
  }
}

/**
 * Cenário (b): divide os dias da janela seguinte na série baseline em duas
 * metades consecutivas (a primeira com ⌈n/2⌉ dias) e reparte a dose na razão
 * da ETc (demanda potencial) de cada metade: f1 = ΣETc₁/(ΣETc₁ + ΣETc₂).
 * `docs/msa/algoritmos.md` §8, cenário (b).
 */
function splitScenario(input: DecisionInput): { b: ScenarioB | null; reason: string | null } {
  const next = nextPhase(input.phase);
  if (next === null) {
    return { b: null, reason: `${input.phase} é a última janela; não há janela seguinte para parcelar.` };
  }

  const rows = input.baselineSeries.filter((r) => r.phase === next);
  if (rows.length < 2) {
    return {
      b: null,
      reason:
        rows.length === 0
          ? `A série baseline não alcança ${next}; sem dias para dividir.`
          : `A série baseline tem apenas 1 dia em ${next}; são necessários ao menos 2.`,
    };
  }

  const days1 = Math.ceil(rows.length / 2);
  const days2 = rows.length - days1;
  let etc1 = 0;
  let etc2 = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i < days1) etc1 += rows[i]!.etc;
    else etc2 += rows[i]!.etc;
  }
  const total = etc1 + etc2;
  const fraction1 = total > 0 ? etc1 / total : 0.5;
  const fraction2 = 1 - fraction1;

  return {
    b: {
      nextPhase: next,
      days1,
      days2,
      etc1,
      etc2,
      fraction1,
      fraction2,
      dose1: input.doseBase * fraction1,
      dose2: input.doseBase * fraction2,
      rationale: `Dose de ${f2(input.doseBase)} dividida entre as duas metades de ${next} (${days1} + ${days2} dias) na razão da ETc projetada pela série baseline: ${f2(etc1)} e ${f2(etc2)} mm, ou ${(fraction1 * 100).toFixed(0)} % e ${(fraction2 * 100).toFixed(0)} %.`,
    },
    reason: null,
  };
}

/**
 * Gera os três cenários de `docs/msa/algoritmos.md` §8 para a janela
 * informada a partir do P50 do Ks médio (Monte Carlo). Cada cenário traz os
 * números e um racional descritivo; nenhum é recomendado.
 */
export function generateDecisionScenarios(input: DecisionInput): DecisionScenarios {
  assertInput(input);
  const { phase, ksP50, doseBase, efficiencyBase, cultivar } = input;
  const ky = kyFor(phase, cultivar);
  const reductionPct = (1 - ksP50) * 100;

  const a = {
    doseBase,
    ksP50,
    doseAdjusted: doseBase * ksP50,
    reductionPct,
    rationale: `Dose ajustada de ${f2(doseBase)} para ${f2(doseBase * ksP50)} (−${reductionPct.toFixed(0)} %), proporcional ao Ks mediano de ${f2(ksP50)} em ${phase} (Ky da janela ${f2(ky)}).`,
  };

  const { b, reason } = splitScenario(input);

  const c = {
    efficiencyBase,
    ksP50,
    efficiencyAdjusted: efficiencyBase * ksP50,
    rationale: `Eficiência de uso ajustada de ${f2(efficiencyBase)} para ${f2(efficiencyBase * ksP50)}, proporcional ao Ks mediano de ${f2(ksP50)} em ${phase}.`,
  };

  return { phase, ksP50, a, b, bUnavailableReason: reason, c };
}
