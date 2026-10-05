## ADDED Requirements

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
