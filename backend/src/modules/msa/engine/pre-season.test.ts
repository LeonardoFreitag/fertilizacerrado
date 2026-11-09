import { describe, expect, it } from 'vitest';
import { convertDepletion, preSeasonStart } from './pre-season';

describe('preSeasonStart — último 1º de fevereiro ≤ emergência (questão #12)', () => {
  it('casos da spec', () => {
    expect(preSeasonStart('2026-10-20')).toBe('2026-02-01');
    expect(preSeasonStart('2027-01-15')).toBe('2026-02-01');
    expect(preSeasonStart('2027-02-01')).toBe('2027-02-01');
    expect(preSeasonStart('2026-02-15')).toBe('2026-02-01');
    expect(preSeasonStart('2026-01-31')).toBe('2025-02-01');
  });

  it('rejeita datas inválidas', () => {
    expect(() => preSeasonStart('2026-13-01')).toThrow(RangeError);
    expect(() => preSeasonStart('2026-02-30')).toThrow(RangeError);
    expect(() => preSeasonStart('20/10/2026')).toThrow(RangeError);
  });
});

describe('convertDepletion — proporção pela TAW (umidade uniforme)', () => {
  it('120 mm sobre 152 mm (0,95 m) → 37,9 mm sobre 48 mm (0,30 m), 79 %', () => {
    const dr = convertDepletion(120, 152, 48);
    expect(dr).toBeCloseTo(37.9, 1);
    expect((dr / 48) * 100).toBeCloseTo(78.9, 0);
  });

  it('zero continua zero; nunca excede a TAW de destino', () => {
    expect(convertDepletion(0, 152, 48)).toBe(0);
    expect(convertDepletion(152, 152, 48)).toBe(48);
  });

  it('entradas inválidas', () => {
    expect(() => convertDepletion(120, 0, 48)).toThrow(RangeError);
    expect(() => convertDepletion(-1, 152, 48)).toThrow(RangeError);
    expect(() => convertDepletion(120, 152, 0)).toThrow(RangeError);
    expect(() => convertDepletion(NaN, 152, 48)).toThrow(RangeError);
  });
});
