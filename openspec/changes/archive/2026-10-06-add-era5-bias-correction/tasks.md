## 1. Esquema e configuração

- [x] 1.1 `schema.prisma`: models `WeatherStation` (enum `StationSource`), `StationDailyObs`, `QmCalibration`; `Era5DailyData.qmCalibrationId`; `MsaRun.qmCalibrationId`; migration via `migrate diff --from-url` + SQL cru (`create_hypertable('station_daily_obs','date', 1 year)`, índice único parcial ativo); `migrate deploy`; drift vazio; client gerado
- [x] 1.2 `.env.example` com `QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM`, `QM_MAX_RATIO`; `config.py` (Settings com os quatro + `station_imports_dir`); `env.ts` (opcionais, só para `/admin`); volume `station_imports` nos dois Compose (`api`, `worker`, `etl`) e `STATION_IMPORTS_DIR`

## 2. ETL — observações e calibração

- [x] 2.1 `era5/stations.py`: `parse_bdmep`, `parse_generic`, `StationMeta`, `import_file(conn, path, format, meta?) → ImportSummary`; `db.py`: `upsert_station`, `upsert_obs`, `list_stations`, `station_obs_series`, `nearest_stations`; testes com fixtures BDMEP (trecho real anonimizado) e genérico
- [x] 2.2 `era5/qm.py` (puro): `wet_fraction`, `calibrate_month`, `calibrate(era5, obs, dates, cfg) → Calibration`, `apply(calibration, values, dates)`, `overlap_years`, `haversine_km`, `pair_station`; testes com estação sintética (viés ×1,3 e garoa zerada: fração recuperada, `|PBIAS| < 2 %`), cauda limitada, mês seco, idempotência, inelegibilidade (anos/distância)
- [x] 2.3 `era5/qm_store.py` + `db.py`: `save_calibration` (desativa a anterior), `active_calibration(cell)`, `list_calibrations`, `apply_to_cell(conn, calibration)` em lotes por mês, `apply_all`; integração: índice parcial e `apply` idempotente
- [x] 2.4 `load.py`: aplica a calibração ativa da célula nas linhas (`tp_corrected`, `qm_applied`, `qm_calibration_id`); `UPSERT_SQL` com a coluna nova; teste de carga com e sem calibração
- [x] 2.5 `cli.py`: `stations import|list`, `qm calibrate (--cell --station | --auto) [--from --to]`, `qm apply [--cell|--all]`, `qm status`, `qm validate --cell --station --calib-years --test-years [--csv]` (`era5/validate_qm.py`: RMSE, PBIAS, fração chuvosa por mês e total); `worker.py`: kinds `station-import` (remove o arquivo ao concluir), `qm-calibrate`, `qm-apply` com runs e progresso por célula; testes do `plan_job`
- [x] 2.6 `tests/make_qm_fixture.py`: 10 anos sintéticos (ERA5 a partir da série em cache/fixture com perturbação determinística, obs com viés conhecido) em CSV genérico; `pytest` no contêiner (unitários + integração) passando

## 3. Backend Node

- [x] 3.1 `pnpm add multer @types/multer`; módulo `src/modules/admin-stations/` (`GET /admin/stations`, `POST /admin/stations/upload` multipart → `station_imports` + `era5-ingest station-import`), `src/modules/admin-qm/` (`GET /admin/qm/calibrations`, `POST /admin/qm/calibrate`); DTOs zod; testes de DTO; montagem em `app.ts`
- [x] 3.2 `flows.ts`: tipos dos novos kinds, `ANNUAL_CRON '0 3 1 1 *'`, `ANNUAL_SCHEDULER_ID`; `worker.ts`: agendador anual e processador `qm-annual` → enfileira `qm-calibrate auto`; `jobs.service.queueCounts` expõe `annual.nextRun`; testes (cron anual → 2027-01-01T06:00Z)
- [x] 3.3 `msa.service`: lê calibração ativa da célula (`qmRepository.activeForCell`) e grava `qmCalibrationId`; `RunView`/`ProcessResult` com `qmCalibrationId` e `qmCalibration` (estação, anos, distância); `docs/modulos/msa.md`
- [x] 3.4 `pnpm typecheck && pnpm test`; `e2e-msa.sh` continua verde (sem calibração ⇒ `qmCalibration: null`)

## 4. Frontend

- [x] 4.1 Tipos (`WeatherStation`, `QmCalibration`, `RunView.qmCalibration`); `/admin` seção "Estações e correção de viés": upload (arquivo, formato, metadados), tabelas de estações e calibrações, botões Calibrar todas / Calibrar célula, nota de reprocessamento; jobs na lista da sessão
- [x] 4.2 Selo da chuva no `MsaHeader`; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## 5. Verificação e documentação

- [x] 5.1 `backend/scripts/e2e/e2e-qm.sh`: gera a fixture (estação sintética a 10 km da célula −16,7/−49,3, 10 anos), importa via upload (202 → job), calibra pela API (`{cell, station}`), confere `qm_calibrations` ativa e `era5_daily_data.qm_applied`, reprocessa a safra (`?sync=true`) e vê `qmCalibrationId`/`qmCalibration` na run; `qm validate` imprime métricas; limpeza (calibrações, observações, estação, `qm_applied=false`)
- [x] 5.2 Rodar `e2e-qm.sh`, `e2e-msa.sh`, `e2e-orchestration.sh` e o Playwright (`msa.spec.ts` confere o selo "sem correção")
- [x] 5.3 Docs: `era5-etl.md` (Etapa 3 reescrita: duas etapas, pareamento, tabelas, apply, jobs, limitações), `validacao.md` (Caso 4 com `qm validate` e critério), `msa.md`, `questoes-abertas.md` item 6 (defaults, onde ajustar, cauda, fuso), README do ETL (como baixar do BDMEP, formatos, comandos), `frontend.md`, README dos e2e
