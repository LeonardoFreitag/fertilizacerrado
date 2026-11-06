## MODIFIED Requirements

### Requirement: Graus-dia
`dailyGDA(tmax, tmin, tBase, tUpper?)` SHALL implementar o método de Ometto (1981) com temperatura-base inferior `tBase` (Tb) e superior opcional `tUpper` (TB), pelas cinco situações:
1. Tb < Tmin ≤ Tmax → (Tmax − Tmin)/2 + (Tmin − Tb)
2. Tmin < Tb < Tmax → (Tmax − Tb)² / [2 (Tmax − Tmin)]
3. Tb ≥ Tmax → 0
4. Tb < Tmin ≤ TB < Tmax → [2 (Tmax − Tmin)(Tmin − Tb) + (Tmax − Tmin)² − (Tmax − TB)²] / [2 (Tmax − Tmin)]
5. Tmin < Tb < TB < Tmax → ½ [(Tmax − Tb)² − (Tmax − TB)²] / (Tmax − Tmin)

Convenções: `tUpper` nulo ou omitido → só os casos 1–3; TB só atua quando Tmax > TB; Tmin ≥ TB → GD = TB − Tb (teto); Tmax = Tmin → sem divisão (caso 1 ou 3); o resultado MUST ficar em [0, TB − Tb] com TB e em [0, +∞) sem TB; Tmax < Tmin, valores não finitos ou `tUpper ≤ tBase` MUST lançar `RangeError`. `accumulateGDA(series, tBase, tUpper?)` SHALL devolver a soma acumulada dia a dia desde a emergência, com o mesmo tamanho da série, usando o mesmo método. Sem `tUpper` e com Tmin ≥ Tb o resultado MUST ser idêntico ao residual `(Tmax + Tmin)/2 − Tb`.

#### Scenario: Caso 1 — dia dentro das bases
- **WHEN** `tmax = 28`, `tmin = 18`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 13

#### Scenario: Caso 2 — mínima abaixo de Tb
- **WHEN** `tmax = 20`, `tmin = 6`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 3,571 (tolerância 1e-3)

#### Scenario: Caso 3 — dia frio
- **WHEN** `tmax = 8`, `tmin = 2`, `tBase = 10`
- **THEN** o GDA do dia é 0, nunca negativo

#### Scenario: Caso 4 — máxima acima de TB
- **WHEN** `tmax = 34`, `tmin = 20`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 16,43 (tolerância 1e-2), menor que os 17 do residual

#### Scenario: Caso 5 — mínima abaixo de Tb e máxima acima de TB
- **WHEN** `tmax = 34`, `tmin = 8`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 10,77 (tolerância 1e-2)

#### Scenario: Teto — mínima acima de TB
- **WHEN** `tmax = 32`, `tmin = 31`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 20 (TB − Tb)

#### Scenario: Máxima igual à mínima
- **WHEN** `tmax = 25`, `tmin = 25`, `tBase = 10`, `tUpper = 30`
- **THEN** o GDA do dia é 15, sem divisão por zero

#### Scenario: Bordas contínuas
- **WHEN** `tmin = tBase` (casos 1 e 2 coincidem) ou `tmax = tUpper` (casos 4 e 1 coincidem)
- **THEN** os dois ramos dão o mesmo valor (tolerância 1e-9)

#### Scenario: Regressão com o residual
- **WHEN** `tUpper` é nulo e `tmin ≥ tBase`
- **THEN** o GDA é `(tmax + tmin)/2 − tBase`, como no motor 2.0.0

#### Scenario: Entradas inválidas
- **WHEN** `tmax < tmin`, ou alguma temperatura é `NaN`, ou `tUpper ≤ tBase`
- **THEN** a função lança `RangeError`

#### Scenario: Acumulado
- **WHEN** a série tem GDA diário 15, 0, 12
- **THEN** o acumulado é 15, 15, 27

#### Scenario: Acumulado com TB
- **WHEN** a série tem três dias (34/20), (28/18), (34/8) com `tBase 10` e `tUpper 30`
- **THEN** o acumulado é 16,43; 29,43; 40,20 (tolerância 1e-2)

### Requirement: Invariantes com entradas aleatórias
Para cultivares, solos e séries válidos gerados pelo PRNG determinístico dos fixtures de teste (`mulberry32`/`uniform`, reexportados por `engine/test-fixtures.ts` a partir de `src/modules/msa/synthetic-season.ts`) com semente fixa, com `tUpper` nulo em parte dos casos e em `(tBase + 5, 45]` nos demais, o motor SHALL satisfazer: `0 ≤ ks ≤ 1`, `etcAdj ≤ etc`, `0 ≤ dr ≤ taw`, `zr` e `gdaAccum` não decrescentes, `et0 ≥ 0`, `0 ≤ yieldIndex ≤ 1` e, por dia, `0 ≤ gda ≤ tUpper − tBase` (ou `gda ≥ 0` sem `tUpper`). Nenhum arquivo de `engine/` MUST exportar um PRNG.

#### Scenario: 200 casos aleatórios
- **WHEN** 200 combinações válidas são geradas com semente fixa e o balanço, o resumo por janela e o índice do ciclo são executados
- **THEN** todas as linhas de todas as séries satisfazem os invariantes, inclusive o teto `tUpper − tBase` do GDA diário, e todos os índices ficam em [0, 1]

#### Scenario: Motor sem PRNG
- **WHEN** as exportações de `engine/index.ts` são inspecionadas
- **THEN** não existem `mulberry32`, `sampleNormal`, `uniform`, `runMonteCarlo`, `percentile` nem `generateDecisionScenarios`

### Requirement: Índice de produtividade do ciclo e produtividade predita
`cycleYieldIndex(summaries)` SHALL receber os quatro resumos de janela (`PhaseSummary[]`, F1–F4) e devolver `CycleYield { yieldIndex, phasesReached, factors }`, onde `factors[j] = 1 − yieldReductionPct_j / 100` para janela com `days > 0` e `1` para janela sem dias, `yieldIndex = Π_j factors[j]` (FAO-33, combinação multiplicativa dos estádios sucessivos; `docs/msa/algoritmos.md` §6) e `phasesReached` é o número de janelas com `days > 0` (0 a 4). `yieldIndex` MUST ficar em [0, 1]. `predictedYield(ym, yieldIndex)` SHALL devolver `ym × yieldIndex` e MUST lançar `RangeError` se `ym ≤ 0`, não finito, ou `yieldIndex` fora de [0, 1]. Ambas MUST ser puras, determinísticas e exportadas por `engine/index.ts`; `CycleYield` SHALL ser definido em `engine/types.ts`. `ENGINE_VERSION` SHALL ser `2.1.0` (graus-dia de Ometto mudam o resultado para a mesma entrada; interface compatível).

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
- **THEN** o valor é `2.1.0`
