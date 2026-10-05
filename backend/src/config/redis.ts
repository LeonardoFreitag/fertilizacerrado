import Redis from 'ioredis';
import { env } from './env';

// lazyConnect: a conexão só é aberta no primeiro comando.
// maxRetriesPerRequest baixo faz os comandos falharem rápido quando o Redis
// está fora do ar, em vez de ficarem enfileirados.
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
});

// Sem listener, o ioredis emite 'error' não tratado a cada tentativa de reconexão.
redis.on('error', (error) => {
  console.error(`[redis] ${error.message}`);
});

export async function closeRedis(): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
}
