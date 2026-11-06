import type { Crop } from '@prisma/client';
import type { CultivarParams } from '../msa/engine/types';

export interface ReferenceCultivar extends CultivarParams {
  name: string;
  crop: Crop;
  cycleDescription: string;
}

/**
 * Cultivar de referência para o Cerrado (só soja — Fase 1). Gravada pelo seed
 * com `isDefault = true` e imutável pela API; corrigir um valor é alterar aqui
 * e rodar o seed de novo (as cultivares próprias acompanham via
 * `POST /cultivars/:id/sync-reference`). Usada também pelos testes do motor e
 * pelos scripts de validação, para que todos partam dos mesmos números.
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
    // Temperatura-base superior (Ometto) — valor provisório; ver docs/msa/questoes-abertas.md #10
    tUpper: 30,
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
];

export function referenceCultivar(crop: Crop): ReferenceCultivar {
  const found = REFERENCE_CULTIVARS.find((c) => c.crop === crop);
  if (!found) throw new Error(`Sem cultivar de referência para ${crop}`);
  return found;
}
