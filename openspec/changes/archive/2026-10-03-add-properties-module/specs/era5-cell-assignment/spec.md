## ADDED Requirements

### Requirement: Identificação da célula ERA5-Land
`src/utils/era5-grid.util.ts` SHALL expor uma função pura que, dadas latitude e longitude em graus decimais, devolve o nó mais próximo da grade regular ERA5-Land de 0,1°, cujos nós estão em múltiplos exatos de 0,1° em cada eixo. O resultado MUST ter uma casa decimal, MUST normalizar `-0` para `0` e MUST converter longitude `180.0` em `-180.0`.

#### Scenario: Centróide no Cerrado
- **WHEN** a entrada é lat `-16.6799`, lon `-49.2550`
- **THEN** o resultado é lat `-16.7`, lon `-49.3`

#### Scenario: Centróide exatamente sobre um nó
- **WHEN** a entrada é lat `-15.8`, lon `-47.9`
- **THEN** o resultado é lat `-15.8`, lon `-47.9`

#### Scenario: Empate entre dois nós
- **WHEN** a entrada é lat `-16.65`, lon `-49.25`
- **THEN** o resultado é determinístico e igual a lat `-16.6`, lon `-49.2` (meio arredondado para cima)

#### Scenario: Ponto flutuante
- **WHEN** a entrada é lat `-16.299999999`, lon `-49.100000001`
- **THEN** o resultado é lat `-16.3`, lon `-49.1`, sem resíduos decimais

#### Scenario: Zero negativo
- **WHEN** a entrada é lat `-0.04`, lon `0.04`
- **THEN** o resultado é lat `0`, lon `0`

#### Scenario: Antimeridiano
- **WHEN** a entrada é lon `179.98`
- **THEN** o resultado é lon `-180`

### Requirement: Registro da célula do talhão
Ao criar um talhão, ou ao alterar sua geometria, o sistema SHALL calcular a célula ERA5-Land do centróide e gravar em `era5_cells` uma linha por talhão (`field_id`, `cell_lat`, `cell_lon`), substituindo a anterior se existir, na mesma transação do talhão. A linha MUST ser removida junto com o talhão.

#### Scenario: Criação
- **WHEN** um talhão é criado com centróide em lat `-16.68`, lon `-49.26`
- **THEN** `era5_cells` tem uma linha para o talhão com `cell_lat = -16.7` e `cell_lon = -49.3`, e a resposta traz `era5Cell: { "lat": -16.7, "lon": -49.3 }`

#### Scenario: Geometria alterada
- **WHEN** o `PATCH` move o polígono para um centróide em outra célula
- **THEN** a linha em `era5_cells` passa a ter a nova célula e continua havendo uma única linha para o talhão

#### Scenario: Atualização sem geometria
- **WHEN** o `PATCH` altera apenas `name` ou `notes`
- **THEN** a linha em `era5_cells` permanece inalterada

#### Scenario: Falha após o talhão
- **WHEN** a gravação em `era5_cells` falha durante a criação
- **THEN** o talhão não é criado (a transação é desfeita)

#### Scenario: Exclusão do talhão
- **WHEN** o talhão é removido
- **THEN** não resta linha em `era5_cells` para ele

#### Scenario: Agrupamento por célula
- **WHEN** dois talhões têm centróides na mesma célula
- **THEN** `SELECT cell_lat, cell_lon, count(*) FROM era5_cells GROUP BY 1, 2` devolve uma linha com contagem 2 para essa célula
