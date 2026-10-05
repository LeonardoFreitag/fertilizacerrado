## MODIFIED Requirements

### Requirement: Stack de desenvolvimento local
`docker-compose.yml` na raiz SHALL definir os serviços `db` (`timescale/timescaledb-ha:pg15`, porta 5432, healthcheck `pg_isready`, volume `postgres_data` montado em `/home/postgres/pgdata/data`), `redis` (`redis:7-alpine`, porta 6379, senha via variável de ambiente, `maxmemory 256mb`, política `allkeys-lru`), `api`, `nginx` (`nginx:1.25-alpine`, porta 80, usando `nginx/nginx.dev.conf`), `adminer` (`adminer:4-standalone`, porta 8080) e `etl` (build de `backend/etl`, profile `etl`, sem portas, `depends_on db healthy`, variáveis `DATABASE_URL`, `CDS_API_URL`, `CDS_API_KEY`, `ETL_CACHE_DIR`, volume `etl_cache`), além dos volumes nomeados `postgres_data`, `redis_data` e `etl_cache`. O serviço `api` MUST depender de `db` e `redis` com `condition: service_healthy`. O serviço `etl` MUST NOT iniciar com `docker compose up`.

#### Scenario: Subida da stack completa
- **WHEN** `docker compose up` é executado na raiz com um `.env` válido
- **THEN** os cinco serviços sem profile sobem, o `etl` não é iniciado, e `GET http://localhost:3000/health` responde 200

#### Scenario: Ordem de inicialização
- **WHEN** a stack é iniciada
- **THEN** o serviço `api` só inicia depois que `db` e `redis` estão `healthy`

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

### Requirement: Stack de produção
`docker-compose.prod.yml` SHALL definir o serviço `api` com a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG:-latest}`, sem volumes de código, com `deploy.replicas: 2`, rolling update com `order: start-first` e `parallelism: 1`, limites de recursos de 0.75 CPU e 512M de memória e logging `json-file` com tamanho máximo de 10m. O serviço `nginx` MUST publicar as portas 80 e 443, usar `nginx/nginx.prod.conf` e montar volumes de logs e de certificados SSL. O serviço `db` MUST usar a imagem `timescale/timescaledb-ha:pg15` com o volume `postgres_data` montado em `/home/postgres/pgdata/data`. Os serviços `db` e `redis` MUST usar `restart: always`, ter limites de recursos e não publicar portas no host. O serviço `etl` MUST usar a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG:-latest}`, estar no profile `etl`, pertencer às redes `backend_net` e `frontend_net`, não publicar portas e usar o volume `etl_cache`.

#### Scenario: Imagem vinda do ECR
- **WHEN** `ECR_REGISTRY`, `ECR_REPOSITORY` e `IMAGE_TAG` estão definidas e a stack de produção é iniciada
- **THEN** o serviço `api` usa a imagem `${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}`

#### Scenario: Tag padrão
- **WHEN** `IMAGE_TAG` não está definida
- **THEN** a tag `latest` é usada

#### Scenario: Banco inacessível de fora
- **WHEN** a stack de produção está em execução
- **THEN** as portas 5432 e 6379 não estão publicadas no host

#### Scenario: Escala horizontal da API
- **WHEN** a stack é iniciada com `--scale api=3`
- **THEN** três réplicas da API sobem sem conflito de nome de container ou de porta

#### Scenario: Mesma imagem de banco em produção
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado
- **THEN** o serviço `db` resolve para a imagem `timescale/timescaledb-ha:pg15` com o volume em `/home/postgres/pgdata/data`

#### Scenario: ETL em produção
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado com `ECR_REPOSITORY_ETL` definida
- **THEN** o serviço `etl` resolve para `${ECR_REGISTRY}/${ECR_REPOSITORY_ETL}:${IMAGE_TAG}`, nas redes `backend_net` e `frontend_net`, sem portas publicadas

### Requirement: Contrato de variáveis de ambiente
Um arquivo `.env.example` na raiz SHALL listar, sem valores secretos, as variáveis `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CDS_API_URL`, `CDS_API_KEY`, `AWS_REGION`, `ECR_REGISTRY`, `ECR_REPOSITORY`, `ECR_REPOSITORY_ETL` e `IMAGE_TAG`, agrupadas por finalidade e com a indicação de que os segredos JWT exigem no mínimo 32 caracteres, de que o seed rotaciona a senha do administrador a cada execução e de que `CDS_API_KEY` é o token pessoal da API nova do CDS (sem `uid:`), exigindo o aceite da licença do dataset.

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
