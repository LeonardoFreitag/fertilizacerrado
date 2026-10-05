## ADDED Requirements

### Requirement: Processamento de uma safra
`POST /api/v1/harvests/:id/msa/process` SHALL executar o MSA para a safra (roles `AGRONOMO` e `ADMIN`, safra no escopo do usuário): carregar safra, talhão e cultivar; exigir `altitudeM` do talhão (422 `MISSING_FIELD_ALTITUDE`, sem criar run); usar `thetaFC`/`thetaWP` do talhão ou os defaults 0,28/0,12; definir o intervalo da emergência até o menor entre `hoje − 6` (UTC) e o dia em que o GDA acumulado atinge `gdaTotal`; verificar a cobertura da série e, havendo lacuna, gravar uma run `NEEDS_DATA` com `missingDates` sem calcular; caso contrário executar `runMonteCarlo` com 1.000 iterações e a semente informada (`?seed=`) ou gerada, e gravar run `SUCCEEDED`, série baseline e resumos por janela em uma transação, atualizando `latestRunId` da safra. Erro no cálculo MUST gravar run `FAILED` com a mensagem e responder 500 `MSA_PROCESSING_FAILED`. O sistema MUST NOT interpolar dias faltantes.

#### Scenario: Processamento bem-sucedido
- **WHEN** a safra tem talhão com altitude e série completa da emergência a hoje − 6
- **THEN** a resposta é 201 com a run `SUCCEEDED`, quatro resumos de janela, `seed`, `iterations = 1000`, `sigmaPrecip = 0.3`, `sigmaTemp = 0.6`, `engineVersion`, snapshots, e `latestRunId` da safra passa a ser a run

#### Scenario: Talhão sem altitude
- **WHEN** o talhão não tem `altitudeM`
- **THEN** a resposta é 422 com `MISSING_FIELD_ALTITUDE` e nenhuma run é criada

#### Scenario: Lacuna na série
- **WHEN** faltam os dias 2025-11-15 e 2025-11-16 entre a emergência e hoje − 6
- **THEN** a resposta é 200 com run `NEEDS_DATA`, `missingDates = ["2025-11-15", "2025-11-16"]`, sem resultados, e `latestRunId` não muda

#### Scenario: Ciclo encerrado antes de uma lacuna
- **WHEN** o GDA acumulado atinge `gdaTotal` em 2026-03-10 e faltam dias depois dessa data
- **THEN** a run é `SUCCEEDED` com `dateTo = 2026-03-10`

#### Scenario: Emergência dentro do lag
- **WHEN** a emergência é posterior a hoje − 6
- **THEN** a resposta é 200 com run `NEEDS_DATA` cobrindo o intervalo inteiro

#### Scenario: Solo com defaults
- **WHEN** o talhão não tem `thetaFC` e `thetaWP`
- **THEN** o `soilSnapshot` da run traz `thetaFC 0.28`, `thetaWP 0.12`, a altitude e `soilDefaults: true`

#### Scenario: Snapshot fiel
- **WHEN** a run é criada
- **THEN** `cultivarSnapshot` contém os 15 parâmetros científicos, `id`, `name` e `crop` da cultivar como estavam no momento, e o cálculo usou exatamente esses valores

#### Scenario: Reprodutibilidade
- **WHEN** a safra é processada duas vezes com a mesma semente e os mesmos dados
- **THEN** os resumos por janela e a série baseline das duas runs são idênticos

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
`GET /api/v1/harvests/:id/msa` SHALL devolver a última run `SUCCEEDED` com seus metadados, os quatro resumos de janela (valores do baseline, percentis P10/P50/P90 e `validIterations`) e `currentPhase`; 404 `NO_MSA_RESULT` se a safra não tem run `SUCCEEDED`. `GET .../msa/daily?runId=` SHALL devolver a série baseline da run (padrão: a última), 404 se a run não pertence à safra. `GET .../msa/runs` SHALL listar todas as runs da safra, mais recente primeiro, sem séries.

#### Scenario: Último resultado
- **WHEN** a safra tem runs `SUCCEEDED` e, depois, uma `NEEDS_DATA`
- **THEN** `GET .../msa` devolve a última `SUCCEEDED` e `GET .../msa/runs` lista ambas

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
- **WHEN** um `PRODUTOR` chama `GET .../msa`, `/daily`, `/runs` ou `/decisions` de safra da própria propriedade
- **THEN** as respostas são 200

### Requirement: Cenários de decisão sobre a última run
`GET /api/v1/harvests/:id/msa/decision?phase=&doseBase=&efficiencyBase=` SHALL gerar os cenários (a), (b) e (c) com `generateDecisionScenarios` usando o P50 do Ks médio da janela na última run `SUCCEEDED` e sua série baseline, sem persistir nada. Os três parâmetros MUST ser obrigatórios; `phase` em F1–F4. Janela sem `ksMean` na run MUST responder 422 `PHASE_NOT_REACHED`.

#### Scenario: Cenários para F3
- **WHEN** a última run tem `ksMean.p50 = 0,72` em F3 e a query traz `phase=F3&doseBase=100&efficiencyBase=0.6`
- **THEN** a resposta é 200 com `a.doseAdjusted = 72`, `c.efficiencyAdjusted = 0.432` e `b` calculado sobre F4 da série baseline (ou nulo com motivo)

#### Scenario: Janela não alcançada
- **WHEN** a run não tem dias em F4 e a query pede `phase=F4`
- **THEN** a resposta é 422 com `PHASE_NOT_REACHED`

#### Scenario: Parâmetro ausente
- **WHEN** `doseBase` não é informado
- **THEN** a resposta é 400 identificando `doseBase`

#### Scenario: Sem run
- **WHEN** a safra não tem run `SUCCEEDED`
- **THEN** a resposta é 404 com `NO_MSA_RESULT`

### Requirement: Registro da decisão do técnico
`POST /api/v1/harvests/:id/msa/decisions` (roles `AGRONOMO` e `ADMIN`) SHALL registrar a escolha com `phase`, `scenario` (`A`, `B` ou `C`), `doseBase`, `efficiencyBase`, `justification` e `runId` opcional (padrão: última run `SUCCEEDED`), recomputando os cenários para a run e gravando o payload do cenário escolhido tal como calculado. Cenário `B` indisponível para a janela MUST responder 422 `SCENARIO_UNAVAILABLE`. `GET .../msa/decisions` SHALL listar as decisões da safra, mais recente primeiro, com o payload, a run e quem decidiu.

#### Scenario: Registro do cenário A
- **WHEN** um `AGRONOMO` envia `phase F3`, `scenario A`, `doseBase 100`, `efficiencyBase 0.6` e uma justificativa
- **THEN** a resposta é 201 com `scenarioPayload.doseAdjusted` igual ao calculado, `runId` da última run e `decidedById` do agrônomo

#### Scenario: Cenário B indisponível
- **WHEN** a janela é F4 e `scenario = B`
- **THEN** a resposta é 422 com `SCENARIO_UNAVAILABLE` e nada é gravado

#### Scenario: Justificativa obrigatória
- **WHEN** `justification` está vazia
- **THEN** a resposta é 400 identificando `justification`

#### Scenario: Produtor tenta registrar
- **WHEN** um `PRODUTOR` chama `POST .../msa/decisions`
- **THEN** a resposta é 403

#### Scenario: Listagem
- **WHEN** a safra tem duas decisões
- **THEN** `GET .../msa/decisions` devolve as duas, mais recente primeiro, cada uma com `scenario`, `phase`, `scenarioPayload`, `justification`, `runId`, `decidedBy` resumido e `createdAt`

### Requirement: Versão do motor
O motor SHALL exportar `ENGINE_VERSION` (semver), gravada em toda run e devolvida em `GET .../msa`.

#### Scenario: Versão gravada
- **WHEN** uma run é criada
- **THEN** `engineVersion` é igual a `ENGINE_VERSION` do motor no momento
