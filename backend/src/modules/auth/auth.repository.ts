import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/database';

export const authRepository = {
  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  /** Primeiro usuário que já usa o e-mail ou algum dos documentos informados. */
  findConflict(email: string, cpf?: string, cnpj?: string): Promise<User | null> {
    const conditions: Prisma.UserWhereInput[] = [{ email }];
    if (cpf) conditions.push({ cpf });
    if (cnpj) conditions.push({ cnpj });

    return prisma.user.findFirst({ where: { OR: conditions } });
  },

  findByValidResetToken(tokenHash: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { resetToken: tokenHash, resetTokenExpiresAt: { gt: new Date() } },
    });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  async markEmailVerified(id: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
  },

  async setRefreshToken(id: string, tokenHash: string | null): Promise<void> {
    await prisma.user.update({ where: { id }, data: { refreshToken: tokenHash } });
  },

  /**
   * Troca o hash do refresh token apenas se o atual ainda for o esperado.
   * A condição no próprio UPDATE garante que, entre requisições simultâneas
   * com o mesmo token, no máximo uma tenha sucesso.
   */
  async rotateRefreshToken(id: string, currentHash: string, newHash: string): Promise<boolean> {
    const { count } = await prisma.user.updateMany({
      where: { id, refreshToken: currentHash },
      data: { refreshToken: newHash },
    });
    return count === 1;
  },

  async clearRefreshTokenIfMatches(id: string, tokenHash: string): Promise<void> {
    await prisma.user.updateMany({
      where: { id, refreshToken: tokenHash },
      data: { refreshToken: null },
    });
  },

  async setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { resetToken: tokenHash, resetTokenExpiresAt: expiresAt },
    });
  },

  /**
   * Consome o token de recuperação e grava a nova senha em um único UPDATE,
   * o que garante o uso único mesmo com requisições simultâneas.
   * Também encerra a sessão ativa e marca o e-mail como verificado, já que
   * concluir o reset prova a posse da caixa de e-mail.
   */
  async resetPassword(id: string, tokenHash: string, passwordHash: string): Promise<boolean> {
    const now = new Date();

    const { count } = await prisma.user.updateMany({
      where: { id, resetToken: tokenHash, resetTokenExpiresAt: { gt: now } },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        refreshToken: null,
        emailVerified: true,
      },
    });
    if (count !== 1) return false;

    // Preenche a data apenas para quem ainda não tinha verificado.
    await prisma.user.updateMany({
      where: { id, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    return true;
  },
};
