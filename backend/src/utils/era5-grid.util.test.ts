import { describe, expect, it } from 'vitest';
import { snapToEra5Cell } from './era5-grid.util';

describe('snapToEra5Cell', () => {
  it('leva o centróide ao nó mais próximo', () => {
    expect(snapToEra5Cell(-16.6799, -49.255)).toEqual({ lat: -16.7, lon: -49.3 });
    expect(snapToEra5Cell(-16.68, -49.26)).toEqual({ lat: -16.7, lon: -49.3 });
  });

  it('mantém um ponto que já está sobre um nó', () => {
    expect(snapToEra5Cell(-15.8, -47.9)).toEqual({ lat: -15.8, lon: -47.9 });
  });

  it('resolve o empate de forma determinística (meio para cima)', () => {
    expect(snapToEra5Cell(-16.65, -49.25)).toEqual({ lat: -16.6, lon: -49.2 });
    expect(snapToEra5Cell(16.65, 49.25)).toEqual({ lat: 16.7, lon: 49.3 });
  });

  it('não deixa resíduos de ponto flutuante', () => {
    const cell = snapToEra5Cell(-16.299999999, -49.100000001);
    expect(cell).toEqual({ lat: -16.3, lon: -49.1 });
    expect(Object.is(cell.lat, -16.3)).toBe(true);
  });

  it('normaliza zero negativo', () => {
    const cell = snapToEra5Cell(-0.04, 0.04);
    expect(Object.is(cell.lat, 0)).toBe(true);
    expect(Object.is(cell.lon, 0)).toBe(true);
  });

  it('converte o antimeridiano para -180', () => {
    expect(snapToEra5Cell(0, 179.98)).toEqual({ lat: 0, lon: -180 });
    expect(snapToEra5Cell(0, 180)).toEqual({ lat: 0, lon: -180 });
    expect(snapToEra5Cell(0, -179.96)).toEqual({ lat: 0, lon: -180 });
  });

  it('rejeita coordenadas fora do intervalo', () => {
    expect(() => snapToEra5Cell(91, 0)).toThrow(RangeError);
    expect(() => snapToEra5Cell(0, -181)).toThrow(RangeError);
    expect(() => snapToEra5Cell(Number.NaN, 0)).toThrow(RangeError);
  });
});
