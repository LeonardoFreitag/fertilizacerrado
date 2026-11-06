# msa-validation-tooling Specification

## Purpose

Ferramentas do protocolo de validação científica do MSA: script de validação de ET₀ contra referência externa (CROPWAT) com RMSE, R², NSE e PBIAS, erro relativo da produtividade predita frente à produtividade observada de safras históricas (Caso 2) e script de comparação dos métodos de graus-dia (`msa:validate-gda`: residual, Ometto sem TB e Ometto com TB, por janela F1–F4 — Caso 5, descritivo). Não há script de convergência de Monte Carlo.

## Requirements

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
O script SHALL calcular RMSE `= sqrt(mean((S − O)²))`, R² como o quadrado do coeficiente de correlação de Pearson entre S e O, NSE `= 1 − Σ(O − S)² / Σ(O − Ō)²` e PBIAS `= Σ(O − S) / Σ O × 100`, e comparar com os critérios RMSE ≤ 0,5, R² ≥ 0,95, NSE ≥ 0,80 e |PBIAS| ≤ 10 %. `metrics.ts` SHALL exportar também `relativeError(predicted, observed) = (predicted − observed) / observed` (erro relativo da produtividade predita do Caso 2, em fração; `RangeError` para `observed ≤ 0`), e `docs/msa/validacao.md` SHALL descrever no Caso 2 a comparação da produtividade predita pela run com a produtividade observada da safra histórica, quando disponível, registrando o erro relativo no relatório.

#### Scenario: Séries idênticas
- **WHEN** S = O em todas as linhas
- **THEN** RMSE 0, R² 1, NSE 1 e PBIAS 0

#### Scenario: Viés constante
- **WHEN** S = O + 0,5 em todas as linhas
- **THEN** RMSE 0,5, R² 1, PBIAS negativo e NSE menor que 1

#### Scenario: Erro relativo da produtividade
- **WHEN** `relativeError(47,84, 52)` é avaliado
- **THEN** o resultado é −0,08 (tolerância 1e-9)

#### Scenario: Observado inválido
- **WHEN** `relativeError(47,84, 0)` é avaliado
- **THEN** a função lança `RangeError`

### Requirement: Script de comparação de métodos de graus-dia
`backend/scripts/validation/gda-validate.ts`, executado por `pnpm msa:validate-gda -- (<clima.csv> | --synthetic [dias] | --cell <lat>,<lon> --from <AAAA-MM-DD> [--to <AAAA-MM-DD>]) [--tbase 10] [--tupper 30] [--cultivar soja] [--out <saida.csv>]`, SHALL calcular, para a mesma série, o GDA acumulado por três métodos — `residual` (`max((Tmax+Tmin)/2 − Tb, 0)`, reimplementado no script), `ometto` (motor, sem TB) e `ometto-tb` (motor, com TB = `--tupper`) — e imprimir, por método e por janela F1–F4 da cultivar de referência, a data de início, a data de fim e o número de dias, o dia em que `gdaTotal` é atingido (ou "não atingido") e o GDA acumulado ao fim da série, mais a diferença de dias por janela entre `ometto-tb` e `residual`. `--cell` SHALL ler `era5_daily_data` pela conexão do backend (`DATABASE_URL`); o CSV MUST ter `date, tmax, tmin` (demais colunas ignoradas). Com `--out`, SHALL gravar `metodo;janela;inicio;fim;dias;gda_fim`. Não há critério de aceitação: o Caso 5 de `docs/msa/validacao.md` é descritivo e alimenta a tabela da dissertação.

#### Scenario: Série sintética
- **WHEN** o script roda com `--synthetic 150 --cultivar soja`
- **THEN** imprime as quatro janelas para os três métodos e, para `ometto-tb`, nenhuma janela começa antes da correspondente em `residual`

#### Scenario: Célula em cache
- **WHEN** o script roda com `--cell -16.7,-49.3 --from 2025-10-25` e a célula tem a série no banco
- **THEN** usa os dias de `era5_daily_data` dessa célula a partir da emergência e imprime a comparação

#### Scenario: Coluna ausente
- **WHEN** o CSV não tem `tmin`
- **THEN** o script encerra com código 1 indicando a coluna

#### Scenario: Saída em CSV
- **WHEN** `--out` é informado
- **THEN** o arquivo tem o cabeçalho `metodo;janela;inicio;fim;dias;gda_fim` e doze linhas (3 métodos × 4 janelas)

#### Scenario: Limite superior inválido
- **WHEN** `--tupper` é menor ou igual a `--tbase`
- **THEN** o script encerra com código 1 indicando a relação
