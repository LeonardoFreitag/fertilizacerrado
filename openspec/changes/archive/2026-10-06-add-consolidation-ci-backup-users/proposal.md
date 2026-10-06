## Why

A Fase 1 (MSA) está completa de ponta a ponta, mas três pendências de base ficaram para trás: nada roda automaticamente a cada push (a qualidade depende de quem lembra de rodar `pnpm test`); o banco de dados — que agora guarda calibrações, runs reprodutíveis e decisões da pesquisa — não tem backup; e o módulo de Usuários, previsto na Fase 0 de `docs/arquitetura.md`, nunca passou de um diretório de busca (`GET /users`). Esta change consolida as três antes de abrir a Fase 2.

## What Changes

### 1. CI (GitHub Actions)
- `.github/workflows/ci.yml` a cada push e PR em `main`, com `concurrency` cancelando execuções antigas do mesmo branch e cache de pnpm e pip:
  - **backend**: `pnpm install --frozen-lockfile`, `prisma generate`, `typecheck`, `vitest` (sem banco; variáveis de ambiente fictícias para o schema Zod);
  - **frontend**: install, `lint`, `typecheck`, `vitest`, `build`;
  - **etl**: Python 3.12, `pip install -r requirements.txt`, `pytest` (só unitários — o marker `integration` já é excluído por padrão);
  - **docker**: build das três imagens (api, web, etl) sem push, com cache do buildx.
- `README.md` na raiz (o que é o projeto, `pnpm start`, links para `docs/`) com o badge do CI.
- Playwright e e2e bash ficam fora (exigem a stack inteira e o cache do CDS); registrado como melhoria futura.

### 2. Backup do banco
- `backend/scripts/db/backup.sh`: `pg_dump -Fc` do contêiner `db` para `./backups/fertilizacerrado_<data-hora>.dump`, mantendo os últimos N (default 14). `restore.sh <arquivo>`: pede que se digite o nome do banco, derruba `api`/`worker`/`etl`, recria o banco com `timescaledb_pre_restore()`/`timescaledb_post_restore()` (obrigatório para hipertabelas) e religa os serviços.
- Atalhos `db:backup` e `db:restore` no `package.json` da raiz; `./backups/` no `.gitignore`.
- Produção: serviço `backup` no `docker-compose.prod.yml` (`postgres:15-alpine`, cliente da mesma major, `crond` diário 03:30 BRT) gravando no volume `db_backups` com retenção `BACKUP_RETENTION_DAYS`. Envio para S3 fica para a Fase 2 de infra.
- Teste `e2e-backup.sh`: backup → derrubar a stack e remover **só** o volume `postgres_data` (não `pnpm clean`/`down -v`, que apagaria o cache ERA5 e os uploads) → restore → contagens de admin, cultivares, calibrações, safras e runs idênticas e `md5` de `msa_phase_summaries` igual.

### 3. Módulo de Usuários
- Backend (`src/modules/users/` estendido): `GET /users/:id` (ADMIN ou o próprio), `PATCH /users/:id` (ADMIN: `name`, `phone`, `crea`, `role`, `active`; o próprio: `name`, `phone`, `crea`), `POST /users/:id/deactivate` e `/reactivate` (ADMIN; inativo não faz login — 403 `USER_INACTIVE` —, refresh revogado na hora; não é exclusão), `POST /users/:id/resend-verification` (ADMIN), `POST /auth/resend-verification` (público, por e-mail, sempre 200, limite 3/h por e-mail no Redis), `PATCH /users/me/password` (senha atual + nova; revoga refresh). Campo `active` (default true) no `User`; seed mantém o admin ativo. ADMIN não desativa a si mesmo nem o último ADMIN ativo (409 `LAST_ADMIN`). `GET /users` ganha paginação (`page`, `pageSize` ≤ 50), filtro `active` e ordenação por nome, devolvendo `{ items, page, pageSize, total }`; o `UserPicker` passa a ler `items`.
- Frontend: `/admin/usuarios` (tabela com busca/filtros, editar, desativar/reativar com confirmação, reenviar verificação, trocar role); `/perfil` (dados próprios, troca de senha, role e status de verificação); login com mensagem para `USER_INACTIVE` e link "reenviar e-mail de verificação" no 403 `EMAIL_NOT_VERIFIED`; entrada **Usuários** (ADMIN) na barra lateral e **Perfil** no cabeçalho.
- Verificação: unitários (`LAST_ADMIN`, autoedição, escopo, limite de reenvio), `e2e-users.sh`, Playwright (admin desativa um agrônomo → login dele falha → reativa → login ok; troca de senha).
- Docs: `docs/modulos/usuarios.md` (novo), `auth.md` (reenvio, inativo), `arquitetura.md` (Fase 0 completa).

## Capabilities

### New Capabilities
- `ci-pipeline`: workflow do GitHub Actions (backend, frontend, etl, docker), cache, concorrência, badge e README da raiz.
- `db-backup`: scripts de backup/restore do PostgreSQL/TimescaleDB, atalhos, serviço de backup diário em produção e roteiro de verificação.
- `user-management`: leitura/edição de usuários, desativação/reativação, regras de último administrador, reenvio de verificação, troca de senha, telas `/admin/usuarios` e `/perfil`.

### Modified Capabilities
- `user-auth`: login de usuário inativo (403 `USER_INACTIVE`); reenvio público de verificação com limite; troca de senha revoga o refresh.
- `user-directory`: `GET /users` paginado com filtro `active` (resposta `{ items, page, pageSize, total }`).
- `web-shell`: entrada **Usuários** (ADMIN) na barra lateral e **Perfil** no cabeçalho.
- `web-auth`: mensagens para `USER_INACTIVE` e link de reenvio no `EMAIL_NOT_VERIFIED`.
- `container-infrastructure`: serviço `backup` e volume `db_backups` na stack de produção; `BACKUP_RETENTION_DAYS` no `.env.example`.

## Impact

- Novo: `.github/workflows/ci.yml`, `README.md` (raiz), `backend/scripts/db/{backup.sh,restore.sh,backup-cron.sh}`, `backend/scripts/e2e/{e2e-backup.sh,e2e-users.sh}`, `docs/modulos/usuarios.md`, migration `add_user_active`.
- Backend: `users` (service/controller/routes/DTOs), `auth.service` (`active`, resend, limite no Redis), `auth.middleware` (sem mudança — o token de 15 min expira sozinho; refresh e login bloqueiam), `seed.ts`.
- Frontend: páginas `admin/UsersPage`, `profile/ProfilePage`, `LoginPage`, `UserPicker`, `Shell`, tipos/erros.
- Infra: `docker-compose.prod.yml` (serviço `backup`), `.env.example`, `.gitignore`, `package.json` da raiz.
