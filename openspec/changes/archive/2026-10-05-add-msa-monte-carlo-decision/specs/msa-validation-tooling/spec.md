## ADDED Requirements

### Requirement: Script de convergência do Monte Carlo
`backend/scripts/validation/mc-validate.ts`, executado por `pnpm msa:validate-mc -- <clima.csv> --cultivar soja|milho [--altitude m] [--soil fc,wp] [--seed n] [--out saida.csv]` ou com `--synthetic [dias]` no lugar do CSV, SHALL executar `runMonteCarlo` com 100, 500 e 1.000 iterações e a mesma semente, e imprimir por janela F1–F4 o P50 de `ksMean` nas três contagens, a variação relativa |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀, o critério de aceitação (< 0,5 %), P10/P90 a 1.000 iterações, o baseline e `validIterations`. O CSV de clima MUST ter `date, tmax, tmin, tdew, u2, rn, precipitation` e opcionalmente `tmean`. Com `--out`, SHALL gravar os números em CSV.

#### Scenario: Série sintética
- **WHEN** o script roda com `--synthetic 150 --cultivar soja --seed 2026`
- **THEN** imprime as quatro janelas com os P50 das três contagens e a variação relativa de cada uma fica abaixo de 0,5 %

#### Scenario: CSV de exemplo
- **WHEN** o script roda com `backend/scripts/validation/examples/synthetic-cerrado-season.csv --cultivar soja`
- **THEN** produz a mesma saída que `--synthetic 150 --seed 2026`

#### Scenario: Cultivar de referência
- **WHEN** `--cultivar milho` é informado
- **THEN** os parâmetros usados são os da cultivar de referência de milho de `reference-cultivars.ts`

#### Scenario: Cultivar desconhecida
- **WHEN** `--cultivar trigo` é informado
- **THEN** o script encerra com código 1 indicando as opções válidas

#### Scenario: Coluna ausente
- **WHEN** o CSV não tem `precipitation`
- **THEN** o script encerra com código 1 indicando a coluna

#### Scenario: Saída em CSV
- **WHEN** `--out` é informado
- **THEN** o arquivo contém uma linha por janela com P50 a 100/500/1000, variação relativa, P10/P90 e baseline
