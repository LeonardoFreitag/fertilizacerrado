/** Divergência e sincronização com a cultivar de referência (espelho de cultivar.service.fieldsToSync). */
import { CULTIVAR_PARAM_KEYS, NULLABLE_PARAM_KEYS, type CultivarParamKey, type CultivarParams, type SyncReferenceMode } from '../api/types';

const isNullable = (k: CultivarParamKey) => (NULLABLE_PARAM_KEYS as readonly string[]).includes(k);

/** Valores numéricos por chave; `null` só nas chaves anuláveis (vazio = sem valor), NaN nas demais quando vazias/inválidas. */
export type ParamValues = Record<CultivarParamKey, number | null>;

/** Converte os valores do formulário ("1,15") em números; vazio vira `null` nas chaves anuláveis e NaN nas demais. */
export function toNumbers(values: Partial<Record<CultivarParamKey, string | number | null>>): ParamValues {
  const out = {} as ParamValues;
  for (const k of CULTIVAR_PARAM_KEYS) {
    const v = values[k];
    if (typeof v === 'number') out[k] = v;
    else if (v == null || v === '') out[k] = isNullable(k) ? null : Number.NaN;
    else out[k] = Number(String(v).replace(',', '.'));
  }
  return out;
}

/** Parâmetros cujo valor atual difere da referência (NaN conta como divergente; null === null é igual). */
export function divergentFields(current: ParamValues, reference: CultivarParams): CultivarParamKey[] {
  return CULTIVAR_PARAM_KEYS.filter((k) => current[k] !== reference[k]);
}

/**
 * Campos que o sync vai substituir. `unchanged`: só os iguais ao `referenceSnapshot`
 * (o técnico não mexeu) e diferentes da referência atual; `all`: todos os diferentes.
 */
export function fieldsToSync(
  current: ParamValues,
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
