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
O cálculo em si é a biblioteca pura `src/modules/msa/engine/` (`docs/msa/algoritmos.md`). O `msa.service.ts` liga clima → motor → banco → API, **de forma síncrona** (o Monte Carlo de 1.000 iterações leva ~0,1 s). Disparo:
- **Endpoint manual** `POST /api/v1/harvests/:id/msa/process` (AGRONOMO/ADMIN) — implementado
- **Cron job semanal** para todas as safras ativas, após o `ingest --latest` do ETL (BullMQ) — próxima change

**Pré-requisitos no talhão:** `altitudeM` obrigatório (422 `MISSING_FIELD_ALTITUDE`, sem run); `thetaFC`/`thetaWP` opcionais (default 0,28/0,12, registrado no snapshot com `soilDefaults: true`).

**Intervalo processado:** da data de emergência até o menor entre `hoje − 6` (UTC, o lag do ERA5-Land) e o dia em que o GDA acumulado, percorrido sobre dias contíguos desde a emergência, atinge `gdaTotal`. Lacunas depois do fim do ciclo não bloqueiam; lacuna dentro do intervalo gera uma run `NEEDS_DATA` com `missingDates`, **sem calcular e sem interpolar**.

**Persistência (reprodutibilidade):** cada execução gera uma run em `msa_runs` com status (`SUCCEEDED` / `FAILED` / `NEEDS_DATA`), intervalo, `seed`, `iterations`, `sigmaPrecip`, `sigmaTemp`, `cultivarSnapshot` (os 15 parâmetros + id/nome/cultura como estavam), `soilSnapshot` (θFC, θWP, altitude, `soilDefaults`) e `engineVersion` (`ENGINE_VERSION` do motor, semver). O motor recebe o snapshot, não o registro atual da cultivar. A série baseline vai para `msa_daily_results` (uma linha por dia, colunas de `DailyBalanceRow`) e os resumos por janela com os percentis P10/P50/P90 para `msa_phase_summaries`. Reprocessar cria uma run nova; o histórico é mantido; `harvests.latestRunId` aponta para a última run `SUCCEEDED`. Mesma semente + mesmos dados ⇒ resultados idênticos (verificado no roteiro `e2e-msa.sh`).

### 4. Suporte à Decisão (`/harvests/:id/msa/decision`)
Gera os três cenários de `algoritmos.md` §8 a partir do P50 do Ks da janela na última run (`GET .../decision?phase=F3&doseBase=100&efficiencyBase=0.6`, nada persistido). A escolha do técnico é registrada em `msa_decisions` por `POST .../decisions` com o cenário, os insumos, o **payload do cenário tal como calculado** e uma justificativa livre — o sistema registra, não recomenda. Cenário B indisponível para a janela (F4 ou série sem a janela seguinte) responde 422 `SCENARIO_UNAVAILABLE`; janela não alcançada, 422 `PHASE_NOT_REACHED`.

---

## Fluxo Operacional Detalhado

```
1. [Cron semanal] → Consulta safras ativas com talhão e cultivar
2. Para cada safra:
   a. Busca dados ERA5-Land do período (série diária: Tmax, Tmin, Rs, UR, u2, P)
   b. Calcula GDA acumulado → determina janela fenológica atual (F1/F2/F3/F4)
   c. Calcula ET₀ diária (FAO-56 Penman-Monteith)
   d. Calcula ETc = Kc(fase) × ET₀
   e. Executa balanço hídrico diário → Dr, Ks, ETc_adj
   f. Acumula Ks por janela fenológica
   g. Dispara job BullMQ: Monte Carlo (1.000 iterações)
      ├── Perturbação P: ±30% (distribuição normal)
      └── Perturbação T: ±0,6°C (distribuição normal)
   h. Calcula perfis P10 / P50 / P90 por janela
3. Persiste resultados em `msa_results` e `msa_scenarios`
4. Notifica o técnico se alguma janela apresenta Ks_médio < 0,85 (estresse moderado)
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
| POST | `/api/v1/harvests/:id/msa/process?seed=` | Processa (ou reprocessa) a safra: 201 run `SUCCEEDED` com resumos; 200 run `NEEDS_DATA` com `missingDates`; 422 `MISSING_FIELD_ALTITUDE`; 500 `MSA_PROCESSING_FAILED` (run `FAILED` gravada) | AGRONOMO, ADMIN |
| GET | `/api/v1/harvests/:id/msa` | Última run `SUCCEEDED`: metadados, snapshots, 4 janelas com baseline e percentis, `currentPhase`; 404 `NO_MSA_RESULT` | Todos |
| GET | `/api/v1/harvests/:id/msa/daily?runId=` | Série diária baseline da run (padrão: última) | Todos |
| GET | `/api/v1/harvests/:id/msa/runs` | Histórico de runs (sem séries), mais recente primeiro | Todos |
| GET | `/api/v1/harvests/:id/msa/decision?phase=&doseBase=&efficiencyBase=` | Cenários (a)/(b)/(c) sobre a última run; nada persistido | Todos |
| POST | `/api/v1/harvests/:id/msa/decisions` | Registra a escolha do técnico (`phase`, `scenario`, `doseBase`, `efficiencyBase`, `justification`, `runId?`) | AGRONOMO, ADMIN |
| GET | `/api/v1/harvests/:id/msa/decisions` | Decisões da safra, mais recente primeiro | Todos |

---

## Referências de Implementação

| Arquivo | Conteúdo |
|---|---|
| `src/modules/msa/msa.service.ts` | Orquestrador: intervalo, cobertura, snapshots, `runMonteCarlo`, persistência, cenários e decisões |
| `src/modules/msa/msa.repository.ts` | Runs, série baseline, resumos, decisões (Prisma) |
| `src/modules/msa/msa.routes.ts` · `msa.controller.ts` · `dtos/` | Rotas sob `/harvests/:id/msa` |
| `src/modules/msa/era5.repository.ts` | Série diária do talhão no formato do motor; cobertura |
| `src/modules/msa/engine/` | Motor puro: GDA, fenologia, ET₀, Kc, balanço, FAO-33, Monte Carlo, cenários (`ENGINE_VERSION`) |
| `backend/etl/` | ETL Python — ERA5-Land (`ingest`, `backfill`, `status`) |
| `backend/scripts/e2e/e2e-msa.sh` | Roteiro de ponta a ponta do processamento |
| (próxima change) `monte-carlo.worker.ts` | Job BullMQ semanal: `ingest --latest` + processamento das safras ativas |
| `docs/msa/algoritmos.md` | Fórmulas matemáticas completas |
| `docs/msa/era5-etl.md` | Pipeline de ingestão e correção |
| `docs/msa/validacao.md` | Protocolo de validação científica |
