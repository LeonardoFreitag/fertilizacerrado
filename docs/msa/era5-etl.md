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
O ERA5-Land apresenta viés sistemático de precipitação no Cerrado: superestima a frequência de dias com chuva fraca ("garoa" da reanálise) e subestima os eventos convectivos intensos. O balanço hídrico do MSA lê `tp_corrected`; sem calibração, `tp_corrected = tp_raw`.

### Método: QM empírico mensal em duas etapas (`empirical-monthly-v1`)
Implementado em `backend/etl/era5/qm.py` (funções puras) e `qm_ops.py` (banco). Por **mês do ano** `m`, sobre os dias de sobreposição válida (ERA5 e observação presentes) no período de calibração:

1. **Frequência de dias chuvosos.** `f_obs(m)` é a fração de dias observados com chuva `> QM_WET_DAY_MM` (default 0,1 mm). O limiar do ERA5 é o quantil `1 − f_obs(m)` da série ERA5 do mês: valores `≤ θ_era5(m)` viram **0**. Assim a fração de dias chuvosos corrigida iguala a observada.
2. **Intensidade.** Nos dias chuvosos de cada série (ERA5 `> θ_era5(m)`, observação `> QM_WET_DAY_MM`), 99 quantis (1–99 %) `q_era5[k]`, `q_obs[k]`. Aplicação: `tp_corr = interp(tp_raw, q_era5, q_obs)` (linear; abaixo do P1, escala linear até 0). **Acima do P99**: razão constante do último quantil, limitada a `QM_MAX_RATIO` (default 3) — extrapolação por razão evita achatar extremos não vistos na calibração, e o limite evita explodi-los.

$$P_{corr} = F_{obs}^{-1}\left[F_{era5}(P_{era5})\right]$$ para `P_era5 > θ_era5(m)`; `0` caso contrário.

Casos de borda: mês sem dia chuvoso observado ⇒ `θ = +∞` (tudo zero); mês sem dia chuvoso no ERA5 ⇒ identidade acima do limiar. Só precipitação nesta versão (temperatura: mesma estrutura, `variable = 't2m'`, futuro).

### Observações: estações e importação
- `weather_stations` (código, nome, fonte `INMET|ANA|OUTRA`, lat/lon, altitude, geometria PostGIS, ativa) e `station_daily_obs` (hipertabela por data: `precip_mm`, `tmax`/`tmin` opcionais, arquivo de origem).
- Importador (`stations.py`): **BDMEP/INMET** diário (cabeçalho de metadados com código/lat/lon/altitude, `;`, vírgula decimal) ou **genérico** (`station_code,date,precip_mm[,tmax,tmin]`). Upsert por `(station_code, date)`; linhas inválidas são contadas, não abortam. Download do BDMEP fica fora (exige login) — ver `backend/etl/README.md`.
- Fluxo: `POST /api/v1/admin/stations/upload` (ADMIN, multipart, zona `api_upload` do Nginx) grava no volume `station_imports` e enfileira `era5-ingest {kind: "station-import"}`; o worker importa, registra a run e apaga o arquivo. CLI: `stations import <arquivo> --format bdmep|generic`, `stations list`.

### Pareamento célula ↔ estação
Estação **ativa mais próxima** do nó da célula (haversine) dentro de `QM_MAX_DISTANCE_KM` (default 50) com ao menos `QM_MIN_YEARS` (default 10) de sobreposição válida. Sem estação elegível a célula fica sem calibração e a run registra o aviso (`qm calibrate --auto` segue para as demais).

### Tabela `qm_calibrations`
| Campo | Descrição |
|---|---|
| `cell_lat`, `cell_lon`, `station_code`, `variable` (`tp`) | célula calibrada e estação usada |
| `method` | `empirical-monthly-v1` |
| `period_from`, `period_to`, `n_days_by_month` | período e base de dias válidos por mês |
| `wet_day_threshold_obs`, `wet_thresholds_era5` | limiar observado (config) e os 12 limiares do ERA5 |
| `quantiles` | por mês: `era5[]` e `obs[]` (99 valores) |
| `max_ratio`, `distance_km` | configuração efetiva e distância da estação |
| `active`, `created_at` | **uma ativa por célula/variável** (índice único parcial); recalibrar desativa a anterior, nunca apaga |

### Aplicação
- **No load** de cada ingestão (`load.py`): a calibração ativa da célula preenche `tp_corrected`, `qm_applied = true` e `qm_calibration_id`; sem calibração, `tp_corrected = tp_raw`.
- **Sob demanda**: `qm apply --cell LAT LON | --all` reaplica nas linhas existentes, sempre a partir de `tp_raw` (idempotente). Recalibrar + `apply` troca o `qm_calibration_id` das linhas.
- **Reprodutibilidade**: cada run do MSA grava `qm_calibration_id` (calibração ativa da célula no momento); o painel mostra "Chuva corrigida — estação X (N anos, D km)" ou "Chuva sem correção". Runs antigas não mudam quando a célula é recalibrada; só uma run nova referencia a calibração nova. **`qm apply` não reprocessa safras** — use "Processar todas as safras ativas".

### Jobs e agendamento
Fila `era5-ingest` (concorrência 1 — serializa calibração com ingestão): `station-import`, `qm-calibrate` (`{cell, station}` ou `{auto: true}`, sempre seguido de `apply`), `qm-apply`. Agendador anual `qm-annual-trigger` (`0 3 1 1 *`, `America/Sao_Paulo`) no worker Node ⇒ `qm-calibrate {auto: true}`. Endpoints ADMIN: `GET /admin/stations`, `POST /admin/stations/upload`, `GET /admin/qm/calibrations`, `POST /admin/qm/calibrate`; botões na página `/admin`.

### Validação (Caso 4) e testes
`python -m era5.cli qm validate --cell LAT LON --station CODE --calib-years 2010-2019 --test-years 2020-2024 [--csv saida.csv]`: calibra em A sem persistir, aplica em B e imprime RMSE, PBIAS e fração de dias chuvosos (bruto × corrigido × observado) por mês e total. Testes (`tests/test_qm.py`) usam uma estação sintética com viés conhecido (ERA5 × 1,3 nos dias chuvosos, garoa < 0,5 mm removida): a calibração recupera a fração de dias chuvosos (±1 p.p.) e leva o PBIAS de ≈ −20 % para < 2 %. O roteiro `e2e-qm.sh` cobre upload → calibração → aplicação → run com `qmCalibrationId`.

### Configuração
`QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM`, `QM_MAX_RATIO` (defaults 50, 10, 0,1, 3) — lidas pelo `etl` e gravadas em cada calibração; ver `docs/msa/questoes-abertas.md` item 6.

### Limitações conhecidas
- Pareamento por data-calendário: o BDMEP é dia local, o ERA5 é dia UTC (questão aberta nº 2).
- Cauda acima do P99 por razão limitada (alternativa paramétrica gama: questão nº 6).
- Mês com menos de 30 dias chuvosos observados gera aviso (quantis instáveis), sem bloquear.

### Referência bibliográfica
> PIANI, C. et al. (2010). Statistical bias correction of global simulated daily precipitation and temperature for the application of hydrological models. *Journal of Hydrology*, 395(3-4), 199–215.
> THEMEẞL, M. J.; GOBIET, A.; HEINRICH, G. (2012). Empirical-statistical downscaling and error correction of regional climate models and its impact on the climate change signal. *Climatic Change*, 112, 449–468.
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
| QM requer estações próximas | Pareamento célula ↔ estação ativa mais próxima (≤ 50 km, ≥ 10 anos, configurável); célula sem estação elegível fica sem correção, com aviso |
| Custo da API CDS | API gratuita para pesquisa; cache por `(bbox, mês/trimestre)` no volume `etl_cache` evita repetir requisições |
| Heartbeat durante a fila do CDS | `updated_at` só muda por período concluído; uma requisição de 2 h sem resposta deixa a run sem heartbeat por 2 h — por isso o limite de órfã é 6 h |
