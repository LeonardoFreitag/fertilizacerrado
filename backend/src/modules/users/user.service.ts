import type { Prisma, Role, User } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/app-error';
import { sendVerificationEmail } from '../../utils/mailer';
import { signEmailVerificationToken } from '../../utils/token.util';
import type { AuthUser } from '../properties/property.service';
import type { ListUsersQuery } from './dtos/list-users.dto';
import { SELF_EDITABLE_FIELDS, type ChangePasswordDto, type UpdateUserDto } from './dtos/user.dto';

const BCRYPT_ROUNDS = 12;

/** Entrada do diretório (AGRONOMO vê só isto). */
export interface UserDirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Visão administrativa (ADMIN e o próprio usuário). */
export interface UserAdminView extends UserDirectoryEntry {
  active: boolean;
  emailVerified: boolean;
  phone: string | null;
  crea: string | null;
  /** CPF/CNPJ mascarado: só os dígitos do meio */
  document: string | null;
  createdAt: Date;
}

export interface UsersPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Termo mínimo para o agrônomo: evita listar a base de produtores inteira. */
export const AGRONOMO_MIN_QUERY = 3;

export function maskDocument(cpf: string | null, cnpj: string | null): string | null {
  if (cpf) return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
  if (cnpj) return `**.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/****-**`;
  return null;
}

export function toDirectoryEntry(u: Pick<User, 'id' | 'name' | 'email' | 'role'>): UserDirectoryEntry {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export function toAdminView(u: User): UserAdminView {
  return {
    ...toDirectoryEntry(u),
    active: u.active,
    emailVerified: u.emailVerified,
    phone: u.phone,
    crea: u.crea,
    document: maskDocument(u.cpf, u.cnpj),
    createdAt: u.createdAt,
  };
}

/**
 * Escopo do diretório: ADMIN pesquisa qualquer role (com ou sem termo); AGRONOMO só
 * PRODUTOR ativos, com termo de ao menos 3 caracteres; PRODUTOR não tem acesso.
 */
export function resolveDirectoryScope(user: AuthUser, query: Pick<ListUsersQuery, 'q' | 'role'>): { role?: Role; activeOnly: boolean } {
  if (user.role === 'ADMIN') return { role: query.role, activeOnly: false };
  if (user.role === 'AGRONOMO') {
    if (query.role && query.role !== 'PRODUTOR') {
      throw new AppError(403, 'FORBIDDEN', 'Agrônomos só podem pesquisar produtores.');
    }
    if (!query.q || query.q.length < AGRONOMO_MIN_QUERY) {
      throw new AppError(400, 'VALIDATION_ERROR', `Informe ao menos ${AGRONOMO_MIN_QUERY} caracteres para pesquisar.`, undefined, {
        q: [`deve ter no mínimo ${AGRONOMO_MIN_QUERY} caracteres`],
      });
    }
    return { role: 'PRODUTOR', activeOnly: true };
  }
  throw new AppError(403, 'FORBIDDEN', 'Acesso negado.');
}

/** Campos que o usuário pode alterar em si mesmo; ADMIN pode tudo. */
export function assertEditableFields(actor: AuthUser, targetId: string, dto: UpdateUserDto): void {
  if (actor.role === 'ADMIN') return;
  if (actor.id !== targetId) throw notFound();
  const extra = Object.entries(dto)
    .filter(([k, v]) => v !== undefined && !(SELF_EDITABLE_FIELDS as readonly string[]).includes(k))
    .map(([k]) => k);
  if (extra.length > 0) {
    throw new AppError(403, 'FORBIDDEN_FIELDS', `Você não pode alterar: ${extra.join(', ')}.`);
  }
}

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Usuário não encontrado.');
}

function lastAdmin(self: boolean): AppError {
  return new AppError(
    409,
    'LAST_ADMIN',
    self ? 'Você não pode desativar nem rebaixar a si mesmo.' : 'Não é possível desativar ou rebaixar o último administrador ativo.',
  );
}

/**
 * Dentro de uma transação, garante que a mudança (desativar ou trocar o role de
 * um ADMIN) deixa ao menos um ADMIN ativo. Trava as linhas dos admins contra corrida.
 */
async function assertNotLastAdmin(tx: Prisma.TransactionClient, target: User, actor: AuthUser, losesAdmin: boolean): Promise<void> {
  if (target.role !== 'ADMIN' || !target.active || !losesAdmin) return;
  if (actor.id === target.id) throw lastAdmin(true);
  await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' AND active FOR UPDATE`;
  const others = await tx.user.count({ where: { role: 'ADMIN', active: true, id: { not: target.id } } });
  if (others === 0) throw lastAdmin(false);
}

export const userService = {
  async list(user: AuthUser, query: ListUsersQuery): Promise<UsersPage<UserDirectoryEntry | UserAdminView>> {
    const scope = resolveDirectoryScope(user, query);
    const where: Prisma.UserWhereInput = {
      ...(scope.role ? { role: scope.role } : {}),
      ...(scope.activeOnly ? { active: true } : query.active === undefined ? {} : { active: query.active }),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({ where, orderBy: { name: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.user.count({ where }),
    ]);
    const items = user.role === 'ADMIN' ? rows.map(toAdminView) : rows.map(toDirectoryEntry);
    return { items, page: query.page, pageSize: query.pageSize, total };
  },

  /** ADMIN ou o próprio usuário; demais ⇒ 404 (não revela existência). */
  async get(actor: AuthUser, id: string): Promise<UserAdminView> {
    if (actor.role !== 'ADMIN' && actor.id !== id) throw notFound();
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound();
    return toAdminView(user);
  },

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserAdminView> {
    assertEditableFields(actor, id, dto);
    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw notFound();
      const losesAdmin = (dto.active === false) || (dto.role !== undefined && dto.role !== 'ADMIN');
      await assertNotLastAdmin(tx, target, actor, losesAdmin);
      const data: Prisma.UserUpdateInput = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.crea !== undefined ? { crea: dto.crea } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        // desativar revoga o refresh na hora
        ...(dto.active === false ? { refreshToken: null } : {}),
      };
      return tx.user.update({ where: { id }, data });
    });
    return toAdminView(updated);
  },

  async setActive(actor: AuthUser, id: string, active: boolean): Promise<UserAdminView> {
    return this.update(actor, id, { active });
  },

  /** ADMIN reenvia sem limite; 409 se já verificado. */
  async resendVerification(id: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound();
    if (user.emailVerified) throw new AppError(409, 'ALREADY_VERIFIED', 'Este e-mail já está verificado.');
    await sendVerificationEmail(user.email, user.name, signEmailVerificationToken(user.id));
  },

  /** Senha atual + nova; revoga o refresh (outras sessões caem). */
  async changePassword(actor: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Usuário não encontrado.');
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Senha atual incorreta.');
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, refreshToken: null } });
  },
};
