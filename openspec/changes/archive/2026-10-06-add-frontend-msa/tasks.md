## 1. Base

- [x] 1.1 `pnpm add recharts`; tipos em `lib/api/types.ts` (`CultivarResponse`, `HarvestResponse`, `MsaLatest`, `PhaseView`, `RunView`, `DailyRow`, `DailySeries`, `DecisionScenarios`, `DecisionView`, `JobView`); mensagens novas em `errors.ts` (`CULTIVAR_IN_USE`, `EMERGENCE_DATE_IN_FUTURE`, `FIELD_HAS_ACTIVE_HARVEST`, `INVALID_CULTIVAR`, `NO_MSA_RESULT`, `MISSING_FIELD_ALTITUDE`, `PHASE_NOT_REACHED`, `SCENARIO_UNAVAILABLE`, `MSA_PROCESSING_FAILED`)
- [x] 1.2 `lib/msa/`: `severity`, `phaseRanges`, `formatPercentiles`/`formatPct`/`formatMm`, `toCsv`/`downloadCsv`, `suggestSeason`; `lib/validation/cultivar.ts` (faixas + regras cruzadas) e `harvest.ts`; testes unitários de todos
- [x] 1.3 Rotas `/cultivares*`, `/safras*` (`/safras/:id/msa` → `/safras/:id`); barra lateral com Safras habilitada e Cultivares; atalho "Safras deste talhão" no detalhe do talhão

## 2. Cultivares

- [x] 2.1 `features/cultivars/api.ts` (lista, detalhe, criar, editar, excluir) e `/cultivares` com as seções Referência (nota bibliográfica) e Minhas cultivares, ações por role
- [x] 2.2 `CultivarForm` (grupos Térmicos/Kc/Hídricos/Ky com unidades e ajuda; validação cruzada; modo leitura para referência) em `/cultivares/nova` e `/:id/editar`; tratamento do 409 `CULTIVAR_IN_USE` (congela parâmetros, reenvia nome/descrição); exclusão com confirmação e 409 mapeado

## 3. Safras

- [x] 3.1 `features/harvests/api.ts` (lista com filtros, detalhe, criar, PATCH) e `/safras` com filtros status e propriedade → talhão (`?fieldId=`), indicador do último MSA
- [x] 3.2 `HarvestForm` em `/safras/nova`: talhão agrupado por propriedade, cultivar, emergência (máx. hoje), safra sugerida/editável, notas; aviso de talhão sem altitude; 409/400 mapeados; navega ao detalhe com `msaJobId`
- [x] 3.3 `useMsaPolling` (3 s enquanto 404 `NO_MSA_RESULT`, até 10 min; para em run `FAILED`/`NEEDS_DATA` via `/runs`); estado do job para ADMIN; testes com `fetch` mockado
- [x] 3.4 Detalhe da safra: cabeçalho da safra, ações Concluir/Cancelar/Reativar (confirmação, 409 explicado) e edição de notas; "Processando o MSA…" até a run

## 4. Painel MSA

- [x] 4.1 `features/msa/api.ts` (`latest`, `runs`, `daily(runId)`, `decision(params)`, `decisions`, `process`, `recordDecision`) e `MsaHeader` (intervalo, status com `missingDates`/erro, engineVersion, semente, reason, Reprocessar com 202 + polling)
- [x] 4.2 `PhaseTimeline` (faixas de `phaseRanges`, datas, hoje, fim do ciclo, não alcançadas em cinza)
- [x] 4.3 `PhaseCards` (Ks médio, P10/P50/P90, redução %, ETc_adj e chuva acumuladas, dias, iterações válidas; cor + rótulo de severidade; não alcançada)
- [x] 4.4 Gráficos Recharts: `WaterChart` (chuva barras + ETc/ETc_adj linhas + `ReferenceArea` por fase), `DepletionChart` (Dr/RAW/TAW), `KsChart` (Ks + referências 0,85/0,70); `DayTooltip` com todos os campos; eixo X amostrado
- [x] 4.5 `DecisionPanel`: formulário (janela, dose, eficiência) com debounce → cartões A/B/C com racional, B indisponível com motivo; diálogo "Registrar decisão" (justificativa obrigatória) → POST; lista de decisões; 422 mapeados; sem botões para PRODUTOR
- [x] 4.6 `RunsTable` com seleção de run antiga (série via `?runId=`, aviso "Visualizando run de…", voltar); exportação CSV da série e dos resumos (`toCsv` + `downloadCsv`)

## 5. Admin operacional

- [x] 5.1 `/admin`: ações Ingest latest (confirmação), Backfill regional (bbox + datas, validação local, aviso CDS), Processar todas (confirmação); feedback 202 com `jobId`/`queue`; "Jobs desta sessão" com polling de estado a cada 5 s; recarga das contagens

## 6. Verificação e documentação

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` limpos
- [x] 6.2 Playwright `e2e/msa.spec.ts`: agrônomo novo → propriedade → talhão via API (quadrado de Goiânia, célula −16,7/−49,3) → `touch` no cache do ETL (salvo `ERA5_E2E_CDS=1`) → safra pela UI (emergência 2025-11-01, safra sugerida 2025/26) → aguarda painel (≤ 5 min) → 4 cartões, 3 gráficos, linha do tempo → cenários F3 → registrar decisão → aparece na lista → CSV baixado; teste ADMIN em `/admin` com process-all e `jobId`
- [x] 6.3 `pnpm e2e` (smoke anterior + novo) passando contra a stack
- [x] 6.4 Docs: `docs/modulos/frontend.md` (cultivares, safras, painel, gráficos, CSV, polling, admin), `docs/modulos/msa.md` (painel como consumidor dos endpoints), README dos e2e (dependência do cache no Playwright)
