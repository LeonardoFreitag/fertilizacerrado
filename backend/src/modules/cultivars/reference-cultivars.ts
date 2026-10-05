import type { Crop } from '@prisma/client';
import type { CultivarParams } from '../msa/engine/types';

export interface ReferenceCultivar extends CultivarParams {
  name: string;
  crop: Crop;
  cycleDescription: string;
}

/**
 * Cultivares de referência para o Cerrado. Gravadas pelo seed com
 * `isDefault = true` e imutáveis pela API; corrigir um valor é alterar aqui e
 * rodar o seed de novo. Usadas também pelos testes do motor e pelos scripts de
 * validação, para que todos partam dos mesmos números.
 *
 * Fontes:
 * - Allen, R. G.; Pereira, L. S.; Raes, D.; Smith, M. (1998). *Crop
 *   evapotranspiration — Guidelines for computing crop water requirements*.
 *   FAO Irrigation and Drainage Paper 56. Tabela 12 (Kc_ini, Kc_mid, Kc_end),
 *   Tabela 22 (Zr e fração de depleção p).
 * - Doorenbos, J.; Kassam, A. H. (1979). *Yield response to water*. FAO
 *   Irrigation and Drainage Paper 33. Coeficientes Ky por estádio.
 * - docs/modulos/msa.md e docs/msa/algoritmos.md: T_base, GDA total e limiares
 *   F1–F4 para o Cerrado; Kc_ini da soja reduzido de 0,40 para 0,20 pela
 *   cobertura morta do plantio direto.
 */
export const REFERENCE_CULTIVARS: readonly ReferenceCultivar[] = [
  {
    name: 'Soja — referência Cerrado (plantio direto)',
    crop: 'SOJA',
    cycleDescription:
      'Ciclo médio (~1200 °C·dia). Janelas: F1 0–120, F2 120–450, F3 450–900, F4 900–1200 °C·dia.',
    tBase: 10,
    gdaTotal: 1200,
    gdaF1End: 120,
    gdaF2End: 450,
    gdaF3End: 900,
    kcIni: 0.2,
    kcMid: 1.15,
    kcEnd: 0.5,
    depletionFraction: 0.5,
    zrIni: 0.3,
    zrMax: 0.95,
    kyF1: 0.2,
    kyF2: 0.8,
    kyF3: 1.0,
    kyF4: 0.4,
  },
  {
    name: 'Milho — referência Cerrado',
    crop: 'MILHO',
    cycleDescription:
      'Ciclo médio (~1500 °C·dia). Janelas: F1 0–150, F2 150–600, F3 600–1150, F4 1150–1500 °C·dia. Ky FAO-33: vegetativo 0,4; floração 1,5; enchimento 0,5.',
    tBase: 10,
    gdaTotal: 1500,
    gdaF1End: 150,
    gdaF2End: 600,
    gdaF3End: 1150,
    kcIni: 0.3,
    kcMid: 1.2,
    kcEnd: 0.6,
    depletionFraction: 0.55,
    zrIni: 0.3,
    zrMax: 1.0,
    kyF1: 0.4,
    kyF2: 0.4,
    kyF3: 1.5,
    kyF4: 0.5,
  },
];

export function referenceCultivar(crop: Crop): ReferenceCultivar {
  const found = REFERENCE_CULTIVARS.find((c) => c.crop === crop);
  if (!found) throw new Error(`Sem cultivar de referência para ${crop}`);
  return found;
}
