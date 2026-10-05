## ADDED Requirements

### Requirement: Entrega do frontend em produção
O servidor HTTPS de `nginx/nginx.prod.conf` SHALL servir os estáticos da SPA a partir de `/usr/share/nginx/html` (copiados pela imagem construída de `frontend/Dockerfile`): `location /` com `try_files $uri $uri/ /index.html` (fallback para rotas profundas), `/assets/` com cache de 1 ano (`expires 1y`; os nomes têm hash) e `index.html` sem cache (`Cache-Control: no-cache`). As locations de `/api/`, `/health` e os headers de segurança MUST permanecer; o cache MUST ser definido com `expires`, não com `add_header` dentro de location, para não descartar os headers herdados.

#### Scenario: Rota profunda
- **WHEN** um cliente requisita `GET /propriedades/abc/talhoes/novo`
- **THEN** o Nginx responde 200 com o conteúdo de `index.html`

#### Scenario: Asset com hash
- **WHEN** um cliente requisita `GET /assets/index-a1b2c3.js`
- **THEN** a resposta inclui `Cache-Control: max-age=31536000`

#### Scenario: index.html
- **WHEN** um cliente requisita `GET /` ou `GET /index.html`
- **THEN** a resposta inclui `Cache-Control: no-cache` e os headers de segurança do servidor

#### Scenario: API intacta
- **WHEN** um cliente requisita `GET /api/v1/properties`
- **THEN** a requisição é encaminhada à API com rate limiting, não ao fallback da SPA

## MODIFIED Requirements

### Requirement: Proxy reverso de desenvolvimento
`nginx/nginx.dev.conf` SHALL definir `upstream api_upstream { server api:3000; }` e `upstream frontend_upstream { server frontend:5173; }`, encaminhar requisições de `/api/` para a API com os headers `X-Real-IP`, `X-Forwarded-For` e `X-Forwarded-Proto`, encaminhar todas as demais (`/`) para o dev server do frontend com `proxy_http_version 1.1` e upgrade de WebSocket (`Upgrade`/`Connection` via `map $http_upgrade $connection_upgrade`) para o HMR do Vite, e responder `/nginx-health` com status 200 e corpo `OK`.

#### Scenario: Requisição à API via Nginx
- **WHEN** um cliente faz uma requisição a `http://localhost/api/...`
- **THEN** o Nginx a encaminha ao serviço `api` na porta 3000 com os headers de proxy preenchidos

#### Scenario: Página do frontend via Nginx
- **WHEN** um navegador abre `http://localhost/propriedades`
- **THEN** o Nginx encaminha ao serviço `frontend` na porta 5173 e a SPA é servida

#### Scenario: HMR
- **WHEN** um arquivo em `frontend/src/` é alterado com a página aberta em `http://localhost`
- **THEN** o WebSocket do Vite atravessa o Nginx e a página atualiza sem recarregar

#### Scenario: Health do Nginx
- **WHEN** um cliente faz `GET http://localhost/nginx-health`
- **THEN** a resposta tem status 200 e corpo `OK`, sem depender da API nem do frontend
