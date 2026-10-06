import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../utils/app-error';
import { listUsersQuerySchema } from './dtos/list-users.dto';
import { changePasswordSchema, updateUserSchema } from './dtos/user.dto';

const tx = {
  user: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
};
vi.mock('../../config/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]))),
  },
}));
vi.mock('../../utils/mailer', () => ({ sendVerificationEmail: vi.fn() }));
vi.mock('../../utils/token.util', () => ({ signEmailVerificationToken: vi.fn().mockReturnValue('tok') }));

import { prisma } from '../../config/database';
import { sendVerificationEmail } from '../../utils/mailer';
import { assertEditableFields, maskDocument, resolveDirectoryScope, userService } from './user.service';

const admin = { id: 'a1', role: 'ADMIN' as const };
const admin2 = { id: 'a2', role: 'ADMIN' as const };
const agronomo = { id: 'b', role: 'AGRONOMO' as const };
const produtor = { id: 'c', role: 'PRODUTOR' as const };

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u', name: 'Ana', email: 'ana@fc.local', role: 'AGRONOMO', active: true, emailVerified: true, phone: null, crea: null,
  cpf: '52998224725', cnpj: null, passwordHash: 'h', refreshToken: 'r', createdAt: new Date(), ...over,
});

async function err(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error('esperava erro');
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([]);
});

describe('schemas', () => {
  it('listagem: página e tamanho com limites; active como booleano', () => {
    expect(listUsersQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(listUsersQuerySchema.parse({ page: '2', pageSize: '50', active: 'false' })).toMatchObject({ page: 2, pageSize: 50, active: false });
    expect(listUsersQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
  it('update exige ao menos um campo; senha nova diferente e forte', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.parse({ phone: '' })).toEqual({ phone: null });
    expect(changePasswordSchema.safeParse({ currentPassword: 'MinhaS3nha!', newPassword: 'MinhaS3nha!' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'fraca' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'NovaS3nha!' }).success).toBe(true);
  });
});

describe('escopo do diretório', () => {
  it('ADMIN tudo; AGRONOMO só PRODUTOR ativos com termo; PRODUTOR 403', async () => {
    expect(resolveDirectoryScope(admin, {})).toEqual({ role: undefined, activeOnly: false });
    expect(resolveDirectoryScope(agronomo, { q: 'ped' })).toEqual({ role: 'PRODUTOR', activeOnly: true });
    expect(() => resolveDirectoryScope(agronomo, { q: 'pe' })).toThrow(AppError);
    expect(() => resolveDirectoryScope(agronomo, { q: 'ana', role: 'AGRONOMO' })).toThrow(AppError);
    expect(() => resolveDirectoryScope(produtor, { q: 'abc' })).toThrow(AppError);
  });

  it('lista paginada devolve items/total e campos por role', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([user()] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(7 as never);
    const page = await userService.list(admin, { page: 2, pageSize: 5, active: undefined });
    expect(page).toMatchObject({ page: 2, pageSize: 5, total: 7 });
    expect(page.items[0]).toMatchObject({ document: '***.982.247-**', active: true, emailVerified: true });
    expect(vi.mocked(prisma.user.findMany).mock.calls[0]![0]).toMatchObject({ skip: 5, take: 5 });
    const dir = await userService.list(agronomo, { q: 'ana', page: 1, pageSize: 20, active: undefined });
    expect(Object.keys(dir.items[0]!)).toEqual(['id', 'name', 'email', 'role']);
  });

  it('máscara de documentos', () => {
    expect(maskDocument('52998224725', null)).toBe('***.982.247-**');
    expect(maskDocument(null, '11222333000181')).toBe('**.222.333/****-**');
    expect(maskDocument(null, null)).toBeNull();
  });
});

describe('edição e regras de administrador', () => {
  it('autoedição: só name/phone/crea; outro usuário ⇒ 404', () => {
    expect(() => assertEditableFields(agronomo, 'b', { name: 'X', phone: '1' })).not.toThrow();
    const e = (() => { try { assertEditableFields(agronomo, 'b', { role: 'ADMIN' }); } catch (x) { return x as AppError; } })();
    expect(e?.code).toBe('FORBIDDEN_FIELDS');
    const nf = (() => { try { assertEditableFields(produtor, 'outro', { name: 'X' }); } catch (x) { return x as AppError; } })();
    expect(nf?.status).toBe(404);
  });

  it('último admin não pode desativar a si mesmo', async () => {
    tx.user.findUnique.mockResolvedValue(user({ id: 'a1', role: 'ADMIN' }));
    const e = await err(userService.setActive(admin, 'a1', false));
    expect(e.code).toBe('LAST_ADMIN');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('último admin ativo não pode ser desativado nem rebaixado por outro', async () => {
    tx.user.findUnique.mockResolvedValue(user({ id: 'a1', role: 'ADMIN' }));
    tx.user.count.mockResolvedValue(0);
    expect((await err(userService.update(admin2, 'a1', { active: false }))).code).toBe('LAST_ADMIN');
    expect((await err(userService.update(admin2, 'a1', { role: 'AGRONOMO' }))).code).toBe('LAST_ADMIN');
  });

  it('com outro admin ativo, desativar funciona e zera o refresh', async () => {
    tx.user.findUnique.mockResolvedValue(user({ id: 'a1', role: 'ADMIN' }));
    tx.user.count.mockResolvedValue(1);
    tx.user.update.mockResolvedValue(user({ id: 'a1', role: 'ADMIN', active: false, refreshToken: null }));
    const view = await userService.setActive(admin2, 'a1', false);
    expect(view.active).toBe(false);
    expect(tx.user.update.mock.calls[0]![0]).toMatchObject({ data: { active: false, refreshToken: null } });
  });

  it('desativar um agrônomo não passa pela regra de admin', async () => {
    tx.user.findUnique.mockResolvedValue(user({ id: 'b' }));
    tx.user.update.mockResolvedValue(user({ id: 'b', active: false }));
    await userService.setActive(admin, 'b', false);
    expect(tx.user.count).not.toHaveBeenCalled();
  });

  it('reenvio pelo admin: 409 se já verificado, envia se não', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user({ emailVerified: true }) as never);
    expect((await err(userService.resendVerification('u'))).code).toBe('ALREADY_VERIFIED');
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user({ emailVerified: false }) as never);
    await userService.resendVerification('u');
    expect(sendVerificationEmail).toHaveBeenCalledWith('ana@fc.local', 'Ana', 'tok');
  });
});
