import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, LinkButton, PageHeader } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { CROP_LABELS, type CultivarResponse } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/msa/msa';
import { REFERENCE_NOTE } from '@/lib/validation/cultivar';
import { useCultivars, useDeleteCultivar } from './api';

function CultivarCard({ c, canManage, onDelete }: { c: CultivarResponse; canManage: boolean; onDelete?: (c: CultivarResponse) => void }) {
  return (
    <li className="card flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link to={`/cultivares/${c.id}${c.isDefault || !canManage ? '' : '/editar'}`} className="font-medium text-slate-900 hover:underline">
            {c.name}
          </Link>
          <div className="text-sm text-slate-600">{CROP_LABELS[c.crop]}</div>
        </div>
        <Badge tone={c.isDefault ? 'green' : 'slate'}>{c.isDefault ? 'referência' : 'própria'}</Badge>
      </div>
      {c.cycleDescription && <p className="text-xs text-slate-500">{c.cycleDescription}</p>}
      <dl className="grid grid-cols-3 gap-1 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">GDA total</dt>
          <dd>{formatNumber(c.gdaTotal, 0)} °C·dia</dd>
        </div>
        <dt className="sr-only">Kc</dt>
        <div>
          <dt className="text-slate-400">Kc ini/mid/end</dt>
          <dd>
            {formatNumber(c.kcIni)} / {formatNumber(c.kcMid)} / {formatNumber(c.kcEnd)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Ky F1–F4</dt>
          <dd>
            {formatNumber(c.kyF1, 1)} / {formatNumber(c.kyF2, 1)} / {formatNumber(c.kyF3, 1)} / {formatNumber(c.kyF4, 1)}
          </dd>
        </div>
      </dl>
      {canManage && !c.isDefault && onDelete && (
        <div className="mt-1 flex gap-2">
          <LinkButton to={`/cultivares/${c.id}/editar`} variant="secondary">
            Editar
          </LinkButton>
          <Button variant="ghost" size="sm" className="text-red-700" onClick={() => onDelete(c)}>
            Excluir
          </Button>
        </div>
      )}
      {c.isDefault && (
        <Link to={`/cultivares/${c.id}`} className="text-xs text-brand-700 hover:underline">
          ver parâmetros
        </Link>
      )}
    </li>
  );
}

export function CultivarsPage() {
  const { user } = useSession();
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const cultivars = useCultivars();
  const remove = useDeleteCultivar();
  const toast = useToast();
  const [deleting, setDeleting] = useState<CultivarResponse | null>(null);

  if (cultivars.isPending) return <LoadingState />;
  if (cultivars.isError) return <ErrorState error={cultivars.error} onRetry={() => cultivars.refetch()} />;

  const reference = cultivars.data.filter((c) => c.isDefault);
  const mine = cultivars.data.filter((c) => !c.isDefault);

  async function handleDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success('Cultivar excluída.');
    } catch (e) {
      toast.error(messageFor(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader title="Cultivares" subtitle="Parâmetros fenológicos, de Kc, hídricos e Ky usados pelo MSA." actions={canManage && <LinkButton to="/cultivares/nova">Nova cultivar</LinkButton>} />

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Referência</h2>
        <p className="mb-3 text-xs text-slate-500">{REFERENCE_NOTE}</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reference.map((c) => (
            <CultivarCard key={c.id} c={c} canManage={false} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">{canManage ? 'Minhas cultivares' : 'Cultivares dos agrônomos'}</h2>
        {mine.length === 0 ? (
          <EmptyState
            title="Nenhuma cultivar própria"
            description={canManage ? 'Cadastre uma cultivar quando os parâmetros de referência não servirem para a sua região ou material.' : 'As cultivares de referência estão disponíveis para as safras.'}
            action={canManage && <LinkButton to="/cultivares/nova">Nova cultivar</LinkButton>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((c) => (
              <CultivarCard key={c.id} c={c} canManage={canManage} onDelete={setDeleting} />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir cultivar"
        description={
          <>
            Excluir <strong>{deleting?.name}</strong>? Cultivares com safras vinculadas não podem ser excluídas.
          </>
        }
        confirmLabel="Excluir"
        loading={remove.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
