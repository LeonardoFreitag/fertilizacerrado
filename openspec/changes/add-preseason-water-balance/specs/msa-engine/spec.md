## ADDED Requirements

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

## MODIFIED Requirements

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
