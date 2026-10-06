# Módulo de Usuários

Completa a Fase 0: administração das contas (`ADMIN`), perfil próprio e reenvio de verificação. O cadastro, login, verificação e recuperação de senha estão em [auth.md](auth.md).

## Regras

- **Ativo/inativo** (`users.active`, default verdadeiro): desativar **não apaga nada** — propriedades, safras, runs e decisões continuam referenciando o usuário. Um inativo recebe 403 `USER_INACTIVE` no login, 401 no `refresh` e em `GET /auth/me`; o refresh token é zerado no ato. O access token já emitido (15 min) continua válido até expirar — o `authenticate` não consulta o banco a cada requisição (limitação conhecida, aceita pelo custo).
- **Último administrador**: um `ADMIN` não desativa nem rebaixa a si mesmo; desativar ou rebaixar o último `ADMIN` ativo responde 409 `LAST_ADMIN`. A verificação roda em transação com `SELECT … FOR UPDATE` dos admins.
- **Autoedição**: o próprio usuário altera `name`, `phone` e `crea`; qualquer outro campo ⇒ 403 `FORBIDDEN_FIELDS`. `email`, `cpf` e `cnpj` são imutáveis. Só `ADMIN` altera `role` e `active`.
- **Documentos** aparecem mascarados nas listagens (`***.982.247-**`).
- **Reenvio de verificação público** (`POST /auth/resend-verification`): resposta sempre 200; envia só se a conta existe, está ativa e não verificada; limite de 3 pedidos/hora por e-mail no Redis (429 com `Retry-After`). O `ADMIN` reenvia sem limite (`POST /users/:id/resend-verification`, 204; 409 `ALREADY_VERIFIED`).
- **Troca de senha** (`PATCH /users/me/password`): exige a senha atual (401 `INVALID_CREDENTIALS`), aplica as regras do cadastro, zera o refresh (outros dispositivos caem; a sessão atual segue até o access token expirar).

## Endpoints

| Método | Path | Descrição | Roles |
|---|---|---|---|
| GET | `/api/v1/users?q=&role=&active=&page=&pageSize=` | Lista paginada `{ items, page, pageSize, total }` (`pageSize` ≤ 50, ordem por nome). ADMIN: todos os campos; AGRONOMO: só `PRODUTOR` ativos com `q` ≥ 3 e campos básicos | ADMIN, AGRONOMO |
| GET | `/api/v1/users/:id` | Usuário (ADMIN ou o próprio; demais 404) | Autenticado |
| PATCH | `/api/v1/users/:id` | ADMIN: `name`, `phone`, `crea`, `role`, `active`; próprio: `name`, `phone`, `crea` | Autenticado |
| POST | `/api/v1/users/:id/deactivate` · `/reactivate` | Desativa (zera refresh) / reativa | ADMIN |
| POST | `/api/v1/users/:id/resend-verification` | Reenvia o e-mail de verificação (204; 409 se verificado) | ADMIN |
| PATCH | `/api/v1/users/me/password` | `{ currentPassword, newPassword }` → 204 | Autenticado |
| POST | `/api/v1/auth/resend-verification` | `{ email }` → 200 sempre; 429 acima de 3/h | Público |

## Interface

- `/admin/usuarios` (ADMIN): busca por nome/e-mail, filtros de role e status, paginação; Editar (nome, telefone, CREA, role), Desativar/Reativar com confirmação, Reenviar verificação (só não verificados). O próprio admin não tem o botão Desativar na sua linha.
- `/perfil`: dados próprios editáveis (nome, telefone, CREA), role, status de verificação, troca de senha.
- Login: "Sua conta está desativada. Fale com o administrador." para `USER_INACTIVE`; botão "Reenviar e-mail de verificação" no 403 `EMAIL_NOT_VERIFIED`.

## Referências de implementação

| Arquivo | Conteúdo |
|---|---|
| `backend/src/modules/users/user.service.ts` | escopo do diretório, `assertEditableFields`, `LAST_ADMIN`, troca de senha, máscara de documento |
| `backend/src/modules/users/user.routes.ts` · `user.controller.ts` · `dtos/` | rotas e validação |
| `backend/src/modules/auth/auth.service.ts` · `login-rate-limit.ts` | `USER_INACTIVE`, reenvio público com limite |
| `frontend/src/features/admin/UsersPage.tsx` · `features/profile/ProfilePage.tsx` | telas |
| `backend/scripts/e2e/e2e-users.sh` · `frontend/e2e/users.spec.ts` | verificação de ponta a ponta |
