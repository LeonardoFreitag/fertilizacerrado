import { Link } from 'react-router';
import type { HarvestResponse, Phase, PhaseView, RunView } from '@/lib/api/types';
import { PHASE_LABELS } from '@/lib/api/types';
import { formatIndexPct, formatNumber, formatPct, formatScHa, yieldSummaryRows, yieldWarnings } from '@/lib/msa/msa';

/**
 * Bloco Produtividade: Ym da run, redução por janela, índice do ciclo e
 * produtividade predita (FAO-33, combinação multiplicativa).
 * `phases` nulo = run antiga sem resumos carregados (só índice e predita).
 */
export function YieldSummary({
  run,
  phases,
  currentPhase,
  harvest,
  canManage,
}: {
  run: RunView;
  phases: ReadonlyArray<PhaseView> | null;
  currentPhase: Phase | null;
  harvest: HarvestResponse;
  canManage: boolean;
}) {
  const rows = phases ? yieldSummaryRows(phases) : null;
  const warnings = yieldWarnings({ phasesReached: run.phasesReached, currentPhase, runYm: run.expectedYield, harvestYm: harvest.expectedYield });
  const hasYm = run.expectedYield != null;

  return (
    <section className="card" aria-label="Produtividade" data-testid="yield-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Produtividade</h2>
          <p className="text-xs text-slate-500">Ya = Ym × Π janelas [1 − Ky·(1 − Ks̄)] — FAO-33; janela não alcançada conta como sem estresse.</p>
        </div>
        <span className="text-xs text-slate-500">{run.phasesReached ?? 0} de 4 janelas alcançadas</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_minmax(16rem,20rem)]">
        {rows ? (
          <table className="w-full text-sm" aria-label="Redução por janela">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-2">Janela</th>
                <th className="py-1 pr-2">Ks médio</th>
                <th className="py-1 pr-2">Redução (Ky·(1−Ks̄))</th>
                <th className="py-1">Fator</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.phase} className="border-t border-slate-100" data-testid={`yield-row-${r.phase}`}>
                  <td className="py-1 pr-2">
                    <span className="font-medium">{r.phase}</span> <span className="text-xs text-slate-500">{PHASE_LABELS[r.phase].split(' — ')[1]}</span>
                  </td>
                  {r.reached ? (
                    <>
                      <td className="py-1 pr-2">{formatNumber(r.ksMean)}</td>
                      <td className="py-1 pr-2">{formatPct(r.reductionPct)}</td>
                      <td className="py-1 font-mono text-xs">{formatNumber(r.factor, 3)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="py-1 text-xs text-slate-500">
                      não alcançada — fator 1
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">Resumos por janela desta run não estão carregados; veja o índice e a predita ao lado.</p>
        )}

        <dl className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-xs text-slate-600">Produtividade potencial (Ym)</dt>
            <dd data-testid="yield-ym">{hasYm ? formatScHa(run.expectedYield) : <span className="text-slate-400">não informada</span>}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-xs text-slate-600">Índice do ciclo</dt>
            <dd className="font-medium" data-testid="yield-index">
              {formatIndexPct(run.yieldIndex)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-xs text-slate-600">Produtividade predita</dt>
            <dd className="text-2xl font-semibold text-slate-900" data-testid="yield-predicted">
              {hasYm ? formatScHa(run.predictedYield) : '—'}
            </dd>
          </div>
          {!hasYm &&
            (canManage ? (
              <Link to={`/safras/${harvest.id}?editar=ym`} className="block text-xs font-medium text-brand-700 underline" data-testid="yield-inform-link">
                Informar a produtividade potencial
              </Link>
            ) : (
              <p className="text-xs text-slate-500">Produtividade potencial não informada pelo responsável técnico.</p>
            ))}
        </dl>
      </div>

      {warnings.partial && (
        <p role="status" data-testid="yield-partial" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Predição parcial:</strong> considera o restante do ciclo sem estresse. O valor é atualizado a cada processamento, conforme as janelas são alcançadas.
        </p>
      )}
      {warnings.ymChanged && (
        <p role="status" data-testid="yield-ym-changed" className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          A produtividade potencial da safra mudou ({formatScHa(harvest.expectedYield)}) e esta execução usou {hasYm ? formatScHa(run.expectedYield) : 'nenhuma'}; reprocesse para atualizar a predição.
        </p>
      )}
    </section>
  );
}
