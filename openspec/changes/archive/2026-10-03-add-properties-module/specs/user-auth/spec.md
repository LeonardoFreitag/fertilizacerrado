## ADDED Requirements

### Requirement: Seed do administrador
O sistema SHALL fornecer um seed em `prisma/seed.ts`, registrado em `package.json` como `prisma.seed` e executado por `pnpm prisma db seed`, que cria ou atualiza um usuário `ADMIN` a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD`. O seed MUST ser idempotente por e-mail (`upsert`), MUST gravar a senha como bcrypt de fator 12, MUST marcar o e-mail como verificado e MUST validar `ADMIN_PASSWORD` com a mesma política de senha do cadastro. Sem as duas variáveis definidas, o seed MUST encerrar com código 0 sem alterar o banco.

#### Scenario: Primeira execução
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` estão definidas e não existe usuário com esse e-mail
- **THEN** o seed cria um usuário com `role` `ADMIN`, `emailVerified` verdadeiro, `emailVerifiedAt` preenchido e `passwordHash` bcrypt de custo 12, e encerra com código 0

#### Scenario: Execução repetida
- **WHEN** o seed é executado novamente com as mesmas variáveis
- **THEN** continua existindo um único usuário com esse e-mail e o seed encerra com código 0

#### Scenario: Rotação da senha
- **WHEN** `ADMIN_PASSWORD` é alterada e o seed é executado novamente
- **THEN** o login do administrador funciona com a nova senha e falha com a anterior

#### Scenario: Login do administrador
- **WHEN** o administrador criado pelo seed envia e-mail e senha em `POST /api/v1/auth/login`
- **THEN** a resposta é 200 e o access token carrega `role` `ADMIN`

#### Scenario: Variáveis ausentes
- **WHEN** `ADMIN_EMAIL` ou `ADMIN_PASSWORD` não está definida
- **THEN** o seed informa que não há administrador a criar e encerra com código 0 sem alterar o banco

#### Scenario: Senha fraca
- **WHEN** `ADMIN_PASSWORD` não atende à política de senha do cadastro
- **THEN** o seed encerra com código 1 identificando o problema e não altera o banco

#### Scenario: E-mail já usado por outro role
- **WHEN** existe um usuário com `ADMIN_EMAIL` e `role` diferente de `ADMIN`
- **THEN** o seed atualiza esse usuário para `ADMIN`, verificado, com a senha informada
