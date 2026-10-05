## MODIFIED Requirements

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
