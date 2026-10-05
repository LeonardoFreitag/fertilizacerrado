# Módulo de Propriedades e Talhões

## Responsabilidade

Gerencia o cadastro geoespacial das fazendas (propriedades) e suas subdivisões operacionais (talhões). Toda análise agrometeorológica, de solo e recomendação é feita no nível do talhão.

---

## Banco de dados

O serviço `db` usa a imagem **`timescale/timescaledb-ha:pg15`** (PostgreSQL 15 + PostGIS + TimescaleDB), definida em `docker-compose.yml` e `docker-compose.prod.yml`. O diretório de dados dessa imagem é `/home/postgres/pgdata/data`, caminho em que o volume `postgres_data` é montado. As extensões `postgis` e `timescaledb` são criadas pelo `backend/scripts/init.sql` (volume novo) e, de forma idempotente, pela migration `create_properties_fields` (bancos existentes e shadow database do Prisma).

As colunas geográficas são declaradas no Prisma como `Unsupported("geography(...)")`. Por isso o Prisma Client não gera `create`/`update` para `Field`, e toda escrita e leitura de talhões é feita em SQL parametrizado (`$queryRaw`) no `property.repository.ts`.

---

## Modelo de Dados

### Property (Propriedade / Fazenda)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | Chave primária |
| `name` | String | Nome da propriedade |
| `state` | String(2) | UF — uma das 27 siglas, em maiúsculas |
| `city` | String | Município (texto livre) |
| `car` | String? | Cadastro Ambiental Rural |
| `nirf` | String? | Número do Imóvel Rural na Receita Federal |
| `ownerId` | UUID | FK → User com role `PRODUTOR` ou `AGRONOMO` |
| `agronomistId` | UUID? | FK → User com role `AGRONOMO` (responsável técnico) |
| `deletedAt` | DateTime? | Soft delete; preenchido torna a propriedade invisível na API |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

### Field (Talhão)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | Chave primária |
| `name` | String | Identificação do talhão (ex: "Talhão 3A") |
| `propertyId` | UUID | FK → Property (`ON DELETE CASCADE`) |
| `areaHa` | Decimal(12,2) | Área em hectares, informada ou calculada |
| `geometry` | `geography(Polygon,4326)` | Polígono GeoJSON **`Polygon`** armazenado via PostGIS, com índice GiST |
| `centroid` | `geography(Point,4326)` | `ST_Centroid(geometry)`, recalculado a cada alteração da geometria |
| `soilType` | String? | Tipo de solo predominante (ex: "LVdf") |
| `notes` | String? | Observações livres do técnico |
| `altitudeM` | Float? | Altitude (m), em [−100, 5000]. **Obrigatória para o MSA** (entra em P e γ da ET₀); sem ela o processamento responde 422 `MISSING_FIELD_ALTITUDE` — não há default |
| `thetaFC` | Float? | Umidade volumétrica na capacidade de campo (m³/m³), em (0, 1) |
| `thetaWP` | Float? | Umidade volumétrica no ponto de murcha (m³/m³), em (0, 1); `thetaFC > thetaWP`, validado também no `PATCH` sobre o estado resultante. Sem os dois, o MSA usa 0,28/0,12 (Latossolo Vermelho) e registra `soilDefaults: true` no snapshot da run |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

### Era5Cell (`era5_cells`)

| Campo | Tipo | Notas |
|---|---|---|
| `fieldId` | UUID | PK e FK → Field (`ON DELETE CASCADE`); uma linha por talhão |
| `cellLat` | Decimal(4,1) | Latitude do nó da grade ERA5-Land |
| `cellLon` | Decimal(5,1) | Longitude do nó da grade ERA5-Land |
| `createdAt` / `updatedAt` | DateTime | |

Índice em `(cellLat, cellLon)` para o ETL agrupar talhões por célula.

---

## Endpoints

Todas as rotas exigem `Authorization: Bearer <access token>`.

### Propriedades

| Método | Path | Descrição | Roles |
|---|---|---|---|
| POST | `/api/v1/properties` | Cria propriedade | AGRONOMO, ADMIN |
| GET | `/api/v1/properties` | Lista propriedades no escopo do usuário | Todos |
| GET | `/api/v1/properties/:id` | Detalha propriedade (inclui `owner`, `agronomist` e `fieldsCount`) | Todos |
| PATCH | `/api/v1/properties/:id` | Atualização parcial | AGRONOMO (no escopo), ADMIN |
| DELETE | `/api/v1/properties/:id` | Soft delete (grava `deletedAt`) | ADMIN |

### Talhões

| Método | Path | Descrição | Roles |
|---|---|---|---|
| POST | `/api/v1/properties/:propertyId/fields` | Cadastra talhão | AGRONOMO, ADMIN |
| GET | `/api/v1/properties/:propertyId/fields` | Lista talhões | Todos |
| GET | `/api/v1/properties/:propertyId/fields/:id` | Detalha talhão | Todos |
| PATCH | `/api/v1/properties/:propertyId/fields/:id` | Atualização parcial | AGRONOMO, ADMIN |
| DELETE | `/api/v1/properties/:propertyId/fields/:id` | Remove talhão (físico; `era5_cells` em cascata; 409 se houver safras) | AGRONOMO, ADMIN |
| GET | `/api/v1/properties/:propertyId/fields/:fieldId/harvests` | Lista safras do talhão (módulo de Safras) | Todos |

Resposta de talhão: `id`, `name`, `propertyId`, `areaHa` (número), `geometry` (GeoJSON `Polygon`), `centroid` (GeoJSON `Point`), `soilType`, `notes`, `era5Cell` (`{ lat, lon }`), `createdAt`, `updatedAt`.

---

## Regras de Negócio

### Escopo de acesso

- **PRODUTOR** acessa apenas propriedades com `ownerId` igual ao seu id.
- **AGRONOMO** acessa propriedades em que é `ownerId` ou `agronomistId`.
- **ADMIN** acessa tudo.
- Propriedade fora do escopo, inexistente ou excluída responde **404** em qualquer rota que a referencie (inclusive as de talhões) — o usuário não descobre que o id existe. **403** fica reservado à negação por role (ex.: `PRODUTOR` chamando `POST`).

### `ownerId` e `agronomistId` na criação

- `AGRONOMO` sem `ownerId`: ele próprio é o dono.
- `AGRONOMO` com `ownerId` de outro usuário (o produtor cliente): `agronomistId` passa a ser o próprio agrônomo, salvo se informado. Se o resultado o deixar fora de `ownerId` e `agronomistId`, 400 `AGRONOMIST_WITHOUT_ACCESS`.
- `ADMIN`: `ownerId` obrigatório.
- `ownerId` deve existir com role `PRODUTOR` ou `AGRONOMO` (400 `INVALID_OWNER`); `agronomistId` deve existir com role `AGRONOMO` (400 `INVALID_AGRONOMIST`).

### `PATCH` de propriedade

- `AGRONOMO` altera `name`, `state`, `city`, `car` e `nirf`.
- `ownerId` e `agronomistId` só podem ser alterados por `ADMIN` (400 `FORBIDDEN_FIELDS` para os demais); `agronomistId: null` remove o responsável técnico.

### Soft delete

`DELETE /properties/:id` grava `deletedAt` e não remove a linha. A propriedade e seus talhões somem de todas as rotas; repetir o `DELETE` responde 404. Não há restauração pela API.

### Geometria do talhão

- `geometry` é obrigatória e deve ser um GeoJSON `Polygon`: 1 a 50 anéis, cada um com 4 a 10.000 posições `[lon, lat]` (altitude é aceita e descartada), fechado (primeira posição igual à última), coordenadas dentro dos intervalos válidos. Erros estruturais respondem 400 `VALIDATION_ERROR` apontando `geometry`.
- Antes de persistir, o PostGIS valida a topologia: `ST_IsValid` falso ou área zero respondem 400 `INVALID_GEOMETRY` com a razão (`ST_IsValidReason`), por exemplo auto-interseção.
- `areaHa` é calculada como `ST_Area(geometry) / 10000` quando não informada; quando informada, deve estar entre 0,01 e 1.000.000 ha e é aceita como está.
- No `PATCH`, enviar `geometry` recalcula o centróide, a célula ERA5 e — se `areaHa` não vier no mesmo corpo — a área. Sem `geometry`, nada disso muda.
- Talhão com safras não pode ser excluído: safra `ACTIVE` responde 409 `FIELD_HAS_ACTIVE_HARVEST`; apenas safras históricas (`COMPLETED`/`CANCELLED`) respondem 409 `FIELD_HAS_HARVESTS`, porque são o registro do produtor (FK `RESTRICT`). Para "sumir" com um talhão com histórico, o caminho é o soft delete da propriedade.

---

## Integração com o MSA

Ao criar um talhão, ou ao alterar sua geometria, na mesma transação:

1. O PostGIS calcula e armazena o centróide (`ST_Centroid`).
2. O backend identifica a célula ERA5-Land mais próxima: a grade é regular de **0,1° × 0,1°**, com nós em múltiplos exatos de 0,1°, e cada coordenada do centróide é arredondada para o décimo de grau mais próximo (`src/utils/era5-grid.util.ts`; empate exato resolvido para cima, `-0` normalizado para `0`, longitude `180` convertida em `-180`).
3. A célula é gravada em `era5_cells` (`upsert` por `fieldId`).
4. A partir desse momento, o job de ETL inclui a célula nas extrações futuras; o método `nearest` do xarray chega ao mesmo nó.

---

## Questões em aberto

- **`MULTIPOLYGON`**: não é aceito. Fazendas com talhões descontínuos precisam de dois talhões. Revisitar se aparecer no uso.
- **Paginação e filtros** nas listagens; filtro para omitir `geometry` na lista de talhões.
- **Restauração** de propriedades excluídas.

---

## Referências de Implementação

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/properties/property.routes.ts` | Rotas, `authenticate`/`authorize` por rota, sub-router de talhões |
| `src/modules/properties/property.controller.ts` | Endpoints de propriedade |
| `src/modules/properties/field.controller.ts` | Endpoints de talhão |
| `src/modules/properties/property.service.ts` | Regras de negócio, escopo de acesso, transação talhão + célula |
| `src/modules/properties/property.repository.ts` | Queries Prisma + SQL PostGIS parametrizado |
| `src/modules/properties/dtos/` | Schemas Zod (propriedade, talhão, params) |
| `src/utils/geojson.util.ts` | Schema Zod do GeoJSON `Polygon` |
| `src/utils/era5-grid.util.ts` | Snap do centróide para a grade ERA5-Land |
| `prisma/schema.prisma` | Models `Property`, `Field` e `Era5Cell` |
| `backend/scripts/init.sql` | Extensões `pgcrypto`, `uuid-ossp`, `postgis` e `timescaledb` |
| `backend/scripts/e2e/e2e-properties.sh` | Roteiro de verificação de ponta a ponta |
