import { z } from 'zod';

/** Parâmetros científicos: congelados quando a cultivar tem safras (Decisão 6). */
export const CULTIVAR_PARAM_KEYS = [
  'tBase',
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

// Faixas plausíveis (FAO-56 tabelas 12 e 22; FAO-33 para Ky).
const kc = z.number().gt(0, 'deve ser maior que 0').max(1.5, 'deve ser no máximo 1.5');
const ky = z.number().min(0, 'deve ser no mínimo 0').max(1.5, 'deve ser no máximo 1.5');
const gdaThreshold = z.number().gt(0, 'deve ser maior que 0');
const zr = z.number().gt(0, 'deve ser maior que 0').max(3, 'deve ser no máximo 3 m');

export const cultivarParamsShape = {
  tBase: z.number().min(0, 'deve ser no mínimo 0 °C').max(20, 'deve ser no máximo 20 °C'),
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

export type CultivarParams = { [K in CultivarParamKey]: number };

/** Relações entre campos; o erro aponta o campo à direita da desigualdade. */
export function refineCultivarParams(value: CultivarParams, ctx: z.RefinementCtx): void {
  const issue = (path: CultivarParamKey, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (value.gdaF2End <= value.gdaF1End) issue('gdaF2End', 'deve ser maior que gdaF1End');
  if (value.gdaF3End <= value.gdaF2End) issue('gdaF3End', 'deve ser maior que gdaF2End');
  if (value.gdaF3End >= value.gdaTotal) issue('gdaF3End', 'deve ser menor que gdaTotal');
  if (value.zrIni > value.zrMax) issue('zrMax', 'deve ser maior ou igual a zrIni');
}

export const cultivarParamsSchema = z.object(cultivarParamsShape).superRefine(refineCultivarParams);

export function pickCultivarParams(source: Record<string, unknown>): Partial<CultivarParams> {
  const params: Partial<CultivarParams> = {};
  for (const key of CULTIVAR_PARAM_KEYS) {
    if (typeof source[key] === 'number') params[key] = source[key] as number;
  }
  return params;
}
