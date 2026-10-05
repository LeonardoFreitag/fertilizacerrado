import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { closeRing, era5CellBounds, formatHa, polygonAreaHa, polygonBounds, polygonToSvgPath, ringToLatLngs } from './geo';

// ~0,0094° × 0,009° em Goiânia (o talhão de teste dos roteiros e2e)
const SQUARE: Polygon = {
  type: 'Polygon',
  coordinates: [[[-49.3, -16.7], [-49.2906, -16.7], [-49.2906, -16.691], [-49.3, -16.691], [-49.3, -16.7]]],
};

describe('geo', () => {
  it('fecha o anel só quando necessário', () => {
    expect(closeRing([[0, 0], [1, 0], [1, 1]])).toHaveLength(4);
    expect(closeRing([[0, 0], [1, 0], [1, 1], [0, 0]])).toHaveLength(4);
  });

  it('área geodésica em ha próxima do PostGIS (~99,6 ha)', () => {
    const ha = polygonAreaHa(SQUARE);
    expect(ha).toBeGreaterThan(98);
    expect(ha).toBeLessThan(101);
  });

  it('limites e conversão para [lat, lon]', () => {
    expect(polygonBounds(SQUARE)).toEqual([[-16.7, -49.3], [-16.691, -49.2906]]);
    const latlngs = ringToLatLngs(SQUARE);
    expect(latlngs).toHaveLength(4); // sem o ponto repetido
    expect(latlngs[0]).toEqual([-16.7, -49.3]);
  });

  it('célula ERA5 de 0,1°', () => {
    const [[s, w], [n, e]] = era5CellBounds({ lat: -16.7, lon: -49.3 });
    expect(s).toBeCloseTo(-16.75, 6);
    expect(w).toBeCloseTo(-49.35, 6);
    expect(n).toBeCloseTo(-16.65, 6);
    expect(e).toBeCloseTo(-49.25, 6);
  });

  it('miniatura SVG usa o quadro inteiro', () => {
    const d = polygonToSvgPath(SQUARE, 64);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L')).toHaveLength(5);
    expect(polygonToSvgPath({ type: 'Polygon', coordinates: [[]] })).toBe('');
  });

  it('formata hectares em pt-BR', () => {
    expect(formatHa(1234.5)).toBe('1.234,50 ha');
  });
});
