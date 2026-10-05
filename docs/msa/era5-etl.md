# MSA — Pipeline ERA5-Land (ETL)

## Visão Geral

O pipeline ERA5-Land é responsável por extrair, corrigir e carregar os dados climáticos de reanálise que alimentam todos os cálculos do MSA. É implementado em Python e executa como job periódico independente do servidor Node.js.

---

## Sobre o ERA5-Land

| Atributo | Valor |
|---|---|
| Fonte | Copernicus Climate Change Service (C3S), ECMWF |
| Resolução espacial | ~9 km × 9 km (0,1° × 0,1°) |
| Resolução temporal | Horária (agregada para diária no ETL) |
| Lag de publicação | ~5 dias (reanálise consolidada) |
| Formato | NetCDF-4 (API nova: `data_format: netcdf`, `download_format: unarchived`) |
| Acesso | API nova do CDS (desde set/2024): `https://cds.climate.copernicus.eu/api`, `cdsapi ≥ 0.7.2`, token pessoal (sem `uid:`), licença do dataset aceita no site |
| Cobertura | 1950–presente |

### Variáveis utilizadas

| Variável ERA5-Land | Nome na API CDS (NetCDF) | Uso |
|---|---|---|
| Temperatura do ar a 2 m (máx., mín., média diárias) | `2m_temperature` (`t2m`) | GDA, ET₀ |
| Temperatura do ponto de orvalho a 2 m (média) | `2m_dewpoint_temperature` (`d2m`) | $e_a$ (pressão de vapor atual) |
| Componente U do vento a 10 m | `10m_u_component_of_wind` (`u10`) | $u_2$ |
| Componente V do vento a 10 m | `10m_v_component_of_wind` (`v10`) | $u_2$ |
| Saldo de radiação de onda curta à superfície | `surface_net_solar_radiation` (`ssr`) | $R_n$ |
| Saldo de radiação de onda longa à superfície | `surface_net_thermal_radiation` (`str`) | $R_n$ |
| Precipitação total | `total_precipitation` (`tp`) | Balanço hídrico |

> `R_n = (ssr + str)/10^6` MJ m⁻² dia⁻¹: o saldo de onda curta (`ssr`) já desconta o albedo da superfície do modelo e o de onda longa (`str`, negativo) fecha o balanço — por isso `surface_solar_radiation_downwards` não é usada.

---

## Etapas do Pipeline

```
backend/etl/                       # serviço Python 3.12 em contêiner próprio (profile `etl` do Compose)
├── era5/
│   ├── config.py                  # DATABASE_URL, CDS_API_URL, CDS_API_KEY, ETL_CACHE_DIR
│   ├── db.py                      # células (era5_cells), safras, runs, upsert
│   ├── download.py                # Etapa 1: bbox das células, 1 requisição por mês, cache
│   ├── transform.py               # Etapa 2: horário → diário (convenções abaixo)
│   ├── load.py                    # Etapa 4: célula mais próxima → upsert idempotente
│   └── cli.py                     # ingest | backfill | status (cada execução grava uma run)
├── tests/                         # pytest; fixture NetCDF sintética versionada
├── Dockerfile · requirements.txt · README.md
```

A Etapa 3 (Quantile Mapping, `era5_bias_correct.py`) ainda não existe: por enquanto `tp_corrected = tp_raw` e `qm_applied = false`. A orquestração por BullMQ (`run_etl.py`) também fica para a próxima change; hoje o ETL é executado por `docker compose run --rm etl <comando>`.

**Comandos:**

| Comando | Faz |
|---|---|
| `ingest --from AAAA-MM-DD --to AAAA-MM-DD` | todas as células de `era5_cells` no intervalo |
| `ingest --latest` | `[hoje − 16, hoje − 6]`: cobre o lag de ~5 dias com margem e sobrepõe a semana anterior (idempotente) |
| `backfill --harvest <uuid>` | só a célula do talhão da safra, da emergência a `hoje − 6` |
| `status [--limit n]` | últimas execuções de `era5_ingestion_runs` |

---

## Etapa 1 — Download

```python
# era5/download.py (API nova do CDS)
client = cdsapi.Client(url=CDS_API_URL, key=CDS_API_KEY)   # token pessoal; ~/.cdsapirc não é lido
client.retrieve(
    "reanalysis-era5-land",
    {
        "variable": ["2m_temperature", "2m_dewpoint_temperature",
                     "10m_u_component_of_wind", "10m_v_component_of_wind",
                     "surface_net_solar_radiation", "surface_net_thermal_radiation",
                     "total_precipitation"],
        "year": "2025", "month": "11", "day": [...todos os dias...],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": [N, W, S, E],
        "data_format": "netcdf", "download_format": "unarchived",
    },
    output_path,
)
```

**Estratégia de bounding box:** o menor retângulo da grade que contém todas as células distintas de `era5_cells` (ou só a célula do talhão, no backfill; ou as células dentro da `bbox` informada, no backfill regional), expandido 0,1° em cada direção — uma única área por requisição. Os meses cobrem `[from, to + 1 dia]`: o total diário dos acumulados do último dia exige o passo 00 UTC do dia seguinte.

**Granularidade das requisições** (`plan_periods`): intervalos de até **dois meses** (o `latest` semanal) são pedidos **por mês** (`cache/<bbox>/AAAA-MM.nc`); intervalos maiores (backfill de uma safra inteira, backfill regional) são pedidos **por trimestre civil** (`AAAA-Qn.nc`, uma requisição `year/month×3/day 01–31/time`) — o CDS limita o tamanho de uma requisição e o trimestre fica confortável (~46 mil campos para uma bbox pequena). Antes de pedir um trimestre, o pipeline reutiliza os **três arquivos mensais** quando todos já estão em cache. O trimestre que contém um mês ainda não consolidado volta a ser pedido por mês, para não gravar um trimestral parcial.

**Cache** (`ETL_CACHE_DIR`, volume `etl_cache`): um mês **consolidado** (último dia + 6 dias já passou) vale para sempre; um mês **aberto** só vale no dia em que foi baixado — o `latest` da semana seguinte baixa o mês corrente de novo e enxerga os dias novos.

---

## Etapa 2 — Transformação

```python
# era5_transform.py — usando xarray
import xarray as xr
import numpy as np

ds = xr.open_dataset(netcdf_path)

# Agregação diária de dados horários
daily = xr.Dataset({
    't2m_max':  ds['t2m'].resample(time='1D').max() - 273.15,      # K → °C
    't2m_min':  ds['t2m'].resample(time='1D').min() - 273.15,
    't2m_mean': ds['t2m'].resample(time='1D').mean() - 273.15,
    'd2m':      ds['d2m'].resample(time='1D').mean() - 273.15,
    'u10':      ds['u10'].resample(time='1D').mean(),
    'v10':      ds['v10'].resample(time='1D').mean(),
    'ssrd':     ds['ssrd'].resample(time='1D').sum() / 1e6,         # J/m² → MJ/m²
    'ssr':      ds['ssr'].resample(time='1D').sum() / 1e6,
    'tp':       ds['tp'].resample(time='1D').sum() * 1000,          # m → mm
})

# Velocidade do vento a 2 m (ajuste logarítmico)
daily['u2'] = np.sqrt(daily['u10']**2 + daily['v10']**2) * 0.748
```

**Extração por célula:** para cada célula de `era5_cells` (já na grade), seleciona-se o ponto mais próximo (`method="nearest"`, tolerância 0,05°) e agrega-se a série; a extração é por célula, não por talhão — vários talhões compartilham a mesma célula.

### Convenções do ERA5-Land aplicadas em `transform.py`

| Grandeza | Regra |
|---|---|
| **Acumulados** `tp`, `ssr`, `str` | No ERA5-Land horário o valor de cada passo é o acumulado desde 00 UTC do mesmo dia; o passo 00 UTC do dia D+1 traz o **total do dia D**. Logo `total(D) = valor(00 UTC de D+1)` — **não** a soma das 24 horas (somar daria uma ordem de grandeza a mais). `tp` m → ×1000 mm; `ssr`/`str` J m⁻² → ÷10⁶ MJ m⁻² |
| `t2m_max`, `t2m_min`, `t2m_mean` | máx./mín./média dos 24 passos do dia (00–23 UTC), K → °C |
| `d2m_mean` | média dos 24 passos, K → °C |
| `u2` | velocidade horária `√(u10² + v10²)`, **depois** média diária, × 0,748 (FAO-56 Eq. 47, 10 m → 2 m — mesmo fator de `engine/et0.ts`). A média dos componentes subestimaria o vento quando a direção gira |
| `rn` | `(ssr + str)/10⁶` MJ m⁻² dia⁻¹ |
| Dia | UTC (00–23 UTC). A conversão para o dia local (UTC−3) está em aberto |
| Dias incompletos | sem os 24 passos ou sem o passo 00 UTC seguinte → omitidos e contados na run |
| `expver` | ERA5T em meses recentes: as fatias são combinadas em uma série única |

Esses casos são cobertos por `tests/test_transform.py` com uma fixture NetCDF sintética de valores calculados à mão.

---

## Etapa 3 — Correção de Viés (Quantile Mapping)

### Problema
O ERA5-Land apresenta viés sistemático de precipitação no Cerrado brasileiro, especialmente:
- Subestimação de eventos convectivos intensos
- Superestimação da frequência de dias com chuva fraca

### Método: Quantile Mapping (QM)

O Quantile Mapping corrige a distribuição cumulativa da variável reanalisada para aproximá-la da distribuição observada:

$$P_{corr} = F_{obs}^{-1}\left[F_{era5}(P_{era5})\right]$$

**Onde:**
- $F_{era5}$ = CDF empírica da precipitação ERA5-Land no período de calibração
- $F_{obs}$ = CDF empírica da precipitação observada (estações INMET/ANA)
- $F_{obs}^{-1}$ = função quantil (inversa da CDF) da distribuição observada

### Calibração
- **Período de calibração:** 10 anos de dados históricos sobrepostos (ERA5-Land vs. INMET)
- **Estações de referência:** rede INMET e ANA, priorizando estações no interior ou adjacentes ao estado do talhão
- **Frequência:** recalibração anual (cron job de janeiro)
- **Armazenamento:** os parâmetros QM (mapeamento de quantis) são persistidos no banco como vetores JSON por célula ERA5-Land e variável

```python
# era5_bias_correct.py — implementação com scikit-learn / scipy
from scipy.interpolate import interp1d
import numpy as np

def quantile_mapping(era5_series, qm_params):
    """
    qm_params: dict com 'era5_quantiles' e 'obs_quantiles' (vetores de comprimento N)
    """
    f_qm = interp1d(
        qm_params['era5_quantiles'],
        qm_params['obs_quantiles'],
        bounds_error=False,
        fill_value=(qm_params['obs_quantiles'][0], qm_params['obs_quantiles'][-1])
    )
    return f_qm(era5_series)
```

### Referência bibliográfica
> PIANI, C. et al. (2010). Statistical bias correction of global simulated daily precipitation and temperature for the application of hydrological models. *Journal of Hydrology*, 395(3-4), 199–215.  
> MARAUN, D. (2016). Bias correcting climate change simulations – a critical review. *Current Climate Change Reports*, 2(4), 211–220.

---

## Etapa 4 — Carga (Load)

Os dados transformados e corrigidos são inseridos na tabela `era5_daily_data` no TimescaleDB.

### Tabela era5_daily_data — chaveada por **célula**

A série é armazenada por célula da grade, não por talhão: vários talhões caem na mesma célula de 0,1°, e `era5_cells` já mapeia talhão → célula. Criar um talhão numa célula já ingerida dá acesso imediato ao histórico; apagar um talhão não apaga clima.

| Campo | Tipo | Descrição |
|---|---|---|
| `time` | DATE | Dia UTC (coluna de tempo da hipertabela) |
| `cell_lat` | NUMERIC(4,1) | Latitude da célula (igual a `era5_cells.cell_lat`) |
| `cell_lon` | NUMERIC(5,1) | Longitude da célula |
| `t2m_max`, `t2m_min`, `t2m_mean` | REAL | Temperaturas (°C) |
| `d2m_mean` | REAL | Ponto de orvalho médio (°C) |
| `u2` | REAL | Vento a 2 m (m/s) |
| `rn` | REAL | Saldo de radiação (MJ/m²/dia) |
| `tp_raw` | REAL | Precipitação ERA5-Land bruta (mm) |
| `tp_corrected` | REAL | Precipitação após QM (mm) — igual a `tp_raw` até a change de QM |
| `qm_applied` | BOOLEAN | Se a correção QM foi aplicada (hoje sempre falso) |
| `source` | TEXT | `era5-land` |
| `ingested_at` | TIMESTAMPTZ | Última gravação |

Chave primária `(time, cell_lat, cell_lon)`. Hipertabela com chunk mensal (`create_hypertable` na migration `create_era5_tables`); models Prisma `Era5DailyData` e `Era5IngestionRun` para leitura pelo Node (`src/modules/msa/era5.repository.ts` → `getDailySeriesForField`, `getCoverage`).

### Tabela era5_ingestion_runs

| Campo | Descrição |
|---|---|
| `id`, `command` | identificação e linha de comando (reproduzível) |
| `started_at`, `finished_at`, `status` | `RUNNING` → `SUCCEEDED` / `FAILED` |
| `updated_at` | heartbeat: renovado a cada período (mês/trimestre) obtido e a cada célula gravada; `RUNNING` sem heartbeat há mais de 6 h é marcada `FAILED` com erro `orphaned` quando o worker sobe |
| `job_id` | id do job BullMQ (`era5-ingest`) que originou a run; nulo nas execuções pelo CLI |
| `date_from`, `date_to`, `cells_requested`, `rows_upserted` | escopo e resultado |
| `cds_request_id`, `error` | diagnóstico (mensagem do CDS, dias incompletos, células puladas) |

### Estratégia de upsert
```sql
INSERT INTO era5_daily_data (time, cell_lat, cell_lon, ...) VALUES (...)
ON CONFLICT (time, cell_lat, cell_lon) DO UPDATE
SET t2m_max = EXCLUDED.t2m_max, ..., tp_corrected = EXCLUDED.tp_corrected,
    qm_applied = EXCLUDED.qm_applied, ingested_at = now();
```
Reprocessar o mesmo intervalo produz as mesmas linhas — idempotente por construção (`tests/test_load_integration.py`).

---

## Orquestração (BullMQ)

Três filas no Redis da stack (`redis`, política `noeviction`, exigida pelo BullMQ), dois processos consumidores:

| Fila | Consumidor | Payload | Opções |
|---|---|---|---|
| `era5-ingest` | **ETL Python** (`python -m era5.cli worker`, serviço `etl`, concorrência 1) | `{ kind: "latest" }` — `[hoje − 16, hoje − 6]`, todas as células; `{ kind: "range", from, to, bbox? }` — células dentro da bbox `[N, W, S, E]` ou todas; `{ kind: "cell", lat, lon, from, to }` — só a célula | `attempts: 3`, backoff exponencial a partir de 5 min |
| `msa-process` | **worker Node** (`node dist/worker.js`, serviço `worker`, concorrência 4) | `{ harvestId, seed?, reason: WEEKLY \| BACKFILL \| MANUAL }` | `attempts: 1` (o processamento é determinístico; falha vira run `FAILED`) |
| `msa-weekly` | worker Node | `trigger` (repetível) e `run` (pai do flow semanal) | scheduler `msa-weekly-trigger`: `pattern '0 2 * * 1'`, `tz 'America/Sao_Paulo'` |

A API só **enfileira**; nenhuma réplica instancia worker ou agendador.

**Fluxo semanal** — toda segunda-feira às 02:00 (Brasília) o `trigger` cria um flow com pai `msa-weekly:run` e filho `era5-ingest {kind: "latest"}` (`failParentOnFailure`). O pai só executa quando o filho conclui e então enfileira um `msa-process {reason: "WEEKLY"}` por safra `ACTIVE` com `jobId` determinístico `weekly_<AAAA-MM-DD>_<harvestId>` (reexecutar o pai no mesmo dia não duplica). Se o ingest falhar nas 3 tentativas, o pai falha e nenhuma safra é processada com dados velhos.

**Backfill ao criar safra** — `POST /api/v1/harvests` verifica a cobertura da célula do talhão de `emergenceDate` a `hoje − 6` (`planHarvestJobs`, função pura): com lacuna, cria um flow filho `era5-ingest {kind: "cell"}` → pai `msa-process {reason: "BACKFILL"}`; sem lacuna, só o `msa-process`; emergência dentro do lag, idem. A resposta traz `msaJobId` (`backfill_<harvestId>`; `null` se o Redis falhou — a safra é criada mesmo assim). O e2e `e2e-orchestration.sh` cobre uma safra de 2025-11-01 do cache ao resultado em ~30 s.

**Worker Python** — cada job abre uma run com `job_id`, roda download → transformação → carga em uma thread (o loop asyncio renova o lock do BullMQ enquanto o CDS demora), reporta `progress {periodsDone, periodsTotal}` por período obtido e renova `updated_at`. Exceção ⇒ run `FAILED` e job falho (o BullMQ decide a tentativa). `SIGTERM` conclui o job em curso antes de sair. Na subida, marca órfãs (`RUNNING` há mais de 6 h sem heartbeat).

**Operação** (`/api/v1/admin/jobs`, só `ADMIN`): `GET /queues` (contagens por fila + `weekly.nextRun`), `GET /:queue/:id` (estado, progresso, tentativas, erro), `POST /ingest-latest`, `POST /backfill-region {bbox, from, to}` (→ `era5-ingest range`), `POST /process-all` (→ `msa-process MANUAL` por safra ativa). Todas respondem 202 com `jobId` e `queue`.

**Pendente:** `era5-qm-calibration` (recalibração anual do Quantile Mapping) entra quando a correção de viés existir.

---

## Limitações e Decisões de Projeto

| Limitação | Decisão |
|---|---|
| Lag de ~5 dias do ERA5-Land | Aceito; trabalha com janelas fenológicas consolidadas |
| Sem dados em tempo real | Fora do escopo do MSA; retrospectivo por design |
| Resolução ~9 km | Adequada para o Cerrado; variabilidade sub-grade não modelada |
| QM requer estações próximas | Estações INMET/ANA cobrindo o Cerrado são suficientes para calibração estadual |
| Custo da API CDS | API gratuita para pesquisa; cache por `(bbox, mês/trimestre)` no volume `etl_cache` evita repetir requisições |
| Heartbeat durante a fila do CDS | `updated_at` só muda por período concluído; uma requisição de 2 h sem resposta deixa a run sem heartbeat por 2 h — por isso o limite de órfã é 6 h |
