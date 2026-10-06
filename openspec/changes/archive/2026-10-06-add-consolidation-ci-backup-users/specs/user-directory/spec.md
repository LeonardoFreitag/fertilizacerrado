## MODIFIED Requirements

### Requirement: Busca de usuários
O sistema SHALL oferecer `GET /api/v1/users?q=&role=&active=&page=&pageSize=` autenticado, devolvendo `{ items, page, pageSize, total }` com `pageSize` padrão 20 e máximo 50, ordenado por nome, filtrando por nome ou e-mail contendo `q` (sem distinção de caixa), por `role` e por `active`. Para `ADMIN` os itens MUST trazer `id`, `name`, `email`, `role`, `active`, `emailVerified`, `phone`, `crea`, documento mascarado e `createdAt`, e `ADMIN` MAY pesquisar sem `q`. `AGRONOMO` MUST receber apenas `PRODUTOR` ativos com `id`, `name`, `email` e `role` (qualquer `role` informada diferente de `PRODUTOR` ⇒ 403 `FORBIDDEN`) e MUST informar `q` com no mínimo 3 caracteres (senão 400 `VALIDATION_ERROR`). `PRODUTOR` MUST receber 403.

#### Scenario: Admin lista produtores
- **WHEN** um `ADMIN` chama `GET /users?role=PRODUTOR`
- **THEN** recebe `items` com até 20 produtores ordenados por nome, `total` com a contagem e os campos administrativos

#### Scenario: Paginação
- **WHEN** um `ADMIN` chama `GET /users?page=2&pageSize=10` com 25 usuários
- **THEN** recebe 10 itens (do 11º ao 20º) e `total = 25`

#### Scenario: Filtro de ativos
- **WHEN** um `ADMIN` chama `GET /users?active=false`
- **THEN** recebe só usuários desativados

#### Scenario: Agrônomo pesquisa
- **WHEN** um `AGRONOMO` chama `GET /users?q=ped`
- **THEN** recebe só usuários `PRODUTOR` ativos cujo nome ou e-mail contém "ped", sem campos administrativos

#### Scenario: Agrônomo sem termo
- **WHEN** um `AGRONOMO` chama `GET /users` ou `GET /users?q=pe`
- **THEN** a resposta é 400 `VALIDATION_ERROR`

#### Scenario: Agrônomo pede outra role
- **WHEN** um `AGRONOMO` chama `GET /users?q=ana&role=AGRONOMO`
- **THEN** a resposta é 403 `FORBIDDEN`

#### Scenario: Produtor
- **WHEN** um `PRODUTOR` chama `GET /users?q=abc`
- **THEN** a resposta é 403
