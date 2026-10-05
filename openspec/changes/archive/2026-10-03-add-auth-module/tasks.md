## 1. Dependências e tooling

- [x] 1.1 Instalar com pnpm: `bcrypt`, `jsonwebtoken`, `nodemailer`, `ioredis`, `cookie-parser`, `cors`, `helmet`; dev: `vitest`, `@types/bcrypt`, `@types/jsonwebtoken`, `@types/nodemailer`, `@types/cookie-parser`, `@types/cors`
- [x] 1.2 Adicionar o script `test` (`vitest run`) ao `package.json` e excluir os arquivos `*.test.ts` do build do `tsc`

## 2. Banco de dados

- [x] 2.1 Adicionar ao `prisma/schema.prisma` o enum `Role` e o model `User` (UUID, colunas snake_case, `email`/`cpf`/`cnpj` únicos, índice em `resetToken`)
- [x] 2.2 Criar a migration `create_users` com `pnpm prisma migrate dev` no host
- [x] 2.3 Remover `--allow-no-models` do `Dockerfile` e do script `prisma:generate`

## 3. Utilitários

- [x] 3.1 Implementar `src/utils/cpf.util.ts` (`isValidCpf`, `normalizeCpf`, `formatCpf`) com testes unitários
- [x] 3.2 Implementar `src/utils/cnpj.util.ts` (`isValidCnpj`, `normalizeCnpj`, `formatCnpj`) cobrindo CNPJ numérico e alfanumérico, com testes unitários
- [x] 3.3 Implementar `src/utils/app-error.ts` (`AppError` com status e código)
- [x] 3.4 Implementar `src/utils/token.util.ts`: hash SHA-256, token aleatório de 32 bytes, emissão e verificação dos JWTs de access, refresh e verify-email com `typ` e HS256 fixos
- [x] 3.5 Implementar `src/utils/mailer.ts` com nodemailer, fallback para log quando `SMTP_HOST` não está definido, e as funções de e-mail de verificação e de recuperação

## 4. Infraestrutura da aplicação

- [x] 4.1 Implementar `src/config/redis.ts` com cliente `ioredis` único e conexão lazy
- [x] 4.2 Atualizar `src/app.ts`: `helmet`, CORS restrito a `FRONTEND_URL` com credenciais, `cookieParser`, e error handler tratando `AppError`, `ZodError` (400 com `details`) e `P2002` (409)
- [x] 4.3 Atualizar `src/server.ts` para encerrar o Redis no graceful shutdown
- [x] 4.4 Criar `src/types/express.d.ts` tipando `req.user`

## 5. Middleware de autenticação

- [x] 5.1 Implementar `authenticate` em `src/middleware/auth.middleware.ts` (Bearer, HS256, `typ = access`, injeta `req.user`)
- [x] 5.2 Implementar `authorize(...roles)` (403 por role, 401 sem `req.user`)

## 6. Módulo auth

- [x] 6.1 Criar os DTOs Zod em `src/modules/auth/dtos/`: register (política de senha, roles permitidos, regras de CPF/CNPJ/`personType`, normalização), login, forgot-password, reset-password — com testes unitários do DTO de register
- [x] 6.2 Implementar `auth.repository.ts` com as queries Prisma, incluindo a rotação condicional do refresh token via `updateMany`
- [x] 6.3 Implementar no `auth.service.ts` o cadastro (unicidade, bcrypt fator 12, e-mail de verificação) e a verificação de e-mail
- [x] 6.4 Implementar no service o login (comparação em tempo constante para usuário inexistente, bloqueio de não verificado, emissão de tokens) e o limite de tentativas no Redis com falha aberta
- [x] 6.5 Implementar no service o refresh com rotação e revogação por reuso, e o logout
- [x] 6.6 Implementar no service o forgot-password e o reset-password (uso único, expiração, revogação da sessão, marcação de e-mail verificado)
- [x] 6.7 Implementar `auth.controller.ts` (parse dos DTOs, cookie do refresh token com os atributos do design, respostas sem campos sensíveis)
- [x] 6.8 Implementar `auth.routes.ts` com as sete rotas e montar o router em `/api/v1/auth` no `app.ts`

## 7. Verificação

- [x] 7.1 `pnpm typecheck`, `pnpm build` e `pnpm test` sem erros
- [x] 7.2 Reconstruir e subir a stack (`docker compose up -d --build`) e confirmar a migration aplicada e a tabela `users` criada
- [x] 7.3 Roteiro de cadastro: sucesso, e-mail duplicado, senha fraca, `role` ADMIN, documento ausente/ inválido, PJ sem CNPJ; conferir no banco o hash bcrypt de custo 12 e o documento sem pontuação
- [x] 7.4 Roteiro de verificação e login: login bloqueado antes da verificação, link do e-mail (pelo log), login com cookie `HttpOnly` e sem refresh token no corpo, 401 genérico
- [x] 7.5 Roteiro de sessão: refresh com rotação, reuso do token antigo revogando a sessão, logout e refresh após logout
- [x] 7.6 Roteiro de recuperação: forgot-password para conta existente e inexistente, reset válido, token reutilizado, token expirado, sessão encerrada após reset
- [x] 7.7 Roteiro de limite de login: 429 com `Retry-After` na sexta falha e login funcionando com o Redis parado
- [x] 7.8 Verificar `authenticate` e `authorize` com testes unitários (`auth.middleware.test.ts`), em vez de uma rota temporária: sem token, token expirado/adulterado, refresh token como Bearer, role permitido e não permitido
- [x] 7.9 Verificar CORS (origem permitida × outra origem), headers do `helmet` e graceful shutdown com exit 0
