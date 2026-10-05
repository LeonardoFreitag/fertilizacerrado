## 1. PostGIS e TimescaleDB na infraestrutura

- [x] 1.1 Trocar a imagem do serviço `db` para `timescale/timescaledb-ha:pg15` e o destino do volume `postgres_data` para `/home/postgres/pgdata/data` em `docker-compose.yml` e `docker-compose.prod.yml`
- [x] 1.2 Adicionar `CREATE EXTENSION IF NOT EXISTS postgis;` e `CREATE EXTENSION IF NOT EXISTS timescaledb;` ao `backend/scripts/init.sql`
- [x] 1.3 Recriar o volume (`docker compose down -v`), subir o `db` com a nova imagem e confirmar `healthy`, `init.sql` executado (extensões `pgcrypto`, `uuid-ossp`, `postgis`, `timescaledb`, timezone) e `PostGIS_Version()` 3.x

## 2. Seed do administrador

- [x] 2.1 Adicionar `ADMIN_EMAIL` (e-mail, opcional) e `ADMIN_PASSWORD` (opcional) ao schema de `src/config/env.ts` e ao `.env.example`, com nota sobre rotação da senha pelo seed
- [x] 2.2 Implementar `prisma/seed.ts`: encerra com 0 e aviso sem as variáveis, valida a senha com `passwordSchema`, `upsert` por e-mail com `role ADMIN`, `emailVerified true`, `emailVerifiedAt`, bcrypt fator 12
- [x] 2.3 Configurar `"prisma": { "seed": "ts-node --transpile-only prisma/seed.ts" }` no `package.json` e executar `pnpm prisma db seed` duas vezes, confirmando um único admin e a atualização do hash na segunda execução

## 3. Modelos e migration

- [x] 3.1 Adicionar ao `schema.prisma` os models `Property` (com `deletedAt`), `Field` (`geometry` e `centroid` como `Unsupported` geography) e `Era5Cell`, e as relações `ownedProperties`/`supervisedProperties` em `User`
- [x] 3.2 Gerar a migration `create_properties_fields` com `--create-only`, editar para incluir `CREATE EXTENSION IF NOT EXISTS postgis` e `CREATE EXTENSION IF NOT EXISTS timescaledb` no topo e o índice GiST em `fields.geometry`, e aplicar; se a criação do `timescaledb` falhar na migration, manter só no `init.sql` e registrar no design
- [x] 3.3 Confirmar `pnpm prisma generate` sem erros e a ausência de `create`/`update` no client de `Field` (esperado)

## 4. Utilitários

- [x] 4.1 Implementar `src/utils/geojson.util.ts` com o `polygonSchema` Zod (tipo, anéis, posições, intervalos, fechamento, descarte de altitude) e testes unitários
- [x] 4.2 Implementar `src/utils/era5-grid.util.ts` com `snapToEra5Cell(lat, lon)` e testes unitários (nó exato, empate, ponto flutuante, `-0`, antimeridiano)

## 5. Módulo properties — DTOs e repository

- [x] 5.1 Criar os DTOs em `dtos/`: `create-property` (UF enum, `ownerId`/`agronomistId` UUID opcionais), `update-property` (parcial, ao menos um campo, `agronomistId` nulo permitido), `create-field` (`geometry` obrigatória, `areaHa` 0,01–1.000.000), `update-field` (parcial, ao menos um campo), e o schema de params UUID; testes unitários dos DTOs de propriedade
- [x] 5.2 Implementar em `property.repository.ts` as operações de `Property` via Prisma Client (listar com filtro de escopo, detalhar com `owner`, `agronomist` e contagem de talhões, criar, atualizar, soft delete) e a busca de usuários por id/role
- [x] 5.3 Implementar no repository as operações de `Field` via `$queryRaw` parametrizado: validar geometria (`ST_IsValid`, `ST_IsValidReason`, área), inserir e atualizar com `ST_GeomFromGeoJSON`, `ST_Centroid` e `COALESCE` da área, listar/detalhar com `ST_AsGeoJSON`, excluir; e o upsert de `Era5Cell`

## 6. Módulo properties — service, controllers e rotas

- [x] 6.1 Implementar em `property.service.ts` o `accessFilter(user)` e `getAccessibleProperty(user, id)` (404 fora do escopo ou excluída)
- [x] 6.2 Implementar no service o cadastro e a atualização de propriedade (regras de `ownerId`/`agronomistId` por role, `INVALID_OWNER`, `INVALID_AGRONOMIST`, `AGRONOMIST_WITHOUT_ACCESS`, `FORBIDDEN_FIELDS`) e o soft delete
- [x] 6.3 Implementar no service o cadastro e a atualização de talhão em transação (validação PostGIS → escrita → `snapToEra5Cell` → upsert da célula), a consulta e a exclusão com `assertFieldCanBeDeleted` como ponto de inserção da regra de safras
- [x] 6.4 Implementar `property.controller.ts` e `field.controller.ts` (parse de params e body, mapeamento das respostas com `geometry`/`centroid` em GeoJSON e `era5Cell`)
- [x] 6.5 Implementar `property.routes.ts` com `authenticate`, `authorize` por rota conforme o design e o sub-router de talhões com `mergeParams`; montar em `/api/v1/properties` no `app.ts`

## 7. Verificação

- [x] 7.1 `pnpm typecheck`, `pnpm build` e `pnpm test` sem erros
- [x] 7.2 Reconstruir a stack e confirmar as migrations aplicadas, as três tabelas, as extensões `postgis` e `timescaledb` e o índice GiST
- [x] 7.3 Roteiro de propriedades: `ADMIN` do seed faz login; cadastrar `AGRONOMO` e `PRODUTOR`; criação por agrônomo (para si e para o produtor), `AGRONOMIST_WITHOUT_ACCESS`, admin sem `ownerId`, `INVALID_OWNER`/`INVALID_AGRONOMIST`, UF inválida, 403 do produtor, 401 sem token
- [x] 7.4 Roteiro de escopo: listagens dos três roles, 404 fora do escopo, `PATCH` por agrônomo, `FORBIDDEN_FIELDS`, `PATCH` de `agronomistId` por admin, soft delete pelo admin do seed (204, `deletedAt`, 404 depois, 404 nos talhões, 403 do agrônomo)
- [x] 7.5 Roteiro de talhões: criação com quadrado de ~1 km (área 99–101 ha), área informada, `INVALID_GEOMETRY` com figura em 8, erros estruturais do GeoJSON, altitude descartada, `ST_Within` do centróide, listagem/detalhe, 404 de talhão de outra propriedade, `PATCH` só de nome, `PATCH` com nova geometria (com e sem `areaHa`), `DELETE` com cascata em `era5_cells`
- [x] 7.6 Roteiro ERA5: célula correta na criação, célula atualizada quando a geometria muda de célula, inalterada em `PATCH` sem geometria, agrupamento por célula com dois talhões
- [x] 7.7 Validar `docker compose -f docker-compose.prod.yml config` com a nova imagem e o novo caminho do volume, e limpar os dados de teste (mantendo o admin do seed)
