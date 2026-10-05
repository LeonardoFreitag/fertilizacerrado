## Why

O motor agrometeorológico (MSA), objeto da dissertação, precisa de duas entradas que ainda não existem: os parâmetros fisiológicos da cultivar (GDA, Kc, p, Zr, Ky) e a safra que liga um talhão a uma cultivar a partir de uma data de emergência. Sem eles não há como calcular janelas fenológicas nem balanço hídrico. Esta change abre a Fase 1 de `docs/arquitetura.md` implementando as seções 1 e 2 de `docs/modulos/msa.md`, e fecha a regra deixada em aberto pela change de Propriedades: talhão com safra ativa não pode ser excluído.

## What Changes

- Novos models Prisma `Cultivar` (enum `Crop { SOJA, MILHO }`) e `Harvest` (enum `HarvestStatus { ACTIVE, COMPLETED, CANCELLED }`), com relações para `User`, `Field` e `Cultivar`, e a migration correspondente.
- Validação Zod dos parâmetros da cultivar com faixas plausíveis e restrições cruzadas (limiares de GDA estritamente crescentes e menores que o total; `zrIni ≤ zrMax`), aplicadas também no `PATCH` sobre o estado resultante.
- CRUD de cultivares em `/api/v1/cultivars`: listagem das cultivares de referência (`isDefault`) mais as próprias; criação, edição e exclusão apenas de cultivares não-default, pelo criador ou por `ADMIN`.
- `prisma/seed.ts` estendido com as duas cultivares de referência (soja e milho, Cerrado), idempotente por `name` + `crop`, com fonte bibliográfica em JSDoc.
- Safras em `/api/v1/harvests` (criar, listar com filtros `fieldId`/`status`, detalhar, atualizar `status`/`notes`/`season`) e a listagem aninhada `GET /api/v1/properties/:propertyId/fields/:fieldId/harvests`, com escopo herdado da propriedade do talhão.
- Regras: uma única safra `ACTIVE` por talhão (garantida sob lock da linha do talhão), data de emergência não futura, `PRODUTOR` somente leitura.
- Ativação da regra pendente: `DELETE` de talhão com safra `ACTIVE` responde 409; talhão com qualquer safra histórica também é protegido (409), pois a FK é `RESTRICT`.
- Novo roteiro `backend/scripts/e2e/e2e-cultivars-harvests.sh` e atualização do README dos roteiros; preenchimento dos Ky de milho em `docs/modulos/msa.md`.

Fora do escopo: o motor MSA em si (GDA diário, ET₀, balanço hídrico, Monte Carlo), ETL ERA5-Land, BullMQ, resultados por safra, troca de `cultivarId`/`emergenceDate` após a criação, paginação, versionamento de parâmetros de cultivar.

## Capabilities

### New Capabilities
- `cultivar-management`: cadastro e consulta de cultivares com parâmetros agronômicos validados, cultivares de referência do sistema via seed, e regras de propriedade/edição.
- `harvest-management`: criação, consulta e atualização de safras com escopo herdado do talhão, unicidade de safra ativa por talhão e transições de status.

### Modified Capabilities
- `field-management`: o requisito "Exclusão de talhão" passa a rejeitar com 409 talhões que possuem safras (ativa ou histórica), em vez de apenas reservar o ponto de verificação.

## Impact

- **Código**: novos `src/modules/cultivars/` e `src/modules/harvests/` (controller, service, repository, routes, `dtos/`); alterações em `src/app.ts` (dois routers), `src/modules/properties/property.routes.ts` (rota aninhada de safras), `src/modules/properties/property.service.ts` e `property.repository.ts` (verificação de safras na exclusão), `prisma/schema.prisma`, `prisma/seed.ts`.
- **Banco**: tabelas `cultivars` e `harvests`, dois enums, FKs `RESTRICT` de `harvests` para `fields` e `cultivars`.
- **API**: dez rotas novas, todas autenticadas, na zona `api_general` do Nginx. Comportamento alterado em uma rota existente: `DELETE .../fields/:id` pode responder 409.
- **Dependências**: nenhuma nova.
- **Ambiente**: nenhuma variável nova. Rodar `pnpm prisma db seed` após a migration para criar as cultivares de referência.
