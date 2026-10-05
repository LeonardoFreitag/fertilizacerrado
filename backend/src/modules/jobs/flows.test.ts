import { parseExpression } from 'cron-parser';
import { describe, expect, it } from 'vitest';
import { QUEUES } from '../../config/queue';
import {
  WEEKLY_CRON,
  WEEKLY_TZ,
  buildBackfillFlow,
  buildWeeklyFlow,
  jobIds,
  planHarvestJobs,
  todayInTz,
} from './flows';

describe('planHarvestJobs', () => {
  it('cobertura completa ⇒ só processar', () => {
    expect(planHarvestJobs({ missingDates: [] }, '2025-11-01', '2026-09-29')).toBe('process');
  });

  it('lacuna ⇒ backfill (ingest da célula antes)', () => {
    expect(planHarvestJobs({ missingDates: ['2025-11-15'] }, '2025-11-01', '2026-09-29')).toBe('backfill');
    expect(planHarvestJobs(null, '2025-11-01', '2026-09-29')).toBe('backfill');
  });

  it('emergência dentro do lag ⇒ só processar (vira NEEDS_DATA)', () => {
    expect(planHarvestJobs({ missingDates: ['2026-10-01'] }, '2026-10-01', '2026-09-29')).toBe('process-only-lag');
  });
});

describe('flows', () => {
  it('semanal: pai msa-weekly:run com filho era5-ingest latest que falha o pai', () => {
    const flow = buildWeeklyFlow('2026-10-05');
    expect(flow.queueName).toBe(QUEUES.weekly);
    expect(flow.name).toBe('run');
    expect(flow.opts?.jobId).toBe('weekly_2026-10-05');
    const child = flow.children![0]!;
    expect(child.queueName).toBe(QUEUES.ingest);
    expect(child.data).toEqual({ kind: 'latest' });
    expect(child.opts?.jobId).toBe('ingest-latest_2026-10-05');
    expect(child.opts?.attempts).toBe(3);
    expect(child.opts?.backoff).toEqual({ type: 'exponential', delay: 300_000 });
    expect(child.opts?.failParentOnFailure).toBe(true);
  });

  it('backfill: pai msa-process BACKFILL com filho era5-ingest cell', () => {
    const flow = buildBackfillFlow('h1', { lat: -16.7, lon: -49.3 }, '2025-11-01', '2026-09-29');
    expect(flow.queueName).toBe(QUEUES.process);
    expect(flow.data).toEqual({ harvestId: 'h1', reason: 'BACKFILL' });
    expect(flow.opts?.jobId).toBe('backfill_h1');
    expect(flow.opts?.attempts).toBe(1);
    expect(flow.children![0]!.data).toEqual({ kind: 'cell', lat: -16.7, lon: -49.3, from: '2025-11-01', to: '2026-09-29' });
    expect(flow.children![0]!.opts?.failParentOnFailure).toBe(true);
  });

  it('ids determinísticos', () => {
    expect(jobIds.weeklyProcess('2026-10-05', 'h1')).toBe('weekly_2026-10-05_h1');
    expect(jobIds.backfill('h1')).toBe(jobIds.backfill('h1'));
  });
});

describe('agendamento semanal', () => {
  it('próximo disparo é segunda-feira 02:00 em America/Sao_Paulo (05:00 UTC)', () => {
    const expr = parseExpression(WEEKLY_CRON, { tz: WEEKLY_TZ, currentDate: new Date('2026-10-05T12:00:00Z') });
    const next = expr.next().toDate();
    expect(next.toISOString()).toBe('2026-10-12T05:00:00.000Z');
    expect(next.toLocaleString('sv-SE', { timeZone: WEEKLY_TZ, weekday: 'long' })).toContain('måndag');
    expect(next.toLocaleTimeString('sv-SE', { timeZone: WEEKLY_TZ })).toBe('02:00:00');
  });

  it('todayInTz usa o fuso do agendador', () => {
    // 23:30 em Brasília (UTC−3) de 2026-10-05 = 02:30 UTC de 2026-10-06
    expect(todayInTz(WEEKLY_TZ, new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-05');
    expect(todayInTz('UTC', new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-06');
  });
});
