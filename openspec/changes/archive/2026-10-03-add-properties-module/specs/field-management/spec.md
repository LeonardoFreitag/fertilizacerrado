## ADDED Requirements

### Requirement: Cadastro de talhão com polígono
O sistema SHALL criar um talhão em `POST /api/v1/properties/:propertyId/fields` a partir de `name`, `geometry` (GeoJSON `Polygon`) e, opcionalmente, `areaHa`, `soilType` e `notes`. A rota MUST exigir os roles `AGRONOMO` ou `ADMIN` e a propriedade no escopo do usuário. A geometria MUST ser armazenada como `geography(Polygon,4326)`. Em sucesso o sistema SHALL responder 201 com o talhão, incluindo `geometry` e `centroid` em GeoJSON e `areaHa` numérico.

#### Scenario: Talhão válido
- **WHEN** um `AGRONOMO` envia nome e um `Polygon` válido para uma propriedade no seu escopo
- **THEN** a resposta é 201 com `geometry` igual ao polígono enviado, `centroid` do tipo `Point` e `areaHa` maior que zero

#### Scenario: Propriedade fora do escopo
- **WHEN** um `AGRONOMO` envia um talhão para uma propriedade em que não é dono nem responsável
- **THEN** a resposta é 404 e nada é criado

#### Scenario: Produtor tenta cadastrar
- **WHEN** um `PRODUTOR` chama `POST .../fields` na própria propriedade
- **THEN** a resposta é 403

#### Scenario: Geometria ausente
- **WHEN** o corpo não traz `geometry`
- **THEN** a resposta é 400 identificando o campo `geometry`

### Requirement: Validação do GeoJSON
O sistema SHALL validar `geometry` antes de persistir: `type` MUST ser `"Polygon"`; `coordinates` MUST ter de 1 a 50 anéis, cada um com 4 a 10.000 posições `[lon, lat]`, com `lon` em [-180, 180] e `lat` em [-90, 90], e com a primeira posição igual à última. Geometrias que passam nessa validação mas são topologicamente inválidas segundo `ST_IsValid` ou têm área zero MUST ser rejeitadas com 400 e o código `INVALID_GEOMETRY`.

#### Scenario: Tipo diferente de Polygon
- **WHEN** `geometry.type` é `MultiPolygon` ou `Point`
- **THEN** a resposta é 400 identificando `geometry`

#### Scenario: Anel não fechado
- **WHEN** a primeira e a última posição de um anel são diferentes
- **THEN** a resposta é 400 identificando `geometry`

#### Scenario: Coordenada fora do intervalo
- **WHEN** alguma posição tem `lat` igual a 95 ou `lon` igual a -200
- **THEN** a resposta é 400 identificando `geometry`

#### Scenario: Anel com menos de 4 posições
- **WHEN** um anel tem 3 posições
- **THEN** a resposta é 400 identificando `geometry`

#### Scenario: Polígono com auto-interseção
- **WHEN** o anel externo forma um "laço" (figura em 8) e passa na validação estrutural
- **THEN** a resposta é 400 com o código `INVALID_GEOMETRY` e a razão informada pelo PostGIS

#### Scenario: Altitude descartada
- **WHEN** as posições trazem um terceiro valor `[lon, lat, alt]`
- **THEN** o talhão é criado e `geometry` na resposta tem apenas `[lon, lat]`

### Requirement: Área e centróide calculados pelo PostGIS
O sistema SHALL calcular `areaHa` como `ST_Area(geometry) / 10000` quando o campo não é informado e SHALL aceitar o valor informado quando presente, desde que entre 0,01 e 1.000.000. O `centroid` MUST ser calculado por `ST_Centroid` e persistido como `geography(Point,4326)` em toda criação ou alteração de geometria.

#### Scenario: Área calculada
- **WHEN** um talhão é criado sem `areaHa` com um quadrado de aproximadamente 1 km de lado
- **THEN** `areaHa` na resposta fica entre 99 e 101

#### Scenario: Área informada
- **WHEN** um talhão é criado com `areaHa` igual a 85.5
- **THEN** `areaHa` na resposta é 85.5, independentemente da área do polígono

#### Scenario: Área informada fora do limite
- **WHEN** `areaHa` é 0 ou 2.000.000
- **THEN** a resposta é 400 identificando `areaHa`

#### Scenario: Centróide dentro do polígono
- **WHEN** um talhão é criado com um polígono convexo
- **THEN** `centroid.coordinates` está dentro da caixa envolvente do polígono e `ST_Within(centroid::geometry, geometry::geometry)` é verdadeiro no banco

### Requirement: Consulta de talhões
O sistema SHALL listar os talhões de uma propriedade em `GET /api/v1/properties/:propertyId/fields` e detalhar um talhão em `GET .../fields/:id`, para qualquer usuário autenticado com a propriedade no seu escopo. Talhão que não pertence à propriedade do path MUST responder 404.

#### Scenario: Produtor lista seus talhões
- **WHEN** um `PRODUTOR` chama `GET .../fields` em uma propriedade sua
- **THEN** a resposta é 200 com os talhões da propriedade, cada um com `geometry`, `centroid`, `areaHa` e `era5Cell`

#### Scenario: Propriedade fora do escopo
- **WHEN** um `PRODUTOR` chama `GET .../fields` em uma propriedade de outro dono
- **THEN** a resposta é 404

#### Scenario: Talhão de outra propriedade
- **WHEN** `:id` pertence a um talhão de outra propriedade do mesmo usuário
- **THEN** a resposta é 404

#### Scenario: Detalhe
- **WHEN** um usuário chama `GET .../fields/:id` de um talhão no seu escopo
- **THEN** a resposta é 200 com todos os campos do talhão

### Requirement: Atualização de talhão
O sistema SHALL atualizar parcialmente um talhão em `PATCH .../fields/:id`, aceitando `name`, `areaHa`, `soilType`, `notes` e `geometry`, para `AGRONOMO` e `ADMIN` com a propriedade no escopo. Quando `geometry` é enviada, o centróide MUST ser recalculado e a área MUST ser recalculada apenas se `areaHa` não vier no mesmo corpo. Quando `geometry` não é enviada, geometria, centróide e célula ERA5 MUST permanecer inalterados.

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

#### Scenario: Produtor tenta atualizar
- **WHEN** um `PRODUTOR` envia `PATCH` para um talhão da própria propriedade
- **THEN** a resposta é 403

### Requirement: Exclusão de talhão
O sistema SHALL remover fisicamente um talhão em `DELETE .../fields/:id` para `AGRONOMO` e `ADMIN` com a propriedade no escopo, removendo também o registro em `era5_cells`. O service MUST passar por um ponto único de verificação de exclusão, onde a futura regra de safras ativas será aplicada.

#### Scenario: Exclusão
- **WHEN** um `AGRONOMO` chama `DELETE` em um talhão da sua propriedade
- **THEN** a resposta é 204, o talhão não existe mais em `fields` e não há linha em `era5_cells` para ele

#### Scenario: Talhão inexistente
- **WHEN** o `DELETE` referencia um id que não existe na propriedade
- **THEN** a resposta é 404

#### Scenario: Produtor tenta excluir
- **WHEN** um `PRODUTOR` chama `DELETE` em um talhão da própria propriedade
- **THEN** a resposta é 403
