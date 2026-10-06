## MODIFIED Requirements

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
