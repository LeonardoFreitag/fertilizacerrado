# msa-processing Specification

## Purpose

Processamento determinístico do MSA por safra (motor 2.3.0; graus-dia pelo método de Ometto (1981) com `tBase` e `tUpper` opcional da cultivar; balanço hídrico com spin-up de entressafra desde `preSeasonStart(emergenceDate)` — último 1º de fevereiro ≤ emergência — até a emergência, com `PRE_SEASON_KC`/`PRE_SEASON_ZR_MODE` do ambiente) com persistência reproduzível (snapshots da cultivar e do solo, versão do motor), gravando por run a série diária completa a partir de `preSeasonFrom` (dias `PRE` incluídos), os resumos por janela, o índice de produtividade do ciclo, a produtividade potencial da safra no momento, a produtividade predita, a depleção na emergência (`emergenceDepletionMm`/`emergenceDepletionPct`), os eventos de estresse hídrico, a perda de produtividade atribuída por janela e os parâmetros `stressKsThreshold`/`stressMinDays` usados (calculados na leitura para runs de motor anterior a 2.3.0); consulta de resultados (com indicação de cultivar alterada desde a run; série diária sem os dias `PRE` por padrão, `includePreSeason=true` para incluí-los) e histórico de runs. Não há cenários de decisão nem registro de decisão do técnico.

## Requirements

### Requirement: Processamento de uma safra
`POST /api/v1/harvests/:id/msa/process` (roles `AGRONOMO` e `ADMIN`, safra no escopo do usuário) SHALL por padrão enfileirar um job `msa-process {harvestId, reason: "MANUAL"}` e responder 202 com `jobId` e `queue`. Com `?sync=true`, restrito a `ADMIN` (403 `SYNC_ADMIN_ONLY` para os demais), SHALL executar inline: carregar safra, talhão e cultivar; exigir `altitudeM` do talhão (422 `MISSING_FIELD_ALTITUDE`, sem criar run); usar `thetaFC`/`thetaWP` do talhão ou os defaults 0,28/0,12; se `emergenceDate > hoje − 6` (UTC), gravar run `NEEDS_DATA` com `missingDates = [emergenceDate]` antes de buscar a série (a condição "emergência dentro do lag" é avaliada sobre a emergência, não sobre o início do spin-up); caso contrário definir o intervalo de `preSeasonStart(emergenceDate)` (último 1º de fevereiro ≤ emergência) até o menor entre `hoje − 6` e o dia em que o GDA acumulado desde a emergência — calculado pelo método de Ometto com `tBase` e `tUpper` da cultivar — atinge `gdaTotal`; verificar a cobertura da série no intervalo inteiro e, havendo lacuna, gravar uma run `NEEDS_DATA` com `missingDates` sem calcular; caso contrário executar uma única vez `runDailyBalance` com `preSeason = { until: emergenceDate, kc: PRE_SEASON_KC, zr: PRE_SEASON_ZR_MODE === 'zrMax' ? zrMax : zrIni }` e `initialDepletion 0`, `summarizeByPhase`, `cycleYieldIndex`, `detectStressEvents(series, cultivar, { ksThreshold: STRESS_KS_THRESHOLD, minDays: STRESS_MIN_DAYS })` e `attributeYieldLoss(summaries, expectedYield)`, e gravar run `SUCCEEDED` com a série diária completa (dias `PRE` com `gda 0`), os quatro resumos por janela, `expectedYield` (valor da safra no momento, ou nulo), `yieldIndex`, `phasesReached`, `predictedYield = expectedYield × yieldIndex` (nulo sem `expectedYield`), `preSeasonFrom`, `preSeasonKc`, `preSeasonZr`, `emergenceDepletionMm` (depleção convertida no dia da emergência), `emergenceDepletionPct` (`emergenceDepletionMm / TAW(zrIni) × 100`), `stressEvents` (JSON dos eventos), `yieldLoss` (JSON da atribuição), `stressKsThreshold` e `stressMinDays` (parâmetros usados) em uma transação, atualizando `latestRunId` da safra. `dateFrom` da run SHALL ser `preSeasonFrom`. Uma run `SUCCEEDED` MUST conter ao menos um dia com `date ≥ emergenceDate`: série resolvida só com dias `PRE` MUST virar `NEEDS_DATA` (com a emergência em `missingDates`), nunca `SUCCEEDED`; `currentPhase` MUST NOT ser `PRE`. O worker executa a mesma lógica para jobs da fila, com `triggeredById` nulo. Toda run MUST registrar `reason` (`WEEKLY`, `BACKFILL` ou `MANUAL`) e, quando vinda da fila, `jobId`. Erro no cálculo MUST gravar run `FAILED` com a mensagem e, no modo inline, responder 500 `MSA_PROCESSING_FAILED`. O sistema MUST NOT interpolar dias faltantes. A rota MUST NOT aceitar `seed` e a run MUST NOT ter `seed`, `iterations`, `sigmaPrecip` ou `sigmaTemp`. `PRE_SEASON_KC` (padrão 1,0, em (0, 1,5]), `PRE_SEASON_ZR_MODE` (`zrMax` padrão ou `zrIni`), `STRESS_KS_THRESHOLD` (padrão 0,70, em (0, 1]) e `STRESS_MIN_DAYS` (padrão 3, inteiro ≥ 1) SHALL ser validados em `config/env.ts`.

#### Scenario: Enfileiramento padrão
- **WHEN** um `AGRONOMO` chama `POST .../msa/process`
- **THEN** a resposta é 202 com `jobId`, `queue: "msa-process"` e, após o worker processar, `GET .../msa` devolve a run com `reason MANUAL` e esse `jobId`

#### Scenario: Sync restrito a administrador
- **WHEN** um `AGRONOMO` chama `POST .../msa/process?sync=true`
- **THEN** a resposta é 403 com `SYNC_ADMIN_ONLY`

#### Scenario: Processamento síncrono bem-sucedido
- **WHEN** um `ADMIN` chama `POST .../msa/process?sync=true` para safra com emergência `2025-11-01`, `expectedYield 65`, talhão com altitude e série completa de `2025-02-01` a hoje − 6
- **THEN** a resposta é 201 com a run `SUCCEEDED`, `reason MANUAL`, `dateFrom 2025-02-01`, `preSeasonFrom 2025-02-01`, `preSeasonKc 1`, `preSeasonZr 0.95`, `emergenceDepletionMm ≥ 0`, `emergenceDepletionPct` em [0, 100], quatro resumos de janela, `expectedYield 65`, `yieldIndex` em [0, 1], `predictedYield = 65 × yieldIndex`, `phasesReached` em 1–4, `stressEvents` (lista, possivelmente vazia), `yieldLoss` com `totalLossScHa = 65 − predictedYield`, `stressKsThreshold 0.7`, `stressMinDays 3`, `engineVersion "2.3.0"`, snapshots, e `latestRunId` da safra passa a ser a run

#### Scenario: Entressafra seca reduz a água na emergência
- **WHEN** a série de entressafra tem meses sem chuva antes da emergência
- **THEN** `emergenceDepletionPct` é maior que 0 e o `ks` dos primeiros dias de F1 é menor ou igual ao de uma run equivalente processada com depleção inicial 0

#### Scenario: Lacuna na entressafra
- **WHEN** faltam os dias 2025-06-10 e 2025-06-11 (antes da emergência) na célula
- **THEN** a run é `NEEDS_DATA` com `missingDates = ["2025-06-10", "2025-06-11"]` e `latestRunId` não muda

#### Scenario: Emergência em 1º de fevereiro
- **WHEN** a emergência é `2026-02-01`
- **THEN** `preSeasonFrom = 2026-02-01`, não há dias `PRE`, `emergenceDepletionMm = 0` e `emergenceDepletionPct = 0`

#### Scenario: Safra sem produtividade potencial
- **WHEN** a safra não tem `expectedYield` e o processamento conclui
- **THEN** a run é `SUCCEEDED` com `yieldIndex` e `phasesReached` preenchidos e `expectedYield` e `predictedYield` nulos

#### Scenario: Ym alterada depois da run
- **WHEN** a safra recebe `PATCH` com `expectedYield 70` após uma run com `expectedYield 65`
- **THEN** a run existente mantém `expectedYield 65` e `predictedYield` originais; só uma run nova usa 70

#### Scenario: Parâmetro seed rejeitado
- **WHEN** o `POST .../msa/process?seed=42` é chamado
- **THEN** a resposta é 400 identificando `seed`

#### Scenario: Talhão sem altitude
- **WHEN** o talhão não tem `altitudeM` e o processamento roda (inline ou pelo worker)
- **THEN** inline a resposta é 422 com `MISSING_FIELD_ALTITUDE` e nenhuma run é criada; pelo worker o job falha com essa mensagem e nenhuma run é criada

#### Scenario: Lacuna na série
- **WHEN** faltam os dias 2025-11-15 e 2025-11-16 entre a emergência e hoje − 6
- **THEN** inline a resposta é 200 com run `NEEDS_DATA`, `missingDates = ["2025-11-15", "2025-11-16"]`, sem resultados, `yieldIndex`/`predictedYield`/`phasesReached`/`emergenceDepletionMm` nulos, e `latestRunId` não muda

#### Scenario: Ciclo encerrado antes de uma lacuna
- **WHEN** o GDA acumulado atinge `gdaTotal` em 2026-03-10 e faltam dias depois dessa data
- **THEN** a run é `SUCCEEDED` com `dateTo = 2026-03-10` e `phasesReached = 4`

#### Scenario: Emergência dentro do lag
- **WHEN** a emergência é posterior a hoje − 6 (mesmo que o spin-up desde fevereiro esteja todo em cache)
- **THEN** a run é `NEEDS_DATA` com `missingDates = [emergência]`, sem consultar a série nem gravar dias `PRE`

#### Scenario: Safra criada três dias após a emergência
- **WHEN** a safra é criada com emergência em `hoje − 3` e a célula tem a série completa de fevereiro a hoje − 6
- **THEN** o processamento grava `NEEDS_DATA` com `missingDates = [emergência]`, nenhuma run `SUCCEEDED` é criada e `GET .../msa` continua 404 `NO_MSA_RESULT` (nunca uma run com `currentPhase PRE`)

#### Scenario: Solo com defaults
- **WHEN** o talhão não tem `thetaFC` e `thetaWP`
- **THEN** o `soilSnapshot` da run traz `thetaFC 0.28`, `thetaWP 0.12`, a altitude e `soilDefaults: true`

#### Scenario: Snapshot fiel
- **WHEN** a run é criada
- **THEN** `cultivarSnapshot` contém os 16 parâmetros científicos (inclusive `tUpper`, número ou `null`), `id`, `name` e `crop` da cultivar como estavam no momento, e o cálculo usou exatamente esses valores

#### Scenario: Reprodutibilidade
- **WHEN** a safra é processada duas vezes com os mesmos dados
- **THEN** a série diária, os resumos por janela, `yieldIndex`, `predictedYield` e `emergenceDepletionMm` das duas runs são idênticos

#### Scenario: Reprocessamento mantém histórico
- **WHEN** a safra é processada de novo
- **THEN** uma nova run é criada, a anterior permanece em `GET /runs` e `latestRunId` aponta para a nova se ela for `SUCCEEDED`

#### Scenario: Produtor tenta processar
- **WHEN** um `PRODUTOR` chama `POST .../msa/process` em safra da própria propriedade
- **THEN** a resposta é 403

#### Scenario: Safra fora do escopo
- **WHEN** um `AGRONOMO` chama qualquer rota `.../msa` de uma safra de propriedade alheia
- **THEN** a resposta é 404

#### Scenario: Eventos e perda gravados
- **WHEN** a série processada tem dez dias consecutivos de F3 com `ks < 0,70`
- **THEN** a run grava em `stressEvents` um evento com `dominantPhase F3` e `days ≥ 10`, e `yieldLoss.phases[2].lossScHa` é a maior perda entre as janelas

### Requirement: Campos do talhão para o MSA
O talhão SHALL aceitar `altitudeM` (metros, em [−100, 5000]), `thetaFC` e `thetaWP` (m³/m³, em (0, 1)) no cadastro e na atualização, todos opcionais; quando ambos os teores estão presentes, `thetaFC` MUST ser maior que `thetaWP`, validado sobre o estado resultante no `PATCH`. Os três campos SHALL constar nas respostas de talhão.

#### Scenario: Cadastro com altitude e solo
- **WHEN** o `POST .../fields` traz `altitudeM 741`, `thetaFC 0.30`, `thetaWP 0.14`
- **THEN** a resposta é 201 com os três valores

#### Scenario: Teores invertidos
- **WHEN** `thetaFC 0.12` e `thetaWP 0.28`
- **THEN** a resposta é 400 identificando `thetaFC`

#### Scenario: PATCH que inverte os teores
- **WHEN** o talhão tem `thetaFC 0.28`, `thetaWP 0.12` e o `PATCH` envia só `thetaWP 0.30`
- **THEN** a resposta é 400 e o talhão permanece inalterado

#### Scenario: Limpar a altitude
- **WHEN** o `PATCH` envia `altitudeM: null`
- **THEN** a resposta é 200 com `altitudeM` nulo

### Requirement: Consulta de resultados
`GET /api/v1/harvests/:id/msa` SHALL devolver a última run `SUCCEEDED` com seus metadados (incluindo `expectedYield`, `yieldIndex`, `predictedYield`, `phasesReached`, `preSeasonFrom`, `preSeasonKc`, `preSeasonZr`, `emergenceDepletionMm`, `emergenceDepletionPct` — nulos em runs de motor anterior a 2.2.0 —, `stressEvents`, `yieldLoss`, `stressKsThreshold`, `stressMinDays` e `stressComputedOnRead`), os quatro resumos de janela (`phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct`, sem percentis nem `validIterations`), `currentPhase` (fase da última linha de cultura, nunca `PRE`) e `cultivarChangedSinceRun` (verdadeiro quando, iterando sobre a união das chaves numéricas do `cultivarSnapshot` da run e da cultivar atual da safra — chave ausente de um lado vale `null` —, algum valor difere; a comparação MUST NOT depender de uma lista fixa de nomes); 404 `NO_MSA_RESULT` se a safra não tem run `SUCCEEDED`. Quando a última run não tem `stressEvents` gravado (motor ≤ 2.2.0), `GET .../msa` SHALL calcular `stressEvents` e `yieldLoss` na leitura — a partir da série diária persistida (dias de cultura), do `cultivarSnapshot` como parâmetros da cultivar, dos resumos gravados e dos parâmetros atuais do ambiente — e devolvê-los com `stressComputedOnRead: true` e `stressKsThreshold`/`stressMinDays` iguais aos usados, sem gravar nada; runs com os campos gravados devolvem-nos com `stressComputedOnRead: false`. `GET .../msa/daily?runId=&includePreSeason=` SHALL devolver a série diária da run (padrão: a última) sem os dias `PRE` por padrão e com eles quando `includePreSeason=true`; 404 se a run não pertence à safra; `includePreSeason` com valor diferente de `true`/`false` MUST responder 400. `GET .../msa/runs` SHALL listar todas as runs da safra, mais recente primeiro, sem séries, com `stressEvents` e `yieldLoss` apenas quando gravados (nulos nas runs anteriores, sem cálculo na leitura). As rotas `GET .../msa/decision`, `POST .../msa/decisions` e `GET .../msa/decisions` MUST NOT existir (404).

#### Scenario: Último resultado
- **WHEN** a safra tem runs `SUCCEEDED` e, depois, uma `NEEDS_DATA`
- **THEN** `GET .../msa` devolve a última `SUCCEEDED` e `GET .../msa/runs` lista ambas

#### Scenario: Campos da entressafra
- **WHEN** `GET .../msa` devolve uma run do motor 2.2.0
- **THEN** a resposta traz `preSeasonFrom`, `preSeasonKc`, `preSeasonZr`, `emergenceDepletionMm` e `emergenceDepletionPct`; para uma run 2.1.0 os cinco vêm nulos

#### Scenario: Série diária sem entressafra por padrão
- **WHEN** `GET .../msa/daily` é chamado sem `includePreSeason`
- **THEN** devolve uma linha por dia da emergência a `dateTo`, sem `phase PRE`, com `date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw`

#### Scenario: Série diária com entressafra
- **WHEN** `GET .../msa/daily?includePreSeason=true` é chamado
- **THEN** devolve uma linha por dia de `[dateFrom, dateTo]`, com os dias anteriores à emergência em `phase PRE`, `gda 0`, `gdaAccum 0`, `zr = preSeasonZr` e `kc = preSeasonKc`

#### Scenario: includePreSeason inválido
- **WHEN** `GET .../msa/daily?includePreSeason=sim` é chamado
- **THEN** a resposta é 400 identificando `includePreSeason`

#### Scenario: Resumos sem percentis
- **WHEN** `GET .../msa` devolve uma run `SUCCEEDED`
- **THEN** cada entrada de `phases` traz `phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct` e não traz `percentiles` nem `validIterations`

#### Scenario: Cultivar inalterada
- **WHEN** a cultivar da safra tem os mesmos valores do `cultivarSnapshot` da run em todas as chaves de `CultivarParams`
- **THEN** `cultivarChangedSinceRun` é `false`

#### Scenario: Cultivar alterada depois da run
- **WHEN** o técnico altera `kcMid` da cultivar depois da run
- **THEN** `GET .../msa` devolve `cultivarChangedSinceRun: true` e a run mantém o snapshot original

#### Scenario: Run do motor 2.0.0 sem tUpper
- **WHEN** a última run tem `cultivarSnapshot` sem a chave `tUpper` (motor 2.0.0) e a cultivar atual tem `tUpper 30`
- **THEN** `GET .../msa` devolve `cultivarChangedSinceRun: true` (o painel sugere reprocessar) e a run mantém `engineVersion "2.0.0"`

#### Scenario: Parâmetro novo entra na comparação
- **WHEN** `CultivarParams` ganha uma chave nova gravada no snapshot e só ela difere da cultivar atual
- **THEN** `cultivarChangedSinceRun` é `true` sem alteração na função de comparação

#### Scenario: Nunca processada
- **WHEN** a safra não tem run `SUCCEEDED`
- **THEN** `GET .../msa` responde 404 com `NO_MSA_RESULT`

#### Scenario: Run de outra safra
- **WHEN** `runId` pertence a outra safra
- **THEN** a resposta é 404

#### Scenario: Produtor lê
- **WHEN** um `PRODUTOR` chama `GET .../msa`, `/daily` ou `/runs` de safra da própria propriedade
- **THEN** as respostas são 200

#### Scenario: Rotas de decisão removidas
- **WHEN** qualquer usuário chama `GET .../msa/decision`, `POST .../msa/decisions` ou `GET .../msa/decisions`
- **THEN** a resposta é 404

#### Scenario: Run do motor 2.2.0 lida com a leitura calculada
- **WHEN** a última run tem `engineVersion "2.2.0"` e `stressEvents` nulo no banco
- **THEN** `GET .../msa` devolve `stressEvents` e `yieldLoss` calculados da série e dos resumos, `stressComputedOnRead: true`, e a run continua sem os campos no banco

#### Scenario: Run do motor 2.3.0
- **WHEN** a última run foi processada pelo motor 2.3.0
- **THEN** `GET .../msa` devolve os campos gravados com `stressComputedOnRead: false`, e `GET .../msa/runs` traz `stressEvents` e `yieldLoss` dessa run e nulos nas runs 2.2.0

### Requirement: Versão do motor
O motor SHALL exportar `ENGINE_VERSION` (semver), gravada em toda run e devolvida em `GET .../msa`.

#### Scenario: Versão gravada
- **WHEN** uma run é criada
- **THEN** `engineVersion` é igual a `ENGINE_VERSION` do motor no momento

### Requirement: Calibração registrada na run
Ao processar uma safra (inline ou pelo worker), o sistema SHALL ler a calibração QM ativa da célula do talhão e gravar `qmCalibrationId` na run (nulo quando a célula não tem calibração). `GET /msa`, `GET /msa/runs` e o resultado do processamento MUST expor `qmCalibrationId` e `qmCalibration: { stationCode, stationName, years, distanceKm } | null`. A série usada no balanço MUST continuar vindo de `tp_corrected`.

#### Scenario: Célula calibrada
- **WHEN** a célula tem calibração ativa com a estação 83423 e 10 anos
- **THEN** a run grava `qmCalibrationId` e `GET /msa` devolve `qmCalibration.stationCode = "83423"`, `years = 10`

#### Scenario: Célula sem calibração
- **WHEN** a célula não tem calibração
- **THEN** `qmCalibrationId` é nulo e `qmCalibration` é nulo

#### Scenario: Recalibração não altera runs antigas
- **WHEN** a célula é recalibrada e `qm apply` roda depois de uma run
- **THEN** a run antiga mantém o `qmCalibrationId` original; só uma run nova referencia a nova calibração
