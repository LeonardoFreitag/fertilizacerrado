## Why

A API da Fase 1 (auth, propriedades/talhões, cultivares/safras, MSA e orquestração) só é acessível por `curl` e roteiros. O técnico agrônomo — usuário-alvo da dissertação — precisa de uma interface para cadastrar clientes, desenhar talhões no mapa e, nas próximas changes, acompanhar as janelas fenológicas e registrar decisões. Esta change cria a fundação do frontend (stack, sessão, layout, infra de dev e de produção) e entrega as duas primeiras áreas funcionais, autenticação e propriedades/talhões, que são pré-requisito de tudo o que vem depois (safras e painel do MSA).

## What Changes

- **Aplicação web** em `frontend/` (pacote pnpm independente): React 18 + Vite + TypeScript estrito + TailwindCSS; react-router com rotas protegidas por role; TanStack Query; react-hook-form + zod replicando as regras dos DTOs do backend (CPF/CNPJ, senha, UF, GeoJSON, `thetaFC > thetaWP`); interface inteira em pt-BR, desktop como alvo e utilizável no celular.
- **Sessão**: access token só em memória; renovação pelo cookie HttpOnly `refreshToken` já emitido pela API; cliente HTTP que, em 401, faz um único refresh (deduplicado entre requisições concorrentes) e repete a chamada; falha ⇒ logout e redirecionamento para o login preservando a rota de retorno. Restauração da sessão ao recarregar a página via refresh + `GET /auth/me`.
- **Telas de autenticação**: login, cadastro (AGRONOMO/PRODUTOR, PF/PJ com máscara e validação de CPF/CNPJ, CREA opcional), aviso "verifique seu e-mail", verificação (`/verificar-email/:token`), esqueci/redefinir senha, logout; mensagens mapeadas dos códigos da API (403 `EMAIL_NOT_VERIFIED`, 429 com `Retry-After`, conflitos de e-mail/CPF/CNPJ, `VALIDATION_ERROR` por campo).
- **Shell**: barra lateral (Propriedades, Talhões, Safras — desabilitada, "em breve" —, Admin só para ADMIN), cabeçalho com usuário e role, toasts, estados de carregando/vazio/erro padronizados.
- **Propriedades**: lista com busca, criar/editar (nome, UF, município, CAR, NIRF; ADMIN escolhe o produtor dono; AGRONOMO opcionalmente informa o produtor), detalhe com talhões, exclusão só para ADMIN com confirmação; PRODUTOR somente leitura.
- **Talhões**: editor com mapa (react-leaflet + leaflet-geoman; camadas OpenStreetMap e Esri World Imagery com seletor), área calculada e sobrescrevível, nome, solo, observações, altitude com destaque "obrigatória para o MSA", θFC/θWP com defaults 0,28/0,12 explicados; erros `INVALID_GEOMETRY` exibidos no mapa; detalhe com centróide e célula ERA5; lista com miniatura do polígono.
- **Backend (pequenos acréscimos exigidos pela interface)**: `GET /api/v1/auth/me` (perfil do usuário autenticado, para restaurar a sessão); `GET /api/v1/users` (diretório mínimo para escolher o produtor dono: ADMIN pesquisa qualquer usuário, AGRONOMO só PRODUTOR com busca de ≥ 3 caracteres); links dos e-mails de verificação e de redefinição passam a apontar para as páginas do frontend (`FRONTEND_URL/verificar-email/:token`, `FRONTEND_URL/redefinir-senha?token=`). **BREAKING** para quem dependia do link de verificação apontar direto para a API (os roteiros e2e que leem o link no log são ajustados nesta change).
- **Infra dev**: serviço `frontend` no `docker-compose.yml` (node:20-alpine, Vite na 5173, hot-reload por volume); `nginx.dev.conf` passa a servir `/` → `frontend:5173` com upgrade de WebSocket (HMR) e mantém `/api/` → API. Tudo em `http://localhost`; `FRONTEND_URL` do backend passa a `http://localhost` no `.env.example`.
- **Infra prod**: `frontend/Dockerfile` multi-stage (build Vite → estáticos na imagem do nginx); o serviço `nginx` do `docker-compose.prod.yml` usa essa imagem (`${ECR_REGISTRY}/${ECR_REPOSITORY_WEB}:${IMAGE_TAG}`); `nginx.prod.conf` serve a SPA com fallback `try_files … /index.html`, cache longo para `/assets/` (nomes com hash) e sem cache para `index.html`. Sem serviço `frontend` separado em produção.
- **Verificação**: Vitest + Testing Library (máscaras/validadores, cliente HTTP com refresh, guards por role); Playwright smoke contra a stack de dev (cadastro → verificação via link do log → login → propriedade → talhão desenhado → área e célula ERA5 → logout); `pnpm build` limpo; imagem de produção serve a SPA com fallback em rota profunda.
- **Docs**: `docs/modulos/frontend.md` (stack, pastas, fluxo de autenticação, convenções de formulário e de erro); `docs/arquitetura.md` (serviço `frontend` em dev, estáticos no nginx em prod).

## Capabilities

### New Capabilities
- `web-shell`: aplicação SPA em `frontend/` — stack, configuração da API, rotas protegidas por role, layout (barra lateral, cabeçalho), estados padronizados, toasts, qualidade (typecheck, testes, build).
- `web-auth`: sessão no navegador (token em memória, refresh pelo cookie, retentativa única, restauração ao carregar) e telas de login, cadastro, verificação de e-mail, recuperação de senha e logout, com mapeamento dos erros da API.
- `web-properties`: lista, cadastro, edição, detalhe e exclusão de propriedades na interface, respeitando o escopo por role.
- `web-fields`: editor de talhões com mapa (desenho/edição de polígono, camadas, área), campos agronômicos com orientação, erros de geometria no mapa, detalhe com centróide/célula ERA5 e lista com miniaturas.
- `user-directory`: endpoint `GET /api/v1/users` para localizar usuários (produtor dono) a partir da interface, com escopo por role.

### Modified Capabilities
- `user-auth`: os e-mails de verificação e de redefinição passam a apontar para as páginas do frontend; novo endpoint `GET /api/v1/auth/me` com o perfil do usuário autenticado.
- `reverse-proxy`: `nginx.dev.conf` serve `/` pelo dev server do frontend (com WebSocket) além de `/api/`; `nginx.prod.conf` entrega os estáticos da SPA com fallback e política de cache.
- `container-infrastructure`: serviço `frontend` na stack de desenvolvimento; serviço `nginx` de produção construído a partir de `frontend/Dockerfile`; `.env.example` com `ECR_REPOSITORY_WEB`, `VITE_API_BASE_URL` e `FRONTEND_URL=http://localhost`.

## Impact

- **Novo pacote** `frontend/` (React, Vite, Tailwind, react-router, TanStack Query, react-hook-form, zod, react-leaflet, leaflet, leaflet-geoman, @turf/area, Vitest, Testing Library, Playwright). Não entra no `package.json` do backend.
- **Backend**: `auth.routes.ts`/`auth.controller.ts` (`GET /me`), novo módulo `users` (`GET /users`), `utils/mailer.ts` (links), `.env.example`. Sem migration.
- **Infra**: `docker-compose.yml` (serviço `frontend`), `docker-compose.prod.yml` (imagem do `nginx`), `nginx/nginx.dev.conf`, `nginx/nginx.prod.conf`, `frontend/Dockerfile`, `.gitignore` (`frontend/node_modules`, `frontend/dist`, relatórios do Playwright).
- **Roteiros e2e** do backend: `last_verify_token`/`last_token` passam a procurar `verificar-email/` e `redefinir-senha?token=` no log da API.
- **Docs**: `docs/modulos/frontend.md` (novo), `docs/arquitetura.md`, `docs/modulos/auth.md` (links dos e-mails, `/me`), `docs/modulos/propriedades.md` (`/users`).
