import L from 'leaflet';
import { useEffect, type ReactNode } from 'react';
import { LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { DEFAULT_CENTER, DEFAULT_ZOOM, type BoundsTuple, type LatLngTuple } from '@/lib/geo/geo';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** Mapa base com as duas camadas (OSM padrão; satélite da Esri). */
export function MapView({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  bounds,
  className = 'h-96',
  children,
}: {
  center?: LatLngTuple;
  zoom?: number;
  bounds?: BoundsTuple | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className} data-testid="map">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-full w-full">
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Mapa (OpenStreetMap)">
            <TileLayer url={OSM_URL} attribution={OSM_ATTR} maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Imagem de satélite (Esri)">
            <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={19} />
          </LayersControl.BaseLayer>
        </LayersControl>
        {bounds && <FitBounds bounds={bounds} />}
        {children}
      </MapContainer>
    </div>
  );
}

/** Ajusta a vista aos limites quando eles mudam. */
export function FitBounds({ bounds, padding = 24 }: { bounds: BoundsTuple; padding?: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLngBounds(bounds), { padding: [padding, padding], maxZoom: 17 });
  }, [map, bounds, padding]);
  return null;
}
