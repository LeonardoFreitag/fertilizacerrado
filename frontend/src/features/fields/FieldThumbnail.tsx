import type { Polygon } from 'geojson';
import { polygonToSvgPath } from '@/lib/geo/geo';

/** Contorno do talhão em SVG estático — sem instância de mapa. */
export function FieldThumbnail({ geometry, size = 64, className = '' }: { geometry: Polygon; size?: number; className?: string }) {
  const d = polygonToSvgPath(geometry, size);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`shrink-0 rounded-md bg-brand-50 ${className}`} role="img" aria-label="Contorno do talhão">
      {d && <path d={d} fill="#98c87d" fillOpacity={0.6} stroke="#40752a" strokeWidth={1.5} strokeLinejoin="round" />}
    </svg>
  );
}
