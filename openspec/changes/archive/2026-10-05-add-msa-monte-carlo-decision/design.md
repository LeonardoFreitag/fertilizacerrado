## Context

`engine/` tem `runDailyBalance` (determinístico, um laço) e `summarizeByPhase` (F1–F4 com `ksMean`, `etcAdjAccum`, `precipAccum`, `yieldReductionPct`). `algoritmos.md` §7 define o Monte Carlo (1.000 iterações, εP ~ N(0; 0,30²) multiplicativo na chuva, εT ~ N(0; 0,6²) aditivo na temperatura, P10/P50/P90 de Ks̄ por janela) e §8 os três cenários a partir do P50 da janela. `validacao.md` Caso 3 exige |P50(500) − P50(1000)| < 0,5 %. O PRNG mulberry32 já existe em `test-fixtures.ts`.

## Goals / Non-Goals

**Goals:**

- Reprodutibilidade total: mesma semente e mesma entrada ⇒ resultado bit a bit idêntico, em qualquer máquina.
- Monte Carlo como função pura sobre o motor existente, sem reimplementar balanço ou resumo.
- 1.000 iterações de uma safra de ~150 dias em menos de 2 s em um núcleo.
- Cenários de decisão com números rastreáveis à série baseline e ao P50, sem juízo de valor embutido.
- Ferramenta para o Caso 3 rodar hoje, inclusive sem dados ERA5 (série sintética).

**Non-Goals:**

- Persistir ou expor resultados; agendar jobs.
- Perturbar outras variáveis (Rn, u2, Tdew) ou modelar correlação chuva–temperatura.
- Teste de normalidade (Shapiro-Wilk) — pertence ao relatório Python do protocolo.
- Otimizar `runDailyBalance` além do que já é.

## Decisions

### 1. `random.ts`: mulberry32 + Box-Muller sem estado adicional

`mulberry32(seed)` devolve `() => number` em [0, 1) — o mesmo código hoje em `test-fixtures.ts`, que passa a reexportá-lo. `sampleNormal(rand, mean = 0, sd = 1)` usa Box-Muller com dois uniformes por chamada e devolve **um** valor (o segundo é descartado). A variante com cache do segundo valor economizaria metade das chamadas, mas introduz estado oculto que torna a sequência dependente da ordem de chamadas; aqui a reprodutibilidade vale mais do que um `log` e um `sqrt` a menos. O uniforme é tomado como `1 − rand()` ∈ (0, 1] para `ln` nunca receber 0. `uniform(rand, min, max)` também migra para `random.ts`.

### 2. Perturbação sistemática por iteração, não por dia

Em cada iteração `i` sorteiam-se, nesta ordem, `f_i = max(0, N(1, σP²))` e `δ_i = N(0, σT²)`; `f_i` multiplica a precipitação de **todos** os dias e `δ_i` soma-se a `tmax`, `tmin` e `tmean` (se presente) de todos os dias. `tdew` e `rn` não mudam.

Por que sistemático: a incerteza que o MSA quer capturar é a de **viés** da reanálise sobre a janela (o ERA5-Land superestima ou subestima a chuva da estação como um todo) e a variabilidade interanual — ambas correlacionadas no tempo. Ruído independente por dia com σ = 30 % se cancela em grande parte na soma de uma janela de 20–40 dias (o desvio da soma cresce com √n enquanto a soma cresce com n), produzindo um P10–P90 estreito que subestima a incerteza. A perturbação sistemática é a forma conservadora. `algoritmos.md` §7 escreve `P_{d,i} = P_d (1 + ε_P)` sem dizer se `ε_P` varia com `d`; esta decisão fixa que não varia. Fica em aberto (Open Questions) para a pesquisadora confirmar ou pedir a variante mista.

Com `δ` somado a Tmax e Tmin, a amplitude térmica se mantém e `tdew` fixo faz `es − ea` crescer com `δ` — ET₀ responde à temperatura como a física manda.

### 3. Sem alocação por dia além do que `runDailyBalance` já faz

Um único array de rascunho `DailyWeather[]` é criado no início e seus objetos são **mutados** a cada iteração (`tmax`, `tmin`, `tmean`, `precipitation`), em vez de `map` criando `n` objetos por iteração. `runDailyBalance` aloca suas linhas de saída (contrato), e `summarizeByPhase` quatro resumos — total ~160 mil objetos pequenos para 1.000 × 150 dias, dentro dos 2 s. Os valores por janela são acumulados em `Float64Array(iterations)` por métrica e janela (12 arrays), preenchidos por índice.

### 4. Percentis tipo 7 (Hyndman & Fan), só sobre iterações válidas

`percentile(sorted, p)`: `h = (n − 1)·p`, `lo = floor(h)`, resultado `x[lo] + (h − lo)(x[lo+1] − x[lo])` — o método padrão de R (`quantile`, type 7) e NumPy (`linear`), o que permite reproduzir os números em qualquer ferramenta do relatório. Para cada janela, só entram as iterações em que a janela teve dias (`days > 0`); `validIterations` informa quantas. Com zero iterações válidas, os três percentis vêm `null`. Uma janela só não é alcançada quando `δ_i` reduz o GDA acumulado abaixo do limiar no fim da série — por isso a contagem importa para interpretar o P10.

### 5. Saída do Monte Carlo

```ts
MonteCarloResult {
  iterations, seed, sigmaPrecip, sigmaTemp,
  baseline: PhaseSummary[],          // sem perturbação
  baselineSeries: DailyBalanceRow[], // idem, dia a dia — entrada do cenário (b)
  phases: PhasePercentiles[]         // F1–F4: validIterations + {p10,p50,p90} de ksMean, yieldReductionPct, etcAdjAccum
}
```

`baselineSeries` não estava no pedido; entra porque `generateDecisionScenarios` precisa dela e o Monte Carlo já a calcula — devolver evita um segundo `runDailyBalance` no chamador. `MonteCarloOptions = { iterations = 1000, seed, sigmaPrecip = 0.30, sigmaTemp = 0.6, altitude, initialDepletion? }`; `seed` é obrigatório (o job que persistir o resultado deve gravá-lo), `iterations` inteiro ≥ 1, sigmas ≥ 0 — violações lançam `RangeError`.

### 6. Cenários de decisão

`generateDecisionScenarios({ phase, ksP50, baselineSeries, cultivar, doseBase, efficiencyBase })`:

- **(a)** `doseAdjusted = doseBase · ksP50`; informa também `reductionPct = (1 − ksP50)·100`.
- **(b)** Janela seguinte: F1→F2, F2→F3, F3→F4; para F4 não há (`b = null`, `bUnavailableReason` explica). Dias da janela seguinte na `baselineSeries` são divididos em duas metades consecutivas — a primeira com `ceil(n/2)` dias. `f1 = ΣETc₁ / (ΣETc₁ + ΣETc₂)` com **ETc** (demanda potencial, como diz §8: "ETc projetada"), não ETc_adj. Se a série não alcança a janela seguinte, ou a alcança com menos de 2 dias, `b = null` com o motivo. Se ΣETc = 0, `f1 = 0,5`. Devolve `dose1`, `dose2`, `fraction1`, `fraction2`, `days1`, `days2`, `etc1`, `etc2`, `nextPhase`.
- **(c)** `efficiencyAdjusted = efficiencyBase · ksP50`.

Cada cenário traz `rationale`: uma frase que descreve o que o número significa ("dose reduzida proporcionalmente ao Ks mediano de 0,72 em F3"), nunca "recomenda-se". Validações: `ksP50 ∈ [0, 1]`, `doseBase ≥ 0`, `efficiencyBase ≥ 0`, `phase ∈ F1–F4` — senão `RangeError`.

### 7. Cultivares de referência em módulo próprio

`REFERENCE_CULTIVARS` sai de `prisma/seed.ts` para `src/modules/cultivars/reference-cultivars.ts` (com o JSDoc das fontes), exportando também `referenceCultivar(crop)`. Seed, `test-fixtures.ts` e `mc-validate.ts` passam a importar daí — hoje `SOJA` dos testes duplica os valores do seed à mão. Não é mudança de comportamento: o seed continua gravando os mesmos valores.

### 8. Script `mc-validate.ts` e série sintética

`pnpm msa:validate-mc -- <clima.csv> --cultivar soja|milho [--altitude 741] [--soil 0.28,0.12] [--seed 42] [--out x.csv]` ou `--synthetic [dias]` no lugar do CSV. O CSV tem `date, tmax, tmin, tmean?, tdew, u2, rn, precipitation`. O script roda 100, 500 e 1.000 iterações **com a mesma semente** (as primeiras 100 e 500 iterações são as mesmas; mede-se só o efeito das adicionais), imprime por janela o P50 de `ksMean` nas três contagens, a variação relativa |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ e o critério < 0,5 %, mais P10/P90 e baseline a 1.000; grava CSV se `--out`.

`src/modules/msa/synthetic-season.ts` (fora de `engine/`, por ser gerador de dados e não motor; movido de `scripts/validation/` para que o teste de convergência em `src/` não importe de `scripts/`) gera uma safra de verão do Cerrado determinística (`syntheticSeason(days, seed)`): temperaturas e radiação com sazonalidade suave e ruído, chuva em regime de verão (~5 mm/dia: 45 % dos dias com 1–35 mm) com veranicos de 7–14 dias que começam com 5 % de chance por dia, para que haja estresse em F3/F4 e o Caso 3 seja informativo. A primeira calibração (45 % de dias chuvosos, veranicos com 6 % de chance) não produziu estresse algum — um teste-sentinela ("a série sintética produz estresse") pegou isso e a chuva foi recalibrada. É também a série do teste de convergência; o exemplo versionado `examples/synthetic-cerrado-season.csv` é essa série com 150 dias e semente 2026, gravada pelo próprio script (`--write-weather`).

### 9. Testes

- Determinismo: dois `runMonteCarlo` com a mesma semente ⇒ `toEqual`; sementes diferentes ⇒ algum P50 difere.
- `sigmaPrecip = sigmaTemp = 0` ⇒ `p10 = p50 = p90 = baseline` em todas as métricas e janelas (`toBeCloseTo`, 12 casas).
- Invariantes em 1.000 iterações: `p10 ≤ p50 ≤ p90`, Ks em [0, 1], `validIterations ≤ iterations`; `sampleNormal(…, 1, 0.3)` truncado ≥ 0 em 10 mil sorteios.
- Amostrador: 100 mil sorteios de N(0, 1) e N(1, 0,3): média e desvio dentro de 1 % (desvio) e 0,01 (média).
- Percentis tipo 7 contra valores conhecidos (`[1,2,3,4]`: p50 = 2,5; p10 = 1,3; p90 = 3,7) e contra R/NumPy documentado.
- Convergência: série sintética de 150 dias; |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ < 0,5 % para `ksMean` em todas as janelas com dias.
- Decisão: proporcionalidade de (a) e (c); (b) soma `doseBase` e frações somam 1; F4 ⇒ `b = null`; série curta ⇒ `b = null`; `ksP50 = 1` ⇒ a = `doseBase`, c = `efficiencyBase`; entradas inválidas ⇒ `RangeError`.
- Desempenho: 1.000 × 150 dias < 2 s (`performance.now()`); limite folgado para CI, registrado como teste e não só como medição manual.

### 10. Notas da implementação

- Leitura de CSV e `InputError` ficaram em `scripts/validation/csv.ts`, compartilhados por `et0-validate.ts` e `mc-validate.ts`.
- Resultado com a série sintética (semente 2026, soja): F3 P50 0,971 (P10 0,830), F4 P50 0,922 (P10 0,628); variação 500→1000 de 0,11 % e 0,05 %; 1.000 iterações × 150 dias em ~0,1 s. Milho: convergência também < 0,5 %.
- `engine/test-fixtures.ts` passou a importar as cultivares de referência de `cultivars/reference-cultivars.ts`; o grep de pureza do motor exclui `test-fixtures.ts` e `*.test.ts`, que não são parte do motor.

## Risks / Trade-offs

- **[Perturbação sistemática pode superestimar a incerteza]** → É o lado conservador; a alternativa (mista: viés por iteração + ruído diário) fica como questão em aberto para a pesquisadora.
- **[Truncar `f_i` em 0 deforma a normal]** → Com σP = 0,30, P(f < 0) ≈ 4·10⁻⁴; efeito desprezível e documentado.
- **[Teste de desempenho sensível à máquina]** → Limite de 2 s é 5–10× o esperado; se falhar em CI lento, relaxa-se o teste, não o motor.
- **[Convergência com semente fixa é um caso, não uma prova]** → O script existe para a pesquisadora repetir com várias sementes e séries reais no relatório.
- **[`baselineSeries` no resultado aumenta o payload]** → ~150 linhas; quem persistir pode descartar.
- **[Metade de `ceil(n/2)` dias é convenção]** → Documentada no JSDoc e no spec; o técnico vê `days1`/`days2`.

## Migration Plan

Nenhum: biblioteca pura. O seed continua gravando os mesmos valores após mover as referências.

## Open Questions

- **Modo de perturbação (para Heb)**: sistemática por iteração (adotada) vs. mista (viés por iteração + ruído diário independente). A mudança é local a `monte-carlo.ts` e pode virar opção (`perturbation: 'systematic' | 'mixed'`) sem alterar a saída.
- **Correlação chuva–temperatura**: dias/anos mais secos tendem a ser mais quentes; hoje os dois sorteios são independentes.
- **Shapiro-Wilk do Caso 3**: fica para o relatório Python; o script exporta os sorteios se `--dump-draws` for pedido no futuro.
