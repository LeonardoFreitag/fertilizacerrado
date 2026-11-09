import { describe, expect, it } from 'vitest';
import { coverage, drySpells, nearestSpellOffset } from './stress-methods';

function series(from: string, values: (number | null)[]): { date: string; precipMm: number | null }[] {
  return values.map((v, i) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), precipMm: v }));
}

describe('drySpells', () => {
  it('sequência de dias com chuva < 10 mm e duração ≥ minDays', () => {
    const obs = series('2026-01-08', [0, 2, 0, 0, 9.9, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 25, 0, 0]);
    const spells = drySpells(obs, 10, 3);
    expect(spells).toHaveLength(1);
    expect(spells[0]).toMatchObject({ start: '2026-01-08', end: '2026-01-25', days: 18 });
    expect(spells[0]!.rainMm).toBeCloseTo(12.9, 9);
  });
  it('dia sem observação divide o período; pedaços curtos caem', () => {
    const obs = series('2026-01-01', [0, 0, 0, null, 0, 0, 12, 0, 0, 0, 0]);
    expect(drySpells(obs, 10, 3).map((s) => [s.start, s.days])).toEqual([['2026-01-01', 3], ['2026-01-08', 4]]);
    expect(drySpells(obs, 10, 5).map((s) => s.days)).toEqual([]);
  });
  it('lacuna no calendário também divide', () => {
    const obs = [...series('2026-01-01', [0, 0, 0]), ...series('2026-01-06', [0, 0, 0])];
    expect(drySpells(obs, 10, 3)).toHaveLength(2);
  });
  it('parâmetros inválidos', () => {
    expect(() => drySpells([], 0, 3)).toThrow(RangeError);
    expect(() => drySpells([], 10, 0)).toThrow(RangeError);
  });
});

describe('coverage e nearestSpellOffset', () => {
  const spells = [{ start: '2026-01-08', end: '2026-01-25', days: 18, rainMm: 0 }];
  it('evento 12–23/01 dentro do veranico 08–25/01: cobertura 100 %, deslocamento −4', () => {
    const ev = { start: '2026-01-12', end: '2026-01-23', days: 12 };
    expect(coverage(ev, spells)).toBe(1);
    expect(nearestSpellOffset(ev, spells)).toBe(-4);
  });
  it('evento meio fora: cobertura parcial', () => {
    expect(coverage({ start: '2026-01-20', end: '2026-01-29', days: 10 }, spells)).toBeCloseTo(0.6, 9);
  });
  it('sem veranicos', () => {
    expect(coverage({ start: '2026-01-20', end: '2026-01-29', days: 10 }, [])).toBe(0);
    expect(nearestSpellOffset({ start: '2026-01-20' }, [])).toBeNull();
  });
});
