## Why

Toda análise do FertilizaCerrado — agrometeorológica, de solo e de recomendação — acontece no nível do talhão, e o MSA só consegue extrair dados ERA5-Land de um talhão que tenha polígono e centróide cadastrados. Com o módulo de Auth no ar, o módulo de Propriedades e Talhões é o último da Fase 0 em `docs/arquitetura.md` e a porta de entrada dos dados geoespaciais que a Fase 1 consome. Esta change o implementa conforme `docs/modulos/propriedades.md`.

## What Changes

- **Troca da imagem do PostgreSQL** de `postgres:15-alpine` para `timescale/timescaledb-ha:pg15` nos dois arquivos Compose. A imagem traz PostGIS e TimescaleDB, evitando nova troca na change do MSA. As extensões `postgis` e `timescaledb` são criadas no `init.sql` e na migration. O diretório de dados dessa imagem é `/home/postgres/pgdata/data` e o processo roda com outro uid, então o volume de desenvolvimento é recriado (`docker compose down -v`).
- **Seed do administrador** em `prisma/seed.ts`: cria (ou atualiza) um usuário `ADMIN` com e-mail verificado a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD`, de forma idempotente, executado por `pnpm prisma db seed`. As variáveis entram no `.env.example` e no `env.ts` como opcionais.
- Novos models Prisma `Property`, `Field` e `Era5Cell`, com relações para `User`, e a migration correspondente. `geometry` e `centroid` do talhão usam os tipos nativos PostGIS `geography(Polygon,4326)` e `geography(Point,4326)`, com índice GiST na geometria.
- CRUD de propriedades em `/api/v1/properties` (`POST`, `GET`, `GET /:id`, `PATCH /:id`, `DELETE /:id`), com soft delete restrito a `ADMIN`.
- CRUD de talhões em `/api/v1/properties/:propertyId/fields`, aninhado na propriedade.
- Autorização por escopo de dados: `PRODUTOR` vê apenas as propriedades que possui, `AGRONOMO` as que possui ou pelas quais responde tecnicamente, `ADMIN` todas. Propriedades fora do escopo respondem 404.
- Validação do GeoJSON `Polygon` via Zod e validade topológica via `ST_IsValid`; área em hectares calculada por `ST_Area` quando não informada; centróide calculado e persistido por `ST_Centroid` em toda criação ou alteração de geometria.
- Atribuição automática da célula ERA5-Land (grade regular de 0,1°) mais próxima do centróide, registrada em `era5_cells` e atualizada quando a geometria muda.
- Primeiro uso dos middlewares `authenticate`/`authorize` em rotas de negócio.

Fora do escopo: safras e a verificação de "talhão com safras ativas" (o ponto de inserção fica marcado no service), `MULTIPOLYGON`, importação de arquivos (KML/shapefile), paginação e filtros de listagem, restauração de propriedades excluídas, transferência de propriedade por `AGRONOMO`, hipertabelas e a tabela `era5_daily_data` do pipeline ETL (a extensão `timescaledb` fica instalada, mas sem uso nesta change).

## Capabilities

### New Capabilities
- `property-management`: cadastro, consulta, atualização e exclusão lógica de propriedades rurais, com controle de acesso por `ownerId`/`agronomistId`/role.
- `field-management`: cadastro, consulta, atualização e exclusão de talhões com polígono GeoJSON, área e centróide calculados pelo PostGIS.
- `era5-cell-assignment`: identificação da célula ERA5-Land mais próxima do centróide do talhão e seu registro em `era5_cells`.

### Modified Capabilities
- `container-infrastructure`: a imagem do serviço `db` passa a ser `timescale/timescaledb-ha:pg15` nas stacks de desenvolvimento e produção, com o volume montado em `/home/postgres/pgdata/data`; o `init.sql` passa a criar também as extensões `postgis` e `timescaledb`; o `.env.example` ganha `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
- `backend-runtime`: o schema de ambiente passa a cobrir `ADMIN_EMAIL` e `ADMIN_PASSWORD` como opcionais.
- `user-auth`: ganha o requisito do seed do administrador (novo requisito, sem alterar os existentes).

## Impact

- **Código**: novo `src/modules/properties/` (`property.controller`, `field.controller`, `property.service`, `property.repository`, `property.routes`, `dtos/`), novos `src/utils/geojson.util.ts`, `src/utils/era5-grid.util.ts` e `prisma/seed.ts`; alterações em `src/app.ts` (montagem do router), `src/config/env.ts`, `prisma/schema.prisma`, `package.json` (`prisma.seed`), `backend/scripts/init.sql`, `.env.example`, `docker-compose.yml` e `docker-compose.prod.yml`.
- **Banco**: extensões `postgis` e `timescaledb`; tabelas `properties`, `fields` e `era5_cells`; colunas geográficas nativas e índice GiST. O Prisma Client não lê nem escreve colunas `Unsupported`, então as operações sobre `fields` usam SQL parametrizado via Prisma.
- **API**: dez rotas novas, todas autenticadas, cobertas pela zona `api_general` do Nginx. Nenhuma rota existente muda.
- **Dependências**: nenhuma nova; PostGIS e TimescaleDB vêm na imagem do banco. A imagem `timescaledb-ha` é baseada em Ubuntu e é consideravelmente maior que a alpine anterior.
- **Ambiente**: duas variáveis novas e opcionais, `ADMIN_EMAIL` e `ADMIN_PASSWORD`. O volume `postgres_data` de desenvolvimento precisa ser recriado (`docker compose down -v`): o diretório de dados e o uid do processo mudam com a nova imagem. Não há dados de produção.
