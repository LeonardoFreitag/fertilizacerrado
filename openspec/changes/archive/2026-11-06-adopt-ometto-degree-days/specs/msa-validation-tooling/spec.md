## ADDED Requirements

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
