/**
 * Aleatoriedade determinística do motor. Mesma semente ⇒ mesma sequência,
 * em qualquer máquina — requisito de reprodutibilidade da dissertação.
 */

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
 * propósito: guardá-lo criaria estado oculto e a sequência passaria a depender
 * da ordem das chamadas. O primeiro uniforme é tomado como 1 − u ∈ (0, 1] para
 * o logaritmo nunca receber zero.
 */
export function sampleNormal(rand: () => number, mean = 0, sd = 1): number {
  const u1 = 1 - rand();
  const u2 = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
