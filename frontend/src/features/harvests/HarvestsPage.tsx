import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge, LinkButton, PageHeader, Select } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { HARVEST_STATUS_LABELS, type HarvestResponse, type HarvestStatus } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { formatDate, severity, SEVERITY_LABELS } from '@/lib/msa/msa';
import { useFieldsOfProperties } from '../fields/api';
import { useMsaLatest } from '../msa/api';
import { useProperties } from '../properties/api';
import { useHarvests } from './api';

const STATUS_TONE: Record<HarvestStatus, 'green' | 'slate' | 'red'> = { ACTIVE: 'green', COMPLETED: 'slate', CANCELLED: 'red' };
const SEVERITY_TONE = { ok: 'green', warning: 'amber', critical: 'red', pending: 'slate' } as const;

/** Último resultado do MSA da safra (404 = sem processamento). */
function MsaBadge({ harvestId }: { harvestId: string }) {
  const latest = useMsaLatest(harvestId);
  if (latest.isPending) return <span className="text-xs text-slate-400">MSA…</span>;
  if (latest.isError) {
    const noResult = latest.error instanceof ApiError && latest.error.code === 'NO_MSA_RESULT';
    return <Badge tone="slate">{noResult ? 'MSA sem processamento' : 'MSA indisponível'}</Badge>;
  }
  const current = latest.data.phases?.find((p) => p.phase === latest.data.currentPhase) ?? latest.data.phases?.filter((p) => p.ksMean != null).at(-1);
  const sev = severity(current?.ksMean);
  return (
    <Badge tone={SEVERITY_TONE[sev]}>
      MSA {latest.data.currentPhase === 'COMPLETED' ? 'ciclo encerrado' : latest.data.currentPhase ?? ''} · Ks {current?.ksMean?.toFixed(2) ?? '—'} ({SEVERITY_LABELS[sev]})
    </Badge>
  );
}

export function HarvestsPage() {
  const { user } = useSession();
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as HarvestStatus | null) ?? undefined;
  const fieldId = params.get('fieldId') ?? undefined;
  const propertyId = params.get('propertyId') ?? undefined;

  const properties = useProperties();
  const fieldQueries = useFieldsOfProperties(properties.data);
  const fieldsByProperty = useMemo(
    () => (properties.data ?? []).map((p, i) => ({ property: p, fields: fieldQueries[i]?.data ?? [] })),
    [properties.data, fieldQueries],
  );
  const fieldIdsOfProperty = useMemo(() => new Set(fieldsByProperty.find((g) => g.property.id === propertyId)?.fields.map((f) => f.id) ?? []), [fieldsByProperty, propertyId]);

  const harvests = useHarvests({ status, fieldId });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'propertyId') next.delete('fieldId');
    setParams(next, { replace: true });
  }

  if (harvests.isPending) return <LoadingState />;
  if (harvests.isError) return <ErrorState error={harvests.error} onRetry={() => harvests.refetch()} />;

  const visible: HarvestResponse[] = propertyId && !fieldId ? harvests.data.filter((h) => fieldIdsOfProperty.has(h.fieldId)) : harvests.data;
  const propertyName = (id: string) => properties.data?.find((p) => p.id === id)?.name ?? '';

  return (
    <div>
      <PageHeader title="Safras" subtitle="Acompanhamento agrometeorológico por safra." actions={canManage && <LinkButton to="/safras/nova">Nova safra</LinkButton>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-slate-600">
            Status
          </label>
          <Select id="f-status" value={status ?? ''} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(HARVEST_STATUS_LABELS) as HarvestStatus[]).map((s) => (
              <option key={s} value={s}>
                {HARVEST_STATUS_LABELS[s]}s
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-property" className="mb-1 block text-xs font-medium text-slate-600">
            Propriedade
          </label>
          <Select id="f-property" value={propertyId ?? ''} onChange={(e) => setParam('propertyId', e.target.value)}>
            <option value="">Todas</option>
            {(properties.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-field" className="mb-1 block text-xs font-medium text-slate-600">
            Talhão
          </label>
          <Select id="f-field" value={fieldId ?? ''} onChange={(e) => setParam('fieldId', e.target.value)}>
            <option value="">Todos</option>
            {fieldsByProperty
              .filter((g) => !propertyId || g.property.id === propertyId)
              .map((g) => (
                <optgroup key={g.property.id} label={g.property.name}>
                  {g.fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nenhuma safra"
          description={canManage ? 'Cadastre a safra de um talhão para o MSA começar a acompanhar o ciclo.' : 'Nenhuma safra nos filtros escolhidos.'}
          action={canManage && <LinkButton to="/safras/nova">Nova safra</LinkButton>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((h) => (
            <li key={h.id}>
              <Link to={`/safras/${h.id}`} className="card block transition hover:border-brand-300 hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">
                      {h.field.name} <span className="text-slate-400">·</span> {h.cultivar.name}
                    </div>
                    <div className="text-sm text-slate-600">
                      {propertyName(h.field.propertyId)} · Safra {h.season} · emergência {formatDate(h.emergenceDate)}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[h.status]}>{HARVEST_STATUS_LABELS[h.status]}</Badge>
                </div>
                <div className="mt-2">
                  <MsaBadge harvestId={h.id} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
