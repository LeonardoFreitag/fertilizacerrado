import type { HarvestStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

type Db = Prisma.TransactionClient;

const harvestInclude = {
  field: { select: { id: true, name: true, propertyId: true } },
  cultivar: { select: { id: true, name: true, crop: true } },
} satisfies Prisma.HarvestInclude;

export type HarvestWithRelations = Prisma.HarvestGetPayload<{ include: typeof harvestInclude }>;

export interface FieldRef {
  id: string;
  name: string;
  propertyId: string;
}

export const harvestRepository = {
  findField(fieldId: string): Promise<FieldRef | null> {
    return prisma.field.findUnique({
      where: { id: fieldId },
      select: { id: true, name: true, propertyId: true },
    });
  },

  list(where: Prisma.HarvestWhereInput): Promise<HarvestWithRelations[]> {
    return prisma.harvest.findMany({
      where,
      include: harvestInclude,
      orderBy: [{ emergenceDate: 'desc' }, { createdAt: 'desc' }],
    });
  },

  findById(id: string, db: Db = prisma): Promise<HarvestWithRelations | null> {
    return db.harvest.findUnique({ where: { id }, include: harvestInclude });
  },

  create(data: Prisma.HarvestUncheckedCreateInput, db: Db): Promise<HarvestWithRelations> {
    return db.harvest.create({ data, include: harvestInclude });
  },

  update(id: string, data: Prisma.HarvestUncheckedUpdateInput, db: Db = prisma): Promise<HarvestWithRelations> {
    return db.harvest.update({ where: { id }, data, include: harvestInclude });
  },

  /**
   * Trava a linha do talhão até o fim da transação, serializando as escritas
   * de safra do mesmo talhão (substitui um índice parcial que o Prisma não
   * representa no schema).
   */
  async lockField(fieldId: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT id FROM fields WHERE id = ${fieldId}::uuid FOR UPDATE`;
  },

  countActive(fieldId: string, db: Db, excludeId?: string): Promise<number> {
    const status: HarvestStatus = 'ACTIVE';
    return db.harvest.count({
      where: { fieldId, status, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
  },
};
