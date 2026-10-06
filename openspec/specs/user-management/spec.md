# user-management Specification

## Purpose
Gestão de usuários: leitura e edição por role, desativação/reativação com proteção do último administrador, reenvio da verificação de e-mail (ADMIN e público com limite), troca de senha e telas `/admin/usuarios` e `/perfil`.

## Requirements

### Requirement: Leitura e edição de usuários
`GET /api/v1/users/:id` SHALL devolver o usuário para `ADMIN` ou para o próprio usuário (`id`, `name`, `email`, `role`, `active`, `emailVerified`, `phone`, `crea`, documento mascarado, `createdAt`); demais ⇒ 404. `PATCH /api/v1/users/:id` SHALL permitir a `ADMIN` alterar `name`, `phone`, `crea`, `role` e `active`, e ao próprio usuário alterar `name`, `phone` e `crea` (outros campos ⇒ 403 `FORBIDDEN_FIELDS`); `email`, `cpf` e `cnpj` MUST NOT ser alteráveis.

#### Scenario: Próprio perfil
- **WHEN** um `AGRONOMO` chama `GET /users/<seu id>`
- **THEN** recebe 200 com seus dados

#### Scenario: Outro usuário
- **WHEN** um `AGRONOMO` chama `GET /users/<id de outro>`
- **THEN** a resposta é 404

#### Scenario: Autoedição restrita
- **WHEN** um `PRODUTOR` envia `PATCH /users/<seu id>` com `role: "ADMIN"`
- **THEN** a resposta é 403 `FORBIDDEN_FIELDS` e nada muda

#### Scenario: Admin troca role
- **WHEN** um `ADMIN` envia `PATCH /users/:id` com `role: "AGRONOMO"` para um produtor
- **THEN** a resposta é 200 e o usuário passa a `AGRONOMO`

### Requirement: Desativação e reativação
`POST /api/v1/users/:id/deactivate` e `POST /api/v1/users/:id/reactivate` (ADMIN) SHALL alternar `active`. Desativar MUST zerar o refresh token do usuário (revogação imediata) e MUST NOT apagar nada: propriedades, decisões e runs mantêm a referência. Usuário inativo MUST receber 403 `USER_INACTIVE` no login e 401 no refresh e em `GET /auth/me`. `ADMIN` MUST NOT desativar a si mesmo nem desativar/rebaixar o último `ADMIN` ativo (409 `LAST_ADMIN`).

#### Scenario: Desativar agrônomo
- **WHEN** o admin desativa um agrônomo com sessão aberta
- **THEN** o próximo `POST /auth/refresh` dele responde 401, o login responde 403 `USER_INACTIVE` e suas propriedades continuam listando-o como agrônomo

#### Scenario: Reativar
- **WHEN** o admin reativa o usuário
- **THEN** o login volta a funcionar sem nova verificação de e-mail

#### Scenario: Último admin
- **WHEN** o único `ADMIN` ativo tenta desativar a si mesmo ou mudar seu próprio role
- **THEN** a resposta é 409 `LAST_ADMIN`

#### Scenario: Segundo admin
- **WHEN** existem dois admins ativos e um desativa o outro
- **THEN** a resposta é 200

### Requirement: Reenvio da verificação de e-mail
`POST /api/v1/auth/resend-verification { email }` (público) SHALL responder 200 com a mesma mensagem exista ou não a conta; quando a conta existe, está ativa e não verificada, SHALL enviar um novo e-mail de verificação. O endpoint MUST limitar a 3 pedidos por hora por e-mail (Redis), respondendo 429 `TOO_MANY_REQUESTS` com `Retry-After` acima disso. `POST /api/v1/users/:id/resend-verification` (ADMIN) SHALL reenviar sem limite, respondendo 204, ou 409 `ALREADY_VERIFIED`.

#### Scenario: Conta não verificada
- **WHEN** o e-mail pertence a uma conta não verificada
- **THEN** a resposta é 200 e um link `verificar-email/<token>` novo aparece no log/e-mail

#### Scenario: Conta inexistente
- **WHEN** o e-mail não existe
- **THEN** a resposta é 200 com a mesma mensagem e nenhum e-mail é enviado

#### Scenario: Limite
- **WHEN** o mesmo e-mail pede reenvio pela quarta vez em uma hora
- **THEN** a resposta é 429 com `Retry-After`

#### Scenario: Admin reenvia para verificado
- **WHEN** o admin chama `/users/:id/resend-verification` de um usuário já verificado
- **THEN** a resposta é 409 `ALREADY_VERIFIED`

### Requirement: Troca de senha
`PATCH /api/v1/users/me/password { currentPassword, newPassword }` SHALL exigir a senha atual (401 `INVALID_CREDENTIALS` se errada), validar a nova com as regras de cadastro, gravar o novo hash, zerar o refresh token e responder 204.

#### Scenario: Troca válida
- **WHEN** a senha atual confere e a nova é válida
- **THEN** a resposta é 204, o login com a nova senha funciona e o refresh antigo responde 401

#### Scenario: Senha atual errada
- **WHEN** a senha atual não confere
- **THEN** a resposta é 401 `INVALID_CREDENTIALS` e nada muda

### Requirement: Páginas de usuários e perfil
`/admin/usuarios` (ADMIN) SHALL listar os usuários com busca, filtros de role e ativo e paginação, e oferecer **Editar** (nome, telefone, CREA, role), **Desativar/Reativar** (com confirmação; `LAST_ADMIN` mapeado) e **Reenviar verificação** (só para não verificados). `/perfil` SHALL mostrar os dados do usuário autenticado com edição de nome, telefone e CREA, role e status de verificação, e o formulário de troca de senha.

#### Scenario: Desativar pela interface
- **WHEN** o admin confirma a desativação de um agrônomo
- **THEN** a linha passa a "inativo" e o agrônomo não consegue mais entrar

#### Scenario: Último admin pela interface
- **WHEN** o admin tenta desativar a si mesmo
- **THEN** o toast mostra "Não é possível desativar o último administrador ativo"

#### Scenario: Troca de senha no perfil
- **WHEN** o usuário informa a senha atual e uma nova válida
- **THEN** vê a confirmação e continua logado
