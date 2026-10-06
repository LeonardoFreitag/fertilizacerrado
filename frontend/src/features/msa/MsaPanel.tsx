import { useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import type { HarvestResponse, RunView } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { formatDate, formatDateTime } from '@/lib/msa/msa';
import { DecisionPanel } from './DecisionPanel';
import { MsaCharts } from './MsaCharts';
import { MsaHeader } from './MsaHeader';
import { PhaseCards } from './PhaseCards';
import { PhaseTimeline } from './PhaseTimeline';
import { RunsTable } from './RunsTable';
import { useDailySeries, useJob, useMsaLatest, useMsaRuns, useProcessHarvest } from './api';
import { useMsaPolling } from './useMsaPolling';

/** Acompanhamento do job (ADMIN vê o estado do BullMQ). */
function ProcessingBanner({ jobId, elapsedMs, onStop }: { jobId: string | null; elapsedMs: number; onStop: () => void }) {
  const { user } = useSession();
  const job = useJob('msa-process', jobId ?? undefined, { enabled: user?.role === 'ADMIN', refetchInterval: 3000 });
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-brand-600" aria-hidden="true" />
        <span>
          <strong>Processando o MSA…</strong> {Math.round(elapsedMs / 1000)} s
          {job.data && (
            <span className="ml-2 text-xs text-brand-800">
              job <code>{job.data.id}</code>: {job.data.state}
              {job.data.state === 'waiting-children' && ' (aguardando a ingestão ERA5)'}
              {job.data.failedReason && ` — ${job.data.failedReason}`}
            </span>
          )}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onStop}>
        Parar de aguardar
      </Button>
    </div>
  );
}

export function MsaPanel({ harvest, initialJobId, createdAt, canManage }: { harvest: HarvestResponse; initialJobId: string | null; createdAt: string; canManage: boolean }) {
  const toast = useToast();
  const latest = useMsaLatest(harvest.id);
  const runs = useMsaRuns(harvest.id);
  const process = useProcessHarvest(harvest.id);

  // Espera por uma run nova a partir de `since` (criação da safra ou clique em Reprocessar).
  const [watch, setWatch] = useState<{ since: string; jobId: string | null } | null>(() => (initialJobId ? { since: createdAt, jobId: initialJobId } : null));
  const polling = useMsaPolling(harvest.id, watch?.since ?? null, { enabled: !!watch });
  useEffect(() => {
    if (polling.state === 'done' && polling.run) {
      const r = polling.run;
      toast[r.status === 'SUCCEEDED' ? 'success' : 'info'](r.status === 'SUCCEEDED' ? 'Processamento concluído.' : `Run ${r.status}: veja os detalhes no painel.`);
      setWatch(null);
    }
    if (polling.state === 'timeout') toast.info('O processamento ainda não terminou; o painel atualiza quando você recarregar.');
  }, [polling.state, polling.run, toast]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const viewingRunId = selectedRunId ?? latest.data?.run.id;
  const daily = useDailySeries(harvest.id, viewingRunId);
  const selectedRun: RunView | undefined = useMemo(() => runs.data?.find((r) => r.id === viewingRunId) ?? latest.data?.run, [runs.data, viewingRunId, latest.data]);

  async function reprocess() {
    try {
      const since = new Date().toISOString();
      const job = await process.mutateAsync(undefined);
      setWatch({ since, jobId: job.jobId });
      toast.info(`Reprocessamento enfileirado (job ${job.jobId}).`);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  if (latest.isPending) return <LoadingState label="Carregando o MSA…" />;

  const noResult = latest.isError && latest.error instanceof ApiError && latest.error.code === 'NO_MSA_RESULT';
  if (latest.isError && !noResult) return <ErrorState error={latest.error} onRetry={() => latest.refetch()} />;

  const lastRun = runs.data?.[0];

  return (
    <section aria-label="Painel MSA" className="space-y-6">
      {watch && polling.state === 'waiting' && <ProcessingBanner jobId={watch.jobId} elapsedMs={polling.elapsedMs} onStop={() => setWatch(null)} />}

      {noResult && !(watch && polling.state === 'waiting') && (
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-800">Sem processamento do MSA</h2>
          {lastRun ? (
            <div className="mt-2 text-sm text-slate-700">
              Última tentativa em {formatDateTime(lastRun.startedAt)}: <strong>{lastRun.status}</strong>
              {lastRun.status === 'NEEDS_DATA' && lastRun.missingDates && (
                <p className="mt-1">
                  Faltam dados ERA5-Land para {lastRun.missingDates.length} dia(s): {lastRun.missingDates.slice(0, 8).map(formatDate).join(', ')}
                  {lastRun.missingDates.length > 8 && '…'}. A ingestão semanal completa a série; reprocessar depois.
                </p>
              )}
              {lastRun.status === 'FAILED' && <p className="mt-1 text-red-700">{lastRun.error}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Nenhuma run registrada ainda. O processamento é disparado na criação da safra e toda segunda-feira; também pode ser pedido agora.</p>
          )}
          {canManage && (
            <Button className="mt-4" onClick={reprocess} loading={process.isPending}>
              {lastRun ? 'Reprocessar' : 'Processar agora'}
            </Button>
          )}
        </div>
      )}

      {latest.data && (
        <>
          <ErrorBoundary title="Cabeçalho do MSA indisponível.">
          <MsaHeader latest={latest.data} harvest={harvest} canManage={canManage} onReprocess={reprocess} reprocessing={process.isPending || (!!watch && polling.state === 'waiting')} lastRun={lastRun} series={daily.data?.days} />
          </ErrorBoundary>
          {daily.data && (
            <ErrorBoundary title="Linha do tempo indisponível.">
              <PhaseTimeline days={daily.data.days} currentPhase={latest.data.currentPhase} />
            </ErrorBoundary>
          )}
          <ErrorBoundary title="Cartões indisponíveis.">
            <PhaseCards phases={latest.data.phases ?? []} currentPhase={latest.data.currentPhase} />
          </ErrorBoundary>
          {daily.isPending && <LoadingState label="Carregando a série diária…" />}
          {daily.isError && <ErrorState error={daily.error} onRetry={() => daily.refetch()} />}
          {daily.data && selectedRun && (
            <ErrorBoundary title="Gráficos indisponíveis.">
              <MsaCharts
                days={daily.data.days}
                banner={selectedRunId && selectedRunId !== latest.data.run.id ? { text: `Visualizando run de ${formatDateTime(selectedRun.startedAt)}`, onReset: () => setSelectedRunId(null) } : null}
              />
            </ErrorBoundary>
          )}
          <ErrorBoundary title="Cenários indisponíveis.">
            <DecisionPanel harvest={harvest} latest={latest.data} runId={viewingRunId} canManage={canManage} />
          </ErrorBoundary>
          {runs.data && (
            <ErrorBoundary title="Histórico indisponível.">
              <RunsTable runs={runs.data} selectedRunId={viewingRunId ?? null} latestRunId={latest.data.run.id} onSelect={(id) => setSelectedRunId(id)} />
            </ErrorBoundary>
          )}
        </>
      )}
    </section>
  );
}
