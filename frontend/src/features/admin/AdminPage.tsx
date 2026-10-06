import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/dialog';
import { ErrorState, FormError, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, FormField, Input, PageHeader, Select } from '@/components/ui';
import { API_BASE, ApiError, api } from '@/lib/api/client';
import { session } from '@/lib/auth/session';
import { messageFor } from '@/lib/api/errors';
import type { EnqueuedJob, QmCalibrationView, QueueCounts, WeatherStation } from '@/lib/api/types';
import { formatDate, formatDateTime, formatNumber } from '@/lib/msa/msa';
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

/** Upload multipart do CSV de observações (FormData; fora de api(), que envia JSON). */
async function uploadStations(file: File, format: 'bdmep' | 'generic', stationMeta: string): Promise<EnqueuedJob> {
  const form = new FormData();
  form.append('file', file);
  form.append('format', format);
  if (stationMeta.trim()) form.append('stationMeta', stationMeta.trim());
  const res = await fetch(`${API_BASE}/admin/stations/upload`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${session.getToken() ?? ''}` } });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; jobId?: string; queue?: string };
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'HTTP_ERROR', data.error ?? `Erro ${res.status}`);
  return data as EnqueuedJob;
}

function StationsSection({ onEnqueued }: { onEnqueued: (job: EnqueuedJob, label: string) => void }) {
  const toast = useToast();
  const stations = useQuery({ queryKey: ['admin', 'stations'], queryFn: () => api<WeatherStation[]>('/admin/stations') });
  const calibrations = useQuery({ queryKey: ['admin', 'qm', 'calibrations'], queryFn: () => api<QmCalibrationView[]>('/admin/qm/calibrations') });
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'bdmep' | 'generic'>('bdmep');
  const [meta, setMeta] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cell, setCell] = useState({ lat: '', lon: '', station: '' });
  const [confirmAuto, setConfirmAuto] = useState(false);
  const calibrate = useMutation({ mutationFn: (body: unknown) => api<EnqueuedJob>('/admin/qm/calibrate', { method: 'POST', body }) });

  async function submitUpload() {
    setUploadError(null);
    if (!file) return setUploadError('Escolha o arquivo CSV.');
    if (format === 'generic' && !meta.trim()) return setUploadError('No formato genérico informe os metadados da estação: nome;FONTE;lat;lon[;alt].');
    setUploading(true);
    try {
      const job = await uploadStations(file, format, meta);
      onEnqueued(job, `Importação de observações (${file.name})`);
      setFile(null);
    } catch (e) {
      setUploadError(messageFor(e));
    } finally {
      setUploading(false);
    }
  }

  async function calibrateCell() {
    const lat = Number(cell.lat.replace(',', '.'));
    const lon = Number(cell.lon.replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || cell.lat === '' || cell.lon === '') return toast.error('Informe lat e lon da célula.');
    try {
      const job = await calibrate.mutateAsync({ cell: { lat, lon }, station: cell.station.trim() || undefined });
      onEnqueued(job, `Calibrar célula ${lat}, ${lon}`);
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  async function calibrateAuto() {
    setConfirmAuto(false);
    try {
      const job = await calibrate.mutateAsync({ auto: true });
      onEnqueued(job, 'Calibrar todas as células (QM)');
    } catch (e) {
      toast.error(messageFor(e));
    }
  }

  return (
    <section className="space-y-4" aria-label="Estações e correção de viés">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Estações e correção de viés (Quantile Mapping)</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void stations.refetch();
            void calibrations.refetch();
          }}
        >
          Atualizar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Importar observações diárias</h3>
          <p className="text-xs text-slate-500">CSV do BDMEP/INMET (cabeçalho de metadados, `;`, vírgula decimal) ou genérico (`station_code,date,precip_mm[,tmax,tmin]`). Até 50 MB.</p>
          <FormField label="Arquivo" htmlFor="st-file">
            <input id="st-file" type="file" accept=".csv,.txt" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <FormField label="Formato" htmlFor="st-format">
              <Select id="st-format" value={format} onChange={(e) => setFormat(e.target.value as 'bdmep' | 'generic')}>
                <option value="bdmep">BDMEP / INMET</option>
                <option value="generic">Genérico</option>
              </Select>
            </FormField>
            <FormField label="Metadados da estação (genérico)" htmlFor="st-meta" help="nome;FONTE;lat;lon[;alt] — FONTE: INMET, ANA ou OUTRA">
              <Input id="st-meta" placeholder="Goiânia;INMET;-16.64;-49.22;741" value={meta} onChange={(e) => setMeta(e.target.value)} disabled={format !== 'generic'} />
            </FormField>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={submitUpload} loading={uploading}>
              Enviar e importar
            </Button>
            <FormError message={uploadError} />
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Calibrar</h3>
          <p className="text-xs text-slate-500">Pareia cada célula com a estação ativa mais próxima (≤ distância máxima, ≥ anos mínimos de sobreposição), calibra por mês e reaplica a correção. Depois, reprocesse as safras ("Processar todas as safras ativas").</p>
          <Button onClick={() => setConfirmAuto(true)} loading={calibrate.isPending}>
            Calibrar todas as células
          </Button>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Lat" htmlFor="qm-lat">
              <Input id="qm-lat" inputMode="decimal" value={cell.lat} onChange={(e) => setCell({ ...cell, lat: e.target.value })} />
            </FormField>
            <FormField label="Lon" htmlFor="qm-lon">
              <Input id="qm-lon" inputMode="decimal" value={cell.lon} onChange={(e) => setCell({ ...cell, lon: e.target.value })} />
            </FormField>
            <FormField label="Estação (opcional)" htmlFor="qm-station">
              <Input id="qm-station" value={cell.station} onChange={(e) => setCell({ ...cell, station: e.target.value })} />
            </FormField>
          </div>
          <Button variant="secondary" onClick={calibrateCell} loading={calibrate.isPending}>
            Calibrar célula
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-x-auto p-0">
          <h3 className="px-4 pt-4 text-sm font-semibold text-slate-800">Estações</h3>
          {stations.isPending && <LoadingState label="Carregando…" />}
          {stations.isError && <ErrorState error={stations.error} onRetry={() => stations.refetch()} />}
          {stations.data && stations.data.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Nenhuma estação importada.</p>}
          {stations.data && stations.data.length > 0 && (
            <table className="mt-2 w-full text-sm" data-testid="stations-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Nome</th>
                  <th className="px-4 py-2">Fonte</th>
                  <th className="px-4 py-2 text-right">Obs.</th>
                  <th className="px-4 py-2">Período</th>
                </tr>
              </thead>
              <tbody>
                {stations.data.map((s) => (
                  <tr key={s.code} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{s.code}</td>
                    <td className="px-4 py-2">
                      {s.name} {!s.active && <Badge tone="slate">inativa</Badge>}
                    </td>
                    <td className="px-4 py-2">{s.source}</td>
                    <td className="px-4 py-2 text-right">{s.obsCount}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{s.obsFrom ? `${formatDate(s.obsFrom)} – ${formatDate(s.obsTo)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card overflow-x-auto p-0">
          <h3 className="px-4 pt-4 text-sm font-semibold text-slate-800">Calibrações</h3>
          {calibrations.isPending && <LoadingState label="Carregando…" />}
          {calibrations.isError && <ErrorState error={calibrations.error} onRetry={() => calibrations.refetch()} />}
          {calibrations.data && calibrations.data.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Nenhuma calibração; as safras usam o ERA5-Land bruto.</p>}
          {calibrations.data && calibrations.data.length > 0 && (
            <table className="mt-2 w-full text-sm" data-testid="calibrations-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Célula</th>
                  <th className="px-4 py-2">Estação</th>
                  <th className="px-4 py-2">Período</th>
                  <th className="px-4 py-2 text-right">Anos</th>
                  <th className="px-4 py-2 text-right">km</th>
                  <th className="px-4 py-2">Ativa</th>
                </tr>
              </thead>
              <tbody>
                {calibrations.data.map((c) => (
                  <tr key={c.id} className={`border-t border-slate-100 ${c.active ? '' : 'text-slate-400'}`}>
                    <td className="px-4 py-2 font-mono text-xs">
                      {c.cellLat}, {c.cellLon}
                    </td>
                    <td className="px-4 py-2">
                      {c.stationName} <span className="font-mono text-xs text-slate-500">{c.stationCode}</span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {formatDate(c.periodFrom)} – {formatDate(c.periodTo)}
                    </td>
                    <td className="px-4 py-2 text-right">{formatNumber(c.years, 1)}</td>
                    <td className="px-4 py-2 text-right">{formatNumber(c.distanceKm, 1)}</td>
                    <td className="px-4 py-2">{c.active ? <Badge tone="green">ativa</Badge> : <Badge tone="slate">inativa</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAuto}
        title="Calibrar todas as células"
        description="Pareia cada célula de era5_cells com a estação elegível mais próxima, recalibra (desativando a calibração anterior) e reaplica a correção em todas as linhas. Continuar?"
        confirmLabel="Enfileirar"
        danger={false}
        onConfirm={calibrateAuto}
        onCancel={() => setConfirmAuto(false)}
      />
    </section>
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
            <div className="mt-1">
              <span className="text-slate-500">Recalibração anual do QM: </span>
              <strong>{queues.data.annual?.nextRun ? brasilia.format(new Date(queues.data.annual.nextRun)) : 'não agendada'}</strong>
            </div>
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
      <StationsSection onEnqueued={enqueued} />

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
