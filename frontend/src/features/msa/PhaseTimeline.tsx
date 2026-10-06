import type { DailyRow, Phase, YieldPhase } from '@/lib/api/types';
import { PHASE_LABELS } from '@/lib/api/types';
import { formatDate, phaseRanges, todayIso } from '@/lib/msa/msa';

export const PHASE_COLORS: Record<YieldPhase, { bg: string; fill: string }> = {
  F1: { bg: 'bg-sky-400', fill: '#38bdf8' },
  F2: { bg: 'bg-brand-500', fill: '#549338' },
  F3: { bg: 'bg-earth-500', fill: '#c2651b' },
  F4: { bg: 'bg-amber-400', fill: '#fbbf24' },
};

export function PhaseTimeline({ days, currentPhase }: { days: ReadonlyArray<DailyRow>; currentPhase: Phase | null }) {
  const t = phaseRanges(days);
  if (t.totalDays === 0) return null;
  const today = todayIso();
  const inCycle = t.cycleStart && t.cycleEnd && today >= t.cycleStart && today <= t.cycleEnd;
  const todayIndex = inCycle ? days.filter((d) => d.date <= today).length : null;
  const total = t.totalDays + t.pending.length * 0; // pendentes recebem largura mínima fixa

  return (
    <div className="card" aria-label="Linha do tempo fenológica">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Linha do tempo fenológica</h2>
        <span className="text-xs text-slate-500">
          {formatDate(t.cycleStart)} → {formatDate(t.cycleEnd)} · {t.totalDays} dias{currentPhase === 'COMPLETED' ? ' · ciclo encerrado' : ''}
        </span>
      </div>
      <div className="relative flex h-8 w-full overflow-hidden rounded-md bg-slate-100 text-[11px] font-medium text-white">
        {t.ranges.map((r) => (
          <div
            key={r.phase}
            className={`${PHASE_COLORS[r.phase].bg} flex items-center justify-center border-r border-white/60`}
            style={{ width: `${(r.days / total) * (t.pending.length ? 85 : 100)}%` }}
            title={`${PHASE_LABELS[r.phase]}: ${formatDate(r.start)} – ${formatDate(r.end)} (${r.days} dias)`}
          >
            {r.phase}
          </div>
        ))}
        {t.pending.map((p) => (
          <div
            key={p}
            className="flex items-center justify-center border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400"
            style={{ width: `${15 / t.pending.length}%` }}
            title={`${PHASE_LABELS[p]}: não alcançada`}
          >
            {p}
          </div>
        ))}
        {todayIndex != null && (
          <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${(todayIndex / total) * (t.pending.length ? 85 : 100)}%` }} title={`Hoje (${formatDate(today)})`} aria-label="Hoje" />
        )}
      </div>
      <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-4">
        {t.ranges.map((r) => (
          <li key={r.phase}>
            <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${PHASE_COLORS[r.phase].bg}`} aria-hidden="true" />
            <strong>{r.phase}</strong> {formatDate(r.start)} – {formatDate(r.end)} ({r.days} d)
          </li>
        ))}
        {t.pending.map((p) => (
          <li key={p} className="text-slate-400">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-slate-400" aria-hidden="true" />
            <strong>{p}</strong> não alcançada
          </li>
        ))}
      </ul>
    </div>
  );
}
