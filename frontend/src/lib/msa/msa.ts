/** Funções puras do painel MSA: severidade, faixas fenológicas, produtividade, formatação, safra sugerida. */
import type { DailyRow, Phase, PhaseView, RunView, StressEvent, YieldLossAttribution, YieldPhase } from '../api/types';
// (RunView também alimenta soilWaterTexts)
import { toCsv } from './csv';

/**
 * Limiares de severidade — espelho das constantes do motor
 * (`backend/src/modules/msa/engine/stress.ts`; convenção registrada em
 * docs/msa/questoes-abertas.md #4 e #14). Janela: pela perda estimada de
 * produtividade (%); dia: pelo Ks. Sem pacote compartilhado, os valores são
 * repetidos aqui e fixados por teste dos dois lados.
 */
export const LOSS_WARNING_PCT = 5;
export const LOSS_CRITICAL_PCT = 15;
export const KS_OK = 0.85;
export const KS_WARNING = 0.7;

export type Severity = 'ok' | 'warning' | 'critical' | 'pending';

export const SEVERITY_LABELS: Record<Severity, string> = {
  ok: 'ok',
  warning: 'atenção',
  critical: 'crítico',
  pending: 'não alcançada',
};

/** Severidade da janela pela redução potencial de produtividade (%); nulo = não alcançada. */
export function windowSeverity(yieldReductionPct: number | null | undefined): Severity {
  if (yieldReductionPct == null || Number.isNaN(yieldReductionPct)) return 'pending';
  if (yieldReductionPct < LOSS_WARNING_PCT) return 'ok';
  if (yieldReductionPct <= LOSS_CRITICAL_PCT) return 'warning';
  return 'critical';
}

/** Severidade do dia pelo Ks (gráficos e eventos). */
export function daySeverity(ks: number): Severity {
  if (ks >= KS_OK) return 'ok';
  if (ks >= KS_WARNING) return 'warning';
  return 'critical';
}

/** Nomes das janelas em linguagem do campo (seção "Como foi a safra"). */
export const PHASE_FIELD_LABELS: Record<YieldPhase, string> = {
  F1: 'Germinação',
  F2: 'Crescimento',
  F3: 'Floração e enchimento',
  F4: 'Maturação',
};

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
    if (d.phase === 'PRE') continue; // entressafra fica fora da linha do tempo F1–F4
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
  const crop = days.filter((d) => d.phase !== 'PRE');
  const sorted = crop.map((d) => d.date).sort();
  return {
    ranges,
    pending,
    cycleStart: sorted[0] ?? null,
    cycleEnd: sorted[sorted.length - 1] ?? null,
    totalDays: crop.length,
  };
}

/** Faixa de entressafra (dias PRE) da série, ou null quando não há. */
export function preSeasonRange(days: ReadonlyArray<Pick<DailyRow, 'date' | 'phase'>>): { start: string; end: string; days: number } | null {
  const pre = days.filter((d) => d.phase === 'PRE').map((d) => d.date).sort();
  return pre.length ? { start: pre[0]!, end: pre[pre.length - 1]!, days: pre.length } : null;
}

/** Chuva acumulada nos `window` dias anteriores à emergência (exclusive), em mm. */
export function rainBeforeEmergence(days: ReadonlyArray<Pick<DailyRow, 'date' | 'precipitation'>>, emergence: string, window = 30): number {
  const from = new Date(new Date(`${emergence}T00:00:00Z`).getTime() - window * 86_400_000).toISOString().slice(0, 10);
  return days.filter((d) => d.date >= from && d.date < emergence).reduce((acc, d) => acc + d.precipitation, 0);
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface MissingDatesView {
  /** Agrupado por mês quando há mais de `threshold` datas */
  grouped: boolean;
  /** "fev/2026: 28 dias" por mês (ordem cronológica), ou vazio quando não agrupado */
  groups: { label: string; count: number }[];
  /** Datas formatadas (lista completa) */
  dates: string[];
  total: number;
}

/** Datas faltantes: por extenso até `threshold`; acima disso, agrupadas por mês com a lista completa à parte. */
export function groupMissingDates(dates: ReadonlyArray<string>, threshold = 14): MissingDatesView {
  const sorted = [...dates].sort();
  const formatted = sorted.map(formatDate);
  if (sorted.length <= threshold) return { grouped: false, groups: [], dates: formatted, total: sorted.length };
  const counts = new Map<string, number>();
  for (const d of sorted) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  const groups = [...counts.entries()].map(([ym, count]) => {
    const [y, m] = ym.split('-');
    return { label: `${MONTHS_PT[Number(m) - 1]}/${y}: ${count} ${count === 1 ? 'dia' : 'dias'}`, count };
  });
  return { grouped: true, groups, dates: formatted, total: sorted.length };
}

/** Textos do cartão "Água no solo na emergência". */
export function soilWaterTexts(run: Pick<RunView, 'emergenceDepletionPct' | 'emergenceDepletionMm' | 'preSeasonFrom' | 'preSeasonKc' | 'preSeasonZr'>, emergence: string, tawIniMm: number | null) {
  if (run.preSeasonFrom == null || run.emergenceDepletionPct == null) return null;
  const available = Math.round(100 - run.emergenceDepletionPct);
  const preEnd = new Date(new Date(`${emergence}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  return {
    headline: `O talhão entrou na safra com ${available} % da água disponível`,
    depletion: tawIniMm == null ? `${formatNumber(run.emergenceDepletionMm, 1)} mm esgotados` : `${formatNumber(run.emergenceDepletionMm, 1)} de ${formatNumber(tawIniMm, 1)} mm esgotados`,
    period: `entressafra ${formatDate(run.preSeasonFrom)} → ${formatDate(preEnd)} (Kc ${formatNumber(run.preSeasonKc)}, Zr ${formatNumber(run.preSeasonZr)} m)`,
  };
}

const num = (digits: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatNumber(value: number | null | undefined, digits = 2): string {
  return value == null || Number.isNaN(value) ? '—' : num(digits).format(value);
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
  return phase === 'COMPLETED' ? 'Fim' : phase === 'PRE' ? 'Entressafra' : phase;
}

// --- produtividade (FAO-33, combinação multiplicativa; docs/msa/algoritmos.md §6) ------------

export interface YieldSummaryRow {
  phase: YieldPhase;
  reached: boolean;
  days: number;
  ksMean: number | null;
  /** Ky · (1 − Ks̄) em % */
  reductionPct: number | null;
  /** 1 − redução/100; 1 quando não alcançada */
  factor: number;
}

/** Uma linha por janela F1–F4, na ordem, com o fator que entra no índice do ciclo. */
export function yieldSummaryRows(phases: ReadonlyArray<PhaseView>): YieldSummaryRow[] {
  return YIELD.map((phase) => {
    const p = phases.find((x) => x.phase === phase);
    const reached = !!p && p.days > 0 && p.ksMean != null;
    const reductionPct = reached ? p!.yieldReductionPct : null;
    return {
      phase,
      reached,
      days: p?.days ?? 0,
      ksMean: reached ? p!.ksMean : null,
      reductionPct,
      factor: reductionPct == null ? 1 : Math.min(1, Math.max(0, 1 - reductionPct / 100)),
    };
  });
}

export interface YieldWarnings {
  /** Ciclo incompleto: a predição considera o restante do ciclo sem estresse */
  partial: boolean;
  /** A Ym atual da safra difere da Ym usada na run */
  ymChanged: boolean;
}

export function yieldWarnings(input: { phasesReached: number | null; currentPhase: Phase | null; runYm: number | null; harvestYm: number | null }): YieldWarnings {
  const partial = (input.phasesReached ?? 0) < 4 || input.currentPhase !== 'COMPLETED';
  const ymChanged = input.harvestYm != null && input.runYm != null ? input.harvestYm !== input.runYm : input.harvestYm != null && input.runYm == null;
  return { partial, ymChanged };
}

/** Índice do ciclo em % com uma casa ("73,6 %"). */
export function formatIndexPct(index: number | null | undefined): string {
  return index == null || Number.isNaN(index) ? '—' : `${num(1).format(index * 100)} %`;
}

/** Produtividade em sc/ha com uma casa ("47,8 sc/ha"). */
export function formatScHa(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '—' : `${num(1).format(value)} sc/ha`;
}

/**
 * CSV de resumos: uma linha por janela; índice, Ym e predita repetidos em todas as
 * linhas (vazios quando a run não tem Ym). Sem percentis nem linha final.
 */
export function summariesCsv(phases: ReadonlyArray<PhaseView>, run: Pick<RunView, 'yieldIndex' | 'expectedYield' | 'predictedYield'> & { yieldLoss?: YieldLossAttribution | null }): string {
  const loss = (phase: YieldPhase) => run.yieldLoss?.phases.find((p) => p.phase === phase)?.lossScHa ?? null;
  return toCsv(phases, [
    { header: 'janela', value: (p) => p.phase },
    { header: 'dias', value: (p) => p.days },
    { header: 'ks_medio', value: (p) => p.ksMean },
    { header: 'reducao_pct', value: (p) => p.yieldReductionPct },
    { header: 'etc_adj_mm', value: (p) => p.etcAdjAccum },
    { header: 'chuva_mm', value: (p) => p.precipAccum },
    { header: 'indice_ciclo', value: () => run.yieldIndex },
    { header: 'ym_sc_ha', value: () => run.expectedYield },
    { header: 'predita_sc_ha', value: () => run.predictedYield },
    { header: 'perda_sc_ha', value: (p) => loss(p.phase) },
  ]);
}

/** CSV de eventos de estresse: uma linha por evento (só o cabeçalho sem eventos). */
export function stressEventsCsv(events: ReadonlyArray<StressEvent>): string {
  return toCsv(events, [
    { header: 'inicio', value: (e) => e.start },
    { header: 'fim', value: (e) => e.end },
    { header: 'dias', value: (e) => e.days },
    { header: 'janela_dominante', value: (e) => e.dominantPhase },
    { header: 'janelas', value: (e) => e.phases.map((p) => `${p.phase}:${p.days}`).join(' ') },
    { header: 'ks_min', value: (e) => e.ksMin },
    { header: 'ks_medio', value: (e) => e.ksMean },
    { header: 'deficit_mm', value: (e) => e.deficitMm },
  ]);
}
