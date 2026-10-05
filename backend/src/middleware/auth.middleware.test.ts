import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { AppError } from '../utils/app-error';
import {
  signAccessToken,
  signEmailVerificationToken,
  signRefreshToken,
} from '../utils/token.util';
import { authenticate, authorize } from './auth.middleware';

const USER_ID = '7b0c1f1e-6f0b-4c36-9f65-0d2f0c6f3a11';

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>,
) {
  const next = vi.fn();
  middleware(req as Request, {} as Response, next);
  return { req, error: next.mock.calls[0]?.[0] as AppError | undefined, next };
}

function withBearer(token: string): Partial<Request> {
  return { headers: { authorization: `Bearer ${token}` } };
}

function expectUnauthorized(error: AppError | undefined) {
  expect(error).toBeInstanceOf(AppError);
  expect(error?.status).toBe(401);
}

describe('authenticate', () => {
  it('injeta req.user com um access token válido', () => {
    const { req, error } = run(
      authenticate,
      withBearer(signAccessToken({ id: USER_ID, role: 'AGRONOMO' })),
    );

    expect(error).toBeUndefined();
    expect(req.user).toEqual({ id: USER_ID, role: 'AGRONOMO' });
  });

  it('responde 401 sem header Authorization', () => {
    expectUnauthorized(run(authenticate, { headers: {} }).error);
  });

  it('responde 401 com esquema diferente de Bearer', () => {
    const token = signAccessToken({ id: USER_ID, role: 'AGRONOMO' });
    expectUnauthorized(run(authenticate, { headers: { authorization: `Basic ${token}` } }).error);
  });

  it('responde 401 com token expirado', () => {
    const token = jwt.sign({ role: 'AGRONOMO', typ: 'access' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: USER_ID,
      expiresIn: -10,
    });
    expectUnauthorized(run(authenticate, withBearer(token)).error);
  });

  it('responde 401 com assinatura de outro segredo', () => {
    const token = jwt.sign({ role: 'ADMIN', typ: 'access' }, 'outro-segredo-com-mais-de-32-caracteres', {
      algorithm: 'HS256',
      subject: USER_ID,
    });
    expectUnauthorized(run(authenticate, withBearer(token)).error);
  });

  it('responde 401 com token adulterado', () => {
    const [header, , signature] = signAccessToken({ id: USER_ID, role: 'PRODUTOR' }).split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: 'ADMIN', typ: 'access' }),
    ).toString('base64url');
    expectUnauthorized(run(authenticate, withBearer(`${header}.${payload}.${signature}`)).error);
  });

  it('responde 401 com algoritmo none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: 'ADMIN', typ: 'access' }),
    ).toString('base64url');
    expectUnauthorized(run(authenticate, withBearer(`${header}.${payload}.`)).error);
  });

  it('não aceita refresh token como access token', () => {
    expectUnauthorized(run(authenticate, withBearer(signRefreshToken(USER_ID).token)).error);
  });

  it('não aceita token de verificação de e-mail, que usa o mesmo segredo', () => {
    expectUnauthorized(run(authenticate, withBearer(signEmailVerificationToken(USER_ID))).error);
  });

  it('responde 401 com role desconhecido', () => {
    const token = jwt.sign({ role: 'ROOT', typ: 'access' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: USER_ID,
    });
    expectUnauthorized(run(authenticate, withBearer(token)).error);
  });
});

describe('authorize', () => {
  it('permite role incluído na lista', () => {
    const { error, next } = run(authorize('AGRONOMO', 'ADMIN'), {
      user: { id: USER_ID, role: 'AGRONOMO' },
    });

    expect(next).toHaveBeenCalledOnce();
    expect(error).toBeUndefined();
  });

  it('responde 403 para role fora da lista', () => {
    const { error } = run(authorize('AGRONOMO', 'ADMIN'), {
      user: { id: USER_ID, role: 'PRODUTOR' },
    });

    expect(error?.status).toBe(403);
  });

  it('responde 401 sem autenticação prévia', () => {
    expectUnauthorized(run(authorize('ADMIN'), {}).error);
  });
});
