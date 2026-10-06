## Context

Fundação do frontend entregue (`add-frontend-foundation`): cliente HTTP com sessão, guards, componentes, formulários zod, mapa, Playwright. A API expõe tudo o que o painel precisa:

- `GET /cultivars` (referência + próprias), `POST/PATCH/DELETE /cultivars/:id` (409 `CULTIVAR_IN_USE` ao mudar parâmetros científicos de cultivar com safras);
- `GET /harvests?fieldId=&status=`, `POST /harvests` (responde `msaJobId`), `PATCH /harvests/:id` (`status`, `notes`, `season`);
- `POST /harvests/:id/msa/process` (202 `{jobId}`; `?sync=true` só ADMIN), `GET /msa` (`{ run, phases, currentPhase }` da última `SUCCEEDED`; 404 `NO_MSA_RESULT`), `GET /msa/daily?runId=` (`{ runId, days: DailyBalanceRow[] }`), `GET /msa/runs`, `GET /msa/decision?phase=&doseBase=&efficiencyBase=&runId=` (`DecisionScenarios`), `POST/GET /msa/decisions`;
- `/admin/jobs/*` (ADMIN).

Tipos relevantes: `PhaseView { phase, days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct, validIterations, percentiles{ksMean,yieldReductionPct,etcAdjAccum} }`; `DailyBalanceRow { date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw }`; `RunView` com `status`, `reason`, `seed`, `engineVersion`, `missingDates`, `dateFrom/To`; `DecisionScenarios { phase, ksP50, a, b | null, bUnavailableReason, c }`. A cultivar não tem campo de fonte bibliográfica: as de referência vêm do seed com valores FAO-56/FAO-33 (`docs/msa/algoritmos.md`).

## Goals / Non-Goals

**Goals:**
- Fechar o ciclo do técnico na interface: cultivar → safra → processamento → leitura → decisão registrada.
- Painel legível para quem não conhece FAO-56: severidade por cor, textos curtos explicando Ks, P10/P50/P90 e os cenários; números exatos (seed, engineVersion, run) visíveis para a pesquisa.
- Gráficos que mostrem a dinâmica do balanço hídrico (chuva × ETc × ETc_adj; Dr × RAW × TAW; Ks) sem exigir leitura de tabelas.
- Tudo exportável em CSV para análise externa (R, Excel) pela orientadora.

**Non-Goals:**
- Comparação entre runs ou entre safras lado a lado; relatórios em PDF; notificações (próximas changes).
- Edição de cultivares de referência; exclusão de safras (a API não oferece — cancela-se).
- Métricas de acurácia do MSA (é tema de `docs/msa/validacao.md`, não da interface).

## Decisions

### 1. Rotas e navegação
`/cultivares`, `/cultivares/nova`, `/cultivares/:id/editar`; `/safras`, `/safras/nova`, `/safras/:id` (detalhe = painel; `/safras/:id/msa` redireciona para `/safras/:id` para manter a URL pedida válida — a página é uma só, com o painel abaixo do cabeçalho da safra). Barra lateral: Propriedades, Talhões, **Safras**, **Cultivares**, Admin (ADMIN). Entrada de talhão/propriedade ganha atalho "Safras deste talhão" (`/safras?fieldId=`).

### 2. Cultivares: formulário e congelamento
Um schema zod `cultivarSchema` em `lib/validation/cultivar.ts` replica `cultivarParamsShape` + `refineCultivarParams` (faixas e `gdaF1End < gdaF2End < gdaF3End < gdaTotal`, `zrIni ≤ zrMax`), com os campos agrupados: **Térmicos** (tBase, gdaTotal, gdaF1End, gdaF2End, gdaF3End), **Kc** (kcIni, kcMid, kcEnd), **Hídricos** (depletionFraction, zrIni, zrMax), **Ky** (kyF1–kyF4), mais nome, cultura (SOJA/MILHO) e descrição do ciclo. Como a API não expõe "em uso", o formulário de edição começa com os parâmetros editáveis; um 409 `CULTIVAR_IN_USE` desabilita o grupo de parâmetros, mantém nome/descrição editáveis e mostra "parâmetros congelados porque há safras vinculadas" — repetindo o PATCH só com nome/descrição se o usuário confirmar. Cultivares de referência abrem em modo leitura com a nota: "Parâmetros de referência (FAO-56 Tabelas 12 e 22; FAO-33 Ky) — ver `docs/msa/algoritmos.md`". Alternativa (campo `inUse` na API) descartada para não mexer no backend nesta change.

### 3. Safras: criação e acompanhamento
Formulário: talhão (`select` agrupado por propriedade, carregado por `useFieldsOfProperties`), cultivar (referência primeiro), emergência (`<input type="date">`, máximo hoje), safra sugerida pela emergência (`suggestSeason('2025-11-01') = '2025/26'`: meses ≥ julho começam a safra no ano corrente, senão no anterior — função pura testada; editável), notas. Talhão sem altitude ⇒ aviso em amarelo ("o MSA não vai processar até informar a altitude", link para editar) sem bloquear. Resposta 201 ⇒ navega ao detalhe com `msaJobId` no `state`; o detalhe entra em **modo acompanhamento**: `GET /msa` com `refetchInterval` de 3 s enquanto responder 404 `NO_MSA_RESULT` (até 10 min), mostrando "processando…"; ADMIN vê também `GET /admin/jobs/msa-process/:jobId` (estado, tentativas, erro). Se o job falhar (ADMIN vê `failed`), o painel mostra o `failedReason`; o agrônomo vê a última run `FAILED`/`NEEDS_DATA` via `GET /msa/runs`, que é consultado quando o 404 persiste. `useMsaPolling(harvestId, enabled)` encapsula isso e é testado com `fetch` mockado.

### 4. Painel: dados e composição
Uma página (`HarvestPage`) com três consultas: `GET /harvests/:id` (safra, talhão, cultivar), `GET /msa` (última run + fases), `GET /msa/runs`. A série diária vem de `GET /msa/daily?runId=` para a run selecionada (padrão: a última `SUCCEEDED`); selecionar uma run antiga no histórico troca a série dos gráficos e da linha do tempo, com um aviso "visualizando run de <data>"; cartões e cenários permanecem da última run (a API só gera cenários sobre ela, salvo `runId` explícito — o painel passa `runId` quando uma run antiga está selecionada, e a API decide).

### 5. Severidade, faixas e percentis (funções puras, `lib/msa/`)
- `severity(ksMean)`: `null`/janela não alcançada ⇒ `pending` (cinza); `≥ 0,85` ⇒ `ok` (verde); `0,70–0,85` ⇒ `warning` (âmbar); `< 0,70` ⇒ `critical` (vermelho). Limiares em constantes com comentário (0,85 = "estresse moderado" do fluxo operacional; 0,70 = severo).
- `phaseRanges(days)`: percorre a série e devolve `[{ phase, start, end, days }]` com primeira/última data de cada fase presente (F1–F4), mais `cycleEnd` (último dia) e `today`; a linha do tempo desenha barras proporcionais aos dias.
- `formatPercentiles({p10,p50,p90})` → "P10 0,61 · P50 0,78 · P90 0,91"; `formatPct`, `formatMm`.
- `toCsv(rows, columns)` com `;` como separador e vírgula decimal (Excel pt-BR), BOM UTF-8, aspas quando necessário; `downloadCsv(filename, text)` via `Blob` + `<a download>`. Exporta `serie-diaria-<safra>-<run>.csv` e `resumos-<safra>-<run>.csv`.

### 6. Gráficos: Recharts
`recharts` 2.x (React 18). Três `ResponsiveContainer`: (1) `ComposedChart` — `Bar` chuva (eixo direito, mm), `Line` ETc e ETc_adj (mm/dia), `ReferenceArea` por fase com cor suave e rótulo; (2) `LineChart` Dr, RAW, TAW (mm); (3) `LineChart` Ks (0–1) com `ReferenceLine` em 0,85 e 0,70. `Tooltip` customizado com todos os campos do dia (data, fase, GDA acumulado, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW). Eixo X por data (pt-BR curta), amostrado quando > 60 dias. Alternativa (Chart.js) descartada: Recharts compõe melhor com React e `ReferenceArea` resolve o fundo por janela sem plugin.

### 7. Cenários e decisão
Formulário (janela F1–F4 — padrão `currentPhase` ou a última alcançada —, dose base, eficiência base 0–1) → `GET /msa/decision` com debounce; três cartões A/B/C com os números (`doseAdjusted`, `reductionPct`; `dose1/dose2`, `fraction1/2`, `days1/2`; `efficiencyAdjusted`) e o `rationale` da API; B indisponível mostra `bUnavailableReason` em cinza. "Registrar decisão" em cada cartão abre um `Modal` com justificativa (3–2000 caracteres, obrigatória) → `POST /msa/decisions` com `phase`, `scenario`, `doseBase`, `efficiencyBase`, `justification`, `runId` da run exibida. 422 `PHASE_NOT_REACHED`/`SCENARIO_UNAVAILABLE` viram mensagens. Lista de decisões abaixo (quem, quando, janela, cenário, dose/eficiência, justificativa). PRODUTOR vê cenários e decisões, sem botões.

### 8. Admin operacional
Três ações em `/admin`: **Ingest latest** (confirmação; 202 → toast com `jobId` e link que consulta `GET /admin/jobs/era5-ingest/:id`), **Backfill regional** (formulário bbox N/W/S/E + `from`/`to`, validação local N > S, E > W, `from ≤ to`; avisa que dispara requisições reais ao CDS), **Processar todas as safras ativas** (confirmação; mostra `count`). Painel "Jobs recentes desta sessão" lista os jobs disparados com estado atualizado por polling (5 s) até `completed`/`failed`; contagens das filas recarregam após cada ação.

### 9. Tipos e cliente
`lib/api/types.ts` ganha `CultivarResponse` (campos do model), `HarvestResponse` (com `field`, `cultivar`, `msaJobId?`), `MsaLatest`, `PhaseView`, `RunView`, `DailyRow`, `DailySeries`, `DecisionScenarios`, `DecisionView` (com `decidedBy`), `JobView`. Hooks por feature em `features/*/api.ts` seguindo o padrão atual (chaves `['cultivars']`, `['harvests', filtros]`, `['harvests', id]`, `['msa', id, 'latest' | 'runs' | 'daily', runId | 'decisions']`).

### 10. Testes
Unitários: `severity`, `phaseRanges` (série com 4 fases; série truncada em F2; lacuna de fase), `formatPercentiles`/`toCsv` (vírgula decimal, aspas, BOM), `suggestSeason`, `cultivarSchema` (regras cruzadas apontando o campo certo), `useMsaPolling` (404 → continua; 200 → para; timeout). Playwright `e2e/msa.spec.ts`: registra agrônomo, cria propriedade e **talhão via API** (geometria do quadrado de Goiânia usada pelos roteiros bash — cell −16,7/−49,3, a única em cache; desenhar no mapa não garante a célula), antes faz `touch` no cache do ETL (como o `e2e-orchestration.sh`) salvo `ERA5_E2E_CDS=1`, cria a safra pela UI (emergência 2025-11-01), espera "processando…" virar painel (até 5 min), confere 4 cartões, 3 gráficos, cenários F3, registra decisão, vê na lista, baixa o CSV (`page.waitForEvent('download')`). Segundo teste: login ADMIN (credenciais do `.env` da raiz) → `/admin` → process-all → `jobId` exibido.

## Risks / Trade-offs

- **[Painel pesado em safras longas]** → ~330 dias × 14 campos é pequeno; Recharts lida bem. Eixo X amostrado; sem virtualização.
- **[Polling sem fim]** → limite de 10 min e botão "parar de aguardar"; o estado final vem de `GET /msa/runs`.
- **[Cultivar "em uso" só descoberta no 409]** → UX aceitável (um clique a mais); o aviso explica. Registrado como melhoria futura (`inUse` na resposta).
- **[Recharts + jsdom]** → gráficos não são testados unitariamente (sem layout); o Playwright confirma a presença dos três `svg` e de pontos renderizados.
- **[Dependência do cache do ETL no Playwright]** → mesma dependência do `e2e-orchestration.sh`, documentada no README; sem o cache o teste falha com mensagem clara ao não achar a run em 5 min.
- **[Cores como único código de severidade]** → sempre acompanhadas do rótulo textual (ok/atenção/crítico) e do valor de Ks.

## Notas de implementação

- **Recharts 2.15.4** (a 3.x mudou a API de `Tooltip`/`ResponsiveContainer`; a 2.x é a estável com React 18). Chunk separado (`charts`) no `vite.config.ts`.
- **Lockfile**: editar o especificador em `package.json` depois do `pnpm add` deixa o `pnpm-lock.yaml` desatualizado; o serviço `frontend` (que instala com `--frozen-lockfile`) falhou silenciosamente em resolver `recharts` até rodar `pnpm install` no host. Regra: depois de mexer em `package.json`, `pnpm install` e `docker compose restart frontend`.
- **Polling pela lista de runs**, não pelo `GET /msa`: uma run `NEEDS_DATA`/`FAILED` nunca aparece em `GET /msa` (só `SUCCEEDED`), então observar `GET /msa/runs` desde `since` cobre os três desfechos. `useMsaPolling` usa `setTimeout` próprio (testável com `intervalMs` curto) e invalida `['msa', harvestId]` ao concluir.
- **Run exibida vs. última tentativa**: o cabeçalho mostra a última `SUCCEEDED` e, quando `GET /msa/runs` traz uma tentativa mais nova `NEEDS_DATA`/`FAILED`, um aviso com datas faltantes/erro — sem esconder o painel válido.
- **Cenários sobre run antiga**: `runId` só é enviado quando a run selecionada no histórico difere da mais recente; a API decide se aceita.
- **Cultivar em uso**: o formulário usa `cultivarDiff` para enviar só o que mudou; após o 409 `CULTIVAR_IN_USE`, `frozen` desabilita os grupos e o botão vira "Salvar nome e descrição".
- **Lista de safras**: o indicador do MSA por linha (`MsaBadge`) faz uma consulta `GET /msa` por safra (404 = sem processamento, sem retry); aceitável para o volume por usuário.
- **Formulários com números como string** (cultivar, cenários) re-parsam com o schema no submit, como no formulário de talhão.
- **`GET /msa/decision` devolve `{ runId, scenarios }`** (não `DecisionScenarios` direto como o design supunha): o hook usa `select` para entregar `scenarios`. Descoberto pelo Playwright — a tela ficou branca por um `TypeError` de renderização.
- **`ErrorBoundary` por seção** do painel (cabeçalho, linha do tempo, cartões, gráficos, cenários, histórico): um erro de renderização mostra a mensagem no lugar da seção em vez de derrubar a página inteira; o spec do Playwright falha em qualquer `pageerror`/`console.error` que não seja "Failed to load resource" (401 do refresh e 404 do `NO_MSA_RESULT` são estados normais).
- **Serviço `frontend` com `CI=true`**: ao mudar o `store-dir` do pnpm, o `node_modules` do volume ficou inconsistente e o `pnpm install` do boot parou numa pergunta interativa; `CI=true` aceita a reinstalação. Lição: depois de `pnpm add`, rodar `pnpm install` no host (lockfile) e `docker compose up -d frontend`.
- **Playwright**: `selectOption({ label })` com rótulo errado espera até o timeout (actionability) — o spec resolve o `value` pelo texto; os ícones da legenda do Recharts também são `svg.recharts-surface`, por isso a asserção conta `.recharts-wrapper`.

## Migration Plan

1. `pnpm add recharts`; tipos e hooks; páginas de cultivares e safras; habilitar a navegação.
2. Painel (lib pura → cartões/linha do tempo → gráficos → cenários/decisões → runs/CSV).
3. Admin operacional; testes; Playwright; docs. Sem passos de deploy além do build do frontend.

## Open Questions

- Limiares de severidade (0,85/0,70) e cores: confirmar com a Heb se os cortes coincidem com os usados na dissertação.
- Mostrar `validIterations` quando < 1.000? Exibido em tooltip do cartão; decidir se merece destaque.
