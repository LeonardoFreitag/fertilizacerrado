import { Badge, Button } from '@/components/ui';
import type { DailyRow, HarvestResponse, MsaLatest, PhaseView, RunView } from '@/lib/api/types';
import { PHASE_LABELS, RUN_REASON_LABELS } from '@/lib/api/types';
import { downloadCsv, slug, toCsv } from '@/lib/msa/csv';
import { formatDate, formatDateTime, formatNumber, summariesCsv } from '@/lib/msa/msa';
import { MissingDates } from './MissingDates';

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

export function exportSummaries(harvest: HarvestResponse, run: RunView, phases: ReadonlyArray<PhaseView>): void {
  downloadCsv(`resumos-${slug(`${harvest.field.name}-${harvest.season}`)}-${run.id.slice(0, 8)}.csv`, summariesCsv(phases, run));
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
          <span
            data-testid="rain-badge"
            title={run.qmCalibration ? `Quantile Mapping ${run.qmCalibration.method}, período ${run.qmCalibration.periodFrom} – ${run.qmCalibration.periodTo}` : 'Precipitação do ERA5-Land sem correção de viés'}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${run.qmCalibration ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-600'}`}
          >
            {run.qmCalibration
              ? `Chuva corrigida — estação ${run.qmCalibration.stationName} (${run.qmCalibration.stationCode}, ${formatNumber(run.qmCalibration.years, 1)} anos, ${formatNumber(run.qmCalibration.distanceKm, 1)} km)`
              : 'Chuva sem correção (ERA5-Land bruto)'}
          </span>
          <Button variant="secondary" size="sm" onClick={() => series && exportDaily(harvest, run.id, series)} disabled={!series}>
            Exportar série diária
          </Button>
          <Button variant="secondary" size="sm" onClick={() => exportSummaries(harvest, run, latest.phases ?? [])}>
            Exportar resumos
          </Button>
          {canManage && (
            <Button size="sm" onClick={onReprocess} loading={reprocessing}>
              Reprocessar
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
          <dt className="text-xs uppercase tracking-wide text-slate-500">Motor</dt>
          <dd className="font-mono text-slate-800">v{run.engineVersion}</dd>
        </div>
      </dl>

      {latest.cultivarChangedSinceRun && (
        <div role="alert" data-testid="cultivar-changed" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Os parâmetros da cultivar <strong>{harvest.cultivar.name}</strong> mudaram desde esta execução; a run usa o snapshot da época.
          {canManage ? ' Reprocesse para usar os valores atuais.' : ''}
        </div>
      )}

      {newerProblem && (
        <div role="alert" className={`mt-4 rounded-md border px-3 py-2 text-sm ${newerProblem.status === 'FAILED' ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          A tentativa mais recente ({formatDateTime(newerProblem.startedAt)}) terminou <strong>{newerProblem.status}</strong>
          {newerProblem.status === 'NEEDS_DATA' && newerProblem.missingDates && (
            <>
              {' '}— <MissingDates dates={newerProblem.missingDates} prefix="faltam dados ERA5-Land para" />
            </>
          )}
          {newerProblem.status === 'FAILED' && newerProblem.error && <> — {newerProblem.error}</>}. O painel mostra a última run bem-sucedida.
        </div>
      )}
    </div>
  );
}
