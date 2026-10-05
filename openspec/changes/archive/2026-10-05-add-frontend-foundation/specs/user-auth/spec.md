## ADDED Requirements

### Requirement: Perfil do usuário autenticado
O sistema SHALL responder `GET /api/v1/auth/me`, autenticado por access token, com `id`, `name`, `email` e `role` do usuário. Sem token válido a resposta MUST ser 401.

#### Scenario: Token válido
- **WHEN** um usuário autenticado chama `GET /auth/me`
- **THEN** recebe 200 com `id`, `name`, `email` e `role`, sem `passwordHash` nem tokens

#### Scenario: Sem token
- **WHEN** `GET /auth/me` é chamado sem `Authorization`
- **THEN** a resposta é 401

## MODIFIED Requirements

### Requirement: Verificação de e-mail
O sistema SHALL confirmar o e-mail em `GET /api/v1/auth/verify-email/:token`. O token MUST ser assinado pelo servidor, específico para verificação de e-mail e válido por 24 horas. Em sucesso o sistema SHALL marcar `emailVerified` como verdadeiro e registrar `emailVerifiedAt`. O link enviado por e-mail MUST apontar para a página do frontend `${FRONTEND_URL}/verificar-email/<token>`, que chama o endpoint.

#### Scenario: Token válido
- **WHEN** o usuário acessa o link com um token válido
- **THEN** a resposta é 200, `emailVerified` passa a verdadeiro e `emailVerifiedAt` é preenchido

#### Scenario: Token inválido ou expirado
- **WHEN** o token está adulterado, expirado ou não é um token de verificação
- **THEN** a resposta é 400 e nenhum usuário é alterado

#### Scenario: E-mail já verificado
- **WHEN** o link é acessado novamente após a verificação
- **THEN** a resposta é 200 e `emailVerifiedAt` não é alterado

#### Scenario: Access token usado como token de verificação
- **WHEN** um access token válido é enviado no lugar do token de verificação
- **THEN** a resposta é 400

#### Scenario: Link do e-mail
- **WHEN** o e-mail de verificação é gerado com `FRONTEND_URL=http://localhost`
- **THEN** o link é `http://localhost/verificar-email/<token>`

### Requirement: Solicitação de recuperação de senha
O sistema SHALL aceitar `POST /api/v1/auth/forgot-password` com `email` e SHALL responder 200 com a mesma mensagem exista ou não a conta. Quando a conta existe, o sistema SHALL gerar um token de 32 bytes aleatórios criptograficamente seguros, armazenar apenas seu hash SHA-256 com expiração de 1 hora e enviar o token bruto por e-mail em um link para `${FRONTEND_URL}/redefinir-senha?token=<token>`.

#### Scenario: Conta existente
- **WHEN** o e-mail pertence a uma conta
- **THEN** a resposta é 200, `resetToken` guarda o hash SHA-256 do token, `resetTokenExpiresAt` fica 1 hora à frente e um e-mail com o link `${FRONTEND_URL}/redefinir-senha?token=<token>` é enviado

#### Scenario: Conta inexistente
- **WHEN** o e-mail não pertence a nenhuma conta
- **THEN** a resposta é 200 com a mesma mensagem e nenhum e-mail é enviado

#### Scenario: Novo pedido substitui o anterior
- **WHEN** um segundo pedido é feito antes de o primeiro token ser usado
- **THEN** apenas o token mais recente é aceito na redefinição
