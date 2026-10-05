## Context

A API está completa para a Fase 1 e documentada por módulo; não existe `frontend/`. O Nginx de dev só encaminha `/api/`; o de produção só faz proxy da API com rate limiting e TLS. A autenticação já foi desenhada para um SPA: access token curto (15 min) devolvido no corpo, refresh token em cookie `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, rotação a cada refresh, `cors({ origin: FRONTEND_URL, credentials: true })`. Os e-mails hoje apontam a verificação para a própria API (`APP_URL/api/v1/auth/verify-email/:token`) e a redefinição para `FRONTEND_URL/reset-password?token=`.

Restrições: pnpm; Node 20; pt-BR; sem segredos no repositório; a stack de dev continua sendo `docker compose up` na raiz; produção continua EC2 + Compose (Fase 1 de escala), sem CDN.

## Goals / Non-Goals

**Goals:**
- Fundação reutilizável: cliente HTTP com sessão, formulários tipados, layout, estados, testes — as changes de safras e do painel MSA só acrescentam páginas.
- Mesma origem em dev e em prod (`/` e `/api/` atrás do mesmo Nginx), para o cookie de refresh funcionar sem CORS e sem `SameSite=None`.
- Mapa útil para o técnico: desenhar e corrigir o polígono sobre imagem de satélite, ver a área e a célula ERA5 que alimentará o MSA.
- Replicar as regras de validação do backend no cliente para feedback imediato, mantendo o backend como fonte de verdade.

**Non-Goals:**
- Telas de safras, cultivares, MSA e decisões (próximas changes); a entrada "Safras" fica desabilitada.
- Painel administrativo completo; "Admin" mostra só as contagens das filas (endpoint já existente), como destino da entrada do menu.
- Edição multiusuário de talhões, importação de KML/shapefile, offline, PWA, internacionalização além de pt-BR.
- Design system próprio ou biblioteca de componentes pesada; Tailwind + um punhado de componentes locais.

## Decisions

### 1. Pacote independente, Vite + React 18, TypeScript estrito, Tailwind 3
`frontend/` tem o próprio `package.json` (`packageManager: pnpm@9.15.4`, `engines node >= 20`), sem workspace na raiz: backend e frontend são publicados como imagens distintas e os lockfiles não se misturam. React 18.3 (pedido explícito; react-leaflet 4 é compatível), Vite 6, `strict` + `noUncheckedIndexedAccess`. Tailwind 3.4 via PostCSS (configuração conhecida e estável; migrar para 4 é mecânico). Alternativas: Next.js (SSR desnecessário — app autenticada atrás de login; complicaria a entrega como estáticos no Nginx) e CRA (descontinuado).

### 2. Roteamento e guards
`react-router` 7 em modo declarativo (`BrowserRouter`). Rotas em pt-BR: `/entrar`, `/cadastro`, `/verifique-seu-email`, `/verificar-email/:token`, `/esqueci-senha`, `/redefinir-senha` (`?token=`), `/propriedades`, `/propriedades/nova`, `/propriedades/:id`, `/propriedades/:id/editar`, `/propriedades/:id/talhoes/novo`, `/propriedades/:id/talhoes/:fieldId`, `/propriedades/:id/talhoes/:fieldId/editar`, `/talhoes`, `/safras` (placeholder), `/admin`. `RequireAuth` espera a restauração da sessão (spinner) e redireciona para `/entrar?next=<rota>` sem sessão; `RequireRole roles=[…]` renderiza a página "Sem permissão" (não redireciona, para o usuário entender o que aconteceu). Páginas públicas redirecionam para `/propriedades` quando já há sessão.

### 3. Cliente HTTP próprio com fila de refresh
`src/lib/api/client.ts` sobre `fetch` (sem axios: ~60 linhas cobrem o necessário e evitam uma dependência). Estado da sessão em um store em memória (`src/lib/auth/session.ts`: `accessToken`, `user`, listeners) — nunca `localStorage`/`sessionStorage`; recarregar a página perde o token e **restaura** pela cadeia `POST /auth/refresh` (cookie) → `GET /auth/me`. Regras do interceptor:
- Envia `Authorization: Bearer` quando há token; `credentials: 'include'` só nas rotas `/auth/*` (o cookie já é restrito a esse path).
- Em `401` de uma rota não-auth: executa **um** `POST /auth/refresh` compartilhado por todas as requisições concorrentes (promessa única em módulo), atualiza o token e **repete a requisição original uma vez**. Segundo 401 ou refresh falho ⇒ `session.clear()` + evento `session:expired` ⇒ o roteador manda para `/entrar?next=`.
- Nunca tenta refresh para `POST /auth/login`, `/auth/refresh` e `/auth/logout` (evita laço).
- Erros viram `ApiError { status, code, message, details?, retryAfter? }`; `Retry-After` lido do header do 429.
Alternativas: axios + interceptors (mais código de adaptação, mesmo resultado); token no `localStorage` (vulnerável a XSS; descartado pelo requisito).

### 4. `GET /auth/me` e `GET /users` no backend
O refresh devolve só o `accessToken` e o JWT carrega apenas `sub`/`role`; para preencher o cabeçalho (nome, e-mail) depois de recarregar, a API ganha `GET /api/v1/auth/me` (autenticado → `PublicUser`). Para o ADMIN escolher o dono e o AGRONOMO vincular um produtor, a API ganha `GET /api/v1/users?q=&role=&limit=` (módulo `users`): ADMIN pesquisa qualquer role; AGRONOMO só `PRODUTOR` e com `q` de pelo menos 3 caracteres (não lista a base inteira); PRODUTOR 403. Responde `UserSummary + role`, máximo 20. Alternativa considerada: digitar o UUID — inviável para o técnico. Trade-off de privacidade registrado em Risks.

### 5. E-mails apontam para o frontend
`mailer.ts`: verificação → `${FRONTEND_URL}/verificar-email/${token}`; redefinição → `${FRONTEND_URL}/redefinir-senha?token=${token}`. A página de verificação chama `GET /api/v1/auth/verify-email/:token` e mostra sucesso/erro; a de redefinição envia `POST /auth/reset-password`. Em dev, `FRONTEND_URL=http://localhost` (Nginx). Os roteiros e2e do backend leem o token no log da API procurando `verificar-email/` e `redefinir-senha?token=`.

### 6. Mesma origem: Nginx em dev e em prod
Dev: `nginx.dev.conf` ganha `upstream frontend_upstream { server frontend:5173; }` e `location / { proxy_pass …; proxy_http_version 1.1; Upgrade/Connection $connection_upgrade; }` (`map $http_upgrade $connection_upgrade`), mantendo `/api/` antes. O Vite roda com `server.host: true` e `server.proxy['/api'] → http://api:3000`, então `http://localhost:5173` direto também é mesma origem (útil fora do Nginx). `VITE_API_BASE_URL` default `/api/v1` — caminho relativo, sem host.
Prod: `frontend/Dockerfile` (`node:20-alpine` → `pnpm build` → `nginx:1.25-alpine` com `COPY dist /usr/share/nginx/html`). O serviço `nginx` do prod usa essa imagem (`${ECR_REGISTRY}/${ECR_REPOSITORY_WEB:-fertiliza-web}:${IMAGE_TAG:-latest}`) e continua montando `nginx.prod.conf`, SSL, certbot e logs — a imagem só acrescenta os estáticos; a configuração permanece no repositório. No bloco 443: `root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; }`, `location /assets/ { expires 1y; add_header... }` — como `add_header` dentro de location descartaria os headers de segurança herdados, o cache usa a diretiva `expires` (que não tem esse efeito): `expires 1y` em `/assets/` (nomes com hash do Vite) e `expires -1` (`Cache-Control: no-cache`) em `= /index.html`. Alternativa: serviço `frontend` separado em prod (mais um contêiner e um salto de rede para servir arquivos estáticos — sem ganho).

### 7. Formulários e validação espelhada
`react-hook-form` + `zodResolver`. Os schemas ficam em `src/lib/validation/` e replicam os DTOs: `password` (8+, maiúscula, número, especial, ≤ 72 bytes), `cpf`/`cnpj` (dígitos verificadores, mesma lógica de `utils/cpf.util.ts`/`cnpj.util.ts`), UF (lista), `name` 2–120, `city` 2–120, `altitudeM` −100–5000, `theta` em (0, 1) com `thetaFC > thetaWP`, `areaHa` 0,01–1.000.000, GeoJSON Polygon fechado. Máscaras escritas à mão (CPF, CNPJ, telefone) — sem biblioteca; valores enviados sem máscara. `VALIDATION_ERROR` da API (`details` com `path`) alimenta `setError` por campo; o backend continua a fonte de verdade.

### 8. Mapa
`react-leaflet` 4 + `leaflet` 1.9 + `@geoman-io/leaflet-geoman-free` 2.x (componente `PolygonEditor` que liga o geoman ao mapa via `useMap`). Camadas OpenStreetMap (padrão) e Esri World Imagery (`server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, atribuição Esri) no `LayersControl`. Um polígono por talhão: desenhar outro substitui o anterior (confirmação). Área calculada com `@turf/area` (geodésica, m² → ha, 2 decimais) exibida em tempo real; o campo `areaHa` só é enviado quando o usuário o sobrescreve — caso contrário omitido e o PostGIS calcula. Geometria enviada como `Polygon` `[lon, lat]` com anel fechado. `INVALID_GEOMETRY` (ou `VALIDATION_ERROR` em `geometry`) aparece em um painel sobre o mapa com a razão devolvida pela API. Detalhe: polígono, marcador do centróide e retângulo da célula ERA5 (0,1° em torno de `era5Cell`). Miniaturas da lista: SVG estático projetando as coordenadas no `viewBox` — nada de instância Leaflet por card. Centro inicial do editor: centróide dos talhões existentes da propriedade ou Goiânia (−16,68; −49,25), zoom 13.

### 9. Dados e estados
TanStack Query 5 com chaves por recurso (`['properties']`, `['properties', id]`, `['fields', propertyId]`, `['users', q]`); mutações invalidam as chaves afetadas. Componentes `LoadingState`, `EmptyState`, `ErrorState` (com "tentar novamente") e `useToast` (fila simples em contexto). A página "Talhões" agrupa por propriedade com `useQueries` sobre as propriedades visíveis (não há endpoint global de talhões; o volume por usuário é pequeno).

### 10. Verificação
Vitest 3 + jsdom + Testing Library. Unitários: máscaras e validadores (tabelas de CPF/CNPJ válidos/inválidos), `client.ts` com `fetch` mockado (401 → refresh → repete; refresh 401 → sessão limpa e evento; dedupe de refresh com 3 chamadas concorrentes; `Retry-After`), `RequireAuth`/`RequireRole` com `MemoryRouter`. Playwright (`frontend/e2e/smoke.spec.ts`, projeto Chromium) contra `http://localhost`: lê o link de verificação com `docker compose logs api` via `child_process`, desenha o polígono clicando no mapa (geoman) e confere área e célula ERA5 na tela. Roda no host (`pnpm e2e`), fora do Compose, como os roteiros bash.

### 11. Estrutura de pastas
```
frontend/
├── src/
│   ├── app/            # App, router, providers, layout (Shell, Sidebar, Header)
│   ├── lib/
│   │   ├── api/        # client.ts, errors.ts, types.ts (espelho das respostas)
│   │   ├── auth/       # session.ts, useSession, guards
│   │   ├── validation/ # schemas zod, cpf/cnpj, masks
│   │   └── geo/        # area, bbox, svg thumbnail, era5 cell rect
│   ├── components/     # ui básicos: Button, Input, Select, Field, Modal, Toast, states
│   ├── features/
│   │   ├── auth/       # páginas e formulários de autenticação
│   │   ├── properties/ # lista, formulário, detalhe
│   │   ├── fields/     # editor com mapa, detalhe, lista, thumbnail
│   │   └── admin/      # contagens das filas
│   └── main.tsx
├── e2e/                # Playwright
├── public/
├── index.html · vite.config.ts · tailwind.config.ts · tsconfig.json · Dockerfile · nginx? (não: conf fica em nginx/)
```

## Risks / Trade-offs

- **[HMR atrás do Nginx]** → O cliente do Vite abre o WebSocket no host/porta da página (`localhost:80`); o Nginx faz o upgrade. Se falhar, fixar `server.hmr = { clientPort: 80 }` no `vite.config.ts`.
- **[Cookie `SameSite=Strict` e links de e-mail]** → Links abertos a partir do cliente de e-mail chegam sem cookie (navegação de terceiros) — irrelevante: as páginas de verificação/redefinição são públicas e não usam a sessão.
- **[Diretório de usuários expõe nomes/e-mails de produtores aos agrônomos]** → Busca mínima de 3 caracteres, só `PRODUTOR`, máximo 20 resultados, exige autenticação. Aceitável para o vínculo técnico–cliente; revisar quando houver convite por e-mail.
- **[Tiles da Esri]** → Serviço público com termos de uso para visualização; atribuição exibida. Se indisponível, o OSM continua.
- **[Dependências nativas do Leaflet em testes]** → Componentes de mapa não são testados unitariamente (jsdom não tem layout); cobertos pelo smoke do Playwright.
- **[Troca do link de verificação]** → Quem rodar roteiros antigos verá `last_verify_token` vazio; todos os roteiros do repositório são atualizados nesta change.
- **[Imagem do nginx de produção passa a ser construída]** → Pipeline de deploy precisa publicar `fertiliza-web` além da API e do ETL; registrado no `.env.example` e em `arquitetura.md`.

## Notas de implementação

- **Versões**: React 18.3.1, Vite 6.4, TypeScript 5.8, Tailwind 3.4, react-router 7.18, TanStack Query 5.104, react-hook-form 7.63 + `@hookform/resolvers` 3.10, zod 3.25, react-leaflet 4.2 + leaflet 1.9.4 + `@geoman-io/leaflet-geoman-free` 2.20, `@turf/area` 7.2, Vitest 3.2, Playwright 1.56.
- **`zodResolver` v3 e transformações**: o resolver devolve em runtime os valores já transformados pelo schema, mas tipa a saída como a entrada; o formulário de talhão (campos numéricos como string, vírgula decimal) tipa os valores como `FieldFormValues` (strings) e re-parsa no submit (`fieldSchema.parse`). Os demais schemas não mudam o tipo.
- **Rótulos obrigatórios** terminam em " *" (acessibilidade): o smoke seleciona campos por `id` (`#password`, `#cpf`…) em vez de `getByLabel` exato.
- **Geoman**: o botão de desenho é localizado pela classe do ícone (`.leaflet-pm-icon-polygon`), estável entre idiomas; `map.pm.setLang('pt_br')`. Um polígono por talhão com `window.confirm` na substituição. Centróide com `CircleMarker` para não depender das imagens de ícone do Leaflet no bundle.
- **Nginx prod verificado sem TLS**: a imagem `fertiliza-web` foi testada com uma variante de `nginx.prod.conf` gerada no momento do teste (sem `ssl_*`, porta 8080, upstream fictício): rota profunda → 200 `index.html`; `/assets/*.js` → `Cache-Control: max-age=31536000` com `X-Frame-Options` herdado; `index.html` → `no-cache` com HSTS; `/api/` → upstream. A imagem não contém `/app` nem `node_modules`.
- **`nginx -t` fora do Compose falha** para `nginx.dev.conf` porque os upstreams `api`/`frontend` não resolvem; a validação é a própria stack (`http://localhost/entrar` → 200 com `/@vite/client`).
- **Primeiro boot do serviço `frontend`** demora ~2 min (instala 373 pacotes no volume anônimo); o Nginx responde 502 até o Vite subir.
- **Smoke**: usa CPF válido gerado por execução (os roteiros bash deixam usuários com CPFs fixos no banco) e lê o link em `docker compose logs api`. O 409 `CPF_ALREADY_REGISTERED` apareceu no campo certo durante o desenvolvimento — o mapeamento de conflitos por campo funciona.
- **`FRONTEND_URL`** no `.env` local passou a `http://localhost`; quem tiver `.env` antigo com `:5173` verá os links dos e-mails apontando para o Vite direto (funciona, mas sem o Nginx).
- **Não feito**: limpar campos opcionais na edição (enviar `null`) — o PATCH só envia valores não vazios; remover um `soilType` exige backend aceitar `null` (próxima oportunidade). Reenvio do e-mail de verificação (sem endpoint na API; a página orienta a usar a recuperação de senha).

## Migration Plan

1. Backend: `GET /auth/me`, módulo `users`, `mailer.ts`; testes unitários; e2e do backend ajustados (`verificar-email/`, `redefinir-senha?token=`).
2. `frontend/` com Vite; `docker-compose.yml` + `nginx.dev.conf`; `docker compose up -d --build` (o `frontend` instala dependências no primeiro boot).
3. `frontend/Dockerfile` + `nginx.prod.conf` + `docker-compose.prod.yml`; validar com `docker compose -f docker-compose.prod.yml config` e um build local da imagem servindo `/propriedades/x` → `index.html`.
4. Rollback: remover o serviço `frontend` e restaurar `nginx.dev.conf`; o backend novo é retrocompatível exceto pelos links dos e-mails (voltar `mailer.ts` se necessário).

## Open Questions

- Exigir CREA para AGRONOMO no cadastro (hoje opcional na API)? Mantido opcional; decidir com a Heb.
- Limite de área/zoom para desenho (talhões > 10.000 ha)? Sem limite na interface; a API já rejeita > 1.000.000 ha.
- Tema escuro: não previsto; só a variável de cor base do Tailwind preparada.
