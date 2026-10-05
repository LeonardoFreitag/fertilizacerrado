import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import type { AuthUser } from '../properties/property.service';
import type { ListUsersQuery } from './dtos/list-users.dto';

export interface UserDirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Termo mínimo para o agrônomo: evita listar a base de produtores inteira. */
export const AGRONOMO_MIN_QUERY = 3;

/**
 * Diretório mínimo para a interface escolher o produtor dono de uma propriedade.
 * ADMIN pesquisa qualquer role (com ou sem termo); AGRONOMO só PRODUTOR, com
 * termo de ao menos 3 caracteres; PRODUTOR não tem acesso.
 */
export function resolveDirectoryScope(user: AuthUser, query: ListUsersQuery): { role?: Role } {
  if (user.role === 'ADMIN') return { role: query.role };
  if (user.role === 'AGRONOMO') {
    if (query.role && query.role !== 'PRODUTOR') {
      throw new AppError(403, 'FORBIDDEN', 'Agrônomos só podem pesquisar produtores.');
    }
    if (!query.q || query.q.length < AGRONOMO_MIN_QUERY) {
      throw new AppError(400, 'VALIDATION_ERROR', `Informe ao menos ${AGRONOMO_MIN_QUERY} caracteres para pesquisar.`, undefined, {
        q: [`deve ter no mínimo ${AGRONOMO_MIN_QUERY} caracteres`],
      });
    }
    return { role: 'PRODUTOR' };
  }
  throw new AppError(403, 'FORBIDDEN', 'Acesso negado.');
}

export const userService = {
  async list(user: AuthUser, query: ListUsersQuery): Promise<UserDirectoryEntry[]> {
    const scope = resolveDirectoryScope(user, query);
    const where: Prisma.UserWhereInput = {
      ...(scope.role ? { role: scope.role } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    return prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
      take: query.limit,
    });
  },
};
