import { describe, expect, it } from 'vitest';
import { mulberry32, sampleNormal, uniform } from './random';

function stats(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

describe('mulberry32', () => {
  it('mesma semente ⇒ mesma sequência', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('sementes diferentes ⇒ sequências diferentes', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    expect(first).not.toEqual(second);
  });

  it('fica em [0, 1) e uniform respeita o intervalo', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const u = rand();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const x = uniform(rand, -3, 5);
      expect(x).toBeGreaterThanOrEqual(-3);
      expect(x).toBeLessThan(5);
    }
  });
});

describe('sampleNormal (Box-Muller)', () => {
  it('N(0, 1): média a 0,01 e desvio a 1 % em 100 mil sorteios', () => {
    const rand = mulberry32(2026);
    const { mean, sd } = stats(Array.from({ length: 100_000 }, () => sampleNormal(rand)));
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(sd - 1)).toBeLessThan(0.01);
  });

  it('N(1, 0,3): média a 0,01 e desvio a 1 %', () => {
    const rand = mulberry32(99);
    const { mean, sd } = stats(Array.from({ length: 100_000 }, () => sampleNormal(rand, 1, 0.3)));
    expect(Math.abs(mean - 1)).toBeLessThan(0.01);
    expect(Math.abs(sd - 0.3) / 0.3).toBeLessThan(0.01);
  });

  it('é determinístico e sempre finito', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 1_000_000; i++) {
      const x = sampleNormal(a);
      if (i % 1000 === 0) {
        expect(x).toBe(sampleNormal(b));
      } else {
        b();
        b(); // mantém os dois geradores alinhados (2 uniformes por amostra)
      }
      if (!Number.isFinite(x)) throw new Error(`valor não finito na amostra ${i}`);
    }
  });

  it('sd = 0 devolve exatamente a média', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 100; i++) expect(sampleNormal(rand, 1, 0)).toBe(1);
  });
});
