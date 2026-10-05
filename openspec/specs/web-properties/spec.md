# web-properties Specification

## Purpose
Propriedades na aplicação web: lista com busca, cadastro e edição (com escolha do produtor dono via diretório), detalhe com talhões e exclusão por ADMIN, respeitando o escopo por role da API.

## Requirements

### Requirement: Lista de propriedades
`/propriedades` SHALL listar as propriedades de `GET /api/v1/properties` em cards (nome, município/UF, produtor dono, agrônomo, quantidade de talhões) com busca local por nome, município e produtor. `AGRONOMO` e `ADMIN` MUST ver o botão "Nova propriedade"; `PRODUTOR` MUST NOT ver ações de escrita.

#### Scenario: Busca
- **WHEN** o usuário digita "goiân" na busca
- **THEN** só as propriedades cujo nome, município ou dono contenham o texto (sem distinção de acento/caixa) permanecem visíveis

#### Scenario: Produtor
- **WHEN** um `PRODUTOR` abre a lista
- **THEN** vê suas propriedades sem botão de criar, editar ou excluir

### Requirement: Cadastro e edição de propriedade
`/propriedades/nova` e `/propriedades/:id/editar` SHALL oferecer o formulário com nome (2–120), UF (lista das 27), município (2–120), CAR e NIRF opcionais, validados antes do envio. `ADMIN` MUST escolher o produtor dono pesquisando em `GET /api/v1/users?role=PRODUTOR&q=` (campo obrigatório); `AGRONOMO` MAY informar um produtor pela mesma busca (campo opcional, descrevendo que sem ele o próprio agrônomo fica como dono); `PRODUTOR` não acessa estas rotas. Sucesso MUST levar ao detalhe da propriedade com toast; `VALIDATION_ERROR`, `INVALID_OWNER` e `INVALID_AGRONOMIST` MUST aparecer nos campos correspondentes.

#### Scenario: Agrônoma cria para um produtor
- **WHEN** Ana preenche o formulário e escolhe "Pedro Produtor" na busca
- **THEN** `POST /properties` é enviado com `ownerId` de Pedro e, em 201, a tela vai para o detalhe

#### Scenario: Admin sem dono
- **WHEN** um `ADMIN` tenta salvar sem escolher o produtor
- **THEN** o campo mostra "Informe o produtor dono" e nada é enviado

#### Scenario: Busca de produtor
- **WHEN** o usuário digita "ped" no campo de produtor
- **THEN** a lista mostra até 20 usuários `PRODUTOR` cujo nome ou e-mail contém "ped"; com menos de 3 caracteres nenhuma busca é feita

#### Scenario: Edição
- **WHEN** o usuário altera o município e salva
- **THEN** `PATCH /properties/:id` é enviado só com os campos alterados e o detalhe reflete o novo valor

### Requirement: Detalhe da propriedade
`/propriedades/:id` SHALL mostrar os dados da propriedade (incluindo dono e agrônomo), as ações permitidas à role (Editar para AGRONOMO/ADMIN, Excluir só ADMIN) e a lista dos talhões da propriedade com miniatura do polígono, área e indicação de altitude ausente, além do botão "Novo talhão" para quem pode gerenciar. Propriedade fora do escopo (404 da API) MUST exibir "Propriedade não encontrada".

#### Scenario: Detalhe com talhões
- **WHEN** a propriedade tem dois talhões
- **THEN** ambos aparecem com miniatura, nome e área em ha; o que não tem altitude mostra o aviso "sem altitude — necessária para o MSA"

#### Scenario: Fora do escopo
- **WHEN** um agrônomo abre o detalhe de uma propriedade que não é sua
- **THEN** vê "Propriedade não encontrada" e o link para voltar à lista

### Requirement: Exclusão de propriedade
A ação Excluir SHALL existir apenas para `ADMIN`, pedir confirmação com o nome da propriedade e chamar `DELETE /api/v1/properties/:id`; em sucesso MUST voltar à lista com toast.

#### Scenario: Confirmação
- **WHEN** o admin clica em Excluir e cancela no diálogo
- **THEN** nenhuma requisição é feita

#### Scenario: Exclusão
- **WHEN** o admin confirma
- **THEN** `DELETE` é chamado e a propriedade desaparece da lista
