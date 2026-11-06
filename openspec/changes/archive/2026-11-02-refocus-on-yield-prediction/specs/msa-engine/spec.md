## ADDED Requirements

### Requirement: Índice de produtividade do ciclo e produtividade predita
`cycleYieldIndex(summaries)` SHALL receber os quatro resumos de janela (`PhaseSummary[]`, F1–F4) e devolver `CycleYield { yieldIndex, phasesReached, factors }`, onde `factors[j] = 1 − yieldReductionPct_j / 100` para janela com `days > 0` e `1` para janela sem dias, `yieldIndex = Π_j factors[j]` (FAO-33, combinação multiplicativa dos estádios sucessivos; `docs/msa/algoritmos.md` §6) e `phasesReached` é o número de janelas com `days > 0` (0 a 4). `yieldIndex` MUST ficar em [0, 1]. `predictedYield(ym, yieldIndex)` SHALL devolver `ym × yieldIndex` e MUST lançar `RangeError` se `ym ≤ 0`, não finito, ou `yieldIndex` fora de [0, 1]. Ambas MUST ser puras, determinísticas e exportadas por `engine/index.ts`; `CycleYield` SHALL ser definido em `engine/types.ts`. `ENGINE_VERSION` SHALL ser `2.0.0`.

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
- **THEN** o valor é `2.0.0`

## MODIFIED Requirements

### Requirement: Invariantes com entradas aleatórias
Para cultivares, solos e séries válidos gerados pelo PRNG determinístico dos fixtures de teste (`mulberry32`/`uniform`, reexportados por `engine/test-fixtures.ts` a partir de `src/modules/msa/synthetic-season.ts`) com semente fixa, o motor SHALL satisfazer: `0 ≤ ks ≤ 1`, `etcAdj ≤ etc`, `0 ≤ dr ≤ taw`, `zr` e `gdaAccum` não decrescentes, `et0 ≥ 0` e `0 ≤ yieldIndex ≤ 1`. Nenhum arquivo de `engine/` MUST exportar um PRNG.

#### Scenario: 200 casos aleatórios
- **WHEN** 200 combinações válidas são geradas com semente fixa e o balanço, o resumo por janela e o índice do ciclo são executados
- **THEN** todas as linhas de todas as séries satisfazem os invariantes e todos os índices ficam em [0, 1]

#### Scenario: Motor sem PRNG
- **WHEN** as exportações de `engine/index.ts` são inspecionadas
- **THEN** não existem `mulberry32`, `sampleNormal`, `uniform`, `runMonteCarlo`, `percentile` nem `generateDecisionScenarios`

## REMOVED Requirements

### Requirement: PRNG determinístico e amostrador normal
**Reason**: O motor passa a ser determinístico; o PRNG só servia ao Monte Carlo. Os geradores de teste migram para `synthetic-season.ts`.
**Migration**: Testes e scripts que importavam `engine/random` passam a importar `engine/test-fixtures` (testes) ou `synthetic-season` (dados sintéticos). `random.ts` e `random.test.ts` são removidos.

### Requirement: Análise de Monte Carlo
**Reason**: O objetivo do MSA foi redefinido para predição determinística da produtividade (reunião com o professor Adilson); a faixa de incerteza fica para avaliação futura.
**Migration**: `monte-carlo.ts`, `monte-carlo.test.ts` e os tipos `MonteCarloOptions`, `MonteCarloResult`, `Percentiles`, `PhasePercentiles` são removidos. O processamento chama `runDailyBalance` + `summarizeByPhase` + `cycleYieldIndex`. Runs antigas são descartadas pela migration.

### Requirement: Cenários de decisão
**Reason**: A camada de suporte à decisão de adubação (cenários a/b/c) sai da Fase 1.
**Migration**: `decision.ts`, `decision.test.ts` e os tipos `DecisionInput`, `ScenarioA/B/C`, `DecisionScenarios` são removidos, junto com as rotas e a tabela de decisões (ver `msa-processing`).
