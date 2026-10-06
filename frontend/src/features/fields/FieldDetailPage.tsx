import { useState, type ReactNode } from 'react';
import { CircleMarker, Polygon as LeafletPolygon, Rectangle, Tooltip } from 'react-leaflet';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/dialog';
import { ErrorState, LoadingState } from '@/components/states';
import { useToast } from '@/components/toast';
import { Badge, Button, LinkButton, PageHeader } from '@/components/ui';
import { messageFor } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { era5CellBounds, formatCoord, formatHa, pointToLatLng, polygonBounds, ringToLatLngs } from '@/lib/geo/geo';
import { SOIL_DEFAULTS } from '@/lib/validation/schemas';
import { useProperty } from '../properties/api';
import { useDeleteField, useField } from './api';
import { MapView } from './MapView';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export function FieldDetailPage() {
  const { id: propertyId = '', fieldId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const property = useProperty(propertyId);
  const field = useField(propertyId, fieldId);
  const remove = useDeleteField(propertyId);
  const [confirming, setConfirming] = useState(false);
  const canManage = user?.role === 'AGRONOMO' || user?.role === 'ADMIN';

  if (field.isPending) return <LoadingState />;
  if (field.isError) {
    return <ErrorState error={field.error} title="Talhão não encontrado" onRetry={() => field.refetch()} />;
  }
  const f = field.data;
  const bounds = polygonBounds(f.geometry);
  const centroid = pointToLatLng(f.centroid);
  const usingDefaults = f.thetaFC == null || f.thetaWP == null;

  async function handleDelete() {
    try {
      await remove.mutateAsync(f.id);
      toast.success('Talhão excluído.');
      navigate(`/propriedades/${propertyId}`, { replace: true });
    } catch (e) {
      toast.error(messageFor(e));
      setConfirming(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={f.name}
        subtitle={
          <>
            Talhão de{' '}
            <Link to={`/propriedades/${propertyId}`} className="text-brand-700 hover:underline">
              {property.data?.name ?? 'propriedade'}
            </Link>
          </>
        }
        backTo={{ to: `/propriedades/${propertyId}`, label: property.data?.name ?? 'Propriedade' }}
        actions={
          <>
            <LinkButton to={`/safras?fieldId=${f.id}`} variant="secondary">
              Safras deste talhão
            </LinkButton>
            {canManage && (
            <>
              <LinkButton to={`/propriedades/${propertyId}/talhoes/${f.id}/editar`} variant="secondary">
                Editar
              </LinkButton>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Excluir
              </Button>
            </>
            )}
          </>
        }
      />

      {f.altitudeM == null && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <strong>Altitude não informada</strong> — necessária para processar o MSA (ET₀ depende da pressão atmosférica).
          </span>
          {canManage && (
            <Link to={`/propriedades/${propertyId}/talhoes/${f.id}/editar`} className="font-medium underline">
              Informar altitude
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MapView className="h-[26rem]" bounds={bounds}>
          <LeafletPolygon positions={ringToLatLngs(f.geometry)} pathOptions={{ color: '#40752a', weight: 2, fillColor: '#72af54', fillOpacity: 0.3 }} />
          <CircleMarker center={centroid} radius={5} pathOptions={{ color: '#a24f12', fillColor: '#c2651b', fillOpacity: 1 }}>
            <Tooltip>Centróide: {formatCoord(centroid[0])}; {formatCoord(centroid[1])}</Tooltip>
          </CircleMarker>
          {f.era5Cell && (
            <Rectangle bounds={era5CellBounds(f.era5Cell)} pathOptions={{ color: '#1d4ed8', weight: 1, dashArray: '4 4', fillOpacity: 0.04 }}>
              <Tooltip sticky>Célula ERA5-Land (0,1°): {formatCoord(f.era5Cell.lat)}; {formatCoord(f.era5Cell.lon)}</Tooltip>
            </Rectangle>
          )}
        </MapView>

        <dl className="card grid gap-4 self-start">
          <Item label="Área">{formatHa(f.areaHa)}</Item>
          <Item label="Centróide">
            {formatCoord(centroid[0])}; {formatCoord(centroid[1])}
          </Item>
          <Item label="Célula ERA5-Land">
            {f.era5Cell ? (
              <>
                {formatCoord(f.era5Cell.lat)}; {formatCoord(f.era5Cell.lon)} <span className="text-xs text-slate-500">(retângulo tracejado no mapa)</span>
              </>
            ) : (
              <Badge tone="red">não atribuída</Badge>
            )}
          </Item>
          <Item label="Altitude">{f.altitudeM != null ? `${f.altitudeM} m` : <Badge tone="amber">não informada</Badge>}</Item>
          <Item label="θFC / θWP">
            {f.thetaFC ?? SOIL_DEFAULTS.thetaFC} / {f.thetaWP ?? SOIL_DEFAULTS.thetaWP} m³/m³
            {usingDefaults && <div className="text-xs text-slate-500">valores padrão serão usados no MSA (soilDefaults)</div>}
          </Item>
          <Item label="Tipo de solo">{f.soilType ?? '—'}</Item>
          <Item label="Observações">{f.notes ?? '—'}</Item>
        </dl>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Excluir talhão"
        description={
          <>
            Excluir <strong>{f.name}</strong>? A geometria e a célula ERA5 associadas serão removidas. Talhões com safras não podem ser excluídos.
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
