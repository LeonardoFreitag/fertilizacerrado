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
| T_base (°C) — base inferior | 10 |
| T_B (°C) — base superior (Ometto), `tUpper` | 30 (provisório — `questoes-abertas.md` nº 10; opcional: nulo = sem base superior) |
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

> **Fonte:** Allen et al. (1998) FAO Irrigation and Drainage Paper No. 56 (Kc, p, Zr); Doorenbos & Kassam (1979) FAO No. 33 (Ky); Ometto (1981) para as temperaturas-base do método de graus-dia (`algoritmos.md` §1).

São **16 parâmetros científicos** (`CULTIVAR_PARAM_KEYS` em `cultivar-params.schema.ts`): `tBase`, `tUpper`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `p`, `zrIni`, `zrMax`, `kyF1`–`kyF4`. `tUpper` é o único anulável (`NULLABLE_PARAM_KEYS`), introduzido pela change `adopt-ometto-degree-days` (2026-11-03). A migration `adopt_ometto_degree_days` acrescentou a coluna `t_upper`, gravou 30 em todas as cultivares de soja (referência e próprias) e acrescentou `tUpper: 30` ao `reference_snapshot` das próprias — assim o campo nasce "não alterado" e segue a referência no modo `unchanged` do `sync-reference` quando o valor definitivo de T_B for fixado (questão nº 10).

**Só soja.** O enum `Crop` tem apenas `SOJA`; a coluna `crop` e o `@@unique([name, crop, createdById])` permanecem (para uma eventual segunda cultura no futuro), mas `crop` **não é aceito** no `POST` (400 identificando o campo) e o filtro `?crop=` da listagem foi removido; a resposta continua trazendo `crop: "SOJA"`.

A cultivar de referência é criada pelo seed (`prisma/seed.ts`, idempotente por nome + cultura; `reference-cultivars.ts` é a fonte da verdade) com `isDefault = true` e `referenceSnapshot = null`, e é **imutável pela API**, inclusive para `ADMIN` (403 `DEFAULT_CULTIVAR_READONLY`): corrigir um valor é alterar o seed e executá-lo novamente. Fonte bibliográfica em JSDoc no próprio seed. `GET /api/v1/cultivars/reference` (declarada antes de `/:id`) devolve essa cultivar do banco; 404 `REFERENCE_CULTIVAR_MISSING` se o seed não rodou.

**Nova cultivar nasce da referência.** Ninguém digita os 16 parâmetros do zero: o formulário "Nova cultivar" abre pré-preenchido com a referência (`docs/modulos/frontend.md`) e, no `POST`, o serviço grava em `cultivars.reference_snapshot` os 16 parâmetros da referência **naquele momento**. É esse snapshot que permite saber o que o técnico alterou (campo "não alterado" = valor atual igual ao do `referenceSnapshot`); comparar com a referência atual não serviria, porque, quando a referência muda, campos nunca tocados pareceriam alterados.

**Atualizar a partir da referência.** `POST /api/v1/cultivars/:id/sync-reference` com `{ mode: "unchanged" | "all" }` (mesmas permissões do `PATCH`; 403 na referência): `unchanged` substitui só os campos iguais ao `referenceSnapshot`; `all` substitui os 16. Nos dois modos grava o novo `referenceSnapshot`, valida o estado resultante e responde 200 `{ cultivar, updatedFields: string[] }`. Serve para quando a referência tabelada mudar (ex.: o valor definitivo de T_B, `tUpper`, hoje 30 °C provisórios — questão nº 10). Campos anuláveis comparam `null` como valor (`null === null` conta como "não alterado").

**Regras das cultivares (`/api/v1/cultivars`):**

- `AGRONOMO` e `ADMIN` criam cultivares próprias (`createdById` = criador); `PRODUTOR` é somente leitura.
- Visibilidade: a cultivar de referência + as próprias; `ADMIN` vê todas. Fora disso, 404.
- Validação Zod com faixas plausíveis: `tBase` 0–20 °C; `tUpper` 15–50 °C, opcional (`null` = sem base superior) e, quando informado, `> tBase` (erro apontado em `tUpper`; vale também para um `PATCH` em `tBase` que alcance o `tUpper` vigente); `gdaTotal` 300–4000; limiares `gdaF1End < gdaF2End < gdaF3End < gdaTotal`; `0 < Kc ≤ 1,5`; `0 < p < 1`; `0 < zrIni ≤ zrMax ≤ 3 m`; `0 ≤ Ky ≤ 1,5`. No `PATCH`, as relações cruzadas são validadas sobre o estado resultante.
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
| `emergenceDate` | Date | Data de emergência (início do ciclo da cultura). O balanço hídrico da run começa **antes**, em `preSeasonStart(emergenceDate)` = último 1º de fevereiro ≤ emergência (spin-up de entressafra, §3) |
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
- **Cobertura ERA5-Land desde fevereiro**: ao criar a safra, a cobertura da célula verificada (e o backfill enfileirado, se faltar) vai de `preSeasonStart(emergenceDate)` a `hoje − 6` — não da emergência (`docs/msa/era5-etl.md` § Orquestração). A primeira safra de uma célula nova baixa ≈ 8 meses a mais de ERA5; até o backfill terminar, o processamento grava `NEEDS_DATA` com as datas da entressafra em `missingDates`.
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

**Intervalo processado (motor 2.2.0):** de `preSeasonStart(emergenceDate)` — o **último 1º de fevereiro ≤ emergência** (`engine/pre-season.ts`) — até o menor entre `hoje − 6` (UTC, o lag do ERA5-Land) e o dia em que o GDA acumulado, percorrido sobre dias contíguos **a partir da emergência** (os dias de entressafra não acumulam GDA), atinge `gdaTotal` (`resolveInterval(from, limit, series, cultivar, emergence)` usa `dailyGDA` com `tBase` e `tUpper` do snapshot — graus-dia pelo **método de Ometto (1981)**, cinco casos, `algoritmos.md` §1; com T_B o ciclo termina no mesmo dia ou depois do que terminaria pelo residual). `dateFrom` da run é o início do spin-up (`preSeasonFrom`). A condição **"emergência dentro do lag"** continua avaliada sobre a **emergência**, não sobre o início do spin-up: se `emergenceDate > hoje − 6`, a run `NEEDS_DATA` com `missingDates = [emergenceDate]` é gravada **antes** de buscar a série (um spin-up completo sem dia de cultura não tem o que processar). Lacunas depois do fim do ciclo não bloqueiam; lacuna em qualquer ponto do intervalo — inclusive na entressafra — gera uma run `NEEDS_DATA` com `missingDates`, **sem calcular e sem interpolar**. **Invariante:** uma run `SUCCEEDED` tem ao menos um dia com `date ≥ emergenceDate`; série resolvida só com dias `PRE` vira `NEEDS_DATA` (emergência em `missingDates`), e por isso `currentPhase` nunca é `PRE`.

**Entressafra (spin-up):** `runDailyBalance` recebe `preSeason = { until: emergenceDate, kc: PRE_SEASON_KC, zr: PRE_SEASON_ZR_MODE === 'zrMax' ? zrMax : zrIni }` (`config/pre-season.ts` → `preSeasonConfig()`; padrões 1,0 e `zrMax`, validados em `config/env.ts`) e `initialDepletion 0` (solo na capacidade de campo em 1º de fevereiro). Os dias anteriores à emergência saem com `phase = 'PRE'`, `gda 0`, `gdaAccum 0`, Kc e Zr constantes e a mesma cadeia TAW/RAW/Ks/ET₀/ETc/Dr; no primeiro dia de cultura a depleção é convertida por proporção para a zona radicular inicial (`convertDepletion`, `algoritmos.md` §5). A run grava `preSeasonFrom`, `preSeasonKc`, `preSeasonZr` (m), `emergenceDepletionMm` (Dr convertido no dia da emergência) e `emergenceDepletionPct` (`emergenceDepletionMm / TAW(zrIni) × 100`); emergência em 1º de fevereiro ⇒ sem dias `PRE` e depleção 0. Runs de motor anterior têm os cinco campos nulos (o painel mostra "Esta execução não tem entressafra (motor anterior); reprocesse").

**Persistência (reprodutibilidade):** cada execução gera uma run em `msa_runs` com status (`SUCCEEDED` / `FAILED` / `NEEDS_DATA`), intervalo, `cultivarSnapshot` (os 16 parâmetros, `tUpper` possivelmente nulo, + id/nome/cultura como estavam), `soilSnapshot` (θFC, θWP, altitude, `soilDefaults`), `engineVersion` (`ENGINE_VERSION` do motor, semver — `2.2.0` desde a entressafra (2026-11-09); `2.1.0` Ometto e `2.0.0` ficam no histórico), os campos de produtividade: `expectedYield` (Ym da safra no momento), `yieldIndex` (índice do ciclo), `phasesReached` (0–4) e `predictedYield` (nulo sem Ym; todos nulos em `NEEDS_DATA`/`FAILED`), e os campos da entressafra (`preSeasonFrom`, `preSeasonKc`, `preSeasonZr`, `emergenceDepletionMm`, `emergenceDepletionPct` — migration aditiva `add_preseason_water_balance`; nulos em runs < 2.2.0). O motor recebe o snapshot, não o registro atual da cultivar. A série diária vai para `msa_daily_results` (uma linha por dia, **inclusive os dias `PRE` da entressafra**, colunas de `DailyBalanceRow`; a coluna `phase` é texto) e os resumos por janela (sem percentis) para `msa_phase_summaries`. Reprocessar cria uma run nova; o histórico é mantido; `harvests.latestRunId` aponta para a última run `SUCCEEDED`. Mesmos dados + mesmos snapshots ⇒ resultados idênticos (verificado no roteiro `e2e-msa.sh`).

**Eventos de estresse e perda por janela (motor 2.3.0, `algoritmos.md` §6.5 e §7):** na mesma run, `detectStressEvents(series, cultivar, stressParams())` (`config/stress.ts` → `STRESS_KS_THRESHOLD` 0,70 / `STRESS_MIN_DAYS` 3) resume a série de Ks em eventos (sequências contíguas de dias de cultura com Ks < limiar, ≥ mínimo de dias, não divididas na fronteira de janela) e `attributeYieldLoss(summaries, expectedYield)` decompõe Ym − Ya por janela com soma exata; ambos gravados em `msa_runs` com os parâmetros. Runs ≤ 2.2.0: `GET /msa` calcula na leitura (`stressComputedOnRead: true`). O painel mostra tudo na seção final "Como foi a safra" (`docs/modulos/frontend.md`).

**Predição de produtividade (`algoritmos.md` §6):** `cycleYieldIndex(summaries)` devolve `{ yieldIndex, phasesReached, factors }`, com `yieldIndex = Π_j [1 − Ky_j·(1 − Ks̄_j)]` sobre as janelas com dias e fator 1 nas não alcançadas ("considera o restante do ciclo sem estresse"); `predictedYield = expectedYield × yieldIndex`. `GET /msa` devolve ainda `cultivarChangedSinceRun` (função pura que compara a **união** das chaves de `CultivarParams` do `cultivarSnapshot` e da cultivar atual; chave ausente de um lado conta como `null`) para o aviso do painel. Por isso uma run do motor 2.0.0 — cujo snapshot não tem `tUpper` — acusa divergência e o painel sugere reprocessar; é o comportamento desejado após o deploy de 2.1.0 ("Processar todas as safras ativas" em `/admin`). Após o deploy de 2.2.0, as runs antigas continuam válidas, mas sem entressafra: o painel sugere reprocessar e as safras cujo talhão não tem ERA5 desde fevereiro ficam `NEEDS_DATA` até o backfill (README raiz, nota pós-deploy). A predição é um valor único, sem faixa de incerteza.

---

## Fluxo Operacional Detalhado

```
1. [Scheduler BullMQ: segunda 02:00 America/Sao_Paulo] → job `msa-weekly:trigger`
2. Flow: filho `era5-ingest {kind: latest}` (ETL Python; [hoje−16, hoje−6], todas as células; 3 tentativas)
         → pai `msa-weekly:run` só executa se o filho concluiu
3. Pai enfileira `msa-process {harvestId, reason: WEEKLY}` por safra ACTIVE (jobId weekly_<data>_<id>)
4. Worker Node (concorrência 4), para cada job:
   a. Busca a série diária da célula do talhão (Tmax, Tmin, Tdew, u2, Rn, P) desde o último 1º de fevereiro ≤ emergência
   a'. Entressafra (dias PRE, até a véspera da emergência): sem cultura, Kc/Zr constantes (PRE_SEASON_*), solo cheio em fevereiro → depleção na emergência (convertida para zrIni)
   b. GDA do dia (Ometto: Tb/TB) e acumulado desde a emergência → janela fenológica (F1/F2/F3/F4) e fim do ciclo
   c. ET₀ diária (FAO-56) → ETc = Kc(GDA) × ET₀
   d. Balanço hídrico diário → Dr, Ks, ETc_adj; resumo por janela (Ks médio, Ky·(1−Ks̄))
   e. Índice do ciclo = Π das janelas alcançadas → produtividade predita = Ym × índice (sc/ha)
   f. Persiste run (reason, jobId, snapshots, Ym, índice, phasesReached, predita, preSeason*, emergenceDepletion*), série diária (PRE + cultura) e resumos
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
| `phenoPhase` | Texto | F1 / F2 / F3 / F4 / COMPLETED, ou **PRE** nos dias da entressafra (anteriores à emergência; `GET /msa/daily` só os devolve com `includePreSeason=true`) |
| `gda` | Decimal | GDA do dia (°C·dia); 0 nos dias PRE |
| `gdaAccum` | Decimal | GDA acumulado desde emergência; 0 nos dias PRE |
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

### msa_runs (eventos de estresse e perda por janela — motor 2.3.0, migration aditiva `add_stress_timeline`)

| Campo | Tipo | Descrição |
|---|---|---|
| `stressEvents` | Json? | `StressEvent[]` (`algoritmos.md` §7.1): início, fim, dias, Ks mín/médio, déficit (mm), janelas atravessadas, janela dominante e seu Ky |
| `yieldLoss` | Json? | `YieldLossAttribution` (§6.5): fatores, perda por janela em % e sc/ha, total = Ym − predita |
| `stressKsThreshold`, `stressMinDays` | Float?, Int? | Parâmetros usados (snapshot de `STRESS_KS_THRESHOLD` / `STRESS_MIN_DAYS`; padrões 0,70 e 3) |

> Nulos em runs de motor anterior a 2.3.0: `GET /msa` então calcula `stressEvents` e `yieldLoss` na leitura (série persistida + `cultivarSnapshot` + resumos + parâmetros atuais) e responde `stressComputedOnRead: true`, sem gravar; `GET /msa/runs` devolve só o gravado. Severidade da janela no painel passa a ser pela perda (`windowSeverity`: < 5 % ok, 5–15 % atenção, > 15 % crítico — questão nº 4); do dia pelo Ks (`daySeverity`).

### msa_runs (campos da entressafra — motor 2.2.0, migration aditiva `add_preseason_water_balance`)

| Campo | Tipo | Descrição |
|---|---|---|
| `preSeasonFrom` | Date? | Início do spin-up = `preSeasonStart(emergenceDate)` (último 1º de fevereiro ≤ emergência); igual a `dateFrom` |
| `preSeasonKc` | Float? | Kc constante usado nos dias PRE (snapshot de `PRE_SEASON_KC`) |
| `preSeasonZr` | Float? | Zr (m) usado nos dias PRE (`zrMax` ou `zrIni` da cultivar, conforme `PRE_SEASON_ZR_MODE`) |
| `emergenceDepletionMm` | Float? | Depleção na emergência, já convertida para a zona radicular inicial (mm); 0 sem dias PRE |
| `emergenceDepletionPct` | Float? | `emergenceDepletionMm / TAW(zrIni) × 100` (0–100); o painel mostra 100 − pct como "água disponível" |

> Os cinco campos são nulos em runs de motor anterior a 2.2.0 e em `NEEDS_DATA`/`FAILED`.

> A tabela `msa_decisions` e as colunas `seed`, `iterations`, `sigma_*`, `valid_iterations` e `*_p10/p50/p90` foram removidas pela migration `refocus_yield_prediction` (destrutiva: runs anteriores são descartadas — após o deploy, "Processar todas as safras ativas" em `/admin`).

---

## Endpoints Principais

Escopo de acesso herdado da safra (404 fora dele); `PRODUTOR` só leitura (403 nas rotas de escrita).

| Método | Path | Descrição | Roles |
|---|---|---|---|
| GET | `/api/v1/cultivars/reference` | Cultivar de referência de soja (seed); 404 `REFERENCE_CULTIVAR_MISSING` | Todos |
| POST | `/api/v1/cultivars` | Cria cultivar própria (sem `crop`; `tUpper` opcional, `null` = sem base superior; `referenceSnapshot` gravado da referência) | AGRONOMO, ADMIN |
| POST | `/api/v1/cultivars/:id/sync-reference` | `{ mode: "unchanged" \| "all" }` → 200 `{ cultivar, updatedFields }`; 403 na referência | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests` | Cadastra nova safra (`expectedYield` opcional, sc/ha, ≤ 250) | AGRONOMO, ADMIN |
| PATCH | `/api/v1/harvests/:id` | `status`, `notes`, `season`, `expectedYield` (não recalcula runs) | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process` | Enfileira o (re)processamento: **202** `{ jobId, queue, status: "queued" }`; 404 fora do escopo | AGRONOMO, ADMIN |
| POST | `/api/v1/harvests/:id/msa/process?sync=true` | Processa inline: 201 run `SUCCEEDED` com resumos; 200 run `NEEDS_DATA` com `missingDates`; 422 `MISSING_FIELD_ALTITUDE`; 500 `MSA_PROCESSING_FAILED` (run `FAILED` gravada); 403 `SYNC_ADMIN_ONLY` para não-ADMIN | ADMIN |
| GET | `/api/v1/harvests/:id/msa` | Última run `SUCCEEDED`: metadados, snapshots, `expectedYield`/`yieldIndex`/`predictedYield`/`phasesReached`, `preSeasonFrom`/`preSeasonKc`/`preSeasonZr`/`emergenceDepletionMm`/`emergenceDepletionPct` (nulos em runs < 2.2.0), `stressEvents`/`yieldLoss`/`stressKsThreshold`/`stressMinDays`/`stressComputedOnRead` (motor 2.3.0; calculados na leitura para runs anteriores), 4 janelas (sem percentis), `currentPhase` (nunca `PRE`), `cultivarChangedSinceRun`; 404 `NO_MSA_RESULT` | Todos |
| GET | `/api/v1/harvests/:id/msa/daily?runId=&includePreSeason=` | Série diária da run (padrão: última). `includePreSeason=false` (padrão) devolve só os dias de cultura, da emergência a `dateTo`; `true` inclui os dias `PRE` desde `dateFrom`; outro valor → 400 identificando `includePreSeason` | Todos |
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
| `src/modules/msa/engine/` | Motor puro: GDA (Ometto, `gda.ts`), fenologia, ET₀, Kc, balanço com entressafra (`water-balance.ts`, `pre-season.ts`: `preSeasonStart`, `convertDepletion`), FAO-33 (`yield.ts`: redução por janela, índice do ciclo, produtividade predita) — `ENGINE_VERSION` 2.2.0 |
| `src/config/pre-season.ts` · `env.ts` | `PRE_SEASON_KC` (padrão 1,0; (0, 1,5]) e `PRE_SEASON_ZR_MODE` (`zrMax` \| `zrIni`) → `preSeasonConfig()`; gravados em cada run |
| `src/modules/jobs/flows.ts` · `jobs.service.ts` | Filas, payloads, flows (semanal, backfill), `planHarvestJobs`, ids determinísticos; enfileiramento e consulta |
| `src/modules/jobs/jobs.routes.ts` · `jobs.controller.ts` | `/api/v1/admin/jobs` (ADMIN) |
| `src/worker.ts` | Processo `worker`: consumidores `msa-process` (×4) e `msa-weekly`, scheduler semanal, shutdown gracioso |
| `src/config/queue.ts` | Nomes das filas e conexão BullMQ (separada do Redis do limite de login) |
| `backend/etl/` | ETL Python — worker da fila `era5-ingest` + CLI (`ingest`, `backfill`, `status`, `worker`) |
| `backend/scripts/e2e/e2e-msa.sh` · `e2e-orchestration.sh` | Roteiros de ponta a ponta do processamento (inline) e da orquestração (filas) |
| `src/modules/cultivars/` | Cultivares: 16 parâmetros (`tUpper` anulável), referência (`GET /reference`), `referenceSnapshot`, `sync-reference`, edição em uso |
| `scripts/validation/gda-validate.ts` | `pnpm msa:validate-gda` — Caso 5 de `validacao.md`: residual × Ometto × Ometto com TB |
| `scripts/validation/preseason-validate.ts` | `pnpm msa:validate-preseason` — complemento do Caso 2: depleção na emergência por Kc da entressafra (0,4 / 0,7 / 1,0), `--zr-mode`, CSV |
| `docs/msa/algoritmos.md` | Fórmulas matemáticas completas |
| `docs/msa/era5-etl.md` | Pipeline de ingestão e correção |
| `docs/msa/validacao.md` | Protocolo de validação científica |
