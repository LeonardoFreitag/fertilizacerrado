import { Badge, Button } from '@/components/ui';
import type { DailyRow, HarvestResponse, MsaLatest, PhaseView, RunView } from '@/lib/api/types';
import { PHASE_LABELS, RUN_REASON_LABELS } from '@/lib/api/types';
import { downloadCsv, slug, toCsv } from '@/lib/msa/csv';
import { formatDate, formatDateTime, formatNumber } from '@/lib/msa/msa';

const STATUS_TONE = { SUCCEEDED: 'green', NEEDS_DATA: 'amber', FAILED: 'red' } as const;

export function exportDaily(harvest: HarvestResponse, runId: string, days: ReadonlyArray<DailyRow>): void {
  const csv = toCsv(days, [
    { header: 'Data', value: (d) => d.date },
    { header: 'Fase', value: (d) => d.phase },
    { header: 'GDA do dia', value: (d) => d.gda },
    { header: 'GDA acumulado', value: (d) => d.gdaAccum },
    { header: 'Zr (m)', value: (d) => d.zr },
    { header: 'ET0 (mm)', value: (d) => d.et0 },
    { header: 'Kc', value: (d) => d.kc },
    { header: 'ETc (mm)', value: (d) => d.etc },
    { header: 'Chuva (mm)', value: (d) => d.precipitation },
    { header: 'Dr (mm)', value: (d) => d.dr },
    { header: 'Ks', value: (d) => d.ks },
    { header: 'ETc ajustada (mm)', value: (d) => d.etcAdj },
    { header: 'TAW (mm)', value: (d) => d.taw },
    { header: 'RAW (mm)', value: (d) => d.raw },
  ]);
  downloadCsv(`serie-diaria-${slug(`${harvest.field.name}-${harvest.season}`)}-${runId.slice(0, 8)}.csv`, csv);
}

export function exportSummaries(harvest: HarvestResponse, runId: string, phases: ReadonlyArray<PhaseView>): void {
  const csv = toCsv(phases, [
    { header: 'Janela', value: (p) => p.phase },
    { header: 'Dias', value: (p) => p.days },
    { header: 'Ks médio', value: (p) => p.ksMean },
    { header: 'Ks P10', value: (p) => p.percentiles.ksMean?.p10 },
    { header: 'Ks P50', value: (p) => p.percentiles.ksMean?.p50 },
    { header: 'Ks P90', value: (p) => p.percentiles.ksMean?.p90 },
    { header: 'Redução produtividade (%)', value: (p) => p.yieldReductionPct },
    { header: 'Redução P10 (%)', value: (p) => p.percentiles.yieldReductionPct?.p10 },
    { header: 'Redução P50 (%)', value: (p) => p.percentiles.yieldReductionPct?.p50 },
    { header: 'Redução P90 (%)', value: (p) => p.percentiles.yieldReductionPct?.p90 },
    { header: 'ETc ajustada acumulada (mm)', value: (p) => p.etcAdjAccum },
    { header: 'Chuva acumulada (mm)', value: (p) => p.precipAccum },
    { header: 'Iterações válidas', value: (p) => p.validIterations },
  ]);
  downloadCsv(`resumos-${slug(`${harvest.field.name}-${harvest.season}`)}-${runId.slice(0, 8)}.csv`, csv);
}

export function MsaHeader({
  latest,
  harvest,
  canManage,
  onReprocess,
  reprocessing,
  lastRun,
  series,
}: {
  latest: MsaLatest;
  harvest: HarvestResponse;
  canManage: boolean;
  onReprocess: () => void;
  reprocessing: boolean;
  /** Última run de qualquer status (pode ser mais nova que a SUCCEEDED exibida) */
  lastRun?: RunView;
  series?: ReadonlyArray<DailyRow>;
}) {
  const run = latest.run;
  const newerProblem = lastRun && lastRun.id !== run.id && lastRun.status !== 'SUCCEEDED' ? lastRun : null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Módulo agrometeorológico (MSA)</h2>
          <p className="text-sm text-slate-600">
            Intervalo processado {formatDate(run.dateFrom)} – {formatDate(run.dateTo)} · janela atual: <strong>{latest.currentPhase ? PHASE_LABELS[latest.currentPhase] : '—'}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
          <Button variant="secondary" size="sm" onClick={() => series && exportDaily(harvest, run.id, series)} disabled={!series}>
            Exportar série diária
          </Button>
          <Button variant="secondary" size="sm" onClick={() => exportSummaries(harvest, run.id, latest.phases ?? [])}>
            Exportar resumos
          </Button>
          {canManage && (
            <Button size="sm" onClick={onReprocess} loading={reprocessing}>
              Reprocessar
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Run</dt>
          <dd className="font-mono text-xs text-slate-700" title={run.id}>
            {run.id.slice(0, 8)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Executada em</dt>
          <dd className="text-slate-800">{formatDateTime(run.finishedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Origem</dt>
          <dd className="text-slate-800">{RUN_REASON_LABELS[run.reason]}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Semente</dt>
          <dd className="font-mono text-slate-800">{run.seed ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Iterações · σP · σT</dt>
          <dd className="text-slate-800">
            {run.iterations ?? '—'} · {formatNumber(run.sigmaPrecip)} · {formatNumber(run.sigmaTemp)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Motor</dt>
          <dd className="font-mono text-slate-800">v{run.engineVersion}</dd>
        </div>
      </dl>

      {newerProblem && (
        <div role="alert" className={`mt-4 rounded-md border px-3 py-2 text-sm ${newerProblem.status === 'FAILED' ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          A tentativa mais recente ({formatDateTime(newerProblem.startedAt)}) terminou <strong>{newerProblem.status}</strong>
          {newerProblem.status === 'NEEDS_DATA' && newerProblem.missingDates && (
            <>
              {' '}— faltam {newerProblem.missingDates.length} dia(s) de ERA5-Land: {newerProblem.missingDates.slice(0, 6).map(formatDate).join(', ')}
              {newerProblem.missingDates.length > 6 && '…'}
            </>
          )}
          {newerProblem.status === 'FAILED' && newerProblem.error && <> — {newerProblem.error}</>}. O painel mostra a última run bem-sucedida.
        </div>
      )}
    </div>
  );
}
