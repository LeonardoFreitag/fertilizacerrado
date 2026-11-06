# web-cultivars Specification

## Purpose
Cultivares de soja na aplicação web: lista separando a referência (FAO-56/FAO-33, somente leitura) das próprias, formulário com os 16 parâmetros agrupados (inclusive a temperatura-base superior `tUpper`, opcional) e regras cruzadas validadas no cliente, marcação campo a campo da divergência em relação à referência com ação de sincronização (só os campos não alterados ou todos), edição sempre habilitada mesmo com safras vinculadas e exclusão.

## Requirements

### Requirement: Lista de cultivares
`/cultivares` SHALL listar `GET /api/v1/cultivars` em duas seções: **Referência** (`isDefault`, somente leitura, com a nota "Parâmetros de referência FAO-56 (Tabelas 12 e 22) e FAO-33 (Ky) — docs/msa/algoritmos.md") e **Minhas cultivares** (criadas pelo usuário), cada item com nome, descrição do ciclo, GDA total e, nas próprias, o resumo de divergência da referência ("igual à referência" ou "N parâmetros diferem"). A lista MUST NOT exibir a cultura. `AGRONOMO` e `ADMIN` MUST ver "Nova cultivar"; `PRODUTOR` MUST NOT ver ações de escrita.

#### Scenario: Duas seções
- **WHEN** a agrônoma abre a lista tendo criado uma cultivar
- **THEN** vê a cultivar de referência de soja na seção Referência, sem botões de edição, e a sua em Minhas cultivares com Editar, Excluir e o resumo de divergência

#### Scenario: Produtor
- **WHEN** um `PRODUTOR` abre a lista
- **THEN** vê as cultivares visíveis sem botão de criar, editar ou excluir

### Requirement: Formulário de cultivar com grupos e regras cruzadas
`/cultivares/nova` e `/cultivares/:id/editar` SHALL oferecer nome, descrição do ciclo e os 16 parâmetros agrupados em **Térmicos** (tBase 0–20 °C, **Temperatura-base superior (°C)** `tUpper` opcional em 15–50 °C com a ajuda "Acima desta temperatura o dia acumula menos graus-dia (Ometto); vazio = sem limite superior", gdaTotal 300–4000, gdaF1End, gdaF2End, gdaF3End), **Kc** (kcIni, kcMid, kcEnd em (0, 1,5]), **Hídricos** (depletionFraction em (0, 1), zrIni e zrMax em (0, 3] m) e **Ky** (kyF1–kyF4 em [0, 1,5]), com unidades e uma frase de ajuda por grupo, sem campo de cultura. `/cultivares/nova` MUST abrir com os 16 parâmetros e a descrição do ciclo já preenchidos com `GET /cultivars/reference` (nome vazio), com a nota "Valores iniciais copiados da cultivar de referência; altere só o que conhece da sua cultivar", e marcar em tempo real os campos que o usuário tornou diferentes da referência (campo `tUpper` vazio difere de uma referência com valor, e vice-versa); enquanto a referência não carrega o formulário MUST ficar desabilitado. O cliente MUST validar antes do envio as regras cruzadas `gdaF1End < gdaF2End < gdaF3End < gdaTotal`, `zrIni ≤ zrMax` e `tUpper > tBase` (quando preenchido, erro em `tUpper`: "deve ser maior que a temperatura-base"), apontando o erro no campo à direita da desigualdade, como a API. O `POST` MUST NOT enviar `crop` e MUST enviar `tUpper: null` quando o campo está vazio. Cultivares de referência MUST abrir somente em leitura.

#### Scenario: Nova cultivar pré-preenchida
- **WHEN** a agrônoma abre `/cultivares/nova`
- **THEN** os 16 parâmetros já mostram os valores da referência de soja (Temperatura-base superior 30), o nome está vazio e nenhum campo está marcado como divergente

#### Scenario: Alteração marcada
- **WHEN** ela muda kcMid de 1,15 para 1,10
- **THEN** o campo kcMid passa a mostrar a marca de divergência com "ref. 1,15"

#### Scenario: Limite superior apagado
- **WHEN** ela apaga o campo Temperatura-base superior
- **THEN** o campo aparece marcado com "ref. 30,0" e o envio leva `tUpper: null`

#### Scenario: Limite superior abaixo da base
- **WHEN** tBase = 10 e Temperatura-base superior = 10
- **THEN** o campo tUpper mostra "deve ser maior que a temperatura-base" e nada é enviado

#### Scenario: Limiares fora de ordem
- **WHEN** gdaF2End = 400 e gdaF1End = 450
- **THEN** o campo gdaF2End mostra "deve ser maior que gdaF1End" e nada é enviado

#### Scenario: Cadastro válido
- **WHEN** todos os campos estão nas faixas e em ordem
- **THEN** `POST /cultivars` é enviado sem `crop` e a lista mostra a nova cultivar em Minhas cultivares

#### Scenario: Referência
- **WHEN** o usuário abre a cultivar de referência de soja
- **THEN** vê os parâmetros em modo leitura com a nota bibliográfica e sem botão Salvar

### Requirement: Exclusão de cultivar
A ação Excluir SHALL existir só para cultivares próprias, pedir confirmação e chamar `DELETE /cultivars/:id`; 409 (cultivar com safras) MUST ser exibido como "Esta cultivar tem safras vinculadas e não pode ser excluída".

#### Scenario: Com safras
- **WHEN** a API responde 409 `CULTIVAR_IN_USE`
- **THEN** o toast mostra a mensagem e a cultivar permanece na lista

### Requirement: Divergência da referência e sincronização
Nas telas de detalhe (`/cultivares/:id`) e edição (`/cultivares/:id/editar`) de uma cultivar própria, o cliente SHALL consultar `GET /cultivars/reference` e marcar, campo a campo, cada parâmetro cujo valor difere da referência atual, mostrando o valor de referência ao lado (ex.: "ref. 1,15"), com um resumo "N parâmetros diferem da referência" ou "igual à referência". Para `AGRONOMO`/`ADMIN` a edição SHALL oferecer a ação **Atualizar a partir da referência**, que abre um diálogo com as opções "Só os campos que não alterei" (`mode "unchanged"`) e "Todos os campos" (`mode "all"`), lista os campos que serão alterados com valor atual → novo, e chama `POST /cultivars/:id/sync-reference`; em 200 o formulário MUST recarregar com os novos valores e o toast MUST listar `updatedFields` (ou "Nada a atualizar"). `PRODUTOR` MUST NOT ver a ação.

#### Scenario: Campo divergente marcado
- **WHEN** a cultivar própria tem `kcMid 1,10` e a referência tem `kcMid 1,15`
- **THEN** o campo kcMid aparece marcado com "ref. 1,15" e o resumo diz "1 parâmetro difere da referência"

#### Scenario: Sincronizar só os não alterados
- **WHEN** a agrônoma escolhe "Só os campos que não alterei" e confirma
- **THEN** `POST /cultivars/:id/sync-reference` é enviado com `mode "unchanged"`, o formulário recarrega e o toast lista os campos atualizados

#### Scenario: Nada a atualizar
- **WHEN** a API responde `updatedFields []`
- **THEN** o toast diz "Nada a atualizar: a cultivar já segue a referência"

### Requirement: Edição de cultivar em uso
O formulário de edição de cultivar própria SHALL manter todos os grupos de parâmetros habilitados, independentemente de haver safras vinculadas, e SHALL exibir a nota "As execuções já calculadas guardam os parâmetros da época; as próximas usam os novos valores". A tela "parâmetros congelados" e o tratamento de 409 `CULTIVAR_IN_USE` no `PATCH` MUST NOT existir; o 409 continua tratado apenas na exclusão.

#### Scenario: Cultivar com safra
- **WHEN** a agrônoma altera kcMid de uma cultivar com safra e salva
- **THEN** o `PATCH` é enviado com o parâmetro, a API responde 200 e a lista mostra o novo valor
