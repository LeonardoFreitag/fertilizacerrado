/**
 * Safra sintética de verão do Cerrado, determinística pela semente — série de
 * referência dos testes de serviço e do motor enquanto não há dados ERA5-Land
 * (`backend/scripts/validation/examples/synthetic-cerrado-season.csv` é a
 * saída de `syntheticSeason(150, 2026)`).
 *
 * Não faz parte do motor científico: é um gerador de dados de teste. Por isso o
 * PRNG mora aqui, e não em `engine/` — o motor é determinístico e não sorteia.
 */
import type { DailyWeather } from './engine/types';

/**
 * PRNG mulberry32 (Tommy Ettinger, 2017): gerador de 32 bits, período 2³²,
 * uniforme em [0, 1). Sementes não inteiras são truncadas para uint32.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniforme em [min, max). */
export function uniform(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

/**
 * Amostra de N(mean, sd²) por Box-Muller (Box & Muller, 1958). Consome dois
 * uniformes e devolve um valor; o segundo valor do par é descartado de
 * propósito para não criar estado oculto. O primeiro uniforme é tomado como
 * 1 − u ∈ (0, 1] para o logaritmo nunca receber zero.
 */
export function sampleNormal(rand: () => number, mean = 0, sd = 1): number {
  const u1 = 1 - rand();
  const u2 = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export const SYNTHETIC_SEASON_START = '2025-11-01';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * `days` dias a partir de 1º de novembro: temperaturas e radiação com
 * sazonalidade suave e ruído; chuva em regime de verão com veranicos (blocos
 * secos de 7–15 dias) para que haja estresse hídrico em F2/F3.
 */
export function syntheticSeason(days: number, seed: number, start: string = SYNTHETIC_SEASON_START): DailyWeather[] {
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`days deve ser inteiro ≥ 1: ${days}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new RangeError(`start deve ser AAAA-MM-DD: ${start}`);
  const rand = mulberry32(seed);
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  // Deslocamento sazonal em relação a 1º de novembro (padrão): mantém a saída
  // atual para o início padrão e dá estação seca (maio–setembro) a séries longas.
  const dayOffset = Math.round((startMs - new Date(`${SYNTHETIC_SEASON_START}T00:00:00Z`).getTime()) / 86_400_000);
  const out = new Array<DailyWeather>(days);

  let drySpellLeft = 0;
  for (let i = 0; i < days; i++) {
    const t = i + dayOffset; // dias desde 1º de novembro de 2025
    const season = Math.sin((2 * Math.PI * (t + 305)) / 365); // pico de verão por volta de janeiro
    const month = new Date(startMs + i * 86_400_000).getUTCMonth() + 1;
    const drySeason = start !== SYNTHETIC_SEASON_START && month >= 5 && month <= 9; // Cerrado: seca de maio a setembro
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
    if (drySeason) precipitation = 0;

    out[i] = {
      date: new Date(startMs + i * 86_400_000).toISOString().slice(0, 10),
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
