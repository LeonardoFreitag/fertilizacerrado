# msa-engine Specification

## Purpose

Biblioteca pura de cálculo agrometeorológico do MSA: graus-dia e fenologia, ET₀ FAO-56 Penman-Monteith e auxiliares, Kc por fase, balanço hídrico diário e redução de produtividade FAO-33, com rastreabilidade por equação e reprodução dos exemplos do FAO-56.

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
`dailyGDA(tmax, tmin, tBase)` SHALL devolver `max((tmax + tmin) / 2 − tBase, 0)`. `accumulateGDA(series, tBase)` SHALL devolver a soma acumulada dia a dia desde a emergência, com o mesmo tamanho da série.

#### Scenario: Dia acima da base
- **WHEN** `tmax = 30`, `tmin = 20`, `tBase = 10`
- **THEN** o GDA do dia é 15

#### Scenario: Dia frio
- **WHEN** `(tmax + tmin) / 2` é menor que `tBase`
- **THEN** o GDA do dia é 0, nunca negativo

#### Scenario: Acumulado
- **WHEN** a série tem GDA diário 15, 0, 12
- **THEN** o acumulado é 15, 15, 27

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
`totalAvailableWater(thetaFC, thetaWP, zr)` SHALL devolver `1000 · (thetaFC − thetaWP) · zr` (Eq. 82); `readilyAvailableWater(p, taw)` SHALL devolver `p · taw` (Eq. 83); `stressCoefficient(dr, taw, raw)` SHALL devolver 1 se `dr ≤ raw`, `(taw − dr)/(taw − raw)` se `raw < dr ≤ taw`, 0 se `dr > taw` (Eq. 84), sempre em `[0, 1]`. `runDailyBalance(days, cultivar, soil, { altitude, initialDepletion = 0 })` SHALL devolver uma linha por dia com `date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw`, calculando `ks` com a depleção do início do dia e `dr = clamp(drAnterior − P + etcAdj, 0, taw)`, com TAW recalculado pelo Zr do dia sem alterar a depleção. A função MUST ser determinística e MUST NOT alocar estruturas intermediárias por dia além da linha de saída.

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

#### Scenario: Determinismo
- **WHEN** `runDailyBalance` é executado duas vezes com a mesma entrada
- **THEN** as séries de saída são idênticas

#### Scenario: Entrada inválida
- **WHEN** algum dia tem `precipitation` ou temperatura `NaN`
- **THEN** a função lança `RangeError` indicando o índice do dia

### Requirement: Redução de produtividade e resumo por janela
`yieldReduction(ksMean, ky)` SHALL devolver `ky · (1 − ksMean)` limitado a `[0, 1]` (FAO-33). `summarizeByPhase(series, cultivar)` SHALL devolver quatro entradas, F1 a F4, com `phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct`, ignorando dias `COMPLETED`; janela sem dias MUST ter `days = 0` e `ksMean` e `yieldReductionPct` nulos.

#### Scenario: Sem estresse
- **WHEN** `ksMean = 1`
- **THEN** a redução é 0 para qualquer Ky

#### Scenario: Estresse em floração
- **WHEN** `ksMean = 0,7` e `ky = 1,0`
- **THEN** a redução é 0,3 (30 %)

#### Scenario: Resumo por janela
- **WHEN** a série cobre F1 a F3 e não alcança F4
- **THEN** F1–F3 trazem dias, `ksMean` médio, somas de `etcAdj` e precipitação e `yieldReductionPct = ky_j · (1 − ksMean_j) · 100`; F4 traz `days = 0` e valores nulos

### Requirement: Invariantes com entradas aleatórias
Para cultivares, solos e séries válidos gerados por um PRNG determinístico com semente fixa, o motor SHALL satisfazer: `0 ≤ ks ≤ 1`, `etcAdj ≤ etc`, `0 ≤ dr ≤ taw`, `zr` e `gdaAccum` não decrescentes e `et0 ≥ 0`.

#### Scenario: 200 casos aleatórios
- **WHEN** 200 combinações válidas são geradas com semente fixa e o balanço é executado
- **THEN** todas as linhas de todas as séries satisfazem os invariantes

### Requirement: PRNG determinístico e amostrador normal
`engine/random.ts` SHALL exportar `mulberry32(seed)` (uniforme em [0, 1)), `uniform(rand, min, max)` e `sampleNormal(rand, mean = 0, sd = 1)` por Box-Muller sem estado além do PRNG. A mesma semente MUST produzir a mesma sequência em qualquer execução. `sampleNormal` MUST NOT chamar `ln(0)`.

#### Scenario: Mesma semente, mesma sequência
- **WHEN** dois geradores são criados com a semente 42 e sorteiam 1.000 valores cada
- **THEN** as duas sequências são idênticas

#### Scenario: Sementes diferentes
- **WHEN** dois geradores são criados com sementes diferentes
- **THEN** os primeiros 10 valores diferem em ao menos uma posição

#### Scenario: Média e desvio do amostrador
- **WHEN** 100.000 valores são sorteados de N(0, 1) e de N(1, 0,3)
- **THEN** a média fica a menos de 0,01 da esperada e o desvio-padrão a menos de 1 % do esperado

#### Scenario: Valores finitos
- **WHEN** 1.000.000 de valores são sorteados de N(0, 1)
- **THEN** todos são finitos

### Requirement: Análise de Monte Carlo
`runMonteCarlo(days, cultivar, soil, options)` SHALL executar `options.iterations` (padrão 1.000) iterações em que, por iteração, sorteia uma vez `f_i ~ N(1, sigmaPrecip²)` truncado em ≥ 0 e uma vez `δ_i ~ N(0, sigmaTemp²)`, multiplica a precipitação de toda a série por `f_i`, soma `δ_i` a `tmax`, `tmin` e `tmean` de toda a série, mantém `tdew` e `rn`, e calcula `runDailyBalance` e `summarizeByPhase`. SHALL devolver, por janela F1–F4, `validIterations` e os percentis P10/P50/P90 (tipo 7, interpolação linear) de `ksMean`, `yieldReductionPct` e `etcAdjAccum` calculados só sobre as iterações em que a janela teve dias, além de `baseline`, `baselineSeries`, `iterations`, `seed`, `sigmaPrecip` e `sigmaTemp`. `seed` MUST ser obrigatório; `iterations` MUST ser inteiro ≥ 1 e os sigmas ≥ 0.

#### Scenario: Determinismo
- **WHEN** `runMonteCarlo` é executado duas vezes com a mesma entrada e a mesma semente
- **THEN** os resultados são idênticos

#### Scenario: Sementes diferentes
- **WHEN** `runMonteCarlo` é executado com sementes diferentes
- **THEN** ao menos um percentil difere entre os resultados

#### Scenario: Sem perturbação
- **WHEN** `sigmaPrecip = 0` e `sigmaTemp = 0`
- **THEN** P10, P50 e P90 de cada métrica são iguais ao valor do baseline em todas as janelas com dias

#### Scenario: Ordem dos percentis e faixa de Ks
- **WHEN** 1.000 iterações são executadas com os sigmas padrão
- **THEN** em toda janela com `validIterations > 0`, `p10 ≤ p50 ≤ p90` para as três métricas e os percentis de `ksMean` estão em [0, 1]

#### Scenario: Fator de precipitação truncado
- **WHEN** o fator `f_i` sorteado é negativo
- **THEN** a precipitação perturbada é zero, nunca negativa

#### Scenario: Janela não alcançada em algumas iterações
- **WHEN** a série termina perto do limiar de F4 e `δ_i` negativo impede algumas iterações de alcançá-la
- **THEN** `validIterations` de F4 é menor que `iterations`, os percentis de F4 são calculados só sobre as válidas, e as demais janelas têm `validIterations = iterations`

#### Scenario: Janela nunca alcançada
- **WHEN** a série é curta e nenhuma iteração alcança F3
- **THEN** F3 e F4 têm `validIterations = 0` e percentis `null`

#### Scenario: Percentil tipo 7
- **WHEN** os valores ordenados são [1, 2, 3, 4]
- **THEN** P10 = 1,3, P50 = 2,5 e P90 = 3,7

#### Scenario: Opções inválidas
- **WHEN** `iterations` é 0 ou 2,5, ou `sigmaPrecip` é negativo, ou `seed` não é informado
- **THEN** a função lança `RangeError`

#### Scenario: Desempenho
- **WHEN** 1.000 iterações são executadas sobre uma safra de 150 dias
- **THEN** a execução termina em menos de 2 segundos

#### Scenario: Convergência (Caso 3)
- **WHEN** a série sintética de referência de 150 dias é executada com 500 e com 1.000 iterações e a mesma semente
- **THEN** |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ de `ksMean` é menor que 0,5 % em toda janela com dias

### Requirement: Cenários de decisão
`generateDecisionScenarios({ phase, ksP50, baselineSeries, cultivar, doseBase, efficiencyBase })` SHALL devolver `a` com `doseAdjusted = doseBase · ksP50` e `reductionPct`, `c` com `efficiencyAdjusted = efficiencyBase · ksP50`, e `b` com o parcelamento da janela seguinte à informada: os dias dessa janela na `baselineSeries` são divididos em duas metades consecutivas (a primeira com `ceil(n/2)` dias), `fraction1 = ΣETc₁ / (ΣETc₁ + ΣETc₂)` usando ETc, `dose1 = doseBase · fraction1`, `dose2 = doseBase · (1 − fraction1)`. Quando não há janela seguinte (F4), ou a série baseline não a alcança com ao menos 2 dias, `b` MUST ser `null` e `bUnavailableReason` MUST explicar. Cada cenário MUST trazer `rationale` descritivo, sem recomendação. `ksP50` fora de [0, 1], doses ou eficiências negativas MUST lançar `RangeError`.

#### Scenario: Proporcionalidade de (a) e (c)
- **WHEN** `ksP50 = 0,72`, `doseBase = 100` e `efficiencyBase = 0,6`
- **THEN** `a.doseAdjusted = 72`, `a.reductionPct = 28` e `c.efficiencyAdjusted = 0,432`

#### Scenario: Sem estresse
- **WHEN** `ksP50 = 1`
- **THEN** `a.doseAdjusted = doseBase` e `c.efficiencyAdjusted = efficiencyBase`

#### Scenario: Parcelamento soma a dose
- **WHEN** `phase = F2` e a série baseline cobre F3 com ao menos 2 dias
- **THEN** `b.nextPhase = F3`, `b.dose1 + b.dose2 = doseBase`, `b.fraction1 + b.fraction2 = 1`, `b.days1 = ceil(n/2)` e `b.days2 = n − b.days1`

#### Scenario: Metades com mesma ETc
- **WHEN** a ETc é constante em toda a janela seguinte e `n` é par
- **THEN** `b.fraction1 = 0,5`

#### Scenario: Última janela
- **WHEN** `phase = F4`
- **THEN** `b` é `null` e `bUnavailableReason` indica que não há janela seguinte

#### Scenario: Série não alcança a janela seguinte
- **WHEN** `phase = F3` e a série baseline não tem dias em F4
- **THEN** `b` é `null` e `bUnavailableReason` indica que a série não alcança F4

#### Scenario: Racional sem recomendação
- **WHEN** qualquer cenário é gerado
- **THEN** `rationale` descreve o cálculo e não contém "recomenda"

#### Scenario: Entradas inválidas
- **WHEN** `ksP50 = 1,2`, ou `doseBase = −10`, ou `phase = COMPLETED`
- **THEN** a função lança `RangeError`
