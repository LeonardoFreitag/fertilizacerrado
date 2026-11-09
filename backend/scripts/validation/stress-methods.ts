// Funções puras do Caso 2 (eventos de estresse × veranicos observados): sequências secas na
// série da estação e sobreposição com os eventos detectados pelo motor. Sem banco.
import type { StressEvent } from '../../src/modules/msa/engine';

export interface StationDay {
  /** AAAA-MM-DD */
  date: string;
  /** Chuva observada (mm); null = sem observação (interrompe uma sequência) */
  precipMm: number | null;
}

export interface DrySpell {
  start: string;
  end: string;
  days: number;
  /** Chuva total do período (mm) — sempre < dryMm × dias */
  rainMm: number;
}

function addDays(iso: string, n: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Veranicos: dias consecutivos (no calendário) com `precipMm < dryMm`, com duração ≥ `minDays`.
 * Um dia sem observação, ou ausente da série, interrompe a sequência.
 */
export function drySpells(obs: ReadonlyArray<StationDay>, dryMm: number, minDays: number): DrySpell[] {
  if (!(dryMm > 0)) throw new RangeError(`dryMm deve ser > 0: ${dryMm}`);
  if (!Number.isInteger(minDays) || minDays < 1) throw new RangeError(`minDays deve ser inteiro ≥ 1: ${minDays}`);
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const spells: DrySpell[] = [];
  let cur: { start: string; prev: string; days: number; rain: number } | null = null;
  const flush = () => {
    if (cur && cur.days >= minDays) spells.push({ start: cur.start, end: cur.prev, days: cur.days, rainMm: cur.rain });
    cur = null;
  };
  for (const d of sorted) {
    const dry = d.precipMm != null && d.precipMm < dryMm;
    const contiguous = cur !== null && addDays(cur.prev, 1) === d.date;
    if (!dry || !contiguous) flush();
    if (dry) {
      if (cur === null) cur = { start: d.date, prev: d.date, days: 1, rain: d.precipMm! };
      else {
        cur.prev = d.date;
        cur.days += 1;
        cur.rain += d.precipMm!;
      }
    }
  }
  flush();
  return spells;
}

/** Fração (0–1) dos dias do evento que caem dentro de algum veranico. */
export function coverage(event: Pick<StressEvent, 'start' | 'end' | 'days'>, spells: ReadonlyArray<DrySpell>): number {
  let covered = 0;
  for (let d = event.start; d <= event.end; d = addDays(d, 1)) {
    if (spells.some((s) => d >= s.start && d <= s.end)) covered++;
  }
  return event.days === 0 ? 0 : covered / event.days;
}

/** Deslocamento (dias) do início do veranico mais próximo em relação ao início do evento (negativo = veranico começou antes); null sem veranicos. */
export function nearestSpellOffset(event: Pick<StressEvent, 'start'>, spells: ReadonlyArray<DrySpell>): number | null {
  if (spells.length === 0) return null;
  const t0 = Date.parse(`${event.start}T00:00:00Z`);
  let best: number | null = null;
  for (const s of spells) {
    const offset = Math.round((Date.parse(`${s.start}T00:00:00Z`) - t0) / 86_400_000);
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}
