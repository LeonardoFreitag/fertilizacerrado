import nodemailer from 'nodemailer';
import { env } from '../config/env';

const smtpConfigured = Boolean(env.SMTP_HOST);

// Sem SMTP_HOST (permitido fora de produção) o e-mail não é enviado:
// o conteúdo vai para o log, o que mantém os links acessíveis em desenvolvimento.
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : nodemailer.createTransport({ jsonTransport: true });

async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text });

  if (!smtpConfigured) {
    console.log(`[mailer] SMTP não configurado; e-mail não enviado.\nPara: ${to}\nAssunto: ${subject}\n${text}`);
  }
}

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${env.APP_URL}/api/v1/auth/verify-email/${token}`;
  await sendMail(
    to,
    'Confirme seu e-mail — FertilizaCerrado',
    `Olá, ${name}.\n\nConfirme seu e-mail acessando o link abaixo (válido por 24 horas):\n${link}\n\nSe você não criou uma conta, ignore esta mensagem.`,
  );
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendMail(
    to,
    'Recuperação de senha — FertilizaCerrado',
    `Olá, ${name}.\n\nPara redefinir sua senha, acesse o link abaixo (válido por 1 hora):\n${link}\n\nSe você não solicitou a recuperação, ignore esta mensagem.`,
  );
}
