# msa-processing Specification

## Purpose

Processamento determinístico do MSA por safra com persistência reproduzível (snapshots da cultivar e do solo, versão do motor), gravando por run os resumos por janela, o índice de produtividade do ciclo, a produtividade potencial da safra no momento e a produtividade predita; consulta de resultados (com indicação de cultivar alterada desde a run) e histórico de runs. Não há cenários de decisão nem registro de decisão do técnico.

## Requirements

### Requirement: Processamento de uma safra
`POST /api/v1/harvests/:id/msa/process` (roles `AGRONOMO` e `ADMIN`, safra no escopo do usuário) SHALL por padrão enfileirar um job `msa-process {harvestId, reason: "MANUAL"}` e responder 202 com `jobId` e `queue`. Com `?sync=true`, restrito a `ADMIN` (403 `SYNC_ADMIN_ONLY` para os demais), SHALL executar inline: carregar safra, talhão e cultivar; exigir `altitudeM` do talhão (422 `MISSING_FIELD_ALTITUDE`, sem criar run); usar `thetaFC`/`thetaWP` do talhão ou os defaults 0,28/0,12; definir o intervalo da emergência até o menor entre `hoje − 6` (UTC) e o dia em que o GDA acumulado atinge `gdaTotal`; verificar a cobertura da série e, havendo lacuna, gravar uma run `NEEDS_DATA` com `missingDates` sem calcular; caso contrário executar uma única vez `runDailyBalance`, `summarizeByPhase` e `cycleYieldIndex`, e gravar run `SUCCEEDED` com a série diária, os quatro resumos por janela, `expectedYield` (valor da safra no momento, ou nulo), `yieldIndex`, `phasesReached` e `predictedYield = expectedYield × yieldIndex` (nulo sem `expectedYield`) em uma transação, atualizando `latestRunId` da safra. O worker executa a mesma lógica para jobs da fila, com `triggeredById` nulo. Toda run MUST registrar `reason` (`WEEKLY`, `BACKFILL` ou `MANUAL`) e, quando vinda da fila, `jobId`. Erro no cálculo MUST gravar run `FAILED` com a mensagem e, no modo inline, responder 500 `MSA_PROCESSING_FAILED`. O sistema MUST NOT interpolar dias faltantes. A rota MUST NOT aceitar `seed` e a run MUST NOT ter `seed`, `iterations`, `sigmaPrecip` ou `sigmaTemp`.

#### Scenario: Enfileiramento padrão
- **WHEN** um `AGRONOMO` chama `POST .../msa/process`
- **THEN** a resposta é 202 com `jobId`, `queue: "msa-process"` e, após o worker processar, `GET .../msa` devolve a run com `reason MANUAL` e esse `jobId`

#### Scenario: Sync restrito a administrador
- **WHEN** um `AGRONOMO` chama `POST .../msa/process?sync=true`
- **THEN** a resposta é 403 com `SYNC_ADMIN_ONLY`

#### Scenario: Processamento síncrono bem-sucedido
- **WHEN** um `ADMIN` chama `POST .../msa/process?sync=true` para safra com `expectedYield 65`, talhão com altitude e série completa da emergência a hoje − 6
- **THEN** a resposta é 201 com a run `SUCCEEDED`, `reason MANUAL`, quatro resumos de janela, `expectedYield 65`, `yieldIndex` em [0, 1], `predictedYield = 65 × yieldIndex`, `phasesReached` em 1–4, `engineVersion "2.0.0"`, snapshots, e `latestRunId` da safra passa a ser a run

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
- **THEN** inline a resposta é 200 com run `NEEDS_DATA`, `missingDates = ["2025-11-15", "2025-11-16"]`, sem resultados, `yieldIndex`/`predictedYield`/`phasesReached` nulos, e `latestRunId` não muda

#### Scenario: Ciclo encerrado antes de uma lacuna
- **WHEN** o GDA acumulado atinge `gdaTotal` em 2026-03-10 e faltam dias depois dessa data
- **THEN** a run é `SUCCEEDED` com `dateTo = 2026-03-10` e `phasesReached = 4`

#### Scenario: Emergência dentro do lag
- **WHEN** a emergência é posterior a hoje − 6
- **THEN** a run é `NEEDS_DATA` cobrindo o intervalo inteiro

#### Scenario: Solo com defaults
- **WHEN** o talhão não tem `thetaFC` e `thetaWP`
- **THEN** o `soilSnapshot` da run traz `thetaFC 0.28`, `thetaWP 0.12`, a altitude e `soilDefaults: true`

#### Scenario: Snapshot fiel
- **WHEN** a run é criada
- **THEN** `cultivarSnapshot` contém os 15 parâmetros científicos, `id`, `name` e `crop` da cultivar como estavam no momento, e o cálculo usou exatamente esses valores

#### Scenario: Reprodutibilidade
- **WHEN** a safra é processada duas vezes com os mesmos dados
- **THEN** a série diária, os resumos por janela, `yieldIndex` e `predictedYield` das duas runs são idênticos

#### Scenario: Reprocessamento mantém histórico
- **WHEN** a safra é processada de novo
- **THEN** uma nova run é criada, a anterior permanece em `GET /runs` e `latestRunId` aponta para a nova se ela for `SUCCEEDED`

#### Scenario: Produtor tenta processar
- **WHEN** um `PRODUTOR` chama `POST .../msa/process` em safra da própria propriedade
- **THEN** a resposta é 403

#### Scenario: Safra fora do escopo
- **WHEN** um `AGRONOMO` chama qualquer rota `.../msa` de uma safra de propriedade alheia
- **THEN** a resposta é 404

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
`GET /api/v1/harvests/:id/msa` SHALL devolver a última run `SUCCEEDED` com seus metadados (incluindo `expectedYield`, `yieldIndex`, `predictedYield`, `phasesReached`), os quatro resumos de janela (`phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct`, sem percentis nem `validIterations`), `currentPhase` e `cultivarChangedSinceRun` (verdadeiro quando, iterando sobre todas as chaves de `CultivarParams` presentes no `cultivarSnapshot` da run, algum valor difere da cultivar atual da safra; a comparação MUST NOT depender de uma lista fixa de nomes, de modo que um parâmetro novo em `CultivarParams` entre nela sem alteração); 404 `NO_MSA_RESULT` se a safra não tem run `SUCCEEDED`. `GET .../msa/daily?runId=` SHALL devolver a série diária da run (padrão: a última), 404 se a run não pertence à safra. `GET .../msa/runs` SHALL listar todas as runs da safra, mais recente primeiro, sem séries. As rotas `GET .../msa/decision`, `POST .../msa/decisions` e `GET .../msa/decisions` MUST NOT existir (404).

#### Scenario: Último resultado
- **WHEN** a safra tem runs `SUCCEEDED` e, depois, uma `NEEDS_DATA`
- **THEN** `GET .../msa` devolve a última `SUCCEEDED` e `GET .../msa/runs` lista ambas

#### Scenario: Resumos sem percentis
- **WHEN** `GET .../msa` devolve uma run `SUCCEEDED`
- **THEN** cada entrada de `phases` traz `phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct` e não traz `percentiles` nem `validIterations`

#### Scenario: Cultivar inalterada
- **WHEN** a cultivar da safra tem os mesmos valores do `cultivarSnapshot` da run em todas as chaves de `CultivarParams`
- **THEN** `cultivarChangedSinceRun` é `false`

#### Scenario: Cultivar alterada depois da run
- **WHEN** o técnico altera `kcMid` da cultivar depois da run
- **THEN** `GET .../msa` devolve `cultivarChangedSinceRun: true` e a run mantém o snapshot original

#### Scenario: Parâmetro novo entra na comparação
- **WHEN** `CultivarParams` ganha uma chave nova (ex.: `tUpper`) gravada no snapshot e só ela difere da cultivar atual
- **THEN** `cultivarChangedSinceRun` é `true` sem alteração na função de comparação

#### Scenario: Nunca processada
- **WHEN** a safra não tem run `SUCCEEDED`
- **THEN** `GET .../msa` responde 404 com `NO_MSA_RESULT`

#### Scenario: Série diária
- **WHEN** `GET .../msa/daily` é chamado sem `runId`
- **THEN** devolve uma linha por dia de `[dateFrom, dateTo]` da última run, com `date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw`

#### Scenario: Run de outra safra
- **WHEN** `runId` pertence a outra safra
- **THEN** a resposta é 404

#### Scenario: Produtor lê
- **WHEN** um `PRODUTOR` chama `GET .../msa`, `/daily` ou `/runs` de safra da própria propriedade
- **THEN** as respostas são 200

#### Scenario: Rotas de decisão removidas
- **WHEN** qualquer usuário chama `GET .../msa/decision`, `POST .../msa/decisions` ou `GET .../msa/decisions`
- **THEN** a resposta é 404

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
