import { redis } from '../../config/redis';

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;

function key(ip: string): string {
  return `auth:login:fail:${ip}`;
}

/**
 * Segundos restantes de bloqueio para o IP, ou 0 se ele pode tentar.
 * Falha aberta: com o Redis indisponível o login não é bloqueado
 * (em produção o rate limit do Nginx continua valendo).
 */
export async function getLoginBlockSeconds(ip: string): Promise<number> {
  try {
    const attempts = Number(await redis.get(key(ip)));
    if (attempts < MAX_FAILED_ATTEMPTS) return 0;

    const ttl = await redis.ttl(key(ip));
    return ttl > 0 ? ttl : WINDOW_SECONDS;
  } catch (error) {
    console.error('[auth] Limite de login indisponível (Redis):', (error as Error).message);
    return 0;
  }
}

const RESEND_MAX_PER_HOUR = 3;
const RESEND_WINDOW_SECONDS = 60 * 60;

/**
 * Reenvio de verificação: no máximo 3 pedidos por hora por e-mail. Devolve os
 * segundos de espera (0 = permitido) e já conta o pedido. Falha aberta sem Redis.
 */
export async function takeResendVerificationSlot(email: string): Promise<number> {
  const k = `auth:resend-verify:${email.toLowerCase()}`;
  try {
    const [[, count]] = (await redis.multi().incr(k).expire(k, RESEND_WINDOW_SECONDS, 'NX').exec()) as [[null, number], unknown];
    if (Number(count) <= RESEND_MAX_PER_HOUR) return 0;
    const ttl = await redis.ttl(k);
    return ttl > 0 ? ttl : RESEND_WINDOW_SECONDS;
  } catch (error) {
    console.error('[auth] Limite de reenvio indisponível (Redis):', (error as Error).message);
    return 0;
  }
}

/** Registra uma falha de credencial. A janela começa na primeira falha. */
export async function registerLoginFailure(ip: string): Promise<void> {
  try {
    await redis.multi().incr(key(ip)).expire(key(ip), WINDOW_SECONDS, 'NX').exec();
  } catch (error) {
    console.error('[auth] Limite de login indisponível (Redis):', (error as Error).message);
  }
}
