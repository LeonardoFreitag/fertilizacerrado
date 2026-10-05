import type { Crop, HarvestStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { cultivarService } from '../cultivars/cultivar.service';
import { accessFilter, propertyService, type AuthUser } from '../properties/property.service';
import type { CreateHarvestDto } from './dtos/create-harvest.dto';
import type { ListHarvestsQuery } from './dtos/params.dto';
import type { UpdateHarvestDto } from './dtos/update-harvest.dto';
import { harvestRepository, type FieldRef, type HarvestWithRelations } from './harvest.repository';

export interface HarvestResponse {
  id: string;
  fieldId: string;
  cultivarId: string;
  emergenceDate: string;
  season: string;
  status: HarvestStatus;
  notes: string | null;
  field: FieldRef;
  cultivar: { id: string; name: string; crop: Crop };
  createdAt: Date;
  updatedAt: Date;
}

function notFound(what: 'Safra' | 'Talhão'): AppError {
  return new AppError(404, 'NOT_FOUND', `${what} não encontrado(a).`);
}

function activeConflict(): AppError {
  return new AppError(409, 'FIELD_HAS_ACTIVE_HARVEST', 'O talhão já possui uma safra ativa.');
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function toResponse(harvest: HarvestWithRelations): HarvestResponse {
  return {
    id: harvest.id,
    fieldId: harvest.fieldId,
    cultivarId: harvest.cultivarId,
    emergenceDate: harvest.emergenceDate.toISOString().slice(0, 10),
    season: harvest.season,
    status: harvest.status,
    notes: harvest.notes,
    field: harvest.field,
    cultivar: harvest.cultivar,
    createdAt: harvest.createdAt,
    updatedAt: harvest.updatedAt,
  };
}

/** Talhão existente cuja propriedade está no escopo do usuário; senão 404. */
async function resolveField(user: AuthUser, fieldId: string): Promise<FieldRef> {
  const field = await harvestRepository.findField(fieldId);
  if (!field) throw notFound('Talhão');
  await propertyService.getAccessibleProperty(user, field.propertyId);
  return field;
}

/** Safras de talhões de propriedades visíveis e não excluídas. */
function scopeFilter(user: AuthUser): Prisma.HarvestWhereInput {
  return { field: { property: { ...accessFilter(user), deletedAt: null } } };
}

export const harvestService = {
  async create(user: AuthUser, dto: CreateHarvestDto): Promise<HarvestResponse> {
    await resolveField(user, dto.fieldId);

    const cultivar = await cultivarService.findVisible(user, dto.cultivarId);
    if (!cultivar) {
      throw new AppError(400, 'INVALID_CULTIVAR', 'Cultivar inexistente ou não disponível para você.');
    }

    if (dto.emergenceDate > todayUtc()) {
      throw new AppError(400, 'EMERGENCE_DATE_IN_FUTURE', 'A data de emergência não pode ser futura.');
    }

    const harvest = await prisma.$transaction(async (tx) => {
      await harvestRepository.lockField(dto.fieldId, tx);
      if ((await harvestRepository.countActive(dto.fieldId, tx)) > 0) throw activeConflict();

      return harvestRepository.create(
        {
          fieldId: dto.fieldId,
          cultivarId: dto.cultivarId,
          emergenceDate: new Date(`${dto.emergenceDate}T00:00:00Z`),
          season: dto.season,
          notes: dto.notes,
        },
        tx,
      );
    });

    return toResponse(harvest);
  },

  async list(user: AuthUser, query: ListHarvestsQuery): Promise<HarvestResponse[]> {
    const where: Prisma.HarvestWhereInput = query.fieldId
      ? { fieldId: (await resolveField(user, query.fieldId)).id }
      : scopeFilter(user);
    if (query.status) where.status = query.status;

    const harvests = await harvestRepository.list(where);
    return harvests.map(toResponse);
  },

  async listByField(user: AuthUser, propertyId: string, fieldId: string): Promise<HarvestResponse[]> {
    const field = await resolveField(user, fieldId);
    if (field.propertyId !== propertyId) throw notFound('Talhão');

    const harvests = await harvestRepository.list({ fieldId });
    return harvests.map(toResponse);
  },

  async get(user: AuthUser, id: string): Promise<HarvestResponse> {
    return toResponse(await this.getAccessible(user, id));
  },

  async getAccessible(user: AuthUser, id: string): Promise<HarvestWithRelations> {
    const harvest = await harvestRepository.findById(id);
    if (!harvest) throw notFound('Safra');
    try {
      await propertyService.getAccessibleProperty(user, harvest.field.propertyId);
    } catch {
      throw notFound('Safra');
    }
    return harvest;
  },

  async update(user: AuthUser, id: string, dto: UpdateHarvestDto): Promise<HarvestResponse> {
    const current = await this.getAccessible(user, id);
    const { fieldId: _f, cultivarId: _c, emergenceDate: _e, ...changes } = dto;

    const activating = changes.status === 'ACTIVE' && current.status !== 'ACTIVE';
    if (!activating) {
      return toResponse(await harvestRepository.update(id, changes));
    }

    // Reativação passa pela mesma serialização da criação.
    const updated = await prisma.$transaction(async (tx) => {
      await harvestRepository.lockField(current.fieldId, tx);
      if ((await harvestRepository.countActive(current.fieldId, tx, id)) > 0) throw activeConflict();
      return harvestRepository.update(id, changes, tx);
    });

    return toResponse(updated);
  },
};
