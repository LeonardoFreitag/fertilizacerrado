import '@geoman-io/leaflet-geoman-free';
import L from 'leaflet';
import type { Polygon } from 'geojson';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { ringToLatLngs } from '@/lib/geo/geo';

const STYLE: L.PathOptions = { color: '#40752a', weight: 2, fillColor: '#72af54', fillOpacity: 0.25 };

/**
 * Liga o leaflet-geoman ao mapa: desenhar polígono/retângulo, editar vértices,
 * arrastar e remover. Um polígono por talhão — desenhar outro substitui (com confirmação).
 */
export function PolygonEditor({ value, onChange }: { value: Polygon | null; onChange: (polygon: Polygon | null) => void }) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const emit = () => {
      const layer = layerRef.current;
      onChangeRef.current(layer ? (layer.toGeoJSON().geometry as Polygon) : null);
    };
    const adopt = (layer: L.Polygon) => {
      layerRef.current = layer;
      layer.setStyle(STYLE);
      layer.on('pm:edit', emit);
      layer.on('pm:dragend', emit);
      emit();
    };

    map.pm.setLang('pt_br');
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      drawRectangle: true,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    });
    map.pm.setPathOptions(STYLE);

    const onCreate = (e: { layer: L.Layer }) => {
      const created = e.layer as L.Polygon;
      if (layerRef.current && layerRef.current !== created) {
        if (!window.confirm('Já existe um polígono. Substituir pelo novo?')) {
          created.remove();
          return;
        }
        layerRef.current.remove();
      }
      adopt(created);
    };
    const onRemove = (e: { layer: L.Layer }) => {
      if (e.layer === layerRef.current) {
        layerRef.current = null;
        emit();
      }
    };
    map.on('pm:create', onCreate as L.LeafletEventHandlerFn);
    map.on('pm:remove', onRemove as L.LeafletEventHandlerFn);

    // polígono existente (edição)
    if (value && !layerRef.current) {
      const existing = L.polygon(ringToLatLngs(value), STYLE).addTo(map);
      adopt(existing);
      map.fitBounds(existing.getBounds(), { padding: [24, 24], maxZoom: 17 });
    }

    return () => {
      map.off('pm:create', onCreate as L.LeafletEventHandlerFn);
      map.off('pm:remove', onRemove as L.LeafletEventHandlerFn);
      map.pm.removeControls();
      layerRef.current?.remove();
      layerRef.current = null;
    };
    // `value` só importa na montagem: depois, a fonte da verdade é a camada editada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
