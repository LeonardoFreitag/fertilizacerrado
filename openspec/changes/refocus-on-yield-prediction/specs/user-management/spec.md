## MODIFIED Requirements

### Requirement: Desativação e reativação
`POST /api/v1/users/:id/deactivate` e `POST /api/v1/users/:id/reactivate` (ADMIN) SHALL alternar `active`. Desativar MUST zerar o refresh token do usuário (revogação imediata) e MUST NOT apagar nada: propriedades e runs mantêm a referência. Usuário inativo MUST receber 403 `USER_INACTIVE` no login e 401 no refresh e em `GET /auth/me`. `ADMIN` MUST NOT desativar a si mesmo nem desativar/rebaixar o último `ADMIN` ativo (409 `LAST_ADMIN`).

#### Scenario: Desativar agrônomo
- **WHEN** o admin desativa um agrônomo com sessão aberta
- **THEN** o próximo `POST /auth/refresh` dele responde 401, o login responde 403 `USER_INACTIVE` e suas propriedades continuam listando-o como agrônomo

#### Scenario: Runs mantêm quem disparou
- **WHEN** o admin desativa um agrônomo que disparou runs do MSA
- **THEN** as runs continuam com o `triggeredById` dele

#### Scenario: Reativar
- **WHEN** o admin reativa o usuário
- **THEN** o login volta a funcionar sem nova verificação de e-mail

#### Scenario: Último admin
- **WHEN** o único `ADMIN` ativo tenta desativar a si mesmo ou mudar seu próprio role
- **THEN** a resposta é 409 `LAST_ADMIN`

#### Scenario: Segundo admin
- **WHEN** existem dois admins ativos e um desativa o outro
- **THEN** a resposta é 200
