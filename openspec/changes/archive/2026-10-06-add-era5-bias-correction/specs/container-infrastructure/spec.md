## ADDED Requirements

### Requirement: Volume de importação de observações
Os dois Compose SHALL definir o volume nomeado `station_imports`, montado em `/data/station-imports` nos serviços `api`, `worker` e `etl`, para o arquivo enviado pela API ser lido pelo ETL. O `.env.example` SHALL listar `QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM` e `QM_MAX_RATIO` com os defaults (50, 10, 0,1, 3) e a indicação de que são consumidas pelo serviço `etl` e registradas em cada calibração.

#### Scenario: Arquivo visível ao ETL
- **WHEN** a API grava um arquivo em `/data/station-imports/`
- **THEN** o contêiner `etl` lê o mesmo caminho

#### Scenario: Variáveis documentadas
- **WHEN** o desenvolvedor lê o `.env.example`
- **THEN** encontra as quatro variáveis `QM_*` com defaults e explicação
