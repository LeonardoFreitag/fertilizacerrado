import { Prisma, type Crop, type Cultivar } from '@prisma/client';
import { AppError } from '../../utils/app-error';
import type { AuthUser } from '../properties/property.service';
import { cultivarRepository } from './cultivar.repository';
import type { CreateCultivarDto } from './dtos/create-cultivar.dto';
import {
  CULTIVAR_PARAM_KEYS,
  cultivarParamsSchema,
  pickCultivarParams,
} from './dtos/cultivar-params.schema';
import type { UpdateCultivarDto } from './dtos/update-cultivar.dto';

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Cultivar não encontrada.');
}

/** Cultivares que o usuário enxerga: de referência ou criadas por ele; ADMIN vê todas. */
export function cultivarVisibilityFilter(user: AuthUser): Prisma.CultivarWhereInput {
  return user.role === 'ADMIN' ? {} : { OR: [{ isDefault: true }, { createdById: user.id }] };
}

function assertEditable(user: AuthUser, cultivar: Cultivar): void {
  if (cultivar.isDefault) {
    throw new AppError(
      403,
      'DEFAULT_CULTIVAR_READONLY',
      'Cultivares de referência não podem ser alteradas pela API; ajuste o seed.',
    );
  }
  // Visibilidade já restringe a criador/ADMIN; a checagem cobre uso indevido.
  if (user.role !== 'ADMIN' && cultivar.createdById !== user.id) throw notFound();
}

export const cultivarService = {
  list(user: AuthUser, crop?: Crop): Promise<Cultivar[]> {
    return cultivarRepository.list(cultivarVisibilityFilter(user), crop);
  },

  async get(user: AuthUser, id: string): Promise<Cultivar> {
    const cultivar = await cultivarRepository.findOne(id, cultivarVisibilityFilter(user));
    if (!cultivar) throw notFound();
    return cultivar;
  },

  /** Cultivar utilizável em uma safra pelo usuário, ou null. */
  findVisible(user: AuthUser, id: string): Promise<Cultivar | null> {
    return cultivarRepository.findOne(id, cultivarVisibilityFilter(user));
  },

  async create(user: AuthUser, dto: CreateCultivarDto): Promise<Cultivar> {
    const { isDefault: _ignored, ...data } = dto;
    try {
      return await cultivarRepository.create({ ...data, isDefault: false, createdById: user.id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'CULTIVAR_NAME_IN_USE', 'Você já tem uma cultivar com esse nome para essa cultura.');
      }
      throw error;
    }
  },

  async update(user: AuthUser, id: string, dto: UpdateCultivarDto): Promise<Cultivar> {
    const current = await this.get(user, id);
    assertEditable(user, current);

    const { crop: _c, isDefault: _d, createdById: _b, ...changes } = dto;
    const paramKeys = CULTIVAR_PARAM_KEYS.filter((key) => changes[key] !== undefined);

    // Parâmetros científicos congelam com a primeira safra: os resultados do
    // MSA precisam continuar reproduzíveis (design, Decisão 6).
    if (paramKeys.length > 0) {
      const harvests = await cultivarRepository.countHarvests(id);
      if (harvests > 0) {
        throw new AppError(
          409,
          'CULTIVAR_IN_USE',
          `Cultivar usada em ${harvests} safra(s); parâmetros não podem ser alterados: ${paramKeys.join(', ')}. Crie uma nova cultivar.`,
        );
      }

      // Valida o estado resultante, não só o patch (ex.: gdaF2End < gdaF3End).
      cultivarParamsSchema.parse({ ...pickCultivarParams(current), ...pickCultivarParams(changes) });
    }

    try {
      return await cultivarRepository.update(id, changes);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'CULTIVAR_NAME_IN_USE', 'Você já tem uma cultivar com esse nome para essa cultura.');
      }
      throw error;
    }
  },

  async delete(user: AuthUser, id: string): Promise<void> {
    const cultivar = await this.get(user, id);
    assertEditable(user, cultivar);

    const harvests = await cultivarRepository.countHarvests(id);
    if (harvests > 0) {
      throw new AppError(
        409,
        'CULTIVAR_IN_USE',
        `Cultivar referenciada por ${harvests} safra(s) e não pode ser excluída.`,
      );
    }

    await cultivarRepository.delete(id);
  },
};
