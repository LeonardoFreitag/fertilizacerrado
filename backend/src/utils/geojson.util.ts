import { z } from 'zod';

const MAX_RINGS = 50;
const MAX_POSITIONS_PER_RING = 10_000;

export type Position = [lon: number, lat: number];

/** Posição GeoJSON `[lon, lat]`; um terceiro valor (altitude) é aceito e descartado. */
const positionSchema = z
  .tuple([
    z.number().min(-180, 'longitude fora do intervalo').max(180, 'longitude fora do intervalo'),
    z.number().min(-90, 'latitude fora do intervalo').max(90, 'latitude fora do intervalo'),
  ])
  .rest(z.number())
  .refine((position) => position.length <= 3, 'posição com mais de 3 valores')
  .transform(([lon, lat]): Position => [lon, lat]);

const ringSchema = z
  .array(positionSchema)
  .min(4, 'anel precisa de ao menos 4 posições')
  .max(MAX_POSITIONS_PER_RING, `anel com mais de ${MAX_POSITIONS_PER_RING} posições`)
  .refine(isClosedRing, 'anel não fechado: a primeira posição deve ser igual à última');

/** GeoJSON Polygon: anel externo seguido de zero ou mais anéis internos (buracos). */
export const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(ringSchema)
    .min(1, 'polígono sem anéis')
    .max(MAX_RINGS, `polígono com mais de ${MAX_RINGS} anéis`),
});

export type Polygon = z.infer<typeof polygonSchema>;

export interface Point {
  type: 'Point';
  coordinates: Position;
}

export function isClosedRing(ring: Position[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}
