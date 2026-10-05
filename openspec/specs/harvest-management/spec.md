# harvest-management Specification

## Purpose

Criação, consulta e atualização de safras (talhão + cultivar + emergência), com escopo herdado do talhão, safra ativa única por talhão e transições de status.

## Requirements

### Requirement: Criação de safra
O sistema SHALL criar uma safra em `POST /api/v1/harvests` a partir de `fieldId`, `cultivarId`, `emergenceDate` (`YYYY-MM-DD`), `season` (`AAAA/AA`, anos consecutivos) e `notes` opcional, com `status` inicial `ACTIVE`. A rota MUST exigir os roles `AGRONOMO` ou `ADMIN` e a propriedade do talhão no escopo do usuário. `cultivarId` MUST ser uma cultivar visível ao usuário. Após criar, o sistema SHALL enfileirar o processamento do MSA (com ingestão da célula antes, se houver lacuna de cobertura) e responder 201 com a safra, incluindo `field` e `cultivar` resumidos e `msaJobId` (`null` se o enfileiramento falhar, sem desfazer a criação).

#### Scenario: Safra válida
- **WHEN** um `AGRONOMO` envia um talhão da sua propriedade, uma cultivar de referência, emergência passada e `season` `2025/26`
- **THEN** a resposta é 201 com `status` `ACTIVE`, `emergenceDate` no formato `YYYY-MM-DD`, `field.id`, `field.propertyId`, `cultivar.crop` e `msaJobId`

#### Scenario: Processamento automático
- **WHEN** a safra é criada e o worker está no ar
- **THEN** em algum momento `GET /api/v1/harvests/:id/msa` devolve uma run com `reason BACKFILL`

#### Scenario: Talhão fora do escopo
- **WHEN** o `fieldId` pertence a uma propriedade em que o usuário não é dono nem responsável
- **THEN** a resposta é 404 e nada é criado

#### Scenario: Produtor tenta criar
- **WHEN** um `PRODUTOR` chama `POST /api/v1/harvests` para um talhão da própria propriedade
- **THEN** a resposta é 403

#### Scenario: Cultivar invisível
- **WHEN** `cultivarId` é uma cultivar não-default criada por outro usuário
- **THEN** a resposta é 400 com o código `INVALID_CULTIVAR`

#### Scenario: Cultivar inexistente
- **WHEN** `cultivarId` não existe
- **THEN** a resposta é 400 com o código `INVALID_CULTIVAR`

#### Scenario: Formato de season inválido
- **WHEN** `season` é `2025`, `25/26` ou `2025/27`
- **THEN** a resposta é 400 identificando `season`

### Requirement: Data de emergência não futura
`emergenceDate` MUST ser uma data-calendário (`YYYY-MM-DD`) menor ou igual à data corrente em UTC do servidor; datas futuras MUST responder 400 com o código `EMERGENCE_DATE_IN_FUTURE`.

#### Scenario: Emergência hoje
- **WHEN** `emergenceDate` é a data corrente
- **THEN** a safra é criada

#### Scenario: Emergência amanhã
- **WHEN** `emergenceDate` é a data corrente mais um dia
- **THEN** a resposta é 400 com o código `EMERGENCE_DATE_IN_FUTURE`

#### Scenario: Data com hora
- **WHEN** `emergenceDate` é `2025-11-10T00:00:00Z`
- **THEN** a resposta é 400 identificando `emergenceDate`

### Requirement: Uma safra ativa por talhão
Um talhão MUST ter no máximo uma safra com `status` `ACTIVE`. Criar uma safra ou alterar o status de uma safra para `ACTIVE` quando já existe outra ativa no mesmo talhão MUST responder 409 com o código `FIELD_HAS_ACTIVE_HARVEST`. A verificação MUST ser serializada por talhão, de modo que requisições simultâneas não resultem em duas safras ativas.

#### Scenario: Segunda safra ativa
- **WHEN** o talhão já tem uma safra `ACTIVE` e um `POST` cria outra para o mesmo talhão
- **THEN** a resposta é 409 com `FIELD_HAS_ACTIVE_HARVEST`

#### Scenario: Nova safra após conclusão
- **WHEN** a safra anterior do talhão está `COMPLETED` ou `CANCELLED`
- **THEN** o `POST` de uma nova safra responde 201

#### Scenario: Reativação com outra ativa
- **WHEN** uma safra `CANCELLED` recebe `PATCH` com `status: ACTIVE` e o talhão já tem outra safra `ACTIVE`
- **THEN** a resposta é 409 com `FIELD_HAS_ACTIVE_HARVEST`

#### Scenario: Criações simultâneas
- **WHEN** duas requisições criam safras para o mesmo talhão ao mesmo tempo
- **THEN** no máximo uma responde 201 e o talhão termina com uma única safra `ACTIVE`

### Requirement: Consulta de safras
`GET /api/v1/harvests` SHALL listar as safras dos talhões cujas propriedades estão no escopo do usuário, com filtros opcionais `fieldId` e `status`; `fieldId` fora do escopo MUST responder 404. `GET /api/v1/harvests/:id` SHALL detalhar uma safra no escopo e responder 404 fora dele. `GET /api/v1/properties/:propertyId/fields/:fieldId/harvests` SHALL listar as safras do talhão, respondendo 404 se o talhão não pertence à propriedade ou se a propriedade está fora do escopo.

#### Scenario: Produtor lista as suas
- **WHEN** um `PRODUTOR` chama `GET /api/v1/harvests`
- **THEN** a resposta contém apenas safras de talhões das suas propriedades

#### Scenario: Filtro por status
- **WHEN** a listagem é chamada com `?status=ACTIVE`
- **THEN** todas as safras retornadas têm `status` `ACTIVE`

#### Scenario: Filtro por talhão fora do escopo
- **WHEN** um `AGRONOMO` chama `GET /api/v1/harvests?fieldId=` com um talhão de propriedade alheia
- **THEN** a resposta é 404

#### Scenario: Detalhe fora do escopo
- **WHEN** um usuário chama `GET /api/v1/harvests/:id` de uma safra de propriedade alheia
- **THEN** a resposta é 404

#### Scenario: Listagem aninhada
- **WHEN** um `PRODUTOR` chama `GET /api/v1/properties/:propertyId/fields/:fieldId/harvests` de um talhão seu
- **THEN** a resposta é 200 com as safras do talhão, da mais recente para a mais antiga por `emergenceDate`

#### Scenario: Talhão de outra propriedade no path
- **WHEN** `:fieldId` pertence a outra propriedade do mesmo usuário
- **THEN** a resposta é 404

#### Scenario: Administrador lista tudo
- **WHEN** um `ADMIN` chama `GET /api/v1/harvests`
- **THEN** a resposta contém safras de todas as propriedades não excluídas

### Requirement: Atualização de safra
`PATCH /api/v1/harvests/:id` SHALL aceitar `status`, `notes` e `season` (ao menos um), para `AGRONOMO` e `ADMIN` com a propriedade do talhão no escopo. `fieldId`, `cultivarId` e `emergenceDate` MUST NOT ser alteráveis. Qualquer transição entre `ACTIVE`, `COMPLETED` e `CANCELLED` é permitida, sujeita à regra de safra ativa única.

#### Scenario: Conclusão da safra
- **WHEN** um `AGRONOMO` envia `{ "status": "COMPLETED" }`
- **THEN** a resposta é 200 com `status` `COMPLETED`

#### Scenario: Cancelamento e reativação
- **WHEN** a safra é cancelada e depois recebe `{ "status": "ACTIVE" }` sem outra ativa no talhão
- **THEN** ambas as respostas são 200 e a safra termina `ACTIVE`

#### Scenario: Campo imutável
- **WHEN** o `PATCH` envia `emergenceDate` ou `cultivarId`
- **THEN** a resposta é 400 identificando o campo

#### Scenario: Produtor tenta atualizar
- **WHEN** um `PRODUTOR` envia `PATCH` para uma safra da própria propriedade
- **THEN** a resposta é 403

#### Scenario: Fora do escopo
- **WHEN** um `AGRONOMO` envia `PATCH` para uma safra de propriedade alheia
- **THEN** a resposta é 404

#### Scenario: Corpo vazio
- **WHEN** o `PATCH` não traz nenhum campo
- **THEN** a resposta é 400
