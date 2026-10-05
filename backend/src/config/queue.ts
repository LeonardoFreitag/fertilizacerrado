/**
 * Conexões e filas BullMQ. Separadas do cliente Redis do limite de login
 * (`redis.ts`): o BullMQ exige `maxRetriesPerRequest: null`, enquanto o limite
 * de login precisa falhar rápido para falhar aberto.
 */
import { FlowProducer, Queue, type ConnectionOptions } from 'bullmq';
import { env } from './env';

export const QUEUES = {
  ingest: 'era5-ingest',
  process: 'msa-process',
  weekly: 'msa-weekly',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUES);

/**
 * Opções (não instância) para o BullMQ abrir as próprias conexões com o seu
 * ioredis — evita conflito de versão com o ioredis da aplicação e dá ao worker
 * a conexão bloqueante dedicada que ele exige.
 */
export function queueConnectionOptions(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

const queues = new Map<QueueName, Queue>();
let flowProducer: FlowProducer | undefined;

/** Produtor (API e worker enfileiram por aqui); criado sob demanda. */
export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: queueConnectionOptions() });
    queue.on('error', (error) => console.error(`[queue:${name}] ${error.message}`));
    queues.set(name, queue);
  }
  return queue;
}

export function getFlowProducer(): FlowProducer {
  flowProducer ??= new FlowProducer({ connection: queueConnectionOptions() });
  return flowProducer;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await flowProducer?.close();
  flowProducer = undefined;
}
