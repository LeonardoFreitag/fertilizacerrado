## 1. Aleatoriedade e tipos

- [x] 1.1 Criar `engine/random.ts` (`mulberry32`, `uniform`, `sampleNormal` Box-Muller com `1 − rand()`), fazer `test-fixtures.ts` reexportar daí, e testes (mesma semente, sementes diferentes, média/desvio em 100 mil sorteios, valores finitos)
- [x] 1.2 Adicionar a `engine/types.ts` os tipos `MonteCarloOptions`, `Percentiles`, `PhasePercentiles`, `MonteCarloResult`, `DecisionInput`, `ScenarioA`, `ScenarioB`, `ScenarioC`, `DecisionScenarios`; reexportar em `index.ts`

## 2. Cultivares de referência compartilhadas

- [x] 2.1 Criar `src/modules/cultivars/reference-cultivars.ts` com `REFERENCE_CULTIVARS` e `referenceCultivar(crop)` (JSDoc das fontes movido do seed); fazer `prisma/seed.ts` e `engine/test-fixtures.ts` importarem daí
- [x] 2.2 Rodar `pnpm prisma db seed` e confirmar "atualizada" sem alteração de valores no banco

## 3. Monte Carlo

- [x] 3.1 Implementar `engine/monte-carlo.ts`: validação das opções, baseline, array de rascunho mutado por iteração, sorteios `f_i` (truncado) e `δ_i`, acumulação em `Float64Array`, `percentile` tipo 7, percentis só sobre iterações válidas
- [x] 3.2 Testes: determinismo, sementes diferentes, sigma zero = baseline, `p10 ≤ p50 ≤ p90` e Ks em [0, 1], fator truncado, janela parcialmente/nunca alcançada, percentil tipo 7 em [1, 2, 3, 4], opções inválidas, desempenho < 2 s

## 4. Cenários de decisão

- [x] 4.1 Implementar `engine/decision.ts` (`generateDecisionScenarios`, `nextPhase`) com validações e racionais descritivos
- [x] 4.2 Testes: proporcionalidade de (a) e (c), `ksP50 = 1`, parcelamento soma a dose e metades `ceil(n/2)`, ETc constante ⇒ 0,5, F4 ⇒ `null`, série curta ⇒ `null`, racional sem "recomenda", entradas inválidas

## 5. Script de convergência e série sintética

- [x] 5.1 Criar `scripts/validation/synthetic-season.ts` (`syntheticSeason(days, seed)` com sazonalidade, ruído e veranicos) e o teste de convergência (`|P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ < 0,5 %` por janela) usando-a
- [x] 5.2 Implementar `scripts/validation/mc-validate.ts` (argumentos, CSV ou `--synthetic`, cultivar de referência, três contagens com a mesma semente, tabela por janela, critério, `--out`, erros com código 1) e o script `msa:validate-mc` no `package.json`
- [x] 5.3 Gerar `scripts/validation/examples/synthetic-cerrado-season.csv` (150 dias, semente 2026) com o próprio script, rodar `msa:validate-mc` com o CSV e com `--synthetic` e confirmar saídas iguais e variação < 0,5 %; testar `--cultivar trigo` e coluna ausente; atualizar o README dos scripts de validação

## 6. Verificação e documentação

- [x] 6.1 `pnpm typecheck`, `pnpm build` e `pnpm test` sem erros; confirmar por grep que `engine/` continua sem importações externas
- [x] 6.2 Atualizar `docs/msa/algoritmos.md` §7 (perturbação sistemática por iteração, percentis tipo 7, iterações válidas, funções e caminhos) e §8 (regra das metades, ETc, `b = null`, funções e caminhos), removendo "previsto"
- [x] 6.3 Atualizar `docs/msa/validacao.md` Caso 3 (script, série sintética, Shapiro-Wilk fica para o relatório) e o cronograma
