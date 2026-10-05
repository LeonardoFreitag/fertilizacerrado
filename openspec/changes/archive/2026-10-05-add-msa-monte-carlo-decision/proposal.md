## Why

O motor já transforma clima em balanço hídrico e redução de produtividade por janela, mas entrega um único número por janela — como se o clima fosse conhecido sem erro. O MSA promete perfis de risco (P10/P50/P90) e três cenários de intervenção para o técnico (`docs/msa/algoritmos.md` §7 e §8). Esta change fecha a matemática do MSA, ainda como funções puras, para que o Monte Carlo possa ser validado (Caso 3 de `docs/msa/validacao.md`) antes de existir fila, job ou endpoint.

## What Changes

- `engine/random.ts`: PRNG determinístico com semente (mulberry32, movido de `test-fixtures.ts`) e amostrador normal por Box-Muller. Mesma semente ⇒ mesma sequência, sempre.
- `engine/monte-carlo.ts` (§7): `runMonteCarlo(days, cultivar, soil, options)` perturba a série com um fator de precipitação `f_i ~ N(1, σP²)` truncado em ≥ 0 e um deslocamento térmico `δ_i ~ N(0, σT²)` — **um sorteio de cada por iteração**, aplicado a toda a série —, recalcula ET₀ → balanço → resumo por janela e devolve P10/P50/P90 (percentis tipo 7) de `ksMean`, `yieldReductionPct` e `etcAdjAccum` por janela, mais o baseline sem perturbação e os metadados (iterações, semente, sigmas). Janela não alcançada em alguma iteração entra nos percentis só com as iterações válidas, com a contagem informada.
- `engine/decision.ts` (§8): `generateDecisionScenarios(input)` com os cenários (a) redução de dose, (b) parcelamento pela razão de ETc das duas metades da janela seguinte na série baseline (`null` com motivo quando não há janela seguinte) e (c) fator de eficiência — cada um com números e uma frase de racional agronômico. O motor não recomenda; a escolha é do técnico.
- Novos tipos em `engine/types.ts` e reexportação em `engine/index.ts`.
- Cultivares de referência movidas de `prisma/seed.ts` para `src/modules/cultivars/reference-cultivars.ts` (exportadas), para que seed, testes e scripts usem os mesmos valores sem duplicação.
- Script `backend/scripts/validation/mc-validate.ts` (`pnpm msa:validate-mc`) imprime P50 por janela com 100/500/1000 iterações e a variação relativa (Caso 3), lendo um CSV de clima ou gerando uma série sintética de referência; exemplo versionado.
- Testes: determinismo, sigma zero ⇒ percentis = baseline, invariantes, amostrador normal (100 mil sorteios), convergência 500 vs. 1000 (< 0,5 %), cenários de decisão, desempenho (1.000 iterações × ~150 dias < 2 s).
- `docs/msa/algoritmos.md` §7 e §8 e `docs/msa/validacao.md` Caso 3 atualizados com funções e caminhos reais.

Fora do escopo: job BullMQ, persistência de resultados (`msa_results`, `msa_phase_summary`), endpoints `/msa`, teste de normalidade Shapiro-Wilk do Caso 3 (fica para o relatório em Python), perturbação de Rn/u2/tdew, correlação entre precipitação e temperatura.

## Capabilities

### New Capabilities

Nenhuma: as duas capabilities existentes ganham requisitos.

### Modified Capabilities
- `msa-engine`: ganha os requisitos de PRNG determinístico e amostrador normal, análise de Monte Carlo e cenários de decisão (requisitos adicionados; os existentes não mudam).
- `msa-validation-tooling`: ganha o requisito do script de convergência do Monte Carlo (Caso 3).

## Impact

- **Código**: novos `engine/random.ts`, `engine/monte-carlo.ts`, `engine/decision.ts`, `src/modules/cultivars/reference-cultivars.ts`, `scripts/validation/mc-validate.ts`, `scripts/validation/synthetic-season.ts`; alterações em `engine/types.ts`, `engine/index.ts`, `engine/test-fixtures.ts`, `prisma/seed.ts` (importa as referências), `package.json` (script).
- **Banco, API, ambiente**: nenhuma alteração.
- **Dependências**: nenhuma nova.
- **Docs**: `algoritmos.md` §7/§8 deixam de ser "previsto"; `validacao.md` Caso 3 referencia o script.
