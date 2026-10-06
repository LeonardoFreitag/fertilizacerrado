## ADDED Requirements

### Requirement: Calibração por Quantile Mapping mensal em duas etapas
`backend/etl/era5/qm.py` SHALL calibrar a precipitação de uma célula contra uma estação, por mês do ano, sobre os dias de sobreposição válida (ERA5 e observação presentes) do período: (1) **frequência** — o limiar `wet_threshold_era5[m]` é o quantil `1 − f_obs[m]` da série ERA5 do mês, onde `f_obs[m]` é a fração de dias observados com chuva `> QM_WET_DAY_MM` (default 0,1 mm); (2) **intensidade** — nos dias chuvosos de cada série, 99 quantis (1–99 %) do ERA5 e da observação. A aplicação MUST zerar valores `≤ wet_threshold_era5[m]`, interpolar linearmente entre os quantis e, acima do P99, multiplicar pela razão do último quantil limitada a `QM_MAX_RATIO` (default 3). O método MUST ser identificado como `empirical-monthly-v1`; mês sem dia chuvoso observado MUST zerar tudo; mês sem dia chuvoso no ERA5 MUST manter identidade acima do limiar. Só a precipitação é corrigida nesta versão.

#### Scenario: Estação sintética com viés conhecido
- **WHEN** a observação é `era5 × 1,3` nos dias chuvosos com garoa < 0,5 mm zerada, em 10 anos
- **THEN** após calibrar e aplicar, a fração de dias chuvosos do ERA5 corrigido iguala a observada (±1 p.p.) e `|PBIAS| < 2 %` (bruto ≈ −23 %)

#### Scenario: Cauda limitada
- **WHEN** um valor ERA5 excede o P99 do mês e a razão do último quantil é 4
- **THEN** o valor corrigido usa o fator 3 (`QM_MAX_RATIO`)

#### Scenario: Mês seco
- **WHEN** um mês não tem nenhum dia chuvoso observado no período
- **THEN** todo valor ERA5 desse mês é corrigido para 0

#### Scenario: Idempotência da aplicação
- **WHEN** `qm apply` roda duas vezes na mesma célula
- **THEN** `tp_corrected` é idêntico nas duas execuções (sempre parte de `tp_raw`)

### Requirement: Pareamento célula–estação
Para calibrar, o sistema SHALL escolher a estação ativa mais próxima do nó da célula (distância haversine) dentro de `QM_MAX_DISTANCE_KM` (default 50) que tenha ao menos `QM_MIN_YEARS` (default 10) de sobreposição válida com a série ERA5 da célula (dias com ambos os valores). Sem estação elegível a célula MUST ficar sem calibração e a run MUST registrar o aviso; `qm calibrate --auto` MUST continuar para as demais células.

#### Scenario: Estação distante
- **WHEN** a única estação está a 80 km
- **THEN** a célula não é calibrada e o aviso cita a distância

#### Scenario: Poucos anos
- **WHEN** a estação tem 3 anos de sobreposição
- **THEN** a célula não é calibrada e o aviso cita os anos

#### Scenario: Elegível
- **WHEN** há uma estação a 10 km com 10 anos de sobreposição
- **THEN** a calibração é criada com `distance_km ≈ 10` e o período usado

### Requirement: Persistência das calibrações
O banco SHALL ter `qm_calibrations` (`id`, `cell_lat`, `cell_lon`, `station_code`, `variable` = `tp`, `method`, `period_from`, `period_to`, `n_days_by_month` JSON, `wet_day_threshold_obs`, `wet_thresholds_era5` JSON por mês, `quantiles` JSON por mês com `era5[]` e `obs[]`, `max_ratio`, `distance_km`, `active`, `created_at`) com no máximo uma calibração ativa por `(cell_lat, cell_lon, variable)` (índice único parcial). Recalibrar MUST desativar a anterior e nunca apagar. `era5_daily_data` SHALL ter `qm_calibration_id` (nulo quando `qm_applied` é falso).

#### Scenario: Recalibração
- **WHEN** a célula é calibrada de novo
- **THEN** a calibração anterior fica `active = false`, a nova `active = true`, e ambas permanecem na tabela

#### Scenario: Parâmetros auditáveis
- **WHEN** uma calibração é consultada
- **THEN** traz os 12 limiares, os 12 pares de vetores de quantis, o período, a estação, a distância e os limiares de configuração usados

### Requirement: Aplicação da correção
A carga do ETL SHALL aplicar a calibração ativa da célula a cada linha gravada (`tp_corrected`, `qm_applied = true`, `qm_calibration_id`); células sem calibração MUST manter `tp_corrected = tp_raw`, `qm_applied = false` e `qm_calibration_id` nulo. `qm apply [--cell LAT LON | --all]` SHALL reaplicar a calibração ativa nas linhas existentes, em lotes, de forma idempotente. `era5.repository` MUST continuar lendo `tp_corrected` como precipitação do balanço hídrico.

#### Scenario: Ingestão em célula calibrada
- **WHEN** `ingest --latest` grava dias de uma célula com calibração ativa
- **THEN** as linhas novas têm `qm_applied = true` e `qm_calibration_id` da calibração

#### Scenario: Célula sem calibração
- **WHEN** a célula não tem calibração
- **THEN** `tp_corrected = tp_raw` e `qm_applied = false`

#### Scenario: Apply em todas
- **WHEN** `qm apply --all` roda
- **THEN** todas as linhas das células com calibração ativa passam a referenciá-la e as demais ficam intactas

### Requirement: CLI, jobs e agendamento anual
`python -m era5.cli qm` SHALL oferecer `calibrate --cell LAT LON --station CODE [--from --to]`, `calibrate --auto` (todas as células de `era5_cells`, seguido de `apply` nas calibradas), `apply [--cell|--all]`, `status` (calibrações ativas por célula) e `validate`. A fila `era5-ingest` SHALL aceitar `{kind: "qm-calibrate", cell?, station?, auto?, from?, to?}` e `{kind: "qm-apply", cell?}`, com run em `era5_ingestion_runs`. O worker Node SHALL registrar o agendador `qm-annual-trigger` (`pattern '0 3 1 1 *'`, `tz 'America/Sao_Paulo'`) que enfileira `qm-calibrate {auto: true}`.

#### Scenario: Calibrate auto
- **WHEN** `qm calibrate --auto` roda com 2 células, uma com estação elegível
- **THEN** uma calibração é criada e aplicada, a outra célula gera aviso, e a run termina `SUCCEEDED`

#### Scenario: Agendamento anual
- **WHEN** o worker Node sobe
- **THEN** `GET /admin/jobs/queues` mostra o próximo disparo anual em 1º de janeiro 03:00 (06:00 UTC)

#### Scenario: Job pela fila
- **WHEN** `era5-ingest {kind: "qm-calibrate", cell: {lat, lon}, station}` é consumido
- **THEN** a calibração é criada, aplicada à célula e a run registra `job_id`

### Requirement: Endpoints de administração da correção
`GET /api/v1/admin/qm/calibrations` (ADMIN) SHALL listar as calibrações (ativas e inativas) com estação, célula, período, anos e distância; `POST /api/v1/admin/qm/calibrate` SHALL aceitar `{cell: {lat, lon}, station}` ou `{auto: true}` e enfileirar `qm-calibrate`, respondendo 202 com `jobId`.

#### Scenario: Calibrar automático pela API
- **WHEN** um `ADMIN` envia `{auto: true}`
- **THEN** a resposta é 202 e o job `era5-ingest` é consumido pelo ETL

#### Scenario: Corpo inválido
- **WHEN** o corpo não tem `auto` nem `cell`+`station`
- **THEN** a resposta é 400

### Requirement: Script de validação do Caso 4
`python -m era5.cli qm validate --cell LAT LON --station CODE --calib-years A --test-years B [--csv ARQ]` SHALL calibrar nos anos A sem persistir, aplicar nos anos B e imprimir, por mês e total, RMSE, PBIAS e fração de dias chuvosos de ERA5 bruto e corrigido contra a observação, salvando CSV quando pedido.

#### Scenario: Validação sintética
- **WHEN** o script roda na estação sintética com `--calib-years 2016-2022 --test-years 2023-2025`
- **THEN** imprime as métricas por mês e total, o PBIAS corrigido total fica abaixo de 2 % em módulo e o CSV é gravado

### Requirement: Configuração documentada
As constantes científicas SHALL vir de `QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM` e `QM_MAX_RATIO` (defaults 50, 10, 0,1 e 3), listadas em `.env.example` e registradas em cada calibração; `docs/msa/questoes-abertas.md` item 6 MUST explicar cada uma e onde ajustar.

#### Scenario: Valores gravados
- **WHEN** uma calibração é criada com `QM_MAX_RATIO=2`
- **THEN** `max_ratio = 2` fica na calibração e mudar a variável depois não altera essa calibração
