## MODIFIED Requirements

### Requirement: Serviço ETL em contêiner próprio
O pipeline ERA5-Land SHALL residir em `backend/etl/` como pacote Python 3.12 (`era5/`) com `Dockerfile` baseado em `python:3.12-slim`, usuário não-root e `requirements.txt` fixado contendo `cdsapi>=0.7.2`, `xarray`, `netCDF4`, `numpy`, `pandas`, `psycopg[binary]`, `bullmq`, `redis` e `pytest`. O serviço `etl` dos dois Compose MUST rodar como worker de longa duração (`python -m era5.cli worker`), fora de qualquer profile, com `restart`, sem publicar portas, dependendo de `db` e `redis` saudáveis e recebendo `DATABASE_URL`, `REDIS_URL`, `CDS_API_URL`, `CDS_API_KEY` e `ETL_CACHE_DIR` com o volume `etl_cache`. O CLI MUST continuar disponível por `docker compose run --rm etl <comando>`.

#### Scenario: Stack sobe com o ETL
- **WHEN** `docker compose up -d` é executado
- **THEN** o serviço `etl` sobe e passa a consumir a fila `era5-ingest`

#### Scenario: Execução manual continua possível
- **WHEN** `docker compose run --rm etl status` é executado
- **THEN** o contêiner sobe, conecta ao banco, imprime as últimas runs e encerra

#### Scenario: Autenticação por variáveis
- **WHEN** o ETL cria o cliente do CDS
- **THEN** usa `CDS_API_URL` e `CDS_API_KEY` do ambiente e não lê `~/.cdsapirc`

#### Scenario: Chave ausente
- **WHEN** `ingest` é executado sem `CDS_API_KEY`
- **THEN** o comando encerra com código 1 e mensagem indicando a variável, sem contatar o CDS

### Requirement: Download por mês com cache
`download.py` SHALL calcular a bounding box das células distintas de `era5_cells` (ou da célula indicada, ou da bbox informada), expandida 0,1° em cada direção e alinhada à grade, e requisitar ao dataset `reanalysis-era5-land` do CDS as variáveis horárias `2m_temperature`, `2m_dewpoint_temperature`, `10m_u_component_of_wind`, `10m_v_component_of_wind`, `surface_net_solar_radiation`, `surface_net_thermal_radiation` e `total_precipitation`, em NetCDF (`data_format: netcdf`, `download_format: unarchived`), cobrindo `[from, to + 1 dia]`: por mês para intervalos de até dois meses e por trimestre civil para intervalos maiores. O arquivo de cada `(bbox, mês)` ou `(bbox, trimestre)` MUST ser gravado em `ETL_CACHE_DIR` e reutilizado em execuções seguintes sem nova requisição; um trimestre cujos três meses já estão em cache MUST ser servido pelos arquivos mensais.

#### Scenario: Bounding box das células
- **WHEN** `era5_cells` tem células em (−16,7; −49,3) e (−16,2; −48,8)
- **THEN** a área requisitada é `[−16,1, −49,4, −16,8, −48,7]` (N, W, S, E)

#### Scenario: Mês seguinte para o último dia
- **WHEN** o intervalo termina em 30/11
- **THEN** o pipeline também obtém o mês de dezembro (ao menos o passo 00 UTC de 01/12) para fechar os acumulados de 30/11

#### Scenario: Cache
- **WHEN** o mesmo `(bbox, mês)` ou `(bbox, trimestre)` é requisitado pela segunda vez
- **THEN** nenhuma requisição é feita ao CDS e o arquivo em cache é usado

#### Scenario: Erro do CDS
- **WHEN** o CDS responde erro (licença não aceita, chave inválida)
- **THEN** a run termina `FAILED` com a mensagem do CDS e o comando encerra com código 1

### Requirement: Comandos e registro de execuções
`python -m era5.cli` SHALL oferecer `ingest --from AAAA-MM-DD --to AAAA-MM-DD`, `ingest --latest` (intervalo `[hoje − 16, hoje − 6]`), `backfill --harvest <uuid>` (da data de emergência da safra até `hoje − 6`, apenas a célula do talhão), `status [--limit n]` e `worker` (consome a fila `era5-ingest` até receber `SIGTERM`). Toda execução de `ingest`, `backfill` ou job do worker MUST criar uma linha em `era5_ingestion_runs` com `RUNNING` (e `job_id` quando vinda da fila) e fechá-la com `SUCCEEDED` (contagens) ou `FAILED` (erro), atualizando `updated_at` a cada mês concluído. Erros do CLI MUST produzir código de saída 1.

#### Scenario: Janela do latest
- **WHEN** `ingest --latest` roda em 2026-10-05
- **THEN** a run tem `date_from = 2026-09-19` e `date_to = 2026-09-29`

#### Scenario: Backfill de safra
- **WHEN** `backfill --harvest <id>` roda para uma safra com emergência em 2025-11-10
- **THEN** só a célula do talhão da safra é requisitada e `date_from = 2025-11-10`

#### Scenario: Safra inexistente
- **WHEN** `backfill --harvest` recebe um id que não existe
- **THEN** o comando encerra com código 1 e a run termina `FAILED`

#### Scenario: Sem células
- **WHEN** `ingest` roda com `era5_cells` vazia
- **THEN** a run termina `SUCCEEDED` com `cells_requested = 0` e um aviso é impresso

#### Scenario: Status
- **WHEN** `status --limit 5` é executado
- **THEN** imprime as 5 runs mais recentes com comando, intervalo, status, contagens, `job_id` e erro

#### Scenario: Worker encerra graciosamente
- **WHEN** `worker` recebe `SIGTERM` com um job ativo
- **THEN** conclui o job, fecha a run e encerra com código 0

#### Scenario: Ponta a ponta com o CDS
- **WHEN** `CDS_API_KEY` válida está configurada e `ingest --from --to` cobre 3 dias de um mês consolidado para a célula de um talhão
- **THEN** a run termina `SUCCEEDED`, `era5_daily_data` tem 3 linhas para a célula e a série lida pelo Node alimenta `runDailyBalance` sem erro
