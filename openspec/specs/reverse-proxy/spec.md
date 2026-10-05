# reverse-proxy Specification

## Purpose

Configurações Nginx de desenvolvimento e produção: roteamento para a API, TLS, rate limiting, balanceamento de carga e headers de segurança.

## Requirements

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

### Requirement: Tuning de desempenho em produção
`nginx/nginx.prod.conf` SHALL configurar `worker_processes auto`, `worker_rlimit_nofile 65535`, `worker_connections 4096`, `use epoll` e `multi_accept on`; habilitar gzip com `gzip_comp_level 5` para JSON, JavaScript, CSS, SVG e XML; e definir `client_max_body_size 20m` como padrão.

#### Scenario: Configuração válida
- **WHEN** `nginx -t` é executado com `nginx.prod.conf` e certificados presentes
- **THEN** a validação de sintaxe termina com sucesso

#### Scenario: Resposta JSON comprimida
- **WHEN** um cliente envia `Accept-Encoding: gzip` e recebe uma resposta JSON da API
- **THEN** a resposta é entregue com `Content-Encoding: gzip`

#### Scenario: Corpo acima do limite padrão
- **WHEN** um cliente envia um corpo maior que 20 MB para uma rota comum de `/api/`
- **THEN** o Nginx responde 413

### Requirement: Balanceamento de carga entre réplicas
`nginx/nginx.prod.conf` SHALL definir um upstream com `least_conn`, `server api:3000 max_fails=3 fail_timeout=30s` e `keepalive 32`.

#### Scenario: Distribuição entre réplicas
- **WHEN** múltiplas réplicas da API estão em execução
- **THEN** o Nginx encaminha cada requisição à réplica com menos conexões ativas

#### Scenario: Réplica com falha
- **WHEN** uma réplica falha 3 vezes dentro de 30 segundos
- **THEN** o Nginx deixa de encaminhar requisições a ela durante 30 segundos

### Requirement: Redirecionamento para HTTPS
O servidor da porta 80 em `nginx/nginx.prod.conf` SHALL redirecionar todas as requisições para HTTPS, exceto as de `/.well-known/acme-challenge/`, que MUST ser servidas em HTTP.

#### Scenario: Acesso por HTTP
- **WHEN** um cliente faz uma requisição HTTP a qualquer caminho fora do desafio ACME
- **THEN** o Nginx responde com redirecionamento 301 para a mesma URL em HTTPS

#### Scenario: Desafio Let's Encrypt
- **WHEN** a autoridade certificadora requisita `/.well-known/acme-challenge/<token>` por HTTP
- **THEN** o Nginx serve o arquivo sem redirecionar

### Requirement: TLS e headers de segurança
O servidor da porta 443 SHALL aceitar apenas TLS 1.2 e 1.3 com ciphers modernos e SHALL enviar em todas as respostas os headers `Strict-Transport-Security` com `max-age` de 1 ano, `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` e `Referrer-Policy`.

#### Scenario: Protocolo obsoleto
- **WHEN** um cliente tenta negociar TLS 1.1 ou anterior
- **THEN** o handshake é recusado

#### Scenario: Headers presentes
- **WHEN** um cliente recebe qualquer resposta por HTTPS
- **THEN** a resposta contém `Strict-Transport-Security` com `max-age=31536000` e os demais headers de segurança

### Requirement: Rate limiting por tipo de rota
`nginx/nginx.prod.conf` SHALL definir três zonas de rate limit por IP do cliente: `api_general` com 60 requisições por minuto, `api_auth` com 10 requisições por minuto e `api_upload` com 5 requisições por minuto. A location `/api/` MUST usar `api_general` com `burst=20`; a location `~ ^/api/v[0-9]+/auth/` MUST usar `api_auth` com `burst=5`; a location de upload (`~ ^/api/v[0-9]+/.../upload`) MUST usar `api_upload`, com `client_max_body_size 50m` e `proxy_read_timeout 120s`.

#### Scenario: Brute-force em autenticação
- **WHEN** um mesmo IP excede 10 requisições por minuto mais o burst de 5 em `/api/v1/auth/login`
- **THEN** as requisições excedentes são rejeitadas pelo Nginx sem chegar à API

#### Scenario: Uso normal da API
- **WHEN** um IP faz requisições a `/api/` dentro de 60 por minuto mais o burst de 20
- **THEN** todas as requisições são encaminhadas à API

#### Scenario: Upload de laudo grande
- **WHEN** um cliente envia um arquivo de 40 MB para uma rota de upload
- **THEN** o Nginx aceita o corpo e aguarda a resposta da API por até 120 segundos

#### Scenario: Rota de auth usa a zona restrita
- **WHEN** uma requisição chega em `/api/v1/auth/login`
- **THEN** ela é contabilizada na zona `api_auth` e não na `api_general`

### Requirement: Health check da API sem rate limit
O servidor HTTPS SHALL encaminhar `/health` para a API sem aplicar rate limit e com `access_log off`.

#### Scenario: Monitoramento frequente
- **WHEN** um monitor consulta `/health` várias vezes por segundo
- **THEN** nenhuma requisição é rejeitada por rate limit e nenhuma linha é gravada no access log

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
