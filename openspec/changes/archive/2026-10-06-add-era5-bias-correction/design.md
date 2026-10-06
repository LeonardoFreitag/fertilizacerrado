## Context

`era5_daily_data` já tem `tp_raw`, `tp_corrected` e `qm_applied` (iguais e falso desde `add-era5-ingestion`); `era5.repository.toDailyWeather` usa `tp_corrected` — o balanço hídrico passa a receber a chuva corrigida sem mudar o Node, bastando o ETL preencher a coluna. O ETL Python já roda como worker da fila `era5-ingest` com despacho por `kind`, e o worker Node registra agendadores BullMQ. A API tem `/admin/jobs` (ADMIN) e a página `/admin`. Não há upload multipart ainda; o Nginx de produção já tem a zona `api_upload` em `^/api/v[0-9]+/.+/upload` (`client_max_body_size 50m`).

Restrições: Python 3.12 com numpy/pandas; sem scipy (interpolação linear com `numpy.interp`); nada de download automático do BDMEP; toda escolha científica configurável por variável de ambiente com default documentado.

## Goals / Non-Goals

**Goals:**
- Corrigir a precipitação diária por célula com um método reprodutível, auditável (parâmetros em JSON no banco, calibração referenciada pela run) e substituível (versão do método na calibração).
- Operação completa sem shell: importar CSV, calibrar e aplicar pela página `/admin`; recalibração anual automática.
- Dar à pesquisadora o instrumento do Caso 4 (`qm validate`) e testes que provam o método em dados sintéticos antes de ter os reais.

**Non-Goals:**
- Correção de temperatura (futuro: mesma estrutura, `variable = 't2m'`).
- Download/scraping do BDMEP ou da ANA; QM paramétrico (gamma) ou com covariáveis; interpolação espacial entre estações.
- Reprocessar automaticamente todas as safras após `qm apply` (fica a cargo de `process-all`; registrado na doc).

## Decisions

### 1. Método: QM empírico mensal em duas etapas (`empirical-monthly-v1`)
Por mês do ano `m`, sobre os dias de sobreposição válida (ERA5 e observação presentes) no período de calibração:
1. **Frequência**: `f_obs(m)` = fração de dias com `obs > WET_DAY_MM`. O limiar do ERA5 `θ_era5(m)` é o quantil `1 − f_obs(m)` da série ERA5 do mês (percentil empírico, interpolação linear) — assim a fração de dias ERA5 `> θ_era5` iguala `f_obs`. Aplicação: `tp ≤ θ_era5(m) ⇒ 0`.
2. **Intensidade**: nos dias chuvosos de cada série (ERA5 `> θ_era5(m)`, obs `> WET_DAY_MM`), 99 quantis (1–99 %) `q_era5[k]`, `q_obs[k]`. Aplicação: `tp_corr = interp(tp, q_era5, q_obs)` (linear; abaixo de `q_era5[0]` escala linear até 0). Acima de `q_era5[98]`: `tp_corr = tp × min(q_obs[98]/q_era5[98], MAX_RATIO)` — extrapolação por razão constante limitada (Themeßl et al. 2012 discutem a cauda; o limite evita explodir extremos com poucas amostras).
Mês sem dia chuvoso observado ⇒ `θ_era5 = +∞` (tudo zero) e quantis vazios; mês sem dia chuvoso no ERA5 ⇒ sem mapeamento (identidade acima do limiar). Tudo em `qm.py` como funções puras sobre arrays alinhados por data; a persistência e o pareamento ficam em `qm_store.py`/`db.py`.

### 2. Pareamento célula↔estação
`nearest_eligible_station(cell, stations, overlap)`: distância haversine do nó da célula (`cell_lat, cell_lon`) à estação; candidatas ativas com `distance ≤ QM_MAX_DISTANCE_KM`, ordenadas por distância; a primeira com sobreposição válida ≥ `QM_MIN_YEARS × 365` dias (dias com ERA5 e observação não nulos, dentro de `--from/--to` quando informados) é escolhida. Nenhuma ⇒ `None` + aviso na run (`qm calibrate --auto` continua para as demais células). A distância e o período usados ficam na calibração.

### 3. Esquema
- `weather_stations(code PK text, name, source enum INMET|ANA|OUTRA, lat, lon, altitude_m, geometry geography(Point,4326), active bool, created_at, updated_at)`.
- `station_daily_obs(station_code FK, date, precip_mm real, tmax real?, tmin real?, source_file text, imported_at)`, PK `(station_code, date)`, hipertabela por `date` (chunk 1 ano — volume pequeno, muitos anos).
- `qm_calibrations(id uuid, cell_lat, cell_lon, station_code FK, variable text 'tp', method text, period_from date, period_to date, n_days_by_month jsonb, wet_day_threshold_obs real, wet_thresholds_era5 jsonb, quantiles jsonb, max_ratio real, distance_km real, active bool, created_at)`, índice único parcial `(cell_lat, cell_lon, variable) WHERE active`.
- `era5_daily_data.qm_calibration_id uuid?` (FK `ON DELETE SET NULL`), `msa_runs.qm_calibration_id uuid?`.
Migration Prisma com SQL cru para a hipertabela e o índice parcial, gerada com `migrate diff --from-url --to-schema-datamodel` (nunca shadow sobre o banco real — lição da change de processamento) e aplicada com `migrate deploy`. Models Prisma para os três novos (o Node só lê `weather_stations`, `qm_calibrations` e grava `qm_calibration_id` na run).

### 4. Aplicação no load e sob demanda
`load.py` passa a receber a calibração ativa da célula (consultada uma vez por célula na ingestão): `tp_corrected = apply(tp_raw)`, `qm_applied = true`, `qm_calibration_id`. Sem calibração: `tp_corrected = tp_raw`, falso, nulo (comportamento atual). `qm apply --cell|--all` reaplica nas linhas existentes em lotes por mês (`UPDATE ... WHERE cell = ... AND time BETWEEN`), idempotente: aplicar duas vezes dá o mesmo resultado porque sempre parte de `tp_raw`. Recalibrar desativa a calibração anterior e `apply` troca o `qm_calibration_id` das linhas.

### 5. Reprodutibilidade na run
`msa.service` (inline e worker) lê a calibração ativa da célula do talhão no momento do processamento e grava `qmCalibrationId` na run; `GET /msa`/`/runs` devolvem o id e um resumo (`qmCalibration: { stationCode, stationName, years, distanceKm } | null`) para o selo. Como a série é lida de `tp_corrected`, o id registra *qual* correção estava aplicada; se `qm apply` rodar depois, a run antiga continua apontando para a calibração que a produziu (as linhas mudam, a run não — reprocessar gera nova run com o novo id). Documentado.

### 6. Importação de observações
Parsers em `stations.py`: `parse_bdmep(path)` — lê o cabeçalho de metadados do BDMEP (linhas `Nome: …`, `Codigo Estacao: …`, `Latitude: …`, `Longitude: …`, `Altitude: …`, `Situacao`, até a linha de cabeçalho das colunas), detecta a coluna de precipitação diária (`PRECIPITACAO TOTAL, DIARIO (AUT)(mm)` ou `PRECIPITACAO TOTAL, DIARIA (mm)`), `Data Medicao`, temperaturas máx./mín. quando presentes; `;` e vírgula decimal; vazio/`null` ⇒ nulo. `parse_generic(path)` — `station_code,date,precip_mm[,tmax,tmin]` com ponto decimal; a estação precisa existir ou ser informada por `--station-meta` (nome, lat, lon, alt, fonte) / campos do upload. Upsert `(station_code, date)`; a estação é criada/atualizada (`ON CONFLICT (code) DO UPDATE` nos metadados). O upload (`multer`, disco, 50 MB, extensão `.csv`/`.txt`) grava em `/data/station-imports/<uuid>-<nome>` no volume `station_imports` (montado em `api`, `worker` e `etl` no mesmo caminho) e enfileira `{kind: "station-import", path, format, stationMeta?}`; o worker remove o arquivo ao concluir com sucesso e registra a run em `era5_ingestion_runs` (`command = "worker station-import …"`).

### 7. Jobs, CLI e agendamento
Fila `era5-ingest` (concorrência 1, o que serializa importação/calibração com a ingestão): kinds `station-import`, `qm-calibrate` (`{cell: {lat, lon}, station}` ou `{auto: true}`, sempre seguido de `apply` nas células calibradas; `from`/`to` opcionais) e `qm-apply` (`{cell?}`, sem célula = todas). Agendamento anual: o worker Node registra `qm-annual-trigger` (`pattern '0 3 1 1 *'`, `tz America/Sao_Paulo`) na fila `msa-weekly`; o processador enfileira `era5-ingest {kind: "qm-calibrate", auto: true}` (que já aplica). Endpoints: `GET /admin/stations` (lista com contagem de observações e período), `POST /admin/stations/upload` (multipart `file`, `format`, metadados opcionais → 202), `GET /admin/qm/calibrations` (ativas e inativas, com estação), `POST /admin/qm/calibrate` (`{cell, station}` ou `{auto: true}` → 202). CLI: `stations import <arquivo> --format bdmep|generic [--station-meta …]`, `stations list`, `qm calibrate …`, `qm apply …`, `qm status`, `qm validate …`.

### 8. Validação (Caso 4) e testes
`qm validate --cell LAT LON --station CODE --calib-years 2010-2019 --test-years 2020-2024 [--csv saida.csv]`: calibra nos anos A (sem persistir), aplica nos anos B, imprime por mês e total RMSE, PBIAS e fração de dias chuvosos para ERA5 bruto × corrigido contra a observação, e salva CSV. Testes pytest (sem CDS): fixture `make_qm_fixture.py` gera 10 anos de "ERA5" sintético (repetindo os 16 meses do NetCDF sintético/da série de teste com perturbação determinística `seed = 42`) e a "observação" `obs = era5 × 1,3` nos dias chuvosos com garoa (< 0,5 mm) zerada; esperado: fração de dias chuvosos recuperada (±1 p.p.), `|PBIAS| < 2 %` após correção, `PBIAS` bruto ≈ −23 %. Bordas: mês sem chuva observada (limiar infinito, tudo zero), 3 anos de sobreposição (inelegível), estação a 80 km (inelegível), `apply` duas vezes (idêntico), `MAX_RATIO` limitando a cauda. Integração: tabelas e índice parcial (uma ativa por célula).

### 9. Frontend
`/admin`: seção **Estações e correção de viés** — upload (arquivo, formato, metadados para o genérico) → 202 com job na lista da sessão; tabela de estações (código, nome, fonte, distância não — só dados); tabela de calibrações (célula, estação, período, anos, status ativa); botões **Calibrar (auto)** e **Calibrar célula** (lat/lon + estação). Painel da safra: no cabeçalho, selo "Chuva corrigida — estação X (N anos, D km)" ou "Chuva sem correção (ERA5-Land bruto)" a partir de `run.qmCalibration`. Tipos novos em `types.ts`.

### 10. Configuração
`env.ts` (Node, só para documentação/`/admin`) e `config.py` (Python, efetivo): `QM_MAX_DISTANCE_KM=50`, `QM_MIN_YEARS=10`, `QM_WET_DAY_MM=0.1`, `QM_MAX_RATIO=3`. Os valores efetivos ficam gravados em cada calibração (`wet_day_threshold_obs`, `max_ratio`, `distance_km`), então mudar o `.env` não altera calibrações passadas.

## Risks / Trade-offs

- **[Poucos anos reais disponíveis]** → `QM_MIN_YEARS` configurável; `qm validate` mostra o efeito de janelas curtas. Com < 10 anos a calibração é possível por configuração, mas o default protege.
- **[Estação com falhas longas]** → só dias com observação válida entram; `n_days_by_month` registra a base de cada mês; mês com < 30 dias chuvosos observados gera aviso (quantis instáveis) sem bloquear.
- **[Extrapolação na cauda]** → razão constante limitada por `MAX_RATIO` e documentada; alternativa (gamma) fica como item na `questoes-abertas.md`.
- **[Mudança silenciosa da série]** → `qm apply` não reprocessa safras; o selo e `qmCalibrationId` tornam visível qual correção cada run usou; recomendado `process-all` após calibrar (botão na mesma página).
- **[Upload de arquivo arbitrário]** → ADMIN, 50 MB, extensão e MIME checados, parser tolerante que rejeita o arquivo com mensagem na run; arquivo apagado após importar.
- **[Fuso das observações]** → BDMEP é dia local; ERA5 é dia UTC (questão aberta nº 2). Pareamento por data-calendário; registrado na doc como limitação conhecida.

## Notas de implementação

- **Sem scipy**: quantis com `numpy.percentile(method="linear")` e aplicação com `numpy.interp`; abaixo do P1 escala linear até 0, acima do P99 razão limitada.
- **Persistência em `db.py`** (não em `qm_store.py` separado): funções de estação, observação, calibração e `update_corrected` ficaram no módulo de acesso ao banco existente; `qm_ops.py` concentra pareamento, calibração, aplicação e validação sobre o banco; `qm.py` segue puro. `synthetic.py` guarda os geradores determinísticos usados por `tests/test_qm.py` e por `tests/make_qm_fixture.py` (fixture do e2e).
- **Volume compartilhado e uids**: o `api` (root em dev) criou `/data/station-imports` como `root:755`, e o `etl` (uid 1001) não conseguia escrever nem apagar. O diretório passou a `777` (Dockerfile do etl e `mkdirSync` do upload) e os arquivos enviados a `0666`; em volumes já existentes, `chmod 777` uma vez (`docker compose run --rm --user root --entrypoint sh etl -c 'chmod 777 /data/station-imports'`).
- **Retentativas**: `station-import`, `qm-calibrate` e `qm-apply` entram na fila com `attempts: 1` — a falha é definitiva (arquivo inválido, estação ausente) e o backoff de 5 min do ingest só atrasaria o feedback.
- **Metadados da estação**: `nome;FONTE;lat;lon;alt` e `codigo;nome;FONTE;lat;lon` têm o mesmo número de partes; `StationMeta.parse_auto` decide pela posição da FONTE (2ª ou 3ª) em vez de contar campos.
- **Fixture**: 10 anos = `int(10 × 365,25)` = 3.652 dias; o e2e confere 3.652 linhas.
- **Chave do CDS**: o worker deixou de exigir `CDS_API_KEY` na subida (os jobs de estação/QM não a usam); os jobs de ingestão continuam falhando sem ela.
- **`curl -F` e `;`**: no multipart do curl, `;` dentro do valor é separador de opções (`;type=`); o e2e envia `stationMeta` entre aspas (`-F 'stationMeta="nome;FONTE;lat;lon;alt"'`). O navegador (FormData) não tem esse problema.
- **Anos de sobreposição = dias ÷ 365** (não 365,25): 10 anos civis são 3.652 dias, que com 365,25 dariam 9,9986 e seriam inelegíveis; `DAYS_PER_YEAR = 365` em `qm.py`.
- **e2e-orchestration na borda do lag**: o mês aberto do cache pode não ter o dia `hoje − 6`; a criação de uma segunda safra então enfileira um backfill curto (servido pelo cache). O roteiro passou a aceitar isso (última run do ETL `SUCCEEDED`) em vez de exigir "nenhuma run nova".
- **Nginx e upstream recriado**: depois de `docker compose up -d --build api`, o nginx de dev guarda o IP antigo do contêiner e responde 502 em `/api/` até `docker compose restart nginx` — causa dos primeiros Playwright falhos (`POST /auth/register → 502`).
- **Teste do cache mensal dependia da data fixa** (2026-10-05): passou a derivar o mês aberto e um mês fechado da data real.

## Migration Plan

1. Migration (tabelas, colunas); `multer` no backend; `env.ts`/`config.py`.
2. ETL: `stations.py`, `qm.py`, `load.py`, `cli.py`, `worker.py`; testes; rebuild do `etl`.
3. Node: endpoints admin, flows/scheduler anual, snapshot na run; frontend; compose (volume); docs.
4. Rollback: colunas novas são nulas; sem calibrações `tp_corrected = tp_raw` como antes.

## Open Questions

- Defaults científicos (50 km, 10 anos, 0,1 mm, 3×) — item 6 de `questoes-abertas.md`; a Heb pode mudá-los no `.env` e recalibrar.
- Dia local × UTC no pareamento com estações (questão nº 2): avaliar deslocar o ERA5 para o dia local antes de calibrar.
- Reprocessar automaticamente as safras ativas após a calibração anual? Hoje não; decidir com a Heb.
