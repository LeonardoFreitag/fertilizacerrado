## Why

O ERA5-Land superestima a frequência de chuva fraca e subestima eventos convectivos no Cerrado; hoje `tp_corrected = tp_raw` e o balanço hídrico do MSA roda sobre a reanálise bruta. A correção por Quantile Mapping já está prevista em `docs/msa/era5-etl.md` e no Caso 4 de `docs/msa/validacao.md`, e é a parte do método que a dissertação precisa demonstrar com dados observados. Esta change implementa a correção de forma agnóstica à estação — toda escolha científica vira configuração com default, registrada em `docs/msa/questoes-abertas.md` item 6 para a pesquisadora ajustar.

## What Changes

- **Observações de estações**: tabelas `weather_stations` (código, nome, fonte `INMET|ANA|OUTRA`, lat/lon, altitude, geometria PostGIS, ativa) e `station_daily_obs` (hipertabela: estação, data, `precip_mm`, `tmax`/`tmin` opcionais, arquivo de origem). Importador Python de CSV em dois formatos — BDMEP/INMET diário (`;`, vírgula decimal, cabeçalho de metadados com código/lat/lon/altitude) e genérico normalizado (`station_code,date,precip_mm[,tmax,tmin]`) — idempotente por `(station_code, date)`. Download automático fora do escopo (o BDMEP exige login); o README explica como obter o arquivo.
- **Fluxo de importação**: `POST /api/v1/admin/stations/upload` (ADMIN, multipart; o caminho termina em `/upload` para cair na zona `api_upload` do Nginx) grava o arquivo no volume compartilhado `station_imports` e enfileira `era5-ingest {kind: "station-import"}` para o worker Python; 202 com `jobId`. CLI `stations import <arquivo> --format bdmep|generic` e `stations list`.
- **Calibração** (`backend/etl/era5/qm.py`): QM empírico por mês do ano em duas etapas — (1) frequência de dias chuvosos: limiar do ERA5 tal que a fração de dias chuvosos iguale a observada (`> QM_WET_DAY_MM`, default 0,1 mm), abaixo do limiar ⇒ 0; (2) mapeamento de 99 quantis (1–99 %) nos dias chuvosos com interpolação linear; acima do P99, razão do último quantil limitada a `QM_MAX_RATIO` (default 3). Só precipitação. Pareamento célula↔estação: estação ativa mais próxima do nó dentro de `QM_MAX_DISTANCE_KM` (default 50) com ao menos `QM_MIN_YEARS` (default 10) de sobreposição válida; sem estação elegível a célula fica sem calibração, com aviso.
- **Persistência**: `qm_calibrations` (célula, estação, variável `tp`, método `empirical-monthly-v1`, período, `n_days_by_month`, `wet_day_threshold_obs`, `wet_thresholds_era5` e `quantiles` por mês em JSON, `max_ratio`, `distance_km`, `active`; uma ativa por célula/variável, recalibrar desativa a anterior e nunca apaga). `era5_daily_data` ganha `qm_calibration_id`.
- **Aplicação**: `tp_corrected` por célula/dia a partir da calibração ativa, `qm_applied = true` e `qm_calibration_id` na linha — (a) no load de cada ingestão e (b) por `qm apply --cell|--all` nas linhas existentes. Células sem calibração mantêm `tp_corrected = tp_raw`, `qm_applied = false`.
- **Reprodutibilidade**: `msa_runs.qm_calibration_id` (nullable) registrado no processamento (calibração ativa da célula no momento); o painel mostra "chuva corrigida (estação X, N anos)" ou "chuva sem correção". Confirmado que `era5.repository` já usa `tp_corrected` como precipitação do balanço — sem correção necessária.
- **CLI e jobs**: `qm calibrate --cell LAT LON --station CODE [--from --to]`, `qm calibrate --auto`, `qm apply [--cell|--all]`, `qm status`, `qm validate` (Caso 4). Jobs na fila `era5-ingest`: `station-import`, `qm-calibrate` (`cell`+`station` ou `auto`, seguido de `apply`), `qm-apply`. Agendamento anual (1º de janeiro, 03:00 America/Sao_Paulo) registrado pelo worker Node: `qm-calibrate auto` + `qm apply --all`. Endpoints ADMIN: `GET /admin/stations`, `POST /admin/stations/upload`, `GET /admin/qm/calibrations`, `POST /admin/qm/calibrate` (`{cell, station}` ou `{auto: true}`), e os botões em `/admin`.
- **Validação**: `qm validate --cell --station --calib-years A --test-years B` calibra em A, aplica em B e imprime RMSE, PBIAS e fração de dias chuvosos (ERA5 bruto × corrigido × observado) por mês e total, salvando CSV. Testes pytest com estação sintética derivada da própria série ERA5 com viés conhecido (×1,3 nos dias chuvosos, garoa < 0,5 mm removida): recupera a fração de dias chuvosos e PBIAS < 2 % após correção; bordas (mês seco, poucos anos, estação distante, idempotência do apply). e2e `e2e-qm.sh`: estação sintética a 10 km da célula de Goiânia (10 anos gerados pelo script de fixture a partir dos 16 meses em cache, perturbação determinística), importar, calibrar, aplicar, reprocessar uma safra e ver `qmCalibrationId` na run e o selo no painel; limpar ao final.
- **Docs**: `era5-etl.md` (seção QM reescrita: duas etapas, tabelas, jobs), `validacao.md` (Caso 4 com o script), `msa.md` (`qmCalibrationId`), `questoes-abertas.md` item 6 (defaults e onde ajustar), README do ETL (BDMEP), `frontend.md`; `.env.example` com `QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM`, `QM_MAX_RATIO`.

## Capabilities

### New Capabilities
- `weather-stations`: tabelas de estações e observações diárias, importador CSV (BDMEP e genérico), upload ADMIN + job `station-import`, CLI `stations`.
- `era5-bias-correction`: calibração QM por mês em duas etapas, pareamento célula↔estação, tabela `qm_calibrations`, aplicação no load e sob demanda, CLI `qm`, jobs e agendamento anual, endpoints ADMIN, script de validação (Caso 4) e testes com estação sintética.

### Modified Capabilities
- `era5-ingestion`: `era5_daily_data` ganha `qm_calibration_id`; a carga aplica a calibração ativa da célula; CLI documenta os novos subcomandos.
- `msa-orchestration`: o worker Python aceita os kinds `station-import`, `qm-calibrate` e `qm-apply`; o worker Node registra o agendamento anual da calibração.
- `msa-processing`: a run registra `qmCalibrationId` da célula no momento do processamento e o expõe nas consultas.
- `container-infrastructure`: volume `station_imports` compartilhado por `api`/`worker` e `etl` nos dois Compose; variáveis `QM_*` no `.env.example`.
- `web-shell`: `/admin` ganha upload de observações, lista de estações e calibrações, e os botões de calibrar.
- `web-msa-dashboard`: o cabeçalho do painel mostra o selo da chuva (corrigida por estação X, N anos / sem correção).

## Impact

- **Banco**: migration com `weather_stations`, `station_daily_obs` (hipertabela), `qm_calibrations`, `era5_daily_data.qm_calibration_id`, `msa_runs.qm_calibration_id`.
- **Backend Node**: `multer` (multipart) na rota de upload; módulo `admin/stations` e `admin/qm` (listagens via Prisma, enfileiramento); `jobs/flows.ts` (novos kinds, agendamento anual); `msa.service` (snapshot do `qmCalibrationId`); `env.ts`.
- **ETL Python**: `stations.py` (parsers + upsert), `qm.py` (calibração/aplicação puras + persistência), `validate_qm.py`, `cli.py` (`stations`, `qm`), `worker.py` (novos kinds), `load.py` (aplicar calibração), `db.py`; `tests/`; fixture sintética.
- **Infra**: volume `station_imports` nos dois Compose; `.env.example`.
- **Frontend**: `/admin` (upload, estações, calibrações, botões), selo no cabeçalho do painel, tipos.
- **Docs**: os seis arquivos listados; roteiro `e2e-qm.sh` e README dos e2e.
