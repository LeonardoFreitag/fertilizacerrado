## Context

Três entregas independentes agrupadas por conveniência de ciclo. Estado atual: nenhum workflow em `.github/`; o `README.md` da raiz não existe (há `package.json` com atalhos `docker compose`); nenhum backup; o banco é `timescale/timescaledb-ha:pg15` (PostgreSQL 15 + TimescaleDB + PostGIS), com hipertabelas `era5_daily_data` e `station_daily_obs`; o módulo `users` só tem `GET /users` (diretório de busca para o `UserPicker`); o `User` não tem `active`; o `authenticate` valida só o JWT (15 min), sem consulta ao banco; o refresh token é um hash único por usuário (`refreshToken`), então "revogar" é zerá-lo; o limite de login usa Redis com `INCR`/`EXPIRE`.

## Goals / Non-Goals

**Goals:**
- Cada push em `main` prova typecheck, lint, unitários (Node, Python) e build das três imagens, em poucos minutos, sem banco.
- Backup restaurável de verdade (TimescaleDB exige `pre/post_restore`), testado por roteiro; backup diário automático em produção.
- Administração completa de usuários com as proteções mínimas (último admin, autoedição restrita, inativo bloqueado) e reenvio de verificação sem vazar existência de contas.

**Non-Goals:**
- Playwright/e2e bash no CI; deploy automático; envio do backup para S3; rotação de segredos; auditoria de alterações de usuários (log); exclusão física de usuários; 2FA.

## Decisions

### 1. CI: quatro jobs paralelos, sem serviços
`backend`: `actions/setup-node@v4` (Node 20) + `corepack enable` + cache do store do pnpm (`actions/cache` com chave do `pnpm-lock.yaml`); `pnpm install --frozen-lockfile`, `pnpm prisma generate`, `pnpm typecheck`, `pnpm test`. O schema Zod de `env.ts` exige variáveis: o job define `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`/`JWT_REFRESH_SECRET` (≥ 32 caracteres, valores fictícios) e `NODE_ENV=test`; os unitários já mockam Prisma/Redis. `frontend`: install, `lint`, `typecheck`, `test`, `build`. `etl`: `actions/setup-python@v5` (3.12, `cache: pip`), `pip install -r requirements.txt`, `pytest` (o `addopts = -m "not integration"` do `pytest.ini` já exclui os de banco). `docker`: `docker/setup-buildx-action` + `docker/build-push-action` com `push: false` e `cache-from/to: type=gha` para `backend/`, `frontend/` e `backend/etl/`. `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`. Badge `![CI](https://github.com/LeonardoFreitag/fertilizacerrado/actions/workflows/ci.yml/badge.svg)` no README. Alternativa (um job sequencial) descartada: os quatro são independentes e paralelos terminam em ~3 min.

### 2. Backup: `pg_dump -Fc` + restore com TimescaleDB
`backup.sh`: `docker compose exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backups/fertilizacerrado_<AAAAMMDD-HHMMSS>.dump`, `ls -t | tail -n +N+1 | xargs rm` para reter N (`BACKUP_KEEP`, default 14). `restore.sh <arquivo>`: confirma pedindo o **nome do banco** digitado; `docker compose stop api worker etl`; `DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE`; no banco novo `CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE EXTENSION IF NOT EXISTS postgis; SELECT timescaledb_pre_restore();` → `pg_restore -U … -d … --no-owner --no-privileges` → `SELECT timescaledb_post_restore();` → `docker compose start api worker etl` (o `migrate deploy` da API encontra `_prisma_migrations` restaurada e não faz nada). Sem o par `pre/post_restore` o `pg_restore` de hipertabelas falha ou deixa catálogo inconsistente — por isso não usamos `--clean` sobre o banco vivo. Dump em `-Fc` porque comprime e permite restauração seletiva.
Produção: serviço `backup` com `postgres:15-alpine` (tem `pg_dump` 15 e `crond`), `command: crond -f -l 8` com um crontab montado (`30 3 * * *` em `TZ=America/Sao_Paulo`) chamando `backup-cron.sh`, que roda `pg_dump` via rede (`PGHOST=db`, `PGPASSWORD` do `.env`) para `/backups` (volume `db_backups`) e apaga arquivos mais velhos que `BACKUP_RETENTION_DAYS` (default 14, `find -mtime`). Só na `backend_net`. S3: Fase 2 (registrado em Open Questions).

### 3. `e2e-backup.sh` não usa `pnpm clean`
`docker compose down -v` apagaria `etl_cache` (16 meses de CDS, ~2 h para refazer), `station_imports` e `frontend_node_modules`. O roteiro faz `backup.sh` → `docker compose down` → `docker volume rm fertilizacerrado_postgres_data` → `docker compose up -d db` → `restore.sh` → `docker compose up -d` → compara contagens (`users`, `cultivars`, `qm_calibrations`, `harvests`, `msa_runs`) e `md5` de `SELECT … FROM msa_phase_summaries ORDER BY …` antes/depois. O roteiro só roda com `E2E_BACKUP_CONFIRM=1` (destrutivo para o banco de dev).

### 4. Usuário inativo: bloqueio no login e no refresh, não por requisição
`active` é checado em `login` (403 `USER_INACTIVE`, antes do `EMAIL_NOT_VERIFIED`), em `refresh` (401 `INVALID_REFRESH_TOKEN`) e em `GET /auth/me` (401). Desativar zera `refreshToken` (revogação imediata do refresh); o access token em uso expira em ≤ 15 min. Alternativa (consultar o banco em todo `authenticate`) descartada: custo em toda requisição para fechar uma janela de 15 min; documentado como limitação conhecida.

### 5. Regras de administração
- `PATCH /users/:id`: ADMIN edita `name`, `phone`, `crea`, `role`, `active`; o próprio usuário edita `name`, `phone`, `crea` (campos extras ⇒ 403 `FORBIDDEN_FIELDS`); outros ⇒ 404 (não revela existência). `email`, `cpf`, `cnpj` imutáveis nesta change.
- **Último admin**: desativar (via `deactivate` ou `active: false`) ou rebaixar (`role` ≠ ADMIN) um ADMIN só é permitido se restar ao menos um outro ADMIN ativo (`count(active ADMIN) > 1`), senão 409 `LAST_ADMIN`; ADMIN não desativa a si mesmo (409 `LAST_ADMIN` também, com mensagem própria). Verificação dentro de uma transação com `SELECT … FOR UPDATE` dos admins para evitar corrida.
- Reativar não reenvia verificação nem altera `emailVerified`.

### 6. Reenvio de verificação sem vazar contas
`POST /auth/resend-verification { email }` responde 200 com a mesma mensagem sempre. Se a conta existe, está ativa e não verificada, envia o e-mail (token de 24 h). Limite no Redis: `resend-verify:<email>` com `INCR`+`EXPIRE 3600 NX`; acima de 3 ⇒ 429 `TOO_MANY_REQUESTS` com `Retry-After` (o limite revela no máximo que *alguém* pediu reenvio para aquele e-mail — aceito). `POST /users/:id/resend-verification` (ADMIN) ignora o limite e responde 204 (409 `ALREADY_VERIFIED` se já verificado).

### 7. Troca de senha
`PATCH /users/me/password { currentPassword, newPassword }`: confere a atual (401 `INVALID_CREDENTIALS` se errada), aplica `passwordSchema`, grava o hash, zera `refreshToken` (as outras sessões caem; a atual segue até o access token expirar) e responde 204. O frontend, após 204, mantém a sessão e avisa que outros dispositivos foram desconectados.

### 8. Listagem paginada
`GET /users?q=&role=&active=&page=1&pageSize=20` → `{ items: UserAdminView[], page, pageSize, total }`, `pageSize ≤ 50`, ordenação por `name`. Mesmas regras de escopo de hoje (AGRONOMO só PRODUTOR com `q ≥ 3`). `UserAdminView` = `PublicUser` + `active`, `emailVerified`, `cpf`/`cnpj` mascarados (`***.456.789-**`), `phone`, `crea`, `createdAt` — ADMIN vê tudo; AGRONOMO só `id/name/email/role`. O `UserPicker` passa a ler `items`.

### 9. Frontend
`/admin/usuarios` (RequireRole ADMIN): tabela com busca (debounce), filtros role/ativo, paginação; ações por linha: Editar (modal com nome, telefone, CREA, role), Desativar/Reativar (confirmação; `LAST_ADMIN` mapeado), Reenviar verificação (só não verificados). `/perfil`: dados próprios (nome/telefone/CREA editáveis), role e status de verificação, troca de senha (regras de senha reutilizadas). Login: `USER_INACTIVE` → "Sua conta está desativada. Fale com o administrador."; `EMAIL_NOT_VERIFIED` → mensagem + botão "Reenviar e-mail de verificação" (chama o endpoint público com o e-mail digitado; mostra 429 com `Retry-After`). Barra lateral: **Usuários** (ADMIN); cabeçalho: o nome vira link para `/perfil`.

## Risks / Trade-offs

- **[Janela de 15 min após desativar]** → aceita (decisão 4); documentada em `usuarios.md`.
- **[Restore destrutivo]** → `restore.sh` exige digitar o nome do banco; o e2e exige `E2E_BACKUP_CONFIRM=1`.
- **[Backup em produção sem off-site]** → volume local apenas até a Fase 2 (S3 + lifecycle); registrado.
- **[CI sem Playwright]** → cobertura e2e continua manual; melhoria futura (stack em `services:` do Actions + cache do CDS como artefato é inviável; alternativa: job noturno opcional com `ERA5_E2E_CDS` desligado).
- **[Limite por e-mail no reenvio]** → permite enumerar que um e-mail pediu reenvio 3×; risco baixo; alternativa (limite por IP) pior para NATs de campo.
- **[pg_dump via rede no serviço `backup`]** → a senha vai por `PGPASSWORD` do `.env` já presente na stack; não há exposição nova.

## Notas de implementação

- **Prisma Client desatualizado no contêiner de dev**: a coluna `active` entrou no schema (montado do host) e na migration, mas o client gerado no build da imagem não a conhecia — `user.active` chegava `undefined` e **todo login respondia `USER_INACTIVE`** (os roteiros e2e caíram em bloco). O comando de subida de `api` e `worker` em dev passou a `pnpm prisma generate && …`, para o client acompanhar o schema montado. Em produção a imagem já é construída com `prisma generate`.
- **`restore.sh` não usa `--clean`**: recria o banco e segue o par `timescaledb_pre_restore()` / `timescaledb_post_restore()`; usa `--exit-on-error` para a falha de qualquer objeto abortar com código ≠ 0.
- **`backup-cron.sh` roda com `sh` (alpine)**, não `bash`; o crontab é instalado com `crontab /scripts/crontab` na subida do serviço (o `crond` do busybox lê `/etc/crontabs/root`).
- **Vitest do backend já injeta o env fictício** (`vitest.config.ts`), então o job `backend` do CI não precisa de variáveis extras.
- **Cobertura do cache ERA5 e a data**: `months_covering(from, to)` precisa do mês de `to + 1 dia` (passo 00 UTC do dia seguinte). Com `to = hoje − 6 = 2026-09-30`, o ETL passou a exigir `2026-10.nc`, que não está no cache — e o CDS estava inacessível desta máquina. `msa.spec.ts` e `e2e-orchestration.sh` dependem disso; falharam aqui por ambiente, não por esta change (o `e2e-msa.sh`, que injeta série sintética, passa). Registrado no README dos e2e.
- **`cdsapi.Client` fala com o CDS na construção**: mesmo com todos os meses em cache, `make_client` abria conexão (catálogo de mensagens) e, com o CDS inacessível, o job de ingestão ficava preso em retentativas de 2 min (500 tentativas). `download.LazyCdsClient` só instancia o cliente no primeiro `retrieve`; a chave continua exigida antes de começar.
- **Worker fora da rede**: `docker compose up -d api worker` após a recriação da rede deixou o `worker` com `getaddrinfo ENOTFOUND redis`; `--force-recreate worker` resolve.
- **Paginação quebrou o contrato antigo de `GET /users` de propósito** (`{ items, … }`); `useUserSearch` usa `select: page => page.items` — o `UserPicker` não mudou.

## Migration Plan

1. Migration `active` (default true) — sem downtime; seed idempotente.
2. Backend/frontend; `.github/workflows/ci.yml` entra no mesmo commit e roda no push.
3. Compose de produção: `docker compose -f docker-compose.prod.yml up -d backup`; definir `BACKUP_RETENTION_DAYS`.
4. Rollback: coluna com default não quebra a versão anterior; o serviço `backup` é removível sem efeito.

## Open Questions

- S3 para os dumps (bucket, lifecycle, criptografia) — Fase 2 de infra.
- Playwright no CI: job noturno com a stack completa e sem CDS?
- Auditoria (quem alterou quem, quando) — tabela `user_audit` numa change futura, se a Heb precisar para o estudo.
