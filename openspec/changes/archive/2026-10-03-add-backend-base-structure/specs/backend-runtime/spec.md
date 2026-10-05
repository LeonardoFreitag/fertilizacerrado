## ADDED Requirements

### Requirement: Tooling do projeto com pnpm
O backend SHALL ser um pacote Node.js + TypeScript em `backend/` gerenciado exclusivamente por pnpm. O `package.json` MUST declarar `"packageManager": "pnpm@9.15.4"` e `"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }`. O `backend/.npmrc` MUST conter `engine-strict=true`, `public-hoist-pattern[]=*prisma*` e `public-hoist-pattern[]=*ts-node*`.

#### Scenario: Instalação com versões suportadas
- **WHEN** `pnpm install` é executado em `backend/` com Node 20+ e pnpm 9+
- **THEN** as dependências são instaladas e um `pnpm-lock.yaml` é gerado

#### Scenario: Instalação com Node não suportado
- **WHEN** `pnpm install` é executado em `backend/` com Node anterior à versão 20
- **THEN** a instalação falha com erro de engine incompatível

### Requirement: Compilação TypeScript estrita
O backend SHALL compilar com TypeScript em modo `strict`, com código-fonte em `src/` e saída em `dist/`. O script `pnpm build` MUST produzir `dist/server.js` executável por `node dist/server.js`.

#### Scenario: Build bem-sucedido
- **WHEN** `pnpm build` é executado em `backend/`
- **THEN** o comando termina com código 0 e `dist/server.js` existe

#### Scenario: Erro de tipo bloqueia o build
- **WHEN** o código-fonte contém um erro de tipo e `pnpm build` é executado
- **THEN** o comando termina com código diferente de 0

### Requirement: Validação de variáveis de ambiente no startup
O backend SHALL validar as variáveis de ambiente com um schema Zod em `src/config/env.ts` antes de iniciar o servidor e SHALL expor um objeto `env` tipado como única forma de acesso à configuração. O schema MUST cobrir `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. `JWT_SECRET` e `JWT_REFRESH_SECRET` MUST ter no mínimo 32 caracteres. `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` MUST ser obrigatórias quando `NODE_ENV` é `production` e opcionais nos demais ambientes.

#### Scenario: Ambiente válido
- **WHEN** todas as variáveis obrigatórias estão presentes e válidas
- **THEN** o servidor inicia e `env.PORT` é um número

#### Scenario: Defaults aplicados
- **WHEN** `NODE_ENV`, `PORT`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` e `SMTP_PORT` não são definidas
- **THEN** o backend usa `development`, `3000`, `15m`, `7d` e `587` respectivamente

#### Scenario: Segredo JWT curto
- **WHEN** `JWT_SECRET` tem menos de 32 caracteres
- **THEN** o processo imprime no stderr um erro que identifica `JWT_SECRET` e encerra com código 1 sem abrir a porta HTTP

#### Scenario: Variável obrigatória ausente
- **WHEN** `DATABASE_URL` não está definida
- **THEN** o processo imprime no stderr um erro que identifica `DATABASE_URL` e encerra com código 1

#### Scenario: SMTP ausente em produção
- **WHEN** `NODE_ENV` é `production` e `SMTP_HOST` não está definida
- **THEN** o processo encerra com código 1 identificando `SMTP_HOST`

#### Scenario: SMTP ausente em desenvolvimento
- **WHEN** `NODE_ENV` é `development` e nenhuma variável SMTP de credencial está definida
- **THEN** o servidor inicia normalmente

### Requirement: Endpoint de health check
A aplicação SHALL responder `GET /health` com status 200 e corpo JSON contendo `status` igual a `"ok"`, `uptime` em segundos e `timestamp` em ISO 8601. O endpoint MUST NOT depender de banco de dados nem de Redis para responder.

#### Scenario: Aplicação no ar
- **WHEN** um cliente faz `GET /health`
- **THEN** a resposta tem status 200, `Content-Type` JSON e `status` igual a `"ok"`

#### Scenario: Banco indisponível
- **WHEN** o PostgreSQL está fora do ar e um cliente faz `GET /health`
- **THEN** a resposta ainda tem status 200

### Requirement: Aplicação Express atrás de proxy
A aplicação SHALL ser uma instância Express exportada por `src/app.ts` sem abrir porta, configurada com `trust proxy` igual a `1` e com parser de corpo JSON. Rotas inexistentes MUST responder 404 com corpo JSON.

#### Scenario: IP real do cliente atrás do Nginx
- **WHEN** uma requisição chega via Nginx com o header `X-Forwarded-For` do cliente
- **THEN** `req.ip` contém o IP do cliente e não o IP do container do Nginx

#### Scenario: Rota inexistente
- **WHEN** um cliente faz `GET /rota-que-nao-existe`
- **THEN** a resposta tem status 404 e corpo JSON

### Requirement: Graceful shutdown
O servidor em `src/server.ts` SHALL capturar `SIGTERM` e `SIGINT`, parar de aceitar novas conexões, aguardar as requisições em andamento, desconectar o cliente do banco de dados e então encerrar com código 0. Se o encerramento não concluir em 10 segundos, o processo MUST encerrar com código 1.

#### Scenario: SIGTERM sem requisições em andamento
- **WHEN** o processo recebe `SIGTERM`
- **THEN** o servidor HTTP é fechado, o banco é desconectado e o processo encerra com código 0

#### Scenario: SIGINT durante o desenvolvimento
- **WHEN** o processo recebe `SIGINT`
- **THEN** o comportamento é idêntico ao de `SIGTERM`

#### Scenario: Requisição em andamento
- **WHEN** o processo recebe `SIGTERM` enquanto uma requisição está sendo processada
- **THEN** a requisição é concluída antes de o processo encerrar

#### Scenario: Encerramento travado
- **WHEN** o fechamento não conclui em 10 segundos após o sinal
- **THEN** o processo encerra com código 1

#### Scenario: Sinal repetido
- **WHEN** um segundo sinal chega durante o encerramento
- **THEN** a rotina de encerramento não é executada novamente
