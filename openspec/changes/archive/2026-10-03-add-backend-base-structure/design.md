## Context

O FertilizaCerrado ainda não tem código: o repositório contém `CLAUDE.md` (infraestrutura já validada em outro projeto, a ser replicada), `docs/arquitetura.md` (visão macro e estrutura de pastas) e a documentação dos módulos. Esta change cria a fundação sobre a qual a Fase 0 (Auth, Usuários, Propriedades) será construída.

Restrições herdadas de `CLAUDE.md`, tratadas como requisitos e não como sugestões:

- pnpm exclusivamente (`pnpm@9.15.4`, node >=20).
- Dockerfile multi-stage `node:20-alpine`, tini, usuário não-root, healthcheck em `/health`.
- Compose de dev com `db`, `redis`, `api`, `nginx`, `adminer`; compose de produção com ECR, 2 réplicas e redes segregadas.
- Nginx dev simples e Nginx prod com TLS, rate limiting e `least_conn`.
- Express com `trust proxy`, graceful shutdown e validação de ambiente via Zod.

## Goals / Non-Goals

**Goals:**

- `docker compose up` na raiz sobe a stack completa de desenvolvimento, com hot-reload da API e `GET /health` respondendo 200.
- `docker build backend/` produz uma imagem de produção executável como usuário não-root.
- Configuração inválida falha no startup, com mensagem que aponta as variáveis problemáticas.
- Estrutura de pastas pronta para receber `src/modules/*`, `src/middleware/` e `src/utils/` sem reorganização.

**Non-Goals:**

- Qualquer módulo de domínio, rota de negócio, model ou migration do Prisma.
- PostGIS e TimescaleDB (ver Open Questions).
- BullMQ, workers, pipeline ETL Python, frontend.
- Terraform, Kubernetes, CI/CD, emissão de certificados (certbot).
- Framework de testes automatizados, lint e formatação — entram em change própria.
- Middlewares de segurança da aplicação (helmet, CORS, rate limit em nível de app) — entram com o módulo de Auth.

## Decisions

### 1. Layout: backend isolado, orquestração na raiz

`package.json`, `tsconfig.json`, `.npmrc`, `.dockerignore`, `Dockerfile`, `prisma/` e `scripts/` ficam em `backend/`. `docker-compose*.yml`, `nginx/` e `.env.example` ficam na raiz. É o layout de `CLAUDE.md` e `docs/arquitetura.md`, e mantém o contexto de build do Docker restrito a `backend/`.

Sem pnpm workspace por enquanto: só existe um pacote. Quando o `frontend/` chegar, avalia-se a conversão.

### 2. Separação `app.ts` / `server.ts`

`app.ts` exporta a instância do Express configurada, sem abrir porta. `server.ts` importa `env`, chama `listen` e registra os handlers de sinal. Isso permite testar a aplicação (supertest, futuramente) sem subir servidor nem tocar em sinais do processo.

Ordem em `app.ts`: `trust proxy = 1` → `express.json()` → `GET /health` → fallback 404 JSON → error handler JSON. Os routers de `/api/v1/*` serão montados entre o health e o 404 pelas changes seguintes.

### 3. `/health` é liveness, sem consultar o banco

Retorna `200` com `{ status, uptime, timestamp }` sem tocar em Postgres ou Redis. O endpoint é usado pelo `HEALTHCHECK` do Docker e pelo Nginx; se dependesse do banco, uma indisponibilidade do Postgres derrubaria e reiniciaria em loop todas as réplicas da API, piorando a recuperação.

Alternativa considerada: checar `SELECT 1` no health. Descartada aqui; um `/ready` separado pode ser adicionado quando houver consumidor (ALB/ECS na Fase 2 de escala).

O endpoint fica em `/health` na raiz, não sob `/api/`, porque é o caminho fixado no `HEALTHCHECK` do Dockerfile e no `location /health` do Nginx de produção.

### 4. Variáveis de ambiente: duas camadas

O `.env.example` mistura variáveis consumidas pelo Docker Compose com variáveis consumidas pela aplicação. A divisão adotada:

| Grupo | Variáveis | Quem consome | No schema Zod |
|---|---|---|---|
| Banco / Redis (partes) | `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_PASSWORD` | Compose (configura os containers e monta as URLs) | Não |
| Conexões | `DATABASE_URL`, `REDIS_URL` | Aplicação (Prisma, BullMQ futuro) | Sim, obrigatórias |
| JWT | `JWT_SECRET`, `JWT_REFRESH_SECRET` (mín. 32 chars), `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Aplicação | Sim |
| App | `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL` | Aplicação | Sim, com defaults |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Aplicação | Sim; `HOST`/`USER`/`PASS` obrigatórias só em `production` |
| AWS | `AWS_REGION`, `ECR_REGISTRY`, `ECR_REPOSITORY`, `IMAGE_TAG` | Compose de produção / deploy | Não |

O Compose monta `DATABASE_URL` e `REDIS_URL` a partir das partes e injeta no container `api`. As duas URLs também são adicionadas ao `.env.example` (comentadas como "uso fora do Docker") para que `pnpm dev` e o Prisma CLI funcionem no host.

Por que não validar `DB_USER` etc. na aplicação: ela nunca os lê; exigir variáveis que o processo não usa só cria falhas de startup sem ganho. Por que SMTP opcional em desenvolvimento: nenhum módulo envia e-mail ainda, e obrigar credenciais SMTP bloquearia o primeiro `docker compose up`.

`env.ts` usa `safeParse`; em falha, imprime os erros por campo (`flatten().fieldErrors`) em `console.error` e chama `process.exit(1)`. Exporta um objeto `env` tipado — nenhum outro arquivo lê `process.env` diretamente. `dotenv` é carregado no topo de `env.ts` para execução fora do Docker.

### 5. Prisma mínimo já nesta change

O Dockerfile exige `pnpm prisma generate` e o comando da API no Compose roda `prisma migrate deploy`; ambos falham sem `prisma/schema.prisma`. Além disso, "desconectar o banco antes de encerrar" precisa de um cliente. Portanto a change inclui:

- `prisma/schema.prisma` com `datasource` (postgresql, `env("DATABASE_URL")`) e `generator client`, sem models.
- `src/config/database.ts` exportando um `PrismaClient` único.

O Prisma 5 recusa `prisma generate` em schema sem models, então o Dockerfile e o script `prisma:generate` usam `--allow-no-models`; a flag pode ser removida quando o primeiro model for criado. `migrate deploy` sem migrations é no-op e termina com sucesso. O Prisma conecta de forma lazy, então a API sobe mesmo sem models. Versão: Prisma 5, conforme `docs/arquitetura.md`.

### 6. Graceful shutdown

Um único handler para `SIGTERM` e `SIGINT`:

1. Guarda de reentrada (segundo sinal é ignorado).
2. `server.close()` — para de aceitar conexões e aguarda as requisições em andamento.
3. `prisma.$disconnect()`.
4. `process.exit(0)`.

Um timer de segurança de 10 s (`unref`) força `process.exit(1)` se o fechamento travar em conexões keep-alive. Como o `stop_grace_period` padrão do Docker também é de 10 s, os dois arquivos Compose definem `stop_grace_period: 15s` no serviço `api`, para que o timer da aplicação dispare antes do `SIGKILL` do Docker. O tini (PID 1) garante que o sinal chegue ao Node.

### 7. Dockerfile conforme `CLAUDE.md`, inclusive `node_modules` completo no estágio final

Segue-se a receita validada: o estágio de produção copia `node_modules/` do builder, o que inclui devDependencies. Isso infla a imagem, mas mantém o Prisma CLI disponível para `migrate deploy` em produção e evita problemas de hoisting do pnpm com o engine do Prisma.

Alternativa considerada: `pnpm prune --prod` ou `pnpm deploy`. Fica como otimização futura, fora desta change.

`corepack prepare pnpm@latest --activate` é mantido como especificado; a versão efetiva é a de `packageManager` (`9.15.4`), que o corepack respeita dentro do diretório do projeto.

O `.dockerignore` exclui `node_modules`, `dist`, `.env*`, `.git` e arquivos de log.

### 8. Compose de desenvolvimento

- `api`: `build.target: builder`, `src/` e `prisma/` montados `:ro`, comando `pnpm prisma migrate deploy && pnpm exec ts-node-dev --respawn --transpile-only src/server.ts`, `depends_on` de `db` e `redis` com `condition: service_healthy`. Porta 3000 exposta para acesso direto.
- `db`: `postgres:15-alpine`, `init.sql` montado em `/docker-entrypoint-initdb.d/`, healthcheck `pg_isready`, volume `postgres_data`.
- `redis`: `redis:7-alpine` com `--requirepass`, `--maxmemory 256mb`, `--maxmemory-policy allkeys-lru`, healthcheck `redis-cli ping` autenticado, volume `redis_data`.
- `nginx`: `nginx:1.25-alpine`, porta 80, `nginx.dev.conf` montado `:ro`.
- `adminer`: `adminer:4-standalone`, porta 8080.

Como `prisma/` é readonly no container, migrations futuras são criadas no host (`pnpm prisma migrate dev`) e aplicadas no container no próximo start.

### 9. Compose de produção

Segue `CLAUDE.md`: imagem `${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG:-latest}`, `deploy.replicas: 2`, `update_config` com `order: start-first` e `parallelism: 1`, limites de 0.75 CPU / 512M, logging `json-file` com `max-size: 10m`. `db` e `redis` sem portas publicadas, `restart: always`, com resource limits.

Redes: `backend_net` (`internal: true`) contém `db`, `redis` e `api`; `frontend_net` contém `nginx` e `api`. A API é o único serviço nas duas redes; o Nginx não alcança o banco.

O serviço `api` não define `container_name` nem publica portas, para permitir `--scale api=N`; o Nginx resolve `api:3000` pelo DNS interno do Docker.

### 10. Nginx

`nginx.dev.conf`: `upstream api_upstream { server api:3000; }`, `location /api/` com os headers `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, e `location /nginx-health` retornando `200 "OK"`.

`nginx.prod.conf`: integralmente conforme a especificação de `CLAUDE.md` (workers, epoll, gzip, três zonas de rate limit, `least_conn` com keepalive, redirect 80→443 preservando o desafio ACME, TLS 1.2/1.3, HSTS, headers de segurança e as quatro locations). Como locations de regex têm precedência sobre a de prefixo `/api/`, auth e upload recebem suas zonas específicas sem ordem especial além de declarar auth e upload antes.

Os caminhos de certificado apontam para um volume montado (`/etc/nginx/ssl/fullchain.pem` e `privkey.pem`); `server_name` fica como placeholder a ser ajustado no primeiro deploy.

### 11. Versões de biblioteca

Express 5 (versão corrente, com tratamento nativo de erros em handlers async), Zod 3, Prisma 5, TypeScript 5 com `strict: true`, `module`/`moduleResolution` CommonJS/Node (compatível com `ts-node-dev --transpile-only` e com `node dist/server.js` sem flags). `rootDir: src`, `outDir: dist`.

Scripts do `package.json`: `dev`, `build` (`tsc`), `start` (`node dist/server.js`), `typecheck` (`tsc --noEmit`), `prisma:generate`, `prisma:migrate`.

## Risks / Trade-offs

- **[`deploy.*` só é integralmente honrado em Swarm]** → Com `docker compose up` simples (Fase 1 de escala), `replicas` e `resources.limits` são aplicados pelo Compose v2, mas `update_config` (rolling update `start-first`) é ignorado. O arquivo fica correto para Swarm; o zero-downtime real na EC2 única depende de `docker stack deploy` ou de procedimento manual. Documentado em comentário no arquivo.
- **[Nginx de produção não sobe sem certificados]** → Os blocos `ssl_certificate` exigem os arquivos no volume. Mitigação: comentário no topo do `nginx.prod.conf` e no compose indicando o pré-requisito; emissão via certbot fica para a change de deploy.
- **[`postgres:15-alpine` não tem PostGIS nem TimescaleDB]** → A arquitetura exige ambos a partir do módulo de Propriedades. Trocar a imagem depois implica recriar o volume de dev (sem impacto, pois não há dados). Ver Open Questions.
- **[Imagem de produção com devDependencies]** → Imagem maior e superfície de ataque maior. Aceito por fidelidade à receita validada; otimização registrada como trabalho futuro.
- **[`/health` não detecta banco fora do ar]** → Intencional (Decisão 3). Falhas de banco aparecerão como erros 5xx nas rotas de negócio, não como container unhealthy.
- **[Sem testes automatizados nesta change]** → A verificação é manual (typecheck, build da imagem, `docker compose up`, `curl`). Mitigação: a separação `app.ts`/`server.ts` já deixa o código testável para a change que introduzir o framework de testes.
- **[`init.sql` só roda em volume vazio]** → Quem já tiver o volume `postgres_data` criado precisa de `docker compose down -v` para reaplicar. Irrelevante agora (projeto novo), relevante quando o script mudar.

## Migration Plan

Projeto greenfield — não há migração. Primeiro uso: copiar `.env.example` para `.env`, preencher segredos, `docker compose up --build`. Rollback: remover os arquivos criados e `docker compose down -v`.

## Open Questions

- **Imagem do banco**: quando o módulo de Propriedades (PostGIS) e o MSA (TimescaleDB) chegarem, a imagem `postgres:15-alpine` precisará ser substituída (ex.: `timescale/timescaledb-ha:pg15`, que inclui PostGIS). Esta change segue `CLAUDE.md`; a troca deve ser decidida na change do módulo de Propriedades.
- **Domínio de produção**: `server_name` e `SMTP_FROM` reais ainda não estão definidos; ficam como placeholders.
