## MODIFIED Requirements

### Requirement: Shell de navegação
As rotas protegidas SHALL ser renderizadas dentro de um shell com barra lateral e cabeçalho. A barra lateral MUST listar **Propriedades**, **Talhões**, **Safras**, **Cultivares** e, apenas para `ADMIN`, **Usuários** e **Admin**; o item da rota atual MUST estar destacado. O cabeçalho MUST mostrar nome e role do usuário (rótulos "Administrador", "Agrônomo", "Produtor"), com o nome ligando para `/perfil`, e a ação **Sair**. Em telas estreitas a barra lateral MUST recolher em um menu.

#### Scenario: Menu por role
- **WHEN** um `PRODUTOR` está autenticado
- **THEN** a barra lateral mostra Propriedades, Talhões, Safras e Cultivares e não mostra Usuários nem Admin

#### Scenario: Safras habilitada
- **WHEN** o usuário clica em Safras
- **THEN** navega para `/safras`

#### Scenario: Cabeçalho
- **WHEN** a agrônoma Ana está autenticada
- **THEN** o cabeçalho mostra "Ana" (link para `/perfil`) e "Agrônomo" e o botão Sair

#### Scenario: Usuários para admin
- **WHEN** um `ADMIN` clica em Usuários
- **THEN** navega para `/admin/usuarios`
