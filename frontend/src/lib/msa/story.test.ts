import { describe, expect, it } from 'vitest';
import type { StressEvent, YieldLossAttribution } from '../api/types';
import {
  DRY_EMERGENCE_PCT,
  biggestLossSentence,
  emptyEventsSentence,
  eventLabel,
  eventSentence,
  expectedSentence,
  formatDayRange,
  heaviestPhase,
  lossPctSentence,
  lossSentence,
  NO_LOSS_SENTENCE,
  plural,
  rankEvents,
  roundHalf,
  roundTo5,
  storyModel,
  timelineShare,
} from './story';

const F3_EVENT: StressEvent = { start: '2026-01-12', end: '2026-01-23', days: 12, ksMin: 0.31, ksMean: 0.52, deficitMm: 38.4, phases: [{ phase: 'F3', days: 12 }], dominantPhase: 'F3', kyDominant: 1 };
const F1_EVENT: StressEvent = { start: '2025-11-03', end: '2025-11-06', days: 4, ksMin: 0.6, ksMean: 0.65, deficitMm: 50, phases: [{ phase: 'F1', days: 4 }], dominantPhase: 'F1', kyDominant: 0.2 };
const SOJA_KY = { kyF1: 0.2, kyF2: 0.8, kyF3: 1, kyF4: 0.4 };

function loss(ym: number | null): YieldLossAttribution {
  return {
    ym, yieldIndex: 0.8, predictedYield: ym == null ? null : ym * 0.8, totalLossScHa: ym == null ? null : ym * 0.2, totalLossPct: 20,
    phases: [
      { phase: 'F1', factor: 1, lossPct: 0, lossScHa: ym == null ? null : 0 },
      { phase: 'F2', factor: 0.95, lossPct: 5, lossScHa: ym == null ? null : ym * 0.05 },
      { phase: 'F3', factor: 0.85, lossPct: 15, lossScHa: ym == null ? null : ym * 0.15 },
      { phase: 'F4', factor: 1, lossPct: 0, lossScHa: ym == null ? null : 0 },
    ],
  };
}

describe('arredondamentos e plural', () => {
  it('sacas a 0,5 e milímetros a 5', () => {
    expect(roundHalf(12.7)).toBe(12.5);
    expect(roundHalf(12.76)).toBe(13);
    expect(roundTo5(38.4)).toBe(40);
    expect(roundTo5(12)).toBe(10);
  });
  it('plural', () => {
    expect(plural(1, 'dia', 'dias')).toBe('1 dia');
    expect(plural(12, 'dia', 'dias')).toBe('12 dias');
  });
});

describe('formatDayRange', () => {
  it('mesmo mês, meses diferentes, anos diferentes, um dia', () => {
    expect(formatDayRange('2026-01-12', '2026-01-23')).toBe('12 a 23 de janeiro');
    expect(formatDayRange('2026-01-28', '2026-02-03')).toBe('28 de janeiro a 3 de fevereiro');
    expect(formatDayRange('2025-12-30', '2026-01-04')).toBe('30 de dezembro de 2025 a 4 de janeiro de 2026');
    expect(formatDayRange('2026-01-12', '2026-01-12')).toBe('12 de janeiro');
  });
});

describe('eventos', () => {
  it('ordena por déficit × Ky (F3 38 mm × 1 antes de F1 50 mm × 0,2)', () => {
    expect(rankEvents([F1_EVENT, F3_EVENT]).map((e) => e.dominantPhase)).toEqual(['F3', 'F1']);
  });
  it('rótulo e frase completa com o sufixo da fase mais pesada', () => {
    expect(eventLabel(F3_EVENT)).toBe('12 dias com pouca água');
    expect(eventLabel({ ...F3_EVENT, days: 1 })).toBe('1 dia com pouca água');
    expect(eventSentence(F3_EVENT, 'F3')).toBe('12 a 23 de janeiro · 12 dias · floração e enchimento · a lavoura ficou sem cerca de 40 mm · esta é a fase que mais pesa na produção');
    expect(eventSentence(F1_EVENT, 'F3')).toBe('3 a 6 de novembro · 4 dias · germinação · a lavoura ficou sem cerca de 50 mm');
    expect(eventSentence({ ...F1_EVENT, deficitMm: 1.2 }, null)).toContain('a lavoura ficou sem menos de 5 mm');
  });
  it('frases de lista vazia', () => {
    expect(emptyEventsSentence(false)).toBe('Nenhum período de falta de água relevante até agora.');
    expect(emptyEventsSentence(true)).toBe('Nenhum período de falta de água relevante neste ciclo.');
  });
  it('fase mais pesada pelo Ky do snapshot', () => {
    expect(heaviestPhase(SOJA_KY)).toBe('F3');
    expect(heaviestPhase({})).toBeNull();
    expect(heaviestPhase(null)).toBeNull();
  });
});

describe('produtividade esperada e perda', () => {
  it('de um potencial de 65 sacas · perda de 13 sacas por hectare (20 %)', () => {
    expect(expectedSentence(65)).toBe('de um potencial de 65 sacas');
    expect(expectedSentence(62.5)).toBe('de um potencial de 62,5 sacas');
    expect(lossSentence(13, 20)).toBe('perda de 13 sacas por hectare (20 %)');
    expect(lossSentence(1, 2)).toBe('perda de 1 saca por hectare (2 %)');
    expect(lossSentence(0.2, 0.3)).toBe('sem perda relevante por falta de água');
    expect(lossPctSentence(20.4)).toBe('perda estimada de 20 % da produtividade');
    expect(lossPctSentence(0.3)).toBe('sem perda relevante por falta de água');
  });
  it('maior perda com e sem Ym; nenhuma quando tudo é zero', () => {
    expect(biggestLossSentence(loss(65))).toBe('A maior perda veio da floração e enchimento (−9,8 sc/ha).');
    expect(biggestLossSentence(loss(null))).toBe('A maior perda veio da floração e enchimento (−15 %).');
    const zero = { ...loss(65), phases: loss(65).phases.map((p) => ({ ...p, lossPct: 0, lossScHa: 0 })) };
    expect(biggestLossSentence(zero)).toBeNull();
  });
});

describe('storyModel', () => {
  const days = [
    ...Array.from({ length: 7 }, (_, i) => ({ date: `2025-11-${String(i + 1).padStart(2, '0')}`, phase: 'F1' as const })),
    ...Array.from({ length: 20 }, (_, i) => ({ date: `2025-11-${String(i + 8).padStart(2, '0')}`, phase: 'F2' as const })),
    ...Array.from({ length: 29 }, (_, i) => ({ date: `2025-12-${String(i + 1).padStart(2, '0')}`, phase: 'F3' as const })),
    ...Array.from({ length: 21 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, phase: 'F4' as const })),
  ];
  const base = { run: { expectedYield: 65, predictedYield: 52, emergenceDepletionPct: 87, cultivarSnapshot: SOJA_KY }, phases: null, days, currentPhase: 'COMPLETED' as const, today: '2026-03-01' };

  it('com Ym, evento em F3 e solo seco na emergência', () => {
    const m = storyModel({ ...base, events: [F3_EVENT], yieldLoss: loss(65) });
    expect(m.dryEmergence).toBe(true);
    expect(m.todayShare).toBeNull(); // ciclo encerrado
    expect(m.events[0]!.sentence).toContain('esta é a fase que mais pesa');
    expect(m.emptyEvents).toBeNull();
    expect(m.predictedText).toBe('52,0 sc/ha');
    expect(m.expectedText).toBe('de um potencial de 65 sacas');
    expect(m.lossText).toBe('perda de 13 sacas por hectare (20 %)');
    expect(m.bars.find((b) => b.biggest)!.phase).toBe('F3');
    expect(m.bars[2]!.text).toBe('10,0 sc/ha');
    expect(m.bars[2]!.share).toBe(1);
    expect(m.biggestLoss).toContain('floração e enchimento');
    expect(m.footer).toBe('Estimativa com base na água disponível no solo; não considera pragas, doenças, adubação, excesso de chuva ou granizo.');
    expect(m.totalDays).toBe(77);
  });

  it('sem eventos e sem Ym: frase vazia, barras em %, convite fica a cargo do componente', () => {
    const m = storyModel({ ...base, run: { ...base.run, expectedYield: null, predictedYield: null, emergenceDepletionPct: 20 }, events: [], yieldLoss: loss(null), currentPhase: 'F3', today: '2025-12-15' });
    expect(m.dryEmergence).toBe(false);
    expect(m.emptyEvents).toBe('Nenhum período de falta de água relevante até agora.');
    expect(m.hasYm).toBe(false);
    expect(m.predictedText).toBeNull();
    expect(m.lossText).toBe('perda estimada de 20 % da produtividade');
    expect(m.bars[2]!.text).toBe('15 %');
    expect(m.todayShare).toBeCloseTo(41 / 77, 9); // 15/12 é o 42º dia do ciclo
  });

  it('tudo zero ⇒ "Nenhuma janela teve perda relevante."', () => {
    const zero = { ...loss(65), totalLossPct: 0, totalLossScHa: 0, phases: loss(65).phases.map((p) => ({ ...p, lossPct: 0, lossScHa: 0 })) };
    const m = storyModel({ ...base, events: [], yieldLoss: zero });
    expect(m.biggestLoss).toBe(NO_LOSS_SENTENCE);
    expect(m.lossText).toBe('sem perda relevante por falta de água');
    expect(m.bars.every((b) => b.share === 0 && !b.biggest)).toBe(true);
  });

  it('timelineShare: emergência 0, fora −1', () => {
    const m = storyModel({ ...base, events: [], yieldLoss: loss(65) });
    expect(timelineShare(m.ranges, m.totalDays, '2025-11-01')).toBe(0);
    expect(timelineShare(m.ranges, m.totalDays, '2026-05-01')).toBe(-1);
    expect(DRY_EMERGENCE_PCT).toBe(70);
  });
});
