import { Link } from 'react-router';
import type { DailyRow, HarvestResponse, Phase, PhaseView, RunView } from '@/lib/api/types';
import { COMPUTED_ON_READ_SENTENCE, OLD_RUN_SENTENCE, storyModel } from '@/lib/msa/story';
import { formatScHa, todayIso, yieldWarnings } from '@/lib/msa/msa';
import { CropTimeline } from './CropTimeline';

/**
 * Seção final "Como foi a safra": leitura em linguagem simples, igual para
 * todos os papéis — linha do tempo com os momentos de estresse, lista dos
 * eventos, produtividade esperada e origem da perda, com rodapé fixo.
 */
export function SeasonStory({
  run,
  phases,
  days,
  currentPhase,
  harvest,
  canManage,
}: {
  run: RunView;
  phases: ReadonlyArray<PhaseView> | null;
  days: ReadonlyArray<DailyRow>;
  currentPhase: Phase | null;
  harvest: HarvestResponse;
  canManage: boolean;
}) {
  const header = (
    <div>
      <h2 className="text-lg font-semibold text-slate-800">Como foi a safra</h2>
      <p className="text-sm text-slate-600">O que a água disponível no solo fez com esta lavoura, em poucas linhas.</p>
    </div>
  );

  if (!run.stressEvents || !run.yieldLoss) {
    return (
      <section id="resumo-da-safra" className="card scroll-mt-20" aria-label="Como foi a safra" data-testid="season-story">
        {header}
        <p className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="story-old-run">
          {OLD_RUN_SENTENCE}
        </p>
      </section>
    );
  }

  const model = storyModel({ run, phases, events: run.stressEvents, yieldLoss: run.yieldLoss, days, currentPhase, today: todayIso() });
  const warnings = yieldWarnings({ phasesReached: run.phasesReached, currentPhase, runYm: run.expectedYield, harvestYm: harvest.expectedYield });

  return (
    <section id="resumo-da-safra" className="card scroll-mt-20 space-y-6" aria-label="Como foi a safra" data-testid="season-story">
      {header}
      {run.stressComputedOnRead && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="story-computed-on-read">
          {COMPUTED_ON_READ_SENTENCE}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Linha do tempo da cultura</h3>
        <CropTimeline model={model} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Momentos de estresse</h3>
        {model.emptyEvents ? (
          <p className="text-sm text-slate-700" data-testid="stress-empty">
            {model.emptyEvents}
          </p>
        ) : (
          <ol className="space-y-1 text-sm text-slate-800" data-testid="stress-list">
            {model.events.map((e) => (
              <li key={e.event.start} className="flex gap-2">
                <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-red-600" aria-hidden="true" />
                <span>{e.sentence}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Produtividade esperada</h3>
          {model.hasYm ? (
            <>
              <p className="text-4xl font-semibold text-slate-900" data-testid="story-predicted">
                {model.predictedText}
              </p>
              <p className="text-sm text-slate-700">{model.expectedText}</p>
              <p className="mt-1 text-sm text-slate-700" data-testid="story-loss">
                {model.lossText}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700" data-testid="story-loss">
                {model.lossText}
              </p>
              {canManage ? (
                <Link to={`/safras/${harvest.id}?editar=ym`} className="mt-1 block text-xs font-medium text-brand-700 underline" data-testid="story-inform-link">
                  Informar a produtividade potencial
                </Link>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Produtividade potencial não informada pelo responsável técnico; por isso a perda aparece só em porcentagem.</p>
              )}
            </>
          )}
          {warnings.partial && <p className="mt-2 text-xs text-amber-900">A safra ainda não terminou: o número considera o restante do ciclo sem falta de água.</p>}
          {warnings.ymChanged && <p className="mt-2 text-xs text-sky-900">A produtividade potencial da safra mudou para {formatScHa(harvest.expectedYield)}; reprocesse para atualizar.</p>}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">De onde veio a perda</h3>
          <ul className="space-y-1.5" data-testid="loss-bars">
            {model.bars.map((b) => (
              <li key={b.phase} className="grid grid-cols-[11.5rem_1fr_5.5rem] items-center gap-2 text-sm" data-testid={`loss-bar-${b.phase}`} data-biggest={b.biggest || undefined}>
                <span className={b.biggest ? 'font-semibold text-slate-900' : 'text-slate-700'}>{b.label}</span>
                <span className="h-3 w-full rounded bg-slate-100" aria-hidden="true">
                  <span className={`block h-3 rounded ${b.biggest ? 'bg-red-600' : 'bg-red-300'}`} style={{ width: `${Math.max(b.share * 100, b.value > 0 ? 2 : 0)}%` }} />
                </span>
                <span className={`text-right tabular-nums ${b.biggest ? 'font-semibold' : ''}`}>{b.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-800" data-testid="story-biggest-loss">
            {model.biggestLoss}
          </p>
        </div>
      </div>

      <p className="border-t border-slate-200 pt-3 text-xs text-slate-600" data-testid="story-footer">
        {model.footer}
      </p>
    </section>
  );
}
