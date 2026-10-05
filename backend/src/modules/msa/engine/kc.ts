/**
 * Coeficiente de cultura por janela fenológica.
 *
 * Fonte: FAO-56 cap. 6 (curva Kc em três valores: Kc_ini, Kc_mid, Kc_end,
 * Tabela 12) com a interpolação linear dos trechos de desenvolvimento e final
 * feita em GDA, não em dias; `docs/msa/algoritmos.md` §4.
 */
import type { CultivarParams, Phase } from './types';

function lerp(from: number, to: number, fraction: number): number {
  const t = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return from + (to - from) * t;
}

/**
 * Kc do dia: F1 = Kc_ini; F2 = linear Kc_ini → Kc_mid em [gdaF1End, gdaF2End];
 * F3 = Kc_mid; F4 = linear Kc_mid → Kc_end em [gdaF3End, gdaTotal];
 * COMPLETED = Kc_end. Contínuo nas quatro transições.
 * FAO-56 cap. 6, Fig. 25 (curva Kc); `docs/msa/algoritmos.md` §4.
 */
export function kcForPhase(phase: Phase, gdaAccum: number, cultivar: CultivarParams): number {
  switch (phase) {
    case 'F1':
      return cultivar.kcIni;
    case 'F2':
      return lerp(
        cultivar.kcIni,
        cultivar.kcMid,
        (gdaAccum - cultivar.gdaF1End) / (cultivar.gdaF2End - cultivar.gdaF1End),
      );
    case 'F3':
      return cultivar.kcMid;
    case 'F4':
      return lerp(
        cultivar.kcMid,
        cultivar.kcEnd,
        (gdaAccum - cultivar.gdaF3End) / (cultivar.gdaTotal - cultivar.gdaF3End),
      );
    case 'COMPLETED':
      return cultivar.kcEnd;
  }
}
