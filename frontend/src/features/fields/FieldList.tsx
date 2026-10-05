import { Link } from 'react-router';
import { Badge } from '@/components/ui';
import type { FieldResponse } from '@/lib/api/types';
import { formatHa } from '@/lib/geo/geo';
import { FieldThumbnail } from './FieldThumbnail';

/** Lista de talhões com miniatura; usada no detalhe da propriedade e em /talhoes. */
export function FieldList({ fields }: { fields: FieldResponse[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((f) => (
        <li key={f.id}>
          <Link to={`/propriedades/${f.propertyId}/talhoes/${f.id}`} className="card flex gap-3 transition hover:border-brand-300 hover:shadow">
            <FieldThumbnail geometry={f.geometry} />
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-900">{f.name}</div>
              <div className="text-sm text-slate-600">{formatHa(f.areaHa)}</div>
              {f.soilType && <div className="truncate text-xs text-slate-500">{f.soilType}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {f.altitudeM == null ? <Badge tone="amber">sem altitude — necessária para o MSA</Badge> : <Badge tone="green">{f.altitudeM} m</Badge>}
                {!f.era5Cell && <Badge tone="red">sem célula ERA5</Badge>}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
