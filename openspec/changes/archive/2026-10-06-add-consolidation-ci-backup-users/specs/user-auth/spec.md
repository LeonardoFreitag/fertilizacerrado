## MODIFIED Requirements

### Requirement: Login
O sistema SHALL autenticar em `POST /api/v1/auth/login` com `email` e `password`. Em sucesso SHALL responder 200 com `accessToken` e os dados `id`, `name`, `email` e `role` do usuário, e SHALL gravar o refresh token em um cookie `HttpOnly`. O access token MUST ser um JWT HS256 com validade de 15 minutos. O refresh token MUST ter validade de 7 dias e MUST NOT aparecer no corpo da resposta. Contas com e-mail não verificado MUST NOT receber tokens. Contas inativas (`active = false`) MUST receber 403 `USER_INACTIVE`, verificado antes da checagem de e-mail.

#### Scenario: Credenciais corretas
- **WHEN** um usuário verificado envia e-mail e senha corretos
- **THEN** a resposta é 200 com `accessToken` e `user`, e contém `Set-Cookie` do refresh token com `HttpOnly`, `SameSite=Strict` e `Path=/api/v1/auth`

#### Scenario: Refresh token fora do corpo
- **WHEN** o login é bem-sucedido
- **THEN** o corpo JSON da resposta não contém o refresh token

#### Scenario: Senha incorreta
- **WHEN** a senha não confere
- **THEN** a resposta é 401 com mensagem genérica e nenhum cookie é gravado

#### Scenario: E-mail inexistente
- **WHEN** o e-mail não pertence a nenhuma conta
- **THEN** a resposta é 401 com a mesma mensagem do caso de senha incorreta

#### Scenario: E-mail não verificado
- **WHEN** as credenciais estão corretas mas `emailVerified` é falso
- **THEN** a resposta é 403 com o código `EMAIL_NOT_VERIFIED` e nenhum token é emitido

#### Scenario: Conta inativa
- **WHEN** as credenciais estão corretas mas `active` é falso
- **THEN** a resposta é 403 com o código `USER_INACTIVE` e nenhum token é emitido

#### Scenario: Cookie seguro em produção
- **WHEN** o login ocorre com `NODE_ENV` igual a `production`
- **THEN** o cookie do refresh token tem o atributo `Secure`
