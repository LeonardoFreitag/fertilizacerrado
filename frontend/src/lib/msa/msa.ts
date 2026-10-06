/** Funções puras do painel MSA: severidade, faixas fenológicas, formatação, safra sugerida. */
import type { DailyRow, Percentiles, Phase, YieldPhase } from '../api/types';

/**
 * Limiares de severidade do Ks médio da janela (fluxo operacional de docs/modulos/msa.md:
 * Ks < 0,85 = estresse moderado; < 0,70 = severo).
 */
export const KS_OK = 0.85;
export const KS_WARNING = 0.7;

export type Severity = 'ok' | 'warning' | 'critical' | 'pending';

export const SEVERITY_LABELS: Record<Severity, string> = {
  ok: 'ok',
  warning: 'atenção',
  critical: 'crítico',
  pending: 'não alcançada',
};

export function severity(ksMean: number | null | undefined): Severity {
  if (ksMean == null || Number.isNaN(ksMean)) return 'pending';
  if (ksMean >= KS_OK) return 'ok';
  if (ksMean >= KS_WARNING) return 'warning';
  return 'critical';
}

export interface PhaseRange {
  phase: YieldPhase;
  start: string;
  end: string;
  days: number;
}

export interface Timeline {
  ranges: PhaseRange[];
  /** Janelas sem nenhum dia na série */
  pending: YieldPhase[];
  cycleStart: string | null;
  cycleEnd: string | null;
  totalDays: number;
}

const YIELD: YieldPhase[] = ['F1', 'F2', 'F3', 'F4'];

/** Primeira e última data de cada fase presente na série (ordem F1→F4). */
export function phaseRanges(days: ReadonlyArray<Pick<DailyRow, 'date' | 'phase'>>): Timeline {
  const byPhase = new Map<YieldPhase, { start: string; end: string; days: number }>();
  for (const d of days) {
    const phase = d.phase === 'COMPLETED' ? 'F4' : d.phase;
    const cur = byPhase.get(phase);
    if (!cur) byPhase.set(phase, { start: d.date, end: d.date, days: 1 });
    else {
      if (d.date < cur.start) cur.start = d.date;
      if (d.date > cur.end) cur.end = d.date;
      cur.days += 1;
    }
  }
  const ranges: PhaseRange[] = [];
  const pending: YieldPhase[] = [];
  for (const p of YIELD) {
    const r = byPhase.get(p);
    if (r) ranges.push({ phase: p, ...r });
    else pending.push(p);
  }
  const sorted = [...days].map((d) => d.date).sort();
  return {
    ranges,
    pending,
    cycleStart: sorted[0] ?? null,
    cycleEnd: sorted[sorted.length - 1] ?? null,
    totalDays: days.length,
  };
}

const num = (digits: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatNumber(value: number | null | undefined, digits = 2): string {
  return value == null || Number.isNaN(value) ? '—' : num(digits).format(value);
}

export function formatPercentiles(p: Percentiles | null | undefined, digits = 2): string {
  if (!p) return '—';
  return `P10 ${formatNumber(p.p10, digits)} · P50 ${formatNumber(p.p50, digits)} · P90 ${formatNumber(p.p90, digits)}`;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  return value == null || Number.isNaN(value) ? '—' : `${num(digits).format(value)}%`;
}

export function formatMm(value: number | null | undefined, digits = 1): string {
  return value == null || Number.isNaN(value) ? '—' : `${num(digits).format(value)} mm`;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const dateShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** "2025-11-01" → "01/11/2025" (datas-calendário, sem fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function formatDateShort(iso: string): string {
  return dateShort.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace('.', '');
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Safra agrícola a partir da emergência: de julho a dezembro a safra começa no ano
 * corrente (2025-11-01 → "2025/26"); de janeiro a junho, no anterior (2026-02-15 → "2025/26").
 */
export function suggestSeason(emergenceDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(emergenceDate);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = month >= 7 ? year : year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export function phaseLabelShort(phase: Phase): string {
  return phase === 'COMPLETED' ? 'Fim' : phase;
}
