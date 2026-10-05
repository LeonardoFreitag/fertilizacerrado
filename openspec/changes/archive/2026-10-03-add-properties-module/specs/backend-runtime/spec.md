## MODIFIED Requirements

### Requirement: Validação de variáveis de ambiente no startup
O backend SHALL validar as variáveis de ambiente com um schema Zod em `src/config/env.ts` antes de iniciar o servidor e SHALL expor um objeto `env` tipado como única forma de acesso à configuração. O schema MUST cobrir `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`. `JWT_SECRET` e `JWT_REFRESH_SECRET` MUST ter no mínimo 32 caracteres. `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` MUST ser obrigatórias quando `NODE_ENV` é `production` e opcionais nos demais ambientes. `ADMIN_EMAIL` e `ADMIN_PASSWORD` MUST ser opcionais em todos os ambientes; `ADMIN_EMAIL`, quando presente, MUST ter formato de e-mail.

#### Scenario: Ambiente válido
- **WHEN** todas as variáveis obrigatórias estão presentes e válidas
- **THEN** o servidor inicia e `env.PORT` é um número

#### Scenario: Defaults aplicados
- **WHEN** `NODE_ENV`, `PORT`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` e `SMTP_PORT` não são definidas
- **THEN** o backend usa `development`, `3000`, `15m`, `7d` e `587` respectivamente

#### Scenario: Segredo JWT curto
- **WHEN** `JWT_SECRET` tem menos de 32 caracteres
- **THEN** o processo imprime no stderr um erro que identifica `JWT_SECRET` e encerra com código 1 sem abrir a porta HTTP

#### Scenario: Variável obrigatória ausente
- **WHEN** `DATABASE_URL` não está definida
- **THEN** o processo imprime no stderr um erro que identifica `DATABASE_URL` e encerra com código 1

#### Scenario: SMTP ausente em produção
- **WHEN** `NODE_ENV` é `production` e `SMTP_HOST` não está definida
- **THEN** o processo encerra com código 1 identificando `SMTP_HOST`

#### Scenario: SMTP ausente em desenvolvimento
- **WHEN** `NODE_ENV` é `development` e nenhuma variável SMTP de credencial está definida
- **THEN** o servidor inicia normalmente

#### Scenario: Variáveis do administrador ausentes
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` não estão definidas em qualquer ambiente
- **THEN** o servidor inicia normalmente

#### Scenario: E-mail do administrador inválido
- **WHEN** `ADMIN_EMAIL` está definida sem formato de e-mail
- **THEN** o processo encerra com código 1 identificando `ADMIN_EMAIL`
