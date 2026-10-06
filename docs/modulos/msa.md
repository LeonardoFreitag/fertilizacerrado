# Módulo Agrometeorológico (MSA)

## Responsabilidade

O MSA é o núcleo científico do FertilizaCerrado. Processa dados climáticos históricos do ERA5-Land para calcular o balanço hídrico diário da cultura da soja (e sucessão soja/milho), segmentado por janelas fenológicas, e entrega perfis de risco que fundamentam as decisões de manejo do técnico agrônomo.

> **Contexto de dissertação:** Este módulo é o objeto da dissertação de mestrado de Heb Rejane Moreira Pires. Cada algoritmo implementado possui referência bibliográfica explícita no código (JSDoc) e documentação matemática detalhada em `docs/msa/algoritmos.md`.

---

## Sub-módulos

### 1. Cultivares (`/cultivars`)
Armazena os parâmetros agronômicos e fisiológicos de cada cultivar cadastrada.

| Parâmetro | Soja (referência) | Milho (referência) |
|---|---|---|
| GDA total (°C·dia) | 1.200 | 1.500 |
| T_base (°C) | 10 | 10 |
| Kc_ini | 0,20 (plantio direto) | 0,30 |
| Kc_mid | 1,15 | 1,20 |
| Kc_end | 0,50 | 0,60 |
| p (fração depleção) | 0,50 | 0,55 |
| Zr_ini → Zr_max (m) | 0,30 → 0,95 | 0,30 → 1,00 |
| Ky F1 | 0,20 | 0,40 |
| Ky F2 | 0,80 | 0,40 |
| Ky F3 | 1,00 | 1,50 |
| Ky F4 | 0,40 | 0,50 |
| Limiares GDA F1/F2/F3 (°C·dia) | 120 / 450 / 900 | 150 / 600 / 1.150 |

> **Fonte:** Allen et al. (1998) FAO Irrigation and Drainage Paper No. 56 (Kc, p, Zr); Doorenbos & Kassam (1979) FAO No. 33 (Ky — milho: vegetativo 0,4, floração 1,5, enchimento 0,5).

Essas duas cultivares são criadas pelo seed (`prisma/seed.ts`, idempotente por nome + cultura) com `isDefault = true` e são **imutáveis pela API**, inclusive para `ADMIN`: corrigir um valor é alterar o seed e executá-lo novamente. Fonte bibliográfica em JSDoc no próprio seed.

**Regras das cultivares (`/api/v1/cultivars`):**

- `AGRONOMO` e `ADMIN` criam cultivares próprias (`createdById` = criador); `PRODUTOR` é somente leitura.
- Visibilidade: cultivares de referência + as próprias; `ADMIN` vê todas. Fora disso, 404.
- Validação Zod com faixas plausíveis: `tBase` 0–20 °C; `gdaTotal` 300–4000; limiares `gdaF1End < gdaF2End < gdaF3End < gdaTotal`; `0 < Kc ≤ 1,5`; `0 < p < 1`; `0 < zrIni ≤ zrMax ≤ 3 m`; `0 ≤ Ky ≤ 1,5`. No `PATCH`, as relações cruzadas são validadas sobre o estado resultante.
- Nome único por criador e cultura (dois agrônomos podem ter "Minha soja").
- **Cultivar com safras (qualquer status) tem os parâmetros científicos congelados**: `PATCH` em `tBase`, `gdaTotal`, `gdaF*End`, `kc*`, `depletionFraction`, `zr*` ou `ky*` responde 409 `CULTIVAR_IN_USE`; só `name` e `cycleDescription` seguem editáveis. Motivo: reprodutibilidade dos resultados do MSA. A regra poderá ser relaxada quando o motor gravar snapshot dos parâmetros por processamento. `DELETE` de cultivar em uso também responde 409.
- `crop` não pode ser alterado; crie outra cultivar.

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
| `notes` | String? | Observações do técnico |
| `createdAt` / `updatedAt` | DateTime | |

**Endpoints:** `POST /api/v1/harvests`, `GET /api/v1/harvests?fieldId=&status=`, `GET /api/v1/harvests/:id`, `PATCH /api/v1/harvests/:id` (`status`, `notes`, `season`) e `GET /api/v1/properties/:propertyId/fields/:fieldId/harvests`. Não há `DELETE`: safra é cancelada (`status = CANCELLED`), preservando o histórico.

**Regras das safras:**

- Escopo herdado da propriedade do talhão (mesmas regras do módulo de Propriedades: 404 fora do escopo, 403 por role). `PRODUTOR` é somente leitura.
- **Uma única safra `ACTIVE` por talhão**: criar outra, ou reativar uma cancelada/concluída com outra ativa, responde 409 `FIELD_HAS_ACTIVE_HARVEST`. A verificação é serializada por talhão (`SELECT … FOR UPDATE` na transação), então requisições simultâneas não produzem duas ativas.
- `emergenceDate` é uma data-calendário `YYYY-MM-DD` (sem hora) e não pode ser posterior à data corrente em UTC (400 `EMERGENCE_DATE_IN_FUTURE`).
- `season` no formato `AAAA/AA` com anos consecutivos (`2025/26`); não é cruzada com a data de emergência (a safrinha de fevereiro pertence à safra do ano anterior).
- `cultivarId` deve ser visível ao usuário (400 `INVALID_CULTIVAR`); `fieldId`, `cultivarId` e `emergenceDate` são imutáveis após a criação.
- Qualquer transição de status é permitida; apenas a chegada em `ACTIVE` passa pela regra de unicidade.
- Talhão com safras não pode ser excluído (ver módulo de Propriedades); as FKs de `harvests` são `RESTRICT`.

### 3. Motor MSA (`/harvests/:id/msa`)
O cálculo em si é a biblioteca pura `src/modules/msa/engine/` (`docs/msa/algoritmos.md`). O `msa.service.ts` liga clima → motor → banco (o Monte Carlo de 1.000 iterações leva ~0,1 s). O processamento roda no processo **`worker`** (fila `msa-process`, BullMQ) e é disparado por:
- **Semanal** — segunda-feira 02:00 (Brasília), depois do `era5-ingest latest`, uma run `reason: WEEKLY` por safra ativa;
- **Criação da safra** — `POST /harvests` enfileira o backfill da célula (se faltar cobertura) e o processamento `reason: BACKFILL`; a resposta traz `msaJobId`;
- **Manual** — `POST /api/v1/harvests/:id/msa/process` (AGRONOMO/ADMIN) responde **202** `{ jobId, queue: "msa-process", status: "queued" }` e a run sai com `reason: MANUAL`. Com `?sync=true` (**só ADMIN**; 403 `SYNC_ADMIN_ONLY` para os demais) processa inline e responde 201/200/422/500 como antes — válvula para operação e roteiros.
- **Operação** — `POST /api/v1/admin/jobs/process-all` (ADMIN) enfileira todas as safras ativas.

Cada run registra `reason` e `jobId` (nulo no inline); runs do worker têm `triggeredById` nulo. Detalhes das filas: `docs/msa/era5-etl.md` § Orquestração. A interface do técnico (`/safras/:id`, `docs/modulos/frontend.md` § Painel MSA) consome estes endpoints: cartões por janela com severidade do Ks, gráficos da série diária, cenários A/B/C e registro de decisões, histórico de runs e exportação CSV.

**Pré-requisitos no talhão:** `altitudeM` obrigatório (422 `MISSING_FIELD_ALTITUDE`, sem run); `thetaFC`/`thetaWP` opcionais (default 0,28/0,12, registrado no snapshot com `soilDefaults: true`).

**Intervalo processado:** da data de emergência até o menor entre `hoje − 6` (UTC, o lag do ERA5-Land) e o dia em que o GDA acumulado, percorrido sobre dias contíguos desde a emergência, atinge `gdaTotal`. Lacunas depois do fim do ciclo não bloqueiam; lacuna dentro do intervalo gera uma run `NEEDS_DATA` com `missingDates`, **sem calcular e sem interpolar**.

**Persistência (reprodutibilidade):** cada execução gera uma run em `msa_runs` com status (`SUCCEEDED` / `FAILED` / `NEEDS_DATA`), intervalo, `seed`, `iterations`, `sigmaPrecip`, `sigmaTemp`, `cultivarSnapshot` (os 15 parâmetros + id/nome/cultura como estavam), `soilSnapshot` (θFC, θWP, altitude, `soilDefaults`) e `engineVersion` (`ENGINE_VERSION` do motor, semver). O motor recebe o snapshot, não o registro atual da cultivar. A série baseline vai para `msa_daily_results` (uma linha por dia, colunas de `DailyBalanceRow`) e os resumos por janela com os percentis P10/P50/P90 para `msa_phase_summaries`. Reprocessar cria uma run nova; o histórico é mantido; `harvests.latestRunId` aponta para a última run `SUCCEEDED`. Mesma semente + mesmos dados ⇒ resultados idênticos (verificado no roteiro `e2e-msa.sh`).

### 4. Suporte à Decisão (`/harvests/:id/msa/decision`)
Gera os três cenários de `algoritmos.md` §8 a partir do P50 do Ks da janela na última run (`GET .../decision?phase=F3&doseBase=100&efficiencyBase=0.6`, nada persistido). A escolha do técnico é registrada em `msa_decisions` por `POST .../decisions` com o cenário, os insumos, o **payload do cenário tal como calculado** e uma justificativa livre — o sistema registra, não recomenda. Cenário B indisponível para a janela (F4 ou série sem a janela seguinte) responde 422 `SCENARIO_UNAVAILABLE`; janela não alcançada, 422 `PHASE_NOT_REACHED`.

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
   d. Balanço hídrico diário → Dr, Ks, ETc_adj; Ks acumulado por janela
   e. Monte Carlo (1.000 iterações; P ~ N(1, 0,3²), T ~ N(0, 0,6²)) → P10/P50/P90 por janela
   f. Persiste run (reason, jobId, snapshots, seed), série baseline e resumos
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
| `yieldReductionPct` | Decimal | Redução potencial de produtividade = Ky × (1 - Ks_médio) × 100 |
| `p10_ks` | Decimal | Percentil 10 do Monte Carlo |
| `p50_ks` | Decimal | Mediana do Monte Carlo |
| `p90_ks` | Decimal | Percentil 90 do Monte Carlo |

---

## Cenários de Decisão

Quando o técnico acessa o painel de uma janela com estresse identificado, o sistema apresenta três cenários:

| Cenário | Descrição | Cálculo |
|---|---|---|
| **(a) Redução de dose** | Reduzir a dose de fertilizante proporcional ao estresse | `Dose_adj = Dose_base × Ks_médio` |
| **(b) Parcelamento** | Dividir a aplicação em duas operações dentro da janela seguinte | Baseado na ETc projetada do P50 |
| **(c) Fator de eficiência** | Ajustar eficiência de uso de nutrientes pela condição hídrica | `Eficiência = Eficiência_base × Ks_médio` |

A **escolha final é sempre do técnico agrônomo**. O sistema apresenta os três cenários com seus trade-offs e permite documentar a justificativa da decisão.

---

## Endpoints Principais

Escopo de acesso herdado da safra (404 fora dele); `PRODUTOR` só leitura (403 nas rotas de escrita).

| Método | Path | Descrição | Roles |
|---|---|---|---|
| POST | `/api/v1/harvests` | Cadastra nova safra | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process?seed=` | Enfileira o (re)processamento: **202** `{ jobId, queue, status: "queued" }`; 404 fora do escopo | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process?sync=true&seed=` | Processa inline: 201 run `SUCCEEDED` com resumos; 200 run `NEEDS_DATA` com `missingDates`; 422 `MISSING_FIELD_ALTITUDE`; 500 `MSA_PROCESSING_FAILED` (run `FAILED` gravada); 403 `SYNC_ADMIN_ONLY` para não-ADMIN | ADMIN |
| GET | `/api/v1/harvests/:id/msa` | Última run `SUCCEEDED`: metadados, snapshots, 4 janelas com baseline e percentis, `currentPhase`; 404 `NO_MSA_RESULT` | Todos |
| GET | `/api/v1/harvests/:id/msa/daily?runId=` | Série diária baseline da run (padrão: última) | Todos |
| GET | `/api/v1/harvests/:id/msa/runs` | Histórico de runs (sem séries), mais recente primeiro | Todos |
| GET | `/api/v1/harvests/:id/msa/decision?phase=&doseBase=&efficiencyBase=` | Cenários (a)/(b)/(c) sobre a última run; nada persistido | Todos |
| POST | `/api/v1/harvests/:id/msa/decisions` | Registra a escolha do técnico (`phase`, `scenario`, `doseBase`, `efficiencyBase`, `justification`, `runId?`) | AGRONOMO, ADMIN |
| GET | `/api/v1/harvests/:id/msa/decisions` | Decisões da safra, mais recente primeiro | Todos |
| GET | `/api/v1/admin/jobs/queues` | Contagens por fila (`waiting`, `active`, `completed`, `failed`, `delayed`, `waiting-children`) e `weekly.nextRun` | ADMIN |
| GET | `/api/v1/admin/jobs/:queue/:id` | Estado, `progress`, `attemptsMade`, `failedReason`, `returnvalue`, timestamps; 404 se não existe | ADMIN |
| POST | `/api/v1/admin/jobs/ingest-latest` · `/backfill-region` · `/process-all` | 202 com `jobId`/`queue` (`backfill-region`: `{ bbox: [N, W, S, E], from, to }`) | ADMIN |

---

## Referências de Implementação

| Arquivo | Conteúdo |
|---|---|
| `src/modules/msa/msa.service.ts` | Orquestrador: intervalo, cobertura, snapshots, `runMonteCarlo`, persistência, cenários e decisões |
| `src/modules/msa/msa.repository.ts` | Runs, série baseline, resumos, decisões (Prisma) |
| `src/modules/msa/msa.routes.ts` · `msa.controller.ts` · `dtos/` | Rotas sob `/harvests/:id/msa` |
| `src/modules/msa/era5.repository.ts` | Série diária do talhão no formato do motor; cobertura |
| `src/modules/msa/engine/` | Motor puro: GDA, fenologia, ET₀, Kc, balanço, FAO-33, Monte Carlo, cenários (`ENGINE_VERSION`) |
| `src/modules/jobs/flows.ts` · `jobs.service.ts` | Filas, payloads, flows (semanal, backfill), `planHarvestJobs`, ids determinísticos; enfileiramento e consulta |
| `src/modules/jobs/jobs.routes.ts` · `jobs.controller.ts` | `/api/v1/admin/jobs` (ADMIN) |
| `src/worker.ts` | Processo `worker`: consumidores `msa-process` (×4) e `msa-weekly`, scheduler semanal, shutdown gracioso |
| `src/config/queue.ts` | Nomes das filas e conexão BullMQ (separada do Redis do limite de login) |
| `backend/etl/` | ETL Python — worker da fila `era5-ingest` + CLI (`ingest`, `backfill`, `status`, `worker`) |
| `backend/scripts/e2e/e2e-msa.sh` · `e2e-orchestration.sh` | Roteiros de ponta a ponta do processamento (inline) e da orquestração (filas) |
| `docs/msa/algoritmos.md` | Fórmulas matemáticas completas |
| `docs/msa/era5-etl.md` | Pipeline de ingestão e correção |
| `docs/msa/validacao.md` | Protocolo de validação científica |
