import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { PageHeader } from '@/components/ui';
import { useProperties } from '../properties/api';
import { useFieldsOfProperties } from './api';
import { FieldList } from './FieldList';

/** Talhões de todas as propriedades visíveis, agrupados por propriedade. */
export function FieldsPage() {
  const properties = useProperties();
  const fieldQueries = useFieldsOfProperties(properties.data);

  if (properties.isPending) return <LoadingState />;
  if (properties.isError) return <ErrorState error={properties.error} onRetry={() => properties.refetch()} />;

  const groups = (properties.data ?? []).map((p, i) => ({ property: p, query: fieldQueries[i]! }));
  const anyFields = groups.some((g) => (g.query.data?.length ?? 0) > 0);
  const allLoaded = groups.every((g) => !g.query.isPending);

  return (
    <div>
      <PageHeader title="Talhões" subtitle="Todos os talhões das propriedades que você acompanha." />
      {groups.length === 0 && <EmptyState title="Nenhuma propriedade" description="Cadastre uma propriedade para começar a desenhar talhões." />}
      {groups.length > 0 && allLoaded && !anyFields && (
        <EmptyState title="Nenhum talhão" description="Abra uma propriedade e use “Novo talhão” para desenhar o primeiro." />
      )}
      <div className="space-y-8">
        {groups.map(({ property, query }) => {
          if (query.data && query.data.length === 0) return null;
          return (
            <section key={property.id}>
              <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-slate-800">
                <Link to={`/propriedades/${property.id}`} className="hover:underline">
                  {property.name}
                </Link>
                <span className="text-sm font-normal text-slate-500">
                  {property.city}/{property.state}
                </span>
              </h2>
              {query.isPending && <LoadingState label="Carregando talhões…" />}
              {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
              {query.data && <FieldList fields={query.data} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
