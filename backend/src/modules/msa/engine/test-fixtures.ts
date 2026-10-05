import { referenceCultivar } from '../../cultivars/reference-cultivars';
import type { CultivarParams, SoilParams } from './types';

export { mulberry32, uniform } from './random';

/** Soja — referência Cerrado (mesmos valores do seed). */
export const SOJA: CultivarParams = referenceCultivar('SOJA');

/** Latossolo Vermelho típico do Cerrado (`docs/msa/algoritmos.md` §5). */
export const LATOSSOLO: SoilParams = { thetaFC: 0.28, thetaWP: 0.12 };
