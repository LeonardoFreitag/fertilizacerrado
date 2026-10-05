## Why

O backend tem apenas a fundação (`/health`, env, Docker); nenhum módulo de domínio pode ser exposto sem identidade e controle de acesso. O módulo de Auth é o primeiro da Fase 0 em `docs/arquitetura.md` e pré-requisito de Usuários, Propriedades e de todo o MSA. Esta change o implementa conforme `docs/modulos/auth.md`.

## What Changes

- Primeiro model do Prisma, `User`, com a primeira migration; a flag provisória `--allow-no-models` é removida do Dockerfile e do script `prisma:generate`.
- Sete endpoints sob `/api/v1/auth`: `register`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password` e `verify-email/:token`.
- Cadastro restrito aos roles `AGRONOMO` e `PRODUTOR`, com CPF ou CNPJ obrigatório e validado por dígitos verificadores; senha com bcrypt fator 12.
- Sessão por JWT: access token HS256 de 15 min no corpo da resposta; refresh token de 7 dias entregue apenas em cookie HttpOnly, guardado no banco como hash SHA-256, com rotação a cada uso e revogação da sessão em caso de reuso.
- Limite de 5 tentativas de login malsucedidas por IP em 15 minutos, com contador no Redis (primeiro uso do Redis pela aplicação).
- Verificação de e-mail e recuperação de senha por e-mail via SMTP; token de recuperação de 32 bytes, guardado como hash SHA-256, válido por 1 hora.
- Middlewares `authenticate` e `authorize(...roles)` em `src/middleware/auth.middleware.ts` para uso pelos próximos módulos.
- Validadores de CPF e CNPJ em `src/utils/`, isolados e com testes unitários.
- Na aplicação: `helmet`, CORS restrito ao `FRONTEND_URL` com credenciais, parser de cookies, respostas 400 padronizadas para erros de validação Zod e fechamento do Redis no graceful shutdown.
- Vitest como framework de testes, cobrindo os validadores de documento e os DTOs.

Fora do escopo: CRUD e gestão de usuários (módulo Usuários), criação de contas `ADMIN`, reenvio de e-mail de verificação, múltiplas sessões simultâneas por usuário, 2FA, login social e telas de frontend.

## Capabilities

### New Capabilities
- `user-auth`: cadastro, verificação de e-mail, login, renovação e encerramento de sessão, recuperação e redefinição de senha.
- `access-control`: middlewares `authenticate` (valida o access token e injeta `req.user`) e `authorize` (restrição por role).
- `document-validation`: validação e normalização de CPF e CNPJ.

### Modified Capabilities
- `backend-runtime`: o graceful shutdown passa a fechar também a conexão com o Redis; a aplicação ganha CORS, headers de segurança e resposta padronizada para erros de validação.

## Impact

- **Código**: novo `src/modules/auth/` (controller, service, repository, routes, `dtos/`), `src/middleware/auth.middleware.ts`, `src/utils/{cpf,cnpj,token,mailer,app-error}`, `src/config/redis.ts`; alterações em `src/app.ts`, `src/server.ts`, `prisma/schema.prisma`, `Dockerfile` e `package.json`.
- **Banco**: nova tabela `users` e enum de roles, via migration.
- **API**: sete rotas novas em `/api/v1/auth`, já cobertas pela zona `api_auth` do Nginx de produção. Nenhuma rota existente muda.
- **Dependências**: `bcrypt`, `jsonwebtoken`, `nodemailer`, `ioredis`, `cookie-parser`, `cors`, `helmet`; dev: `vitest` e os pacotes `@types` correspondentes.
- **Ambiente**: nenhuma variável nova — usa `JWT_*`, `SMTP_*`, `REDIS_URL`, `APP_URL` e `FRONTEND_URL` já validadas em `env.ts`. A imagem da API precisa ser reconstruída por causa das novas dependências.
