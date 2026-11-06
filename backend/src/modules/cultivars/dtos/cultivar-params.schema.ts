import { z } from 'zod';

/** Parâmetros científicos da cultivar (16): gravados no snapshot de cada run e no referenceSnapshot. */
export const CULTIVAR_PARAM_KEYS = [
  'tBase',
  'tUpper',
  'gdaTotal',
  'gdaF1End',
  'gdaF2End',
  'gdaF3End',
  'kcIni',
  'kcMid',
  'kcEnd',
  'depletionFraction',
  'zrIni',
  'zrMax',
  'kyF1',
  'kyF2',
  'kyF3',
  'kyF4',
] as const;

export type CultivarParamKey = (typeof CULTIVAR_PARAM_KEYS)[number];

/** Parâmetros que aceitam `null` como valor legítimo (tUpper nulo = sem limite superior). */
export const NULLABLE_PARAM_KEYS = ['tUpper'] as const satisfies readonly CultivarParamKey[];
export type NullableParamKey = (typeof NULLABLE_PARAM_KEYS)[number];

// Faixas plausíveis (FAO-56 tabelas 12 e 22; FAO-33 para Ky).
const kc = z.number().gt(0, 'deve ser maior que 0').max(1.5, 'deve ser no máximo 1.5');
const ky = z.number().min(0, 'deve ser no mínimo 0').max(1.5, 'deve ser no máximo 1.5');
const gdaThreshold = z.number().gt(0, 'deve ser maior que 0');
const zr = z.number().gt(0, 'deve ser maior que 0').max(3, 'deve ser no máximo 3 m');

export const cultivarParamsShape = {
  tBase: z.number().min(0, 'deve ser no mínimo 0 °C').max(20, 'deve ser no máximo 20 °C'),
  // Temperatura-base superior (Ometto): null = sem limite; faixa plausível 15–50 °C; > tBase (refine).
  tUpper: z.number().min(15, 'deve ser no mínimo 15 °C').max(50, 'deve ser no máximo 50 °C').nullable(),
  gdaTotal: z
    .number()
    .min(300, 'deve ser no mínimo 300 °C·dia')
    .max(4000, 'deve ser no máximo 4000 °C·dia'),
  gdaF1End: gdaThreshold,
  gdaF2End: gdaThreshold,
  gdaF3End: gdaThreshold,
  kcIni: kc,
  kcMid: kc,
  kcEnd: kc,
  depletionFraction: z
    .number()
    .gt(0, 'deve ser maior que 0')
    .lt(1, 'deve ser menor que 1'),
  zrIni: zr,
  zrMax: zr,
  kyF1: ky,
  kyF2: ky,
  kyF3: ky,
  kyF4: ky,
} satisfies Record<CultivarParamKey, z.ZodTypeAny>;

export type CultivarParams = { [K in Exclude<CultivarParamKey, NullableParamKey>]: number } & { [K in NullableParamKey]: number | null };

/** Relações entre campos; o erro aponta o campo à direita da desigualdade. */
export function refineCultivarParams(value: CultivarParams, ctx: z.RefinementCtx): void {
  const issue = (path: CultivarParamKey, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (value.tUpper !== null && value.tUpper !== undefined && value.tUpper <= value.tBase) issue('tUpper', 'deve ser maior que tBase');
  if (value.gdaF2End <= value.gdaF1End) issue('gdaF2End', 'deve ser maior que gdaF1End');
  if (value.gdaF3End <= value.gdaF2End) issue('gdaF3End', 'deve ser maior que gdaF2End');
  if (value.gdaF3End >= value.gdaTotal) issue('gdaF3End', 'deve ser menor que gdaTotal');
  if (value.zrIni > value.zrMax) issue('zrMax', 'deve ser maior ou igual a zrIni');
}

export const cultivarParamsSchema = z.object(cultivarParamsShape).superRefine(refineCultivarParams);

export function pickCultivarParams(source: Record<string, unknown>): Partial<CultivarParams> {
  const params: Record<string, number | null> = {};
  for (const key of CULTIVAR_PARAM_KEYS) {
    const v = source[key];
    if (typeof v === 'number') params[key] = v;
    else if (v === null && (NULLABLE_PARAM_KEYS as readonly string[]).includes(key)) params[key] = null;
  }
  return params as Partial<CultivarParams>;
}
