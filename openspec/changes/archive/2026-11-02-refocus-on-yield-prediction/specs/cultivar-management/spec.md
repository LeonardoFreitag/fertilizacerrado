## ADDED Requirements

### Requirement: Referência de soja exposta
`GET /api/v1/cultivars/reference` (qualquer usuário autenticado; declarada antes de `GET /:id`) SHALL devolver a cultivar de referência de soja do banco (`isDefault` verdadeiro, `crop SOJA`) com os 15 parâmetros, `id`, `name` e `cycleDescription`; se ela não existir, MUST responder 404 com o código `REFERENCE_CULTIVAR_MISSING`.

#### Scenario: Referência disponível
- **WHEN** um `PRODUTOR` chama `GET /api/v1/cultivars/reference` após o seed
- **THEN** a resposta é 200 com `isDefault true`, `crop SOJA`, `tBase 10`, `gdaTotal 1200` e os demais valores do seed

#### Scenario: Seed não executado
- **WHEN** não existe cultivar com `isDefault` verdadeiro
- **THEN** a resposta é 404 com `REFERENCE_CULTIVAR_MISSING`

#### Scenario: Não confunde com id
- **WHEN** `GET /api/v1/cultivars/reference` é chamado
- **THEN** a rota de detalhe por id não é acionada e não há 400 de "identificador inválido"

### Requirement: Sincronização com a referência
`POST /api/v1/cultivars/:id/sync-reference` (roles `AGRONOMO` e `ADMIN`; cultivar não-default visível ao usuário e editável por ele, com as mesmas regras do `PATCH`) SHALL aceitar `{ "mode": "unchanged" | "all" }`. Em `unchanged`, SHALL substituir pelos valores da referência atual apenas os parâmetros cujo valor atual é igual ao gravado em `referenceSnapshot`; em `all`, SHALL substituir os 15. Nos dois modos SHALL validar o estado resultante pelo mesmo schema do cadastro, gravar `referenceSnapshot` com os valores da referência atual e responder 200 com a cultivar e `updatedFields` (nomes dos parâmetros efetivamente alterados). Cultivar de referência MUST responder 403 `DEFAULT_CULTIVAR_READONLY`; `mode` ausente ou inválido MUST responder 400.

#### Scenario: Só campos não alterados
- **WHEN** a cultivar foi criada da referência, o técnico mudou `kcMid` para 1,10, a referência passou a ter `tBase 12` e o `POST` envia `mode "unchanged"`
- **THEN** a resposta é 200 com `tBase 12`, `kcMid 1,10`, `updatedFields ["tBase"]` e `referenceSnapshot.tBase 12`

#### Scenario: Todos os campos
- **WHEN** o `POST` envia `mode "all"` para a mesma cultivar
- **THEN** a resposta é 200 com os 15 parâmetros iguais à referência atual e `updatedFields` incluindo `kcMid`

#### Scenario: Nada a atualizar
- **WHEN** a cultivar já é igual à referência e o `POST` envia `mode "unchanged"`
- **THEN** a resposta é 200 com `updatedFields []`

#### Scenario: Cultivar de referência
- **WHEN** um `ADMIN` chama `POST /cultivars/:id/sync-reference` na própria referência
- **THEN** a resposta é 403 com `DEFAULT_CULTIVAR_READONLY`

#### Scenario: Modo inválido
- **WHEN** o corpo não traz `mode` ou traz `"partial"`
- **THEN** a resposta é 400 identificando `mode`

#### Scenario: Outro agrônomo
- **WHEN** um `AGRONOMO` que não é o criador chama a rota
- **THEN** a resposta é 404

### Requirement: Edição de parâmetros de cultivar em uso
`PATCH /api/v1/cultivars/:id` SHALL aceitar alterações nos 15 parâmetros científicos mesmo quando a cultivar é referenciada por safras, em qualquer status. A reprodutibilidade das runs do MSA é garantida pelo `cultivarSnapshot` de cada run; runs existentes MUST NOT ser alteradas e novas runs SHALL usar os valores atuais.

#### Scenario: Parâmetro alterado em cultivar em uso
- **WHEN** a cultivar tem uma safra `ACTIVE` com run `SUCCEEDED` e o criador envia `PATCH` com `kcMid: 1.1`
- **THEN** a resposta é 200 com `kcMid 1.1`, a run existente mantém `cultivarSnapshot.kcMid` original e `GET /harvests/:id/msa` passa a devolver `cultivarChangedSinceRun: true`

#### Scenario: Relação cruzada continua validada
- **WHEN** a cultivar em uso recebe `PATCH` com `gdaF3End` menor que `gdaF2End`
- **THEN** a resposta é 400 identificando `gdaF3End`

## MODIFIED Requirements

### Requirement: Cadastro de cultivar
O sistema SHALL criar uma cultivar em `POST /api/v1/cultivars` a partir de `name`, `cycleDescription` opcional e dos parâmetros `tBase`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`, `kyF2`, `kyF3`, `kyF4`, todos obrigatórios. A rota MUST exigir os roles `AGRONOMO` ou `ADMIN`. A cultivar criada MUST ter `crop` `SOJA`, `isDefault` falso, `createdById` igual ao usuário autenticado e `referenceSnapshot` com os 15 parâmetros da referência de soja no momento da criação; o DTO MUST NOT aceitar `isDefault` nem `crop` (400 identificando o campo). Em sucesso o sistema SHALL responder 201 com a cultivar.

#### Scenario: Cadastro válido
- **WHEN** um `AGRONOMO` envia nome e todos os parâmetros dentro das faixas
- **THEN** a resposta é 201 com `crop SOJA`, `isDefault` falso, `createdById` igual ao seu id e `referenceSnapshot` igual aos parâmetros da referência

#### Scenario: Produtor tenta cadastrar
- **WHEN** um `PRODUTOR` chama `POST /api/v1/cultivars`
- **THEN** a resposta é 403

#### Scenario: Tentativa de marcar como referência
- **WHEN** o corpo inclui `isDefault: true`
- **THEN** a resposta é 400 identificando `isDefault` e nada é criado

#### Scenario: Cultura informada
- **WHEN** o corpo inclui `crop: "MILHO"` ou `crop: "SOJA"`
- **THEN** a resposta é 400 identificando `crop` e nada é criado

#### Scenario: Nome repetido do mesmo criador
- **WHEN** o usuário já tem uma cultivar com o mesmo `name`
- **THEN** a resposta é 409

#### Scenario: Mesmo nome por outro criador
- **WHEN** outro usuário já tem uma cultivar com o mesmo `name`
- **THEN** a resposta é 201

#### Scenario: Parâmetro ausente
- **WHEN** o corpo não traz `kyF3`
- **THEN** a resposta é 400 identificando `kyF3`

### Requirement: Visibilidade de cultivares
`GET /api/v1/cultivars` SHALL listar, para `ADMIN`, todas as cultivares e, para os demais usuários, as cultivares de referência (`isDefault` verdadeiro) mais as criadas pelo próprio usuário, sem filtro por cultura. `GET /api/v1/cultivars/:id` SHALL seguir a mesma regra e responder 404 fora dela. Toda resposta de cultivar SHALL incluir `crop` (`SOJA`) e `referenceSnapshot` (nulo na referência).

#### Scenario: Agrônomo lista
- **WHEN** um `AGRONOMO` com uma cultivar própria chama `GET /api/v1/cultivars`
- **THEN** a resposta contém a cultivar de referência e a sua, e nenhuma cultivar de outro usuário

#### Scenario: Produtor lista
- **WHEN** um `PRODUTOR` chama `GET /api/v1/cultivars`
- **THEN** a resposta é 200 contendo a cultivar de referência

#### Scenario: Filtro por cultura removido
- **WHEN** a listagem é chamada com `?crop=SOJA`
- **THEN** o parâmetro é ignorado e a resposta é 200 com a listagem normal

#### Scenario: Administrador lista tudo
- **WHEN** um `ADMIN` chama `GET /api/v1/cultivars`
- **THEN** a resposta contém as cultivares de todos os usuários

#### Scenario: Detalhe de cultivar alheia
- **WHEN** um `AGRONOMO` chama `GET /api/v1/cultivars/:id` de uma cultivar não-default criada por outro usuário
- **THEN** a resposta é 404

#### Scenario: Detalhe de cultivar de referência
- **WHEN** qualquer usuário autenticado chama `GET /api/v1/cultivars/:id` de uma cultivar de referência
- **THEN** a resposta é 200

### Requirement: Cultivares de referência via seed
`prisma/seed.ts` SHALL criar ou atualizar uma cultivar de referência, idempotente por `name` + `crop`, com `isDefault` verdadeiro, `createdById` nulo e `referenceSnapshot` nulo: "Soja — referência Cerrado (plantio direto)" (`SOJA`: tBase 10, gdaTotal 1200, limiares 120/450/900, Kc 0.20/1.15/0.50, p 0.50, Zr 0.30→0.95, Ky 0.20/0.80/1.00/0.40). `reference-cultivars.ts` MUST conter apenas a referência de soja e `referenceCultivar('SOJA')` MUST devolvê-la. Os valores MUST passar pelo mesmo schema de validação da API e a fonte bibliográfica MUST constar em JSDoc no seed. O seed das cultivares MUST executar independentemente de `ADMIN_EMAIL`/`ADMIN_PASSWORD`. A migration desta change SHALL remover cultivares `MILHO` sem safras e MUST falhar, com mensagem explicativa, se existir cultivar `MILHO` referenciada por safra.

#### Scenario: Primeira execução
- **WHEN** o seed roda em um banco sem cultivares
- **THEN** existe exatamente uma cultivar com `isDefault` verdadeiro, `SOJA`, com os valores especificados

#### Scenario: Execução repetida
- **WHEN** o seed roda novamente
- **THEN** continua existindo exatamente uma cultivar de referência, com o mesmo id

#### Scenario: Valor corrigido no seed
- **WHEN** um parâmetro é alterado no código do seed e ele roda novamente
- **THEN** a cultivar de referência passa a ter o novo valor

#### Scenario: Referência de milho removida pela migration
- **WHEN** o banco tem a referência de milho do seed anterior, sem safras, e a migration roda
- **THEN** a cultivar de milho deixa de existir e o enum `crop` passa a ter só `SOJA`

#### Scenario: Milho em uso bloqueia a migration
- **WHEN** existe uma cultivar `MILHO` referenciada por uma safra
- **THEN** a migration falha com mensagem indicando a cultivar e a safra, sem alterar o banco

#### Scenario: Sem variáveis de administrador
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` não estão definidas
- **THEN** o seed ainda cria a cultivar de referência e encerra com código 0

## REMOVED Requirements

### Requirement: Parâmetros congelados em cultivar com safras
**Reason**: Questão aberta #5 decidida: o `cultivarSnapshot` de cada run já garante a reprodutibilidade, e o congelamento impedia o técnico de corrigir a cultivar e de sincronizá-la com a referência.
**Migration**: `cultivar.service.update` deixa de responder 409 `CULTIVAR_IN_USE` para parâmetros; o código continua usado pelo `DELETE`. O frontend remove a tela "parâmetros congelados" e o painel passa a avisar quando a cultivar mudou desde a run (`cultivarChangedSinceRun`).
