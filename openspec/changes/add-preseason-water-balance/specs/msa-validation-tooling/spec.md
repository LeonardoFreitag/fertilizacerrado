## ADDED Requirements

### Requirement: Script de sensibilidade da entressafra
`backend/scripts/validation/preseason-validate.ts`, executado por `pnpm msa:validate-preseason -- (--cell <lat>,<lon> | <clima.csv>) --emergence <AAAA-MM-DD> [--soil <fc>,<wp>] [--altitude <m>] [--kc 0.4,0.7,1.0] [--zr-mode zrMax|zrIni] [--cultivar soja] [--out <saida.csv>]`, SHALL rodar o spin-up de `preSeasonStart(emergência)` até a véspera da emergência para cada Kc da lista (padrão 0,4; 0,7; 1,0), com a cultivar de referência e o solo informado (padrão 0,28/0,12, altitude 741), e imprimir por Kc: Dr ao fim da entressafra (mm e % de TAW(zrPre)), Dr convertido na emergência (mm e % de TAW(zrIni)), chuva e ET₀ acumuladas do spin-up e número de dias; `--cell` SHALL ler `era5_daily_data` pela conexão do backend; o CSV MUST ter `date, tmax, tmin, tdew, u2, rn, precipitation`. Com `--out`, SHALL gravar `kc;zr_m;dias;chuva_mm;et0_mm;dr_pre_mm;dr_pre_pct;dr_ini_mm;dr_ini_pct`. Não há critério de aceitação: a saída alimenta o Caso 2 de `docs/msa/validacao.md` (comparação com Thornthwaite-Mather em planilha) e a questão aberta #11.

#### Scenario: Célula em cache
- **WHEN** o script roda com `--cell -16.7,-49.3 --emergence 2025-11-01` e a célula tem a série desde 2025-02-01
- **THEN** imprime três linhas (Kc 0,4; 0,7; 1,0) com Dr crescente em Kc e `dr_ini_pct` em [0, 100]

#### Scenario: Série incompleta
- **WHEN** faltam dias entre `preSeasonStart` e a emergência
- **THEN** o script encerra com código 1 listando as datas ausentes

#### Scenario: Saída em CSV
- **WHEN** `--out` é informado
- **THEN** o arquivo tem o cabeçalho `kc;zr_m;dias;chuva_mm;et0_mm;dr_pre_mm;dr_pre_pct;dr_ini_mm;dr_ini_pct` e uma linha por Kc

#### Scenario: Emergência inválida
- **WHEN** `--emergence` está ausente ou não é `AAAA-MM-DD`
- **THEN** o script encerra com código 1 indicando o parâmetro
