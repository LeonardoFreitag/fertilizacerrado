## Context

Fase 0 concluída: Auth (com seed de `ADMIN`), Propriedades e Talhões (PostGIS, célula ERA5). O `property.service.ts` tem `assertFieldCanBeDeleted` vazio, à espera desta change. O padrão de módulo (routes → controller → service → repository, DTOs Zod, `AppError`, 404 fora do escopo / 403 por role) está estabelecido e será seguido.

Fontes: `docs/modulos/msa.md` (seções 1 e 2), `docs/msa/algoritmos.md` (semântica dos parâmetros: GDA e limiares F1–F4, Kc por fase, p/TAW/RAW, Zr, Ky), FAO-56 (Allen et al., 1998) e FAO-33 (Doorenbos & Kassam, 1979) para os valores de referência.

## Goals / Non-Goals

**Goals:**

- Cultivares com parâmetros que o motor MSA possa consumir sem revalidar: tudo que entra no banco já respeita as faixas e as relações entre campos.
- Duas cultivares de referência reproduzíveis em qualquer ambiente pelo seed, com rastreabilidade bibliográfica.
- Safra como vínculo talhão–cultivar–emergência, com no máximo uma ativa por talhão, mesmo sob requisições concorrentes.
- Escopo de acesso de safras idêntico ao do talhão, sem duplicar a lógica de propriedades.

**Non-Goals:**

- Cálculos do MSA; o módulo só fornece entradas.
- Histórico/versionamento dos parâmetros de uma cultivar.
- Alterar `cultivarId` ou `emergenceDate` de uma safra existente (invalidaria resultados futuros do MSA; cancela-se e cria-se outra).
- Fases fenológicas por dias de calendário; apenas GDA, como em `algoritmos.md`.

## Decisions

### 1. Parâmetros da cultivar como `Float`

São coeficientes científicos (Kc 1,15; p 0,50; Zr 0,95), não valores monetários; `double precision` representa e devolve em JSON sem conversão de `Decimal`. `areaHa` continua `Decimal` por vir de `ST_Area`; aqui não há essa restrição.

Campos: `tBase`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`–`kyF4`, todos obrigatórios; `cycleDescription` opcional; `isDefault` boolean; `createdById` FK opcional para `User` (nulo nas default, `onDelete: SetNull` para não perder cultivares quando um usuário for removido no futuro).

### 2. Faixas de validação

Em `dtos/cultivar-params.schema.ts`, um único schema de parâmetros reutilizado por create, update e seed:

| Campo | Faixa | Motivo |
|---|---|---|
| `tBase` | 0 ≤ x ≤ 20 °C | Temperaturas-base de culturas anuais ficam entre ~0 (trigo) e ~15 (algodão) |
| `gdaTotal` | 300 ≤ x ≤ 4000 °C·dia | Cobre de hortaliças a milhos tardios |
| `gdaF1End`, `gdaF2End`, `gdaF3End` | > 0 e `F1 < F2 < F3 < gdaTotal` | Janelas disjuntas e F4 não vazia |
| `kcIni`, `kcMid`, `kcEnd` | 0 < x ≤ 1,5 | Tabela 12 da FAO-56 não passa de ~1,3 |
| `depletionFraction` | 0 < p < 1 | Fração |
| `zrIni`, `zrMax` | 0 < `zrIni` ≤ `zrMax` ≤ 3 m | Tabela 22 da FAO-56 |
| `kyF1`–`kyF4` | 0 ≤ x ≤ 1,5 | FAO-33: Ky de floração do milho é 1,5 (limite inclusivo) |

As relações cruzadas ficam em `superRefine`, apontando o campo à direita da desigualdade violada (`gdaF2End`, `zrMax`...). Não se exige `kcIni ≤ kcMid` nem `kcEnd ≤ kcMid`: há culturas e manejos em que isso não vale, e o motor interpola o que receber.

### 3. `PATCH` valida o estado resultante

`PATCH /cultivars/:id` aceita um subconjunto dos campos; o service funde o registro atual com o patch e valida o objeto completo com o schema da Decisão 2 antes de gravar. Validar só os campos enviados permitiria quebrar `gdaF2End < gdaF3End` em dois pedidos separados.

`crop` não é alterável pelo `PATCH` (400): mudar a cultura de uma cultivar não faz sentido agronômico — cria-se outra. `isDefault` e `createdById` também são rejeitados com 400 no path do campo.

### 4. Cultivares de referência são imutáveis pela API

`isDefault` não é aceito em nenhum DTO; só o seed grava `true`. `PATCH`/`DELETE` em cultivar default respondem 403 `DEFAULT_CULTIVAR_READONLY` para qualquer role, inclusive `ADMIN`. Corrigir um valor de referência é alterar o seed e rodá-lo de novo (idempotente, atualiza os parâmetros) — assim a mudança fica versionada no repositório junto da sua fonte, o que a dissertação exige.

### 5. Visibilidade e propriedade das cultivares

- `GET /cultivars`: `ADMIN` vê todas; os demais veem `isDefault = true` ou `createdById = eu`. Filtro opcional `?crop=SOJA|MILHO`.
- `GET /cultivars/:id`: mesma regra; fora dela, 404.
- `POST`: `AGRONOMO` e `ADMIN`; `createdById = eu`, `isDefault = false`. `PRODUTOR` → 403.
- `PATCH`/`DELETE` em não-default: criador ou `ADMIN`; outro usuário vê 404 (não enxerga a cultivar).
- Unicidade: `@@unique([name, crop, createdById])`. Dois agrônomos podem ter "Minha soja"; o mesmo agrônomo não. Para as default, `createdById` nulo torna a unicidade do banco inoperante (nulos distintos), então o seed localiza por `name` + `crop` + `isDefault` antes de criar.

### 6. Cultivar em uso: parâmetros científicos congelados, exclusão bloqueada

Uma cultivar está "em uso" quando existe ao menos uma safra que a referencia, em qualquer status. Nesse estado:

- `DELETE` responde 409 `CULTIVAR_IN_USE` (a FK `harvests.cultivar_id` é `RESTRICT` como segunda barreira).
- `PATCH` que toque em qualquer parâmetro científico — `tBase`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`–`kyF4` — responde 409 `CULTIVAR_IN_USE`, listando os campos rejeitados. Só `name` e `cycleDescription` seguem editáveis.

Motivo: reprodutibilidade. Os resultados do MSA de uma safra derivam dos parâmetros da cultivar no momento do processamento; se eles mudarem depois, o resultado deixa de ser reproduzível, o que a dissertação não pode admitir. Para corrigir um parâmetro de uma cultivar em uso, cria-se uma nova cultivar (ex.: "Soja X — v2") e as safras futuras passam a usá-la.

A verificação é feita no service, antes da validação do estado resultante (Decisão 3): a contagem de safras e a lista dos campos presentes no patch decidem o 409 sem tocar no banco além da contagem. Enviar um parâmetro com o valor **igual** ao atual também é rejeitado — a regra é sobre a intenção de alterar, e comparar valores de ponto flutuante para abrir exceção criaria mais ambiguidade do que resolve.

**Relaxamento previsto**: quando o motor MSA gravar um snapshot dos parâmetros da cultivar em cada processamento (ver Open Questions), a reprodutibilidade passa a ser garantida pelo snapshot e esta regra pode ser relaxada para permitir edição com reprocessamento das safras ativas.

### 7. Safra: escopo herdado da propriedade do talhão

Toda operação em safra começa resolvendo `fieldId → propertyId` e chamando `propertyService.getAccessibleProperty(user, propertyId)`. Com isso o escopo (PRODUTOR = dono; AGRONOMO = dono ou responsável; ADMIN = tudo; 404 fora dele; propriedade excluída = inexistente) é exatamente o das propriedades sem código novo. `harvest.service` importa `property.service` — dependência de módulo em um sentido só (harvests → properties), aceitável.

Para listagens sem `fieldId`, o filtro é `field.property` dentro de `accessFilter(user)` + `deletedAt: null`, aplicado no Prisma via relação.

### 8. Roles por rota

| Rota | `authorize` | Escopo |
|---|---|---|
| `GET /cultivars`, `GET /cultivars/:id` | qualquer autenticado | Decisão 5 |
| `POST /cultivars` | `AGRONOMO`, `ADMIN` | — |
| `PATCH`, `DELETE /cultivars/:id` | `AGRONOMO`, `ADMIN` | criador ou `ADMIN`; default → 403 |
| `POST /harvests`, `PATCH /harvests/:id` | `AGRONOMO`, `ADMIN` | propriedade do talhão |
| `GET /harvests`, `GET /harvests/:id`, `GET .../fields/:fieldId/harvests` | qualquer autenticado | propriedade do talhão |

Não há `DELETE /harvests`: safra é cancelada (`status = CANCELLED`), preservando histórico.

### 9. Uma safra `ACTIVE` por talhão, sob lock

Índice parcial (`UNIQUE ... WHERE status = 'ACTIVE'`) seria o ideal, mas o Prisma não o representa no schema e o detectaria como drift, gerando um `DROP INDEX` na próxima migration. Alternativa adotada: na mesma transação, `SELECT id FROM fields WHERE id = $1 FOR UPDATE` serializa as escritas do talhão; em seguida conta-se `harvests` com `status = ACTIVE` (excluindo a própria safra, no caso de reativação) e, se houver, 409 `FIELD_HAS_ACTIVE_HARVEST`. O lock vale tanto para `POST` quanto para `PATCH` que leva a `ACTIVE`.

### 10. Transições de status

Qualquer transição entre `ACTIVE`, `COMPLETED` e `CANCELLED` é permitida; apenas a chegada em `ACTIVE` passa pela Decisão 9. Mesmo status é no-op. Travar `COMPLETED` como terminal fica para quando o MSA tiver resultados a proteger.

### 11. Data de emergência e safra agrícola

- `emergenceDate`: string `YYYY-MM-DD` (regex, sem hora, para não depender de fuso), gravada em `@db.Date`. Não pode ser posterior à data corrente em UTC do servidor (400 `EMERGENCE_DATE_IN_FUTURE`). Comparar datas-calendário evita o problema de uma emergência "hoje" virar "amanhã" por fuso.
- `season`: string `AAAA/AA` em que os dois últimos dígitos são o ano seguinte (`2025/26`); regex + verificação de consecutividade. Não se cruza com `emergenceDate` (a safrinha de milho emerge em fevereiro e pertence à safra do ano anterior).
- `cultivarId` deve ser visível ao usuário (Decisão 5); senão 400 `INVALID_CULTIVAR`.
- Respostas trazem `emergenceDate` como `YYYY-MM-DD`, `field` (`id`, `name`, `propertyId`) e `cultivar` (`id`, `name`, `crop`) resumidos.

### 12. Rota aninhada vive no módulo de safras

`GET /properties/:propertyId/fields/:fieldId/harvests` é exportado por `harvest.routes.ts` como `fieldHarvestRoutes` (`mergeParams`) e montado em `property.routes.ts`. Valida que o talhão pertence à propriedade do path (senão 404). O módulo de propriedades passa a importar o de safras só para essa montagem.

### 13. Exclusão de talhão com safras

FK `harvests.field_id` é `RESTRICT`. `assertFieldCanBeDeleted` (em `property.service`) consulta `property.repository.countHarvests(fieldId)` (evita importar o módulo de safras no service de propriedades) e responde:

- 409 `FIELD_HAS_ACTIVE_HARVEST` se houver safra `ACTIVE` — a regra da documentação;
- 409 `FIELD_HAS_HARVESTS` se houver apenas safras históricas — vai além da documentação, mas excluir fisicamente o talhão apagaria (ou violaria a FK de) safras concluídas, que são o histórico do produtor. Para "sumir" com um talhão com histórico, o caminho é o soft delete da propriedade ou, futuramente, um soft delete de talhão.

### 14. Seed das cultivares de referência

`prisma/seed.ts` ganha `seedCultivars()`, executado sempre (independe de `ADMIN_*`). Para cada entrada: `findFirst({ name, crop, isDefault: true })` → `update` dos parâmetros ou `create` com `isDefault: true`, `createdById: null`. Os valores são validados pelo mesmo schema da Decisão 2 antes de gravar — o seed não pode introduzir uma cultivar que a API rejeitaria. JSDoc no array de referência cita Allen et al. (1998) FAO-56 (Kc, p, Zr), Doorenbos & Kassam (1979) FAO-33 (Ky) e `docs/modulos/msa.md` para os limiares de GDA e o ajuste de `kcIni` do plantio direto.

Valores: soja — tBase 10, gdaTotal 1200, limiares 120/450/900, Kc 0,20/1,15/0,50, p 0,50, Zr 0,30→0,95, Ky 0,20/0,80/1,00/0,40; milho — tBase 10, gdaTotal 1500, limiares 150/600/1150, Kc 0,30/1,20/0,60, p 0,55, Zr 0,30→1,00, Ky 0,40/0,40/1,50/0,50.

### 15. Arquivos

```
src/modules/cultivars/{cultivar.routes,cultivar.controller,cultivar.service,cultivar.repository}.ts
src/modules/cultivars/dtos/{cultivar-params.schema,create-cultivar.dto,update-cultivar.dto,params.dto}.ts
src/modules/harvests/{harvest.routes,harvest.controller,harvest.service,harvest.repository}.ts
src/modules/harvests/dtos/{create-harvest.dto,update-harvest.dto,list-harvests.dto,params.dto}.ts
```

Testes unitários: schema de parâmetros (faixas e relações cruzadas), DTOs de safra (data futura, formato de `season`). Ponta a ponta: `backend/scripts/e2e/e2e-cultivars-harvests.sh`.

Na implementação, os roteiros `e2e-auth.sh` e `e2e-properties.sh` passaram a apagar também as cultivares não-default na limpeza inicial: como `cultivars.created_by_id` é `SET NULL`, remover os usuários de teste deixaria cultivares órfãs (não-default sem criador), visíveis só para `ADMIN`.

## Risks / Trade-offs

- **[Parâmetros congelados obrigam a criar uma nova cultivar para corrigir um erro]** → Custo aceito em troca da reprodutibilidade; a regra existe para ser relaxada quando o MSA tiver snapshot (Decisão 6). Enquanto isso, um erro de digitação em cultivar já usada vira uma cultivar "v2" e, se preciso, o cancelamento e a recriação da safra.
- **[Lock de linha em vez de índice parcial]** → Depende de todo caminho de escrita passar pelo service (vale hoje). Um `INSERT` manual no banco pode criar duas ativas; aceito.
- **[409 para talhão com safras históricas]** → Mais restritivo que a documentação. Alternativa (cascata) destruiria histórico. Documentado em `propriedades.md` pela tarefa de docs.
- **[Data "não futura" em UTC]** → Um técnico em UTC−3 às 22h não consegue registrar emergência de "hoje" se o servidor já virou o dia? Não: compara-se a data informada com a data UTC do servidor, que às 22h de Brasília já é o dia seguinte — a data local ainda é aceita. O caso inverso (servidor atrás do cliente) não ocorre com UTC.
- **[`season` sem cruzamento com a data]** → Um erro de digitação (`2024/25` para emergência em nov/2025) passa. Aceito; é campo descritivo.
- **[Sem `DELETE /harvests`]** → Safra criada por engano fica como `CANCELLED`. Aceito em favor do histórico.

## Migration Plan

1. Migration `create_cultivars_harvests` (enums, tabelas, FKs `RESTRICT`); aplicada no host e pelo `migrate deploy` do container.
2. `pnpm prisma db seed` para as cultivares de referência.
3. Rollback: reverter código e `DROP TABLE harvests, cultivars` e os enums; não há dados de produção.

## Open Questions

- **Snapshot de parâmetros no MSA**: a change do motor deve gravar, por processamento, os parâmetros da cultivar usados (em `msa_results` ou tabela própria). Quando existir, a Decisão 6 pode ser relaxada para permitir editar parâmetros de cultivares em uso, com reprocessamento das safras ativas.
- **Soft delete de talhão**: hoje um talhão com histórico não pode ser removido de forma alguma pela API. Avaliar junto com a listagem de "talhões arquivados".
