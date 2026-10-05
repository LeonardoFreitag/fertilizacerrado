# era5-data-access Specification

## Purpose

Leitura, pelo Node, da série diária ERA5-Land de um talhão no formato do motor MSA (via era5_cells) e da cobertura de um intervalo (dias presentes e ausentes).

## Requirements

### Requirement: Série diária de um talhão no formato do motor
`src/modules/msa/era5.repository.ts` SHALL expor `getDailySeriesForField(fieldId, from, to)`, que localiza a célula do talhão em `era5_cells`, lê `era5_daily_data` no intervalo e devolve `DailyWeather[]` ordenado por data com `date` (`YYYY-MM-DD`), `tmax = t2m_max`, `tmin = t2m_min`, `tmean = t2m_mean`, `tdew = d2m_mean`, `u2`, `rn` e `precipitation = tp_corrected`. Talhão sem célula MUST devolver `null`. A função de mapeamento `toDailyWeather(row)` MUST ser exportada.

#### Scenario: Mapeamento de uma linha
- **WHEN** uma linha tem `time = 2025-11-10`, `t2m_max = 30,1`, `t2m_min = 19,2`, `t2m_mean = 24,5`, `d2m_mean = 18,0`, `u2 = 1,9`, `rn = 14,2`, `tp_corrected = 6,5`
- **THEN** o `DailyWeather` é `{ date: "2025-11-10", tmax: 30.1, tmin: 19.2, tmean: 24.5, tdew: 18.0, u2: 1.9, rn: 14.2, precipitation: 6.5 }`

#### Scenario: Série pronta para o motor
- **WHEN** a série de um talhão com dados é passada a `runDailyBalance`
- **THEN** o balanço executa sem erro e devolve uma linha por dia presente

#### Scenario: Talhão sem célula
- **WHEN** o talhão não tem linha em `era5_cells`
- **THEN** a função devolve `null`

#### Scenario: Intervalo sem dados
- **WHEN** não há linhas para a célula no intervalo
- **THEN** a função devolve um array vazio

### Requirement: Cobertura de um intervalo
`getCoverage(fieldId, from, to)` SHALL devolver `{ expectedDays, presentDays, missingDates }`, em que `missingDates` lista em ordem as datas do intervalo sem linha em `era5_daily_data` para a célula do talhão. A função pura `findMissingDates(from, to, presentDates)` MUST ser exportada.

#### Scenario: Cobertura completa
- **WHEN** todos os dias de `[from, to]` estão presentes
- **THEN** `presentDays = expectedDays` e `missingDates` é vazio

#### Scenario: Lacuna no meio
- **WHEN** o intervalo é 2025-11-01 a 2025-11-05 e faltam 03 e 04
- **THEN** `expectedDays = 5`, `presentDays = 3` e `missingDates = ["2025-11-03", "2025-11-04"]`

#### Scenario: Intervalo invertido
- **WHEN** `from` é posterior a `to`
- **THEN** a função lança `RangeError`
