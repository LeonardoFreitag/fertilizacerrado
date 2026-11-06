## MODIFIED Requirements

### Requirement: Criação de safra
O sistema SHALL criar uma safra em `POST /api/v1/harvests` a partir de `fieldId`, `cultivarId`, `emergenceDate` (`YYYY-MM-DD`), `season` (`AAAA/AA`, anos consecutivos), `expectedYield` opcional (produtividade potencial em sc/ha, número finito `> 0` e `≤ EXPECTED_YIELD_MAX_SC_HA`, constante nomeada igual a 250) e `notes` opcional, com `status` inicial `ACTIVE`. A rota MUST exigir os roles `AGRONOMO` ou `ADMIN` e a propriedade do talhão no escopo do usuário. `cultivarId` MUST ser uma cultivar visível ao usuário. Após criar, o sistema SHALL enfileirar o processamento do MSA (com ingestão da célula antes, se houver lacuna de cobertura) e responder 201 com a safra, incluindo `expectedYield`, `field` e `cultivar` resumidos e `msaJobId` (`null` se o enfileiramento falhar, sem desfazer a criação).

#### Scenario: Safra válida
- **WHEN** um `AGRONOMO` envia um talhão da sua propriedade, uma cultivar de referência, emergência passada, `season` `2025/26` e `expectedYield 65`
- **THEN** a resposta é 201 com `status` `ACTIVE`, `expectedYield 65`, `emergenceDate` no formato `YYYY-MM-DD`, `field.id`, `field.propertyId`, `cultivar.crop` e `msaJobId`

#### Scenario: Safra sem produtividade potencial
- **WHEN** o corpo não traz `expectedYield`
- **THEN** a resposta é 201 com `expectedYield` nulo

#### Scenario: Produtividade potencial inválida
- **WHEN** `expectedYield` é `0`, `-10`, `300` ou `"alta"`
- **THEN** a resposta é 400 identificando `expectedYield`

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

### Requirement: Atualização de safra
`PATCH /api/v1/harvests/:id` SHALL aceitar `status`, `notes`, `season` e `expectedYield` (ao menos um; `expectedYield` número finito `> 0` e `≤ EXPECTED_YIELD_MAX_SC_HA` (250), ou `null` para limpar), para `AGRONOMO` e `ADMIN` com a propriedade do talhão no escopo. `fieldId`, `cultivarId` e `emergenceDate` MUST NOT ser alteráveis. Qualquer transição entre `ACTIVE`, `COMPLETED` e `CANCELLED` é permitida, sujeita à regra de safra ativa única. Alterar `expectedYield` MUST NOT alterar runs existentes do MSA.

#### Scenario: Conclusão da safra
- **WHEN** um `AGRONOMO` envia `{ "status": "COMPLETED" }`
- **THEN** a resposta é 200 com `status` `COMPLETED`

#### Scenario: Informar a produtividade potencial
- **WHEN** um `AGRONOMO` envia `{ "expectedYield": 65 }` para uma safra sem Ym
- **THEN** a resposta é 200 com `expectedYield 65` e a última run do MSA permanece inalterada

#### Scenario: Limpar a produtividade potencial
- **WHEN** o `PATCH` envia `{ "expectedYield": null }`
- **THEN** a resposta é 200 com `expectedYield` nulo

#### Scenario: Produtividade potencial inválida
- **WHEN** o `PATCH` envia `{ "expectedYield": -5 }`
- **THEN** a resposta é 400 identificando `expectedYield`

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
