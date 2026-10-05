/** Geometria do talhão: área, limites, miniatura SVG, célula ERA5. GeoJSON é [lon, lat]. */
import area from '@turf/area';
import type { Point, Polygon, Position } from 'geojson';

export type LatLngTuple = [number, number];
export type BoundsTuple = [LatLngTuple, LatLngTuple]; // [[sul, oeste], [norte, leste]]

/** Goiânia — centro inicial quando a propriedade ainda não tem talhões. */
export const DEFAULT_CENTER: LatLngTuple = [-16.68, -49.25];
export const DEFAULT_ZOOM = 13;
export const ERA5_CELL_DEG = 0.1;

export function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Área geodésica em hectares, 2 decimais. */
export function polygonAreaHa(polygon: Polygon): number {
  return Math.round((area(polygon) / 10_000) * 100) / 100;
}

export function outerRing(polygon: Polygon): Position[] {
  return polygon.coordinates[0] ?? [];
}

/** Anel externo como [lat, lon] para o Leaflet (sem o ponto de fechamento repetido). */
export function ringToLatLngs(polygon: Polygon): LatLngTuple[] {
  const ring = outerRing(polygon);
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  return open.map(([lon, lat]) => [lat!, lon!]);
}

export function polygonBounds(polygon: Polygon): BoundsTuple | null {
  const ring = outerRing(polygon);
  if (ring.length === 0) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [lon, lat] of ring) {
    s = Math.min(s, lat!); n = Math.max(n, lat!); w = Math.min(w, lon!); e = Math.max(e, lon!);
  }
  return [[s, w], [n, e]];
}

export function boundsOfPolygons(polygons: Polygon[]): BoundsTuple | null {
  const all = polygons.map(polygonBounds).filter((b): b is BoundsTuple => b !== null);
  if (all.length === 0) return null;
  return all.reduce((acc, b) => [[Math.min(acc[0][0], b[0][0]), Math.min(acc[0][1], b[0][1])], [Math.max(acc[1][0], b[1][0]), Math.max(acc[1][1], b[1][1])]]);
}

export function boundsCenter(bounds: BoundsTuple): LatLngTuple {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

/** Retângulo da célula ERA5-Land (0,1°) centrada em (lat, lon). */
export function era5CellBounds(cell: { lat: number; lon: number }): BoundsTuple {
  const h = ERA5_CELL_DEG / 2;
  return [[cell.lat - h, cell.lon - h], [cell.lat + h, cell.lon + h]];
}

export function pointToLatLng(point: Point): LatLngTuple {
  return [point.coordinates[1]!, point.coordinates[0]!];
}

/**
 * Caminho SVG do polígono projetado num quadrado `size`×`size` (eixo y invertido,
 * proporção preservada, margem de 8%). Para miniaturas sem instanciar o Leaflet.
 */
export function polygonToSvgPath(polygon: Polygon, size = 64): string {
  const ring = outerRing(polygon);
  const bounds = polygonBounds(polygon);
  if (!bounds || ring.length < 3) return '';
  const [[s, w], [n, e]] = bounds;
  // compensa a convergência dos meridianos para a forma não ficar achatada
  const latScale = Math.cos(((s + n) / 2) * (Math.PI / 180));
  const width = (e - w) * latScale || 1e-9;
  const height = n - s || 1e-9;
  const margin = size * 0.08;
  const scale = (size - 2 * margin) / Math.max(width, height);
  const offsetX = margin + ((size - 2 * margin) - width * scale) / 2;
  const offsetY = margin + ((size - 2 * margin) - height * scale) / 2;
  const points = ring.map(([lon, lat]) => {
    const x = offsetX + (lon! - w) * latScale * scale;
    const y = offsetY + (n - lat!) * scale;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M${points.join(' L')} Z`;
}

const haFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const coordFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 5 });

export function formatHa(value: number): string {
  return `${haFormat.format(value)} ha`;
}

export function formatCoord(value: number): string {
  return coordFormat.format(value);
}
