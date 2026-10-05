import bcrypt from 'bcrypt';
import type { Role, User } from '@prisma/client';
import { AppError } from '../../utils/app-error';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../utils/mailer';
import {
  generateRandomToken,
  sha256,
  signAccessToken,
  signEmailVerificationToken,
  signRefreshToken,
  verifyEmailVerificationToken,
  verifyRefreshToken,
  type SignedToken,
} from '../../utils/token.util';
import { authRepository } from './auth.repository';
import type { LoginDto } from './dtos/login.dto';
import type { RegisterDto } from './dtos/register.dto';
import type { ResetPasswordDto } from './dtos/reset-password.dto';
import { getLoginBlockSeconds, registerLoginFailure } from './login-rate-limit';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Comparado quando o e-mail não existe, para que o tempo de resposta do login
// não revele se a conta existe.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('senha-inexistente', BCRYPT_ROUNDS);

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  refreshToken: SignedToken;
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function invalidRefreshToken(): AppError {
  return new AppError(401, 'INVALID_REFRESH_TOKEN', 'Sessão inválida ou expirada.');
}

function invalidToken(): AppError {
  return new AppError(400, 'INVALID_TOKEN', 'Token inválido ou expirado.');
}

function issueSession(user: User): Session {
  return {
    accessToken: signAccessToken({ id: user.id, role: user.role }),
    refreshToken: signRefreshToken(user.id),
  };
}

export const authService = {
  async register(dto: RegisterDto): Promise<PublicUser> {
    const conflict = await authRepository.findConflict(dto.email, dto.cpf, dto.cnpj);
    if (conflict) {
      if (conflict.email === dto.email) {
        throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado.');
      }
      if (dto.cpf && conflict.cpf === dto.cpf) {
        throw new AppError(409, 'CPF_ALREADY_REGISTERED', 'CPF já cadastrado.');
      }
      throw new AppError(409, 'CNPJ_ALREADY_REGISTERED', 'CNPJ já cadastrado.');
    }

    const user = await authRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      role: dto.role,
      cpf: dto.cpf,
      cnpj: dto.cnpj,
      crea: dto.crea,
      phone: dto.phone,
    });

    // Uma falha de envio não desfaz o cadastro; o usuário ainda pode
    // confirmar o e-mail pelo fluxo de recuperação de senha.
    try {
      await sendVerificationEmail(user.email, user.name, signEmailVerificationToken(user.id));
    } catch (error) {
      console.error('[auth] Falha ao enviar e-mail de verificação:', error);
    }

    return toPublicUser(user);
  },

  async verifyEmail(token: string): Promise<void> {
    const userId = verifyEmailVerificationToken(token);
    const user = userId ? await authRepository.findById(userId) : null;
    if (!user) throw invalidToken();

    if (!user.emailVerified) {
      await authRepository.markEmailVerified(user.id);
    }
  },

  async login(dto: LoginDto, ip: string): Promise<Session & { user: PublicUser }> {
    const blockedFor = await getLoginBlockSeconds(ip);
    if (blockedFor > 0) {
      throw new AppError(
        429,
        'TOO_MANY_LOGIN_ATTEMPTS',
        'Muitas tentativas de login. Tente novamente mais tarde.',
        { 'Retry-After': String(blockedFor) },
      );
    }

    const user = await authRepository.findByEmail(dto.email);
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      await registerLoginFailure(ip);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }

    if (!user.emailVerified) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirme seu e-mail antes de entrar.');
    }

    const session = issueSession(user);
    await authRepository.setRefreshToken(user.id, sha256(session.refreshToken.token));

    return { ...session, user: toPublicUser(user) };
  },

  async refresh(refreshToken: string | undefined): Promise<Session> {
    const userId = refreshToken ? verifyRefreshToken(refreshToken) : null;
    const user = userId ? await authRepository.findById(userId) : null;
    if (!refreshToken || !user) throw invalidRefreshToken();

    const session = issueSession(user);
    const rotated = await authRepository.rotateRefreshToken(
      user.id,
      sha256(refreshToken),
      sha256(session.refreshToken.token),
    );

    if (!rotated) {
      // Token com assinatura válida que não é o vigente: reuso de um token já
      // rotacionado (possível roubo). Revoga a sessão inteira.
      await authRepository.setRefreshToken(user.id, null);
      throw invalidRefreshToken();
    }

    return session;
  },

  async logout(refreshToken: string | undefined): Promise<void> {
    const userId = refreshToken ? verifyRefreshToken(refreshToken) : null;
    if (!refreshToken || !userId) return;

    await authRepository.clearRefreshTokenIfMatches(userId, sha256(refreshToken));
  },

  async forgotPassword(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    if (!user) return;

    const token = generateRandomToken();
    await authRepository.setResetToken(
      user.id,
      sha256(token),
      new Date(Date.now() + RESET_TOKEN_TTL_MS),
    );

    try {
      await sendPasswordResetEmail(user.email, user.name, token);
    } catch (error) {
      console.error('[auth] Falha ao enviar e-mail de recuperação:', error);
    }
  },

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);

    const user = await authRepository.findByValidResetToken(tokenHash);
    if (!user) throw invalidToken();

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const done = await authRepository.resetPassword(user.id, tokenHash, passwordHash);
    if (!done) throw invalidToken();
  },
};
