import { Prisma, type Cultivar } from '@prisma/client';
import { AppError } from '../../utils/app-error';
import type { AuthUser } from '../properties/property.service';
import { cultivarRepository } from './cultivar.repository';
import type { CreateCultivarDto, SyncReferenceMode } from './dtos/create-cultivar.dto';
import {
  CULTIVAR_PARAM_KEYS,
  cultivarParamsSchema,
  pickCultivarParams,
  type CultivarParamKey,
  type CultivarParams,
} from './dtos/cultivar-params.schema';
import type { UpdateCultivarDto } from './dtos/update-cultivar.dto';

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Cultivar não encontrada.');
}

function referenceMissing(): AppError {
  return new AppError(404, 'REFERENCE_CULTIVAR_MISSING', 'Cultivar de referência de soja não encontrada; execute o seed.');
}

/** Os 15 parâmetros científicos de um registro/snapshot, como objeto plano. */
export function scientificParams(source: Record<string, unknown>): CultivarParams {
  return pickCultivarParams(source) as CultivarParams;
}

/**
 * Campos a substituir pela referência. `unchanged`: só os que ainda têm o valor
 * gravado em `referenceSnapshot` (o técnico não mexeu); sem snapshot, nenhum.
 * `all`: todos os que diferem da referência atual.
 */
export function fieldsToSync(
  current: CultivarParams,
  snapshot: Partial<CultivarParams> | null,
  reference: CultivarParams,
  mode: SyncReferenceMode,
): CultivarParamKey[] {
  return CULTIVAR_PARAM_KEYS.filter((key) => {
    if (current[key] === reference[key]) return false;
    if (mode === 'all') return true;
    return snapshot !== null && snapshot[key] !== undefined && current[key] === snapshot[key];
  });
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
  list(user: AuthUser): Promise<Cultivar[]> {
    return cultivarRepository.list(cultivarVisibilityFilter(user));
  },

  /** Referência de soja do banco (seed); 404 REFERENCE_CULTIVAR_MISSING sem seed. */
  async getReference(): Promise<Cultivar> {
    const reference = await cultivarRepository.findReference();
    if (!reference) throw referenceMissing();
    return reference;
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
    const { isDefault: _ignored, crop: _crop, ...data } = dto;
    // Toda cultivar nasce da referência: o snapshot registra de onde partiu,
    // para o sync-reference saber o que o técnico alterou depois.
    const reference = await this.getReference();
    try {
      return await cultivarRepository.create({
        ...data,
        crop: 'SOJA',
        isDefault: false,
        createdById: user.id,
        referenceSnapshot: scientificParams(reference as unknown as Record<string, unknown>),
      });
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

    // Parâmetros científicos podem mudar mesmo com safras: cada run guarda o
    // cultivarSnapshot (reprodutibilidade), e o painel avisa quando a cultivar
    // mudou desde a run (questão aberta #5, decidida em refocus-on-yield-prediction).
    if (paramKeys.length > 0) {
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

  /**
   * Atualiza a cultivar a partir da referência atual — para quando a referência
   * muda (ex.: T_base confirmada). Devolve a cultivar e os campos alterados.
   */
  async syncReference(
    user: AuthUser,
    id: string,
    mode: SyncReferenceMode,
  ): Promise<{ cultivar: Cultivar; updatedFields: CultivarParamKey[] }> {
    const current = await this.get(user, id);
    assertEditable(user, current);
    const reference = scientificParams((await this.getReference()) as unknown as Record<string, unknown>);
    const snapshot = current.referenceSnapshot && typeof current.referenceSnapshot === 'object'
      ? pickCultivarParams(current.referenceSnapshot as Record<string, unknown>)
      : null;

    const updatedFields = fieldsToSync(scientificParams(current as unknown as Record<string, unknown>), snapshot, reference, mode);
    const changes: Partial<CultivarParams> = {};
    for (const key of updatedFields) changes[key] = reference[key];

    // Mesmo sem campo a mudar, o snapshot passa a refletir a referência atual.
    cultivarParamsSchema.parse({ ...pickCultivarParams(current), ...changes });
    const cultivar = await cultivarRepository.update(id, { ...changes, referenceSnapshot: reference });
    return { cultivar, updatedFields };
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
