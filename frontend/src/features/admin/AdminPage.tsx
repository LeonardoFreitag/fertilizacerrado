import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/dialog';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, FormField, Input, PageHeader } from '@/components/ui';
import { api } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import type { EnqueuedJob, QueueCounts } from '@/lib/api/types';
import { formatDateTime } from '@/lib/msa/msa';
import { useJob } from '../msa/api';

const STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;
const STATE_LABELS: Record<(typeof STATES)[number], string> = {
  waiting: 'Aguardando',
  active: 'Ativos',
  completed: 'Concluídos',
  failed: 'Falhos',
  delayed: 'Agendados',
  'waiting-children': 'Aguardando filhos',
};

const brasilia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

interface SessionJob {
  jobId: string;
  queue: string;
  label: string;
  at: string;
}

function JobRow({ job }: { job: SessionJob }) {
  const view = useJob(job.queue, job.jobId, { refetchInterval: 5000 });
  const state = view.data?.state;
  const tone = state === 'completed' ? 'green' : state === 'failed' ? 'red' : 'amber';
  return (
    <tr className="border-t border-slate-100" data-testid="session-job">
      <td className="px-4 py-2 text-slate-800">{job.label}</td>
      <td className="px-4 py-2 font-mono text-xs text-slate-700">
        {job.queue} / {job.jobId}
      </td>
      <td className="px-4 py-2">
        {view.isPending && <span className="text-xs text-slate-400">consultando…</span>}
        {view.isError && <span className="text-xs text-red-700">{messageFor(view.error)}</span>}
        {state && <Badge tone={tone}>{state}</Badge>}
        {view.data?.failedReason && <div className="mt-1 text-xs text-red-700">{view.data.failedReason}</div>}
        {typeof view.data?.progress === 'object' && view.data.progress !== null && <div className="mt-1 text-xs text-slate-500">{JSON.stringify(view.data.progress)}</div>}
      </td>
      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(job.at)}</td>
    </tr>
  );
}

function BackfillForm({ onEnqueued }: { onEnqueued: (job: EnqueuedJob, label: string) => void }) {
  const [v, setV] = useState({ n: '-16.1', w: '-49.4', s: '-16.8', e: '-48.7', from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: { bbox: number[]; from: string; to: string }) => api<EnqueuedJob>('/admin/jobs/backfill-region', { method: 'POST', body }),
  });
  const num = (x: string) => Number(x.replace(',', '.'));

  async function submit() {
    setError(null);
    const bbox = [num(v.n), num(v.w), num(v.s), num(v.e)];
    if (bbox.some((x) => !Number.isFinite(x))) return setError('Informe as quatro coordenadas.');
    if (bbox[0]! <= bbox[2]!) return setError('N deve ser maior que S.');
    if (bbox[3]! <= bbox[1]!) return setError('E deve ser maior que W.');
    if (!v.from || !v.to) return setError('Informe as datas.');
    if (v.from > v.to) return setError('A data inicial deve ser anterior ou igual à final.');
    try {
      const job = await mutation.mutateAsync({ bbox, from: v.from, to: v.to });
      onEnqueued(job, `Backfill regional ${v.from} → ${v.to}`);
    } catch (e) {
      setError(messageFor(e));
    }
  }

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-800">Backfill regional (ERA5-Land)</h3>
      <p className="mt-1 text-xs text-amber-800">Dispara requisições reais ao CDS para as células dentro da bbox; pode levar de minutos a horas.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {(['n', 'w', 's', 'e'] as const).map((k) => (
          <FormField key={k} label={{ n: 'Norte (lat)', w: 'Oeste (lon)', s: 'Sul (lat)', e: 'Leste (lon)' }[k]} htmlFor={`bb-${k}`}>
            <Input id={`bb-${k}`} inputMode="decimal" value={v[k]} onChange={(ev) => setV({ ...v, [k]: ev.target.value })} />
          </FormField>
        ))}
        <FormField label="De" htmlFor="bb-from">
          <Input id="bb-from" type="date" value={v.from} onChange={(ev) => setV({ ...v, from: ev.target.value })} />
        </FormField>
        <FormField label="Até" htmlFor="bb-to">
          <Input id="bb-to" type="date" value={v.to} onChange={(ev) => setV({ ...v, to: ev.target.value })} />
        </FormField>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" onClick={submit} loading={mutation.isPending}>
          Enfileirar backfill
        </Button>
        <FormError message={error} />
      </div>
    </div>
  );
}

export function AdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const queues = useQuery({ queryKey: ['admin', 'queues'], queryFn: () => api<QueueCounts>('/admin/jobs/queues') });
  const [jobs, setJobs] = useState<SessionJob[]>([]);
  const [confirm, setConfirm] = useState<'ingest' | 'process' | null>(null);

  const ingest = useMutation({ mutationFn: () => api<EnqueuedJob>('/admin/jobs/ingest-latest', { method: 'POST' }) });
  const processAll = useMutation({ mutationFn: () => api<EnqueuedJob>('/admin/jobs/process-all', { method: 'POST' }) });

  function enqueued(job: EnqueuedJob, label: string) {
    const at = new Date().toISOString();
    const entries: SessionJob[] = job.jobs?.length ? job.jobs.map((j, i) => ({ jobId: j.jobId, queue: j.queue, label: `${label} (${i + 1}/${job.jobs!.length})`, at })) : [{ jobId: job.jobId, queue: job.queue, label, at }];
    setJobs((prev) => [...entries, ...prev]);
    toast.success(job.count != null ? `${job.count} job(s) enfileirado(s) em ${job.queue}.` : `Job ${job.jobId} enfileirado em ${job.queue}.`);
    void qc.invalidateQueries({ queryKey: ['admin', 'queues'] });
  }

  async function runConfirmed() {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === 'ingest') enqueued(await ingest.mutateAsync(), 'Ingest latest (ERA5-Land)');
      if (action === 'process') enqueued(await processAll.mutateAsync(), 'Processar todas as safras ativas');
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administração"
        subtitle="Filas de processamento (BullMQ)"
        actions={
          <Button variant="secondary" onClick={() => queues.refetch()} loading={queues.isFetching}>
            Atualizar
          </Button>
        }
      />
      {queues.isPending && <LoadingState />}
      {queues.isError && <ErrorState error={queues.error} onRetry={() => queues.refetch()} />}
      {queues.data && (
        <>
          <div className="card text-sm">
            <span className="text-slate-500">Próxima execução semanal (ingest ERA5 → MSA das safras ativas): </span>
            <strong>{queues.data.weekly.nextRun ? brasilia.format(new Date(queues.data.weekly.nextRun)) : 'não agendada'}</strong>
            {queues.data.weekly.pattern && (
              <span className="ml-2 text-xs text-slate-500">
                ({queues.data.weekly.pattern} · {queues.data.weekly.tz})
              </span>
            )}
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Fila</th>
                  {STATES.map((s) => (
                    <th key={s} className="px-4 py-2 text-right">
                      {STATE_LABELS[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(queues.data.queues).map(([name, counts]) => (
                  <tr key={name} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-slate-800">{name}</td>
                    {STATES.map((s) => (
                      <td key={s} className={`px-4 py-2 text-right ${s === 'failed' && (counts[s] ?? 0) > 0 ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
                        {counts[s] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-800">Ingestão ERA5-Land</h3>
          <p className="mt-1 text-xs text-slate-500">Janela [hoje − 16, hoje − 6] para todas as células. Requisição real ao CDS.</p>
          <Button className="mt-3" variant="secondary" onClick={() => setConfirm('ingest')} loading={ingest.isPending}>
            Ingest latest
          </Button>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-800">Processamento MSA</h3>
          <p className="mt-1 text-xs text-slate-500">Enfileira um `msa-process MANUAL` por safra ativa.</p>
          <Button className="mt-3" onClick={() => setConfirm('process')} loading={processAll.isPending}>
            Processar todas as safras ativas
          </Button>
        </div>
      </div>
      <BackfillForm onEnqueued={enqueued} />

      {jobs.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <h3 className="px-4 pt-4 text-sm font-semibold text-slate-800">Jobs desta sessão</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Ação</th>
                <th className="px-4 py-2">Fila / job</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Disparado</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <JobRow key={`${j.queue}-${j.jobId}`} job={j} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'ingest' ? 'Disparar ingest latest' : 'Processar todas as safras ativas'}
        description={confirm === 'ingest' ? 'Faz uma requisição real ao CDS (pode levar minutos). Continuar?' : 'Enfileira o reprocessamento de todas as safras ativas. Continuar?'}
        confirmLabel="Enfileirar"
        danger={false}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
