## ADDED Requirements

### Requirement: Página de administração de filas
`/admin` SHALL exibir, para `ADMIN`, as contagens por fila de `GET /api/v1/admin/jobs/queues` e a próxima execução do semanal, com "Atualizar", e as ações **Ingest latest** (`POST /admin/jobs/ingest-latest`, com confirmação), **Backfill regional** (formulário bbox N/W/S/E e `from`/`to`, validando N > S, E > W e `from ≤ to`, aviso de que dispara requisições reais ao CDS; `POST /admin/jobs/backfill-region`) e **Processar todas as safras ativas** (`POST /admin/jobs/process-all`, com confirmação). Cada 202 MUST mostrar o `jobId` e a fila, acrescentar o job a uma lista "Jobs desta sessão" com estado atualizado por `GET /admin/jobs/:queue/:id` a cada 5 s até `completed`/`failed` (com `failedReason`), e recarregar as contagens.

#### Scenario: Process-all
- **WHEN** o admin confirma "Processar todas as safras ativas"
- **THEN** a API responde 202, a quantidade enfileirada e os `jobId` aparecem e as contagens são recarregadas

#### Scenario: Backfill inválido
- **WHEN** o admin informa N = −16,8 e S = −16,1
- **THEN** o formulário mostra "N deve ser maior que S" e nada é enviado

#### Scenario: Estado do job
- **WHEN** um job disparado conclui
- **THEN** sua linha em "Jobs desta sessão" passa a `completed` sem recarregar a página

## MODIFIED Requirements

### Requirement: Shell de navegação
As rotas protegidas SHALL ser renderizadas dentro de um shell com barra lateral e cabeçalho. A barra lateral MUST listar **Propriedades**, **Talhões**, **Safras**, **Cultivares** e, apenas para `ADMIN`, **Admin**; o item da rota atual MUST estar destacado. O cabeçalho MUST mostrar nome e role do usuário (rótulos "Administrador", "Agrônomo", "Produtor") e a ação **Sair**. Em telas estreitas a barra lateral MUST recolher em um menu.

#### Scenario: Menu por role
- **WHEN** um `PRODUTOR` está autenticado
- **THEN** a barra lateral mostra Propriedades, Talhões, Safras e Cultivares e não mostra Admin

#### Scenario: Safras habilitada
- **WHEN** o usuário clica em Safras
- **THEN** navega para `/safras`

#### Scenario: Cabeçalho
- **WHEN** a agrônoma Ana está autenticada
- **THEN** o cabeçalho mostra "Ana" e "Agrônomo" e o botão Sair

## REMOVED Requirements

### Requirement: Página de administração mínima
**Reason**: substituída por "Página de administração de filas", que mantém as contagens e acrescenta as ações de enfileiramento.
**Migration**: nenhuma — mesma rota `/admin`; a tabela de contagens permanece.
