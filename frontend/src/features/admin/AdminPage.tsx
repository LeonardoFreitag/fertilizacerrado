import { useQuery } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '@/components/states';
import { Button, PageHeader } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { QueueCounts } from '@/lib/api/types';

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

/** Somente leitura: contagens das filas BullMQ e próxima execução do semanal. */
export function AdminPage() {
  const queues = useQuery({ queryKey: ['admin', 'queues'], queryFn: () => api<QueueCounts>('/admin/jobs/queues') });

  return (
    <div>
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
          <div className="card mb-4 text-sm">
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
    </div>
  );
}
