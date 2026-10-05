## 1. Projeto backend (pnpm + TypeScript)

- [x] 1.1 Criar `backend/package.json` com `packageManager: pnpm@9.15.4`, `engines` (node >=20.0.0, pnpm >=9.0.0) e scripts `dev`, `build`, `start`, `typecheck`, `prisma:generate`, `prisma:migrate`
- [x] 1.2 Criar `backend/.npmrc` com `engine-strict=true` e os hoist patterns `*prisma*` e `*ts-node*`
- [x] 1.3 Criar `backend/tsconfig.json` (`strict`, CommonJS, `rootDir: src`, `outDir: dist`)
- [x] 1.4 Instalar dependências com pnpm: `express`, `zod`, `@prisma/client`, `dotenv`; dev: `typescript`, `prisma`, `ts-node`, `ts-node-dev`, `@types/node`, `@types/express` — gerando `pnpm-lock.yaml`
- [x] 1.5 Criar a estrutura de pastas de `docs/arquitetura.md`: `src/config/`, `src/modules/`, `src/middleware/`, `src/utils/` (com `.gitkeep` nas vazias)

## 2. Configuração e banco

- [x] 2.1 Criar `backend/prisma/schema.prisma` mínimo (datasource postgresql com `env("DATABASE_URL")` + generator client, sem models)
- [x] 2.2 Implementar `src/config/env.ts`: schema Zod com todas as variáveis da aplicação, defaults, mínimo de 32 caracteres nos segredos JWT, SMTP obrigatório só em `production`, `safeParse` com erro por campo no stderr e `process.exit(1)`
- [x] 2.3 Implementar `src/config/database.ts` exportando um `PrismaClient` único

## 3. Aplicação e servidor

- [x] 3.1 Implementar `src/app.ts`: `trust proxy = 1`, `express.json()`, `GET /health` (`status`, `uptime`, `timestamp`, sem acesso ao banco), fallback 404 JSON e error handler JSON
- [x] 3.2 Implementar `src/server.ts`: `listen` em `env.PORT` e graceful shutdown para `SIGTERM`/`SIGINT` (guarda de reentrada, `server.close`, `prisma.$disconnect`, `exit(0)`, timeout de 10 s com `exit(1)`)
- [x] 3.3 Verificar `pnpm typecheck` e `pnpm build` sem erros e a existência de `dist/server.js`

## 4. Variáveis de ambiente e init do banco

- [x] 4.1 Criar `.env.example` na raiz com os grupos Banco, Redis, JWT, App, SMTP e AWS de `CLAUDE.md`, acrescido de `DATABASE_URL` e `REDIS_URL` para uso fora do Docker
- [x] 4.2 Criar `backend/scripts/init.sql` com `CREATE EXTENSION IF NOT EXISTS` para `pgcrypto` e `uuid-ossp` e timezone `America/Sao_Paulo`

## 5. Imagem Docker

- [x] 5.1 Criar `backend/.dockerignore` (`node_modules`, `dist`, `.env*`, `.git`, logs)
- [x] 5.2 Criar `backend/Dockerfile` estágio `builder`: `node:20-alpine`, `python3 make g++ openssl`, corepack/pnpm, cópia de `package.json` + `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`, `pnpm prisma generate`, `pnpm build`
- [x] 5.3 Criar estágio `production`: `openssl tini`, corepack/pnpm, cópia dos artefatos do builder, `appgroup`/`appuser`, `EXPOSE 3000`, `HEALTHCHECK` com `wget` em `/health`, `ENTRYPOINT` tini, `CMD ["node", "dist/server.js"]`
- [x] 5.4 Verificar `docker build backend/` e que o container roda como `appuser`

## 6. Nginx

- [x] 6.1 Criar `nginx/nginx.dev.conf`: upstream `api:3000`, `location /api/` com headers de proxy, `location /nginx-health`
- [x] 6.2 Criar `nginx/nginx.prod.conf` — bloco global e `http`: workers, epoll, gzip, `client_max_body_size 20m`, três zonas de rate limit, upstream `least_conn` com keepalive
- [x] 6.3 Adicionar ao `nginx.prod.conf` o server da porta 80 (redirect HTTPS + exceção ACME) e o server 443 (TLS 1.2/1.3, HSTS, headers de segurança, locations `/health`, auth, upload e `/api/`)
- [x] 6.4 Validar a sintaxe dos dois arquivos com `nginx -t` em container `nginx:1.25-alpine` (certificado autoassinado temporário para o de produção)

## 7. Docker Compose

- [x] 7.1 Criar `docker-compose.yml` com `db`, `redis`, `api`, `nginx`, `adminer`, healthchecks, volumes `postgres_data`/`redis_data`, montagem do `init.sql`, injeção de `DATABASE_URL`/`REDIS_URL` na `api` e `stop_grace_period: 15s`
- [x] 7.2 Criar `docker-compose.prod.yml` com imagem do ECR, `deploy` (réplicas, rolling update, limits), logging, `stop_grace_period`, nginx 80/443 com volumes de logs e SSL, e redes `backend_net` (internal) e `frontend_net`
- [x] 7.3 Validar ambos com `docker compose config` (dev e `-f docker-compose.prod.yml`)

## 8. Verificação de ponta a ponta

- [x] 8.1 Copiar `.env.example` para `.env`, preencher e executar `docker compose up --build`; confirmar todos os serviços `healthy`
- [x] 8.2 Confirmar `GET http://localhost:3000/health` → 200, `GET http://localhost/nginx-health` → 200 `OK` e rota inexistente → 404 JSON
- [x] 8.3 Confirmar hot-reload editando um arquivo em `backend/src/`
- [x] 8.4 Confirmar no banco as extensões `pgcrypto` e `uuid-ossp` e `SHOW timezone` = `America/Sao_Paulo`
- [x] 8.5 Confirmar falha de startup com `JWT_SECRET` curto (exit 1 com mensagem) e graceful shutdown com `docker compose stop api` (exit 0)
