import type { StoryEvent, StoryModel } from '@/lib/msa/story';
import { timelineShare } from '@/lib/msa/story';
import { PHASE_FIELD_LABELS, formatDate } from '@/lib/msa/msa';
import { PHASE_COLORS } from './PhaseTimeline';

/**
 * Linha do tempo da cultura em linguagem do campo: barra proporcional aos dias
 * das janelas, eventos de estresse como segmentos vermelhos, marcador de hoje e
 * de "solo seco na emergência". Uma lista só para leitores de tela repete tudo.
 */
export function CropTimeline({ model }: { model: StoryModel }) {
  const { ranges, totalDays, events, todayShare, dryEmergence, cycleStart, cycleEnd } = model;
  if (ranges.length === 0 || totalDays === 0) return <p className="text-sm text-slate-500">Sem dias de cultura processados.</p>;

  const segment = (e: StoryEvent) => {
    const a = timelineShare(ranges, totalDays, e.event.start);
    const b = timelineShare(ranges, totalDays, e.event.end);
    if (a < 0 || b < 0) return null;
    const left = a * 100;
    const width = Math.max(((b - a) * totalDays + 1) / totalDays * 100, 0.8);
    return { left, width, showLabel: width >= 9 };
  };

  return (
    <div data-testid="crop-timeline">
      <div className="relative pt-7">
        {/* eventos (acima da barra) */}
        {events.map((e) => {
          const s = segment(e);
          if (!s) return null;
          return (
            <div
              key={e.event.start}
              data-testid="stress-segment"
              title={e.sentence}
              className="absolute top-0 flex h-6 items-center justify-center rounded-sm bg-red-600 text-[11px] font-medium text-white"
              style={{ left: `${s.left}%`, width: `${s.width}%` }}
            >
              {s.showLabel ? e.label : ''}
            </div>
          );
        })}
        {/* barra das janelas */}
        <div className="flex h-8 w-full overflow-hidden rounded-md" role="presentation">
          {ranges.map((r) => (
            <div key={r.phase} className={`${PHASE_COLORS[r.phase].bg} flex items-center justify-center text-xs font-medium text-white`} style={{ width: `${(r.days / totalDays) * 100}%` }} title={`${PHASE_FIELD_LABELS[r.phase]}: ${formatDate(r.start)} – ${formatDate(r.end)} (${r.days} dias)`}>
              <span className="truncate px-1">{PHASE_FIELD_LABELS[r.phase]}</span>
            </div>
          ))}
        </div>
        {todayShare != null && (
          <div className="absolute top-7 h-8 w-0.5 bg-slate-900" style={{ left: `${todayShare * 100}%` }} title="hoje" data-testid="today-marker">
            <span className="absolute -top-0 left-1 text-[10px] font-semibold text-slate-900">hoje</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-600">
        <span className="flex flex-wrap items-center gap-2">
          <span>Emergência · {formatDate(cycleStart)}</span>
          {dryEmergence && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900" data-testid="dry-emergence-marker" title="O solo estava com pouca água disponível no dia da emergência (veja o cartão Água no solo na emergência)">
              solo seco na emergência
            </span>
          )}
        </span>
        <span>{cycleEnd ? formatDate(cycleEnd) : ''}</span>
      </div>
      <ul className="sr-only" aria-label="Linha do tempo da cultura (texto)">
        {ranges.map((r) => (
          <li key={r.phase}>
            {PHASE_FIELD_LABELS[r.phase]}: de {formatDate(r.start)} a {formatDate(r.end)}, {r.days} dias
          </li>
        ))}
        {dryEmergence && <li>Solo seco na emergência</li>}
        {events.map((e) => (
          <li key={`ev-${e.event.start}`}>Estresse: {e.sentence}</li>
        ))}
      </ul>
    </div>
  );
}
