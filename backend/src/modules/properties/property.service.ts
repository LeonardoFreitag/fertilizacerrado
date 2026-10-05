import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { snapToEra5Cell } from '../../utils/era5-grid.util';
import type { Point, Polygon } from '../../utils/geojson.util';
import type { CreateFieldDto } from './dtos/create-field.dto';
import type { CreatePropertyDto } from './dtos/create-property.dto';
import type { UpdateFieldDto } from './dtos/update-field.dto';
import { ADMIN_ONLY_PROPERTY_FIELDS, type UpdatePropertyDto } from './dtos/update-property.dto';
import {
  propertyRepository,
  type FieldRow,
  type PropertyDetail,
  type PropertyWithUsers,
} from './property.repository';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface PropertyResponse {
  id: string;
  name: string;
  state: string;
  city: string;
  car: string | null;
  nirf: string | null;
  ownerId: string;
  agronomistId: string | null;
  owner: UserSummary;
  agronomist: UserSummary | null;
  fieldsCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FieldResponse {
  id: string;
  name: string;
  propertyId: string;
  areaHa: number;
  geometry: Polygon;
  centroid: Point;
  soilType: string | null;
  notes: string | null;
  altitudeM: number | null;
  thetaFC: number | null;
  thetaWP: number | null;
  era5Cell: { lat: number; lon: number } | null;
  createdAt: Date;
  updatedAt: Date;
}

const OWNER_ROLES: Role[] = ['PRODUTOR', 'AGRONOMO'];

function notFound(what: 'Propriedade' | 'Talhão'): AppError {
  return new AppError(404, 'NOT_FOUND', `${what} não encontrado(a).`);
}

/** `where` do Prisma com as propriedades que o usuário pode ver. */
export function accessFilter(user: AuthUser): Prisma.PropertyWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'AGRONOMO':
      return { OR: [{ ownerId: user.id }, { agronomistId: user.id }] };
    case 'PRODUTOR':
      return { ownerId: user.id };
  }
}

function toPropertyResponse(property: PropertyWithUsers | PropertyDetail): PropertyResponse {
  const { deletedAt: _deleted, ...rest } = property;
  const response: PropertyResponse = {
    id: rest.id,
    name: rest.name,
    state: rest.state,
    city: rest.city,
    car: rest.car,
    nirf: rest.nirf,
    ownerId: rest.ownerId,
    agronomistId: rest.agronomistId,
    owner: rest.owner,
    agronomist: rest.agronomist,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
  };
  if ('_count' in property) response.fieldsCount = property._count.fields;
  return response;
}

function toFieldResponse(row: FieldRow): FieldResponse {
  return {
    id: row.id,
    name: row.name,
    propertyId: row.property_id,
    areaHa: Number(row.area_ha),
    geometry: JSON.parse(row.geometry) as Polygon,
    centroid: JSON.parse(row.centroid) as Point,
    soilType: row.soil_type,
    notes: row.notes,
    altitudeM: row.altitude_m,
    thetaFC: row.theta_fc,
    thetaWP: row.theta_wp,
    era5Cell:
      row.cell_lat !== null && row.cell_lon !== null
        ? { lat: Number(row.cell_lat), lon: Number(row.cell_lon) }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertOwner(ownerId: string): Promise<void> {
  const owner = await propertyRepository.findUserRole(ownerId);
  if (!owner || !OWNER_ROLES.includes(owner.role)) {
    throw new AppError(400, 'INVALID_OWNER', 'Dono inexistente ou sem role de produtor/agrônomo.');
  }
}

async function assertAgronomist(agronomistId: string): Promise<void> {
  const agronomist = await propertyRepository.findUserRole(agronomistId);
  if (!agronomist || agronomist.role !== 'AGRONOMO') {
    throw new AppError(400, 'INVALID_AGRONOMIST', 'Responsável técnico inexistente ou que não é agrônomo.');
  }
}

/** Rejeita a geometria antes de qualquer escrita; a razão vem do PostGIS. */
async function assertValidGeometry(geometry: Polygon): Promise<void> {
  const check = await propertyRepository.checkGeometry(geometry);
  if (!check.valid) {
    throw new AppError(400, 'INVALID_GEOMETRY', `Geometria inválida: ${check.reason}.`);
  }
  if (check.areaM2 <= 0) {
    throw new AppError(400, 'INVALID_GEOMETRY', 'Geometria inválida: área zero.');
  }
}

/**
 * Talhão com safras não pode ser removido: a ativa pela regra de negócio, as
 * históricas porque são o registro do produtor (FK RESTRICT no banco).
 */
async function assertFieldCanBeDeleted(fieldId: string): Promise<void> {
  const { total, active } = await propertyRepository.countHarvests(fieldId);
  if (active > 0) {
    throw new AppError(409, 'FIELD_HAS_ACTIVE_HARVEST', 'O talhão possui uma safra ativa e não pode ser excluído.');
  }
  if (total > 0) {
    throw new AppError(
      409,
      'FIELD_HAS_HARVESTS',
      `O talhão possui ${total} safra(s) no histórico e não pode ser excluído.`,
    );
  }
}

export const propertyService = {
  async getAccessibleProperty(user: AuthUser, id: string): Promise<PropertyDetail> {
    const property = await propertyRepository.findProperty(id, accessFilter(user));
    if (!property) throw notFound('Propriedade');
    return property;
  },

  async listProperties(user: AuthUser): Promise<PropertyResponse[]> {
    const properties = await propertyRepository.listProperties(accessFilter(user));
    return properties.map(toPropertyResponse);
  },

  async getProperty(user: AuthUser, id: string): Promise<PropertyResponse> {
    return toPropertyResponse(await this.getAccessibleProperty(user, id));
  },

  async createProperty(user: AuthUser, dto: CreatePropertyDto): Promise<PropertyResponse> {
    let { ownerId, agronomistId } = dto;

    if (user.role === 'ADMIN') {
      if (!ownerId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'ownerId é obrigatório para administradores.');
      }
    } else {
      // Agrônomo: sem dono informado é o próprio; com outro dono, assume a
      // responsabilidade técnica salvo indicação contrária.
      ownerId ??= user.id;
      if (ownerId !== user.id) agronomistId ??= user.id;

      if (ownerId !== user.id && agronomistId !== user.id) {
        throw new AppError(
          400,
          'AGRONOMIST_WITHOUT_ACCESS',
          'O agrônomo precisa ser dono ou responsável técnico da propriedade que cria.',
        );
      }
    }

    // Um agrônomo é dono válido por definição; qualquer outro dono (inclusive
    // o próprio ADMIN tentando se cadastrar como dono) passa pela checagem.
    if (user.role === 'ADMIN' || ownerId !== user.id) await assertOwner(ownerId);
    if (agronomistId && agronomistId !== user.id) await assertAgronomist(agronomistId);

    const property = await propertyRepository.createProperty({
      name: dto.name,
      state: dto.state,
      city: dto.city,
      car: dto.car,
      nirf: dto.nirf,
      ownerId,
      agronomistId: agronomistId ?? null,
    });
    return toPropertyResponse(property);
  },

  async updateProperty(user: AuthUser, id: string, dto: UpdatePropertyDto): Promise<PropertyResponse> {
    if (user.role !== 'ADMIN') {
      const forbidden = ADMIN_ONLY_PROPERTY_FIELDS.filter((field) => field in dto);
      if (forbidden.length > 0) {
        throw new AppError(
          400,
          'FORBIDDEN_FIELDS',
          `Apenas administradores podem alterar: ${forbidden.join(', ')}.`,
        );
      }
    }

    await this.getAccessibleProperty(user, id);

    if (dto.ownerId !== undefined) await assertOwner(dto.ownerId);
    if (dto.agronomistId) await assertAgronomist(dto.agronomistId);

    const property = await propertyRepository.updateProperty(id, dto);
    return toPropertyResponse(property);
  },

  async deleteProperty(user: AuthUser, id: string): Promise<void> {
    await this.getAccessibleProperty(user, id);
    await propertyRepository.softDeleteProperty(id);
  },

  // ---------- talhões ----------

  async listFields(user: AuthUser, propertyId: string): Promise<FieldResponse[]> {
    await this.getAccessibleProperty(user, propertyId);
    const rows = await propertyRepository.listFields(propertyId);
    return rows.map(toFieldResponse);
  },

  async getField(user: AuthUser, propertyId: string, id: string): Promise<FieldResponse> {
    await this.getAccessibleProperty(user, propertyId);
    const row = await propertyRepository.findField(propertyId, id);
    if (!row) throw notFound('Talhão');
    return toFieldResponse(row);
  },

  async createField(user: AuthUser, propertyId: string, dto: CreateFieldDto): Promise<FieldResponse> {
    await this.getAccessibleProperty(user, propertyId);
    await assertValidGeometry(dto.geometry);

    // Talhão e célula ERA5 nascem juntos ou não nascem.
    const row = await prisma.$transaction(async (tx) => {
      const created = await propertyRepository.insertField(propertyId, dto, tx);
      const cell = snapToEra5Cell(created.lat, created.lon);
      await propertyRepository.upsertEra5Cell(created.id, cell.lat, cell.lon, tx);
      return propertyRepository.findField(propertyId, created.id, tx);
    });

    return toFieldResponse(row!);
  },

  async updateField(
    user: AuthUser,
    propertyId: string,
    id: string,
    dto: UpdateFieldDto,
  ): Promise<FieldResponse> {
    await this.getAccessibleProperty(user, propertyId);
    if (dto.geometry) await assertValidGeometry(dto.geometry);

    // thetaFC > thetaWP vale sobre o estado resultante, não só sobre o patch.
    if (dto.thetaFC !== undefined || dto.thetaWP !== undefined) {
      const current = await propertyRepository.findField(propertyId, id);
      if (!current) throw notFound('Talhão');
      const thetaFC = dto.thetaFC === undefined ? current.theta_fc : dto.thetaFC;
      const thetaWP = dto.thetaWP === undefined ? current.theta_wp : dto.thetaWP;
      if (thetaFC != null && thetaWP != null && thetaFC <= thetaWP) {
        const field = dto.thetaFC !== undefined ? 'thetaFC' : 'thetaWP';
        throw new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos.', undefined, {
          [field]: ['thetaFC deve ser maior que thetaWP'],
        });
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      const updated = await propertyRepository.updateField(propertyId, id, dto, tx);
      if (!updated) return null;

      // Só a troca de geometria move o centróide e, com ele, a célula.
      if (updated.lat !== null && updated.lon !== null) {
        const cell = snapToEra5Cell(updated.lat, updated.lon);
        await propertyRepository.upsertEra5Cell(id, cell.lat, cell.lon, tx);
      }
      return propertyRepository.findField(propertyId, id, tx);
    });

    if (!row) throw notFound('Talhão');
    return toFieldResponse(row);
  },

  async deleteField(user: AuthUser, propertyId: string, id: string): Promise<void> {
    await this.getAccessibleProperty(user, propertyId);
    const field = await propertyRepository.findField(propertyId, id);
    if (!field) throw notFound('Talhão');

    await assertFieldCanBeDeleted(id);
    // era5_cells cai por ON DELETE CASCADE.
    const deleted = await propertyRepository.deleteField(propertyId, id);
    if (!deleted) throw notFound('Talhão');
  },
};
