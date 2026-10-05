## MODIFIED Requirements

### Requirement: Exclusão de talhão
O sistema SHALL remover fisicamente um talhão em `DELETE .../fields/:id` para `AGRONOMO` e `ADMIN` com a propriedade no escopo, removendo também o registro em `era5_cells`. Talhão com safra `ACTIVE` MUST responder 409 com o código `FIELD_HAS_ACTIVE_HARVEST`; talhão com safras apenas históricas (`COMPLETED` ou `CANCELLED`) MUST responder 409 com o código `FIELD_HAS_HARVESTS`. A chave estrangeira de safras para talhões MUST ser `RESTRICT`.

#### Scenario: Exclusão
- **WHEN** um `AGRONOMO` chama `DELETE` em um talhão da sua propriedade sem safras
- **THEN** a resposta é 204, o talhão não existe mais em `fields` e não há linha em `era5_cells` para ele

#### Scenario: Talhão inexistente
- **WHEN** o `DELETE` referencia um id que não existe na propriedade
- **THEN** a resposta é 404

#### Scenario: Produtor tenta excluir
- **WHEN** um `PRODUTOR` chama `DELETE` em um talhão da própria propriedade
- **THEN** a resposta é 403

#### Scenario: Talhão com safra ativa
- **WHEN** o talhão tem uma safra `ACTIVE` e um `AGRONOMO` chama `DELETE`
- **THEN** a resposta é 409 com `FIELD_HAS_ACTIVE_HARVEST` e o talhão permanece

#### Scenario: Talhão com safra concluída
- **WHEN** o talhão tem apenas safras `COMPLETED` ou `CANCELLED` e um `AGRONOMO` chama `DELETE`
- **THEN** a resposta é 409 com `FIELD_HAS_HARVESTS` e o talhão permanece
