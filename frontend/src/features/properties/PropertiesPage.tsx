import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Input, LinkButton, PageHeader } from '@/components/ui';
import { useSession } from '@/lib/auth/session';
import { useProperties } from './api';

/** Comparação sem acento e sem caixa. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function PropertiesPage() {
  const { user } = useSession();
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';
  const properties = useProperties();
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    const all = properties.data ?? [];
    if (!q) return all;
    return all.filter((p) => normalize(`${p.name} ${p.city} ${p.state} ${p.owner.name}`).includes(q));
  }, [properties.data, search]);

  if (properties.isPending) return <LoadingState />;
  if (properties.isError) return <ErrorState error={properties.error} onRetry={() => properties.refetch()} />;

  const all = properties.data ?? [];

  return (
    <div>
      <PageHeader
        title="Propriedades"
        subtitle={`${all.length} propriedade${all.length === 1 ? '' : 's'} no seu escopo`}
        actions={canManage && <LinkButton to="/propriedades/nova">Nova propriedade</LinkButton>}
      />
      {all.length === 0 ? (
        <EmptyState
          title="Nenhuma propriedade ainda"
          description={canManage ? 'Cadastre a primeira propriedade do seu cliente para começar a desenhar talhões.' : 'Quando seu agrônomo cadastrar suas propriedades, elas aparecerão aqui.'}
          action={canManage && <LinkButton to="/propriedades/nova">Nova propriedade</LinkButton>}
        />
      ) : (
        <>
          <div className="mb-4 max-w-md">
            <label htmlFor="search" className="sr-only">
              Buscar
            </label>
            <Input id="search" type="search" placeholder="Buscar por nome, município ou produtor…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {visible.length === 0 ? (
            <EmptyState title="Nada encontrado" description="Nenhuma propriedade corresponde à busca." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((p) => (
                <li key={p.id}>
                  <Link to={`/propriedades/${p.id}`} className="card block h-full transition hover:border-brand-300 hover:shadow">
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="text-sm text-slate-600">
                      {p.city}/{p.state}
                    </div>
                    <dl className="mt-3 space-y-1 text-xs text-slate-500">
                      <div>
                        <dt className="inline">Produtor: </dt>
                        <dd className="inline text-slate-700">{p.owner.name}</dd>
                      </div>
                      {p.agronomist && (
                        <div>
                          <dt className="inline">Agrônomo: </dt>
                          <dd className="inline text-slate-700">{p.agronomist.name}</dd>
                        </div>
                      )}
                      {p.fieldsCount != null && (
                        <div>
                          <dt className="inline">Talhões: </dt>
                          <dd className="inline text-slate-700">{p.fieldsCount}</dd>
                        </div>
                      )}
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
