/**
 * Parâmetros da entressafra (spin-up do balanço hídrico desde o último 1º de
 * fevereiro antes da emergência). Vêm do ambiente e são gravados em cada run
 * (`preSeasonKc`, `preSeasonZr`) para reprodutibilidade. Módulo separado para
 * o serviço do MSA poder ser testado sem carregar o `env` completo.
 * `docs/msa/algoritmos.md` §5; questões abertas #11 e #12.
 */
import { env } from './env';

export type PreSeasonZrMode = 'zrMax' | 'zrIni';

export interface PreSeasonConfig {
  kc: number;
  zrMode: PreSeasonZrMode;
}

export function preSeasonConfig(): PreSeasonConfig {
  return { kc: env.PRE_SEASON_KC, zrMode: env.PRE_SEASON_ZR_MODE };
}
