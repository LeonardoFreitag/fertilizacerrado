## 1. Banco

- [x] 1.1 Adicionar ao `schema.prisma` o enum `IngestionStatus` e os models `Era5DailyData` (`@@id([time, cellLat, cellLon])`, `time @db.Date`, decimais iguais a `era5_cells`, `@db.Real` nas variáveis) e `Era5IngestionRun`
- [x] 1.2 Gerar a migration `create_era5_tables` com `--create-only`, acrescentar `SELECT create_hypertable('era5_daily_data', 'time', chunk_time_interval => INTERVAL '1 month')`, aplicar e confirmar em `timescaledb_information.hypertables`

## 2. Serviço ETL (infra)

- [x] 2.1 Criar `backend/etl/Dockerfile` (`python:3.12-slim`, usuário não-root, `ENTRYPOINT python -m era5.cli`), `requirements.txt` fixado, `pyproject`/`pytest.ini` mínimo e `.dockerignore`
- [x] 2.2 Adicionar o serviço `etl` (profile `etl`, `DATABASE_URL`, `CDS_API_URL`, `CDS_API_KEY`, `ETL_CACHE_DIR`, volume `etl_cache`, `depends_on db healthy`) ao `docker-compose.yml` e ao `docker-compose.prod.yml` (imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG}`, redes `backend_net` + `frontend_net`); `.env.example` com `CDS_API_URL`, `CDS_API_KEY`, `ECR_REPOSITORY_ETL`; `.gitignore` com o cache local
- [x] 2.3 `docker compose config` (dev e prod) válidos; `docker compose up -d` não inicia o `etl`; `docker compose build etl` constrói

## 3. Pipeline Python

- [x] 3.1 `era5/config.py` (variáveis de ambiente, erro claro se `CDS_API_KEY` faltar quando necessária) e `era5/db.py` (conexão psycopg, células distintas, célula de uma safra, runs: abrir/fechar, upsert em lote)
- [x] 3.2 `era5/download.py`: bbox alinhada à grade com margem 0,1°, meses de `[from, to + 1]`, requisição à API nova (`data_format: netcdf`, `download_format: unarchived`), cache por `(bbox, mês)`
- [x] 3.3 `era5/transform.py`: abertura/concatenação dos NetCDF, combinação de `expver`, instantâneas (K → °C, máx/mín/média, vento por velocidade horária × 0,748), acumulados pelo passo 00 UTC do dia seguinte (`tp` mm, `rn` MJ), omissão de dias incompletos, `tp_corrected = tp_raw`, `qm_applied = false`
- [x] 3.4 `era5/load.py`: seleção `nearest` com tolerância 0,05°, DataFrame → upsert em lote
- [x] 3.5 `era5/cli.py`: `ingest --from/--to`, `ingest --latest`, `backfill --harvest`, `status`; run por execução; códigos de saída

## 4. Testes Python

- [x] 4.1 `tests/make_fixture.py` gerando `tests/fixtures/era5_synthetic.nc` (1 célula, 4 dias × 24 h + passo 00 UTC do 5º dia, valores de cálculo à mão, variante com `expver`) e versionar o `.nc`
- [x] 4.2 `tests/test_transform.py`: temperaturas, acumulados pelas 00 UTC (e que a soma das 24 h não é usada), `rn`, vento constante e com direção variável, dia incompleto, `expver`; `tests/test_download.py`: bbox e lista de meses; `tests/test_cli.py`: janela do `--latest`
- [x] 4.3 `tests/test_load_integration.py` (`-m integration`, pula sem `DATABASE_URL`): upsert duas vezes ⇒ mesma contagem, reprocessamento atualiza valores, run registrada; rodar via `docker compose run --rm etl pytest`

## 5. Lado Node

- [x] 5.1 Implementar `src/modules/msa/era5.repository.ts` (`toDailyWeather`, `findMissingDates`, `getDailySeriesForField`, `getCoverage`) e testes Vitest das funções puras
- [x] 5.2 `pnpm typecheck`, `pnpm build`, `pnpm test`

## 6. Ponta a ponta e documentação

- [x] 6.1 `backend/etl/README.md` (conta CDS, token, aceite da licença `reanalysis-era5-land`, variáveis, comandos, cache, testes) e `backend/scripts/e2e/e2e-era5.sh` (pula com aviso sem `CDS_API_KEY`; cria talhão de teste, `ingest` de 3 dias de mês consolidado medindo o tempo, `backfill`, `status`, leitura pelo repository alimentando `runDailyBalance`)
- [x] 6.2 Executar o `e2e-era5.sh` com a chave do CDS no `.env` (se disponível) e registrar o tempo de fila observado no design; sem a chave, registrar que a verificação real ficou pendente
- [x] 6.3 Atualizar `docs/msa/era5-etl.md` (API nova, variáveis com `str`, estrutura `backend/etl/era5/`, convenções de agregação, esquema por célula, comandos, cache, licença), `docs/arquitetura.md` (`etl/` na árvore e na stack) e o README dos roteiros e2e
