# container-infrastructure Specification

## Purpose

Imagem Docker do backend, stacks Docker Compose de desenvolvimento e produção, inicialização do PostgreSQL e contrato de variáveis de ambiente.

## Requirements

### Requirement: Imagem Docker multi-stage do backend
`backend/Dockerfile` SHALL definir dois estágios sobre `node:20-alpine`. O estágio `builder` MUST instalar `python3 make g++ openssl`, ativar o pnpm via corepack, copiar `package.json` e `pnpm-lock.yaml` antes do código-fonte, executar `pnpm install --frozen-lockfile`, `pnpm prisma generate` e `pnpm build`. O estágio `production` MUST instalar `openssl tini`, copiar do builder `package.json`, `pnpm-lock.yaml`, `node_modules/`, `dist/` e `prisma/`, usar `ENTRYPOINT ["/sbin/tini", "--"]`, expor a porta 3000 e iniciar com `CMD ["node", "dist/server.js"]`.

#### Scenario: Build da imagem de produção
- **WHEN** `docker build backend/` é executado
- **THEN** o build conclui e a imagem resultante inicia `node dist/server.js` sob o tini

#### Scenario: Cache de dependências
- **WHEN** apenas arquivos em `src/` mudam e a imagem é reconstruída
- **THEN** a camada de `pnpm install` é reaproveitada do cache

#### Scenario: Lockfile desatualizado
- **WHEN** `package.json` diverge de `pnpm-lock.yaml` e a imagem é construída
- **THEN** o build falha na etapa de instalação

### Requirement: Container de produção sem privilégios e com healthcheck
A imagem de produção SHALL executar como o usuário não-root `appuser` do grupo `appgroup` e SHALL declarar um `HEALTHCHECK` que consulta `http://localhost:3000/health` com `wget`.

#### Scenario: Usuário do processo
- **WHEN** o container de produção está em execução
- **THEN** o processo Node roda como `appuser` e não como root

#### Scenario: Container saudável
- **WHEN** a API responde 200 em `/health`
- **THEN** o Docker reporta o container como `healthy`

#### Scenario: API sem resposta
- **WHEN** a API deixa de responder em `/health` por tentativas consecutivas
- **THEN** o Docker reporta o container como `unhealthy`

### Requirement: Contexto de build enxuto
`backend/.dockerignore` SHALL excluir do contexto de build `node_modules`, `dist`, arquivos `.env*` e o diretório `.git`.

#### Scenario: Segredos fora da imagem
- **WHEN** existe um arquivo `.env` em `backend/` e a imagem é construída
- **THEN** o arquivo `.env` não está presente na imagem

### Requirement: Stack de desenvolvimento local
`docker-compose.yml` na raiz SHALL definir os serviços `db` (`timescale/timescaledb-ha:pg15`, porta 5432, healthcheck `pg_isready`, volume `postgres_data` montado em `/home/postgres/pgdata/data`), `redis` (`redis:7-alpine`, porta 6379, senha via variável de ambiente, `maxmemory 256mb`, política `noeviction` — exigida pelo BullMQ para não perder jobs sob pressão de memória), `api`, `worker` (mesma build da `api`, comando `ts-node-dev src/worker.ts`, mesmas variáveis, sem portas, `depends_on db` e `redis` saudáveis), `frontend` (`node:20-alpine`, `working_dir /app`, volume `./frontend:/app` com volume anônimo para `node_modules`, comando que ativa o corepack, instala com `--frozen-lockfile` e roda `pnpm dev --host`, porta 5173, variável `VITE_API_BASE_URL`), `nginx` (`nginx:1.25-alpine`, porta 80, usando `nginx/nginx.dev.conf`, `depends_on api` e `frontend`), `adminer` (`adminer:4-standalone`, porta 8080) e `etl` (build de `backend/etl`, comando `worker`, sem portas, `depends_on db` e `redis` saudáveis, variáveis `DATABASE_URL`, `REDIS_URL`, `CDS_API_URL`, `CDS_API_KEY`, `ETL_CACHE_DIR`, volume `etl_cache`), além dos volumes nomeados `postgres_data`, `redis_data` e `etl_cache`. O serviço `api` MUST depender de `db` e `redis` com `condition: service_healthy`.

#### Scenario: Subida da stack completa
- **WHEN** `docker compose up` é executado na raiz com um `.env` válido
- **THEN** os oito serviços sobem, `GET http://localhost:3000/health` responde 200 e `http://localhost/` serve a SPA

#### Scenario: Ordem de inicialização
- **WHEN** a stack é iniciada
- **THEN** `api`, `worker` e `etl` só iniciam depois que `db` e `redis` estão `healthy`

#### Scenario: Persistência do banco
- **WHEN** a stack é derrubada com `docker compose down` e iniciada novamente
- **THEN** os dados do PostgreSQL são preservados

#### Scenario: Acesso visual ao banco
- **WHEN** o desenvolvedor acessa `http://localhost:8080`
- **THEN** o Adminer é exibido e consegue conectar ao serviço `db`

#### Scenario: PostGIS e TimescaleDB disponíveis
- **WHEN** o serviço `db` está em execução
- **THEN** `SELECT PostGIS_Version()` retorna uma versão 3.x e `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'` retorna uma linha

#### Scenario: Dados gravados no volume
- **WHEN** a stack é reiniciada após a criação de registros
- **THEN** os registros continuam presentes, confirmando que o volume está montado no diretório de dados da imagem

#### Scenario: ETL sob demanda
- **WHEN** `docker compose run --rm etl status` é executado
- **THEN** o contêiner do ETL sobe com acesso ao banco, executa o comando e encerra

#### Scenario: Hot-reload do worker
- **WHEN** um arquivo em `backend/src/` é modificado com a stack em execução
- **THEN** o processo do `worker` reinicia automaticamente, como o da API

#### Scenario: Hot-reload do frontend
- **WHEN** um arquivo em `frontend/src/` é modificado com a stack em execução
- **THEN** o Vite recompila e a página aberta em `http://localhost` atualiza via HMR

### Requirement: Hot-reload da API em desenvolvimento
O serviço `api` do `docker-compose.yml` SHALL ser construído com `target: builder`, montar `backend/src` e `backend/prisma` como volumes somente leitura e executar `pnpm prisma migrate deploy && pnpm exec ts-node-dev --respawn --transpile-only src/server.ts`. O Compose MUST injetar `DATABASE_URL` e `REDIS_URL` no container, montadas a partir de `DB_USER`, `DB_PASSWORD`, `DB_NAME` e `REDIS_PASSWORD`.

#### Scenario: Alteração de código
- **WHEN** um arquivo em `backend/src/` é modificado com a stack em execução
- **THEN** o processo da API reinicia automaticamente com o novo código, sem rebuild da imagem

#### Scenario: Migrations no startup
- **WHEN** o serviço `api` inicia
- **THEN** `prisma migrate deploy` é executado antes do servidor e termina com sucesso mesmo sem migrations existentes

#### Scenario: Conexão com o banco
- **WHEN** o container `api` inicia
- **THEN** `DATABASE_URL` aponta para o host `db` com as credenciais definidas no `.env`

### Requirement: Stack de produção
`docker-compose.prod.yml` SHALL definir o serviço `api` com a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG:-latest}`, sem volumes de código, com `deploy.replicas: 2`, rolling update com `order: start-first` e `parallelism: 1`, limites de recursos de 0.75 CPU e 512M de memória e logging `json-file` com tamanho máximo de 10m. O serviço `worker` MUST usar a mesma imagem da `api` com comando `node dist/worker.js`, `deploy.replicas: 1`, `restart: always`, sem portas, na `backend_net` e na `frontend_net`. O serviço `nginx` MUST usar a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_WEB:-fertiliza-web}:${IMAGE_TAG:-latest}` (construída de `frontend/Dockerfile`, com os estáticos da SPA), publicar as portas 80 e 443, usar `nginx/nginx.prod.conf` e montar volumes de logs e de certificados SSL; não há serviço `frontend` separado. O serviço `db` MUST usar a imagem `timescale/timescaledb-ha:pg15` com o volume `postgres_data` montado em `/home/postgres/pgdata/data`. Os serviços `db` e `redis` MUST usar `restart: always`, ter limites de recursos e não publicar portas no host. O serviço `etl` MUST usar a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG:-latest}`, comando `worker`, `deploy.replicas: 1`, `restart: always`, pertencer às redes `backend_net` e `frontend_net`, não publicar portas e usar o volume `etl_cache`.

#### Scenario: Imagem vinda do ECR
- **WHEN** `ECR_REGISTRY`, `ECR_REPOSITORY` e `IMAGE_TAG` estão definidas e a stack de produção é iniciada
- **THEN** os serviços `api` e `worker` usam a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}`

#### Scenario: Tag padrão
- **WHEN** `IMAGE_TAG` não está definida
- **THEN** a tag `latest` é usada

#### Scenario: Banco inacessível de fora
- **WHEN** a stack de produção está em execução
- **THEN** as portas 5432 e 6379 não estão publicadas no host

#### Scenario: Escala horizontal da API
- **WHEN** a stack é iniciada com `--scale api=3`
- **THEN** três réplicas da API sobem sem conflito de nome de container ou de porta, e continua havendo um único `worker`

#### Scenario: Mesma imagem de banco em produção
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado
- **THEN** o serviço `db` resolve para a imagem `timescale/timescaledb-ha:pg15` com o volume em `/home/postgres/pgdata/data`

#### Scenario: Worker e ETL em produção
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado com as variáveis do ECR definidas
- **THEN** `worker` resolve para a imagem da API com `node dist/worker.js` e `etl` para `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG}` com comando `worker`, ambos com 1 réplica, sem portas, nas redes `backend_net` e `frontend_net`

#### Scenario: Nginx com a SPA em produção
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado com `ECR_REPOSITORY_WEB=fertiliza-web`
- **THEN** o serviço `nginx` resolve para `${ECR_REGISTRY}/fertiliza-web:${IMAGE_TAG}` com `nginx.prod.conf`, SSL, certbot e logs montados, e não existe serviço `frontend`

### Requirement: Isolamento de rede em produção
`docker-compose.prod.yml` SHALL definir duas redes: `backend_net` com `internal: true` e `frontend_net`. `db` e `redis` MUST pertencer apenas a `backend_net`; `nginx` MUST pertencer apenas a `frontend_net`; `api` MUST pertencer às duas.

#### Scenario: Nginx não alcança o banco
- **WHEN** a stack de produção está em execução
- **THEN** o container `nginx` não consegue resolver nem conectar ao serviço `db`

#### Scenario: API alcança banco e Redis
- **WHEN** a stack de produção está em execução
- **THEN** o container `api` conecta a `db` e a `redis` por `backend_net`

### Requirement: Inicialização do PostgreSQL
`backend/scripts/init.sql` SHALL criar as extensões `pgcrypto`, `uuid-ossp`, `postgis` e `timescaledb` de forma idempotente e definir o timezone do banco como `America/Sao_Paulo`. O serviço `db` MUST executar esse script na primeira inicialização do volume. A primeira migration que depende do PostGIS MUST também criar as extensões de forma idempotente, para bancos em que o `init.sql` não é executado (shadow database, bancos criados antes dela).

#### Scenario: Banco novo
- **WHEN** o serviço `db` inicia com o volume `postgres_data` vazio
- **THEN** as extensões `pgcrypto`, `uuid-ossp`, `postgis` e `timescaledb` estão instaladas e `SHOW timezone` retorna `America/Sao_Paulo`

#### Scenario: Reexecução do script
- **WHEN** o script é executado em um banco que já possui as extensões
- **THEN** a execução termina sem erro

#### Scenario: Banco sem as extensões
- **WHEN** a migration desta change é aplicada em um banco que não executou o `init.sql`
- **THEN** a extensão `postgis` é criada e as tabelas geográficas são criadas com sucesso

### Requirement: Contrato de variáveis de ambiente
Um arquivo `.env.example` na raiz SHALL listar, sem valores secretos, as variáveis `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL` (com o valor `http://localhost` em desenvolvimento — a origem servida pelo Nginx, usada no CORS e nos links dos e-mails), `VITE_API_BASE_URL` (padrão `/api/v1`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CDS_API_URL`, `CDS_API_KEY`, `AWS_REGION`, `ECR_REGISTRY`, `ECR_REPOSITORY`, `ECR_REPOSITORY_ETL`, `ECR_REPOSITORY_WEB` e `IMAGE_TAG`, agrupadas por finalidade e com a indicação de que os segredos JWT exigem no mínimo 32 caracteres, de que o seed rotaciona a senha do administrador a cada execução e de que `CDS_API_KEY` é o token pessoal da API nova do CDS (sem `uid:`), exigindo o aceite da licença do dataset.

#### Scenario: Onboarding de desenvolvedor
- **WHEN** um desenvolvedor copia `.env.example` para `.env` e preenche os valores vazios
- **THEN** `docker compose up` sobe a stack sem erro de variável ausente

#### Scenario: Cobertura do schema da aplicação
- **WHEN** o schema Zod de `src/config/env.ts` é comparado ao `.env.example`
- **THEN** toda variável validada pelo schema está presente no `.env.example`

#### Scenario: Variáveis do administrador documentadas
- **WHEN** o desenvolvedor lê o `.env.example`
- **THEN** encontra `ADMIN_EMAIL` e `ADMIN_PASSWORD` com a indicação de que são opcionais e consumidas por `pnpm prisma db seed`

#### Scenario: Variáveis do CDS documentadas
- **WHEN** o desenvolvedor lê o `.env.example`
- **THEN** encontra `CDS_API_URL` com o endpoint padrão da API nova e `CDS_API_KEY` com a indicação de que é o token pessoal, consumido só pelo serviço `etl`

#### Scenario: Variáveis do frontend documentadas
- **WHEN** o desenvolvedor lê o `.env.example`
- **THEN** encontra `FRONTEND_URL=http://localhost`, `VITE_API_BASE_URL` e `ECR_REPOSITORY_WEB` com a explicação de uso

### Requirement: Imagem do frontend
`frontend/Dockerfile` SHALL ter dois estágios: `node:20-alpine` com pnpm via corepack, `pnpm install --frozen-lockfile` e `pnpm build` (aceitando `VITE_API_BASE_URL` como `ARG`), e `nginx:1.25-alpine` recebendo `dist/` em `/usr/share/nginx/html`. A imagem MUST NOT conter `node_modules` nem código-fonte e MUST funcionar com `nginx/nginx.prod.conf` montado em `/etc/nginx/nginx.conf`.

#### Scenario: Build da imagem
- **WHEN** `docker build -t fertiliza-web frontend/` é executado
- **THEN** a imagem contém `/usr/share/nginx/html/index.html` e não contém `/app/node_modules`

#### Scenario: Fallback na imagem
- **WHEN** a imagem roda com `nginx.prod.conf` e recebe `GET /propriedades/x`
- **THEN** responde 200 com `index.html`

### Requirement: Volume de importação de observações
Os dois Compose SHALL definir o volume nomeado `station_imports`, montado em `/data/station-imports` nos serviços `api`, `worker` e `etl`, para o arquivo enviado pela API ser lido pelo ETL. O `.env.example` SHALL listar `QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM` e `QM_MAX_RATIO` com os defaults (50, 10, 0,1, 3) e a indicação de que são consumidas pelo serviço `etl` e registradas em cada calibração.

#### Scenario: Arquivo visível ao ETL
- **WHEN** a API grava um arquivo em `/data/station-imports/`
- **THEN** o contêiner `etl` lê o mesmo caminho

#### Scenario: Variáveis documentadas
- **WHEN** o desenvolvedor lê o `.env.example`
- **THEN** encontra as quatro variáveis `QM_*` com defaults e explicação
