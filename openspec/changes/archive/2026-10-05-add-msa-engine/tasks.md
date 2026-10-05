## 1. Tipos e GDA/fenologia

- [x] 1.1 Criar `src/modules/msa/engine/types.ts` (`Phase`, `CultivarParams`, `SoilParams`, `DailyWeather`, `ET0Input`, `DailyBalanceRow`, `PhaseSummary`, `BalanceOptions`) e `index.ts` reexportando tudo
- [x] 1.2 Implementar `gda.ts` (`dailyGDA`, `accumulateGDA`) com JSDoc (Ometo 1981; `algoritmos.md` §1) e testes (dia quente, dia frio, acumulado)
- [x] 1.3 Implementar `phenology.ts` (`phaseFromGDA`, `rootDepth`) com testes de limites exatos e Zr nos extremos

## 2. ET₀ FAO-56

- [x] 2.1 Implementar em `et0.ts` as auxiliares de pressão e vapor: Eq. 7, 8, 11, 12, 13, 14, 15/16, 17, 19 e inversa da 14, com JSDoc
- [x] 2.2 Implementar em `et0.ts` radiação e vento: Eq. 21–25 (`extraterrestrialRadiation`), 34, 35, 37, 38, 39, 40 (`netRadiationFromSolar`) e 47 (`windSpeedAt2m`)
- [x] 2.3 Implementar `referenceET0` (Eq. 6, G = 0) e `referenceET0Detailed` (intermediários)
- [x] 2.4 Testes: Exemplos 2, 3, 4 e 5 do cap. 3; Exemplo 18 (cadeia completa + cada intermediário); Exemplo 17 (idem, G = 0); fator 0,748; inversa de Eq. 14; `tmean` omitido

## 3. Kc, balanço hídrico e produtividade

- [x] 3.1 Implementar `kc.ts` (`kcForPhase`) e testes de continuidade nas quatro transições, ponto médio de F2 e fases constantes
- [x] 3.2 Implementar `water-balance.ts`: `totalAvailableWater`, `readilyAvailableWater`, `stressCoefficient` (com o caso `raw = taw`) e `runDailyBalance` em laço único sem alocação intermediária, com `RangeError` para `NaN`
- [x] 3.3 Testes do balanço: Ks = 1 até RAW, Ks = 0 em TAW, Dr em `[0, TAW]`, chuva excedente zera Dr, dia de estresse analítico, raiz aprofunda sem alterar Dr, determinismo, entrada inválida
- [x] 3.4 Implementar `yield.ts` (`yieldReduction`, `summarizeByPhase`) e testes (sem estresse, floração, resumo com F4 não alcançada)
- [x] 3.5 Testes de propriedade com PRNG mulberry32 e semente fixa (200 casos): Ks em `[0, 1]`, `etcAdj ≤ etc`, Dr em `[0, TAW]`, Zr e GDA não decrescentes, ET₀ ≥ 0

## 4. Script de validação

- [x] 4.1 Implementar `backend/scripts/validation/et0-validate.ts` (parser CSV, resolução das vias de umidade/vento/radiação, cálculo com o motor, métricas, critérios, CSV de comparação, erros com código 1) e o script `msa:validate-et0` no `package.json`
- [x] 4.2 Criar `backend/scripts/validation/examples/fao56-examples.csv` com os Exemplos 17 e 18 como no livro e um `README.md` curto explicando colunas aceitas e uso
- [x] 4.3 Rodar o script com o CSV de exemplo e confirmar ET₀ 3,9/5,72 ± 0,1, RMSE ≤ 0,1 e o CSV de comparação; testar os erros de coluna ausente

## 5. Verificação e documentação

- [x] 5.1 Verificar que nenhum arquivo de `engine/` importa fora de `engine/` (grep) e que um `Cultivar` do Prisma satisfaz `CultivarParams` (teste de tipo)
- [x] 5.2 `pnpm typecheck`, `pnpm build` e `pnpm test` sem erros
- [x] 5.3 Atualizar `docs/msa/algoritmos.md`: seções "Implementação" com caminhos e funções reais, tabela de auxiliares de ET₀ com equações, convenção de fase ao fim do dia e semântica do balanço, §7 e §8 marcadas como previstas
- [x] 5.4 Atualizar `docs/msa/validacao.md` (Caso 1: script, CSV de exemplo e colunas) e `docs/arquitetura.md` (estrutura de pastas com `msa/engine/`)
