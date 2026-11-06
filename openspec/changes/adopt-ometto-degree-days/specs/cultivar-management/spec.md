## MODIFIED Requirements

### Requirement: Cadastro de cultivar
O sistema SHALL criar uma cultivar em `POST /api/v1/cultivars` a partir de `name`, `cycleDescription` opcional e dos parâmetros `tBase`, `tUpper` (temperatura-base superior, °C, número ou `null`), `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`, `kyF2`, `kyF3`, `kyF4`, todos presentes no corpo (16 parâmetros científicos; `tUpper` é o único que aceita `null`). A rota MUST exigir os roles `AGRONOMO` ou `ADMIN`. A cultivar criada MUST ter `crop` `SOJA`, `isDefault` falso, `createdById` igual ao usuário autenticado e `referenceSnapshot` com os 16 parâmetros da referência de soja no momento da criação (inclusive `tUpper`, número ou `null`); o DTO MUST NOT aceitar `isDefault` nem `crop` (400 identificando o campo). Em sucesso o sistema SHALL responder 201 com a cultivar.

#### Scenario: Cadastro válido
- **WHEN** um `AGRONOMO` envia nome e todos os parâmetros dentro das faixas
- **THEN** a resposta é 201 com `crop SOJA`, `isDefault` falso, `createdById` igual ao seu id e `referenceSnapshot` igual aos parâmetros da referência, com `referenceSnapshot.tUpper` presente

#### Scenario: Cadastro sem limite superior
- **WHEN** o corpo traz `tUpper: null`
- **THEN** a resposta é 201 com `tUpper` nulo

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
- **WHEN** o corpo não traz `kyF3` ou não traz `tUpper`
- **THEN** a resposta é 400 identificando o campo ausente

### Requirement: Faixas e relações dos parâmetros agronômicos
O sistema SHALL validar os parâmetros da cultivar com as faixas: `tBase` em [0, 20]; `tUpper` nulo ou em [15, 50] e, quando informado, `tUpper > tBase`; `gdaTotal` em [300, 4000]; `gdaF1End`, `gdaF2End` e `gdaF3End` positivos e estritamente crescentes, com `gdaF3End < gdaTotal`; `kcIni`, `kcMid` e `kcEnd` em (0, 1.5]; `depletionFraction` em (0, 1); `0 < zrIni ≤ zrMax ≤ 3`; `kyF1` a `kyF4` em [0, 1.5]. As relações cruzadas MUST ser avaliadas sobre o estado resultante também no `PATCH`.

#### Scenario: Limite superior abaixo da base
- **WHEN** `tBase` é 10 e `tUpper` é 10 ou 8
- **THEN** a resposta é 400 identificando `tUpper`

#### Scenario: Limite superior fora da faixa
- **WHEN** `tUpper` é 55
- **THEN** a resposta é 400 identificando `tUpper`

#### Scenario: PATCH de tBase que alcança tUpper
- **WHEN** a cultivar tem `tBase 10` e `tUpper 18` e o `PATCH` envia apenas `tBase: 18`
- **THEN** a resposta é 400 identificando `tUpper` e a cultivar permanece inalterada

#### Scenario: Limiares de GDA fora de ordem
- **WHEN** `gdaF2End` é menor ou igual a `gdaF1End`
- **THEN** a resposta é 400 identificando `gdaF2End`

#### Scenario: Último limiar igual ao total
- **WHEN** `gdaF3End` é igual a `gdaTotal`
- **THEN** a resposta é 400 identificando `gdaF3End`

#### Scenario: Kc acima do limite
- **WHEN** `kcMid` é 1.6
- **THEN** a resposta é 400 identificando `kcMid`

#### Scenario: Fração de depleção inválida
- **WHEN** `depletionFraction` é 0 ou 1
- **THEN** a resposta é 400 identificando `depletionFraction`

#### Scenario: Profundidade radicular invertida
- **WHEN** `zrIni` é maior que `zrMax`
- **THEN** a resposta é 400 identificando `zrMax`

#### Scenario: Zr acima de 3 m
- **WHEN** `zrMax` é 3.5
- **THEN** a resposta é 400 identificando `zrMax`

#### Scenario: Ky no limite superior
- **WHEN** `kyF3` é 1.5
- **THEN** o valor é aceito

#### Scenario: Ky negativo
- **WHEN** `kyF1` é -0.1
- **THEN** a resposta é 400 identificando `kyF1`

#### Scenario: PATCH que quebra relação cruzada
- **WHEN** uma cultivar tem `gdaF2End` 450 e `gdaF3End` 900 e o `PATCH` envia apenas `gdaF3End: 400`
- **THEN** a resposta é 400 identificando `gdaF3End` e a cultivar permanece inalterada

### Requirement: Cultivares de referência via seed
`prisma/seed.ts` SHALL criar ou atualizar uma cultivar de referência, idempotente por `name` + `crop`, com `isDefault` verdadeiro, `createdById` nulo e `referenceSnapshot` nulo: "Soja — referência Cerrado (plantio direto)" (`SOJA`: tBase 10, tUpper 30 (provisório — questão aberta #10), gdaTotal 1200, limiares 120/450/900, Kc 0.20/1.15/0.50, p 0.50, Zr 0.30→0.95, Ky 0.20/0.80/1.00/0.40). `reference-cultivars.ts` MUST conter apenas a referência de soja e `referenceCultivar('SOJA')` MUST devolvê-la. Os valores MUST passar pelo mesmo schema de validação da API e a fonte bibliográfica MUST constar em JSDoc no seed. O seed das cultivares MUST executar independentemente de `ADMIN_EMAIL`/`ADMIN_PASSWORD`. A migration `adopt_ometto_degree_days` SHALL adicionar `t_upper` (nulo), gravar 30 em todas as cultivares de soja existentes e acrescentar `tUpper: 30` ao `referenceSnapshot` das cultivares próprias, sem apagar nada. A migration `refocus_yield_prediction` (anterior) removeu cultivares `MILHO` sem safras e falha, com mensagem explicativa, se existir cultivar `MILHO` referenciada por safra.

#### Scenario: Primeira execução
- **WHEN** o seed roda em um banco sem cultivares
- **THEN** existe exatamente uma cultivar com `isDefault` verdadeiro, `SOJA`, com os valores especificados, inclusive `tUpper 30`

#### Scenario: Execução repetida
- **WHEN** o seed roda novamente
- **THEN** continua existindo exatamente uma cultivar de referência, com o mesmo id

#### Scenario: Valor corrigido no seed
- **WHEN** um parâmetro é alterado no código do seed e ele roda novamente
- **THEN** a cultivar de referência passa a ter o novo valor

#### Scenario: Migration preenche tUpper
- **WHEN** o banco tem a referência e uma cultivar própria criada antes desta change e a migration roda
- **THEN** ambas passam a ter `tUpper 30`, o `referenceSnapshot` da própria ganha `tUpper 30` e nenhuma run ou safra é alterada

#### Scenario: Referência de milho removida pela migration
- **WHEN** o banco tem a referência de milho do seed anterior, sem safras, e a migration roda
- **THEN** a cultivar de milho deixa de existir e o enum `crop` passa a ter só `SOJA`

#### Scenario: Milho em uso bloqueia a migration
- **WHEN** existe uma cultivar `MILHO` referenciada por uma safra
- **THEN** a migration falha com mensagem indicando a cultivar e a safra, sem alterar o banco

#### Scenario: Sem variáveis de administrador
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` não estão definidas
- **THEN** o seed ainda cria a cultivar de referência e encerra com código 0

### Requirement: Sincronização com a referência
`POST /api/v1/cultivars/:id/sync-reference` (roles `AGRONOMO` e `ADMIN`; cultivar não-default visível ao usuário e editável por ele, com as mesmas regras do `PATCH`) SHALL aceitar `{ "mode": "unchanged" | "all" }`. Em `unchanged`, SHALL substituir pelos valores da referência atual apenas os parâmetros cujo valor atual é igual ao gravado em `referenceSnapshot` (`null` igual a `null`); em `all`, SHALL substituir os 16. Nos dois modos SHALL validar o estado resultante pelo mesmo schema do cadastro, gravar `referenceSnapshot` com os valores da referência atual e responder 200 com a cultivar e `updatedFields` (nomes dos parâmetros efetivamente alterados). Cultivar de referência MUST responder 403 `DEFAULT_CULTIVAR_READONLY`; `mode` ausente ou inválido MUST responder 400.

#### Scenario: Só campos não alterados
- **WHEN** a cultivar foi criada da referência, o técnico mudou `kcMid` para 1,10, a referência passou a ter `tBase 12` e o `POST` envia `mode "unchanged"`
- **THEN** a resposta é 200 com `tBase 12`, `kcMid 1,10`, `updatedFields ["tBase"]` e `referenceSnapshot.tBase 12`

#### Scenario: Limite superior acompanha a referência
- **WHEN** a cultivar própria tem `tUpper 30` igual ao `referenceSnapshot`, a referência passa a ter `tUpper 32` e o `POST` envia `mode "unchanged"`
- **THEN** a resposta é 200 com `tUpper 32` e `updatedFields ["tUpper"]`

#### Scenario: Todos os campos
- **WHEN** o `POST` envia `mode "all"` para a mesma cultivar
- **THEN** a resposta é 200 com os 16 parâmetros iguais à referência atual e `updatedFields` incluindo `kcMid`

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
`PATCH /api/v1/cultivars/:id` SHALL aceitar alterações nos 16 parâmetros científicos (inclusive `tUpper: null`) mesmo quando a cultivar é referenciada por safras, em qualquer status. A reprodutibilidade das runs do MSA é garantida pelo `cultivarSnapshot` de cada run; runs existentes MUST NOT ser alteradas e novas runs SHALL usar os valores atuais.

#### Scenario: Parâmetro alterado em cultivar em uso
- **WHEN** a cultivar tem uma safra `ACTIVE` com run `SUCCEEDED` e o criador envia `PATCH` com `kcMid: 1.1`
- **THEN** a resposta é 200 com `kcMid 1.1`, a run existente mantém `cultivarSnapshot.kcMid` original e `GET /harvests/:id/msa` passa a devolver `cultivarChangedSinceRun: true`

#### Scenario: Remover o limite superior
- **WHEN** o criador envia `PATCH` com `tUpper: null`
- **THEN** a resposta é 200 com `tUpper` nulo e a próxima run usa só os casos 1–3 de Ometto

#### Scenario: Relação cruzada continua validada
- **WHEN** a cultivar em uso recebe `PATCH` com `gdaF3End` menor que `gdaF2End`
- **THEN** a resposta é 400 identificando `gdaF3End`
