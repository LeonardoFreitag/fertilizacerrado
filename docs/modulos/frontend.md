# Frontend — aplicação web do técnico

Aplicação SPA em `frontend/` que consome a API (`/api/v1`). Idioma pt-BR em toda a interface; desktop como alvo, utilizável no celular. Cobre a Fase 1 inteira: fundação (sessão, layout, infra), **autenticação**, **propriedades/talhões**, **cultivares**, **safras** e o **painel MSA** (janelas, gráficos, cenários e decisões), além da administração das filas.

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
│   │   ├── cultivars/    api.ts, lista (referência × próprias), formulário por grupos
│   │   ├── harvests/     api.ts, lista com filtros, formulário, HarvestPage (cabeçalho + MsaPanel)
│   │   ├── msa/          api.ts, useMsaPolling, MsaPanel, MsaHeader (+ CSV), PhaseTimeline, PhaseCards, MsaCharts, DecisionPanel, RunsTable
│   │   └── admin/        contagens das filas + ações (ingest-latest, backfill-region, process-all) + jobs da sessão
│   ├── test/setup.ts
│   ├── index.css · main.tsx
├── e2e/                  Playwright: smoke.spec.ts (auth/propriedades/talhões), msa.spec.ts (safra → painel → decisão → CSV; admin)
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

- **Cultivares**: `GET /cultivars` separa **Referência** (`isDefault`; leitura, nota FAO-56/FAO-33) de **Minhas cultivares**. O formulário agrupa os 15 parâmetros (Térmicos, Kc, Hídricos, Ky; `lib/validation/cultivar.ts` replica faixas e relações `gdaF1End < gdaF2End < gdaF3End < gdaTotal`, `zrIni ≤ zrMax`, apontando o campo à direita). A API não expõe "em uso": um 409 `CULTIVAR_IN_USE` no PATCH congela os grupos de parâmetros e oferece reenviar só nome/descrição.
- **Safras**: lista com filtros status / propriedade → talhão (`?fieldId=` pré-seleciona); criação com talhão agrupado por propriedade, cultivar (referência primeiro), emergência (máx. hoje), safra sugerida por `suggestSeason` (jul–dez ⇒ ano/ano+1; jan–jun ⇒ ano−1/ano) e notas; aviso quando o talhão não tem altitude. Status via PATCH (Concluir/Cancelar/Reativar) com confirmação; sem exclusão.
- **Acompanhamento**: após criar (ou ao clicar em Reprocessar), `useMsaPolling(harvestId, since)` consulta `GET /msa/runs` a cada 3 s até aparecer uma run iniciada após `since` (qualquer status) ou 10 min; ADMIN vê também o estado do job (`GET /admin/jobs/msa-process/:id`). Ao concluir, invalida as consultas do MSA.

## Painel MSA (`/safras/:id`)

- **Cabeçalho**: intervalo, janela atual, status, run (id, data, origem, semente, iterações/σ, `engineVersion`), **selo da chuva** ("Chuva corrigida — estação X (código, N anos, D km)" a partir de `run.qmCalibration`, ou "Chuva sem correção (ERA5-Land bruto)"), Reprocessar (202 + polling), exportação CSV; aviso quando a tentativa mais recente é `NEEDS_DATA`/`FAILED` (o painel mostra a última `SUCCEEDED`).
- **Linha do tempo** (`phaseRanges`): barras proporcionais aos dias de cada janela presentes na série, datas, marcador "hoje", janelas não alcançadas tracejadas.
- **Cartões** (`severity`): Ks médio, percentis P10/P50/P90, redução de produtividade, ETc_adj e chuva acumuladas, dias/iterações; cor + rótulo: ok ≥ 0,85, atenção 0,70–0,85, crítico < 0,70, cinza quando não alcançada.
- **Gráficos** (Recharts): chuva (barras) + ETc/ETc_adj (linhas) com fundo por janela; Dr × RAW × TAW; Ks com referências 0,85/0,70. Tooltip com todos os campos do dia.
- **Cenários**: janela, dose base e eficiência base (debounce 400 ms) → `GET /msa/decision` → A/B/C com racional; B indisponível mostra `bUnavailableReason`; "Registrar decisão X" abre justificativa obrigatória → `POST /msa/decisions` com `runId`. Lista de decisões abaixo. PRODUTOR vê sem botões.
- **Histórico de runs**: tabela; "Ver série" troca a série dos gráficos/linha do tempo para uma run antiga (`?runId=`) com aviso e retorno.
- **CSV** (`lib/msa/csv.ts`): `;`, vírgula decimal, BOM UTF-8; `serie-diaria-<talhao-safra>-<run>.csv` e `resumos-…csv`.

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
