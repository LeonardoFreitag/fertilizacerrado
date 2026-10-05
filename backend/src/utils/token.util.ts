import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';

const ALGORITHM = 'HS256';
const EMAIL_VERIFICATION_EXPIRES_IN = '24h';

type TokenType = 'access' | 'refresh' | 'verify-email';

export interface AccessTokenPayload {
  id: string;
  role: Role;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Token opaco de 32 bytes criptograficamente seguros, em hexadecimal. */
export function generateRandomToken(): string {
  return randomBytes(32).toString('hex');
}

export function signAccessToken(user: AccessTokenPayload): string {
  return sign({ role: user.role }, user.id, 'access', env.JWT_SECRET, env.JWT_EXPIRES_IN);
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const payload = verify(token, 'access', env.JWT_SECRET);
  if (!payload || !isRole(payload.role)) return null;
  return { id: payload.sub, role: payload.role };
}

export function signRefreshToken(userId: string): SignedToken {
  // O jti garante tokens distintos mesmo quando emitidos no mesmo segundo.
  const token = sign(
    { jti: randomUUID() },
    userId,
    'refresh',
    env.JWT_REFRESH_SECRET,
    env.JWT_REFRESH_EXPIRES_IN,
  );
  const { exp } = jwt.decode(token) as JwtPayload;
  return { token, expiresAt: new Date((exp as number) * 1000) };
}

/** Retorna o id do usuário ou null se o token for inválido. */
export function verifyRefreshToken(token: string): string | null {
  return verify(token, 'refresh', env.JWT_REFRESH_SECRET)?.sub ?? null;
}

export function signEmailVerificationToken(userId: string): string {
  return sign({}, userId, 'verify-email', env.JWT_SECRET, EMAIL_VERIFICATION_EXPIRES_IN);
}

/** Retorna o id do usuário ou null se o token for inválido. */
export function verifyEmailVerificationToken(token: string): string | null {
  return verify(token, 'verify-email', env.JWT_SECRET)?.sub ?? null;
}

function sign(
  claims: Record<string, unknown>,
  subject: string,
  typ: TokenType,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign({ ...claims, typ }, secret, {
    algorithm: ALGORITHM,
    subject,
    expiresIn: expiresIn as SignOptions['expiresIn'],
  });
}

// O claim typ impede que um token de um propósito seja aceito em outro,
// mesmo quando compartilham o segredo.
function verify(
  token: string,
  typ: TokenType,
  secret: string,
): (JwtPayload & { sub: string }) | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    if (typeof payload === 'string' || payload.typ !== typ || typeof payload.sub !== 'string') {
      return null;
    }
    return payload as JwtPayload & { sub: string };
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is Role {
  return value === 'ADMIN' || value === 'AGRONOMO' || value === 'PRODUTOR';
}
