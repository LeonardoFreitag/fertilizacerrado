## ADDED Requirements

### Requirement: Editor de talhão com mapa
`/propriedades/:id/talhoes/novo` e `/propriedades/:id/talhoes/:fieldId/editar` SHALL exibir um mapa (react-leaflet) com camadas **OpenStreetMap** e **Imagem de satélite (Esri World Imagery)** selecionáveis, ferramentas de desenho e edição de polígono (leaflet-geoman) limitadas a um polígono por talhão, e o formulário com nome (obrigatório), tipo de solo, observações, altitude (m) destacada como "obrigatória para o MSA", θFC e θWP com os valores sugeridos 0,28 e 0,12 e explicação curta (capacidade de campo e ponto de murcha, m³/m³; θFC > θWP). A área MUST ser calculada em hectares a partir do polígono (geodésica) e exibida em tempo real; o usuário MAY sobrescrevê-la, e só nesse caso `areaHa` é enviado. A geometria MUST ser enviada como GeoJSON `Polygon` com anel fechado em `[lon, lat]`. Na edição, o polígono existente MUST ser carregado e editável.

#### Scenario: Desenho e área
- **WHEN** o usuário desenha um retângulo de ~0,01° × 0,01° em Goiânia
- **THEN** o campo área mostra aproximadamente 1,2 ha (calculado) e o envio não inclui `areaHa`

#### Scenario: Área sobrescrita
- **WHEN** o usuário altera a área para 1,5
- **THEN** `areaHa: 1.5` é enviado junto com a geometria

#### Scenario: Camadas
- **WHEN** o usuário seleciona "Imagem de satélite"
- **THEN** os tiles da Esri World Imagery são exibidos com a atribuição

#### Scenario: Segundo polígono
- **WHEN** o usuário desenha outro polígono havendo um
- **THEN** o sistema pede confirmação e substitui o anterior

#### Scenario: Validação local
- **WHEN** θFC = 0,10 e θWP = 0,12
- **THEN** o campo θFC mostra "deve ser maior que θWP" e nada é enviado

#### Scenario: Sem polígono
- **WHEN** o usuário tenta salvar sem desenhar
- **THEN** o mapa mostra "Desenhe o talhão no mapa" e nada é enviado

### Requirement: Erros de geometria exibidos no mapa
Quando a API responder 400 `INVALID_GEOMETRY` (ou `VALIDATION_ERROR` com `path` em `geometry`), a razão devolvida SHALL ser exibida em um painel sobre o mapa, mantendo o polígono desenhado para correção.

#### Scenario: Polígono autointersectante
- **WHEN** a API responde `INVALID_GEOMETRY` com a razão "Self-intersection"
- **THEN** o painel sobre o mapa mostra a razão e o polígono continua editável

### Requirement: Detalhe do talhão
`/propriedades/:id/talhoes/:fieldId` SHALL mostrar o polígono no mapa (ajustado ao seu limite), o marcador do centróide com suas coordenadas, o retângulo da célula ERA5 atribuída (0,1° em torno de `era5Cell`, com lat/lon exibidas) ou o aviso de célula ausente, área, solo, observações, altitude (com destaque quando ausente), θFC/θWP (indicando quando serão usados os defaults) e as ações Editar e Excluir para quem pode gerenciar.

#### Scenario: Célula ERA5
- **WHEN** o talhão tem `era5Cell {lat: -16.7, lon: -49.3}`
- **THEN** o detalhe mostra "Célula ERA5-Land: −16,7; −49,3" e o retângulo da célula no mapa

#### Scenario: Altitude ausente
- **WHEN** `altitudeM` é nulo
- **THEN** o detalhe destaca "Altitude não informada — necessária para processar o MSA" com atalho para editar

### Requirement: Lista de talhões com miniaturas
O detalhe da propriedade e a página `/talhoes` (talhões de todas as propriedades visíveis, agrupados por propriedade) SHALL listar cada talhão com uma miniatura SVG do polígono, nome, área em ha e indicação de altitude ausente; clicar leva ao detalhe.

#### Scenario: Miniatura
- **WHEN** a lista é exibida
- **THEN** cada talhão mostra o contorno do seu polígono em um SVG sem instanciar um mapa

#### Scenario: Agrupamento
- **WHEN** o usuário abre `/talhoes` com duas propriedades
- **THEN** os talhões aparecem agrupados sob o nome de cada propriedade

### Requirement: Exclusão de talhão
A ação Excluir SHALL pedir confirmação e chamar `DELETE /api/v1/properties/:propertyId/fields/:id`; 409 `FIELD_HAS_ACTIVE_HARVEST` ou `FIELD_HAS_HARVESTS` MUST ser exibido como "Este talhão tem safras; encerre-as ou remova-as antes".

#### Scenario: Talhão com safras
- **WHEN** a API responde 409 `FIELD_HAS_HARVESTS`
- **THEN** o toast de erro mostra a mensagem e o talhão permanece na lista
