/**
 * Textos da seção "Como foi a safra": frases em pt-BR para o produtor, geradas
 * por funções puras a partir dos eventos de estresse, da atribuição de perda e
 * dos resumos da run. Nenhuma frase é montada em JSX. Convenções: datas por
 * extenso (com o ano quando o intervalo muda de ano), sacas arredondadas a 0,5,
 * milímetros a 5. `docs/modulos/frontend.md`.
 */
import type { Phase, PhaseView, RunView, StressEvent, YieldLossAttribution, YieldPhase } from '../api/types';
import { PHASE_FIELD_LABELS, formatScHa, phaseRanges, type PhaseRange } from './msa';

export const STORY_FOOTER = 'Estimativa com base na água disponível no solo; não considera pragas, doenças, adubação, excesso de chuva ou granizo.';
/** Depleção na emergência (% de TAW(zrIni)) a partir da qual a linha do tempo marca "solo seco na emergência". */
export const DRY_EMERGENCE_PCT = 70;

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const num = (digits: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits });

function parts(iso: string): { d: number; m: number; y: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** Arredonda a 0,5 (sacas). */
export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/** Arredonda a 5 (milímetros). */
export function roundTo5(value: number): number {
  return Math.round(value / 5) * 5;
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${num(0).format(n)} ${n === 1 ? singular : pluralForm}`;
}

/** "12 a 23 de janeiro", "28 de janeiro a 3 de fevereiro", "30 de dezembro de 2025 a 4 de janeiro de 2026", "12 de janeiro" (um dia). */
export function formatDayRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} de ${MONTHS[a.m - 1]}`;
  if (a.y !== b.y) return `${a.d} de ${MONTHS[a.m - 1]} de ${a.y} a ${b.d} de ${MONTHS[b.m - 1]} de ${b.y}`;
  if (a.m !== b.m) return `${a.d} de ${MONTHS[a.m - 1]} a ${b.d} de ${MONTHS[b.m - 1]}`;
  return `${a.d} a ${b.d} de ${MONTHS[a.m - 1]}`;
}

export function phaseFieldLabel(phase: YieldPhase, lower = false): string {
  const label = PHASE_FIELD_LABELS[phase];
  return lower ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** Do mais danoso ao menos: déficit × Ky da janela dominante; empate → o mais longo, depois o mais antigo. */
export function rankEvents(events: ReadonlyArray<StressEvent>): StressEvent[] {
  return [...events].sort((a, b) => b.deficitMm * b.kyDominant - a.deficitMm * a.kyDominant || b.days - a.days || a.start.localeCompare(b.start));
}

/** Rótulo curto do segmento na linha do tempo ("12 dias com pouca água"). */
export function eventLabel(event: StressEvent): string {
  return `${plural(event.days, 'dia', 'dias')} com pouca água`;
}

/**
 * "12 a 23 de janeiro · 12 dias · floração e enchimento · a lavoura ficou sem cerca de 40 mm"
 * (+ " · esta é a fase que mais pesa na produção" quando a janela dominante é a de maior Ky).
 */
export function eventSentence(event: StressEvent, heaviestPhase: YieldPhase | null): string {
  const mm = roundTo5(event.deficitMm);
  const water = mm < 5 ? 'a lavoura ficou sem menos de 5 mm' : `a lavoura ficou sem cerca de ${num(0).format(mm)} mm`;
  const base = `${formatDayRange(event.start, event.end)} · ${plural(event.days, 'dia', 'dias')} · ${phaseFieldLabel(event.dominantPhase, true)} · ${water}`;
  return heaviestPhase && event.dominantPhase === heaviestPhase ? `${base} · esta é a fase que mais pesa na produção` : base;
}

export function emptyEventsSentence(completed: boolean): string {
  return completed ? 'Nenhum período de falta de água relevante neste ciclo.' : 'Nenhum período de falta de água relevante até agora.';
}

/** "de um potencial de 65 sacas" — a Ym é sempre "potencial"; "esperada" fica só para a predição. */
export function expectedSentence(ym: number): string {
  return `de um potencial de ${num(1).format(ym)} sacas`;
}

/** "perda de 13 sacas por hectare (20 %)"; "sem perda relevante" abaixo de 0,5 saca. */
export function lossSentence(totalLossScHa: number, totalLossPct: number): string {
  const sacks = roundHalf(totalLossScHa);
  if (sacks < 0.5) return 'sem perda relevante por falta de água';
  return `perda de ${plural(sacks, 'saca', 'sacas')} por hectare (${num(0).format(totalLossPct)} %)`;
}

/** Só percentual, sem Ym: "perda estimada de 20 % da produtividade". */
export function lossPctSentence(totalLossPct: number): string {
  const pct = Math.round(totalLossPct);
  return pct < 1 ? 'sem perda relevante por falta de água' : `perda estimada de ${num(0).format(pct)} % da produtividade`;
}

/** "A maior perda veio da floração e enchimento (−12,0 sc/ha)" ou "(−18 %)" sem Ym; null quando tudo é zero. */
export function biggestLossSentence(loss: YieldLossAttribution): string | null {
  const top = [...loss.phases].sort((a, b) => b.lossPct - a.lossPct)[0];
  if (!top || top.lossPct < 0.5) return null;
  const amount = top.lossScHa != null ? `−${formatScHa(top.lossScHa)}` : `−${num(0).format(Math.round(top.lossPct))} %`;
  return `A maior perda veio da ${phaseFieldLabel(top.phase, true)} (${amount}).`;
}

export const NO_LOSS_SENTENCE = 'Nenhuma janela teve perda relevante.';
export const OLD_RUN_SENTENCE = 'Esta execução não tem a leitura da safra (motor anterior); reprocesse para gerá-la.';
export const COMPUTED_ON_READ_SENTENCE = 'Leitura calculada agora com os parâmetros atuais; reprocesse para gravá-la na execução.';

/** Janela de maior Ky entre as quatro (a que "mais pesa na produção"); null se o snapshot não traz os Ky. */
export function heaviestPhase(cultivarSnapshot: unknown): YieldPhase | null {
  const c = cultivarSnapshot as Partial<Record<'kyF1' | 'kyF2' | 'kyF3' | 'kyF4', number>> | null;
  if (!c || [c.kyF1, c.kyF2, c.kyF3, c.kyF4].some((k) => typeof k !== 'number')) return null;
  const entries: [YieldPhase, number][] = [['F1', c.kyF1!], ['F2', c.kyF2!], ['F3', c.kyF3!], ['F4', c.kyF4!]];
  return entries.sort((a, b) => b[1] - a[1])[0]![0];
}

export interface StoryEvent {
  event: StressEvent;
  label: string;
  sentence: string;
}

export interface StoryLossBar {
  phase: YieldPhase;
  label: string;
  /** Perda em sacas (com Ym) ou em % (sem Ym) */
  value: number;
  text: string;
  /** Fração da maior barra (0–1) para a largura */
  share: number;
  biggest: boolean;
}

export interface StoryModel {
  ranges: PhaseRange[];
  cycleStart: string | null;
  cycleEnd: string | null;
  totalDays: number;
  /** Posição do marcador de hoje em [0, 1]; null quando o ciclo já encerrou ou hoje está fora */
  todayShare: number | null;
  dryEmergence: boolean;
  events: StoryEvent[];
  emptyEvents: string | null;
  hasYm: boolean;
  predictedText: string | null;
  expectedText: string | null;
  lossText: string;
  bars: StoryLossBar[];
  biggestLoss: string | null;
  footer: string;
}

function dayIndex(ranges: PhaseRange[], iso: string): number {
  let acc = 0;
  for (const r of ranges) {
    if (iso >= r.start && iso <= r.end) return acc + Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000);
    acc += r.days;
  }
  return -1;
}

/** Posição (0–1) de um dia na barra do ciclo; -1 fora. */
export function timelineShare(ranges: PhaseRange[], totalDays: number, iso: string): number {
  const i = dayIndex(ranges, iso);
  return i < 0 || totalDays === 0 ? -1 : i / totalDays;
}

/** Tudo que a seção renderiza, já formatado. `today` em AAAA-MM-DD. */
export function storyModel(input: {
  run: Pick<RunView, 'expectedYield' | 'predictedYield' | 'emergenceDepletionPct' | 'cultivarSnapshot'>;
  phases: ReadonlyArray<PhaseView> | null;
  events: ReadonlyArray<StressEvent>;
  yieldLoss: YieldLossAttribution;
  days: ReadonlyArray<Pick<import('../api/types').DailyRow, 'date' | 'phase'>>;
  currentPhase: Phase | null;
  today: string;
}): StoryModel {
  const timeline = phaseRanges(input.days);
  const completed = input.currentPhase === 'COMPLETED';
  const heaviest = heaviestPhase(input.run.cultivarSnapshot);
  const ranked = rankEvents(input.events);
  const hasYm = input.yieldLoss.ym != null;
  const todayShare = !completed && timeline.cycleEnd && input.today <= timeline.cycleEnd ? Math.max(0, timelineShare(timeline.ranges, timeline.totalDays, input.today)) : null;

  const values = input.yieldLoss.phases.map((p) => (hasYm ? (p.lossScHa ?? 0) : p.lossPct));
  const max = Math.max(0, ...values);
  const bars: StoryLossBar[] = input.yieldLoss.phases.map((p, i) => {
    const value = values[i]!;
    return {
      phase: p.phase,
      label: PHASE_FIELD_LABELS[p.phase],
      value,
      text: hasYm ? formatScHa(roundHalf(value)) : `${num(0).format(Math.round(value))} %`,
      share: max > 0 ? value / max : 0,
      biggest: max > 0 && value === max,
    };
  });

  return {
    ranges: timeline.ranges,
    cycleStart: timeline.cycleStart,
    cycleEnd: timeline.cycleEnd,
    totalDays: timeline.totalDays,
    todayShare,
    dryEmergence: (input.run.emergenceDepletionPct ?? 0) >= DRY_EMERGENCE_PCT,
    events: ranked.map((event) => ({ event, label: eventLabel(event), sentence: eventSentence(event, heaviest) })),
    emptyEvents: ranked.length === 0 ? emptyEventsSentence(completed) : null,
    hasYm,
    predictedText: hasYm && input.yieldLoss.predictedYield != null ? formatScHa(roundHalf(input.yieldLoss.predictedYield)) : null,
    expectedText: hasYm ? expectedSentence(input.yieldLoss.ym!) : null,
    lossText: hasYm && input.yieldLoss.totalLossScHa != null ? lossSentence(input.yieldLoss.totalLossScHa, input.yieldLoss.totalLossPct) : lossPctSentence(input.yieldLoss.totalLossPct),
    bars,
    biggestLoss: biggestLossSentence(input.yieldLoss) ?? NO_LOSS_SENTENCE,
    footer: STORY_FOOTER,
  };
}
