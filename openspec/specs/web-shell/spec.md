# web-shell Specification

## Purpose
Fundação da aplicação web em `frontend/`: pacote React 18 + Vite + TypeScript estrito + Tailwind, base da API configurável, rotas protegidas por autenticação e role, shell de navegação, estados e feedback padronizados, página de administração mínima e qualidade automatizada (typecheck, lint, Vitest, Playwright).

## Requirements

### Requirement: Aplicação web em pacote próprio
O sistema SHALL ter uma aplicação web em `frontend/`, pacote pnpm independente (`packageManager: pnpm@9.15.4`, Node ≥ 20) com React 18, Vite, TypeScript em modo `strict`, TailwindCSS, react-router, TanStack Query, react-hook-form e zod. Toda a interface MUST estar em português do Brasil. O layout MUST ser utilizável em telas de celular (≥ 360 px), tendo o desktop como alvo principal. A base da API MUST vir de `VITE_API_BASE_URL`, com padrão `/api/v1` (caminho relativo à origem da página).

#### Scenario: Build limpo
- **WHEN** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` é executado em `frontend/`
- **THEN** todos os comandos terminam com código 0 e `dist/` contém `index.html` e assets com hash no nome

#### Scenario: Base da API configurável
- **WHEN** `VITE_API_BASE_URL` não está definida no build
- **THEN** as chamadas vão para `/api/v1/...` na mesma origem da página

#### Scenario: Idioma
- **WHEN** qualquer página é renderizada
- **THEN** textos, rótulos, mensagens de erro e formatos de data/número estão em pt-BR

### Requirement: Rotas protegidas por autenticação e role
O roteador SHALL distinguir rotas públicas (`/entrar`, `/cadastro`, `/verifique-seu-email`, `/verificar-email/:token`, `/esqueci-senha`, `/redefinir-senha`) e protegidas. Rotas protegidas MUST exigir sessão: sem sessão, redirecionar para `/entrar?next=<rota original>`; enquanto a sessão está sendo restaurada, exibir um indicador de carregamento em vez de redirecionar. Rotas com restrição de role (`/admin` só `ADMIN`) MUST mostrar a página "Sem permissão" para outras roles. Páginas públicas de autenticação MUST redirecionar para `/propriedades` quando já há sessão.

#### Scenario: Acesso sem sessão
- **WHEN** um visitante abre `/propriedades/abc`
- **THEN** é redirecionado para `/entrar?next=/propriedades/abc` e, após o login, volta para `/propriedades/abc`

#### Scenario: Role insuficiente
- **WHEN** um usuário `AGRONOMO` abre `/admin`
- **THEN** vê a página "Sem permissão", sem redirecionamento e sem chamada à API de admin

#### Scenario: Restauração em andamento
- **WHEN** a página é recarregada em uma rota protegida e o refresh da sessão ainda não respondeu
- **THEN** um indicador de carregamento é exibido e nenhum redirecionamento ocorre até a resposta

#### Scenario: Usuário autenticado no login
- **WHEN** um usuário com sessão abre `/entrar`
- **THEN** é redirecionado para `/propriedades`

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

### Requirement: Estados e feedback padronizados
Toda listagem e todo detalhe SHALL usar os componentes compartilhados de **carregando**, **vazio** (mensagem e ação principal quando aplicável) e **erro** (mensagem amigável e botão "Tentar novamente"). Ações de escrita SHALL confirmar sucesso ou falha com um toast; falhas MUST exibir a mensagem mapeada do código da API, nunca o JSON bruto. Ações destrutivas MUST pedir confirmação em um diálogo.

#### Scenario: Lista vazia
- **WHEN** um agrônomo sem propriedades abre `/propriedades`
- **THEN** vê o estado vazio com o texto orientando e o botão "Nova propriedade"

#### Scenario: Falha de rede na lista
- **WHEN** a API não responde ao carregar `/propriedades`
- **THEN** o estado de erro é exibido com "Tentar novamente" e um clique refaz a consulta

#### Scenario: Sucesso em mutação
- **WHEN** uma propriedade é salva com sucesso
- **THEN** um toast de sucesso aparece e a lista é atualizada sem recarregar a página

### Requirement: Qualidade automatizada do frontend
O pacote SHALL ter `pnpm typecheck` (tsc), `pnpm lint` (ESLint com typescript-eslint e react-hooks), `pnpm test` (Vitest + Testing Library, jsdom) e `pnpm e2e` (Playwright). Os testes unitários MUST cobrir máscaras e validadores, o cliente HTTP com renovação de sessão e os guards de rota. O smoke do Playwright MUST rodar contra a stack de desenvolvimento em `http://localhost`.

#### Scenario: Suíte unitária
- **WHEN** `pnpm test` roda
- **THEN** passam os testes de CPF/CNPJ/senha/θ, do interceptor (401 → refresh → repete; refresh falho → sessão encerrada; refresh deduplicado) e dos guards

#### Scenario: Smoke de ponta a ponta
- **WHEN** `pnpm e2e` roda com a stack no ar
- **THEN** o cenário cadastro → verificação pelo link do log da API → login → nova propriedade → talhão desenhado → área e célula ERA5 exibidas → logout passa no Chromium

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

### Requirement: Administração de estações e correção de viés
`/admin` SHALL ter a seção **Estações e correção de viés** com: upload de CSV de observações (arquivo, formato `bdmep|generic`, metadados da estação para o genérico) via `POST /admin/stations/upload` → 202 com o job na lista "Jobs desta sessão"; tabela de estações (`GET /admin/stations`: código, nome, fonte, observações, período); tabela de calibrações (`GET /admin/qm/calibrations`: célula, estação, período, anos, distância, ativa); botões **Calibrar todas as células** (`{auto: true}`, com confirmação) e **Calibrar célula** (lat, lon, estação); e a nota de que após calibrar é preciso reprocessar as safras (atalho para "Processar todas as safras ativas").

#### Scenario: Upload pela página
- **WHEN** o admin escolhe um CSV genérico, informa os metadados e envia
- **THEN** a resposta 202 aparece na lista de jobs e, ao concluir, a tabela de estações mostra a nova estação

#### Scenario: Calibrar todas
- **WHEN** o admin confirma "Calibrar todas as células"
- **THEN** `POST /admin/qm/calibrate {auto: true}` responde 202 e o job aparece na lista
