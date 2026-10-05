## ADDED Requirements

### Requirement: Middleware de autenticação
`src/middleware/auth.middleware.ts` SHALL exportar `authenticate`, que exige um access token no header `Authorization: Bearer <token>`, valida assinatura HS256, expiração e tipo do token, e injeta `req.user` com `id` e `role`. Requisições sem token válido MUST receber 401. O middleware MUST NOT aceitar tokens de outro propósito nem tokens assinados com outro algoritmo.

#### Scenario: Token válido
- **WHEN** uma rota protegida recebe um access token válido
- **THEN** o handler é executado com `req.user.id` e `req.user.role` preenchidos

#### Scenario: Header ausente
- **WHEN** a requisição não traz o header `Authorization`
- **THEN** a resposta é 401 e o handler não é executado

#### Scenario: Token expirado
- **WHEN** o access token está expirado
- **THEN** a resposta é 401

#### Scenario: Assinatura inválida
- **WHEN** o token foi assinado com outro segredo ou adulterado
- **THEN** a resposta é 401

#### Scenario: Refresh token usado como access token
- **WHEN** um refresh token é enviado no header `Authorization`
- **THEN** a resposta é 401

#### Scenario: Algoritmo não permitido
- **WHEN** o token declara o algoritmo `none` ou outro diferente de HS256
- **THEN** a resposta é 401

### Requirement: Middleware de autorização por role
`src/middleware/auth.middleware.ts` SHALL exportar `authorize(...roles)`, que permite a requisição apenas quando `req.user.role` está entre os roles informados e responde 403 caso contrário. Usado sem autenticação prévia, MUST responder 401.

#### Scenario: Role permitido
- **WHEN** um usuário `AGRONOMO` acessa uma rota com `authorize('AGRONOMO', 'ADMIN')`
- **THEN** o handler é executado

#### Scenario: Role não permitido
- **WHEN** um usuário `PRODUTOR` acessa uma rota com `authorize('AGRONOMO', 'ADMIN')`
- **THEN** a resposta é 403 e o handler não é executado

#### Scenario: Sem autenticação prévia
- **WHEN** `authorize` é executado sem que `req.user` tenha sido definido
- **THEN** a resposta é 401
