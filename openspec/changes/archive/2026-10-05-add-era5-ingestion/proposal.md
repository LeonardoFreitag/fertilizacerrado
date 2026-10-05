## Why

O motor do MSA está completo e validado, mas só recebeu séries sintéticas: não existe nenhum dado climático real no sistema. O ERA5-Land é a fonte definida em `docs/msa/era5-etl.md`, e sem a ingestão não há GDA, ET₀, balanço hídrico nem Monte Carlo para uma safra de verdade. Esta change implementa a camada de dados — download no CDS, agregação diária com as convenções corretas do ERA5-Land, hipertabela TimescaleDB e leitura pelo Node — deixando a correção de viés (Quantile Mapping) e a orquestração por fila para changes seguintes.

## What Changes

- **Serviço `etl` em Python 3.12** (`backend/etl/`, Dockerfile próprio, `requirements.txt` fixado com `cdsapi ≥ 0.7.2`, xarray, netCDF4, numpy, pandas, `psycopg[binary]`, pytest), adicionado aos dois Compose sob o profile `etl`: não é daemon, é invocado por `docker compose run --rm etl <comando>`. Autenticação na API nova do CDS por `CDS_API_URL`/`CDS_API_KEY` (token puro), sem `~/.cdsapirc`.
- **Armazenamento por célula, não por talhão** (desvio em relação ao doc, que o atualiza): hipertabela `era5_daily_data` com PK `(time, cell_lat, cell_lon)`, chunk mensal, colunas `t2m_max`, `t2m_min`, `t2m_mean`, `d2m_mean`, `u2`, `rn`, `tp_raw`, `tp_corrected`, `qm_applied`, `source`, `ingested_at`; e tabela `era5_ingestion_runs`. Criadas por migration Prisma com `create_hypertable` em SQL cru; models Prisma com id composto para leitura.
- **Pipeline `backend/etl/era5/`**: `download.py` (bounding box das células distintas + 0,1°, uma requisição NetCDF por mês, cache em disco por bbox+mês), `transform.py` (horário → diário: acumulados `tp`/`ssr`/`str` pela leitura às 00 UTC do dia seguinte, K → °C, vento por velocidade horária então média diária × 0,748, `rn = (ssr + str)/1e6`), `load.py` (célula mais próxima, upsert idempotente em lote), `cli.py` (`ingest --from/--to`, `ingest --latest`, `backfill --harvest`, `status`), cada execução registrando uma run.
- **Sem QM nesta change**: `tp_corrected = tp_raw`, `qm_applied = false`.
- **Lado Node**: `src/modules/msa/era5.repository.ts` com `getDailySeriesForField` (série no formato `DailyWeather` do motor, via `era5_cells`) e `getCoverage` (dias presentes/ausentes).
- Testes: pytest com NetCDF sintético versionado (1 célula × 3 dias) reproduzindo valores calculados à mão, inclusive a regra do acumulado e do vento; upsert idempotente contra o banco da stack; Vitest para o mapeamento e a detecção de lacunas do repository; verificação real de ponta a ponta com uma requisição ao CDS (exige chave).
- `README` em `backend/etl/`, `e2e-era5.sh` opcional, `era5-etl.md` e `arquitetura.md` atualizados; `.env.example` ganha `CDS_API_URL`, `CDS_API_KEY` e `ECR_REPOSITORY_ETL`.

Fora do escopo: Quantile Mapping e calibração com INMET (Caso 4), job BullMQ semanal, endpoints `/msa`, persistência de resultados, conversão do dia UTC para o dia local, GRIB, dask.

## Capabilities

### New Capabilities
- `era5-ingestion`: serviço Python que baixa ERA5-Land do CDS, agrega para o dia com as convenções do produto e grava por célula em hipertabela TimescaleDB, com registro de execuções e comandos de ingestão, backfill e status.
- `era5-data-access`: leitura, pelo Node, da série diária de um talhão no formato do motor e da cobertura (dias presentes/ausentes) de um intervalo.

### Modified Capabilities
- `container-infrastructure`: as stacks de desenvolvimento e produção ganham o serviço `etl` (profile `etl`, volume `etl_cache`), e o `.env.example` ganha `CDS_API_URL`, `CDS_API_KEY` e `ECR_REPOSITORY_ETL`.

## Impact

- **Código**: novo `backend/etl/` (Dockerfile, requirements, `era5/` com `config`, `db`, `download`, `transform`, `load`, `cli`, `tests/` com fixture NetCDF), novo `src/modules/msa/era5.repository.ts`; alterações em `prisma/schema.prisma`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `.gitignore` (cache do ETL).
- **Banco**: hipertabela `era5_daily_data` (primeiro uso do TimescaleDB), tabela `era5_ingestion_runs`, enum `IngestionStatus`.
- **API, Redis**: nenhuma alteração.
- **Dependências**: nenhuma nova no Node; Python isolado no container do ETL.
- **Ambiente**: `CDS_API_KEY` exige conta no CDS e aceite da licença do dataset `reanalysis-era5-land`; sem a chave, tudo funciona exceto o download real.
