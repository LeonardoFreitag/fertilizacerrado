/**
 * Motor agrometeorológico do MSA: biblioteca de funções puras (sem banco,
 * API, Redis ou ERA5-Land). Matemática em `docs/msa/algoritmos.md`; cada
 * função cita a fonte e o número da equação (FAO-56 / FAO-33).
 */
/**
 * Versão do motor, gravada em cada run do MSA. Regra: patch para mudanças
 * que não alteram resultados além de arredondamento; minor quando o resultado
 * muda para a mesma entrada (ex.: adotar dia local) ou quando a run passa a
 * gravar campos novos derivados (2.3.0: eventos de estresse e perda por janela,
 * sem mudar balanço, resumos ou índice); major quando a interface muda.
 */
export const ENGINE_VERSION = '2.3.0';

export * from './types';
export * from './gda';
export * from './phenology';
export * from './et0';
export * from './kc';
export * from './water-balance';
export * from './pre-season';
export * from './yield';
export * from './stress';
