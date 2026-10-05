/**
 * Motor agrometeorológico do MSA: biblioteca de funções puras (sem banco,
 * API, Redis ou ERA5-Land). Matemática em `docs/msa/algoritmos.md`; cada
 * função cita a fonte e o número da equação (FAO-56 / FAO-33).
 */
/**
 * Versão do motor, gravada em cada run do MSA. Regra: patch para mudanças
 * que não alteram resultados além de arredondamento; minor quando o resultado
 * muda para a mesma entrada (ex.: adotar dia local); major quando a interface
 * muda.
 */
export const ENGINE_VERSION = '1.0.0';

export * from './types';
export * from './gda';
export * from './phenology';
export * from './et0';
export * from './kc';
export * from './water-balance';
export * from './yield';
export * from './random';
export * from './monte-carlo';
export * from './decision';
