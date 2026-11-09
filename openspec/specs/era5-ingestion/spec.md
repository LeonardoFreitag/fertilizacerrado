# era5-ingestion Specification

## Purpose

Serviço Python que baixa ERA5-Land do Copernicus CDS — sempre por mês civil, com divisão por grupos de variáveis quando o CDS recusa por custo e concorrência configurável das requisições —, agrega os passos horários para o dia com as convenções do produto e grava por célula da grade de 0,1° na hipertabela TimescaleDB era5_daily_data, com registro de execuções e comandos de ingestão, backfill e status.

## Requirements

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

### Requirement: Armazenamento diário por célula
O banco SHALL ter a hipertabela TimescaleDB `era5_daily_data` com chunk mensal e chave primária `(time date, cell_lat numeric(4,1), cell_lon numeric(5,1))`, colunas `t2m_max`, `t2m_min`, `t2m_mean`, `d2m_mean` (°C), `u2` (m/s), `rn` (MJ/m²/dia), `tp_raw`, `tp_corrected` (mm), `qm_applied` (boolean, padrão falso), `qm_calibration_id` (uuid nulo, referência a `qm_calibrations`), `source` (padrão `era5-land`) e `ingested_at`, e a tabela `era5_ingestion_runs` com `id`, `command`, `started_at`, `finished_at`, `updated_at`, `status` (`RUNNING`/`SUCCEEDED`/`FAILED`), `date_from`, `date_to`, `cells_requested`, `rows_upserted`, `cds_request_id`, `job_id` e `error`. Ambas MUST ser criadas por migration Prisma, com `create_hypertable` em SQL cru, e ter models Prisma correspondentes.

#### Scenario: Hipertabela criada pela migration
- **WHEN** a migration é aplicada
- **THEN** `SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = 'era5_daily_data'` devolve uma linha com intervalo de chunk de 1 mês

#### Scenario: Chave por célula
- **WHEN** dois talhões apontam para a mesma célula em `era5_cells`
- **THEN** a série da célula existe uma única vez em `era5_daily_data` e serve aos dois

#### Scenario: Leitura pelo Prisma
- **WHEN** o Node consulta `era5DailyData` por `cellLat`, `cellLon` e intervalo de `time`
- **THEN** o client Prisma devolve as linhas sem SQL cru

#### Scenario: Referência à calibração
- **WHEN** uma linha tem `qm_applied = true`
- **THEN** `qm_calibration_id` aponta para a calibração que produziu `tp_corrected`

### Requirement: Download por mês com cache
`download.py` SHALL calcular a bounding box das células distintas de `era5_cells` (ou da célula indicada, ou da bbox informada), expandida 0,1° em cada direção e alinhada à grade, e requisitar ao dataset `reanalysis-era5-land` do CDS as variáveis horárias `2m_temperature`, `2m_dewpoint_temperature`, `10m_u_component_of_wind`, `10m_v_component_of_wind`, `surface_net_solar_radiation`, `surface_net_thermal_radiation` e `total_precipitation`, em NetCDF (`data_format: netcdf`, `download_format: unarchived`), cobrindo `[from, to + 1 dia]` **sempre por mês civil**, qualquer que seja o tamanho do intervalo: `plan_periods` SHALL devolver um período por mês de `months_covering(from, to)` e cada requisição ao CDS MUST cobrir um único `(bbox, ano, mês)` com os dias reais do mês e as 24 horas. Não há requisição nem arquivo trimestral; arquivos `AAAA-Qn.nc` existentes no cache MUST ser ignorados. O arquivo de cada `(bbox, mês)` MUST ser gravado em `ETL_CACHE_DIR` como `cache/<bbox>/AAAA-MM.nc` e reutilizado em execuções seguintes sem nova requisição (mês consolidado — último dia + 6 dias já passou — vale para sempre; mês aberto, só no dia em que foi baixado). Todo arquivo mensal MUST ser escrito em arquivo temporário no mesmo diretório e renomeado para `AAAA-MM.nc` só quando completo: um download interrompido ou uma união falha MUST NOT deixar um `AAAA-MM.nc` parcial que `_cached` aceite.

#### Scenario: Bounding box das células
- **WHEN** `era5_cells` tem células em (−16,7; −49,3) e (−16,2; −48,8)
- **THEN** a área requisitada é `[−16,1, −49,4, −16,8, −48,7]` (N, W, S, E)

#### Scenario: Mês seguinte para o último dia
- **WHEN** o intervalo termina em 30/11
- **THEN** o pipeline também obtém o mês de dezembro (ao menos o passo 00 UTC de 01/12) para fechar os acumulados de 30/11

#### Scenario: Intervalo longo pedido por mês
- **WHEN** o intervalo é 2025-02-01 a 2025-10-25 (backfill de uma safra desde o spin-up)
- **THEN** `plan_periods` devolve nove períodos mensais, `2025-02` a `2025-10`, e cada requisição ao CDS traz `year 2025`, um único `month` e os dias daquele mês

#### Scenario: Cache
- **WHEN** o mesmo `(bbox, mês)` é requisitado pela segunda vez
- **THEN** nenhuma requisição é feita ao CDS e o arquivo em cache é usado

#### Scenario: Trimestral antigo no cache
- **WHEN** o cache da bbox tem `2025-Q4.nc` e não tem `2025-10.nc`
- **THEN** outubro de 2025 é requisitado ao CDS como mês e gravado como `2025-10.nc`; o arquivo trimestral não é lido

#### Scenario: Download interrompido não vira cache
- **WHEN** a gravação de `2025-11.nc` é interrompida antes de completar (thread cancelada, falha na união dos grupos)
- **THEN** não existe `2025-11.nc` no cache (só um `.part`), e a próxima execução requisita o mês de novo

#### Scenario: Erro do CDS
- **WHEN** o CDS responde erro não relacionado a custo (licença não aceita, chave inválida)
- **THEN** a run termina `FAILED` com a mensagem do CDS e o comando encerra com código 1, sem dividir a requisição

### Requirement: Divisão por grupos de variáveis ao exceder o custo do CDS
Quando o CDS recusar a requisição de um mês por custo (resposta cuja mensagem contém `cost limits exceeded` ou `request is too large`), `fetch_month` SHALL repetir o mês em **duas requisições** com grupos disjuntos de variáveis — `2m_temperature`, `2m_dewpoint_temperature`, `10m_u_component_of_wind`, `10m_v_component_of_wind` e `surface_net_solar_radiation`, `surface_net_thermal_radiation`, `total_precipitation` — mesmos `year/month/day/time/area`, e MUST unir os dois NetCDF num único `cache/<bbox>/AAAA-MM.nc` com as sete variáveis, removendo os parciais, de modo que o cache, a transformação e a carga não distingam um mês dividido de um mês inteiro. A divisão MUST ser registrada em log. Se uma das metades também for recusada por custo, `fetch_month` SHALL lançar `CdsCostError` com mensagem que identifique o mês, a bbox e a mensagem do CDS e indique a ação (reduzir a área do backfill); a run MUST terminar `FAILED` com essa mensagem e o job `era5-ingest` MUST falhar com ela em `failedReason`. Erros não relacionados a custo MUST NOT disparar a divisão.

#### Scenario: Mês dividido e unido
- **WHEN** o CDS recusa por custo a requisição inteira de `2025-11` e aceita as duas metades
- **THEN** são feitas três requisições ao CDS, o cache passa a ter `2025-11.nc` com as sete variáveis e nenhum arquivo parcial, e a ingestão prossegue como se o mês tivesse vindo inteiro

#### Scenario: Metade recusada
- **WHEN** o CDS recusa por custo também uma das metades de `2025-11`
- **THEN** `fetch_month` lança `CdsCostError` citando `2025-11`, a bbox e a mensagem do CDS; a run fica `FAILED` com essa mensagem e o job `era5-ingest` tem `failedReason` com ela

#### Scenario: Erro de licença não divide
- **WHEN** o CDS responde 403 por licença não aceita
- **THEN** a exceção é propagada após uma única requisição, sem tentativa por grupos

### Requirement: Concorrência das requisições ao CDS
`fetch_range` SHALL obter os meses planejados com até `ERA5_CDS_MAX_CONCURRENT` requisições simultâneas ao CDS (`Settings.cds_max_concurrent`, inteiro ≥ 1, padrão 2; valor inválido ⇒ `ConfigError` ao iniciar), devolvendo os arquivos em ordem cronológica, e MUST chamar `on_progress(concluídos, total)` uma vez por mês concluído (em cache ou baixado), na thread que chamou `fetch_range`, de modo que o heartbeat `updated_at` da run e o progresso `periodsDone/periodsTotal` do job avancem por mês. A primeira falha MUST interromper a submissão de novos meses e ser propagada.

#### Scenario: Backfill com dois downloads em voo
- **WHEN** `ERA5_CDS_MAX_CONCURRENT=2` e o intervalo tem seis meses sem cache
- **THEN** no máximo duas requisições estão em andamento a cada instante, `on_progress` é chamado seis vezes com `concluídos` de 1 a 6 e `total` 6, e os caminhos devolvidos vêm do mês mais antigo ao mais recente

#### Scenario: Meses em cache não ocupam vaga
- **WHEN** quatro dos seis meses já estão em cache
- **THEN** só os dois meses faltantes vão ao CDS e `on_progress` ainda conta seis conclusões

#### Scenario: Concorrência inválida
- **WHEN** `ERA5_CDS_MAX_CONCURRENT=0`
- **THEN** `Settings.from_env` lança `ConfigError` citando a variável

### Requirement: Agregação diária com as convenções do ERA5-Land
`transform.py` SHALL converter os passos horários em um registro por dia UTC: `t2m_max`, `t2m_min` e `t2m_mean` como máximo, mínimo e média horária de `t2m` convertida de K para °C; `d2m_mean` como média horária de `d2m` em °C; `u2` como média diária da velocidade horária `√(u10² + v10²)` multiplicada por 0,748; para os acumulados `tp`, `ssr` e `str`, o total do dia D MUST ser o valor do passo 00 UTC do dia D+1 (não a soma das 24 horas), com `tp_raw = tp × 1000` (mm) e `rn = (ssr + str) / 10⁶` (MJ/m²/dia). `tp_corrected` MUST ser igual a `tp_raw` e `qm_applied` falso. Dias sem os 24 passos instantâneos ou sem o passo 00 UTC seguinte MUST ser omitidos e contados. Uma dimensão `expver` presente MUST ser combinada em uma única série.

#### Scenario: Temperaturas da fixture
- **WHEN** a fixture sintética tem `t2m` horário de 290,15 a 301,65 K em rampa no dia 1
- **THEN** `t2m_min = 17,0`, `t2m_max = 28,5` e `t2m_mean` é a média aritmética dos 24 valores em °C

#### Scenario: Acumulado pelas 00 UTC
- **WHEN** `tp` acumula 0,001 m por hora durante o dia 1 (0,024 m às 00 UTC do dia 2) e é zero no dia 2
- **THEN** `tp_raw` do dia 1 é 24,0 mm, do dia 2 é 0,0 mm, e a soma das 24 horas do dia 1 (276 mm) não é usada

#### Scenario: Saldo de radiação
- **WHEN** `ssr` às 00 UTC do dia seguinte é 20 × 10⁶ J/m² e `str` é −5 × 10⁶ J/m²
- **THEN** `rn = 15,0` MJ/m²/dia

#### Scenario: Vento pela velocidade horária
- **WHEN** `u10 = 3` e `v10 = 4` m/s em todas as horas
- **THEN** `u2 = 5 × 0,748 = 3,74` m/s, e a média dos componentes não é usada

#### Scenario: Vento com direção variável
- **WHEN** `u10` alterna entre +5 e −5 com `v10 = 0`
- **THEN** `u2 = 5 × 0,748`, não 0

#### Scenario: Dia incompleto
- **WHEN** o último dia do arquivo não tem o passo 00 UTC seguinte
- **THEN** esse dia não é gravado e a run registra 1 dia incompleto

#### Scenario: Dimensão expver
- **WHEN** o NetCDF tem `expver` com valores em fatias complementares
- **THEN** a agregação usa a série combinada sem `NaN`

### Requirement: Carga idempotente por célula
`load.py` SHALL extrair, para cada célula alvo, o ponto da grade mais próximo (`method="nearest"`), rejeitando células a mais de 0,05° do nó encontrado, aplicar a calibração QM ativa da célula quando existir (`tp_corrected`, `qm_applied`, `qm_calibration_id`; senão `tp_corrected = tp_raw`) e gravar em `era5_daily_data` com `INSERT ... ON CONFLICT (time, cell_lat, cell_lon) DO UPDATE` em lote. Reprocessar o mesmo intervalo MUST resultar nas mesmas linhas, sem duplicatas, com `ingested_at` atualizado.

#### Scenario: Upsert idempotente
- **WHEN** o mesmo DataFrame diário é carregado duas vezes
- **THEN** a contagem de linhas da célula no intervalo é a mesma após a segunda carga e os valores são iguais

#### Scenario: Reprocessamento com valores novos
- **WHEN** um intervalo já carregado é reprocessado com valores diferentes
- **THEN** as linhas existentes passam a ter os novos valores

#### Scenario: Célula fora da grade
- **WHEN** uma célula alvo está a mais de 0,05° do nó mais próximo do arquivo
- **THEN** a célula é pulada e a run registra o aviso

#### Scenario: Carga com calibração ativa
- **WHEN** a célula tem calibração ativa
- **THEN** cada linha gravada tem `tp_corrected` corrigido, `qm_applied = true` e `qm_calibration_id` preenchido

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
