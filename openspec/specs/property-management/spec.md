# property-management Specification

## Purpose

Cadastro, consulta, atualização e exclusão lógica de propriedades rurais, com controle de acesso por dono, responsável técnico e role.

## Requirements

### Requirement: Cadastro de propriedade
O sistema SHALL criar uma propriedade em `POST /api/v1/properties` a partir de `name`, `state`, `city` e, opcionalmente, `car`, `nirf`, `ownerId` e `agronomistId`. A rota MUST exigir autenticação e os roles `AGRONOMO` ou `ADMIN`. `state` MUST ser uma das 27 siglas de UF. Em sucesso o sistema SHALL responder 201 com a propriedade criada.

#### Scenario: Agrônomo cria para si
- **WHEN** um `AGRONOMO` envia nome, UF e município sem `ownerId`
- **THEN** a resposta é 201 e a propriedade tem `ownerId` igual ao id do agrônomo e `agronomistId` nulo

#### Scenario: Agrônomo cria para um produtor
- **WHEN** um `AGRONOMO` envia `ownerId` de um `PRODUTOR` existente sem `agronomistId`
- **THEN** a resposta é 201 e a propriedade tem `ownerId` igual ao produtor e `agronomistId` igual ao agrônomo

#### Scenario: Agrônomo se exclui da propriedade
- **WHEN** um `AGRONOMO` envia `ownerId` de outro usuário e `agronomistId` de outro agrônomo
- **THEN** a resposta é 400 com o código `AGRONOMIST_WITHOUT_ACCESS` e nada é criado

#### Scenario: Administrador sem dono
- **WHEN** um `ADMIN` envia o cadastro sem `ownerId`
- **THEN** a resposta é 400 identificando o campo `ownerId`

#### Scenario: Dono inexistente ou com role inválido
- **WHEN** `ownerId` não existe ou pertence a um `ADMIN`
- **THEN** a resposta é 400 com o código `INVALID_OWNER`

#### Scenario: Responsável técnico que não é agrônomo
- **WHEN** `agronomistId` pertence a um usuário com role diferente de `AGRONOMO`
- **THEN** a resposta é 400 com o código `INVALID_AGRONOMIST`

#### Scenario: UF inválida
- **WHEN** `state` é `XX` ou está em minúsculas
- **THEN** a resposta é 400 identificando o campo `state`

#### Scenario: Produtor tenta criar
- **WHEN** um `PRODUTOR` chama `POST /api/v1/properties`
- **THEN** a resposta é 403

#### Scenario: Sem autenticação
- **WHEN** a requisição não traz access token
- **THEN** a resposta é 401

### Requirement: Escopo de acesso às propriedades
O sistema SHALL restringir as propriedades visíveis e operáveis por usuário: `PRODUTOR` apenas as que têm `ownerId` igual ao seu id; `AGRONOMO` as que têm `ownerId` ou `agronomistId` igual ao seu id; `ADMIN` todas. Propriedades excluídas MUST ser tratadas como inexistentes. Uma propriedade fora do escopo MUST responder 404 em qualquer rota que a referencie.

#### Scenario: Listagem do produtor
- **WHEN** um `PRODUTOR` chama `GET /api/v1/properties`
- **THEN** a resposta é 200 contendo apenas propriedades com `ownerId` igual ao seu id

#### Scenario: Listagem do agrônomo
- **WHEN** um `AGRONOMO` chama `GET /api/v1/properties`
- **THEN** a resposta contém as propriedades em que ele é `ownerId` ou `agronomistId` e nenhuma outra

#### Scenario: Listagem do administrador
- **WHEN** um `ADMIN` chama `GET /api/v1/properties`
- **THEN** a resposta contém todas as propriedades não excluídas

#### Scenario: Detalhe fora do escopo
- **WHEN** um `PRODUTOR` chama `GET /api/v1/properties/:id` de uma propriedade de outro dono
- **THEN** a resposta é 404

#### Scenario: Detalhe no escopo
- **WHEN** um usuário chama `GET /api/v1/properties/:id` de uma propriedade no seu escopo
- **THEN** a resposta é 200 com os dados da propriedade, `owner` e `agronomist` resumidos e `fieldsCount`

#### Scenario: Id malformado
- **WHEN** `:id` não é um UUID
- **THEN** a resposta é 400

### Requirement: Atualização de propriedade
O sistema SHALL atualizar parcialmente uma propriedade em `PATCH /api/v1/properties/:id`, aceitando `name`, `state`, `city`, `car` e `nirf` de `AGRONOMO` (com a propriedade no seu escopo) e `ADMIN`. `ownerId` e `agronomistId` MUST ser alteráveis apenas por `ADMIN`, com as mesmas validações do cadastro.

#### Scenario: Agrônomo atualiza dados cadastrais
- **WHEN** um `AGRONOMO` envia `{ "name": "Fazenda Nova" }` para uma propriedade no seu escopo
- **THEN** a resposta é 200 com o nome atualizado e os demais campos inalterados

#### Scenario: Agrônomo tenta trocar o dono
- **WHEN** um `AGRONOMO` envia `ownerId` ou `agronomistId` no `PATCH`
- **THEN** a resposta é 400 com o código `FORBIDDEN_FIELDS` e nada é alterado

#### Scenario: Administrador troca o responsável técnico
- **WHEN** um `ADMIN` envia `agronomistId` de um `AGRONOMO` existente
- **THEN** a resposta é 200 e a propriedade passa a ter o novo `agronomistId`

#### Scenario: Remoção do responsável técnico
- **WHEN** um `ADMIN` envia `agronomistId` igual a `null`
- **THEN** a resposta é 200 e `agronomistId` fica nulo

#### Scenario: Propriedade fora do escopo
- **WHEN** um `AGRONOMO` envia `PATCH` para uma propriedade em que não é dono nem responsável
- **THEN** a resposta é 404

#### Scenario: Produtor tenta atualizar
- **WHEN** um `PRODUTOR` envia `PATCH` para a própria propriedade
- **THEN** a resposta é 403

#### Scenario: Corpo vazio
- **WHEN** o `PATCH` não traz nenhum campo
- **THEN** a resposta é 400

### Requirement: Exclusão lógica de propriedade
O sistema SHALL excluir logicamente uma propriedade em `DELETE /api/v1/properties/:id`, gravando `deletedAt` sem remover a linha. A rota MUST ser restrita a `ADMIN`. Após a exclusão, a propriedade e seus talhões MUST deixar de aparecer em todas as rotas.

#### Scenario: Exclusão pelo administrador
- **WHEN** um `ADMIN` chama `DELETE` em uma propriedade existente
- **THEN** a resposta é 204, a linha permanece no banco com `deletedAt` preenchido e `GET /api/v1/properties/:id` passa a responder 404

#### Scenario: Talhões da propriedade excluída
- **WHEN** a propriedade foi excluída e um usuário chama `GET /api/v1/properties/:id/fields`
- **THEN** a resposta é 404

#### Scenario: Exclusão repetida
- **WHEN** o `DELETE` é chamado novamente para a mesma propriedade
- **THEN** a resposta é 404

#### Scenario: Agrônomo tenta excluir
- **WHEN** um `AGRONOMO` chama `DELETE` em uma propriedade sua
- **THEN** a resposta é 403
