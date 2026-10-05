import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import type { SignedToken } from '../../utils/token.util';
import { authService } from './auth.service';
import { forgotPasswordSchema } from './dtos/forgot-password.dto';
import { loginSchema } from './dtos/login.dto';
import { registerSchema } from './dtos/register.dto';
import { resetPasswordSchema } from './dtos/reset-password.dto';

const REFRESH_COOKIE = 'refreshToken';

// Path restrito: o navegador só envia o cookie às rotas de auth.
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
};

function setRefreshCookie(res: Response, refreshToken: SignedToken): void {
  res.cookie(REFRESH_COOKIE, refreshToken.token, {
    ...refreshCookieOptions,
    maxAge: refreshToken.expiresAt.getTime() - Date.now(),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const dto = registerSchema.parse(req.body);
    const user = await authService.register(dto);

    res.status(201).json({
      user,
      message: 'Cadastro realizado. Verifique seu e-mail para ativar a conta.',
    });
  },

  async login(req: Request, res: Response): Promise<void> {
    const dto = loginSchema.parse(req.body);
    const { accessToken, refreshToken, user } = await authService.login(dto, req.ip ?? 'unknown');

    setRefreshCookie(res, refreshToken);
    res.status(200).json({ accessToken, user });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const { accessToken, refreshToken } = await authService.refresh(readRefreshCookie(req));

      setRefreshCookie(res, refreshToken);
      res.status(200).json({ accessToken });
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(readRefreshCookie(req));

    clearRefreshCookie(res);
    res.status(204).end();
  },

  async forgotPassword(req: Request, res: Response): Promise<void> {
    const dto = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(dto.email);

    // Mesma resposta exista ou não a conta.
    res.status(200).json({
      message: 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.',
    });
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    const dto = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(dto);

    res.status(200).json({ message: 'Senha redefinida com sucesso.' });
  },

  async verifyEmail(req: Request, res: Response): Promise<void> {
    await authService.verifyEmail(String(req.params.token));

    res.status(200).json({ message: 'E-mail verificado com sucesso.' });
  },

  async me(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente ou inválido.');
    res.status(200).json(await authService.me(req.user.id));
  },
};
