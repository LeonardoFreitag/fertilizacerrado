## Why

O balanço hídrico começa na data de emergência com `initialDepletion = 0` (`msa.service.ts`), isto é, assume o solo na capacidade de campo em outubro/novembro — depois de cinco meses de seca. Isso superestima a água disponível em F1 e F2 e, desde `refocus-on-yield-prediction`, o Ks̄ dessas janelas entra diretamente no índice do ciclo e na produtividade predita. Na reunião, o professor Adilson orientou iniciar o balanço **sempre em fevereiro**, quando o solo está, por hipótese razoável, cheio de água: roda-se o balanço pela entressafra (spin-up, no padrão de Thornthwaite-Mather) e chega-se à emergência com a depleção *calculada*. A condição inicial deixa de ser uma constante e passa a ser um resultado — e o painel pode mostrar ao técnico "com quanta água o talhão entrou na safra".

## What Changes

- **Motor (`msa-engine`)**: `runDailyBalance` aceita `preSeason?: { until: string; kc: number; zr: number }`: para os dias `date < until` (a emergência) não há cultura — GDA não acumula, `phase = 'PRE'`, `Kc = preSeason.kc`, `Zr = preSeason.zr`, Ks e Dr como hoje (FAO-56 Eq. 84/85). No primeiro dia de cultura, a depleção do perfil é convertida para a zona radicular inicial por proporção: `Dr_ini = Dr_pre × TAW(zrIni) / TAW(preSeason.zr)` (hipótese de umidade uniforme no perfil; registrada em `algoritmos.md` como limitação). `initialDepletion` passa a valer para o início do spin-up (padrão 0 = CC em fevereiro). Novo valor `'PRE'` em `Phase`; `YIELD_PHASES`, `phaseFromGDA`, `summarizeByPhase`, `cycleYieldIndex` e `kcForPhase` ignoram/tratam `PRE`. Nova função `preSeasonStart(emergenceDate)` = último 1º de fevereiro ≤ emergência (`'2026-02-01'` para emergência em 2026-10-20; para 2027-01-15 é `'2026-02-01'`; para 2027-02-01 é o próprio dia). `ENGINE_VERSION` 2.1.0 → 2.2.0.
- **Parâmetros da entressafra**: `PRE_SEASON_KC` (padrão **1,0**, ETP direta — Thornthwaite-Mather; questão #11) e `PRE_SEASON_ZR_MODE` (`'zrMax'` padrão: balanço sobre o perfil que a cultura vai explorar; alternativa `'zrIni'`), em `config/env.ts` com validação Zod, gravados em cada run (`preSeasonKc`, `preSeasonZr`) para reprodutibilidade.
- **Processamento (`msa-processing`)**: `runProcessing` usa `from = preSeasonStart(emergence)`; `resolveInterval` e `missingDates` cobrem o spin-up; a série do spin-up é persistida em `msa_daily_results` com `phase = 'PRE'` (gda = 0, gdaAccum = 0); a run ganha `preSeasonFrom`, `emergenceDepletionMm` e `emergenceDepletionPct` (Dr/TAW no dia da emergência, sobre `zrIni`), `preSeasonKc`, `preSeasonZr`. `dateFrom` da run passa a ser o início do spin-up; `GET /msa` devolve os campos novos; `GET /msa/daily` ganha `?includePreSeason=true|false` (padrão `false` — o painel pede explicitamente).
- **Orquestração (`msa-orchestration`)**: a cobertura verificada ao criar a safra e o backfill (`buildBackfillFlow`) partem de `preSeasonStart(emergence)` em vez da emergência; o semanal não muda. Sem dado desde fevereiro → mesmo tratamento de hoje (`NEEDS_DATA` com `missingDates`, backfill enfileirado).
- **Painel (`web-msa-dashboard`)**: no bloco Produtividade (ou logo abaixo do cabeçalho), cartão **"Água no solo na emergência"**: `emergenceDepletionPct` em linguagem simples ("o talhão entrou na safra com 35 % da água disponível"), chuva acumulada nos 30 dias antes da emergência, e o período do spin-up. Nos três gráficos, alternador "mostrar entressafra" (desligado por padrão) que carrega `?includePreSeason=true` e desenha a faixa `PRE` em cinza; a linha do tempo F1–F4 continua começando na emergência. CSV da série diária inclui a entressafra quando o alternador está ligado, com `fase = PRE`.
- **Validação (`msa-validation-tooling`)**: Caso 2 ganha a comparação da depleção na emergência contra o balanço climatológico de Thornthwaite-Mather feito em planilha (mesma série, CAD = TAW(zrMax)); script `pnpm msa:validate-preseason` imprime, para uma célula, Dr na emergência com Kc 0,4 / 0,7 / 1,0 (análise de sensibilidade para a dissertação e para fechar #11).
- **Docs**: `algoritmos.md` §5 (spin-up, conversão de Zr, limitação da hipótese uniforme), `arquitetura.md` (fluxo: cobertura desde fevereiro), `CLAUDE.md` (parâmetros da entressafra), `docs/modulos/msa.md`, `questoes-abertas.md` (#11 e #12 com o que foi implementado, alternativas e onde está), manual cap. 05 (por que a safra "começa" em fevereiro) e 06 (cartão novo e alternador), `era5-etl.md` (janela de backfill maior).
- **Operação**: após deploy, "Processar todas as safras ativas"; safras cujo talhão não tem ERA5 desde fevereiro ficam `NEEDS_DATA` até o backfill (o admin pode disparar `backfill-region` para o bbox dos talhões).

## Capabilities

### New Capabilities
<!-- Nenhuma. -->

### Modified Capabilities
- `msa-engine`: balanço com segmento pré-safra; `Phase` com `PRE`; conversão de depleção na emergência; `preSeasonStart`; `ENGINE_VERSION` 2.2.0. Cenários: spin-up de 10 dias sem chuva com Kc 1, ET₀ 5 → Dr cresce ~5/dia até RAW e depois menos; chuva de 80 mm no último dia zera Dr; conversão: Dr_pre 120 mm sobre TAW 152 mm (zrMax 0,95) → Dr_ini 37,9 mm sobre TAW 48 mm (zrIni 0,30), 79 %; `preSeasonStart('2026-10-20') = '2026-02-01'`, `preSeasonStart('2027-01-15') = '2026-02-01'`, `preSeasonStart('2027-02-01') = '2027-02-01'`; `summarizeByPhase` ignora dias `PRE`; `cycleYieldIndex` inalterado.
- `msa-processing`: intervalo desde o spin-up; persistência da série `PRE`; campos novos na run; `includePreSeason`; 2.2.0.
- `msa-orchestration`: cobertura e backfill desde `preSeasonStart`.
- `web-msa-dashboard`: cartão "Água no solo na emergência"; alternador; CSV.
- `msa-validation-tooling`: Caso 2 ampliado; `msa:validate-preseason`.

## Impact

- `engine/{types,phenology,kc,water-balance,yield,index}.ts` + testes; novo `engine/pre-season.ts` (`preSeasonStart`, conversão); `msa.service.ts`, `msa.repository.ts`, DTO de `daily`; `jobs/flows.ts`, `jobs.service.ts` (`scheduleHarvestProcessing`); `config/env.ts`, `.env.example`; Prisma: a coluna `phase` de `msa_daily_results` já é texto (aceita `PRE` sem migration); `msa_runs` + 5 colunas (migration aditiva; runs 2.1.0 ficam com os campos nulos e o painel mostra "run sem entressafra — reprocessar"); `scripts/validation/preseason-validate.ts`; frontend `features/msa` (`SoilWaterAtEmergence.tsx`, alternador em `MsaCharts`, `lib/msa` CSV e tipos).
- ETL/CDS: cada safra nova passa a exigir ~8 meses a mais de ERA5 por célula; o cache por célula/mês amortiza entre safras do mesmo talhão e região. **Ambiente de dev/e2e**: o cache da célula de Goiânia precisa cobrir desde 2025-02 (backfill único via CDS) para os e2e Playwright e a captura do manual; o e2e shell passa a inserir a série sintética desde fevereiro.
- API: `GET /msa` e `GET /msa/daily` ganham campos/parâmetro; sem remoções.

## Non-goals

- Eventos de estresse na linha do tempo e leitura do produtor (change seguinte).
- Perfil de solo em camadas (a conversão por proporção é a aproximação adotada).
- Irrigação, escoamento superficial e ascensão capilar (seguem fora do modelo).
- Cultura de cobertura/safrinha com Kc próprio na entressafra (só soja; entressafra é solo com palhada, Kc constante).
