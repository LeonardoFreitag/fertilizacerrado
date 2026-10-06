# weather-stations Specification

## Purpose
Observações meteorológicas de estações (INMET/ANA/outras): tabelas `weather_stations` e `station_daily_obs`, importador de CSV nos formatos BDMEP e genérico, upload pela API (ADMIN) com job `station-import` e CLI `stations`.

## Requirements

### Requirement: Tabelas de estações e observações diárias
O banco SHALL ter `weather_stations` (`code` PK, `name`, `source` em `INMET|ANA|OUTRA`, `lat`, `lon`, `altitude_m`, `geometry` `geography(Point,4326)`, `active` padrão verdadeiro, `created_at`, `updated_at`) e a hipertabela `station_daily_obs` (`station_code` FK, `date`, `precip_mm`, `tmax` e `tmin` opcionais, `source_file`, `imported_at`; PK `(station_code, date)`), criadas por migration Prisma com models correspondentes.

#### Scenario: Hipertabela de observações
- **WHEN** a migration é aplicada
- **THEN** `timescaledb_information.hypertables` lista `station_daily_obs` e `weather_stations` tem a coluna geográfica

#### Scenario: Observação única por estação e dia
- **WHEN** a mesma data da mesma estação é importada duas vezes
- **THEN** existe uma única linha, com os valores da última importação

### Requirement: Importador de CSV de observações
O ETL SHALL importar observações diárias de dois formatos: **BDMEP/INMET** (separador `;`, vírgula decimal, cabeçalho de metadados com nome, código, latitude, longitude e altitude; coluna de precipitação diária e, quando presentes, temperaturas máxima e mínima; valores vazios ⇒ nulos) e **genérico** (`station_code,date,precip_mm[,tmax,tmin]`, ponto decimal). O importador MUST criar ou atualizar a estação (metadados do cabeçalho BDMEP ou informados na importação do genérico) e fazer upsert das observações por `(station_code, date)`. Linhas inválidas MUST ser contadas e relatadas sem abortar as demais; arquivo sem as colunas obrigatórias MUST falhar com mensagem clara. Disponível por `python -m era5.cli stations import <arquivo> --format bdmep|generic [--station-meta …]` e `stations list`.

#### Scenario: BDMEP
- **WHEN** um CSV do BDMEP da estação 83423 (Goiânia) é importado
- **THEN** `weather_stations` tem a estação com código, nome, lat/lon e altitude do cabeçalho e `station_daily_obs` tem uma linha por dia com `precip_mm`

#### Scenario: Genérico com metadados
- **WHEN** um CSV genérico de uma estação nova é importado com `--station-meta "nome;INMET;-16.75;-49.35;750"`
- **THEN** a estação é criada e as observações gravadas

#### Scenario: Genérico sem estação conhecida
- **WHEN** o CSV genérico cita uma estação inexistente e nenhum metadado é informado
- **THEN** a importação falha com mensagem indicando a estação ausente

#### Scenario: Idempotência
- **WHEN** o mesmo arquivo é importado duas vezes
- **THEN** a contagem de observações da estação não muda

### Requirement: Upload de observações pela API
`POST /api/v1/admin/stations/upload` (ADMIN, multipart com `file` `.csv`/`.txt` até 50 MB, `format` `bdmep|generic` e metadados opcionais da estação) SHALL gravar o arquivo no volume compartilhado `station_imports` e enfileirar `era5-ingest {kind: "station-import", path, format, stationMeta?}`, respondendo 202 com `jobId` e `queue`. O worker Python MUST importar, registrar a run em `era5_ingestion_runs` com `job_id` e apagar o arquivo ao concluir com sucesso. `GET /api/v1/admin/stations` SHALL listar as estações com quantidade de observações e período coberto.

#### Scenario: Upload e importação
- **WHEN** um `ADMIN` envia um CSV genérico válido
- **THEN** a resposta é 202 com `jobId`, o job conclui `completed`, a run do ETL é `SUCCEEDED` com as linhas importadas e o arquivo não existe mais no volume

#### Scenario: Arquivo inválido
- **WHEN** o arquivo não tem as colunas esperadas
- **THEN** o job falha, a run é `FAILED` com a mensagem e `GET /admin/stations` não muda

#### Scenario: Não administrador
- **WHEN** um `AGRONOMO` chama o upload
- **THEN** a resposta é 403

#### Scenario: Zona de upload do Nginx
- **WHEN** a requisição passa pelo `nginx.prod.conf`
- **THEN** cai na location `^/api/v[0-9]+/.+/upload` (zona `api_upload`, 50 MB)
