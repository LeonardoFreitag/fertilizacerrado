import { describe, expect, it } from 'vitest';
import { polygonSchema } from './geojson.util';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [-49.3, -16.7],
      [-49.29, -16.7],
      [-49.29, -16.69],
      [-49.3, -16.69],
      [-49.3, -16.7],
    ],
  ],
};

function errors(input: unknown): string[] {
  const result = polygonSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('polygonSchema', () => {
  it('aceita um polígono fechado', () => {
    expect(polygonSchema.parse(square)).toEqual(square);
  });

  it('aceita anéis internos (buracos)', () => {
    const hole = [
      [-49.297, -16.697],
      [-49.293, -16.697],
      [-49.293, -16.693],
      [-49.297, -16.693],
      [-49.297, -16.697],
    ];
    expect(errors({ ...square, coordinates: [square.coordinates[0], hole] })).toEqual([]);
  });

  it('descarta a altitude das posições', () => {
    const withAlt = {
      type: 'Polygon',
      coordinates: [square.coordinates[0]!.map(([lon, lat]) => [lon, lat, 800])],
    };
    expect(polygonSchema.parse(withAlt)).toEqual(square);
  });

  it('rejeita tipos diferentes de Polygon', () => {
    expect(errors({ ...square, type: 'MultiPolygon' })).not.toEqual([]);
    expect(errors({ type: 'Point', coordinates: [-49.3, -16.7] })).not.toEqual([]);
  });

  it('rejeita anel não fechado', () => {
    const open = { ...square, coordinates: [square.coordinates[0]!.slice(0, 4)] };
    expect(errors(open)).toContain('anel não fechado: a primeira posição deve ser igual à última');
  });

  it('rejeita anel com menos de 4 posições', () => {
    const ring = square.coordinates[0]!;
    const tiny = { ...square, coordinates: [[ring[0], ring[1], ring[0]]] };
    expect(errors(tiny)).toContain('anel precisa de ao menos 4 posições');
  });

  it('rejeita coordenadas fora do intervalo', () => {
    const badLat = { ...square, coordinates: [[[-49.3, 95], [-49.2, 95], [-49.2, 94], [-49.3, 95]]] };
    const badLon = { ...square, coordinates: [[[-200, -16.7], [-49.2, -16.7], [-49.2, -16.6], [-200, -16.7]]] };
    expect(errors(badLat)).toContain('latitude fora do intervalo');
    expect(errors(badLon)).toContain('longitude fora do intervalo');
  });

  it('rejeita posição com mais de 3 valores e polígono sem anéis', () => {
    const ring = square.coordinates[0]!.map((p) => [...p, 1, 2]);
    expect(errors({ ...square, coordinates: [ring] })).toContain('posição com mais de 3 valores');
    expect(errors({ ...square, coordinates: [] })).toContain('polígono sem anéis');
  });

  it('rejeita anel com mais de 10.000 posições', () => {
    const ring = Array.from({ length: 10_001 }, (_, i) => [-49.3 + i * 1e-6, -16.7]);
    ring.push(ring[0]!);
    expect(errors({ ...square, coordinates: [ring] })).toContain('anel com mais de 10000 posições');
  });
});
