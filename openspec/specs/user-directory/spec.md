# user-directory Specification

## Purpose
Diretório mínimo de usuários (`GET /api/v1/users`) para a interface localizar o produtor dono de uma propriedade, com escopo por role (ADMIN qualquer role; AGRONOMO só PRODUTOR com termo ≥ 3 caracteres; PRODUTOR sem acesso).

## Requirements

### Requirement: Busca de usuários
O sistema SHALL oferecer `GET /api/v1/users?q=&role=&limit=` autenticado, devolvendo até `limit` (padrão 20, máximo 50) usuários com `id`, `name`, `email` e `role`, ordenados por nome, cujo nome ou e-mail contenha `q` (sem distinção de caixa). `ADMIN` MAY pesquisar qualquer role e sem `q`. `AGRONOMO` MUST receber apenas `PRODUTOR` (qualquer `role` informada diferente disso ⇒ 403 `FORBIDDEN`) e MUST informar `q` com no mínimo 3 caracteres (senão 400 `VALIDATION_ERROR`). `PRODUTOR` MUST receber 403.

#### Scenario: Admin lista produtores
- **WHEN** um `ADMIN` chama `GET /users?role=PRODUTOR`
- **THEN** recebe até 20 produtores ordenados por nome

#### Scenario: Agrônomo pesquisa
- **WHEN** um `AGRONOMO` chama `GET /users?q=ped`
- **THEN** recebe só usuários `PRODUTOR` cujo nome ou e-mail contém "ped"

#### Scenario: Agrônomo sem termo
- **WHEN** um `AGRONOMO` chama `GET /users` ou `GET /users?q=pe`
- **THEN** a resposta é 400 `VALIDATION_ERROR`

#### Scenario: Agrônomo pede outra role
- **WHEN** um `AGRONOMO` chama `GET /users?q=ana&role=AGRONOMO`
- **THEN** a resposta é 403 `FORBIDDEN`

#### Scenario: Produtor
- **WHEN** um `PRODUTOR` chama `GET /users?q=abc`
- **THEN** a resposta é 403
