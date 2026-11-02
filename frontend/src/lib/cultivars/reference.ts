/** Divergência e sincronização com a cultivar de referência (espelho de cultivar.service.fieldsToSync). */
import { CULTIVAR_PARAM_KEYS, type CultivarParamKey, type CultivarParams, type SyncReferenceMode } from '../api/types';

/** Converte os valores do formulário ("1,15") em números; campo vazio/inválido vira NaN. */
export function toNumbers(values: Partial<Record<CultivarParamKey, string | number>>): Record<CultivarParamKey, number> {
  const out = {} as Record<CultivarParamKey, number>;
  for (const k of CULTIVAR_PARAM_KEYS) {
    const v = values[k];
    out[k] = typeof v === 'number' ? v : v == null || v === '' ? Number.NaN : Number(String(v).replace(',', '.'));
  }
  return out;
}

/** Parâmetros cujo valor atual difere da referência (NaN conta como divergente). */
export function divergentFields(current: Record<CultivarParamKey, number>, reference: CultivarParams): CultivarParamKey[] {
  return CULTIVAR_PARAM_KEYS.filter((k) => current[k] !== reference[k]);
}

/**
 * Campos que o sync vai substituir. `unchanged`: só os iguais ao `referenceSnapshot`
 * (o técnico não mexeu) e diferentes da referência atual; `all`: todos os diferentes.
 */
export function fieldsToSync(
  current: Record<CultivarParamKey, number>,
  snapshot: Partial<CultivarParams> | null,
  reference: CultivarParams,
  mode: SyncReferenceMode,
): CultivarParamKey[] {
  return CULTIVAR_PARAM_KEYS.filter((k) => {
    if (current[k] === reference[k]) return false;
    if (mode === 'all') return true;
    return snapshot != null && snapshot[k] !== undefined && current[k] === snapshot[k];
  });
}

export function divergenceLabel(count: number): string {
  if (count === 0) return 'igual à referência';
  return count === 1 ? '1 parâmetro difere da referência' : `${count} parâmetros diferem da referência`;
}
