# ETL ERA5-Land

Serviço Python 3.12 que baixa dados horários do ERA5-Land no Copernicus CDS, agrega para o dia (UTC) e grava por célula da grade de 0,1° na hipertabela `era5_daily_data` (TimescaleDB). Os talhões chegam à série pela tabela `era5_cells`. Documentação do pipeline e das convenções: `docs/msa/era5-etl.md`.

O serviço `etl` dos dois Compose roda como **worker de longa duração** (`python -m era5.cli worker`): consome a fila BullMQ `era5-ingest` (concorrência 1) alimentada pelo backend — ingest semanal, backfill de safra nova, backfill regional (`/api/v1/admin/jobs`). Cada job vira uma run em `era5_ingestion_runs` com `job_id`; o progresso por período vai para o BullMQ e `updated_at` é o heartbeat. Na subida, runs `RUNNING` há mais de 6 h sem heartbeat são marcadas `FAILED` (`orphaned`). `SIGTERM` conclui o job em curso antes de sair.

O CLI continua disponível para operação manual, em um contêiner descartável:

```bash
docker compose run --rm etl status
docker compose run --rm etl ingest --latest                       # [hoje−16, hoje−6], todas as células
docker compose run --rm etl ingest --from 2025-11-01 --to 2025-11-30
docker compose run --rm etl backfill --harvest <uuid-da-safra>    # só a célula do talhão, da emergência a hoje−6
```

Em produção, `docker compose -f docker-compose.prod.yml run --rm etl …` com a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}`.

## Credenciais do CDS

1. Crie uma conta em <https://cds.climate.copernicus.eu> e, logado, abra o perfil: o **Personal Access Token** é a `CDS_API_KEY`. A API nova (desde setembro de 2024) usa só o token — sem o prefixo `uid:` do formato antigo; o ETL rejeita chaves com `:`.
2. Aceite a licença do dataset: na página do [ERA5-Land hourly](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land), aba *Download*, marque o aceite de *Licence to use Copernicus Products*. Sem isso a primeira requisição falha com 403 e a run fica `FAILED` com a mensagem do CDS.
3. No `.env` da raiz: `CDS_API_URL=https://cds.climate.copernicus.eu/api` e `CDS_API_KEY=<token>`. O ETL lê só variáveis de ambiente; `~/.cdsapirc` é ignorado.

A fila do CDS leva de minutos a horas conforme a carga do serviço. Intervalos de até dois meses são pedidos por mês; maiores, por trimestre civil (reaproveitando os mensais já em cache). Cada arquivo × bounding box fica em cache no volume `etl_cache` (`/data/cache`); um mês já consolidado (último dia + 6 dias) nunca é pedido de novo, um mês ainda aberto é renovado uma vez por dia.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `DATABASE_URL` | montada pelo Compose (`postgresql://…@db:5432/…`) |
| `CDS_API_URL` | padrão `https://cds.climate.copernicus.eu/api` |
| `CDS_API_KEY` | token pessoal; exigida por `ingest`, `backfill` e `worker` |
| `ETL_CACHE_DIR` | `/data/cache` no contêiner (volume `etl_cache`) |
| `REDIS_URL` | montada pelo Compose; exigida só pelo `worker` (fila `era5-ingest`) |

## Pipeline

```
era5/
├── config.py     variáveis de ambiente
├── db.py         células, safras, runs, upsert (psycopg)
├── download.py   bbox das células (+0,1°), requisições NetCDF por mês ou trimestre, cache
├── transform.py  horário → diário com as convenções do ERA5-Land
├── load.py       célula mais próxima → upsert idempotente
├── worker.py     worker BullMQ da fila era5-ingest (kind latest | range | cell), heartbeat, órfãs
└── cli.py        ingest | backfill | status | worker
```

Convenções que importam (detalhes em `docs/msa/era5-etl.md`): `tp`, `ssr` e `str` são acumulados desde 00 UTC — o total do dia D é o passo 00 UTC de D+1, nunca a soma das horas; temperaturas K → °C; vento pela velocidade horária `√(u²+v²)`, média diária, × 0,748 para 2 m; `rn = (ssr + str)/1e6` MJ/m²/dia; dia em UTC. Ainda sem correção de viés: `tp_corrected = tp_raw`, `qm_applied = false`.

Toda execução de `ingest`/`backfill` e todo job do `worker` grava uma linha em `era5_ingestion_runs` (`RUNNING` → `SUCCEEDED`/`FAILED`, com `job_id` quando vinda da fila); `status` lista as últimas.

## Testes

```bash
docker compose run --rm --entrypoint pytest etl -q                 # unitários (fixture NetCDF sintética)
docker compose run --rm --entrypoint pytest etl -q -m integration  # upsert/runs/órfãs contra o banco da stack
```

O despacho do worker (`plan_job`) é testado sem Redis (`tests/test_worker.py`); o flow Node → Python completo é coberto por `backend/scripts/e2e/e2e-orchestration.sh`.

A fixture `tests/fixtures/era5_synthetic.nc` (1 célula × 4 dias horários + 00 UTC do 5º dia, valores de cálculo à mão) é gerada por `tests/make_fixture.py`; para regenerar: `docker compose run --rm -v "$PWD/backend/etl/tests:/app/tests" --entrypoint python etl -m tests.make_fixture`.
