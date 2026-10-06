## 1. CI e README

- [x] 1.1 `.github/workflows/ci.yml`: jobs `backend` (Node 20, corepack, cache do store pnpm, env fictício para o Zod, `prisma generate`, `typecheck`, `test`), `frontend` (`lint`, `typecheck`, `test`, `build`), `etl` (Python 3.12, cache pip, `pytest`), `docker` (buildx, build sem push das 3 imagens com cache gha); `concurrency` por branch
- [x] 1.2 `README.md` da raiz (projeto, `pnpm start`, `.env`, seed, atalhos, links para docs) com o badge do CI; validar o YAML (`actionlint` ou `yq`) e, após o push, conferir o workflow verde no GitHub

## 2. Backup

- [x] 2.1 `backend/scripts/db/backup.sh` (pg_dump -Fc do contêiner, retenção `BACKUP_KEEP`), `restore.sh` (confirmação pelo nome do banco, stop api/worker/etl, drop/create, extensões, `timescaledb_pre_restore`, `pg_restore --no-owner --no-privileges`, `timescaledb_post_restore`, start); `db:backup`/`db:restore` no `package.json` da raiz; `./backups/` no `.gitignore`
- [x] 2.2 Produção: `backend/scripts/db/backup-cron.sh` + crontab; serviço `backup` (`postgres:15-alpine`, crond, TZ, `db_backups`, `BACKUP_RETENTION_DAYS`, só `backend_net`) no `docker-compose.prod.yml`; `.env.example`; `docker compose -f docker-compose.prod.yml config` válido
- [x] 2.3 `backend/scripts/e2e/e2e-backup.sh` (só com `E2E_BACKUP_CONFIRM=1`): backup → contagens + md5 de `msa_phase_summaries` → `down` + `volume rm postgres_data` → `up -d db` → `restore.sh` → `up -d` → comparação; rodar com `FALHAS: 0` e confirmar que `etl_cache` continua populado

## 3. Backend — usuários

- [x] 3.1 `User.active` (default true) + migration `add_user_active`; seed mantém o admin ativo; `auth.service`: `USER_INACTIVE` no login (antes do e-mail), inativo ⇒ 401 no refresh e no `/me`
- [x] 3.2 `users`: `GET /users` paginado (`page`, `pageSize ≤ 50`, `active`, `role`, `q`; `{ items, page, pageSize, total }`; `UserAdminView` com documento mascarado para ADMIN), `GET /users/:id`, `PATCH /users/:id` (campos por role; `FORBIDDEN_FIELDS`), `POST /users/:id/deactivate|reactivate` (zera refresh; `LAST_ADMIN` em transação com `FOR UPDATE`), `POST /users/:id/resend-verification` (`ALREADY_VERIFIED`), `PATCH /users/me/password`; DTOs zod
- [x] 3.3 `POST /auth/resend-verification` público (200 sempre; limite 3/h por e-mail no Redis com `Retry-After`); `docs/modulos/auth.md`
- [x] 3.4 Unitários: `LAST_ADMIN` (próprio, último, segundo admin), campos permitidos por role, escopo do `GET /users/:id`, limite de reenvio (Redis mockado), paginação do diretório; `e2e-users.sh` (todos os endpoints, inativo ⇒ login 403 e refresh 401, reenvio público 200/429, troca de senha); `e2e-auth.sh`/`e2e-properties.sh` continuam verdes (UserPicker/`items`)

## 4. Frontend

- [x] 4.1 Tipos (`UserAdminView`, `UsersPage`), `errors.ts` (`USER_INACTIVE`, `LAST_ADMIN`, `ALREADY_VERIFIED`, `TOO_MANY_REQUESTS`), `UserPicker` lendo `items`; barra lateral **Usuários** (ADMIN) e nome do cabeçalho → `/perfil`
- [x] 4.2 `/admin/usuarios`: tabela com busca (debounce), filtros role/ativo, paginação; Editar (modal), Desativar/Reativar (confirmação), Reenviar verificação; `/perfil`: dados próprios editáveis, role, verificação, troca de senha
- [x] 4.3 Login: mensagem `USER_INACTIVE`; botão "Reenviar e-mail de verificação" no `EMAIL_NOT_VERIFIED` (429 mapeado); `pnpm typecheck && lint && test && build`

## 5. Verificação e documentação

- [x] 5.1 Playwright `e2e/users.spec.ts`: admin desativa um agrônomo → login dele falha com a mensagem → reativa → login ok; troca de senha no `/perfil` → login com a nova; `pnpm e2e` completo verde
- [x] 5.2 `docs/modulos/usuarios.md` (endpoints, regras, janela de 15 min, telas), `arquitetura.md` (Fase 0 completa; CI e backup na stack), `frontend.md`, README dos e2e (`e2e-users.sh`, `e2e-backup.sh`)
