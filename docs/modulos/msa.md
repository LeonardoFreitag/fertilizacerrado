# Módulo Agrometeorológico (MSA)

## Responsabilidade

O MSA é o núcleo científico do FertilizaCerrado. Processa dados climáticos históricos do ERA5-Land para calcular o balanço hídrico diário da cultura da soja, segmentado por janelas fenológicas, e **prediz a produtividade da safra** frente à produtividade potencial (Ym) informada pelo agrônomo, pelo índice do ciclo do FAO-33 (`docs/msa/algoritmos.md` §6). Soja é a única cultura da Fase 1; o módulo estocástico (Monte Carlo) e os cenários de decisão foram removidos em 2026-11-02 (`docs/msa/questoes-abertas.md`).

> **Contexto de dissertação:** Este módulo é o objeto da dissertação de mestrado de Heb Rejane Moreira Pires. Cada algoritmo implementado possui referência bibliográfica explícita no código (JSDoc) e documentação matemática detalhada em `docs/msa/algoritmos.md`.

---

## Sub-módulos

### 1. Cultivares (`/cultivars`)
Armazena os parâmetros agronômicos e fisiológicos de cada cultivar cadastrada.

| Parâmetro | Soja (referência) |
|---|---|
| GDA total (°C·dia) | 1.200 |
| T_base (°C) | 10 |
| Kc_ini | 0,20 (plantio direto) |
| Kc_mid | 1,15 |
| Kc_end | 0,50 |
| p (fração depleção) | 0,50 |
| Zr_ini → Zr_max (m) | 0,30 → 0,95 |
| Ky F1 | 0,20 |
| Ky F2 | 0,80 |
| Ky F3 | 1,00 |
| Ky F4 | 0,40 |
| Limiares GDA F1/F2/F3 (°C·dia) | 120 / 450 / 900 |

> **Fonte:** Allen et al. (1998) FAO Irrigation and Drainage Paper No. 56 (Kc, p, Zr); Doorenbos & Kassam (1979) FAO No. 33 (Ky).

**Só soja.** O enum `Crop` tem apenas `SOJA`; a coluna `crop` e o `@@unique([name, crop, createdById])` permanecem (para uma eventual segunda cultura no futuro), mas `crop` **não é aceito** no `POST` (400 identificando o campo) e o filtro `?crop=` da listagem foi removido; a resposta continua trazendo `crop: "SOJA"`.

A cultivar de referência é criada pelo seed (`prisma/seed.ts`, idempotente por nome + cultura; `reference-cultivars.ts` é a fonte da verdade) com `isDefault = true` e `referenceSnapshot = null`, e é **imutável pela API**, inclusive para `ADMIN` (403 `DEFAULT_CULTIVAR_READONLY`): corrigir um valor é alterar o seed e executá-lo novamente. Fonte bibliográfica em JSDoc no próprio seed. `GET /api/v1/cultivars/reference` (declarada antes de `/:id`) devolve essa cultivar do banco; 404 `REFERENCE_CULTIVAR_MISSING` se o seed não rodou.

**Nova cultivar nasce da referência.** Ninguém digita os 15 parâmetros do zero: o formulário "Nova cultivar" abre pré-preenchido com a referência (`docs/modulos/frontend.md`) e, no `POST`, o serviço grava em `cultivars.reference_snapshot` os 15 parâmetros da referência **naquele momento**. É esse snapshot que permite saber o que o técnico alterou (campo "não alterado" = valor atual igual ao do `referenceSnapshot`); comparar com a referência atual não serviria, porque, quando a referência muda, campos nunca tocados pareceriam alterados.

**Atualizar a partir da referência.** `POST /api/v1/cultivars/:id/sync-reference` com `{ mode: "unchanged" | "all" }` (mesmas permissões do `PATCH`; 403 na referência): `unchanged` substitui só os campos iguais ao `referenceSnapshot`; `all` substitui os 15. Nos dois modos grava o novo `referenceSnapshot`, valida o estado resultante e responde 200 `{ cultivar, updatedFields: string[] }`. Serve para quando a referência tabelada mudar (ex.: T_base confirmada na change de graus-dia de Ometto).

**Regras das cultivares (`/api/v1/cultivars`):**

- `AGRONOMO` e `ADMIN` criam cultivares próprias (`createdById` = criador); `PRODUTOR` é somente leitura.
- Visibilidade: a cultivar de referência + as próprias; `ADMIN` vê todas. Fora disso, 404.
- Validação Zod com faixas plausíveis: `tBase` 0–20 °C; `gdaTotal` 300–4000; limiares `gdaF1End < gdaF2End < gdaF3End < gdaTotal`; `0 < Kc ≤ 1,5`; `0 < p < 1`; `0 < zrIni ≤ zrMax ≤ 3 m`; `0 ≤ Ky ≤ 1,5`. No `PATCH`, as relações cruzadas são validadas sobre o estado resultante.
- Nome único por criador e cultura (dois agrônomos podem ter "Minha soja").
- **Edição de cultivar em uso é permitida** (questão aberta nº 5, decidida em 2026-11-02): `PATCH` nos parâmetros científicos de uma cultivar com safras responde 200. A reprodutibilidade é garantida pelo `cultivarSnapshot` gravado em cada run — runs já calculadas guardam os parâmetros da época; as próximas usam os novos valores. `GET /harvests/:id/msa` devolve `cultivarChangedSinceRun: true` quando algum parâmetro científico atual difere do snapshot da última run, e o painel avisa. `DELETE` de cultivar em uso continua respondendo 409 `CULTIVAR_IN_USE`.
- `crop` não pode ser informado nem alterado (só soja).

### 2. Safras (`/harvests`)
Vincula um talhão, uma cultivar e uma data de emergência para iniciar o rastreamento fenológico.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | |
| `fieldId` | UUID | FK → Field |
| `cultivarId` | UUID | FK → Cultivar |
| `emergenceDate` | Date | Data de emergência (início do ciclo) |
| `season` | String | Ex: "2024/25" |
| `status` | Enum | ACTIVE / COMPLETED / CANCELLED (padrão ACTIVE) |
| `expectedYield` | Float? | **Produtividade potencial (Ym)** em sc/ha, informada pelo agrônomo; `> 0` e `≤ 250` (`EXPECTED_YIELD_MAX_SC_HA`, teto de sanidade em `create-harvest.dto.ts`) |
| `notes` | String? | Observações do técnico |
| `createdAt` / `updatedAt` | DateTime | |

**Endpoints:** `POST /api/v1/harvests`, `GET /api/v1/harvests?fieldId=&status=`, `GET /api/v1/harvests/:id`, `PATCH /api/v1/harvests/:id` (`status`, `notes`, `season`, `expectedYield` — `null` limpa) e `GET /api/v1/properties/:propertyId/fields/:fieldId/harvests`. Não há `DELETE`: safra é cancelada (`status = CANCELLED`), preservando o histórico.

**Regras das safras:**

- Escopo herdado da propriedade do talhão (mesmas regras do módulo de Propriedades: 404 fora do escopo, 403 por role). `PRODUTOR` é somente leitura.
- **Uma única safra `ACTIVE` por talhão**: criar outra, ou reativar uma cancelada/concluída com outra ativa, responde 409 `FIELD_HAS_ACTIVE_HARVEST`. A verificação é serializada por talhão (`SELECT … FOR UPDATE` na transação), então requisições simultâneas não produzem duas ativas.
- `emergenceDate` é uma data-calendário `YYYY-MM-DD` (sem hora) e não pode ser posterior à data corrente em UTC (400 `EMERGENCE_DATE_IN_FUTURE`).
- `season` no formato `AAAA/AA` com anos consecutivos (`2025/26`); não é cruzada com a data de emergência (a safrinha de fevereiro pertence à safra do ano anterior).
- `cultivarId` deve ser visível ao usuário (400 `INVALID_CULTIVAR`); `fieldId`, `cultivarId` e `emergenceDate` são imutáveis após a criação.
- Qualquer transição de status é permitida; apenas a chegada em `ACTIVE` passa pela regra de unicidade.
- **`expectedYield` não recalcula runs existentes**: a run grava a Ym vigente no momento do processamento (`MsaRun.expectedYield`) e a produtividade predita faz parte da run. Para refletir uma Ym nova, o técnico reprocessa a safra. Sem Ym, a run grava o índice do ciclo e `predictedYield` fica nulo.
- Talhão com safras não pode ser excluído (ver módulo de Propriedades); as FKs de `harvests` são `RESTRICT`.

### 3. Motor MSA (`/harvests/:id/msa`)
O cálculo em si é a biblioteca pura `src/modules/msa/engine/` (`docs/msa/algoritmos.md`). O `msa.service.ts` liga clima → motor → banco: uma run é **determinística** — `runDailyBalance` + `summarizeByPhase` + `cycleYieldIndex` uma vez, sem sorteio nem semente. O processamento roda no processo **`worker`** (fila `msa-process`, BullMQ) e é disparado por:
- **Semanal** — segunda-feira 02:00 (Brasília), depois do `era5-ingest latest`, uma run `reason: WEEKLY` por safra ativa;
- **Criação da safra** — `POST /harvests` enfileira o backfill da célula (se faltar cobertura) e o processamento `reason: BACKFILL`; a resposta traz `msaJobId`;
- **Manual** — `POST /api/v1/harvests/:id/msa/process` (AGRONOMO/ADMIN) responde **202** `{ jobId, queue: "msa-process", status: "queued" }` e a run sai com `reason: MANUAL`. Com `?sync=true` (**só ADMIN**; 403 `SYNC_ADMIN_ONLY` para os demais) processa inline e responde 201/200/422/500 como antes — válvula para operação e roteiros.
- **Operação** — `POST /api/v1/admin/jobs/process-all` (ADMIN) enfileira todas as safras ativas.

Cada run registra `reason` e `jobId` (nulo no inline) e `qmCalibrationId` — a calibração de Quantile Mapping ativa na célula do talhão no momento do processamento (nulo sem correção; `docs/msa/era5-etl.md` § Etapa 3); `GET /msa` e `/runs` trazem o resumo `qmCalibration` (estação, anos, distância) para o selo do painel. Runs do worker têm `triggeredById` nulo. Detalhes das filas: `docs/msa/era5-etl.md` § Orquestração. A interface do técnico (`/safras/:id`, `docs/modulos/frontend.md` § Painel MSA) consome estes endpoints: bloco Produtividade (Ym, redução por janela, índice do ciclo, produtividade predita), cartões por janela com severidade do Ks, gráficos da série diária, histórico de runs e exportação CSV.

**Pré-requisitos no talhão:** `altitudeM` obrigatório (422 `MISSING_FIELD_ALTITUDE`, sem run); `thetaFC`/`thetaWP` opcionais (default 0,28/0,12, registrado no snapshot com `soilDefaults: true`).

**Intervalo processado:** da data de emergência até o menor entre `hoje − 6` (UTC, o lag do ERA5-Land) e o dia em que o GDA acumulado, percorrido sobre dias contíguos desde a emergência, atinge `gdaTotal`. Lacunas depois do fim do ciclo não bloqueiam; lacuna dentro do intervalo gera uma run `NEEDS_DATA` com `missingDates`, **sem calcular e sem interpolar**.

**Persistência (reprodutibilidade):** cada execução gera uma run em `msa_runs` com status (`SUCCEEDED` / `FAILED` / `NEEDS_DATA`), intervalo, `cultivarSnapshot` (os 15 parâmetros + id/nome/cultura como estavam), `soilSnapshot` (θFC, θWP, altitude, `soilDefaults`), `engineVersion` (`ENGINE_VERSION` do motor, semver — `2.0.0`) e os campos de produtividade: `expectedYield` (Ym da safra no momento), `yieldIndex` (índice do ciclo), `phasesReached` (0–4) e `predictedYield` (nulo sem Ym; todos nulos em `NEEDS_DATA`/`FAILED`). O motor recebe o snapshot, não o registro atual da cultivar. A série diária vai para `msa_daily_results` (uma linha por dia, colunas de `DailyBalanceRow`) e os resumos por janela (sem percentis) para `msa_phase_summaries`. Reprocessar cria uma run nova; o histórico é mantido; `harvests.latestRunId` aponta para a última run `SUCCEEDED`. Mesmos dados + mesmos snapshots ⇒ resultados idênticos (verificado no roteiro `e2e-msa.sh`).

**Predição de produtividade (`algoritmos.md` §6):** `cycleYieldIndex(summaries)` devolve `{ yieldIndex, phasesReached, factors }`, com `yieldIndex = Π_j [1 − Ky_j·(1 − Ks̄_j)]` sobre as janelas com dias e fator 1 nas não alcançadas ("considera o restante do ciclo sem estresse"); `predictedYield = expectedYield × yieldIndex`. `GET /msa` devolve ainda `cultivarChangedSinceRun` (função pura que compara as chaves de `CultivarParams` presentes no `cultivarSnapshot` com a cultivar atual da safra) para o aviso do painel. A predição é um valor único, sem faixa de incerteza.

---

## Fluxo Operacional Detalhado

```
1. [Scheduler BullMQ: segunda 02:00 America/Sao_Paulo] → job `msa-weekly:trigger`
2. Flow: filho `era5-ingest {kind: latest}` (ETL Python; [hoje−16, hoje−6], todas as células; 3 tentativas)
         → pai `msa-weekly:run` só executa se o filho concluiu
3. Pai enfileira `msa-process {harvestId, reason: WEEKLY}` por safra ACTIVE (jobId weekly_<data>_<id>)
4. Worker Node (concorrência 4), para cada job:
   a. Busca a série diária da célula do talhão (Tmax, Tmin, Tdew, u2, Rn, P)
   b. GDA acumulado → janela fenológica (F1/F2/F3/F4) e fim do ciclo
   c. ET₀ diária (FAO-56) → ETc = Kc(GDA) × ET₀
   d. Balanço hídrico diário → Dr, Ks, ETc_adj; resumo por janela (Ks médio, Ky·(1−Ks̄))
   e. Índice do ciclo = Π das janelas alcançadas → produtividade predita = Ym × índice (sc/ha)
   f. Persiste run (reason, jobId, snapshots, Ym, índice, phasesReached, predita), série diária e resumos
5. Mesmo caminho para `reason: BACKFILL` (criação de safra) e `reason: MANUAL` (endpoint / process-all)
6. Pendente: notificação ao técnico quando alguma janela apresenta Ks_médio < 0,85
```

---

## Janelas Fenológicas (Soja)

| Janela | Denominação | GDA acumulado (°C·dia) | Estágio BBCH |
|---|---|---|---|
| F1 | Germinação → Emergência | 0 – 120 | 00 – 09 |
| F2 | Crescimento vegetativo | 120 – 450 | 10 – 39 |
| F3 | Floração → Enchimento de grãos | 450 – 900 | 60 – 79 |
| F4 | Maturação | 900 – 1.200 | 89 – 99 |

> Os limiares de GDA são parametrizados por cultivar. Os valores acima são referência para soja convencional do Cerrado.

---

## Estrutura da Tabela de Resultados

### msa_results (série diária por safra)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID | |
| `harvestId` | UUID | FK → Harvest |
| `date` | Date | Data do cálculo |
| `phenoPhase` | Enum | F1 / F2 / F3 / F4 |
| `gda` | Decimal | GDA do dia (°C·dia) |
| `gdaAccum` | Decimal | GDA acumulado desde emergência |
| `et0` | Decimal | mm/dia |
| `kc` | Decimal | Coeficiente de cultura do dia |
| `etcStandard` | Decimal | ETc padrão (mm/dia) |
| `precipitation` | Decimal | Precipitação ERA5-Land (mm/dia) |
| `dr` | Decimal | Depleção acumulada da zona radicular (mm) |
| `ks` | Decimal | Coeficiente de estresse hídrico (0–1) |
| `etcAdj` | Decimal | ETc ajustada = Ks × ETc (mm/dia) |

### msa_phase_summary (resumo por janela por safra)

| Campo | Tipo | Descrição |
|---|---|---|
| `harvestId` | UUID | |
| `phenoPhase` | Enum | |
| `ksMean` | Decimal | Ks médio da janela |
| `etcAdjAccum` | Decimal | ETc ajustada acumulada (mm) |
| `precipAccum` | Decimal | Precipitação acumulada (mm) |
| `days` | Int | Dias da janela na série (0 = não alcançada) |
| `yieldReductionPct` | Decimal | Redução potencial de produtividade = Ky × (1 - Ks_médio) × 100 (nula se não alcançada) |

### msa_runs (campos de produtividade)

| Campo | Tipo | Descrição |
|---|---|---|
| `expectedYield` | Float? | Ym da safra no momento da run (sc/ha) |
| `yieldIndex` | Float? | Índice do ciclo = Π_j [1 − Ky_j·(1 − Ks̄_j)] (0–1) |
| `phasesReached` | Int? | Janelas com dias (0–4); < 4 ⇒ predição parcial |
| `predictedYield` | Float? | Ym × índice (sc/ha); nulo sem Ym |

> A tabela `msa_decisions` e as colunas `seed`, `iterations`, `sigma_*`, `valid_iterations` e `*_p10/p50/p90` foram removidas pela migration `refocus_yield_prediction` (destrutiva: runs anteriores são descartadas — após o deploy, "Processar todas as safras ativas" em `/admin`).

---

## Endpoints Principais

Escopo de acesso herdado da safra (404 fora dele); `PRODUTOR` só leitura (403 nas rotas de escrita).

| Método | Path | Descrição | Roles |
|---|---|---|---|
| GET | `/api/v1/cultivars/reference` | Cultivar de referência de soja (seed); 404 `REFERENCE_CULTIVAR_MISSING` | Todos |
| POST | `/api/v1/cultivars` | Cria cultivar própria (sem `crop`; `referenceSnapshot` gravado da referência) | AGRONOMO, ADMIN |
| POST | `/api/v1/cultivars/:id/sync-reference` | `{ mode: "unchanged" \| "all" }` → 200 `{ cultivar, updatedFields }`; 403 na referência | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests` | Cadastra nova safra (`expectedYield` opcional, sc/ha, ≤ 250) | AGRONOMO, ADMIN |
| PATCH | `/api/v1/harvests/:id` | `status`, `notes`, `season`, `expectedYield` (não recalcula runs) | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process` | Enfileira o (re)processamento: **202** `{ jobId, queue, status: "queued" }`; 404 fora do escopo | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process?sync=true` | Processa inline: 201 run `SUCCEEDED` com resumos; 200 run `NEEDS_DATA` com `missingDates`; 422 `MISSING_FIELD_ALTITUDE`; 500 `MSA_PROCESSING_FAILED` (run `FAILED` gravada); 403 `SYNC_ADMIN_ONLY` para não-ADMIN | ADMIN |
| GET | `/api/v1/harvests/:id/msa` | Última run `SUCCEEDED`: metadados, snapshots, `expectedYield`/`yieldIndex`/`predictedYield`/`phasesReached`, 4 janelas (sem percentis), `currentPhase`, `cultivarChangedSinceRun`; 404 `NO_MSA_RESULT` | Todos |
| GET | `/api/v1/harvests/:id/msa/daily?runId=` | Série diária da run (padrão: última) | Todos |
| GET | `/api/v1/harvests/:id/msa/runs` | Histórico de runs (sem séries), mais recente primeiro | Todos |
| GET | `/api/v1/admin/jobs/queues` | Contagens por fila (`waiting`, `active`, `completed`, `failed`, `delayed`, `waiting-children`) e `weekly.nextRun` | ADMIN |
| GET | `/api/v1/admin/jobs/:queue/:id` | Estado, `progress`, `attemptsMade`, `failedReason`, `returnvalue`, timestamps; 404 se não existe | ADMIN |
| POST | `/api/v1/admin/jobs/ingest-latest` · `/backfill-region` · `/process-all` | 202 com `jobId`/`queue` (`backfill-region`: `{ bbox: [N, W, S, E], from, to }`) | ADMIN |

---

## Referências de Implementação

| Arquivo | Conteúdo |
|---|---|
| `src/modules/msa/msa.service.ts` | Orquestrador: intervalo, cobertura, snapshots, balanço + resumos + `cycleYieldIndex` (`yieldFields`), persistência, `cultivarChangedSinceRun` |
| `src/modules/msa/msa.repository.ts` | Runs, série diária, resumos (Prisma) |
| `src/modules/msa/msa.routes.ts` · `msa.controller.ts` · `dtos/` | Rotas sob `/harvests/:id/msa` |
| `src/modules/msa/era5.repository.ts` | Série diária do talhão no formato do motor; cobertura |
| `src/modules/msa/engine/` | Motor puro: GDA, fenologia, ET₀, Kc, balanço, FAO-33 (`yield.ts`: redução por janela, índice do ciclo, produtividade predita) — `ENGINE_VERSION` 2.0.0 |
| `src/modules/jobs/flows.ts` · `jobs.service.ts` | Filas, payloads, flows (semanal, backfill), `planHarvestJobs`, ids determinísticos; enfileiramento e consulta |
| `src/modules/jobs/jobs.routes.ts` · `jobs.controller.ts` | `/api/v1/admin/jobs` (ADMIN) |
| `src/worker.ts` | Processo `worker`: consumidores `msa-process` (×4) e `msa-weekly`, scheduler semanal, shutdown gracioso |
| `src/config/queue.ts` | Nomes das filas e conexão BullMQ (separada do Redis do limite de login) |
| `backend/etl/` | ETL Python — worker da fila `era5-ingest` + CLI (`ingest`, `backfill`, `status`, `worker`) |
| `backend/scripts/e2e/e2e-msa.sh` · `e2e-orchestration.sh` | Roteiros de ponta a ponta do processamento (inline) e da orquestração (filas) |
| `src/modules/cultivars/` | Cultivares: referência (`GET /reference`), `referenceSnapshot`, `sync-reference`, edição em uso |
| `docs/msa/algoritmos.md` | Fórmulas matemáticas completas |
| `docs/msa/era5-etl.md` | Pipeline de ingestão e correção |
| `docs/msa/validacao.md` | Protocolo de validação científica |
