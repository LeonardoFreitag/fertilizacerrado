import type { Phase, PhaseView, YieldPhase } from '@/lib/api/types';
import { PHASE_LABELS, YIELD_PHASES } from '@/lib/api/types';
import { formatMm, formatNumber, formatPct, formatPercentiles, severity, SEVERITY_LABELS, type Severity } from '@/lib/msa/msa';

const TONE: Record<Severity, string> = {
  ok: 'border-brand-300 bg-brand-50',
  warning: 'border-amber-300 bg-amber-50',
  critical: 'border-red-300 bg-red-50',
  pending: 'border-slate-200 bg-slate-50 text-slate-500',
};
const DOT: Record<Severity, string> = { ok: 'bg-brand-600', warning: 'bg-amber-500', critical: 'bg-red-600', pending: 'bg-slate-300' };

export function PhaseCards({ phases, currentPhase }: { phases: ReadonlyArray<PhaseView>; currentPhase: Phase | null }) {
  const byPhase = new Map(phases.map((p) => [p.phase, p]));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Janelas fenológicas</h2>
        <span className="text-xs text-slate-500">Ks médio: ≥ 0,85 ok · 0,70–0,85 atenção · &lt; 0,70 crítico</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Cartões por janela">
        {YIELD_PHASES.map((phase: YieldPhase) => {
          const p = byPhase.get(phase);
          const sev = severity(p?.ksMean);
          const isCurrent = currentPhase === phase;
          return (
            <li key={phase} data-testid={`phase-card-${phase}`} data-severity={sev} className={`rounded-lg border p-4 ${TONE[sev]} ${isCurrent ? 'ring-2 ring-slate-400' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide opacity-70">{phase}</div>
                  <div className="text-sm font-medium">{PHASE_LABELS[phase].split(' — ')[1]}</div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                  <span className={`h-2 w-2 rounded-full ${DOT[sev]}`} aria-hidden="true" />
                  {SEVERITY_LABELS[sev]}
                  {isCurrent && ' · atual'}
                </span>
              </div>
              {p && p.ksMean != null ? (
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-slate-600">Ks médio</dt>
                    <dd className="text-2xl font-semibold">{formatNumber(p.ksMean)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Percentis do Ks (Monte Carlo)</dt>
                    <dd className="text-xs">{formatPercentiles(p.percentiles.ksMean)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-slate-600">Redução potencial de produtividade</dt>
                    <dd className="font-medium">{formatPct(p.yieldReductionPct)}</dd>
                  </div>
                  {p.percentiles.yieldReductionPct && <dd className="-mt-1 text-xs text-slate-600">{formatPercentiles(p.percentiles.yieldReductionPct, 1)}</dd>}
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-slate-600">ETc ajustada acumulada</dt>
                    <dd>{formatMm(p.etcAdjAccum)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs text-slate-600">Chuva acumulada</dt>
                    <dd>{formatMm(p.precipAccum)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between text-xs text-slate-600">
                    <dt>Dias · iterações válidas</dt>
                    <dd>
                      {p.days} · {p.validIterations}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm">Janela não alcançada no intervalo processado.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
