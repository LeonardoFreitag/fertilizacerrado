## ADDED Requirements

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
As rotas protegidas SHALL ser renderizadas dentro de um shell com barra lateral e cabeçalho. A barra lateral MUST listar **Propriedades**, **Talhões**, **Safras** (desabilitada, com a indicação "em breve") e, apenas para `ADMIN`, **Admin**; o item da rota atual MUST estar destacado. O cabeçalho MUST mostrar nome e role do usuário (rótulos "Administrador", "Agrônomo", "Produtor") e a ação **Sair**. Em telas estreitas a barra lateral MUST recolher em um menu.

#### Scenario: Menu por role
- **WHEN** um `PRODUTOR` está autenticado
- **THEN** a barra lateral mostra Propriedades, Talhões e Safras (desabilitada) e não mostra Admin

#### Scenario: Entrada "em breve"
- **WHEN** o usuário clica em Safras
- **THEN** nada navega e o item exibe "em breve"

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

### Requirement: Página de administração mínima
`/admin` SHALL exibir, para `ADMIN`, as contagens por fila de `GET /api/v1/admin/jobs/queues` e a próxima execução do semanal, somente leitura, com atualização ao clicar em "Atualizar".

#### Scenario: Contagens
- **WHEN** um `ADMIN` abre `/admin`
- **THEN** vê uma tabela com as filas `era5-ingest`, `msa-process` e `msa-weekly` e suas contagens, e a data/hora da próxima execução semanal em horário de Brasília

### Requirement: Qualidade automatizada do frontend
O pacote SHALL ter `pnpm typecheck` (tsc), `pnpm lint` (ESLint com typescript-eslint e react-hooks), `pnpm test` (Vitest + Testing Library, jsdom) e `pnpm e2e` (Playwright). Os testes unitários MUST cobrir máscaras e validadores, o cliente HTTP com renovação de sessão e os guards de rota. O smoke do Playwright MUST rodar contra a stack de desenvolvimento em `http://localhost`.

#### Scenario: Suíte unitária
- **WHEN** `pnpm test` roda
- **THEN** passam os testes de CPF/CNPJ/senha/θ, do interceptor (401 → refresh → repete; refresh falho → sessão encerrada; refresh deduplicado) e dos guards

#### Scenario: Smoke de ponta a ponta
- **WHEN** `pnpm e2e` roda com a stack no ar
- **THEN** o cenário cadastro → verificação pelo link do log da API → login → nova propriedade → talhão desenhado → área e célula ERA5 exibidas → logout passa no Chromium
