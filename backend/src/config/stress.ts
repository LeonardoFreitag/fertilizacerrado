/**
 * Parâmetros da detecção de eventos de estresse hídrico (motor 2.3.0). Vêm do
 * ambiente e são gravados em cada run (`stressKsThreshold`, `stressMinDays`)
 * para reprodutibilidade. Módulo separado, como `pre-season.ts`, para o serviço
 * do MSA poder ser testado sem carregar o `env` completo.
 * `docs/msa/algoritmos.md` §7; questão aberta #14.
 */
import type { StressParams } from '../modules/msa/engine';
import { env } from './env';

export function stressParams(): StressParams {
  return { ksThreshold: env.STRESS_KS_THRESHOLD, minDays: env.STRESS_MIN_DAYS };
}
