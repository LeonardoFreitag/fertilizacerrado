/** Espelho de backend/src/modules/cultivars/dtos (faixas FAO-56/FAO-33 e relações). */
import { z } from 'zod';
import type { CultivarParamKey } from '../api/types';

const number = (schema: z.ZodNumber) =>
  z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return undefined;
    return typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  }, schema);

const kc = z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).gt(0, 'deve ser maior que 0').max(1.5, 'deve ser no máximo 1,5');
const ky = z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).min(0, 'deve ser no mínimo 0').max(1.5, 'deve ser no máximo 1,5');
const gda = z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).gt(0, 'deve ser maior que 0');
const zr = z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).gt(0, 'deve ser maior que 0').max(3, 'deve ser no máximo 3 m');

export const cultivarParamsShape = {
  tBase: number(z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).min(0, 'deve ser no mínimo 0 °C').max(20, 'deve ser no máximo 20 °C')),
  gdaTotal: number(z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).min(300, 'deve ser no mínimo 300 °C·dia').max(4000, 'deve ser no máximo 4000 °C·dia')),
  gdaF1End: number(gda),
  gdaF2End: number(gda),
  gdaF3End: number(gda),
  kcIni: number(kc),
  kcMid: number(kc),
  kcEnd: number(kc),
  depletionFraction: number(z.number({ required_error: 'obrigatório', invalid_type_error: 'obrigatório' }).gt(0, 'deve ser maior que 0').lt(1, 'deve ser menor que 1')),
  zrIni: number(zr),
  zrMax: number(zr),
  kyF1: number(ky),
  kyF2: number(ky),
  kyF3: number(ky),
  kyF4: number(ky),
} satisfies Record<CultivarParamKey, z.ZodTypeAny>;

/** Relações entre campos; o erro aponta o campo à direita da desigualdade (como a API). */
export function refineCultivarParams(v: Record<CultivarParamKey, number>, ctx: z.RefinementCtx): void {
  const issue = (path: CultivarParamKey, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (v.gdaF2End <= v.gdaF1End) issue('gdaF2End', 'deve ser maior que gdaF1End');
  if (v.gdaF3End <= v.gdaF2End) issue('gdaF3End', 'deve ser maior que gdaF2End');
  if (v.gdaF3End >= v.gdaTotal) issue('gdaF3End', 'deve ser menor que gdaTotal');
  if (v.zrIni > v.zrMax) issue('zrMax', 'deve ser maior ou igual a zrIni');
}

export const cultivarSchema = z
  .object({
    name: z.string().trim().min(2, 'deve ter no mínimo 2 caracteres').max(120, 'deve ter no máximo 120 caracteres'),
    crop: z.enum(['SOJA', 'MILHO'], { errorMap: () => ({ message: 'escolha a cultura' }) }),
    cycleDescription: z
      .string()
      .trim()
      .max(500, 'deve ter no máximo 500 caracteres')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    ...cultivarParamsShape,
  })
  .superRefine((v, ctx) => refineCultivarParams(v, ctx));

export type CultivarForm = z.infer<typeof cultivarSchema>;

/** Grupos exibidos no formulário, com rótulo, unidade e ajuda. */
export const CULTIVAR_GROUPS: { title: string; help: string; fields: { key: CultivarParamKey; label: string; unit?: string; step?: string }[] }[] = [
  {
    title: 'Térmicos',
    help: 'Graus-dia acumulados (GDA) que definem o ciclo. Os limiares encerram F1, F2 e F3; F4 vai até o GDA total.',
    fields: [
      { key: 'tBase', label: 'Temperatura-base', unit: '°C', step: '0.1' },
      { key: 'gdaTotal', label: 'GDA total do ciclo', unit: '°C·dia', step: '1' },
      { key: 'gdaF1End', label: 'Fim de F1', unit: '°C·dia', step: '1' },
      { key: 'gdaF2End', label: 'Fim de F2', unit: '°C·dia', step: '1' },
      { key: 'gdaF3End', label: 'Fim de F3', unit: '°C·dia', step: '1' },
    ],
  },
  {
    title: 'Coeficientes de cultura (Kc)',
    help: 'FAO-56, Tabela 12. ETc = Kc × ET₀; interpolação por GDA entre as fases.',
    fields: [
      { key: 'kcIni', label: 'Kc inicial', step: '0.01' },
      { key: 'kcMid', label: 'Kc médio', step: '0.01' },
      { key: 'kcEnd', label: 'Kc final', step: '0.01' },
    ],
  },
  {
    title: 'Hídricos',
    help: 'Fração de depleção sem estresse (p, FAO-56 Tabela 22) e profundidade radicular inicial → máxima.',
    fields: [
      { key: 'depletionFraction', label: 'Fração de depleção (p)', step: '0.01' },
      { key: 'zrIni', label: 'Zr inicial', unit: 'm', step: '0.01' },
      { key: 'zrMax', label: 'Zr máxima', unit: 'm', step: '0.01' },
    ],
  },
  {
    title: 'Sensibilidade ao estresse (Ky)',
    help: 'FAO-33 (Doorenbos & Kassam, 1979): redução de produtividade por janela proporcional a 1 − Ks.',
    fields: [
      { key: 'kyF1', label: 'Ky F1', step: '0.01' },
      { key: 'kyF2', label: 'Ky F2', step: '0.01' },
      { key: 'kyF3', label: 'Ky F3', step: '0.01' },
      { key: 'kyF4', label: 'Ky F4', step: '0.01' },
    ],
  },
];

export const REFERENCE_NOTE = 'Parâmetros de referência: FAO-56 (Tabelas 12 e 22) e FAO-33 (Ky) — ver docs/msa/algoritmos.md.';
