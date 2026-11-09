## ADDED Requirements

### Requirement: Eventos de estresse hídrico
`detectStressEvents(series, cultivar, { ksThreshold, minDays })` (`engine/stress.ts`) SHALL percorrer a série em ordem considerando só dias de cultura (`phase` F1–F4; dias `PRE` e `COMPLETED` não contam nem conectam sequências) e devolver um `StressEvent` para cada sequência contígua de dias com `ks < ksThreshold` cuja duração seja `≥ minDays`, com `start`, `end` (AAAA-MM-DD), `days`, `ksMin`, `ksMean`, `deficitMm = Σ(etc − etcAdj)` dos dias do evento, `phases` (lista `{ phase, days }` das janelas atravessadas, em ordem), `dominantPhase` (janela com mais dias; empate resolvido pela de maior Ky da cultivar) e `kyDominant` (Ky dessa janela). Um evento que cruza a fronteira entre janelas MUST NOT ser dividido. `ksThreshold` fora de `(0, 1]` ou `minDays` não inteiro ou `< 1` MUST lançar `RangeError`. A função MUST ser pura e exportada por `engine/index.ts`; `StressEvent` SHALL estar em `engine/types.ts`.

#### Scenario: Sem estresse
- **WHEN** todos os dias têm `ks = 1`
- **THEN** a lista de eventos é vazia

#### Scenario: Evento em F3
- **WHEN** cinco dias consecutivos de F3 têm `ks 0,6` e os demais `ks 1`, com `ksThreshold 0,7` e `minDays 3`
- **THEN** há um evento com `days 5`, `dominantPhase F3`, `phases [{ F3, 5 }]`, `ksMin 0,6`, `ksMean 0,6` e `deficitMm` igual à soma de `etc − etcAdj` desses cinco dias

#### Scenario: Curto demais
- **WHEN** só dois dias consecutivos têm `ks < 0,7` e `minDays` é 3
- **THEN** nenhum evento é devolvido

#### Scenario: Evento que cruza a fronteira
- **WHEN** os últimos quatro dias de F2 e os três primeiros de F3 têm `ks 0,5`
- **THEN** há um único evento de 7 dias com `phases [{ F2, 4 }, { F3, 3 }]` e `dominantPhase F2`

#### Scenario: Empate resolvido pelo Ky
- **WHEN** um evento tem 3 dias em F2 (`kyF2 0,8`) e 3 em F3 (`kyF3 1,0`)
- **THEN** `dominantPhase` é `F3` e `kyDominant` é 1,0

#### Scenario: Entressafra não conta
- **WHEN** a série tem dias `PRE` com `ks 0,3` antes da emergência
- **THEN** esses dias não geram evento nem se juntam a um evento que comece em F1

#### Scenario: Parâmetros inválidos
- **WHEN** `ksThreshold` é 0, 1,2 ou `minDays` é 0 ou 2,5
- **THEN** a função lança `RangeError`

### Requirement: Atribuição da perda de produtividade por janela
`attributeYieldLoss(summaries, ym)` SHALL obter os fatores `f_j` de `cycleYieldIndex(summaries)` e devolver `YieldLossAttribution { ym, yieldIndex, predictedYield, totalLossScHa, totalLossPct, phases }`, com uma entrada por janela F1–F4 `{ phase, factor, lossPct, lossScHa }` em que `lossPct_j = (Π_{k<j} f_k) × (1 − f_j) × 100` e `lossScHa_j = ym × lossPct_j / 100`, de modo que `Σ_j lossScHa_j = ym − predictedYield` e `Σ_j lossPct_j = (1 − yieldIndex) × 100` (soma telescópica; `docs/msa/algoritmos.md` §6.5). Com `ym` nulo, `predictedYield`, `totalLossScHa` e cada `lossScHa` MUST ser nulos e os percentuais MUST continuar calculados. `ym` não nulo e `≤ 0` ou não finito MUST lançar `RangeError`. Janela não alcançada MUST ter `factor 1` e perdas 0.

#### Scenario: Exemplo canônico
- **WHEN** os resumos dão fatores `[1; 0,92; 0,80; 1]` e `ym = 65`
- **THEN** `lossScHa = [0; 5,2; 11,96; 0]`, `totalLossScHa = 17,16`, `predictedYield = 47,84` e `17,16 = 65 − 47,84` (tolerância 1e-9)

#### Scenario: Soma exata com quatro janelas estressadas
- **WHEN** os quatro fatores são menores que 1
- **THEN** a soma de `lossScHa` é igual a `ym − predictedYield` com tolerância 1e-9

#### Scenario: Sem produtividade potencial
- **WHEN** `ym` é nulo
- **THEN** `lossPct` de cada janela e `totalLossPct` são devolvidos e `lossScHa`, `totalLossScHa` e `predictedYield` são nulos

#### Scenario: Ym inválida
- **WHEN** `ym` é 0 ou `NaN`
- **THEN** a função lança `RangeError`

### Requirement: Severidade por perda e por Ks
O motor SHALL exportar `Severity = 'ok' | 'warning' | 'critical' | 'pending'`, `LOSS_WARNING_PCT = 5`, `LOSS_CRITICAL_PCT = 15`, `KS_OK = 0,85`, `KS_WARNING = 0,70`, `windowSeverity(yieldReductionPct)` (nulo → `pending`; `< 5` → `ok`; de 5 a 15 inclusive → `warning`; `> 15` → `critical`) e `daySeverity(ks)` (`≥ 0,85` → `ok`; `≥ 0,70` → `warning`; senão `critical`). A severidade da janela MUST ser por perda; a do dia, por Ks.

#### Scenario: Severidade da janela
- **WHEN** `yieldReductionPct` é 3, 10 e 20
- **THEN** as severidades são `ok`, `warning` e `critical`

#### Scenario: Janela não alcançada
- **WHEN** `yieldReductionPct` é nulo
- **THEN** a severidade é `pending`

#### Scenario: Severidade do dia
- **WHEN** `ks` é 0,9, 0,75 e 0,5
- **THEN** as severidades são `ok`, `warning` e `critical`

## MODIFIED Requirements

### Requirement: Índice de produtividade do ciclo e produtividade predita
`cycleYieldIndex(summaries)` SHALL receber os quatro resumos de janela (`PhaseSummary[]`, F1–F4) e devolver `CycleYield { yieldIndex, phasesReached, factors }`, onde `factors[j] = 1 − yieldReductionPct_j / 100` para janela com `days > 0` e `1` para janela sem dias, `yieldIndex = Π_j factors[j]` (FAO-33, combinação multiplicativa dos estádios sucessivos; `docs/msa/algoritmos.md` §6) e `phasesReached` é o número de janelas com `days > 0` (0 a 4). `yieldIndex` MUST ficar em [0, 1]. `predictedYield(ym, yieldIndex)` SHALL devolver `ym × yieldIndex` e MUST lançar `RangeError` se `ym ≤ 0`, não finito, ou `yieldIndex` fora de [0, 1]. Ambas MUST ser puras, determinísticas e exportadas por `engine/index.ts`; `CycleYield` SHALL ser definido em `engine/types.ts`. `ENGINE_VERSION` SHALL ser `2.3.0` (eventos de estresse, atribuição de perda e severidades gravados na run — superfície nova; os resultados numéricos de balanço, resumos e índice não mudam em relação a 2.2.0).

#### Scenario: Sem estresse
- **WHEN** as quatro janelas têm dias e `ksMean = 1`
- **THEN** `yieldIndex = 1`, `phasesReached = 4` e `factors = [1, 1, 1, 1]`

#### Scenario: Estresse só na floração
- **WHEN** F3 tem `ksMean 0,70` com `kyF3 1,0` (`yieldReductionPct 30`) e as demais janelas têm `ksMean = 1`
- **THEN** `yieldIndex = 0,70`

#### Scenario: Estresse em duas janelas
- **WHEN** F2 tem `ksMean 0,90` com `kyF2 0,8` e F3 tem `ksMean 0,80` com `kyF3 1,0`, F1 e F4 sem estresse
- **THEN** `factors = [1, 0,92, 0,80, 1]` e `yieldIndex = 0,736` (tolerância 1e-9)

#### Scenario: Janela não alcançada
- **WHEN** a série termina em F2 (F3 e F4 com `days = 0` e `yieldReductionPct` nulo)
- **THEN** `factors[2] = factors[3] = 1`, `phasesReached = 2` e `yieldIndex` é o produto de F1 e F2

#### Scenario: Produtividade predita
- **WHEN** `predictedYield(65, 0,736)` é avaliado
- **THEN** o resultado é 47,84 sc/ha (tolerância 1e-9)

#### Scenario: Entradas inválidas
- **WHEN** `predictedYield(0, 0,9)`, `predictedYield(65, 1,2)` ou `predictedYield(NaN, 0,9)` é avaliado
- **THEN** a função lança `RangeError`

#### Scenario: Versão do motor
- **WHEN** `ENGINE_VERSION` é lida
- **THEN** o valor é `2.3.0`
