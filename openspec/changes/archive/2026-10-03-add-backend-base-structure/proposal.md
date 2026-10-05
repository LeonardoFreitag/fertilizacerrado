## Why

O repositório contém apenas documentação (`docs/`, `CLAUDE.md`) — não existe nenhum código executável. Os módulos da Fase 0 (Auth, Usuários, Propriedades e Talhões) e o MSA da Fase 1 dependem de um backend Node.js + TypeScript que suba localmente com banco, Redis e proxy, e que já nasça com o caminho de produção definido. Esta change entrega essa fundação seguindo a infraestrutura já validada em `CLAUDE.md` e a estrutura de pastas de `docs/arquitetura.md`.

## What Changes

- Novo pacote `backend/` gerenciado exclusivamente por pnpm: `package.json` (`packageManager: pnpm@9.15.4`, `engines` node >=20 / pnpm >=9), `tsconfig.json`, `.npmrc` (`engine-strict` + hoist patterns de Prisma e ts-node), `.dockerignore`.
- Aplicação Express mínima: `src/app.ts` (`trust proxy`, parser JSON, `GET /health`, 404 em JSON) e `src/server.ts` (bootstrap + graceful shutdown em `SIGTERM`/`SIGINT`, desconectando o banco antes de encerrar).
- `src/config/env.ts`: validação das variáveis de ambiente com Zod, encerrando o processo com `process.exit(1)` quando inválidas.
- `prisma/schema.prisma` mínimo (datasource + generator, sem models) e cliente Prisma compartilhado — necessários para o `prisma generate` do build e para o shutdown desconectar o banco.
- `backend/Dockerfile` multi-stage (builder + production) com tini, usuário não-root e `HEALTHCHECK`.
- `docker-compose.yml` de desenvolvimento com `db`, `redis`, `api` (hot-reload), `nginx` e `adminer`.
- `docker-compose.prod.yml` com imagem do ECR, 2 réplicas, rolling update `start-first`, resource limits e duas redes (`backend_net` interna, `frontend_net`).
- `nginx/nginx.dev.conf` (proxy reverso simples) e `nginx/nginx.prod.conf` (TLS, rate limiting em 3 zonas, `least_conn`, headers de segurança).
- `backend/scripts/init.sql` com as extensões `pgcrypto` e `uuid-ossp` e timezone `America/Sao_Paulo`.
- `.env.example` na raiz com todas as variáveis de banco, Redis, JWT, app, SMTP e AWS.

Fora do escopo: módulos de domínio (auth, usuários, propriedades, MSA), models e migrations do Prisma, PostGIS/TimescaleDB, BullMQ, pipeline ETL Python, frontend, Terraform/Kubernetes e CI/CD.

## Capabilities

### New Capabilities
- `backend-runtime`: projeto Node.js + TypeScript do backend — tooling pnpm, validação de ambiente, aplicação Express com health check e ciclo de vida do servidor (startup e graceful shutdown).
- `container-infrastructure`: imagem Docker do backend, stacks Docker Compose de desenvolvimento e produção, inicialização do PostgreSQL e contrato de variáveis de ambiente (`.env.example`).
- `reverse-proxy`: configurações Nginx de desenvolvimento e produção — roteamento para a API, TLS, rate limiting, balanceamento e headers de segurança.

### Modified Capabilities

Nenhuma — `openspec/specs/` está vazio.

## Impact

- **Código**: cria `backend/`, `nginx/`, `docker-compose.yml`, `docker-compose.prod.yml` e `.env.example`. Nada existente é alterado.
- **API**: introduz `GET /health`. O prefixo `/api/` fica reservado no Nginx para os módulos futuros.
- **Dependências**: `express`, `zod`, `@prisma/client`, `dotenv`; dev: `typescript`, `prisma`, `ts-node`, `ts-node-dev`, `@types/node`, `@types/express`.
- **Sistemas**: exige Docker + Docker Compose localmente; portas 80, 3000, 5432, 6379 e 8080 no host em desenvolvimento. Produção exige imagem publicada no ECR e certificados TLS montados no Nginx.
