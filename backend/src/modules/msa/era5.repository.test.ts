import { describe, expect, it } from 'vitest';
import { LATOSSOLO, SOJA } from './engine/test-fixtures';
import { runDailyBalance } from './engine/water-balance';
import { findMissingDates, toDailyWeather } from './era5.repository';

describe('toDailyWeather', () => {
  it('mapeia uma linha da hipertabela para o formato do motor', () => {
    const row = {
      time: new Date('2025-11-10T00:00:00Z'),
      t2mMax: 30.1, t2mMin: 19.2, t2mMean: 24.5, d2mMean: 18.0, u2: 1.9, rn: 14.2, tpCorrected: 6.5,
    };
    expect(toDailyWeather(row)).toEqual({
      date: '2025-11-10', tmax: 30.1, tmin: 19.2, tmean: 24.5, tdew: 18.0, u2: 1.9, rn: 14.2, precipitation: 6.5,
    });
  });

  it('a série mapeada alimenta runDailyBalance', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      toDailyWeather({
        time: new Date(Date.UTC(2025, 10, 10 + i)),
        t2mMax: 30, t2mMin: 19, t2mMean: 24.5, d2mMean: 18, u2: 1.9, rn: 14, tpCorrected: i % 3 === 0 ? 8 : 0,
      }),
    );
    const rows = runDailyBalance(days, SOJA, LATOSSOLO, { altitude: 741 });
    expect(rows).toHaveLength(10);
    expect(rows[0]!.date).toBe('2025-11-10');
    expect(rows.every((r) => Number.isFinite(r.et0) && r.et0 > 0)).toBe(true);
  });
});

describe('findMissingDates', () => {
  it('cobertura completa não tem lacunas', () => {
    expect(findMissingDates('2025-11-01', '2025-11-03', ['2025-11-01', '2025-11-02', '2025-11-03'])).toEqual([]);
  });

  it('lista as datas ausentes em ordem', () => {
    expect(findMissingDates('2025-11-01', '2025-11-05', ['2025-11-01', '2025-11-02', '2025-11-05'])).toEqual([
      '2025-11-03',
      '2025-11-04',
    ]);
  });

  it('intervalo de um dia e virada de mês', () => {
    expect(findMissingDates('2025-11-30', '2025-11-30', [])).toEqual(['2025-11-30']);
    expect(findMissingDates('2025-11-29', '2025-12-02', ['2025-12-01'])).toEqual(['2025-11-29', '2025-11-30', '2025-12-02']);
  });

  it('rejeita intervalo invertido e data inválida', () => {
    expect(() => findMissingDates('2025-11-05', '2025-11-01', [])).toThrow(RangeError);
    expect(() => findMissingDates('2025-13-01', '2025-11-01', [])).toThrow(RangeError);
  });
});
