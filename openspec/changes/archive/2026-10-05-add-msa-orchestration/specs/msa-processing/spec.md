## MODIFIED Requirements

### Requirement: Processamento de uma safra
`POST /api/v1/harvests/:id/msa/process` (roles `AGRONOMO` e `ADMIN`, safra no escopo do usuário) SHALL por padrão enfileirar um job `msa-process {harvestId, seed?, reason: "MANUAL"}` e responder 202 com `jobId` e `queue`. Com `?sync=true`, restrito a `ADMIN` (403 `SYNC_ADMIN_ONLY` para os demais), SHALL executar inline: carregar safra, talhão e cultivar; exigir `altitudeM` do talhão (422 `MISSING_FIELD_ALTITUDE`, sem criar run); usar `thetaFC`/`thetaWP` do talhão ou os defaults 0,28/0,12; definir o intervalo da emergência até o menor entre `hoje − 6` (UTC) e o dia em que o GDA acumulado atinge `gdaTotal`; verificar a cobertura da série e, havendo lacuna, gravar uma run `NEEDS_DATA` com `missingDates` sem calcular; caso contrário executar `runMonteCarlo` com 1.000 iterações e a semente informada (`?seed=`) ou gerada, e gravar run `SUCCEEDED`, série baseline e resumos por janela em uma transação, atualizando `latestRunId` da safra. O worker executa a mesma lógica para jobs da fila, com `triggeredById` nulo. Toda run MUST registrar `reason` (`WEEKLY`, `BACKFILL` ou `MANUAL`) e, quando vinda da fila, `jobId`. Erro no cálculo MUST gravar run `FAILED` com a mensagem e, no modo inline, responder 500 `MSA_PROCESSING_FAILED`. O sistema MUST NOT interpolar dias faltantes.

#### Scenario: Enfileiramento padrão
- **WHEN** um `AGRONOMO` chama `POST .../msa/process`
- **THEN** a resposta é 202 com `jobId`, `queue: "msa-process"` e, após o worker processar, `GET .../msa` devolve a run com `reason MANUAL` e esse `jobId`

#### Scenario: Sync restrito a administrador
- **WHEN** um `AGRONOMO` chama `POST .../msa/process?sync=true`
- **THEN** a resposta é 403 com `SYNC_ADMIN_ONLY`

#### Scenario: Processamento síncrono bem-sucedido
- **WHEN** um `ADMIN` chama `POST .../msa/process?sync=true` para safra com talhão com altitude e série completa da emergência a hoje − 6
- **THEN** a resposta é 201 com a run `SUCCEEDED`, `reason MANUAL`, quatro resumos de janela, `seed`, `iterations = 1000`, `sigmaPrecip = 0.3`, `sigmaTemp = 0.6`, `engineVersion`, snapshots, e `latestRunId` da safra passa a ser a run

#### Scenario: Talhão sem altitude
- **WHEN** o talhão não tem `altitudeM` e o processamento roda (inline ou pelo worker)
- **THEN** inline a resposta é 422 com `MISSING_FIELD_ALTITUDE` e nenhuma run é criada; pelo worker o job falha com essa mensagem e nenhuma run é criada

#### Scenario: Lacuna na série
- **WHEN** faltam os dias 2025-11-15 e 2025-11-16 entre a emergência e hoje − 6
- **THEN** inline a resposta é 200 com run `NEEDS_DATA`, `missingDates = ["2025-11-15", "2025-11-16"]`, sem resultados, e `latestRunId` não muda

#### Scenario: Ciclo encerrado antes de uma lacuna
- **WHEN** o GDA acumulado atinge `gdaTotal` em 2026-03-10 e faltam dias depois dessa data
- **THEN** a run é `SUCCEEDED` com `dateTo = 2026-03-10`

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
