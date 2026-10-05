## 1. Modelos e migration

- [x] 1.1 Adicionar ao `schema.prisma` os enums `Crop` e `HarvestStatus`, o model `Cultivar` (parâmetros `Float`, `isDefault`, `createdById` com `onDelete: SetNull`, `@@unique([name, crop, createdById])`) e o model `Harvest` (`emergenceDate @db.Date`, FKs `RESTRICT` para `Field` e `Cultivar`, índices em `fieldId` e `status`), mais as relações inversas em `User`, `Field` e `Cultivar`
- [x] 1.2 Gerar e aplicar a migration `create_cultivars_harvests`; confirmar as FKs `RESTRICT` no banco

## 2. Módulo cultivars

- [x] 2.1 Criar `dtos/cultivar-params.schema.ts` com as faixas da Decisão 2 e as relações cruzadas em `superRefine`, com testes unitários cobrindo cada faixa, as relações e os valores das duas cultivares de referência
- [x] 2.2 Criar `create-cultivar.dto.ts` (rejeita `isDefault`), `update-cultivar.dto.ts` (parcial, ao menos um campo), `params.dto.ts` e o schema de query `?crop=`
- [x] 2.3 Implementar `cultivar.repository.ts` (listar com filtro de visibilidade, buscar, criar, atualizar, excluir, contar safras)
- [x] 2.4 Implementar `cultivar.service.ts`: filtro de visibilidade por role, 404 fora dela, `DEFAULT_CULTIVAR_READONLY`, `CULTIVAR_IN_USE` no `DELETE` e no `PATCH` que toca parâmetro científico de cultivar com safras (lista dos campos rejeitados; `name`/`cycleDescription` liberados), validação do estado resultante no `PATCH`
- [x] 2.5 Implementar `cultivar.controller.ts` e `cultivar.routes.ts` (`authenticate`, `authorize` por rota) e montar em `/api/v1/cultivars`

## 3. Seed das cultivares de referência

- [x] 3.1 Estender `prisma/seed.ts` com `seedCultivars()` (array com JSDoc citando FAO-56, FAO-33 e `docs/modulos/msa.md`; validação pelo schema; `findFirst` por `name`+`crop`+`isDefault` → `update`/`create`), executado antes de `seedAdmin` e independente de `ADMIN_*`
- [x] 3.2 Rodar o seed duas vezes e confirmar duas cultivares de referência com os mesmos ids; alterar temporariamente um valor, rodar e confirmar a atualização, depois restaurar

## 4. Módulo harvests

- [x] 4.1 Criar os DTOs: `create-harvest.dto.ts` (`emergenceDate` `YYYY-MM-DD`, `season` `AAAA/AA` consecutivos), `update-harvest.dto.ts` (`status`, `notes`, `season`; ao menos um; rejeita campos imutáveis), `list-harvests.dto.ts` (`fieldId`, `status`), `params.dto.ts`; testes unitários de formato de data/season
- [x] 4.2 Implementar `harvest.repository.ts`: listar com filtro de escopo via relação `field.property`, buscar com `field`/`cultivar` resumidos, criar, atualizar, `lockField` (`SELECT ... FOR UPDATE`) e `countActive(fieldId, excludeId?)`
- [x] 4.3 Implementar `harvest.service.ts`: resolução `fieldId → propertyId` + `propertyService.getAccessibleProperty`, `INVALID_CULTIVAR`, `EMERGENCE_DATE_IN_FUTURE`, transação com lock para `POST` e para `PATCH` que leva a `ACTIVE` (`FIELD_HAS_ACTIVE_HARVEST`), listagens e detalhe
- [x] 4.4 Implementar `harvest.controller.ts` e `harvest.routes.ts` (rotas de `/api/v1/harvests` e o `fieldHarvestRoutes` com `mergeParams`); montar `/api/v1/harvests` no `app.ts` e `fieldHarvestRoutes` em `property.routes.ts`

## 5. Regra de exclusão de talhão

- [x] 5.1 Adicionar `countHarvests(fieldId)` ao `property.repository.ts` (total e ativas) e implementar `assertFieldCanBeDeleted` com `FIELD_HAS_ACTIVE_HARVEST` / `FIELD_HAS_HARVESTS`

## 6. Verificação e documentação

- [x] 6.1 `pnpm typecheck`, `pnpm build` e `pnpm test` sem erros
- [x] 6.2 Reconstruir a stack, confirmar a migration aplicada e rodar o seed no container
- [x] 6.3 Criar `backend/scripts/e2e/e2e-cultivars-harvests.sh` cobrindo: visibilidade e CRUD de cultivares (403 do produtor, 400 por faixa e por relação cruzada, 400 `isDefault`, 409 nome repetido, 404 cultivar alheia, 403 `DEFAULT_CULTIVAR_READONLY`, `PATCH` que quebra relação, 409 `CULTIVAR_IN_USE` no `DELETE` e no `PATCH` de parâmetro com safra ativa e com safra histórica, inclusive com valor idêntico e corpo misto, 200 para `name`/`cycleDescription` em uso); safras (201, 404 fora do escopo, 403 produtor, `INVALID_CULTIVAR`, `EMERGENCE_DATE_IN_FUTURE`, data com hora, `season` inválida, 409 segunda ativa, nova após `COMPLETED`, reativação com outra ativa, criações simultâneas, listagens com filtros e 404, rota aninhada, `PATCH` de status/notes/season, campos imutáveis); exclusão de talhão (409 ativa, 409 histórica, 204 sem safras)
- [x] 6.4 Rodar `e2e-auth.sh`, `e2e-properties.sh` e `e2e-cultivars-harvests.sh` sem falhas; adicionar o novo roteiro ao `README.md` dos roteiros
- [x] 6.5 Atualizar `docs/modulos/msa.md` (Ky de milho na tabela, campos `notes`/`createdAt`/`updatedAt` e regras de safra) e `docs/modulos/propriedades.md` (regra de exclusão com 409 ativa/histórica) e limpar os dados de teste mantendo admin e cultivares de referência
