/**
 * Safra sintética de verão do Cerrado, determinística pela semente — insumo
 * do Caso 3 do protocolo de validação (`docs/msa/validacao.md`) e do teste de
 * convergência do Monte Carlo enquanto não há dados ERA5-Land.
 *
 * Não faz parte do motor científico: é um gerador de dados de teste.
 */
import { mulberry32, sampleNormal, uniform } from './engine/random';
import type { DailyWeather } from './engine/types';

export const SYNTHETIC_SEASON_START = '2025-11-01';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * `days` dias a partir de 1º de novembro: temperaturas e radiação com
 * sazonalidade suave e ruído; chuva em regime de verão com veranicos (blocos
 * secos de 7–15 dias) para que haja estresse hídrico em F2/F3.
 */
export function syntheticSeason(days: number, seed: number): DailyWeather[] {
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`days deve ser inteiro ≥ 1: ${days}`);
  const rand = mulberry32(seed);
  const start = new Date(`${SYNTHETIC_SEASON_START}T00:00:00Z`).getTime();
  const out = new Array<DailyWeather>(days);

  let drySpellLeft = 0;
  for (let i = 0; i < days; i++) {
    const season = Math.sin((2 * Math.PI * (i + 305)) / 365); // pico de verão por volta de janeiro
    const tmax = clamp(31 + 1.5 * season + sampleNormal(rand, 0, 1.5), 22, 40);
    const tmin = clamp(tmax - (9 + sampleNormal(rand, 0, 1.2)), 10, tmax - 4);
    const tdew = tmin - uniform(rand, 0, 3);
    const u2 = clamp(1.3 + uniform(rand, 0, 1.4), 0.5, 4);
    const rn = clamp(13 + 2.5 * season + sampleNormal(rand, 0, 2), 5, 22);

    // Regime de verão do Cerrado (~5 mm/dia em média) com veranicos: blocos
    // secos de 7–14 dias que começam com 5 % de chance por dia. Fora deles,
    // 45 % dos dias chovem entre 1 e 35 mm.
    if (drySpellLeft === 0 && rand() < 0.05) drySpellLeft = 7 + Math.floor(uniform(rand, 0, 8));
    let precipitation = 0;
    if (drySpellLeft > 0) {
      drySpellLeft--;
    } else if (rand() < 0.45) {
      precipitation = uniform(rand, 1, 35);
    }

    out[i] = {
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      tmax,
      tmin,
      tdew,
      u2,
      rn,
      precipitation,
    };
  }
  return out;
}
