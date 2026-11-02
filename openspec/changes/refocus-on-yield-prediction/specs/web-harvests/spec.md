## MODIFIED Requirements

### Requirement: Lista de safras com filtros
`/safras` SHALL listar `GET /api/v1/harvests` com filtros por **status** (todas/ativas/concluídas/canceladas) e por **propriedade → talhão** (`?fieldId=`), mostrando talhão e propriedade, cultivar, emergência, safra, status, a produtividade potencial (Ym, sc/ha, ou "—") e, quando `GET /harvests/:id/msa` devolve uma run, o indicador de severidade e a produtividade predita em sc/ha (ou o índice do ciclo em %, quando a run não tem Ym), com link para o painel. `?fieldId=` na URL MUST pré-selecionar o filtro. `AGRONOMO`/`ADMIN` MUST ver "Nova safra".

#### Scenario: Filtro por status
- **WHEN** o usuário escolhe "Ativas"
- **THEN** a lista chama `GET /harvests?status=ACTIVE` e mostra só essas

#### Scenario: Filtro por talhão
- **WHEN** o usuário abre `/safras?fieldId=<id>`
- **THEN** o filtro de talhão aparece preenchido e a lista mostra só as safras daquele talhão

#### Scenario: Ym e predita na lista
- **WHEN** a safra tem `expectedYield 65` e a última run tem `predictedYield 47,8`
- **THEN** a linha mostra "Ym 65 sc/ha" e "predita 47,8 sc/ha"

#### Scenario: Run sem Ym
- **WHEN** a última run tem `yieldIndex 0,74` e `predictedYield` nulo
- **THEN** a linha mostra "índice 74 %" no lugar da predita

### Requirement: Criação de safra
`/safras/nova` SHALL oferecer talhão (agrupado por propriedade), cultivar (referência primeiro, depois as próprias), data de emergência (não futura; validação local e 400 `EMERGENCE_DATE_IN_FUTURE` mapeado), safra `AAAA/AA` **sugerida pela emergência** (meses de julho a dezembro ⇒ `ano/ano+1`; janeiro a junho ⇒ `ano−1/ano`) e editável, **Produtividade potencial (sc/ha)** opcional (número `> 0` e `≤ EXPECTED_YIELD_MAX_SC_HA` = 250, constante nomeada, validado localmente, com a ajuda "Produtividade esperada sem estresse hídrico; usada para calcular a produtividade predita") e notas. Quando o talhão escolhido não tem altitude, o formulário MUST exibir o aviso "Este talhão não tem altitude: o MSA não vai processar a safra até você informá-la" com link para editar o talhão, sem bloquear o envio. 409 `FIELD_HAS_ACTIVE_HARVEST` MUST ser exibido como "Este talhão já tem uma safra ativa". Em 201 a tela MUST ir ao detalhe da safra levando `msaJobId`.

#### Scenario: Safra sugerida
- **WHEN** o usuário informa emergência 2025-11-01
- **THEN** o campo safra é preenchido com "2025/26" e continua editável

#### Scenario: Produtividade potencial informada
- **WHEN** o usuário informa 65 em Produtividade potencial e cadastra
- **THEN** o `POST /harvests` é enviado com `expectedYield 65`

#### Scenario: Produtividade potencial vazia
- **WHEN** o campo fica vazio
- **THEN** o `POST` é enviado sem `expectedYield` e a safra é criada

#### Scenario: Produtividade potencial inválida
- **WHEN** o usuário informa 0 ou 300
- **THEN** o campo mostra "informe um valor entre 0 e 250" e nada é enviado

#### Scenario: Talhão sem altitude
- **WHEN** o talhão escolhido tem `altitudeM` nulo
- **THEN** o aviso aparece e o botão Cadastrar continua habilitado

#### Scenario: Emergência futura
- **WHEN** a data escolhida é amanhã
- **THEN** o campo mostra "não pode ser futura" e nada é enviado

### Requirement: Status e notas da safra
O detalhe SHALL permitir a `AGRONOMO`/`ADMIN` **Concluir**, **Cancelar** e **Reativar** (`PATCH /harvests/:id` com `status`), com confirmação, editar as notas e editar a **produtividade potencial** (`PATCH` com `expectedYield`, ou `null` para limpar), com a dica "Alterar a produtividade potencial não recalcula a última execução; use Reprocessar para atualizar a predição"; 409 `FIELD_HAS_ACTIVE_HARVEST` na reativação MUST ser explicado ("o talhão já tem outra safra ativa"). Não há exclusão. `PRODUTOR` MUST ver os dados (inclusive a Ym) sem ações.

#### Scenario: Cancelar
- **WHEN** a agrônoma confirma o cancelamento
- **THEN** `PATCH` é enviado com `status: "CANCELLED"` e o status na tela muda

#### Scenario: Informar Ym depois de criada
- **WHEN** a agrônoma edita a produtividade potencial para 65 e salva
- **THEN** `PATCH` é enviado com `expectedYield 65`, a tela mostra o novo valor e a dica de reprocessar

#### Scenario: Reativar com conflito
- **WHEN** a API responde 409 ao reativar
- **THEN** o toast explica que o talhão já tem outra safra ativa
