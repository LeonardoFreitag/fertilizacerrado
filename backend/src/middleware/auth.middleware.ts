import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../utils/app-error';
import { verifyAccessToken } from '../utils/token.util';

/** Valida o access token do header Authorization e injeta req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');

  const user = scheme === 'Bearer' && token ? verifyAccessToken(token) : null;
  if (!user) {
    next(new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente ou inválido.'));
    return;
  }

  req.user = user;
  next();
}

/** Restringe a rota aos roles informados. Deve vir depois de authenticate. */
export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente ou inválido.'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'Você não tem permissão para acessar este recurso.'));
      return;
    }

    next();
  };
}
