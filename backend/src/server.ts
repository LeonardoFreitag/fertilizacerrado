import { env } from './config/env';
import { prisma } from './config/database';
import { closeRedis } from './config/redis';
import { app } from './app';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(env.PORT, () => {
  console.log(`API ouvindo na porta ${env.PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} recebido, encerrando...`);

  // Evita que conexões presas segurem o processo indefinidamente.
  setTimeout(() => {
    console.error('Encerramento excedeu o tempo limite, forçando saída.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Para de aceitar conexões e aguarda as requisições em andamento.
  server.close(async (closeError) => {
    try {
      await prisma.$disconnect();
      await closeRedis();
    } catch (disconnectError) {
      console.error('Erro ao desconectar do banco ou do Redis:', disconnectError);
      process.exit(1);
    }

    if (closeError) {
      console.error('Erro ao fechar o servidor HTTP:', closeError);
      process.exit(1);
    }

    console.log('Encerrado com sucesso.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
