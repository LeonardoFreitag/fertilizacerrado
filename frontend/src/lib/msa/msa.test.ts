import { describe, expect, it } from 'vitest';
import { csvCell, slug, toCsv } from './csv';
import { formatMm, formatPct, formatPercentiles, phaseRanges, severity, suggestSeason } from './msa';

describe('severity', () => {
  it('limiares 0,85 e 0,70', () => {
    expect(severity(0.92)).toBe('ok');
    expect(severity(0.85)).toBe('ok');
    expect(severity(0.78)).toBe('warning');
    expect(severity(0.7)).toBe('warning');
    expect(severity(0.61)).toBe('critical');
    expect(severity(null)).toBe('pending');
    expect(severity(undefined)).toBe('pending');
  });
});

describe('phaseRanges', () => {
  const series = (phases: [string, number][]) => {
    const out: { date: string; phase: 'F1' | 'F2' | 'F3' | 'F4' | 'COMPLETED' }[] = [];
    let day = new Date('2025-11-01T00:00:00Z');
    for (const [phase, n] of phases) {
      for (let i = 0; i < n; i++) {
        out.push({ date: day.toISOString().slice(0, 10), phase: phase as 'F1' });
        day = new Date(day.getTime() + 86400000);
      }
    }
    return out;
  };

  it('ciclo completo', () => {
    const t = phaseRanges(series([['F1', 10], ['F2', 30], ['F3', 40], ['F4', 20]]));
    expect(t.ranges.map((r) => r.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(t.ranges[0]).toEqual({ phase: 'F1', start: '2025-11-01', end: '2025-11-10', days: 10 });
    expect(t.ranges[1]?.start).toBe('2025-11-11');
    expect(t.pending).toEqual([]);
    expect(t.cycleStart).toBe('2025-11-01');
    expect(t.cycleEnd).toBe('2026-02-08');
    expect(t.totalDays).toBe(100);
  });

  it('ciclo em curso: F3 e F4 pendentes', () => {
    const t = phaseRanges(series([['F1', 10], ['F2', 5]]));
    expect(t.ranges.map((r) => r.phase)).toEqual(['F1', 'F2']);
    expect(t.pending).toEqual(['F3', 'F4']);
  });

  it('dias COMPLETED contam em F4 e ordem de entrada não importa', () => {
    const rows = series([['F4', 3], ['COMPLETED', 2]]).reverse();
    const t = phaseRanges(rows);
    expect(t.ranges).toEqual([{ phase: 'F4', start: '2025-11-01', end: '2025-11-05', days: 5 }]);
    expect(t.pending).toEqual(['F1', 'F2', 'F3']);
  });

  it('série vazia', () => {
    expect(phaseRanges([])).toEqual({ ranges: [], pending: ['F1', 'F2', 'F3', 'F4'], cycleStart: null, cycleEnd: null, totalDays: 0 });
  });
});

describe('formatação', () => {
  it('percentis e unidades em pt-BR', () => {
    expect(formatPercentiles({ p10: 0.61, p50: 0.78, p90: 0.91 })).toBe('P10 0,61 · P50 0,78 · P90 0,91');
    expect(formatPercentiles(null)).toBe('—');
    expect(formatPct(12.345)).toBe('12,3%');
    expect(formatMm(1234.56)).toBe('1.234,6 mm');
  });

  it('safra sugerida pela emergência', () => {
    expect(suggestSeason('2025-11-01')).toBe('2025/26');
    expect(suggestSeason('2026-02-15')).toBe('2025/26');
    expect(suggestSeason('2026-07-01')).toBe('2026/27');
    expect(suggestSeason('2099-12-31')).toBe('2099/00');
    expect(suggestSeason('inválida')).toBe('');
  });
});

describe('csv', () => {
  it('vírgula decimal, aspas e BOM', () => {
    expect(csvCell(0.78)).toBe('0,78');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell(null)).toBe('');
    const csv = toCsv(
      [{ date: '2025-11-01', ks: 0.78 }, { date: '2025-11-02', ks: 1 }],
      [{ header: 'Data', value: (r) => r.date }, { header: 'Ks', value: (r) => r.ks }],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.replace('﻿', '')).toBe('Data;Ks\r\n2025-11-01;0,78\r\n2025-11-02;1\r\n');
  });

  it('slug de nome de arquivo', () => {
    expect(slug('Talhão Norte — Soja 2025/26')).toBe('talhao-norte-soja-2025-26');
  });
});
