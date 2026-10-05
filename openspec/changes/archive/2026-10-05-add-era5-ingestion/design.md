## Context

`era5_cells` já mapeia cada talhão ao nó da grade ERA5-Land (0,1°) mais próximo do centróide. O motor consome `DailyWeather { date, tmax, tmin, tmean?, tdew, u2, rn, precipitation }`. O banco é `timescale/timescaledb-ha:pg15` com a extensão `timescaledb` instalada e ainda sem hipertabela. `docs/msa/era5-etl.md` descreve o pipeline em Python com tabela chaveada por talhão, formato antigo da API CDS e `surface_solar_radiation_downwards`; esta change o atualiza.

A API do CDS mudou em setembro de 2024: novo endpoint (`https://cds.climate.copernicus.eu/api`), token pessoal único (sem `uid:key`), `cdsapi ≥ 0.7.x`, NetCDF com coordenada `valid_time` e, para meses recentes, dimensão `expver` (ERA5T). O usuário precisa aceitar a licença do dataset no site antes da primeira requisição.

## Goals / Non-Goals

**Goals:**

- Série diária correta para qualquer talhão com célula, com as convenções do ERA5-Land respeitadas (acumulados, unidades, vento).
- Reprocessar o mesmo intervalo não duplica nem corrompe dados.
- Nenhuma requisição repetida ao CDS para o mesmo (bbox, mês).
- Cada execução deixa rastro em `era5_ingestion_runs`.
- O Node lê a série pronta para `runDailyBalance` sem conversão adicional.

**Non-Goals:**

- Quantile Mapping (change própria; colunas já previstas).
- Agendamento (BullMQ chamará `docker compose run`/o container na próxima change).
- Dia local (UTC−3) — ver Open Questions.
- Performance de grandes áreas; a bbox das células hoje é pequena.

## Decisions

### 1. Chave por célula, não por talhão

Vários talhões caem na mesma célula de 0,1° (≈ 9 km); gravar a série por talhão duplicaria linhas idênticas e amarraria o dado climático ao cadastro. `era5_daily_data` tem PK `(time, cell_lat, cell_lon)`; o talhão chega à série via `era5_cells`. Consequências: criar um talhão numa célula já ingerida dá acesso imediato ao histórico; apagar um talhão não apaga clima. `cell_lat Decimal(4,1)` e `cell_lon Decimal(5,1)` exatamente como em `era5_cells`, para o join ser por igualdade. É o desvio em relação a `era5-etl.md` que o pedido propõe; o doc é atualizado.

### 2. Esquema

```sql
era5_daily_data (
  time date NOT NULL,                 -- dia UTC
  cell_lat numeric(4,1) NOT NULL, cell_lon numeric(5,1) NOT NULL,
  t2m_max real, t2m_min real, t2m_mean real, d2m_mean real,   -- °C
  u2 real,                            -- m/s, já a 2 m
  rn real,                            -- MJ/m²/dia
  tp_raw real, tp_corrected real,     -- mm
  qm_applied boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'era5-land',
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (time, cell_lat, cell_lon)
);
SELECT create_hypertable('era5_daily_data', 'time', chunk_time_interval => INTERVAL '1 month');
```

`time` é `date`, não `timestamptz`: o dado é diário e o dia é UTC por definição do produto; um timestamp sugeriria uma hora que não existe. `real` (float4) basta para variáveis meteorológicas agregadas e halve o tamanho da tabela em relação a `double`/`numeric`. `era5_ingestion_runs(id uuid, started_at, finished_at, status enum RUNNING/SUCCEEDED/FAILED, command text, date_from date, date_to date, cells_requested int, rows_upserted int, cds_request_id text, error text)` — `command` guarda a linha de comando para reproduzir a run.

A migration é gerada pelo Prisma (`--create-only`) a partir dos models `Era5DailyData` (`@@id([time, cellLat, cellLon])`, `Float` → `@db.Real`) e `Era5IngestionRun`, e editada para acrescentar o `create_hypertable`. O Prisma vê a hipertabela como tabela comum (os chunks ficam em `_timescaledb_internal`, fora do schema que ele inspeciona), então não há drift. A TimescaleDB exige que índices únicos incluam a coluna de tempo — a PK atende.

### 3. Serviço `etl` sob profile, invocado por `run`

`backend/etl/Dockerfile` (`python:3.12-slim`, usuário não-root, `ENTRYPOINT ["python", "-m", "era5.cli"]`). No Compose, `etl` entra com `profiles: ["etl"]`: `docker compose up` não o constrói nem inicia; `docker compose run --rm etl ingest --latest` o executa (o `run` ativa o profile do serviço nomeado). Recebe `DATABASE_URL` (montada pelo Compose como para a API), `CDS_API_URL`, `CDS_API_KEY`, `ETL_CACHE_DIR=/data/cache` com o volume nomeado `etl_cache`. Em produção, imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG}` na `backend_net` (precisa do banco e de saída para o CDS — a `backend_net` é `internal: true`, então o `etl` entra também na `frontend_net`, como a API).

Alternativa: rodar o Python dentro da imagem da API. Descartada: duas toolchains numa imagem, e o ETL tem perfil de uso (batch, memória de NetCDF) diferente do servidor.

### 4. Autenticação e requisição ao CDS (API nova)

`cdsapi.Client(url=CDS_API_URL, key=CDS_API_KEY)` — nunca `~/.cdsapirc`. Requisição por mês:

```python
{
  "variable": ["2m_temperature","2m_dewpoint_temperature","10m_u_component_of_wind",
               "10m_v_component_of_wind","surface_net_solar_radiation",
               "surface_net_thermal_radiation","total_precipitation"],
  "year": "2025", "month": "11", "day": [...todos...], "time": ["00:00", ..., "23:00"],
  "area": [N, W, S, E], "data_format": "netcdf", "download_format": "unarchived",
}
```

`surface_net_thermal_radiation` substitui o `surface_solar_radiation_downwards` do doc: Rn = Rns + Rnl exige o saldo de onda longa, e `ssr` já é o saldo de onda curta (`ssrd` × (1 − albedo) da superfície do modelo). O doc é corrigido.

Bbox: menor retângulo que contém todas as células distintas de `era5_cells` (ou só a célula do talhão no `backfill`), expandido 0,1° em cada direção e arredondado à grade. Cache em `ETL_CACHE_DIR/<sha1(bbox)>/<AAAA-MM>.nc`; existir o arquivo ⇒ não há requisição. Mudar a bbox (novo talhão fora do retângulo) muda a chave e baixa de novo — aceito; o cache não é fundido.

Para o total diário dos acumulados do último dia de um mês é preciso o passo 00 UTC do primeiro dia do mês seguinte (Decisão 5), então o pipeline baixa os meses que cobrem `[from, to + 1 dia]` e concatena antes de agregar.

### 5. Convenções do ERA5-Land na agregação

- **Acumulados (`tp`, `ssr`, `str`)**: no ERA5-Land horário, o valor em cada passo é o acumulado desde 00 UTC do mesmo dia; o passo das 00 UTC do dia D+1 traz o total do dia D. Logo `total(D) = valor(00 UTC de D+1)`, **não** a soma das 24 horas (somar daria ~12× o total). `tp` em m → × 1000 mm; `ssr`/`str` em J m⁻² → ÷ 10⁶ MJ m⁻²; `rn = (ssr + str)/10⁶` (o `str` é negativo, saldo de onda longa para cima).
- **Instantâneas (`t2m`, `d2m`, `u10`, `v10`)**: 24 passos do dia D (00–23 UTC). `t2m_max/min/mean` = máx/mín/média horária em °C (K − 273,15); `d2m_mean` = média horária em °C.
- **Vento**: velocidade horária `√(u10² + v10²)`, média diária, × 0,748 (FAO-56 Eq. 47 para 10 m — o mesmo fator de `engine/et0.ts`). Média dos componentes e depois módulo subestimaria o vento quando a direção gira.
- **Dia em UTC**: o dia D agrega 00–23 UTC. Para o Cerrado (UTC−3) o dia local começa às 03 UTC; a diferença afeta máximas/mínimas em dias de frente e a atribuição da chuva noturna. Fica em aberto (Open Questions) — a mudança seria um deslocamento de 3 h antes do agrupamento e exigiria o passo 03 UTC do dia seguinte para os acumulados.
- **`expver`**: se presente (ERA5T em meses recentes), as duas fatias são combinadas (`reduce(np.nansum)`/`combine_first`), já que cada passo tem valor em exatamente uma delas.
- Dia só é gravado se tiver os 24 passos instantâneos e o passo 00 UTC seguinte; dias incompletos (fim do intervalo baixado, falha no CDS) são omitidos e contados na run.

### 6. Célula mais próxima e upsert

Para cada célula de `era5_cells` dentro da bbox: `ds.sel(latitude=lat, longitude=lon, method="nearest")`. Como as células já estão na grade, o `nearest` é exato (distância 0); se a distância for > 0,05° (grade inesperada), a célula é pulada e a run registra o aviso. Upsert em lote com `psycopg` `executemany`: `INSERT ... ON CONFLICT (time, cell_lat, cell_lon) DO UPDATE SET <todas as colunas de dado>, ingested_at = now()`. Reprocessar o mesmo intervalo produz as mesmas linhas — idempotente por construção. `tp_corrected = tp_raw`, `qm_applied = false` até a change de QM.

### 7. CLI e runs

`python -m era5.cli <comando>`:

| Comando | Faz |
|---|---|
| `ingest --from AAAA-MM-DD --to AAAA-MM-DD` | todas as células de `era5_cells`, intervalo dado |
| `ingest --latest` | `[hoje − 16, hoje − 6]`: cobre o lag de ~5 dias com margem e sobrepõe a semana anterior (reprocessa, idempotente) |
| `backfill --harvest <uuid>` | só a célula do talhão da safra, da emergência a `hoje − 6` |
| `status [--limit n]` | últimas runs |

Toda execução de `ingest`/`backfill` abre uma run (`RUNNING`), e fecha com `SUCCEEDED` (contagens) ou `FAILED` (mensagem). Erros do CDS (licença não aceita, chave inválida, fila expirada) viram `FAILED` com a mensagem original; código de saída 1. Sem células em `era5_cells`, `ingest` termina `SUCCEEDED` com zero células e avisa.

### 8. Lado Node

`src/modules/msa/era5.repository.ts`:

- `getDailySeriesForField(fieldId, from, to): Promise<DailyWeather[]>` — localiza a célula em `era5_cells` (404-like `null` se o talhão não tem célula), consulta `era5DailyData` por célula e intervalo, mapeia `t2m_max → tmax`, `t2m_min → tmin`, `t2m_mean → tmean`, `d2m_mean → tdew`, `u2`, `rn`, `tp_corrected → precipitation`, `time → date` (`YYYY-MM-DD`). Ordenada por data.
- `getCoverage(fieldId, from, to): { expectedDays, presentDays, missingDates }`.
- As funções puras `toDailyWeather(row)` e `findMissingDates(from, to, present)` ficam exportadas para os testes Vitest sem banco.

### 9. Testes

- **pytest unitário** com `tests/fixtures/era5_synthetic.nc`, gerado por `tests/make_fixture.py` (versionado também): 1 célula, 4 dias × 24 h + o passo 00 UTC do 5º dia, com valores escolhidos para que o resultado à mão seja simples (temperaturas em rampa, `tp` acumulando 1 mm/h num dia e 0 em outro, `u10 = 3, v10 = 4` ⇒ 5 m/s ⇒ u2 = 3,74). Testa K → °C, máx/mín/média, acumulados pelas 00 UTC (inclusive que a soma das 24 h está errada), `rn`, vento, dia incompleto omitido, `expver`.
- **pytest de integração** (`-m integration`, pula sem `DATABASE_URL`): upsert duas vezes do mesmo DataFrame ⇒ mesma contagem de linhas; run registrada.
- **Vitest**: `toDailyWeather` e `findMissingDates`.
- **Ponta a ponta real** (exige `CDS_API_KEY`): `ingest --from --to` de 3 dias de um mês consolidado para a célula de um talhão de teste, registrando o tempo de fila do CDS; `backfill --harvest`; `status`; `getDailySeriesForField` → `runDailyBalance` sem erro. Roteiro em `e2e-era5.sh`, que pula com aviso se a chave não estiver no `.env`.

### 10. Documentação

`era5-etl.md`: API nova, variáveis (sem `ssrd`, com `str`), estrutura `backend/etl/era5/`, convenções da Decisão 5, esquema por célula, comandos, cache, licença. `arquitetura.md`: `etl/` detalhado na árvore e o serviço na stack. `backend/etl/README.md`: conta CDS, token, licença, comandos, cache, testes.

### 11. Notas da implementação

- `pytest.ini` precisa de `pythonpath = .` para o pacote `era5` ser importável a partir de `/app` no contêiner; os testes rodam com `docker compose run --rm --entrypoint pytest etl` (unitários) e `-m integration` (banco da stack, 4 testes).
- O `chunk_time_interval => INTERVAL '1 month'` aparece em `timescaledb_information.dimensions` como `30 days` — é a forma como o TimescaleDB representa o intervalo mensal; o comportamento é o esperado.
- `docker compose config` omite serviços com profile a menos que o profile esteja ativo (`--profile etl`); por isso a verificação do `etl` na stack de produção usa `--profile etl`.
- A soma errada das 24 horas de `tp` no dia 1 da fixture é 276 mm (0 + 1 + … + 23), não 300 como o spec exemplificou; o spec foi ajustado para o valor da fixture.
- Aviso `numpy.ndarray size changed` ao importar netCDF4 1.7.2 com numpy 2.2.2: incompatibilidade de ABI só no aviso; os testes passam. Revisar os pins quando houver netCDF4 compilado contra numpy 2.2.

### 12. Resultado da verificação real contra o CDS

`ingest --from 2025-06-01 --to 2025-06-03` para a célula (−16,7; −49,3): run `SUCCEEDED`, 3 linhas, **519 s** no total — quase tudo fila do CDS, para um NetCDF de 215 kB (bbox de 3 × 3 nós, 1 mês). Valores (tmax/tmin/u2/rn/tp): 27,5/17,6/1,58/7,52/0,22 · 28,4/18,6/1,87/7,26/0,07 · 28,2/17,8/1,64/7,11/0,15 — plausíveis para Goiânia em junho (estação seca, Rn baixo). O segundo `ingest` do mesmo intervalo levou 3 s (cache) e manteve 3 linhas. A série lida por `getDailySeriesForField` alimentou `runDailyBalance` sem erro.

O `backfill --harvest` de uma safra com emergência em jun/2025 (16 meses → 16 requisições) baixou 3 meses em ~30 min e foi interrompido pelo limite de tempo do processo que o executava, deixando a run em `RUNNING`; a run foi fechada manualmente como `FAILED`. Consequências:

- No roteiro `e2e-era5.sh`, o backfill completo passou a ser opcional (`ERA5_E2E_BACKFILL=1`); por padrão o roteiro exercita só o caminho de erro do backfill (safra inexistente → run `FAILED`). O `ingest` real já prova a cadeia download → agregação → carga → leitura.
- Um processo morto por fora deixa a run em `RUNNING` indefinidamente — ver Open Questions.

## Risks / Trade-offs

- **[Fila do CDS]** → Requisições de ERA5-Land levam de minutos a horas conforme a carga do serviço. O cache por mês evita repetir; o `--latest` pede só o necessário. O tempo de fila observado fica registrado no e2e.
- **[Licença não aceita]** → Erro 403 na primeira requisição; a run fica `FAILED` com a mensagem do CDS e o README explica o aceite.
- **[Convenção de acumulados mal aplicada]** → Erro clássico (somar as 24 h). O teste com a fixture sintética falha se isso regredir.
- **[Dia UTC ≠ dia local]** → Documentado; impacto esperado pequeno em totais de janela, maior em extremos diários.
- **[`expver` em meses recentes]** → Tratado na transformação; o teste cobre.
- **[Bbox muda com novos talhões]** → Cache por bbox não reaproveita; custo de um download extra por mês afetado.
- **[`real` perde precisão]** → 7 dígitos significativos; irrelevante para °C, mm e MJ agregados.
- **[Sem chave do CDS no ambiente de desenvolvimento]** → Toda a cadeia, menos o download, é verificada com a fixture e um NetCDF local via `ingest --from-file`? Não: para não criar caminho paralelo, o teste de integração injeta o DataFrame direto no `load`. O download real depende da chave do usuário.

## Migration Plan

1. Migration `create_era5_tables` (tabelas + `create_hypertable`); `migrate deploy` no startup da API a aplica.
2. `docker compose build etl` e `docker compose run --rm etl status` para validar o container.
3. Com `CDS_API_KEY` no `.env`: `docker compose run --rm etl ingest --latest`.
4. Rollback: remover o serviço e `DROP TABLE era5_daily_data, era5_ingestion_runs`.

## Open Questions

- **Dia local vs. UTC**: adotar UTC−3 fixo no agrupamento? Decidir com a pesquisadora antes do Caso 2 da validação (comparação com CROPWAT usa dia local das estações).
- **Fator de vento**: 0,748 (log, z₀ padrão) é o do FAO-56; o ERA5-Land tem rugosidade própria por célula. Manter até a validação com estações INMET.
- **Retenção/compressão** da hipertabela (`add_compression_policy`) quando o volume crescer.
- **Runs órfãs**: um contêiner morto por fora (OOM, `docker stop`, limite de tempo) deixa a run em `RUNNING`. A change da fila (BullMQ) deve marcar como `FAILED` runs `RUNNING` mais antigas que um limite (ex.: 6 h) ao iniciar uma nova execução, ou registrar heartbeat.
- **Backfills longos**: 1 requisição por mês × ~10 min de fila torna um backfill de uma safra inteira uma operação de horas. Avaliar requisições por trimestre/ano (o CDS aceita vários meses por requisição; o cache passaria a ser por intervalo) na change da fila.
