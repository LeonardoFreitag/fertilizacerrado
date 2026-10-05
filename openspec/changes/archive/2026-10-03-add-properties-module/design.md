## Context

O backend tem Express 5, Prisma 5 com o model `User`, `authenticate`/`authorize`, error handler padronizado (`AppError`, `ZodError`, `P2002`) e uma stack Compose com `postgres:15-alpine`. O `docs/arquitetura.md` sempre previu PostGIS para talhões; a change de fundação registrou a troca de imagem como questão em aberto para este módulo.

Fontes de requisitos: `docs/modulos/propriedades.md` e o pedido da feature. Onde divergem ou são omissos, as decisões abaixo registram a escolha.

## Goals / Non-Goals

**Goals:**

- PostGIS e TimescaleDB disponíveis em desenvolvimento e produção com uma única troca de imagem.
- Um usuário `ADMIN` reproduzível em qualquer ambiente a partir do `.env`, sem SQL manual.
- Dez endpoints de propriedades e talhões funcionando de ponta a ponta com o escopo de acesso por role.
- Talhão criado com polígono válido sai com área, centróide e célula ERA5-Land persistidos — exatamente o que o pipeline ETL precisa.
- Toda escrita geográfica passa por SQL parametrizado; nenhuma string de GeoJSON é concatenada em SQL.

**Non-Goals:**

- Safras e a verificação de safras ativas na exclusão de talhão (fica o ponto de inserção).
- `MULTIPOLYGON`, buracos complexos além do que o GeoJSON `Polygon` já permite, importação de KML/shapefile.
- Paginação, filtros, busca espacial (talhões dentro de um bbox).
- Restaurar propriedade excluída; listar excluídas.
- Hipertabelas e a tabela `era5_daily_data` (pertencem à change do ETL/MSA); aqui a extensão `timescaledb` apenas fica instalada.
- Gestão de administradores além do seed (criar outros, trocar role).

## Decisions

### 1. Imagem `timescale/timescaledb-ha:pg15` nos dois Compose

A imagem oficial "HA" do Timescale traz PostgreSQL 15, TimescaleDB e PostGIS 3, o que cobre este módulo e o MSA (hipertabela `era5_daily_data`) sem nova troca de imagem. Diferenças em relação à `postgres:15-alpine` que afetam o Compose:

- **Diretório de dados**: `PGDATA` é `/home/postgres/pgdata/data`, não `/var/lib/postgresql/data`. O volume `postgres_data` passa a ser montado nesse caminho nos dois Compose.
- **Usuário do processo**: `postgres` com uid 1000 (a alpine usa uid 70). Um volume criado pela imagem anterior teria o diretório de dados com dono errado e o PostgreSQL recusaria iniciar. Como só existe o ambiente de desenvolvimento e ele não tem dados a preservar, o volume é recriado com `docker compose down -v`; o `init.sql` roda de novo. Não há volume de produção.
- **Base Ubuntu**: imagem maior (na casa de 1 GB contra ~250 MB). Aceito em troca de uma única imagem para todo o projeto.
- `pg_isready`, as variáveis `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` e o diretório `/docker-entrypoint-initdb.d/` funcionam como na imagem oficial; a imagem também já carrega `timescaledb` em `shared_preload_libraries`, requisito para `CREATE EXTENSION timescaledb`.

A tag `pg15` acompanha a última minor do TimescaleDB para o PG 15; se for preciso congelar, troca-se por uma tag específica (`pg15.x-tsy.z`) na change de deploy.

As duas extensões são criadas em dois lugares, ambos idempotentes:

- `init.sql`: `CREATE EXTENSION IF NOT EXISTS postgis;` e `CREATE EXTENSION IF NOT EXISTS timescaledb;` — vale para volumes novos.
- Topo da migration desta change — vale para bancos criados antes dela e para o shadow database do `prisma migrate dev`, que não executa o `init.sql`.

Na implementação, `CREATE EXTENSION IF NOT EXISTS timescaledb` dentro da migration foi aplicado sem erro (banco e shadow database), então o fallback de deixar o `timescaledb` só no `init.sql` não foi necessário. Observações da imagem em uso: os próprios scripts de init dela já criam `timescaledb` (e `timescaledb_toolkit`) antes do `init.sql`, que então apenas confirma com `IF NOT EXISTS`; as versões obtidas foram PostGIS 3.6 e TimescaleDB 2.28. O `@@index([geometry], type: Gist)` do Prisma gerou o índice GiST corretamente, sem edição manual.

### 2. Colunas geográficas como `Unsupported` no Prisma; escrita e leitura de `fields` via SQL parametrizado

O Prisma 5 não tem tipo nativo para PostGIS. `geometry` e `centroid` são declarados como `Unsupported("geography(Polygon,4326)")` e `Unsupported("geography(Point,4326)")`. Consequências, que o Prisma documenta:

- As duas colunas não existem no tipo gerado de `Field` e nunca são retornadas pelo client.
- Como são obrigatórias, o client **não gera** `create`/`update`/`upsert` para `Field`.

Portanto o repository de talhões usa `prisma.$queryRaw` com template tag (`Prisma.sql`), que parametriza todos os valores. O GeoJSON entra como parâmetro texto em `ST_GeomFromGeoJSON($1)::geography`; a leitura devolve `ST_AsGeoJSON(geometry)` e `ST_AsGeoJSON(centroid)`. `Property` e `Era5Cell` não têm colunas especiais e usam o client normal.

Alternativa: `geometry` nulo + `create` do client + `UPDATE` cru em transação. Descartada: duas escritas para um invariante ("talhão sempre tem polígono") que o banco deveria garantir com `NOT NULL`.

### 3. Uma única instrução SQL calcula área, centróide e valida a geometria

O `INSERT`/`UPDATE` de talhão com geometria faz, na mesma instrução:

- `geometry = ST_GeomFromGeoJSON($geojson)::geography`
- `centroid = ST_Centroid(geometry)` (variante `geography`, cálculo esferoidal)
- `area_ha = COALESCE($areaHa, ST_Area(geometry) / 10000)`

e o `RETURNING` traz `ST_AsGeoJSON(centroid)` para o passo da célula ERA5. Antes do `INSERT`, uma consulta `SELECT ST_IsValid(g), ST_IsValidReason(g), ST_Area(g::geography)` sobre o GeoJSON rejeita geometria inválida (auto-interseção, anel aberto que o Zod não pegou, área zero) com 400 `INVALID_GEOMETRY` e a razão do PostGIS na mensagem. Fazer a validação no banco evita reimplementar topologia em TypeScript.

`areaHa` informado pelo usuário é aceito como está (pode diferir da área do polígono, por exemplo por descontar carreadores), com limite de sanidade: entre 0,01 e 1.000.000 ha.

### 4. Validação do GeoJSON no Zod, antes do banco

`src/utils/geojson.util.ts` exporta o schema `polygonSchema`:

- `type` igual a `"Polygon"`;
- `coordinates`: 1 a 50 anéis; cada anel com 4 a 10.000 posições; cada posição `[lon, lat]` com `lon ∈ [-180, 180]`, `lat ∈ [-90, 90]` (um terceiro valor de altitude é aceito e descartado);
- primeira posição igual à última em cada anel (anel fechado).

O limite de posições protege o banco de payloads abusivos; o `client_max_body_size 20m` do Nginx é o segundo limite. Orientação dos anéis não é exigida: o PostGIS aceita qualquer orientação em `geography`.

### 5. Célula ERA5-Land: grade regular de 0,1° com nós em múltiplos de 0,1

O ERA5-Land é distribuído em grade regular lat/lon de 0,1°, com nós em múltiplos exatos de 0,1° (…, −16,5, −16,4, …). A célula "mais próxima" do centróide é o nó mais próximo em cada eixo, independentemente:

```
cellLat = round(lat × 10) / 10
cellLon = round(lon × 10) / 10
```

`src/utils/era5-grid.util.ts` implementa `snapToEra5Cell(lat, lon)` com arredondamento em inteiros (`Math.round(lat * 10) / 10`) para evitar artefatos de ponto flutuante, normaliza `−0` para `0` e um `lon` de `180,0` para `−180,0`. Em empate exato (centróide a 0,05° de dois nós), vale a regra do `Math.round` (meio para cima); documentado e testado, pois a escolha é arbitrária mas precisa ser determinística.

Tabela `era5_cells`: `field_id` (PK e FK para `fields`, `ON DELETE CASCADE`), `cell_lat Decimal(4,1)`, `cell_lon Decimal(5,1)`, `created_at`, `updated_at`. Uma linha por talhão; o `upsert` acontece em toda criação ou alteração de geometria, na mesma transação do talhão. Um índice em `(cell_lat, cell_lon)` serve ao ETL para agrupar talhões por célula.

O método `nearest` do xarray no ETL (`docs/msa/era5-etl.md`) chega ao mesmo nó; a tabela existe para que o ETL saiba quais células baixar sem consultar geometria.

### 6. Escopo de acesso: filtro único reutilizado em todas as consultas

`property.service` tem um `accessFilter(user)` que devolve o `where` do Prisma:

- `ADMIN`: `{}`;
- `AGRONOMO`: `{ OR: [{ ownerId: user.id }, { agronomistId: user.id }] }`;
- `PRODUTOR`: `{ ownerId: user.id }`.

Sempre combinado com `deletedAt: null`. Listagem, detalhe e toda operação em talhão (que começa carregando a propriedade pai) passam por ele. Propriedade fora do escopo ou excluída responde **404**, não 403: o usuário não deve descobrir que o id existe. 403 fica reservado ao `authorize` por role (ex.: `PRODUTOR` chamando `POST`).

### 7. Roles por rota, conforme a tabela da documentação

| Rota | `authorize` | Escopo adicional |
|---|---|---|
| `POST /properties` | `AGRONOMO`, `ADMIN` | Decisão 8 |
| `GET /properties`, `GET /:id` | qualquer autenticado | filtro da Decisão 6 |
| `PATCH /properties/:id` | `AGRONOMO`, `ADMIN` | propriedade no escopo |
| `DELETE /properties/:id` | `ADMIN` | — |
| `POST/PATCH/DELETE .../fields` | `AGRONOMO`, `ADMIN` | propriedade no escopo |
| `GET .../fields`, `GET .../fields/:id` | qualquer autenticado | propriedade no escopo |

### 8. Dono e responsável técnico na criação

O body de `POST /properties` aceita `ownerId` e `agronomistId` opcionais.

- `AGRONOMO`: `ownerId` ausente → o próprio agrônomo é o dono. `ownerId` de outro usuário (o produtor cliente) → `agronomistId` passa a ser o próprio agrônomo, salvo se informado. Se o resultado deixar o agrônomo fora de `ownerId` e `agronomistId`, 400 `AGRONOMIST_WITHOUT_ACCESS`: ele criaria algo que não poderia ver.
- `ADMIN`: `ownerId` obrigatório (400 se ausente).
- `ownerId` deve existir e ter role `PRODUTOR` ou `AGRONOMO`; `agronomistId` deve existir e ter role `AGRONOMO`. Violações → 400 `INVALID_OWNER` / `INVALID_AGRONOMIST`.

No `PATCH`, `ownerId` e `agronomistId` só podem ser alterados por `ADMIN` (400 `FORBIDDEN_FIELDS` para `AGRONOMO`), com as mesmas validações. Isso evita que um agrônomo transfira uma propriedade ou se remova dela por acidente; transferência é operação administrativa.

### 9. Soft delete de propriedade, hard delete de talhão

`Property` ganha `deletedAt DateTime?` — não está na lista de campos do pedido, mas a documentação define `DELETE` como soft delete e o campo é a forma mínima de implementá-lo. `DELETE /properties/:id` (só `ADMIN`) grava `deletedAt`; todas as consultas filtram `deletedAt: null`, então a propriedade e seus talhões somem da API, mas permanecem no banco para auditoria e para as safras que vierem a referenciá-los. Repetir o `DELETE` responde 404.

Talhão é removido fisicamente (`DELETE` em `fields`; `era5_cells` cai por cascata). O `service.deleteField` chama `assertFieldCanBeDeleted(fieldId)`, que hoje não bloqueia nada e carrega o comentário de que a change de Safras deve ali rejeitar talhões com safras ativas (409).

### 10. Unidade federativa validada por enum

`state` aceita apenas as 27 siglas de UF, em maiúsculas (`z.enum`). `city` é texto livre de 2 a 120 caracteres — não há base de municípios no projeto. `car` e `nirf` são texto livre opcional (até 60 caracteres); seus formatos variam e não são validados.

### 11. Formato das respostas

Propriedade: todos os campos do model menos `deletedAt`, mais `owner` e `agronomist` resumidos (`id`, `name`, `email`), mais `fieldsCount` no detalhe.

Talhão: `id`, `name`, `propertyId`, `areaHa` (número), `geometry` (GeoJSON Polygon), `centroid` (GeoJSON Point), `soilType`, `notes`, `era5Cell` (`{ lat, lon }` ou `null`), `createdAt`, `updatedAt`. A listagem de talhões devolve o mesmo formato; polígonos grandes tornam a lista pesada, mas um filtro `?geometry=false` fica para quando houver frontend consumindo.

### 12. `PATCH` de talhão sem geometria não recalcula nada

Se o body não traz `geometry`, área, centróide e célula ficam intactos (mesmo que `areaHa` venha — ele apenas substitui a área). Se traz `geometry`, a mesma instrução da Decisão 3 recalcula centróide, recalcula a área **apenas se `areaHa` não vier no body**, e a célula ERA5 é refeita. Troca de geometria sem novo `areaHa` substitui uma área informada manualmente pela calculada — comportamento documentado na resposta do spec.

### 13. Camadas e arquivos

`property.routes` → `property.controller` / `field.controller` → `property.service` (regras, escopo, orquestração da transação) → `property.repository` (Prisma + SQL). Os DTOs ficam em `dtos/`: `create-property`, `update-property`, `create-field`, `update-field`. O router de talhões é um `Router({ mergeParams: true })` montado em `/:propertyId/fields` dentro do router de propriedades; `propertyId` e `id` são validados como UUID (400 se malformados, para não virar erro do Prisma).

### 14. Migration

Gerada com `prisma migrate dev --create-only --name create_properties_fields` e editada antes de aplicar para incluir, no topo, `CREATE EXTENSION IF NOT EXISTS postgis;` e, ao fim, `CREATE INDEX fields_geometry_idx ON fields USING GIST (geometry);` caso o Prisma não aceite `@@index([geometry], type: Gist)` sobre coluna `Unsupported` (tenta-se o atributo primeiro). O `migrate deploy` do startup aplica tudo no container.

### 15. Seed do administrador

`prisma/seed.ts`, registrado em `package.json` como `"prisma": { "seed": "ts-node --transpile-only prisma/seed.ts" }` e executado por `pnpm prisma db seed` (e automaticamente após `prisma migrate reset`).

- Lê `ADMIN_EMAIL` e `ADMIN_PASSWORD` via o `env` validado de `src/config/env.ts`, onde entram como opcionais (`ADMIN_EMAIL` com formato de e-mail). Sem as duas definidas, o seed informa e encerra com código 0: a ausência de admin é uma escolha válida, e o seed não deve quebrar `migrate reset`.
- Valida `ADMIN_PASSWORD` com o mesmo `passwordSchema` do cadastro; senha fraca encerra com código 1.
- `upsert` por `email` (normalizado em minúsculas): cria com `role = ADMIN`, `emailVerified = true`, `emailVerifiedAt = now()`, `passwordHash` bcrypt fator 12; se já existe, atualiza `passwordHash`, `role` e a verificação. Assim, trocar `ADMIN_PASSWORD` no `.env` e rodar o seed de novo rotaciona a senha, e um admin rebaixado por engano é restaurado. CPF/CNPJ ficam nulos: o seed não passa pelo DTO de cadastro, e a unicidade desses campos aceita nulos.
- O seed não roda no startup do Compose. Rodar a cada `up` reescreveria a senha a cada reinício; a execução explícita é o comportamento menos surpreendente. Em produção o comando é `docker compose exec api pnpm prisma db seed`.
- Como o seed importa `env.ts` e `passwordSchema` de `src/`, o estágio de produção do Dockerfile passa a copiar também `src/` e `tsconfig.json` (o `ts-node` já estava na imagem via `node_modules` completo). Alternativa descartada: duplicar a leitura do ambiente e a política de senha dentro do seed para torná-lo autossuficiente — evitaria o código-fonte na imagem, mas criaria duas políticas de senha para manter em sincronia. O `dist/` continua sendo o que o servidor executa.

O `ADMIN_EMAIL` não pode colidir com um usuário de outro role sem que este vire admin — é o comportamento do `upsert` e está documentado no `.env.example`.

### 16. Testes

Unitários (Vitest): `polygonSchema`, `snapToEra5Cell`, DTOs de propriedade (UF, campos exclusivos de `ADMIN`). Ponta a ponta: roteiro `curl` contra a stack com três usuários — o `ADMIN` vem do seed, `AGRONOMO` e `PRODUTOR` do cadastro —, cobrindo escopo, PostGIS e célula ERA5, nos moldes das changes anteriores.

## Risks / Trade-offs

- **[`CREATE EXTENSION timescaledb` dentro da migration]** → Risco previsto que não se materializou: a migration aplicou a extensão sem erro (ver Decisão 1). Mantido aqui como registro.
- **[Volume de desenvolvimento recriado]** → Qualquer dado local é perdido. Hoje só há dados de teste já limpos; a tarefa 1.3 deixa explícito o `down -v`.
- **[Imagem Ubuntu grande e tag flutuante `pg15`]** → Download inicial mais lento e possível atualização de minor do TimescaleDB entre `pull`s. Aceito em desenvolvimento; a change de deploy fixa a tag.
- **[Seed sobrescreve a senha do admin a cada execução]** → É o mecanismo de rotação; quem rodar o seed sem querer trocar a senha precisa manter `ADMIN_PASSWORD` igual. Documentado no `.env.example`.
- **[`ADMIN_PASSWORD` em texto no `.env`]** → Mesmo nível de exposição dos demais segredos do arquivo (JWT, SMTP, banco); o `.env` está no `.gitignore`.
- **[SQL cru fora do type-safety do Prisma]** → Restrito ao repository de talhões, com template tag parametrizado e um tipo de linha explícito. Erros de coluna aparecem no roteiro de ponta a ponta, não em compilação.
- **[Validação do PostGIS exige ida ao banco antes do `INSERT`]** → Duas instruções por criação. Aceito: evita reimplementar `ST_IsValid` e o custo é desprezível para o volume esperado.
- **[Listagem de talhões devolve polígonos completos]** → Pode ficar pesada; limitado a 10.000 posições por anel. Filtro para omitir geometria fica para quando houver consumidor.
- **[Sem verificação de safras na exclusão]** → Talhão com safras (quando existirem) poderia ser apagado. O ponto de inserção está marcado; a change de Safras deve preenchê-lo e adicionar o cenário ao spec.
- **[Soft delete sem restauração]** → Propriedade excluída por engano exige intervenção no banco. Aceito até existir demanda.
- **[`agronomistId` apontando para agrônomo sem relação com o dono]** → Qualquer `AGRONOMO` existente pode ser indicado; não há convite/aceite. Aceito nesta fase (o cadastro é feito pelo próprio técnico).

## Migration Plan

1. Trocar a imagem e o caminho do volume nos dois Compose; adicionar `postgis` e `timescaledb` ao `init.sql`.
2. `docker compose down -v && docker compose up -d db` — banco novo com as extensões criadas pelo `init.sql`.
3. Criar e aplicar a migration no host (`create_users` é reaplicada no banco novo); o `migrate deploy` do startup da API faz o mesmo no container.
4. Definir `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `.env` e rodar `pnpm prisma db seed`.
5. Rollback: voltar imagem e caminho do volume (com `down -v` de novo) e remover as três tabelas; não há dados de produção.

## Open Questions

- **`MULTIPOLYGON`**: a documentação o menciona, o pedido fixa `Polygon`. Fazendas com talhões descontínuos precisariam de dois talhões. Revisitar se aparecer no uso.
- **Tag da imagem em produção**: `pg15` flutua na minor do TimescaleDB; a change de deploy deve fixar uma tag completa.
