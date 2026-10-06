import { Badge, Button } from '@/components/ui';
import type { RunView } from '@/lib/api/types';
import { RUN_REASON_LABELS } from '@/lib/api/types';
import { formatDate, formatDateTime } from '@/lib/msa/msa';

const TONE = { SUCCEEDED: 'green', NEEDS_DATA: 'amber', FAILED: 'red' } as const;

export function RunsTable({ runs, selectedRunId, latestRunId, onSelect }: { runs: ReadonlyArray<RunView>; selectedRunId: string | null; latestRunId: string; onSelect: (id: string | null) => void }) {
  return (
    <section className="card overflow-x-auto p-0" aria-label="Histórico de runs">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-sm font-semibold text-slate-800">Histórico de runs</h2>
        <span className="text-xs text-slate-500">{runs.length} execução(ões)</span>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Executada em</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Origem</th>
            <th className="px-4 py-2">Intervalo</th>
            <th className="px-4 py-2">Semente</th>
            <th className="px-4 py-2">Motor</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const selected = r.id === selectedRunId;
            return (
              <tr key={r.id} className={`border-t border-slate-100 ${selected ? 'bg-brand-50' : ''}`}>
                <td className="px-4 py-2 text-slate-800">{formatDateTime(r.startedAt)}</td>
                <td className="px-4 py-2">
                  <Badge tone={TONE[r.status]}>{r.status}</Badge>
                  {r.status === 'NEEDS_DATA' && r.missingDates && <span className="ml-1 text-xs text-slate-500">{r.missingDates.length} dia(s) faltando</span>}
                  {r.status === 'FAILED' && r.error && <span className="ml-1 text-xs text-red-700" title={r.error}>erro</span>}
                </td>
                <td className="px-4 py-2 text-slate-700">{RUN_REASON_LABELS[r.reason]}</td>
                <td className="px-4 py-2 text-slate-700">
                  {formatDate(r.dateFrom)} – {formatDate(r.dateTo)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.seed ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-700">v{r.engineVersion}</td>
                <td className="px-4 py-2 text-right">
                  {r.status === 'SUCCEEDED' && !selected && (
                    <Button variant="ghost" size="sm" onClick={() => onSelect(r.id === latestRunId ? null : r.id)}>
                      Ver série
                    </Button>
                  )}
                  {selected && <span className="text-xs text-brand-800">exibida</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
