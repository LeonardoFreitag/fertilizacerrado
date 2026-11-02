import type { Cultivar, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export const cultivarRepository = {
  list(filter: Prisma.CultivarWhereInput): Promise<Cultivar[]> {
    return prisma.cultivar.findMany({
      where: filter,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  },

  /** Cultivar de referência de soja (seed), ou null se o seed não rodou. */
  findReference(): Promise<Cultivar | null> {
    return prisma.cultivar.findFirst({ where: { isDefault: true, crop: 'SOJA' }, orderBy: { createdAt: 'asc' } });
  },

  findOne(id: string, filter: Prisma.CultivarWhereInput): Promise<Cultivar | null> {
    return prisma.cultivar.findFirst({ where: { ...filter, id } });
  },

  create(data: Prisma.CultivarUncheckedCreateInput): Promise<Cultivar> {
    return prisma.cultivar.create({ data });
  },

  update(id: string, data: Prisma.CultivarUncheckedUpdateInput): Promise<Cultivar> {
    return prisma.cultivar.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.cultivar.delete({ where: { id } });
  },

  /** Safras que referenciam a cultivar, em qualquer status. */
  countHarvests(cultivarId: string): Promise<number> {
    return prisma.harvest.count({ where: { cultivarId } });
  },
};
