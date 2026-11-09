# Frontend — aplicação web do técnico

Aplicação SPA em `frontend/` que consome a API (`/api/v1`). Idioma pt-BR em toda a interface; desktop como alvo, utilizável no celular. Cobre a Fase 1 inteira: fundação (sessão, layout, infra), **autenticação**, **propriedades/talhões**, **cultivares**, **safras** e o **painel MSA** (produtividade predita, janelas, gráficos, histórico), além da administração das filas.

## Stack

| Camada | Escolha | Observação |
|---|---|---|
| Build | Vite 6 + TypeScript `strict` (`noUncheckedIndexedAccess`) | pacote pnpm independente (`frontend/package.json`), sem workspace |
| UI | React 18.3 + TailwindCSS 3.4 | componentes locais em `src/components/` (sem biblioteca de componentes) |
| Rotas | react-router 7 (declarativo) | guards `RequireAuth`, `RequireRole`, `PublicOnly` |
| Dados | TanStack Query 5 | chaves por recurso; mutações invalidam |
| Formulários | react-hook-form + zod (`@hookform/resolvers`) | schemas espelham os DTOs do backend |
| Mapa | react-leaflet 4 + leaflet 1.9 + leaflet-geoman (free) + `@turf/area` | OSM e Esri World Imagery |
| Gráficos | Recharts 2 | série diária do MSA (`ReferenceArea` por janela, `ReferenceLine` nos limiares de Ks) |
| Testes | Vitest 3 + Testing Library (jsdom); Playwright (Chromium) | smoke contra a stack de dev |

Scripts: `pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm e2e`.

## Estrutura de pastas

```
frontend/
├── src/
│   ├── app/              App (providers, bootstrap da sessão, watcher de expiração), routes.tsx, layout/Shell.tsx
│   ├── lib/
│   │   ├── api/          client.ts (fetch + refresh), errors.ts (códigos → pt-BR), types.ts (espelho das respostas)
│   │   ├── auth/         session.ts (store em memória), bootstrap.ts, actions.ts, guards.tsx
│   │   ├── validation/   documents.ts (CPF/CNPJ/máscaras), schemas.ts, cultivar.ts, harvest.ts (zod)
│   │   ├── geo/          geo.ts (área, limites, SVG, célula ERA5)
│   │   └── msa/          msa.ts (severidade, faixas fenológicas, formatação, safra sugerida), csv.ts
│   ├── components/       ui.tsx (Button, Input, Select, FormField…), states.tsx, toast.tsx, dialog.tsx
│   ├── features/
│   │   ├── auth/         Login, Cadastro, Verifique/Verificar e-mail, Esqueci/Redefinir senha
│   │   ├── properties/   api.ts (hooks), lista, formulário (+ UserPicker), detalhe
│   │   ├── fields/       api.ts, MapView, PolygonEditor, FieldForm/Detail/List/Thumbnail, /talhoes
│   │   ├── cultivars/    api.ts (+ useReferenceCultivar, useSyncReference), lista (referência × próprias), formulário por grupos pré-preenchido da referência
│   │   ├── harvests/     api.ts, lista com filtros, formulário, HarvestPage (cabeçalho + MsaPanel)
│   │   ├── msa/          api.ts, useMsaPolling, MsaPanel, YieldSummary, SoilWaterAtEmergence, MsaHeader (+ CSV), PhaseTimeline, PhaseCards, MsaCharts, RunsTable, SeasonStory, CropTimeline
│   │   └── admin/        contagens das filas + ações (ingest-latest, backfill-region, process-all) + jobs da sessão
│   ├── test/setup.ts
│   ├── index.css · main.tsx
├── e2e/                  Playwright: smoke.spec.ts (auth/propriedades/talhões), msa.spec.ts (safra com Ym → painel → bloco Produtividade → CSV; admin)
├── Dockerfile            build → nginx:1.25-alpine com os estáticos
└── vite.config.ts · tailwind.config.ts · playwright.config.ts · eslint.config.js
```

## Rotas

| Rota | Página | Acesso |
|---|---|---|
| `/entrar`, `/cadastro`, `/esqueci-senha` | autenticação | públicas; com sessão redirecionam para `/propriedades` |
| `/verifique-seu-email`, `/verificar-email/:token`, `/redefinir-senha?token=` | pós-cadastro e links de e-mail | públicas |
| `/propriedades`, `/propriedades/nova`, `/propriedades/:id`, `/propriedades/:id/editar` | propriedades | autenticado (escrita: AGRONOMO/ADMIN) |
| `/propriedades/:id/talhoes/novo`, `/:fieldId`, `/:fieldId/editar` | talhões | idem |
| `/talhoes` | talhões agrupados por propriedade | autenticado |
| `/cultivares`, `/cultivares/nova`, `/cultivares/:id` (leitura), `/cultivares/:id/editar` | cultivares | autenticado (escrita: AGRONOMO/ADMIN; referência só leitura) |
| `/safras`, `/safras/nova`, `/safras/:id` (`/safras/:id/msa` redireciona) | safras e painel MSA | autenticado (escrita e reprocessar: AGRONOMO/ADMIN) |
| `/admin` | filas BullMQ: contagens e ações; estações e correção de viés | ADMIN (outros veem "Sem permissão") |
| `/admin/usuarios` | administração de contas (editar, desativar/reativar, reenviar verificação, role) | ADMIN |
| `/perfil` | dados próprios, troca de senha, role e verificação | autenticado |

## Fluxo de autenticação

- **Token só em memória** (`lib/auth/session.ts`): `accessToken` e `user` num store de módulo com `useSyncExternalStore`. Nada em `localStorage`/`sessionStorage`.
- **Cookie de refresh**: `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, emitido pela API. O cliente envia `credentials: 'include'` só em `/auth/*`.
- **Mesma origem**: a SPA e a API ficam atrás do mesmo Nginx (`http://localhost` em dev); `VITE_API_BASE_URL` é relativo (`/api/v1`). Sem CORS em uso real.

```
página carrega ──► bootstrapSession(): POST /auth/refresh (cookie) ──ok──► GET /auth/me ──► session.setSession
                                                   └── falha ──► session.clear() (anônimo, sem mensagem)

api(path) ──► fetch c/ Bearer ──► 401 (fora de /auth/login|refresh|logout)?
                                     │ sim: refreshSession()  ← uma promessa compartilhada entre chamadas concorrentes
                                     │       ├── ok  ──► repete a chamada UMA vez ──► 401 de novo? ──► session.expire()
                                     │       └── falha ──► session.expire() ──► evento ──► SessionWatcher: /entrar?next=<rota>
                                     └── não: resolve/rejeita com ApiError { status, code, details?, retryAfter? }
```

Login responde `{ accessToken, user }` → `session.setSession`; logout chama `POST /auth/logout` e limpa a sessão mesmo se a API falhar. Testes em `lib/api/client.test.ts` cobrem refresh/repetição/dedupe/expiração.

## Convenções de formulário

- `react-hook-form` + `zodResolver(schema)`; schemas em `lib/validation/schemas.ts` replicam os DTOs: senha (8+, maiúscula, número, especial, ≤ 72 bytes), CPF/CNPJ (dígitos verificadores em `documents.ts`), UF, nome/município 2–120, altitude −100–5000 m, θ ∈ (0, 1) com θFC > θWP, área 0,01–1.000.000 ha.
- Campos numéricos são `string` no formulário; o schema converte (aceita vírgula decimal; vazio ⇒ `undefined`). Como o `zodResolver` v3 tipa a saída como a entrada, formulários com transformação (talhão) re-parsam no submit (`fieldSchema.parse`).
- Máscaras (CPF, CNPJ, telefone) via `Controller` + `maskX`; o payload vai sem máscara.
- Edição envia **PATCH só com o que mudou** (`diffPayload`/`buildFieldPayload`).
- `FormField` liga rótulo, ajuda e erro (`role="alert"`); `FormError` para erros fora dos campos.

## Convenções de erro

- `ApiError` carrega `status`, `code`, `details` (do `VALIDATION_ERROR` do backend: `{ campo: [mensagens] }`) e `retryAfter` (header do 429).
- `messageFor(error)` → mensagem pt-BR por código (`lib/api/errors.ts`); 5xx e falha de rede têm mensagens próprias; nunca o JSON bruto.
- `applyFieldErrors(error, setError)` distribui `details` e conflitos (`EMAIL_ALREADY_REGISTERED` → `email`, `INVALID_OWNER` → `ownerId`…) nos campos; se nada se aplicou, a página mostra `messageFor`.
- Login: 429 desabilita o botão e mostra contagem regressiva pelo `Retry-After`; 403 `EMAIL_NOT_VERIFIED` orienta a verificar o e-mail e oferece **Reenviar e-mail de verificação** (`POST /auth/resend-verification`); 403 `USER_INACTIVE` mostra "Sua conta está desativada".
- Listas/detalhes usam `LoadingState`, `EmptyState`, `ErrorState` (com "Tentar novamente"); mutações confirmam com toast; ações destrutivas passam por `ConfirmDialog`.

## Mapa e talhões

- `MapView`: `MapContainer` com `LayersControl` (OpenStreetMap padrão; "Imagem de satélite (Esri)"), `FitBounds` opcional.
- `PolygonEditor`: leaflet-geoman em pt-BR — polígono e retângulo, edição de vértices, arrastar, remover; **um polígono por talhão** (desenhar outro pede confirmação e substitui). Emite o `Polygon` GeoJSON (`layer.toGeoJSON()`, anel fechado em `[lon, lat]`).
- Área: `@turf/area` (geodésica) em ha, exibida em tempo real; só é enviada (`areaHa`) se o usuário a sobrescrever — senão o PostGIS calcula.
- `INVALID_GEOMETRY` (ou `VALIDATION_ERROR` em `geometry`) aparece num painel sobre o mapa, mantendo o polígono para correção.
- Detalhe: polígono, centróide (`CircleMarker`, evita os ícones do Leaflet) e retângulo tracejado da célula ERA5-Land (0,1°).
- Miniaturas: `FieldThumbnail` desenha o contorno em SVG estático (`polygonToSvgPath`), sem instância de mapa.

## Cultivares e safras

- **Cultivares**: só soja — não há campo de cultura (`Crop = 'SOJA'`, `CROP_LABELS` só com soja). `GET /cultivars` separa **Referência** (`isDefault`; leitura, nota FAO-56/FAO-33) de **Minhas cultivares**. O formulário agrupa os 16 parâmetros (Térmicos, Kc, Hídricos, Ky; `lib/validation/cultivar.ts` replica faixas e relações `gdaF1End < gdaF2End < gdaF3End < gdaTotal`, `zrIni ≤ zrMax`, `tUpper > tBase`, apontando o campo à direita). No grupo Térmicos, **Temperatura-base superior (°C)** (`tUpper`) é opcional: vazio ⇒ `null` no `POST`/`PATCH` (sem limite superior), pré-preenchido com 30 pela referência, com ajuda "Acima desta temperatura o dia acumula menos graus-dia (Ometto); vazio = sem limite superior."; a divergência mostra "ref. 30,0" (ou "ref. —") e o sync compara `null` como valor. **Nova cultivar nasce da referência**: `/cultivares/nova` abre pré-preenchida por `GET /cultivars/reference` (`useReferenceCultivar`; campos desabilitados até carregar) e marca, campo a campo, o que diverge da referência atual ("ref. <valor>" + resumo da divergência; também no detalhe e na lista das próprias). Ação **Atualizar a partir da referência** (`useSyncReference` → `POST /cultivars/:id/sync-reference`) com diálogo de dois modos — só os campos nunca alterados (`unchanged`) ou todos (`all`) — lista das alterações e toast com `updatedFields`. Edição de cultivar em uso é permitida: o formulário mostra a nota "Runs já calculadas guardam os parâmetros da época; as próximas usam os novos valores" (não há mais 409 `CULTIVAR_IN_USE` no PATCH nem tela de parâmetros congelados).
- **Safras**: lista com filtros status / propriedade → talhão (`?fieldId=` pré-seleciona); criação com talhão agrupado por propriedade, cultivar (referência primeiro), emergência (máx. hoje), safra sugerida por `suggestSeason` (jul–dez ⇒ ano/ano+1; jan–jun ⇒ ano−1/ano), **Produtividade potencial (sc/ha)** (opcional; `> 0` e `≤ EXPECTED_YIELD_MAX_SC_HA` = 250, constante em `lib/api/types.ts`, mensagem "informe um valor entre 0 e 250") e notas; aviso quando o talhão não tem altitude. No detalhe, a Ym é editável via PATCH junto das notas, com a dica de reprocessar (a run guarda a Ym da época). A lista mostra a Ym e, via `useMsaLatest` (o mesmo hook do `MsaBadge`), a produtividade predita (ou o índice em %) ao lado do selo de severidade. Status via PATCH (Concluir/Cancelar/Reativar) com confirmação; sem exclusão.
- **Acompanhamento**: após criar (ou ao clicar em Reprocessar), `useMsaPolling(harvestId, since)` consulta `GET /msa/runs` a cada 3 s até aparecer uma run iniciada após `since` (qualquer status) ou 10 min; ADMIN vê também o estado do job (`GET /admin/jobs/msa-process/:id`). Ao concluir, invalida as consultas do MSA.

## Painel MSA (`/safras/:id`)

- **Produtividade** (`YieldSummary.tsx`, no topo do painel, também ao ver run antiga): Ym da run, tabela por janela (Ks̄ e redução Ky·(1−Ks̄) em %), índice do ciclo, **produtividade predita em sc/ha** em destaque e "N de 4 janelas"; aviso "considera o restante do ciclo sem estresse" enquanto `phasesReached < 4` ou `currentPhase !== 'COMPLETED'`; sem Ym, mostra o índice e um link para editar a safra (AGRONOMO/ADMIN) ou "produtividade potencial não informada" (PRODUTOR); avisa quando a Ym atual da safra difere da Ym da run (reprocessar). Linhas calculadas por `yieldSummaryRows()` em `lib/msa` (testada).
- **Água no solo na emergência** (`SoilWaterAtEmergence.tsx`, dentro do bloco Produtividade; motor 2.2.0): "O talhão entrou na safra com N % da água disponível" (N = 100 − `emergenceDepletionPct`), "Depleção na emergência: X de Y mm esgotados" (Y = TAW(zrIni) dos snapshots), "Chuva nos 30 dias anteriores" (somada da série com entressafra, `useDailySeries(…, includePreSeason = true)`) e o período `preSeasonFrom → emergência − 1` com Kc/Zr; run sem `preSeasonFrom` mostra "Esta execução não tem entressafra (motor anterior); reprocesse…" com Reprocessar (AGRONOMO/ADMIN). Textos por `soilWaterTexts()` e chuva por `rainBeforeEmergence()` em `lib/msa` (testadas).
- **Cabeçalho**: intervalo, janela atual, status, run (id, data, origem, `engineVersion`), aviso **"parâmetros da cultivar mudaram desde esta run"** (`cultivarChangedSinceRun`), **selo da chuva** ("Chuva corrigida — estação X (código, N anos, D km)" a partir de `run.qmCalibration`, ou "Chuva sem correção (ERA5-Land bruto)"), Reprocessar (202 + polling), exportação CSV; aviso quando a tentativa mais recente é `NEEDS_DATA`/`FAILED` (o painel mostra a última `SUCCEEDED`).
- **Linha do tempo** (`phaseRanges`): barras proporcionais aos dias de cada janela presentes na série, datas, marcador "hoje", janelas não alcançadas tracejadas.
- **Cartões** (`windowSeverity`): Ks médio, redução de produtividade, ETc_adj e chuva acumuladas, dias; cor + rótulo **pela perda estimada** (`yieldReductionPct`): ok < 5 %, atenção 5–15 %, crítico > 15 %, cinza quando não alcançada (motor 2.3.0; antes era pelo Ks̄ — questão nº 4). A lista de safras usa o mesmo critério. Constantes espelhadas do motor em `lib/msa/msa.ts` (`LOSS_WARNING_PCT`, `LOSS_CRITICAL_PCT`, `KS_OK`, `KS_WARNING`), fixadas por teste.
- **Gráficos** (Recharts): chuva (barras) + ETc/ETc_adj (linhas) com fundo por janela; Dr × RAW × TAW; Ks com referências 0,85/0,70. Tooltip com todos os campos do dia. Alternador **"Mostrar entressafra"** (`toggle-preseason`, desligado por padrão, desabilitado sem `preSeasonFrom`): ligado, carrega `GET /msa/daily?includePreSeason=true`, os três gráficos começam em `preSeasonFrom` com a faixa cinza "Entressafra" (`preSeasonRange`) e o tooltip mostra fase "Entressafra"; a linha do tempo F1–F4 continua começando na emergência (`phaseRanges` ignora `PRE`); "Exportar série diária" exporta a série exibida (linhas `PRE` quando ligado). Datas faltantes de `NEEDS_DATA` com mais de 14 datas aparecem agrupadas por mês (`groupMissingDates`, `MissingDates.tsx`) com "ver todas as datas" em `<details>`.
- **Faixas de evento nos gráficos**: cada `stressEvents[i]` da run visualizada vira uma `ReferenceArea` hachurada em vermelho (pattern SVG `#stress-hatch`, classe `stress-area`) nos três gráficos, rotulada "estresse" no de Ks.
- **Histórico de runs**: tabela (sem semente; com índice e predita); "Ver série" troca a série dos gráficos/linha do tempo para uma run antiga (`?runId=`) com aviso e retorno.
- **"Como foi a safra"** (`SeasonStory.tsx` + `CropTimeline.tsx`, última seção, `id="resumo-da-safra"`, link "Ir para o resumo da safra" no cabeçalho; igual para os três papéis): (1) linha do tempo da cultura — barra proporcional aos dias com as janelas em linguagem do campo (`PHASE_FIELD_LABELS`: Germinação, Crescimento, Floração e enchimento, Maturação), datas, marcador "hoje", marcador "solo seco na emergência" quando `emergenceDepletionPct ≥ 70` (`DRY_EMERGENCE_PCT`) e os eventos como segmentos vermelhos ("12 dias com pouca água"), com lista `sr-only`; (2) "Momentos de estresse" — eventos do mais danoso ao menos (`rankEvents`: `deficitMm × kyDominant`), frase `eventSentence` ("12 a 23 de janeiro · 12 dias · floração e enchimento · a lavoura ficou sem cerca de 40 mm · esta é a fase que mais pesa na produção") ou `emptyEventsSentence`; (3) "Produtividade esperada" (predita em destaque, "de um potencial de 65 sacas", `lossSentence`; sem Ym só percentuais + link/texto de Ym) e "De onde veio a perda" (barras por janela em sacas ou %, maior destacada, `biggestLossSentence`); (4) rodapé `STORY_FOOTER`. Run antiga sem `stressEvents` ⇒ "Esta execução não tem a leitura da safra (motor anterior); reprocesse…"; `stressComputedOnRead` ⇒ nota "calculado agora com os parâmetros atuais". Todas as frases vêm de `lib/msa/story.ts` (`storyModel()`; datas por extenso com ano quando muda, sacas a 0,5, mm a 5), testadas.
- **CSV** (`lib/msa/csv.ts`): `;`, vírgula decimal, BOM UTF-8; `serie-diaria-<talhao-safra>-<run>.csv` e `resumos-…csv` com colunas `janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha;perda_sc_ha` (perda por janela da atribuição; vazia sem Ym) e `estresses-…csv` (`inicio;fim;dias;janela_dominante;janelas;ks_min;ks_medio;deficit_mm`, uma linha por evento); `ym_sc_ha;predita_sc_ha` (as três últimas repetidas em todas as linhas, vazias quando a run não tem Ym; sem percentis). Não há painel de decisão nem CSV de decisões.

## Administração (`/admin`)

Filas (contagens, próximo semanal e próxima recalibração anual), ações `ingest-latest`, backfill regional e `process-all`, e a seção **Estações e correção de viés**: upload de CSV de observações (BDMEP ou genérico com metadados; `fetch` com `FormData` fora do `api()`, que envia JSON), tabelas de estações (`GET /admin/stations`) e calibrações (`GET /admin/qm/calibrations`), botões **Calibrar todas as células** e **Calibrar célula** (`POST /admin/qm/calibrate`). Todos os 202 entram em "Jobs desta sessão" com polling de estado.

## Infra

- **Dev**: serviço `frontend` (node:20-alpine, Vite com `--host`, `node_modules` em volume anônimo). `nginx.dev.conf`: `/api/` → API; `/` → `frontend:5173` com upgrade de WebSocket (HMR). Acesse `http://localhost`. O Vite também faz proxy de `/api` (`VITE_DEV_API_PROXY`), então `http://localhost:5173` funciona sozinho.
- **Prod**: `frontend/Dockerfile` (build → `nginx:1.25-alpine` + `/usr/share/nginx/html`). O serviço `nginx` do `docker-compose.prod.yml` usa essa imagem (`${ECR_REPOSITORY_WEB:-fertiliza-web}`) e continua montando `nginx.prod.conf`: `try_files … /index.html`, `expires 1y` em `/assets/` (hash no nome), `expires -1` em `index.html`.
- `FRONTEND_URL` do backend = origem servida pelo Nginx (`http://localhost` em dev): CORS e links dos e-mails (`/verificar-email/:token`, `/redefinir-senha?token=`).

## Testes

```bash
cd frontend
pnpm test                         # unitários: validadores/máscaras, cliente HTTP, guards, geo
pnpm e2e                          # Playwright contra http://localhost (stack no ar; lê o link do e-mail em `docker compose logs api`)
                                  # msa.spec.ts exige worker + etl e o cache do ETL da célula de Goiânia (como o e2e-orchestration.sh);
                                  # sem ERA5_E2E_CDS=1 faz `touch` no cache para não ir ao CDS
pnpm exec playwright install chromium   # primeira vez
```

## Manual do usuário (`docs/manual/`)

As imagens do manual são geradas por Playwright, fora da suíte e2e e fora do CI:

```bash
pnpm manual:capture   # na raiz: captura as telas e confere a consistência do manual
pnpm manual:pdf       # na raiz: gera docs/manual/manual-completo.pdf
```

- **`frontend/e2e/manual/capture.spec.ts`** (config própria: `playwright.manual.config.ts`, 1440×900, `deviceScaleFactor` 1,5, `--lang=pt-BR` para os campos de data). O `playwright.config.ts` da suíte ignora `e2e/manual/`.
- **Dados de demonstração**: três usuários do domínio reservado `@manual.fertilizacerrado.local`, a Fazenda Boa Vista, dois talhões no único trecho de pasto da célula ERA5 em cache (−16,7; −49,3), uma cultivar própria e duas safras. A safra do painel é soja 2025/26 com emergência em 2025-10-01, escolhida por ter estresse real na floração; o motor é determinístico, então os valores (Ym, índice do ciclo, predita) são reproduzíveis sem semente.
- **Limpeza**: `backend/scripts/manual/cleanup-demo.sql` roda antes e depois, e apaga só o que pertence ao domínio reservado (a API não tem exclusão de safra nem de usuário). `MANUAL_KEEP_DATA=1` mantém os dados para depuração.
- **Pré-requisitos**: stack no ar com `worker` e `etl`, admin semeado, internet para os tiles do mapa e o cache do ETL com os meses da célula de Goiânia desde **2025-02** (início do spin-up de entressafra da safra de exemplo — motor 2.2.0; backfill único via CDS, `docs/msa/era5-etl.md`). A captura falha com mensagem clara se faltar cache ou se os tiles não carregarem. Ela não vai ao CDS: a ingestão disparada pela criação das safras é servida pelo cache.
- **Publicação atômica**: as imagens são gravadas em `frontend/test-results/manual/img` e só substituem `docs/manual/img` se todos os capítulos passarem. O `img/captura.json` guarda os valores citados no capítulo 6.
- **Consistência** (`frontend/scripts/manual-check.mjs`, ao fim da captura e antes do PDF): imagem ausente, imagem órfã, link ou âncora quebrados, aviso de responsabilidade técnica e valores marcados no capítulo 6 com `<!-- valor:caminho|casas -->` diferentes do `captura.json`.
- **PDF** (`frontend/scripts/manual-pdf.mjs`): `marked` + Chromium do Playwright; capa, sumário, um capítulo por seção, figuras numeradas. Imagens acima de 300 KB entram como JPEG só dentro do PDF.
