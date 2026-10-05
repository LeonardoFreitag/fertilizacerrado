## ADDED Requirements

### Requirement: Script de validação de ET₀
`backend/scripts/validation/et0-validate.ts`, executado por `pnpm msa:validate-et0 -- <entrada.csv> [--out <saida.csv>]`, SHALL ler um CSV com cabeçalho contendo `et0_reference` e as colunas climáticas, calcular ET₀ linha a linha com o motor e imprimir RMSE, R², NSE e PBIAS conforme `docs/msa/validacao.md`, indicando se cada critério de aceitação foi atendido. A umidade MUST ser aceita por uma das vias `tdew`, `ea`, `rhmean` ou `rhmax` + `rhmin`; o vento por `u2` ou `u10`; a radiação por `rn`, `rs` ou `n` (horas de sol, com `lat`, `doy` ou `date`, e `altitude`). O script SHALL gravar um CSV de comparação com entrada, intermediários, ET₀ calculada, referência e erro por linha.

#### Scenario: CSV de exemplo do FAO-56
- **WHEN** o script roda com `backend/scripts/validation/examples/fao56-examples.csv`
- **THEN** imprime ET₀ de 3,9 ± 0,1 para Bruxelas e 5,72 ± 0,1 para Bangkok, RMSE ≤ 0,1 e |PBIAS| ≤ 2 %, e grava o CSV de comparação

#### Scenario: Umidade por UR média
- **WHEN** a linha traz `rhmean` em vez de `tdew`
- **THEN** `ea` é obtido pela Eq. 19 e o cálculo prossegue

#### Scenario: Radiação por horas de sol
- **WHEN** a linha traz `n`, `lat`, `doy` e `altitude` em vez de `rn`
- **THEN** Rs é obtido pela Eq. 35 e Rn pelas Eq. 37–40

#### Scenario: Coluna de referência ausente
- **WHEN** o CSV não tem `et0_reference`
- **THEN** o script encerra com código 1 e mensagem indicando a coluna

#### Scenario: Linha sem via de umidade
- **WHEN** uma linha não traz `tdew`, `ea`, `rhmean` nem `rhmax`+`rhmin`
- **THEN** o script encerra com código 1 indicando a linha e as colunas aceitas

#### Scenario: Poucas observações
- **WHEN** o CSV tem menos de 3 linhas
- **THEN** RMSE e PBIAS são impressos, e R² e NSE vêm acompanhados de aviso de que não são informativos

#### Scenario: Caminho de saída
- **WHEN** `--out` não é informado
- **THEN** o CSV de comparação é gravado ao lado da entrada com o sufixo `.comparison.csv`

### Requirement: Métricas do protocolo de validação
O script SHALL calcular RMSE `= sqrt(mean((S − O)²))`, R² como o quadrado do coeficiente de correlação de Pearson entre S e O, NSE `= 1 − Σ(O − S)² / Σ(O − Ō)²` e PBIAS `= Σ(O − S) / Σ O × 100`, e comparar com os critérios RMSE ≤ 0,5, R² ≥ 0,95, NSE ≥ 0,80 e |PBIAS| ≤ 10 %.

#### Scenario: Séries idênticas
- **WHEN** S = O em todas as linhas
- **THEN** RMSE 0, R² 1, NSE 1 e PBIAS 0

#### Scenario: Viés constante
- **WHEN** S = O + 0,5 em todas as linhas
- **THEN** RMSE 0,5, R² 1, PBIAS negativo e NSE menor que 1
