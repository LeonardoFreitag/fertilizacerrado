/**
 * Fenologia térmica: janela a partir do GDA acumulado e profundidade radicular.
 *
 * Fonte: `docs/msa/algoritmos.md` §2 (janelas) e §5 (Zr); FAO-56 Tabela 22
 * (faixas de Zr por cultura).
 */
import type { CultivarParams, Phase } from './types';

/**
 * Janela fenológica pelo GDA acumulado, com limite inferior inclusivo:
 * F1: gda < gdaF1End · F2: gdaF1End ≤ gda < gdaF2End ·
 * F3: gdaF2End ≤ gda < gdaF3End · F4: gdaF3End ≤ gda < gdaTotal ·
 * COMPLETED: gda ≥ gdaTotal. `docs/msa/algoritmos.md` §2.
 */
export function phaseFromGDA(gdaAccum: number, cultivar: CultivarParams): Phase {
  if (gdaAccum < cultivar.gdaF1End) return 'F1';
  if (gdaAccum < cultivar.gdaF2End) return 'F2';
  if (gdaAccum < cultivar.gdaF3End) return 'F3';
  if (gdaAccum < cultivar.gdaTotal) return 'F4';
  return 'COMPLETED';
}

/**
 * Profundidade efetiva da zona radicular (m): linear de zrIni (GDA 0) a zrMax
 * no início de F3 (GDA = gdaF2End), constante depois. Nunca decresce.
 * `docs/msa/algoritmos.md` §5 ("0,30 m (F1) → 0,95 m (F3/F4)"); FAO-56 cap. 8,
 * nota sobre o crescimento de Zr com o desenvolvimento da cultura.
 */
export function rootDepth(gdaAccum: number, cultivar: CultivarParams): number {
  if (gdaAccum <= 0) return cultivar.zrIni;
  if (gdaAccum >= cultivar.gdaF2End) return cultivar.zrMax;
  const fraction = gdaAccum / cultivar.gdaF2End;
  return cultivar.zrIni + (cultivar.zrMax - cultivar.zrIni) * fraction;
}
