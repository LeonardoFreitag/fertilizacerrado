## ADDED Requirements

### Requirement: Lista de safras com filtros
`/safras` SHALL listar `GET /api/v1/harvests` com filtros por **status** (todas/ativas/concluídas/canceladas) e por **propriedade → talhão** (`?fieldId=`), mostrando talhão e propriedade, cultivar, emergência, safra, status e um indicador do último resultado do MSA quando disponível (link para o painel). `?fieldId=` na URL MUST pré-selecionar o filtro. `AGRONOMO`/`ADMIN` MUST ver "Nova safra".

#### Scenario: Filtro por status
- **WHEN** o usuário escolhe "Ativas"
- **THEN** a lista chama `GET /harvests?status=ACTIVE` e mostra só essas

#### Scenario: Filtro por talhão
- **WHEN** o usuário abre `/safras?fieldId=<id>`
- **THEN** o filtro de talhão aparece preenchido e a lista mostra só as safras daquele talhão

### Requirement: Criação de safra
`/safras/nova` SHALL oferecer talhão (agrupado por propriedade), cultivar (referência primeiro, depois as próprias), data de emergência (não futura; validação local e 400 `EMERGENCE_DATE_IN_FUTURE` mapeado), safra `AAAA/AA` **sugerida pela emergência** (meses de julho a dezembro ⇒ `ano/ano+1`; janeiro a junho ⇒ `ano−1/ano`) e editável, e notas. Quando o talhão escolhido não tem altitude, o formulário MUST exibir o aviso "Este talhão não tem altitude: o MSA não vai processar a safra até você informá-la" com link para editar o talhão, sem bloquear o envio. 409 `FIELD_HAS_ACTIVE_HARVEST` MUST ser exibido como "Este talhão já tem uma safra ativa". Em 201 a tela MUST ir ao detalhe da safra levando `msaJobId`.

#### Scenario: Safra sugerida
- **WHEN** o usuário informa emergência 2025-11-01
- **THEN** o campo safra é preenchido com "2025/26" e continua editável

#### Scenario: Talhão sem altitude
- **WHEN** o talhão escolhido tem `altitudeM` nulo
- **THEN** o aviso aparece e o botão Cadastrar continua habilitado

#### Scenario: Emergência futura
- **WHEN** a data escolhida é amanhã
- **THEN** o campo mostra "não pode ser futura" e nada é enviado

### Requirement: Acompanhamento do processamento inicial
Ao chegar ao detalhe após a criação (ou ao abrir uma safra sem run), a página SHALL consultar `GET /harvests/:id/msa` a cada 3 segundos enquanto a resposta for 404 `NO_MSA_RESULT`, exibindo "Processando o MSA…" e, para `ADMIN`, o estado do job (`GET /admin/jobs/msa-process/:jobId`: `waiting`, `waiting-children`, `active`, `completed`, `failed` com `failedReason`). Ao obter a run, o painel MUST ser exibido. Após 10 minutos sem run, ou quando `GET /msa/runs` mostrar a última run `FAILED`/`NEEDS_DATA`, o polling MUST parar e o estado MUST ser exibido (erro ou datas faltantes) com a opção "Reprocessar".

#### Scenario: Backfill concluído
- **WHEN** a safra é criada em talhão com cobertura em cache e o worker conclui
- **THEN** a página sai de "Processando…" e mostra o painel sem o usuário recarregar

#### Scenario: Run com lacuna
- **WHEN** a última run é `NEEDS_DATA`
- **THEN** o painel mostra o status, as datas faltantes e o botão Reprocessar, sem continuar o polling

### Requirement: Status e notas da safra
O detalhe SHALL permitir a `AGRONOMO`/`ADMIN` **Concluir**, **Cancelar** e **Reativar** (`PATCH /harvests/:id` com `status`), com confirmação, e editar as notas; 409 `FIELD_HAS_ACTIVE_HARVEST` na reativação MUST ser explicado ("o talhão já tem outra safra ativa"). Não há exclusão. `PRODUTOR` MUST ver os dados sem ações.

#### Scenario: Cancelar
- **WHEN** a agrônoma confirma o cancelamento
- **THEN** `PATCH` é enviado com `status: "CANCELLED"` e o status na tela muda

#### Scenario: Reativar com conflito
- **WHEN** a API responde 409 ao reativar
- **THEN** o toast explica que o talhão já tem outra safra ativa
