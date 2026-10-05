## MODIFIED Requirements

### Requirement: Cadastro de talhão com polígono
O sistema SHALL criar um talhão em `POST /api/v1/properties/:propertyId/fields` a partir de `name`, `geometry` (GeoJSON `Polygon`) e, opcionalmente, `areaHa`, `soilType`, `notes`, `altitudeM` (metros, em [−100, 5000]), `thetaFC` e `thetaWP` (m³/m³, em (0, 1), com `thetaFC > thetaWP` quando ambos presentes). A rota MUST exigir os roles `AGRONOMO` ou `ADMIN` e a propriedade no escopo do usuário. A geometria MUST ser armazenada como `geography(Polygon,4326)`. Em sucesso o sistema SHALL responder 201 com o talhão, incluindo `geometry` e `centroid` em GeoJSON, `areaHa` numérico e `altitudeM`, `thetaFC`, `thetaWP`.

#### Scenario: Talhão válido
- **WHEN** um `AGRONOMO` envia nome e um `Polygon` válido para uma propriedade no seu escopo
- **THEN** a resposta é 201 com `geometry` igual ao polígono enviado, `centroid` do tipo `Point`, `areaHa` maior que zero e `altitudeM`, `thetaFC`, `thetaWP` nulos

#### Scenario: Talhão com altitude e solo
- **WHEN** o corpo traz `altitudeM 741`, `thetaFC 0.30` e `thetaWP 0.14`
- **THEN** a resposta é 201 com os três valores

#### Scenario: Teores de água invertidos
- **WHEN** o corpo traz `thetaFC 0.12` e `thetaWP 0.28`
- **THEN** a resposta é 400 identificando `thetaFC`

#### Scenario: Propriedade fora do escopo
- **WHEN** um `AGRONOMO` envia um talhão para uma propriedade em que não é dono nem responsável
- **THEN** a resposta é 404 e nada é criado

#### Scenario: Produtor tenta cadastrar
- **WHEN** um `PRODUTOR` chama `POST .../fields` na própria propriedade
- **THEN** a resposta é 403

#### Scenario: Geometria ausente
- **WHEN** o corpo não traz `geometry`
- **THEN** a resposta é 400 identificando o campo `geometry`

### Requirement: Atualização de talhão
O sistema SHALL atualizar parcialmente um talhão em `PATCH .../fields/:id`, aceitando `name`, `areaHa`, `soilType`, `notes`, `geometry`, `altitudeM`, `thetaFC` e `thetaWP` (os três últimos anuláveis), para `AGRONOMO` e `ADMIN` com a propriedade no escopo. Quando `geometry` é enviada, o centróide MUST ser recalculado e a área MUST ser recalculada apenas se `areaHa` não vier no mesmo corpo. Quando `geometry` não é enviada, geometria, centróide e célula ERA5 MUST permanecer inalterados. `thetaFC > thetaWP` MUST ser validado sobre o estado resultante.

#### Scenario: Atualização só de nome
- **WHEN** o `PATCH` envia apenas `name`
- **THEN** a resposta é 200 com o novo nome e `geometry`, `centroid`, `areaHa` e `era5Cell` iguais aos anteriores

#### Scenario: Nova geometria sem área
- **WHEN** o `PATCH` envia `geometry` com o dobro da área e nenhum `areaHa`
- **THEN** `areaHa` e `centroid` na resposta refletem o novo polígono

#### Scenario: Nova geometria com área informada
- **WHEN** o `PATCH` envia `geometry` e `areaHa`
- **THEN** `centroid` reflete o novo polígono e `areaHa` é o valor informado

#### Scenario: Geometria inválida no PATCH
- **WHEN** o `PATCH` envia um `Polygon` com auto-interseção
- **THEN** a resposta é 400 com `INVALID_GEOMETRY` e o talhão permanece inalterado

#### Scenario: Altitude e solo no PATCH
- **WHEN** o `PATCH` envia `altitudeM 741` e depois `altitudeM: null`
- **THEN** a primeira resposta tem `altitudeM 741` e a segunda `altitudeM` nulo

#### Scenario: PATCH que inverte os teores
- **WHEN** o talhão tem `thetaFC 0.28`, `thetaWP 0.12` e o `PATCH` envia só `thetaWP 0.30`
- **THEN** a resposta é 400 identificando `thetaWP` e o talhão permanece inalterado

#### Scenario: Produtor tenta atualizar
- **WHEN** um `PRODUTOR` envia `PATCH` para um talhão da própria propriedade
- **THEN** a resposta é 403
