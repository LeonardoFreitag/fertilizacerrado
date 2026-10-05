## Why

Cultivares e safras existem; o que falta é a matemática que transforma clima em decisão — o objeto central da dissertação. Implementar o núcleo científico como biblioteca de funções puras, antes de ETL, filas ou endpoints, permite validá-lo contra os exemplos trabalhados do FAO-56 e contra o CROPWAT (Caso 1 de `docs/msa/validacao.md`) sem nenhuma infraestrutura, e garante que a rastreabilidade equação → código exigida pela banca exista desde a primeira linha.

## What Changes

- Nova biblioteca `src/modules/msa/engine/` com funções puras e JSDoc citando fonte e número de equação (FAO-56 / FAO-33): `gda.ts`, `phenology.ts`, `et0.ts`, `kc.ts`, `water-balance.ts`, `yield.ts`, `types.ts`, exportadas por `index.ts`. Sem dependência de Prisma, Express, Redis ou ERA5-Land.
- ET₀ FAO-56 Penman-Monteith (Eq. 6) com todas as auxiliares exportadas separadamente (Eq. 7, 8, 11–14, 47, G = 0 pela Eq. 42) e o cálculo de radiação líquida a partir da radiação solar (Eq. 21–25, 34, 35, 37–40) para validação com dados de estação/CROPWAT. Acréscimo além do pedido: `ea` a partir de umidade relativa (Eq. 17, 19) e de psicrômetro (Eq. 15), e ponto de orvalho a partir de `ea` (inversa da Eq. 14), necessários para alimentar o motor com dados CLIMWAT/CROPWAT e para reproduzir os Exemplos 4 e 5.
- Balanço hídrico diário FAO-56 cap. 8 (Eq. 82–84) como laço determinístico e sem alocação por dia, pronto para as 1.000 iterações do Monte Carlo.
- Redução de produtividade FAO-33 e resumo por janela fenológica.
- Testes Vitest obrigatórios: Exemplos 17 e 18 do FAO-56 (ET₀ com ±0,1 mm/dia), Exemplos 2–5 (auxiliares), propriedades do balanço hídrico, limites de transição de fase, continuidade do Kc, testes de propriedade com entradas aleatórias.
- Script `backend/scripts/validation/et0-validate.ts` (`pnpm msa:validate-et0 -- input.csv`) com RMSE, R², NSE e PBIAS e CSV de comparação, mais um CSV de exemplo com os dois casos FAO.
- `docs/msa/algoritmos.md` e `docs/msa/validacao.md` atualizados com os caminhos e nomes reais.

Fora do escopo: Monte Carlo (seção 7), cenários de decisão (seção 8), persistência de resultados (`msa_results`), jobs BullMQ, endpoints `/msa`, ETL ERA5-Land, correção de viés, parâmetros de solo por talhão no banco.

## Capabilities

### New Capabilities
- `msa-engine`: biblioteca pura de cálculo agrometeorológico — GDA e fenologia, ET₀ FAO-56 e auxiliares, Kc por fase, balanço hídrico diário e redução de produtividade FAO-33 — com rastreabilidade por equação e reprodução dos exemplos do FAO-56.
- `msa-validation-tooling`: script de validação de ET₀ contra referência externa (CROPWAT) com as métricas do protocolo de validação.

### Modified Capabilities

Nenhuma. O motor não altera comportamento de rotas ou do banco.

## Impact

- **Código**: novo `src/modules/msa/engine/` (7 arquivos + testes), novo `backend/scripts/validation/` (script + `examples/fao56-examples.csv`), script `msa:validate-et0` no `package.json`.
- **Banco, API, ambiente**: nenhuma alteração.
- **Dependências**: nenhuma nova. CSV lido com parser próprio; PRNG determinístico próprio nos testes de propriedade.
- **Docs**: seções "Implementação" de `docs/msa/algoritmos.md` apontam para os arquivos reais; `docs/msa/validacao.md` referencia o script.
