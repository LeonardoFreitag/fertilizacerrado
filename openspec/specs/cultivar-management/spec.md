# cultivar-management Specification

## Purpose

Cadastro e consulta de cultivares com parâmetros agronômicos validados (GDA, Kc, p, Zr, Ky), cultivares de referência do sistema via seed e regras de visibilidade, edição e congelamento em uso.

## Requirements

### Requirement: Cadastro de cultivar
O sistema SHALL criar uma cultivar em `POST /api/v1/cultivars` a partir de `name`, `crop` (`SOJA` ou `MILHO`), `cycleDescription` opcional e dos parâmetros `tBase`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`, `kyF2`, `kyF3`, `kyF4`, todos obrigatórios. A rota MUST exigir os roles `AGRONOMO` ou `ADMIN`. A cultivar criada MUST ter `isDefault` falso e `createdById` igual ao usuário autenticado; o DTO MUST NOT aceitar `isDefault`. Em sucesso o sistema SHALL responder 201 com a cultivar.

#### Scenario: Cadastro válido
- **WHEN** um `AGRONOMO` envia nome, `crop` e todos os parâmetros dentro das faixas
- **THEN** a resposta é 201 com `isDefault` falso e `createdById` igual ao seu id

#### Scenario: Produtor tenta cadastrar
- **WHEN** um `PRODUTOR` chama `POST /api/v1/cultivars`
- **THEN** a resposta é 403

#### Scenario: Tentativa de marcar como referência
- **WHEN** o corpo inclui `isDefault: true`
- **THEN** a resposta é 400 identificando `isDefault` e nada é criado

#### Scenario: Nome repetido do mesmo criador
- **WHEN** o usuário já tem uma cultivar com o mesmo `name` e `crop`
- **THEN** a resposta é 409

#### Scenario: Mesmo nome por outro criador
- **WHEN** outro usuário já tem uma cultivar com o mesmo `name` e `crop`
- **THEN** a resposta é 201

#### Scenario: Parâmetro ausente
- **WHEN** o corpo não traz `kyF3`
- **THEN** a resposta é 400 identificando `kyF3`

### Requirement: Faixas e relações dos parâmetros agronômicos
O sistema SHALL validar os parâmetros da cultivar com as faixas: `tBase` em [0, 20]; `gdaTotal` em [300, 4000]; `gdaF1End`, `gdaF2End` e `gdaF3End` positivos e estritamente crescentes, com `gdaF3End < gdaTotal`; `kcIni`, `kcMid` e `kcEnd` em (0, 1.5]; `depletionFraction` em (0, 1); `0 < zrIni ≤ zrMax ≤ 3`; `kyF1` a `kyF4` em [0, 1.5]. As relações cruzadas MUST ser avaliadas sobre o estado resultante também no `PATCH`.

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

### Requirement: Visibilidade de cultivares
`GET /api/v1/cultivars` SHALL listar, para `ADMIN`, todas as cultivares e, para os demais usuários, as cultivares de referência (`isDefault` verdadeiro) mais as criadas pelo próprio usuário, com filtro opcional `?crop=`. `GET /api/v1/cultivars/:id` SHALL seguir a mesma regra e responder 404 fora dela.

#### Scenario: Agrônomo lista
- **WHEN** um `AGRONOMO` com uma cultivar própria chama `GET /api/v1/cultivars`
- **THEN** a resposta contém as cultivares de referência e a sua, e nenhuma cultivar de outro usuário

#### Scenario: Produtor lista
- **WHEN** um `PRODUTOR` chama `GET /api/v1/cultivars`
- **THEN** a resposta é 200 contendo as cultivares de referência

#### Scenario: Filtro por cultura
- **WHEN** a listagem é chamada com `?crop=MILHO`
- **THEN** todas as cultivares retornadas têm `crop` igual a `MILHO`

#### Scenario: Administrador lista tudo
- **WHEN** um `ADMIN` chama `GET /api/v1/cultivars`
- **THEN** a resposta contém as cultivares de todos os usuários

#### Scenario: Detalhe de cultivar alheia
- **WHEN** um `AGRONOMO` chama `GET /api/v1/cultivars/:id` de uma cultivar não-default criada por outro usuário
- **THEN** a resposta é 404

#### Scenario: Detalhe de cultivar de referência
- **WHEN** qualquer usuário autenticado chama `GET /api/v1/cultivars/:id` de uma cultivar de referência
- **THEN** a resposta é 200

### Requirement: Edição e exclusão de cultivares
`PATCH` e `DELETE /api/v1/cultivars/:id` SHALL ser permitidos apenas em cultivares não-default, pelo criador ou por `ADMIN`. Cultivares de referência MUST responder 403 com o código `DEFAULT_CULTIVAR_READONLY` para qualquer role. Cultivar referenciada por safras MUST NOT ser excluída (409 `CULTIVAR_IN_USE`).

#### Scenario: Criador edita
- **WHEN** o criador envia `PATCH` com `kcMid: 1.1`
- **THEN** a resposta é 200 e `kcMid` passa a 1.1

#### Scenario: Administrador edita cultivar de outro usuário
- **WHEN** um `ADMIN` envia `PATCH` para uma cultivar não-default de um agrônomo
- **THEN** a resposta é 200

#### Scenario: Outro agrônomo tenta editar
- **WHEN** um `AGRONOMO` que não é o criador envia `PATCH`
- **THEN** a resposta é 404

#### Scenario: Edição de cultivar de referência
- **WHEN** um `ADMIN` envia `PATCH` ou `DELETE` para uma cultivar com `isDefault` verdadeiro
- **THEN** a resposta é 403 com o código `DEFAULT_CULTIVAR_READONLY`

#### Scenario: Exclusão sem uso
- **WHEN** o criador chama `DELETE` em uma cultivar sem safras
- **THEN** a resposta é 204 e a cultivar não existe mais

#### Scenario: Exclusão em uso
- **WHEN** o criador chama `DELETE` em uma cultivar referenciada por uma safra
- **THEN** a resposta é 409 com o código `CULTIVAR_IN_USE`

#### Scenario: Produtor tenta editar
- **WHEN** um `PRODUTOR` envia `PATCH` ou `DELETE`
- **THEN** a resposta é 403

### Requirement: Parâmetros congelados em cultivar com safras
Quando uma cultivar é referenciada por ao menos uma safra, em qualquer status, o `PATCH` MUST rejeitar com 409 e o código `CULTIVAR_IN_USE` qualquer corpo que contenha um parâmetro científico (`tBase`, `gdaTotal`, `gdaF1End`, `gdaF2End`, `gdaF3End`, `kcIni`, `kcMid`, `kcEnd`, `depletionFraction`, `zrIni`, `zrMax`, `kyF1`, `kyF2`, `kyF3`, `kyF4`), informando os campos rejeitados, e MUST continuar aceitando `name` e `cycleDescription`. A regra existe para preservar a reprodutibilidade dos resultados do MSA.

#### Scenario: Parâmetro alterado em cultivar em uso
- **WHEN** a cultivar tem uma safra `ACTIVE` e o criador envia `PATCH` com `kcMid: 1.1`
- **THEN** a resposta é 409 com `CULTIVAR_IN_USE` citando `kcMid`, e a cultivar permanece inalterada

#### Scenario: Safra histórica também congela
- **WHEN** a única safra da cultivar está `COMPLETED` ou `CANCELLED` e o `PATCH` envia `gdaTotal`
- **THEN** a resposta é 409 com `CULTIVAR_IN_USE`

#### Scenario: Mesmo valor atual
- **WHEN** a cultivar está em uso e o `PATCH` envia um parâmetro com valor idêntico ao armazenado
- **THEN** a resposta é 409 com `CULTIVAR_IN_USE`

#### Scenario: Nome e descrição continuam editáveis
- **WHEN** a cultivar está em uso e o `PATCH` envia apenas `name` e `cycleDescription`
- **THEN** a resposta é 200 com os novos valores

#### Scenario: Corpo misto
- **WHEN** a cultivar está em uso e o `PATCH` envia `name` e `kyF3`
- **THEN** a resposta é 409 com `CULTIVAR_IN_USE` citando `kyF3`, e nem o nome é alterado

#### Scenario: Cultivar sem safras
- **WHEN** a cultivar não tem safras e o criador envia `PATCH` com `kcMid: 1.1`
- **THEN** a resposta é 200 e `kcMid` passa a 1.1

### Requirement: Cultivares de referência via seed
`prisma/seed.ts` SHALL criar ou atualizar duas cultivares de referência, idempotentes por `name` + `crop`, com `isDefault` verdadeiro e `createdById` nulo: "Soja — referência Cerrado (plantio direto)" (`SOJA`: tBase 10, gdaTotal 1200, limiares 120/450/900, Kc 0.20/1.15/0.50, p 0.50, Zr 0.30→0.95, Ky 0.20/0.80/1.00/0.40) e "Milho — referência Cerrado" (`MILHO`: tBase 10, gdaTotal 1500, limiares 150/600/1150, Kc 0.30/1.20/0.60, p 0.55, Zr 0.30→1.00, Ky 0.40/0.40/1.50/0.50). Os valores MUST passar pelo mesmo schema de validação da API e a fonte bibliográfica MUST constar em JSDoc no seed. O seed das cultivares MUST executar independentemente de `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

#### Scenario: Primeira execução
- **WHEN** o seed roda em um banco sem cultivares
- **THEN** existem exatamente duas cultivares com `isDefault` verdadeiro, uma `SOJA` e uma `MILHO`, com os valores especificados

#### Scenario: Execução repetida
- **WHEN** o seed roda novamente
- **THEN** continuam existindo exatamente duas cultivares de referência, com os mesmos ids

#### Scenario: Valor corrigido no seed
- **WHEN** um parâmetro é alterado no código do seed e ele roda novamente
- **THEN** a cultivar de referência correspondente passa a ter o novo valor

#### Scenario: Sem variáveis de administrador
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` não estão definidas
- **THEN** o seed ainda cria as cultivares de referência e encerra com código 0
