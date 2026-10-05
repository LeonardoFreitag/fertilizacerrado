## 1. Backend — acréscimos para a interface

- [x] 1.1 `GET /api/v1/auth/me` (autenticado → `PublicUser`); testes unitários do controller/serviço; `docs/modulos/auth.md`
- [x] 1.2 Módulo `src/modules/users/` com `GET /api/v1/users?q=&role=&limit=` (ADMIN qualquer role; AGRONOMO só PRODUTOR com `q` ≥ 3; PRODUTOR 403; máx. 50, padrão 20, ordem por nome); DTO zod; testes; montar em `app.ts`; `docs/modulos/propriedades.md`
- [x] 1.3 `utils/mailer.ts`: links `${FRONTEND_URL}/verificar-email/<token>` e `${FRONTEND_URL}/redefinir-senha?token=<token>`; `.env.example` com `FRONTEND_URL=http://localhost`, `VITE_API_BASE_URL`, `ECR_REPOSITORY_WEB`; ajustar `last_verify_token`/`last_token` nos roteiros e2e (`e2e-auth`, `e2e-properties`, `e2e-cultivars-harvests`, `e2e-msa`, `e2e-era5`, `e2e-orchestration`) e rodar `e2e-auth.sh`

## 2. Fundação do frontend

- [x] 2.1 `frontend/` com Vite + React 18 + TS strict + Tailwind 3; `package.json` (pnpm 9.15.4, engines), ESLint (typescript-eslint, react-hooks), Prettier, Vitest + jsdom + Testing Library, scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `e2e`; `vite.config.ts` (`server.host`, proxy `/api` → `http://api:3000`); `.gitignore` (node_modules, dist, playwright-report, test-results)
- [x] 2.2 `src/lib/api/`: `client.ts` (fetch, Bearer, `credentials` só em `/auth/*`, refresh único deduplicado, retentativa única, `ApiError` com `retryAfter`), `errors.ts` (mapa código → mensagem pt-BR, `applyFieldErrors` para `VALIDATION_ERROR`), `types.ts` (espelho de `PublicUser`, `PropertyResponse`, `FieldResponse`, `UserSummary`, GeoJSON)
- [x] 2.3 `src/lib/auth/`: `session.ts` (store em memória + listeners + evento expirada), `useSession`, `bootstrapSession` (refresh → `/me`), `RequireAuth`, `RequireRole`, `PublicOnly`
- [x] 2.4 `src/lib/validation/`: `cpf.ts`, `cnpj.ts` (dígitos verificadores), `masks.ts` (CPF, CNPJ, telefone), schemas zod `register`, `login`, `passwordReset`, `property`, `field` (UF, θFC > θWP, altitude, área, Polygon fechado)
- [x] 2.5 `src/components/`: Button, Input, Select, Textarea, FormField (rótulo + erro + ajuda), Modal/ConfirmDialog, Toast + `useToast`, LoadingState, EmptyState, ErrorState, PageHeader
- [x] 2.6 `src/app/`: providers (QueryClient, Session, Toast), router com as rotas pt-BR, `Shell` (Sidebar com Propriedades/Talhões/Safras "em breve"/Admin por role, Header com usuário/role/Sair, menu recolhível), página "Sem permissão", 404
- [x] 2.7 Testes unitários: validadores e máscaras (tabelas), `client.ts` com `fetch` mockado (401 → refresh → repete; refresh 401 → sessão limpa + evento; 3 concorrentes → 1 refresh; `Retry-After`; sem refresh em `/auth/login`), guards com `MemoryRouter`

## 3. Autenticação

- [x] 3.1 Páginas `/entrar` (erros `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, 429 com contagem regressiva por `Retry-After`; `next`), `/cadastro` (role, PF/PJ com máscara e validação, indicador de regras da senha, CREA/telefone opcionais; 409 por campo) → `/verifique-seu-email`
- [x] 3.2 Páginas `/verificar-email/:token` (chama a API, sucesso/erro), `/esqueci-senha`, `/redefinir-senha?token=` (confirmação de senha), ação Sair (`/auth/logout` + limpar sessão)
- [x] 3.3 Bootstrap da sessão na inicialização e redirecionamento em sessão expirada preservando `next`

## 4. Propriedades

- [x] 4.1 `features/properties/api.ts` (queries/mutations TanStack: lista, detalhe, criar, editar, excluir; busca de usuários `['users', role, q]` com debounce)
- [x] 4.2 `/propriedades` (cards, busca local sem acento/caixa, estado vazio com "Nova propriedade", ações por role)
- [x] 4.3 `PropertyForm` (nome, UF, município, CAR, NIRF; `UserPicker` para dono: obrigatório para ADMIN, opcional para AGRONOMO; erros `INVALID_OWNER`/`INVALID_AGRONOMIST`/`VALIDATION_ERROR` por campo; PATCH só com alterados) em `/propriedades/nova` e `/:id/editar`
- [x] 4.4 `/propriedades/:id` (dados, dono/agrônomo, Editar/Excluir por role com confirmação, lista de talhões com miniatura e aviso de altitude, "Novo talhão"; 404 → "Propriedade não encontrada")

## 5. Talhões e mapa

- [x] 5.1 `src/lib/geo/`: `areaHa` (@turf/area), `closeRing`/`toPolygon` ([lon, lat] fechado), `bounds`, `polygonToSvgPath` (miniatura), `era5CellBounds` (0,1° em torno da célula); testes
- [x] 5.2 `MapView` (react-leaflet, `LayersControl` OSM + Esri World Imagery com atribuição, CSS do Leaflet) e `PolygonEditor` (leaflet-geoman: desenhar/editar/remover, um polígono, substituição com confirmação, carregar polígono existente, callback de mudança)
- [x] 5.3 `FieldForm` em `/propriedades/:id/talhoes/novo` e `/:fieldId/editar`: mapa + campos (nome, solo, observações, altitude com destaque "obrigatória para o MSA", θFC/θWP com sugestão 0,28/0,12 e explicação), área calculada em tempo real e sobrescrevível (só envia `areaHa` se sobrescrita), "Desenhe o talhão no mapa", painel de `INVALID_GEOMETRY`/erro em `geometry` sobre o mapa; centro inicial pelos talhões existentes ou Goiânia
- [x] 5.4 `/propriedades/:id/talhoes/:fieldId` (polígono ajustado, centróide, retângulo da célula ERA5 com lat/lon ou aviso, área/solo/observações/altitude/θ com indicação de defaults, Editar/Excluir com mapeamento de 409)
- [x] 5.5 `FieldThumbnail` (SVG) e `/talhoes` agrupado por propriedade (`useQueries`)
- [x] 5.6 `/admin`: contagens de `GET /admin/jobs/queues` + próxima execução semanal (horário de Brasília), botão Atualizar

## 6. Infra de desenvolvimento e produção

- [x] 6.1 `docker-compose.yml`: serviço `frontend` (node:20-alpine, volume `./frontend:/app` + anônimo `node_modules`, corepack + `pnpm install --frozen-lockfile` + `pnpm dev --host`, porta 5173, `VITE_API_BASE_URL`); `nginx` `depends_on frontend`; `nginx/nginx.dev.conf` com `frontend_upstream`, `map $http_upgrade`, `location /` com upgrade; `docker compose up -d --build`; HMR verificado em `http://localhost`
- [x] 6.2 `frontend/Dockerfile` multi-stage (ARG `VITE_API_BASE_URL`); `nginx/nginx.prod.conf` (`root`, `try_files … /index.html`, `expires 1y` em `/assets/`, `expires -1` em `= /index.html`); `docker-compose.prod.yml` com `nginx` na imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_WEB:-fertiliza-web}:${IMAGE_TAG:-latest}`; `docker compose -f docker-compose.prod.yml config` válido; build local da imagem e teste de fallback em rota profunda com `nginx.prod.conf` (sem TLS, via `curl` interno ou conf de teste)

## 7. Verificação e documentação

- [x] 7.1 Playwright (`frontend/e2e/smoke.spec.ts`, Chromium, `baseURL http://localhost`): cadastro → link de verificação lido de `docker compose logs api` → login → nova propriedade → talhão desenhado (cliques no mapa) → área e célula ERA5 na tela → logout; `pnpm e2e` passando contra a stack
- [x] 7.2 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` limpos; roteiros e2e do backend passando após a troca dos links
- [x] 7.3 `docs/modulos/frontend.md` (stack, estrutura de pastas, fluxo de autenticação com diagrama de sequência do refresh, convenções de formulário e de erro, mapa, como rodar testes/Playwright); `docs/arquitetura.md` (serviço `frontend` em dev, estáticos no nginx em prod, imagem `fertiliza-web`, estrutura de pastas); `backend/scripts/e2e/README.md` (links dos e-mails)
