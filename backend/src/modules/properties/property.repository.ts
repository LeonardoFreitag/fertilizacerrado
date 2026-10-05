import { Prisma, type Property, type Role } from '@prisma/client';
import { prisma } from '../../config/database';
import type { Polygon } from '../../utils/geojson.util';

type Db = Prisma.TransactionClient;

const userSummary = { select: { id: true, name: true, email: true } } satisfies Prisma.UserDefaultArgs;

const propertyInclude = {
  owner: userSummary,
  agronomist: userSummary,
} satisfies Prisma.PropertyInclude;

const propertyDetailInclude = {
  ...propertyInclude,
  _count: { select: { fields: true } },
} satisfies Prisma.PropertyInclude;

export type PropertyWithUsers = Prisma.PropertyGetPayload<{ include: typeof propertyInclude }>;
export type PropertyDetail = Prisma.PropertyGetPayload<{ include: typeof propertyDetailInclude }>;

/** Linha de talhão como sai do SQL, com geometrias já em GeoJSON (texto). */
export interface FieldRow {
  id: string;
  name: string;
  property_id: string;
  area_ha: Prisma.Decimal;
  geometry: string;
  centroid: string;
  soil_type: string | null;
  notes: string | null;
  altitude_m: number | null;
  theta_fc: number | null;
  theta_wp: number | null;
  created_at: Date;
  updated_at: Date;
  cell_lat: Prisma.Decimal | null;
  cell_lon: Prisma.Decimal | null;
}

export interface GeometryCheck {
  valid: boolean;
  reason: string;
  areaM2: number;
}

export interface FieldWriteData {
  name?: string;
  areaHa?: number;
  soilType?: string | null;
  notes?: string | null;
  geometry?: Polygon;
  altitudeM?: number | null;
  thetaFC?: number | null;
  thetaWP?: number | null;
}

export interface Centroid {
  lat: number;
  lon: number;
}

// Colunas devolvidas em toda leitura de talhão; a célula ERA5 vem por LEFT JOIN.
const fieldColumns = Prisma.sql`
  f.id, f.name, f.property_id, f.area_ha,
  ST_AsGeoJSON(f.geometry) AS geometry,
  ST_AsGeoJSON(f.centroid) AS centroid,
  f.soil_type, f.notes, f.altitude_m, f.theta_fc, f.theta_wp, f.created_at, f.updated_at,
  c.cell_lat, c.cell_lon`;

const fieldFrom = Prisma.sql`FROM fields f LEFT JOIN era5_cells c ON c.field_id = f.id`;

export const propertyRepository = {
  // ---------- usuários ----------

  findUserRole(id: string, db: Db = prisma): Promise<{ id: string; role: Role } | null> {
    return db.user.findUnique({ where: { id }, select: { id: true, role: true } });
  },

  // ---------- propriedades (Prisma Client) ----------

  listProperties(filter: Prisma.PropertyWhereInput): Promise<PropertyWithUsers[]> {
    return prisma.property.findMany({
      where: { ...filter, deletedAt: null },
      include: propertyInclude,
      orderBy: { name: 'asc' },
    });
  },

  findProperty(id: string, filter: Prisma.PropertyWhereInput): Promise<PropertyDetail | null> {
    return prisma.property.findFirst({
      where: { ...filter, id, deletedAt: null },
      include: propertyDetailInclude,
    });
  },

  createProperty(data: Prisma.PropertyUncheckedCreateInput): Promise<PropertyDetail> {
    return prisma.property.create({ data, include: propertyDetailInclude });
  },

  updateProperty(id: string, data: Prisma.PropertyUncheckedUpdateInput): Promise<PropertyDetail> {
    return prisma.property.update({ where: { id }, data, include: propertyDetailInclude });
  },

  async softDeleteProperty(id: string): Promise<Property> {
    return prisma.property.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  // ---------- talhões (SQL parametrizado: colunas geográficas são Unsupported) ----------

  async checkGeometry(geometry: Polygon, db: Db = prisma): Promise<GeometryCheck> {
    const [row] = await db.$queryRaw<{ valid: boolean; reason: string; area_m2: number }[]>`
      SELECT ST_IsValid(g) AS valid,
             ST_IsValidReason(g) AS reason,
             ST_Area(g::geography) AS area_m2
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326) AS g) s`;

    return { valid: row!.valid, reason: row!.reason, areaM2: Number(row!.area_m2) };
  },

  listFields(propertyId: string, db: Db = prisma): Promise<FieldRow[]> {
    return db.$queryRaw<FieldRow[]>`
      SELECT ${fieldColumns} ${fieldFrom}
      WHERE f.property_id = ${propertyId}::uuid
      ORDER BY f.name ASC`;
  },

  async findField(propertyId: string, id: string, db: Db = prisma): Promise<FieldRow | null> {
    const rows = await db.$queryRaw<FieldRow[]>`
      SELECT ${fieldColumns} ${fieldFrom}
      WHERE f.property_id = ${propertyId}::uuid AND f.id = ${id}::uuid`;
    return rows[0] ?? null;
  },

  /**
   * Insere o talhão calculando centróide e, se não informada, a área na mesma
   * instrução. Devolve o id e o centróide para o cálculo da célula ERA5.
   */
  async insertField(
    propertyId: string,
    data: Required<Pick<FieldWriteData, 'name' | 'geometry'>> & FieldWriteData,
    db: Db,
  ): Promise<{ id: string } & Centroid> {
    const [row] = await db.$queryRaw<{ id: string; lat: number; lon: number }[]>`
      WITH g AS (SELECT ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)})::geography AS geom)
      INSERT INTO fields (id, name, property_id, area_ha, geometry, centroid, soil_type, notes,
                          altitude_m, theta_fc, theta_wp, created_at, updated_at)
      SELECT gen_random_uuid(),
             ${data.name}::text,
             ${propertyId}::uuid,
             COALESCE(${data.areaHa ?? null}::numeric, ST_Area(geom) / 10000),
             geom,
             ST_Centroid(geom),
             ${data.soilType ?? null}::text,
             ${data.notes ?? null}::text,
             ${data.altitudeM ?? null}::float8,
             ${data.thetaFC ?? null}::float8,
             ${data.thetaWP ?? null}::float8,
             now(), now()
      FROM g
      RETURNING id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lon`;

    return row!;
  },

  /**
   * Atualiza apenas os campos presentes. Com geometria nova recalcula o
   * centróide e, se areaHa não veio, a área. Devolve null se o talhão não
   * pertence à propriedade; o centróide vem só quando a geometria mudou.
   */
  async updateField(
    propertyId: string,
    id: string,
    data: FieldWriteData,
    db: Db,
  ): Promise<{ id: string; lat: number | null; lon: number | null } | null> {
    const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
    if (data.name !== undefined) sets.push(Prisma.sql`name = ${data.name}::text`);
    if (data.soilType !== undefined) sets.push(Prisma.sql`soil_type = ${data.soilType}::text`);
    if (data.notes !== undefined) sets.push(Prisma.sql`notes = ${data.notes}::text`);
    if (data.altitudeM !== undefined) sets.push(Prisma.sql`altitude_m = ${data.altitudeM}::float8`);
    if (data.thetaFC !== undefined) sets.push(Prisma.sql`theta_fc = ${data.thetaFC}::float8`);
    if (data.thetaWP !== undefined) sets.push(Prisma.sql`theta_wp = ${data.thetaWP}::float8`);

    if (data.geometry) {
      sets.push(Prisma.sql`geometry = g.geom`, Prisma.sql`centroid = ST_Centroid(g.geom)`);
      sets.push(
        data.areaHa !== undefined
          ? Prisma.sql`area_ha = ${data.areaHa}::numeric`
          : Prisma.sql`area_ha = ST_Area(g.geom) / 10000`,
      );
    } else if (data.areaHa !== undefined) {
      sets.push(Prisma.sql`area_ha = ${data.areaHa}::numeric`);
    }

    const from = data.geometry
      ? Prisma.sql`FROM (SELECT ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)})::geography AS geom) g`
      : Prisma.empty;
    const centroid = data.geometry
      ? Prisma.sql`ST_Y(f.centroid::geometry) AS lat, ST_X(f.centroid::geometry) AS lon`
      : Prisma.sql`NULL::float8 AS lat, NULL::float8 AS lon`;

    const rows = await db.$queryRaw<{ id: string; lat: number | null; lon: number | null }[]>`
      UPDATE fields f SET ${Prisma.join(sets, ', ')}
      ${from}
      WHERE f.id = ${id}::uuid AND f.property_id = ${propertyId}::uuid
      RETURNING f.id, ${centroid}`;

    return rows[0] ?? null;
  },

  async deleteField(propertyId: string, id: string, db: Db = prisma): Promise<boolean> {
    const count = await db.$executeRaw`
      DELETE FROM fields WHERE id = ${id}::uuid AND property_id = ${propertyId}::uuid`;
    return count === 1;
  },

  // ---------- safras (só leitura; o módulo de safras é o dono) ----------

  async countHarvests(fieldId: string): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      prisma.harvest.count({ where: { fieldId } }),
      prisma.harvest.count({ where: { fieldId, status: 'ACTIVE' } }),
    ]);
    return { total, active };
  },

  // ---------- células ERA5 ----------

  async upsertEra5Cell(fieldId: string, lat: number, lon: number, db: Db): Promise<void> {
    await db.era5Cell.upsert({
      where: { fieldId },
      create: { fieldId, cellLat: lat, cellLon: lon },
      update: { cellLat: lat, cellLon: lon },
    });
  },
};
