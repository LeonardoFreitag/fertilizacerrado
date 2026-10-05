import { describe, expect, it } from 'vitest';
import { AppError } from '../../utils/app-error';
import { listUsersQuerySchema } from './dtos/list-users.dto';
import { resolveDirectoryScope } from './user.service';

const admin = { id: 'a', role: 'ADMIN' as const };
const agronomo = { id: 'b', role: 'AGRONOMO' as const };
const produtor = { id: 'c', role: 'PRODUTOR' as const };

function err(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('esperava erro');
}

describe('listUsersQuerySchema', () => {
  it('limite padrão 20, máximo 50', () => {
    expect(listUsersQuerySchema.parse({}).limit).toBe(20);
    expect(listUsersQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(listUsersQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('role inválida rejeitada; q aparado', () => {
    expect(listUsersQuerySchema.safeParse({ role: 'ROOT' }).success).toBe(false);
    expect(listUsersQuerySchema.parse({ q: '  ped ' }).q).toBe('ped');
  });
});

describe('resolveDirectoryScope', () => {
  it('ADMIN pesquisa qualquer role, com ou sem termo', () => {
    expect(resolveDirectoryScope(admin, { limit: 20 })).toEqual({ role: undefined });
    expect(resolveDirectoryScope(admin, { limit: 20, role: 'AGRONOMO' })).toEqual({ role: 'AGRONOMO' });
  });

  it('AGRONOMO só PRODUTOR, com q >= 3', () => {
    expect(resolveDirectoryScope(agronomo, { limit: 20, q: 'ped' })).toEqual({ role: 'PRODUTOR' });
    expect(resolveDirectoryScope(agronomo, { limit: 20, q: 'ped', role: 'PRODUTOR' })).toEqual({ role: 'PRODUTOR' });
    const semTermo = err(() => resolveDirectoryScope(agronomo, { limit: 20 }));
    expect(semTermo.status).toBe(400);
    expect(semTermo.code).toBe('VALIDATION_ERROR');
    expect(err(() => resolveDirectoryScope(agronomo, { limit: 20, q: 'pe' })).status).toBe(400);
    const outraRole = err(() => resolveDirectoryScope(agronomo, { limit: 20, q: 'ana', role: 'AGRONOMO' }));
    expect(outraRole.status).toBe(403);
    expect(outraRole.code).toBe('FORBIDDEN');
  });

  it('PRODUTOR não acessa', () => {
    expect(err(() => resolveDirectoryScope(produtor, { limit: 20, q: 'abc' })).status).toBe(403);
  });
});
