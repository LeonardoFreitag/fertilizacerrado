## Context

`era5Repository.getDailySeriesForField` devolve `DailyWeather[]`; `runMonteCarlo` devolve baseline, série diária, percentis e metadados; `generateDecisionScenarios` precisa de `phase`, `ksP50`, `baselineSeries`, cultivar, dose e eficiência. `Harvest` liga talhão e cultivar; `Field` tem célula ERA5 mas não tem altitude nem solo. O motor exige altitude (`BalanceOptions.altitude` obrigatório, por decisão da change do motor) e solo (`SoilParams`). `docs/modulos/msa.md` lista endpoints provisórios (`/msa/phases`, `/msa/reprocess`) que esta change substitui pelos definitivos.

## Goals / Non-Goals

**Goals:**

- Uma chamada processa uma safra e deixa no banco tudo o que é preciso para refazer o cálculo e obter o mesmo resultado: dados de entrada (referência ao intervalo e à célula), parâmetros (snapshots), semente, iterações, sigmas e versão do motor.
- Lacuna de dados nunca vira número: vira `NEEDS_DATA` com as datas.
- Leitura rápida do último resultado sem recalcular.
- A decisão do técnico fica registrada com o cenário exatamente como foi apresentado.

**Non-Goals:**

- Fila, agendamento, concorrência entre processamentos da mesma safra (síncrono; dois `POST /process` simultâneos geram duas runs, ambas válidas).
- Interpolar ou preencher dias faltantes.
- Recalcular runs antigas com uma versão nova do motor.
- Expor a série perturbada das iterações (só baseline e percentis).

## Decisions

### 1. Altitude e solo no talhão

`Field` ganha `altitudeM Float?`, `thetaFC Float?`, `thetaWP Float?`. DTOs: `altitudeM` em [−100, 5000] m (Brasil: 0–3000, folga para erros de digitação grosseiros serem pegos), `thetaFC`/`thetaWP` em (0, 1) com `thetaFC > thetaWP` validado sobre o estado resultante no `PATCH` (mesma técnica do `PATCH` de cultivar). `null` no `PATCH` limpa o campo. Como a escrita de `fields` é SQL cru, as três colunas entram no `INSERT`/`UPDATE` do `property.repository`.

Altitude sem default (422 `MISSING_FIELD_ALTITUDE` no processamento): 1.000 m mudam ET₀ em ~2 %, e um default para o nível do mar seria um erro silencioso — a mesma razão pela qual o motor exige `altitude`. Solo com default (0,28/0,12) porque é um valor regional defensável documentado em `algoritmos.md` §5 e será substituído pelo laudo físico-hídrico (Fase 2); o valor usado fica no `soilSnapshot`, então a run nunca é ambígua. Altitude poderia vir de um DEM pela célula ERA5 (futuro); hoje o técnico informa.

### 2. Esquema de persistência

```
msa_runs            id, harvest_id→harvests, status (SUCCEEDED|FAILED|NEEDS_DATA), started_at, finished_at,
                    date_from, date_to (date), seed (int), iterations, sigma_precip, sigma_temp,
                    cultivar_snapshot (jsonb), soil_snapshot (jsonb), engine_version, missing_dates (jsonb?),
                    error, triggered_by_id→users (SET NULL)
msa_daily_results   (run_id, date) PK — phase, gda, gda_accum, zr, et0, kc, etc, precipitation, dr, ks, etc_adj, taw, raw (double)
msa_phase_summaries (run_id, phase) PK — days, ks_mean?, etc_adj_accum, precip_accum, yield_reduction_pct?, valid_iterations,
                    ks_mean_p10/p50/p90?, yield_reduction_p10/p50/p90?, etc_adj_accum_p10/p50/p90?
msa_decisions       id, harvest_id, run_id, phase, scenario (A|B|C), dose_base, efficiency_base, scenario_payload (jsonb),
                    justification, decided_by_id→users (SET NULL), created_at
harvests.latest_run_id → msa_runs (único, SET NULL)
```

- Resultados em `double precision` (não `real`): o requisito de reprodução byte a byte compara números gravados com números recalculados; `real` arredondaria os dois igualmente, mas `double` elimina a dúvida e o custo é irrelevante (150 linhas por run).
- `seed` inteiro em [0, 2³¹ − 1] gerado com `crypto.randomInt` quando não informado — cabe em `Int` do Prisma e no `uint32` do mulberry32.
- `cultivarSnapshot` = os 15 parâmetros + `id`, `name`, `crop`; `soilSnapshot` = `{ thetaFC, thetaWP, altitudeM, soilDefaults: boolean }`. A reprodução usa só os snapshots, nunca o registro atual da cultivar — por isso o snapshot é a pré-condição para, no futuro, relaxar `CULTIVAR_IN_USE` (Open Questions).
- `phase` em `msa_daily_results` e `msa_phase_summaries` como texto (`F1`…`COMPLETED`), não enum, para não acoplar o banco ao tipo do motor; validado pelo motor na escrita.
- `missingDates` como JSON de strings `YYYY-MM-DD`.
- `latestRunId` aponta só para runs `SUCCEEDED`: `NEEDS_DATA` e `FAILED` ficam no histórico (`GET /runs`) mas não substituem o último resultado válido.

### 3. `ENGINE_VERSION`

`export const ENGINE_VERSION = '1.0.0'` em `engine/index.ts`. Regra: muda a *patch* quando um ajuste numérico não altera resultados além de arredondamento (ex.: refatoração), *minor* quando o resultado muda para a mesma entrada (ex.: adotar dia local, relaxar G = 0), *major* quando a interface muda. Gravada em cada run; `GET /msa` a devolve para o relatório saber com qual versão cada número foi produzido.

### 4. Intervalo de processamento

`from = emergenceDate`; `limit = hoje − 6` (UTC; o mesmo lag do ETL). O service lê a série em `[from, limit]`; acumula o GDA sobre os **dias presentes** e, se `gdaAccum ≥ gdaTotal` no dia `d`, `to = d` (o ciclo terminou; lacunas depois de `d` não bloqueiam); senão `to = limit`. Se houver lacuna em `[from, to]` ⇒ `NEEDS_DATA` com `missingDates` (inclui a série vazia e a emergência ainda dentro do lag). Se `from > limit` ⇒ `NEEDS_DATA` com o intervalo inteiro.

Com lacunas, o GDA somado só sobre os dias presentes é uma estimativa **por baixo** do fim do ciclo — serve apenas para delimitar o intervalo e, portanto, a lista de datas faltantes; o cálculo em si nunca roda com lacunas. A primeira versão parava a acumulação na primeira lacuna, o que fazia `missingDates` listar todas as datas até `hoje − 6` (centenas) quando faltavam só dois dias em novembro; a estimativa sobre os dias presentes devolve só os dois dias, que é o que o técnico precisa saber para pedir a reingestão.

Não se interpola nem se preenche: um dia inventado vira ET₀ e balanço inventados, e o protocolo de validação compara com o CROPWAT dia a dia.

### 5. Processamento e transação

```
processHarvest(harvestId, { seed?, triggeredBy }):
  harvest ← carrega com field (altitudeM, thetaFC, thetaWP, propertyId) e cultivar; escopo via propertyService (404)
  altitude ausente → 422 MISSING_FIELD_ALTITUDE (nenhuma run é criada: é erro de cadastro, não de processamento)
  intervalo + cobertura (Decisão 4) → NEEDS_DATA ⇒ grava run e devolve
  startedAt ← now; seed ← informada ?? randomInt(2³¹)
  result ← runMonteCarlo(series, cultivarParams, soil, { iterations: 1000, seed, altitude, initialDepletion: 0 })
  tx: create run SUCCEEDED + createMany daily (baselineSeries) + create 4 summaries (baseline ⊕ percentis) + harvest.latestRunId = run.id
  erro no motor/transação → run FAILED fora da transação, com a mensagem; responde 500 MSA_PROCESSING_FAILED com runId
```

`sigmaPrecip`/`sigmaTemp` usam os defaults do motor (0,30 / 0,6) e são gravados; não há parâmetro na API para mudá-los nesta change (evita runs com sigmas diferentes misturadas no histórico sem a pesquisadora pedir).

`cultivarParams` passado ao motor é o **snapshot** (não o registro), para que o que foi gravado seja exatamente o que foi usado.

Safra `COMPLETED`/`CANCELLED` pode ser processada (reprocessamento manual do histórico); o que não existe é reprocessamento automático.

### 6. Rotas e roles

Montadas em `harvest.routes.ts` com `harvestRoutes.use('/:id/msa', msaRoutes)` (`mergeParams`), depois do `authenticate` do router pai. Toda rota resolve a safra pelo escopo do usuário (`harvestService.getAccessible`, 404 fora dele).

| Rota | `authorize` | Resposta |
|---|---|---|
| `POST /process` | `AGRONOMO`, `ADMIN` | 201 run `SUCCEEDED` com resumos; 200 run `NEEDS_DATA` com `missingDates`; 422 `MISSING_FIELD_ALTITUDE`; 500 `MSA_PROCESSING_FAILED` |
| `GET /` | qualquer | última run `SUCCEEDED` + resumos + metadados; 404 `NO_MSA_RESULT` se nunca processada |
| `GET /daily?runId=` | qualquer | série baseline da run (padrão: `latestRunId`); 404 se a run não é da safra |
| `GET /runs` | qualquer | histórico, mais recente primeiro, sem séries |
| `GET /decision?phase&doseBase&efficiencyBase` | qualquer | cenários sobre a última run; nada persistido; 422 `PHASE_NOT_REACHED` se a janela não tem `ksMean` |
| `POST /decisions` | `AGRONOMO`, `ADMIN` | registra a escolha; 422 `SCENARIO_UNAVAILABLE` se o cenário B é nulo para a janela |
| `GET /decisions` | qualquer | decisões da safra, mais recente primeiro |

`GET /decision` é leitura (query params) porque não persiste nada e é idempotente; `POST /decisions` recomputa os cenários para a run indicada (padrão: última) e grava **o payload do cenário escolhido como foi calculado** (`scenarioPayload`) junto com os insumos (`doseBase`, `efficiencyBase`) e a justificativa livre do técnico — o sistema não recomenda, registra.

### 7. Formato de `GET /msa`

```json
{ "run": { id, status, startedAt, finishedAt, dateFrom, dateTo, seed, iterations, sigmaPrecip, sigmaTemp,
           engineVersion, cultivarSnapshot, soilSnapshot, triggeredById },
  "phases": [ { phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct, validIterations,
                percentiles: { ksMean: {p10,p50,p90}|null, yieldReductionPct: …, etcAdjAccum: … } } × 4 ],
  "currentPhase": "F3" | "COMPLETED" }
```

`currentPhase` é a fase da última linha da série baseline — a "janela atual ou encerrada" que `docs/modulos/msa.md` cita para o suporte à decisão.

### 8. Testes

- **Unitários do service** com `vi.mock` de `era5.repository` e do repositório MSA (ou injeção): altitude ausente ⇒ 422 sem run; lacuna ⇒ `NEEDS_DATA` com as datas e sem chamada ao motor; GDA atinge o total antes do limite ⇒ `to` truncado e lacuna posterior ignorada; emergência dentro do lag ⇒ `NEEDS_DATA`; snapshot igual aos parâmetros da cultivar e ao solo (com `soilDefaults` quando aplicável); duas execuções com a mesma semente e os mesmos dados ⇒ resumos `toEqual`; semente gerada quando omitida e gravada; erro do motor ⇒ run `FAILED`.
- **Ponta a ponta `e2e-msa.sh`**: cria agrônomo/propriedade/talhão (com altitude) e safra; insere via SQL 150 dias de `syntheticSeason(150, 2026)` para a célula do talhão (gerados com `node -e` + `ts-node`, inseridos com `psql`); `POST /process` ⇒ 201; `GET /`, `/daily`, `/runs`; apaga 2 dias e reprocessa ⇒ 200 `NEEDS_DATA` com as 2 datas e `latestRunId` inalterado; repõe os dias, reprocessa com `?seed=` igual ⇒ resumos idênticos aos da primeira run; `GET /decision` para F3; `POST /decisions` A e B; cenário B em F4 ⇒ 422; produtor lê mas não processa (403); talhão sem altitude ⇒ 422.

### 9. Notas da implementação

- **Incidente — banco de desenvolvimento apagado.** `prisma migrate dev` recusou rodar ("environment is non-interactive", mesmo com `--create-only`), e ao gerar o SQL com `prisma migrate diff --from-migrations … --shadow-database-url <DATABASE_URL>` usei a URL do banco de desenvolvimento como shadow database. O Prisma trata o shadow database como descartável: apagou o schema público e reaplicou as migrations. Perdi os dados de desenvolvimento (admin, cultivares de referência, as 3 linhas reais do ERA5-Land e as 4 runs de ingestão); nenhum dado de produção existe. Recuperação: volume `postgres_data` recriado, `migrate deploy` das 5 migrations, seed (admin + cultivares) e reingestão dos 3 dias reais a partir do cache do ETL (sem nova requisição ao CDS). Lição registrada: **nunca passar a URL de um banco com dados em `--shadow-database-url`**; quando o `migrate dev` recusar o modo não interativo, gerar o SQL com `migrate diff --from-url <banco> --to-schema-datamodel` (só leitura) para uma pasta de migration e aplicar com `migrate deploy`.
- O `migrate diff` gerou um `DROP INDEX "era5_daily_data_time_idx"` — o índice que o `create_hypertable` cria sozinho e que o Prisma não conhecia. Removido da migration, e o índice passou a ser declarado no model (`@@index([time(sort: Desc)], map: "era5_daily_data_time_idx")`) para não voltar como drift; `migrate diff` contra o banco agora devolve migration vazia.
- `resolveInterval` foi ajustado após o roteiro (Decisão 4): a primeira versão parava a acumulação de GDA na primeira lacuna e listava centenas de datas faltantes quando só dois dias faltavam.
- O backfill da change anterior, interrompido, tinha baixado os 16 meses (jun/2025–set/2026) para o cache: um backfill completo dessa safra hoje roda em segundos.
- Os roteiros `e2e-cultivars-harvests.sh` e `e2e-era5.sh` faziam `TRUNCATE harvests` sem `CASCADE`; com `msa_runs`/`msa_decisions` referenciando `harvests`, o comando passou a falhar em silêncio e deixar safras antigas, derrubando 25 verificações do roteiro de cultivares/safras. Corrigido para `TRUNCATE harvests CASCADE`.
- Resultado do roteiro com a série sintética (semente 42): ciclo encerra em 2026-01-16 (77 dias), F3 Ks̄ 0,968 (P50 0,975), F4 Ks̄ 0,929 (P50 0,918); runs com a mesma semente idênticas em resumos e série.

## Risks / Trade-offs

- **[Processamento síncrono numa requisição HTTP]** → ~0,1 s de cálculo + ~150 inserts; aceitável. Se o volume crescer, a change da fila move isso para um worker sem mudar a persistência.
- **[Duas runs simultâneas da mesma safra]** → Ambas gravam; `latestRunId` fica com a última a terminar. Sem lock: o cenário é raro e inofensivo (resultados equivalentes).
- **[Snapshot em JSON sem schema no banco]** → Validado pelo Zod/Tipos ao gravar; ao ler para reproduzir, o motor valida de novo.
- **[`double` nos resultados aumenta a tabela]** → 150 linhas × 13 colunas × 8 bytes por run; irrelevante.
- **[Default de solo esconde ausência de laudo]** → Mitigado por `soilDefaults: true` no snapshot e na resposta de `GET /msa`.
- **[Hoje − 6 fixo no service e no ETL]** → Dois lugares com o mesmo número; extrair para constante compartilhada quando a fila chegar.

## Migration Plan

1. Migration `add_field_site_params_and_msa_tables` (colunas em `fields`, 4 tabelas, `latest_run_id`).
2. Deploy da API; nada a popular. Talhões existentes seguem sem altitude até o técnico preencher (o processamento avisa com 422).
3. Rollback: reverter código e dropar as tabelas/colunas; nenhuma run existe ainda em produção.

## Open Questions

- **Relaxar `CULTIVAR_IN_USE`**: com `cultivarSnapshot` por run, editar parâmetros de cultivar em uso deixa de quebrar a reprodutibilidade de runs passadas; só afetaria runs futuras. Decisão da pesquisadora (registrada desde a change de cultivares).
- **Altitude automática**: obter de um DEM (ex.: SRTM) pela célula ou pelo centróide, em vez de digitação. Útil quando houver muitos talhões.
- **Sigmas por run via API**: hoje fixos nos defaults do motor; abrir quando o Caso 3 da validação indicar valores diferentes.
