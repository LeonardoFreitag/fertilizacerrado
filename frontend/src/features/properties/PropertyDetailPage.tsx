import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Button, LinkButton, PageHeader } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { FieldList } from '../fields/FieldList';
import { useFields } from '../fields/api';
import { useDeleteProperty, useProperty } from './api';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export function PropertyDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const property = useProperty(id);
  const fields = useFields(id);
  const remove = useDeleteProperty();
  const [confirming, setConfirming] = useState(false);
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const isAdmin = user?.role === 'ADMIN';

  if (property.isPending) return <LoadingState />;
  if (property.isError) {
    return <ErrorState error={property.error} title="Propriedade não encontrada" onRetry={() => property.refetch()} />;
  }
  const p = property.data;

  async function handleDelete() {
    try {
      await remove.mutateAsync(p.id);
      toast.success('Propriedade excluída.');
      navigate('/propriedades', { replace: true });
    } catch (e) {
      toast.error(messageFor(e));
      setConfirming(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={p.name}
        subtitle={`${p.city}/${p.state}`}
        backTo={{ to: '/propriedades', label: 'Propriedades' }}
        actions={
          <>
            {canManage && (
              <LinkButton to={`/propriedades/${p.id}/editar`} variant="secondary">
                Editar
              </LinkButton>
            )}
            {isAdmin && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Excluir
              </Button>
            )}
          </>
        }
      />

      <dl className="card mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Produtor dono">
          {p.owner.name}
          <div className="text-xs text-slate-500">{p.owner.email}</div>
        </Item>
        <Item label="Agrônomo responsável">
          {p.agronomist ? (
            <>
              {p.agronomist.name}
              <div className="text-xs text-slate-500">{p.agronomist.email}</div>
            </>
          ) : (
            '—'
          )}
        </Item>
        <Item label="CAR">{p.car ?? '—'}</Item>
        <Item label="NIRF">{p.nirf ?? '—'}</Item>
      </dl>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Talhões {fields.data && <span className="text-sm font-normal text-slate-500">({fields.data.length})</span>}</h2>
          {canManage && <LinkButton to={`/propriedades/${p.id}/talhoes/novo`}>Novo talhão</LinkButton>}
        </div>
        {fields.isPending && <LoadingState label="Carregando talhões…" />}
        {fields.isError && <ErrorState error={fields.error} onRetry={() => fields.refetch()} />}
        {fields.data && fields.data.length === 0 && (
          <EmptyState
            title="Nenhum talhão"
            description="Desenhe o primeiro talhão no mapa para que o MSA possa acompanhar a safra."
            action={canManage && <LinkButton to={`/propriedades/${p.id}/talhoes/novo`}>Novo talhão</LinkButton>}
          />
        )}
        {fields.data && fields.data.length > 0 && <FieldList fields={fields.data} />}
      </section>

      <ConfirmDialog
        open={confirming}
        title="Excluir propriedade"
        description={
          <>
            Excluir <strong>{p.name}</strong>? A propriedade deixa de aparecer para todos os usuários (exclusão lógica).
          </>
        }
        confirmLabel="Excluir"
        loading={remove.isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
