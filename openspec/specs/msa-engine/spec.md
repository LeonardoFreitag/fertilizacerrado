# msa-engine Specification

## Purpose

Biblioteca pura e determinística de cálculo agrometeorológico do MSA (versão 2.3.0, só soja): graus-dia pelo método de Ometto (1981) com temperatura-base inferior Tb e superior opcional TB (`tUpper`) e fenologia, ET₀ FAO-56 Penman-Monteith e auxiliares, Kc por fase, balanço hídrico diário com spin-up de entressafra (balanço desde o último 1º de fevereiro anterior à emergência, dias `PRE` sem cultura, depleção na emergência convertida para a zona radicular inicial — `engine/pre-season.ts`), redução de produtividade FAO-33 por janela, índice de produtividade do ciclo (produto multiplicativo das janelas), produtividade predita a partir da produtividade potencial, eventos de estresse hídrico, atribuição da perda de produtividade por janela e severidades por perda e por Ks (`engine/stress.ts`), com rastreabilidade por equação e reprodução dos exemplos do FAO-56. O motor não contém PRNG, Monte Carlo nem cenários de decisão.

## Requirements

### Requirement: Biblioteca pura e rastreável
O motor SHALL residir em `src/modules/msa/engine/` e ser exportado por `engine/index.ts`. Nenhum arquivo do motor MUST importar Prisma, Express, Redis, `env` ou qualquer módulo fora de `engine/`. Toda função exportada MUST ter JSDoc com a fonte bibliográfica e o número da equação (FAO-56, FAO-33 ou `docs/msa/algoritmos.md`). Os tipos `CultivarParams`, `SoilParams`, `DailyWeather`, `ET0Input`, `DailyBalanceRow` e `PhaseSummary` SHALL ser definidos em `engine/types.ts`, e `CultivarParams` MUST ser satisfeito estruturalmente por um registro `Cultivar` do Prisma.

#### Scenario: Importações do motor
- **WHEN** as importações dos arquivos de `engine/` são inspecionadas
- **THEN** nenhuma referencia `@prisma/client`, `express`, `ioredis`, `../../config` ou outro módulo fora de `engine/`

#### Scenario: Cultivar do banco como parâmetro
- **WHEN** um registro `Cultivar` retornado pelo Prisma é passado onde o motor espera `CultivarParams`
- **THEN** o código compila sem conversão

#### Scenario: Rastreabilidade
- **WHEN** uma função exportada do motor é lida
- **THEN** seu JSDoc cita a fonte e o número da equação implementada

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

### Requirement: Fenologia e profundidade radicular
`phaseFromGDA(gdaAccum, cultivar)` SHALL devolver `F1` para `gda < gdaF1End`, `F2` para `gdaF1End ≤ gda < gdaF2End`, `F3` para `gdaF2End ≤ gda < gdaF3End`, `F4` para `gdaF3End ≤ gda < gdaTotal` e `COMPLETED` para `gda ≥ gdaTotal`. `rootDepth(gdaAccum, cultivar)` SHALL variar linearmente de `zrIni` em GDA 0 a `zrMax` em `gdaF2End` e permanecer em `zrMax` depois.

#### Scenario: Limites exatos de transição
- **WHEN** a cultivar tem limiares 120/450/900 e total 1200
- **THEN** GDA 119,99 é `F1`, 120 é `F2`, 449,99 é `F2`, 450 é `F3`, 899,99 é `F3`, 900 é `F4`, 1199,99 é `F4` e 1200 é `COMPLETED`

#### Scenario: Zr nos extremos
- **WHEN** `zrIni = 0,30`, `zrMax = 0,95`, `gdaF2End = 450`
- **THEN** Zr é 0,30 em GDA 0, 0,625 em GDA 225, 0,95 em GDA 450 e 0,95 em GDA 1000

#### Scenario: Zr nunca decresce
- **WHEN** o GDA acumulado cresce ao longo de uma série
- **THEN** a sequência de Zr é não decrescente

### Requirement: Evapotranspiração de referência FAO-56
`referenceET0(input)` SHALL implementar a Eq. 6 do FAO-56 com `G = 0` (Eq. 42) a partir de `{ tmax, tmin, tmean?, tdew, u2, rn, altitude }`, usando `tmean = (tmax + tmin) / 2` quando omitido. As auxiliares SHALL ser exportadas separadamente: `atmosphericPressure` (Eq. 7), `psychrometricConstant` (Eq. 8), `saturationVapourPressure` (Eq. 11), `meanSaturationVapourPressure` (Eq. 12), `slopeVapourPressureCurve` (Eq. 13), `actualVapourPressureFromDewpoint` (Eq. 14), `actualVapourPressureFromPsychrometer` (Eq. 15), `actualVapourPressureFromRH` (Eq. 17), `actualVapourPressureFromMeanRH` (Eq. 19), `dewpointFromVapourPressure` (inversa da Eq. 14), `windSpeedAt2m` (Eq. 47), `extraterrestrialRadiation` (Eq. 21), `daylightHours` (Eq. 34), `solarRadiationFromSunshine` (Eq. 35), `clearSkyRadiation` (Eq. 37), `netShortwaveRadiation` (Eq. 38), `netLongwaveRadiation` (Eq. 39) e `netRadiationFromSolar` (Eq. 37–40).

#### Scenario: Exemplo 18 do FAO-56 (Bruxelas, 6 de julho)
- **WHEN** Tmax 21,5 °C, Tmin 12,3 °C, RHmax 84 %, RHmin 63 %, vento 2,78 m/s a 10 m, n 9,25 h, latitude 50,80° N, altitude 100 m, dia juliano 187
- **THEN** ET₀ fica em 3,9 ± 0,1 mm/dia, e os intermediários ficam dentro de 1 % (ou 0,01) de: u2 2,078; P 100,1; Δ 0,122; γ 0,0666; es 1,997; ea 1,409; Ra 41,09; N 16,1; Rs 22,07; Rso 30,90; Rns 17,00; Rnl 3,71; Rn 13,28

#### Scenario: Exemplo 17 do FAO-56 (Bangkok, abril)
- **WHEN** Tmax 34,8 °C, Tmin 25,6 °C, ea 2,85 kPa, u2 2,0 m/s, n 8,5 h, latitude 13,73° N, altitude 2 m, dia juliano 105
- **THEN** ET₀ fica em 5,72 ± 0,1 mm/dia (com G = 0), e os intermediários ficam dentro de 1 % (ou 0,01) de: Δ 0,246; γ 0,0674; es 4,42; Ra 38,06; N 12,31; Rs 22,65; Rso 28,54; Rns 17,44; Rnl 3,11; Rn 14,33

#### Scenario: Exemplos 2 e 3 do capítulo 3
- **WHEN** z = 1800 m; e Tmax 24,5 °C, Tmin 15 °C
- **THEN** P ≈ 81,8 kPa e γ ≈ 0,054; e°(Tmax) ≈ 3,075, e°(Tmin) ≈ 1,705, es ≈ 2,39 kPa

#### Scenario: Exemplos 4 e 5 do capítulo 3
- **WHEN** z = 1200 m, Tdry 25,6 °C, Twet 19,5 °C (psicrômetro aspirado); e Tmin 18 °C, RHmax 82 %, Tmax 25 °C, RHmin 54 %
- **THEN** ea ≈ 1,91 kPa; e ea ≈ 1,70 kPa

#### Scenario: Fator de vento a 10 m
- **WHEN** `windSpeedAt2m(u10, 10)` é avaliado
- **THEN** o resultado é `u10 × 0,748` com erro inferior a 0,001

#### Scenario: Ponto de orvalho e vapor são inversos
- **WHEN** `ea` é calculado de `tdew` e `tdew` é recalculado de `ea`
- **THEN** o `tdew` recuperado difere do original em menos de 0,01 °C

#### Scenario: tmean omitido
- **WHEN** `tmean` não é informado
- **THEN** o resultado é igual ao obtido com `tmean = (tmax + tmin) / 2`

### Requirement: Coeficiente de cultura por fase
`kcForPhase(phase, gdaAccum, cultivar)` SHALL devolver `kcIni` em F1, interpolação linear de `kcIni` a `kcMid` sobre `[gdaF1End, gdaF2End]` em F2, `kcMid` em F3, interpolação linear de `kcMid` a `kcEnd` sobre `[gdaF3End, gdaTotal]` em F4 e `kcEnd` em `COMPLETED`.

#### Scenario: Continuidade nas transições
- **WHEN** Kc é avaliado imediatamente antes e exatamente em `gdaF1End`, `gdaF2End`, `gdaF3End` e `gdaTotal`
- **THEN** a diferença entre os dois valores é inferior a 1e-6 em cada transição

#### Scenario: Ponto médio de F2
- **WHEN** `kcIni = 0,20`, `kcMid = 1,15` e o GDA está no meio de `[gdaF1End, gdaF2End]`
- **THEN** Kc é 0,675

#### Scenario: Fases constantes
- **WHEN** o GDA varia dentro de F1 ou dentro de F3
- **THEN** Kc permanece `kcIni` ou `kcMid`, respectivamente

### Requirement: Balanço hídrico diário
`totalAvailableWater(thetaFC, thetaWP, zr)` SHALL devolver `1000 · (thetaFC − thetaWP) · zr` (Eq. 82); `readilyAvailableWater(p, taw)` SHALL devolver `p · taw` (Eq. 83); `stressCoefficient(dr, taw, raw)` SHALL devolver 1 se `dr ≤ raw`, `(taw − dr)/(taw − raw)` se `raw < dr ≤ taw`, 0 se `dr > taw` (Eq. 84), sempre em `[0, 1]`. `runDailyBalance(days, cultivar, soil, { altitude, initialDepletion = 0, preSeason? })` SHALL devolver uma linha por dia com `date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw`, calculando `ks` com a depleção do início do dia e `dr = clamp(drAnterior − P + etcAdj, 0, taw)`, com TAW recalculado pelo Zr do dia sem alterar a depleção. Com `preSeason = { until, kc, zr }`, os dias com `date < until` SHALL ser de entressafra: `phase = 'PRE'`, `gda = 0`, `gdaAccum = 0`, `zr = preSeason.zr`, `kc = preSeason.kc`, TAW/RAW/Ks/ET₀/ETc/Dr como nos demais dias; no primeiro dia com `date ≥ until`, antes de qualquer cálculo, a depleção MUST ser convertida por `convertDepletion(dr, TAW(preSeason.zr), TAW(zrIni))`; `initialDepletion` vale para o primeiro dia da série (o início do spin-up quando há `preSeason`). `preSeason.until` inválido, `kc ≤ 0` ou `zr ≤ 0` MUST lançar `RangeError`; sem dias anteriores a `until` o resultado MUST ser idêntico ao de uma chamada sem `preSeason`. A função MUST ser determinística e MUST NOT alocar estruturas intermediárias por dia além da linha de saída.

#### Scenario: Sem estresse até RAW
- **WHEN** a depleção do início do dia é menor ou igual a RAW
- **THEN** `ks = 1` e `etcAdj = etc`

#### Scenario: Estresse máximo
- **WHEN** a depleção do início do dia é igual a TAW
- **THEN** `ks = 0` e `etcAdj = 0`

#### Scenario: Depleção limitada
- **WHEN** a série tem dias sem chuva e alta demanda, e dias de chuva muito acima da depleção
- **THEN** em nenhum dia `dr` é negativo ou maior que `taw`, e no dia de chuva excedente `dr` é 0

#### Scenario: Dia de estresse previsto analiticamente
- **WHEN** uma série constante sem chuva tem ETc diária `e`, `initialDepletion = 0`, RAW `r` e a fase não muda
- **THEN** o primeiro dia com `ks < 1` é o dia `floor(r / e) + 2` (primeiro dia cuja depleção inicial excede RAW)

#### Scenario: Raiz aprofunda
- **WHEN** Zr aumenta de um dia para o outro
- **THEN** `taw` e `raw` aumentam e `dr` do início do dia é o mesmo do fim do dia anterior

#### Scenario: Spin-up seco
- **WHEN** `preSeason = { until: dia 11, kc: 1, zr: 0,95 }`, solo 0,28/0,12 (TAW 152, RAW 76), dez dias sem chuva com ET₀ 5 mm
- **THEN** os dez primeiros dias têm `phase PRE`, `gda 0`, `gdaAccum 0`, `zr 0,95`, `kc 1`; `dr` cresce 5 mm/dia enquanto `dr ≤ RAW` e menos de 5 mm/dia depois

#### Scenario: Chuva no fim do spin-up
- **WHEN** o último dia de entressafra recebe 80 mm com `dr` abaixo de 80 mm
- **THEN** `dr` desse dia é 0 e a depleção convertida na emergência é 0

#### Scenario: Conversão na emergência
- **WHEN** o último dia `PRE` termina com `dr 120` sobre Zr 0,95 m (TAW 152) e `zrIni = 0,30` (TAW 48)
- **THEN** o primeiro dia de cultura começa com depleção 37,9 mm (`ks` desse dia calculado com 37,9) e `phase F1`

#### Scenario: Spin-up vazio
- **WHEN** `preSeason.until` é igual ou anterior à primeira data da série
- **THEN** nenhuma linha é `PRE` e a saída é idêntica à de `runDailyBalance` sem `preSeason`

#### Scenario: Determinismo
- **WHEN** `runDailyBalance` é executado duas vezes com a mesma entrada
- **THEN** as séries de saída são idênticas

#### Scenario: Entrada inválida
- **WHEN** algum dia tem `precipitation` ou temperatura `NaN`, ou `preSeason.kc` é 0
- **THEN** a função lança `RangeError` indicando o índice do dia ou o parâmetro

### Requirement: Redução de produtividade e resumo por janela
`yieldReduction(ksMean, ky)` SHALL devolver `ky · (1 − ksMean)` limitado a `[0, 1]` (FAO-33). `summarizeByPhase(series, cultivar)` SHALL devolver quatro entradas, F1 a F4, com `phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct`, ignorando dias `PRE` e `COMPLETED`; janela sem dias MUST ter `days = 0` e `ksMean` e `yieldReductionPct` nulos.

#### Scenario: Sem estresse
- **WHEN** `ksMean = 1`
- **THEN** a redução é 0 para qualquer Ky

#### Scenario: Estresse em floração
- **WHEN** `ksMean = 0,7` e `ky = 1,0`
- **THEN** a redução é 0,3 (30 %)

#### Scenario: Resumo por janela
- **WHEN** a série cobre F1 a F3 e não alcança F4
- **THEN** F1–F3 trazem dias, `ksMean` médio, somas de `etcAdj` e precipitação e `yieldReductionPct = ky_j · (1 − ksMean_j) · 100`; F4 traz `days = 0` e valores nulos

#### Scenario: Entressafra ignorada
- **WHEN** a série tem 200 dias `PRE` antes de F1
- **THEN** os resumos de F1–F4 e `cycleYieldIndex` são iguais aos obtidos com a série sem os dias `PRE` e a mesma depleção inicial na emergência

### Requirement: Invariantes com entradas aleatórias
Para cultivares, solos e séries válidos gerados pelo PRNG determinístico dos fixtures de teste (`mulberry32`/`uniform`, reexportados por `engine/test-fixtures.ts` a partir de `src/modules/msa/synthetic-season.ts`) com semente fixa, com `tUpper` nulo em parte dos casos e em `(tBase + 5, 45]` nos demais, o motor SHALL satisfazer: `0 ≤ ks ≤ 1`, `etcAdj ≤ etc`, `0 ≤ dr ≤ taw`, `zr` e `gdaAccum` não decrescentes, `et0 ≥ 0`, `0 ≤ yieldIndex ≤ 1` e, por dia, `0 ≤ gda ≤ tUpper − tBase` (ou `gda ≥ 0` sem `tUpper`). Nenhum arquivo de `engine/` MUST exportar um PRNG.

#### Scenario: 200 casos aleatórios
- **WHEN** 200 combinações válidas são geradas com semente fixa e o balanço, o resumo por janela e o índice do ciclo são executados
- **THEN** todas as linhas de todas as séries satisfazem os invariantes, inclusive o teto `tUpper − tBase` do GDA diário, e todos os índices ficam em [0, 1]

#### Scenario: Motor sem PRNG
- **WHEN** as exportações de `engine/index.ts` são inspecionadas
- **THEN** não existem `mulberry32`, `sampleNormal`, `uniform`, `runMonteCarlo`, `percentile` nem `generateDecisionScenarios`

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

### Requirement: Entressafra e depleção na emergência
`engine/pre-season.ts` SHALL exportar `preSeasonStart(emergenceDate)` — o último 1º de fevereiro menor ou igual à emergência (`AAAA-MM-DD`) —, `convertDepletion(drPre, tawPre, tawIni) = drPre × tawIni / tawPre` (hipótese de umidade uniforme no perfil; `docs/msa/algoritmos.md` §5) e `PRE_SEASON_DEFAULTS = { kc: 1.0 }`. `Phase` SHALL incluir `'PRE'` (dia de entressafra, sem cultura) e `CropPhase = Exclude<Phase, 'PRE'>`; `phaseFromGDA` MUST NOT devolver `PRE`; `kcForPhase` e `rootDepth` SHALL aceitar só `CropPhase` (em runtime, `kcForPhase('PRE', …)` lança `RangeError`); `YIELD_PHASES` permanece F1–F4. `ENGINE_VERSION` SHALL ser `2.2.0`.

#### Scenario: Início do spin-up
- **WHEN** `preSeasonStart` recebe `2026-10-20`, `2027-01-15` e `2027-02-01`
- **THEN** devolve `2026-02-01`, `2026-02-01` e `2027-02-01`, respectivamente

#### Scenario: Conversão por proporção
- **WHEN** `convertDepletion(120, 152, 48)` é avaliado (Dr 120 mm sobre TAW 152 mm de Zr 0,95 m; TAW 48 mm de Zr 0,30 m)
- **THEN** o resultado é 37,9 mm (tolerância 0,05), 79 % de 48 mm

#### Scenario: Entradas inválidas
- **WHEN** `preSeasonStart('2026-13-01')`, `convertDepletion(120, 0, 48)` ou `convertDepletion(-1, 152, 48)` é avaliado
- **THEN** a função lança `RangeError`

#### Scenario: Versão do motor
- **WHEN** `ENGINE_VERSION` é lida
- **THEN** o valor é `2.2.0`
