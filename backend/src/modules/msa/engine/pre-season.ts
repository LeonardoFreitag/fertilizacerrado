/**
 * Entressafra (spin-up) do balanço hídrico: o balanço começa no último 1º de
 * fevereiro antes da emergência, com o solo na capacidade de campo, e chega à
 * emergência com a depleção calculada — no padrão do balanço climatológico de
 * Thornthwaite & Mather (1955). `docs/msa/algoritmos.md` §5; questões abertas
 * #11 (Kc/Zr da entressafra) e #12 (data de início).
 */

/** Padrões da entressafra: Kc 1,0 = ETP direta (Thornthwaite-Mather). O Zr vem da cultivar (zrMax ou zrIni). */
export const PRE_SEASON_DEFAULTS = { kc: 1.0 } as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertIsoDate(value: string, name: string): [number, number, number] {
  const m = ISO_DATE.exec(value);
  if (!m) throw new RangeError(`${name} deve ser AAAA-MM-DD: ${value}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new RangeError(`${name} inexistente: ${value}`);
  }
  return [y, mo, d];
}

/**
 * Início do spin-up: o último 1º de fevereiro menor ou igual à emergência
 * (regra da reunião de 2026-11-02; `docs/msa/questoes-abertas.md` #12).
 * 2026-10-20 → 2026-02-01; 2027-01-15 → 2026-02-01; 2027-02-01 → 2027-02-01.
 */
export function preSeasonStart(emergenceDate: string): string {
  const [year, month] = assertIsoDate(emergenceDate, 'emergenceDate');
  const startYear = month >= 2 ? year : year - 1;
  return `${startYear}-02-01`;
}

/**
 * Depleção convertida do perfil da entressafra para a zona radicular inicial,
 * por proporção: Dr_ini = Dr_pre × TAW(zrIni) / TAW(zrPre). Hipótese de
 * umidade uniforme no perfil (limitação registrada em `algoritmos.md` §5).
 */
export function convertDepletion(drPre: number, tawPre: number, tawIni: number): number {
  if (!Number.isFinite(drPre) || drPre < 0) throw new RangeError(`drPre deve ser ≥ 0: ${drPre}`);
  if (!Number.isFinite(tawPre) || tawPre <= 0) throw new RangeError(`tawPre deve ser > 0: ${tawPre}`);
  if (!Number.isFinite(tawIni) || tawIni <= 0) throw new RangeError(`tawIni deve ser > 0: ${tawIni}`);
  const converted = (drPre * tawIni) / tawPre;
  return converted > tawIni ? tawIni : converted;
}
