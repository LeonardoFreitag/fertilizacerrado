import { describe, expect, it } from 'vitest';
import { csvCell, slug, toCsv } from './csv';
import type { PhaseView } from '../api/types';
import type { StressEvent } from '../api/types';
import { daySeverity, formatIndexPct, formatMm, formatPct, formatScHa, groupMissingDates, KS_OK, KS_WARNING, LOSS_CRITICAL_PCT, LOSS_WARNING_PCT, phaseRanges, preSeasonRange, rainBeforeEmergence, soilWaterTexts, stressEventsCsv, suggestSeason, summariesCsv, windowSeverity, yieldSummaryRows, yieldWarnings } from './msa';

describe('severidade (espelho de engine/stress.ts)', () => {
  it('constantes iguais às do motor', () => {
    expect([LOSS_WARNING_PCT, LOSS_CRITICAL_PCT, KS_OK, KS_WARNING]).toEqual([5, 15, 0.85, 0.7]);
  });
  it('janela pela perda: 3 % ok, 10 % atenção, 31 % crítico; limites são atenção; nulo pendente', () => {
    expect(windowSeverity(3)).toBe('ok');
    expect(windowSeverity(10)).toBe('warning');
    expect(windowSeverity(31)).toBe('critical');
    expect(windowSeverity(5)).toBe('warning');
    expect(windowSeverity(15)).toBe('warning');
    expect(windowSeverity(null)).toBe('pending');
    expect(windowSeverity(undefined)).toBe('pending');
  });
  it('dia pelo Ks: 0,92 ok, 0,78 atenção, 0,61 crítico', () => {
    expect(daySeverity(0.92)).toBe('ok');
    expect(daySeverity(0.85)).toBe('ok');
    expect(daySeverity(0.78)).toBe('warning');
    expect(daySeverity(0.7)).toBe('warning');
    expect(daySeverity(0.61)).toBe('critical');
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

  it('dias PRE ficam fora da linha do tempo e viram a faixa de entressafra', () => {
    const rows = series([['PRE', 5], ['F1', 10], ['F2', 5]]);
    const t = phaseRanges(rows);
    expect(t.cycleStart).toBe('2025-11-06');
    expect(t.totalDays).toBe(15);
    expect(t.ranges.map((r) => r.phase)).toEqual(['F1', 'F2']);
    expect(preSeasonRange(rows)).toEqual({ start: '2025-11-01', end: '2025-11-05', days: 5 });
    expect(preSeasonRange(series([['F1', 3]]))).toBeNull();
  });
});

describe('entressafra — funções do cartão', () => {
  const days = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2025, 8, 2 + i)).toISOString().slice(0, 10), precipitation: i % 10 === 0 ? 12 : 0 }));

  it('chuva dos 30 dias anteriores à emergência (exclusive)', () => {
    // emergência 2025-11-01: janela 2025-10-02 … 2025-10-31 → dias com i%10===0 nessa faixa: i=30,40,50 → 36 mm
    expect(rainBeforeEmergence(days, '2025-11-01')).toBe(36);
    expect(rainBeforeEmergence([], '2025-11-01')).toBe(0);
  });

  it('groupMissingDates: por extenso até 14, agrupado por mês acima', () => {
    const few = groupMissingDates(['2025-11-16', '2025-11-15']);
    expect(few).toEqual({ grouped: false, groups: [], dates: ['15/11/2025', '16/11/2025'], total: 2 });
    const many: string[] = [];
    for (let d = new Date(Date.UTC(2025, 1, 1)); d < new Date(Date.UTC(2025, 3, 3)); d = new Date(d.getTime() + 86_400_000)) many.push(d.toISOString().slice(0, 10));
    const g = groupMissingDates(many);
    expect(g.grouped).toBe(true);
    expect(g.total).toBe(61);
    expect(g.groups.map((x) => x.label)).toEqual(['fev/2025: 28 dias', 'mar/2025: 31 dias', 'abr/2025: 2 dias']);
    expect(g.dates).toHaveLength(61);
  });

  it('soilWaterTexts: frase, mm e período; null em run antiga', () => {
    const t = soilWaterTexts({ emergenceDepletionPct: 35, emergenceDepletionMm: 16.8, preSeasonFrom: '2025-02-01', preSeasonKc: 1, preSeasonZr: 0.95 }, '2025-11-01', 48)!;
    expect(t.headline).toBe('O talhão entrou na safra com 65 % da água disponível');
    expect(t.depletion).toBe('16,8 de 48,0 mm esgotados');
    expect(t.period).toBe('entressafra 01/02/2025 → 31/10/2025 (Kc 1,00, Zr 0,95 m)');
    expect(soilWaterTexts({ emergenceDepletionPct: null, emergenceDepletionMm: null, preSeasonFrom: null, preSeasonKc: null, preSeasonZr: null }, '2025-11-01', 48)).toBeNull();
  });
});

describe('formatação', () => {
  it('unidades em pt-BR', () => {
    expect(formatPct(12.345)).toBe('12,3%');
    expect(formatMm(1234.56)).toBe('1.234,6 mm');
    expect(formatIndexPct(0.736)).toBe('73,6 %');
    expect(formatIndexPct(null)).toBe('—');
    expect(formatScHa(47.84)).toBe('47,8 sc/ha');
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

const phase = (phase: PhaseView['phase'], days: number, ksMean: number | null, reduction: number | null): PhaseView => ({
  phase, days, ksMean, etcAdjAccum: 100, precipAccum: 50, yieldReductionPct: reduction,
});

describe('yieldSummaryRows', () => {
  it('ciclo completo: fator = 1 − redução/100 por janela', () => {
    const rows = yieldSummaryRows([phase('F1', 8, 1, 0), phase('F2', 22, 0.9, 8), phase('F3', 30, 0.8, 20), phase('F4', 20, 1, 0)]);
    expect(rows.map((r) => r.phase)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(rows.map((r) => r.reached)).toEqual([true, true, true, true]);
    expect(rows[1]!.factor).toBeCloseTo(0.92, 9);
    expect(rows[2]!.factor).toBeCloseTo(0.8, 9);
    expect(rows.reduce((acc, r) => acc * r.factor, 1)).toBeCloseTo(0.736, 9);
  });

  it('janela não alcançada: fator 1, Ks e redução nulos, mesmo faltando na lista', () => {
    const rows = yieldSummaryRows([phase('F1', 8, 1, 0), phase('F2', 10, 0.9, 8), phase('F3', 0, null, null)]);
    expect(rows[2]).toMatchObject({ phase: 'F3', reached: false, factor: 1, ksMean: null, reductionPct: null });
    expect(rows[3]).toMatchObject({ phase: 'F4', reached: false, factor: 1, days: 0 });
  });
});

describe('yieldWarnings', () => {
  it('parcial enquanto phasesReached < 4 ou o ciclo não encerrou', () => {
    expect(yieldWarnings({ phasesReached: 2, currentPhase: 'F2', runYm: 65, harvestYm: 65 }).partial).toBe(true);
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'F4', runYm: 65, harvestYm: 65 }).partial).toBe(true);
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'COMPLETED', runYm: 65, harvestYm: 65 }).partial).toBe(false);
  });

  it('Ym alterada: safra ≠ run, inclusive informada depois de uma run sem Ym', () => {
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'COMPLETED', runYm: 65, harvestYm: 70 }).ymChanged).toBe(true);
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'COMPLETED', runYm: null, harvestYm: 70 }).ymChanged).toBe(true);
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'COMPLETED', runYm: 65, harvestYm: 65 }).ymChanged).toBe(false);
    expect(yieldWarnings({ phasesReached: 4, currentPhase: 'COMPLETED', runYm: null, harvestYm: null }).ymChanged).toBe(false);
  });
});

describe('summariesCsv', () => {
  const phases = [phase('F1', 8, 1, 0), phase('F2', 22, 0.9, 8), phase('F3', 30, 0.8, 20), phase('F4', 0, null, null)];

  it('com Ym: cabeçalho da spec, quatro linhas, índice/Ym/predita repetidos, sem percentis', () => {
    const yieldLoss = {
      ym: 65, yieldIndex: 0.736, predictedYield: 47.84, totalLossScHa: 17.16, totalLossPct: 26.4,
      phases: [
        { phase: 'F1' as const, factor: 1, lossPct: 0, lossScHa: 0 },
        { phase: 'F2' as const, factor: 0.92, lossPct: 8, lossScHa: 5.2 },
        { phase: 'F3' as const, factor: 0.8, lossPct: 18.4, lossScHa: 11.96 },
        { phase: 'F4' as const, factor: 1, lossPct: 0, lossScHa: 0 },
      ],
    };
    const csv = summariesCsv(phases, { yieldIndex: 0.736, expectedYield: 65, predictedYield: 47.84, yieldLoss }).replace('\ufeff', '');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha;perda_sc_ha');
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe('F2;22;0,9;8;100;50;0,736;65;47,84;5,2');
    expect(lines[4]).toBe('F4;0;;;100;50;0,736;65;47,84;0');
    expect(5.2 + 11.96).toBeCloseTo(65 - 47.84, 9);
    expect(csv).not.toMatch(/p10|p50|p90/);
  });

  it('sem Ym: índice preenchido, Ym e predita vazios em todas as linhas', () => {
    const lines = summariesCsv(phases, { yieldIndex: 0.736, expectedYield: null, predictedYield: null, yieldLoss: null }).replace('\ufeff', '').trimEnd().split('\r\n');
    expect(lines.slice(1).every((l) => l.endsWith(';0,736;;;'))).toBe(true);
  });
});

describe('stressEventsCsv', () => {
  const events: StressEvent[] = [
    { start: '2026-01-12', end: '2026-01-23', days: 12, ksMin: 0.31, ksMean: 0.52, deficitMm: 38.4, phases: [{ phase: 'F3', days: 12 }], dominantPhase: 'F3', kyDominant: 1 },
    { start: '2025-11-03', end: '2025-11-06', days: 4, ksMin: 0.6, ksMean: 0.65, deficitMm: 5, phases: [{ phase: 'F1', days: 3 }, { phase: 'F2', days: 1 }], dominantPhase: 'F1', kyDominant: 0.2 },
  ];
  it('cabeçalho da spec e uma linha por evento', () => {
    const lines = stressEventsCsv(events).replace('\ufeff', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('inicio;fim;dias;janela_dominante;janelas;ks_min;ks_medio;deficit_mm');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2026-01-12;2026-01-23;12;F3;F3:12;0,31;0,52;38,4');
    expect(lines[2]).toBe('2025-11-03;2025-11-06;4;F1;F1:3 F2:1;0,6;0,65;5');
  });
  it('sem eventos: só o cabeçalho', () => {
    expect(stressEventsCsv([]).replace('\ufeff', '').trimEnd().split('\r\n')).toHaveLength(1);
  });
});
