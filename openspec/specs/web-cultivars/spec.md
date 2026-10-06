# web-cultivars Specification

## Purpose
Cultivares na aplicação web: lista separando referência (FAO-56/FAO-33, somente leitura) das próprias, formulário com os parâmetros agrupados e regras cruzadas validadas no cliente, edição com parâmetros congelados quando há safras vinculadas e exclusão.

## Requirements

### Requirement: Lista de cultivares
`/cultivares` SHALL listar `GET /api/v1/cultivars` em duas seções: **Referência** (`isDefault`, somente leitura, com a nota "Parâmetros de referência FAO-56 (Tabelas 12 e 22) e FAO-33 (Ky) — docs/msa/algoritmos.md") e **Minhas cultivares** (criadas pelo usuário), cada item com nome, cultura, descrição do ciclo e GDA total. `AGRONOMO` e `ADMIN` MUST ver "Nova cultivar"; `PRODUTOR` MUST NOT ver ações de escrita.

#### Scenario: Duas seções
- **WHEN** a agrônoma abre a lista tendo criado uma cultivar
- **THEN** vê as duas de referência (soja e milho) na seção Referência, sem botões de edição, e a sua em Minhas cultivares com Editar e Excluir

#### Scenario: Produtor
- **WHEN** um `PRODUTOR` abre a lista
- **THEN** vê as cultivares visíveis sem botão de criar, editar ou excluir

### Requirement: Formulário de cultivar com grupos e regras cruzadas
`/cultivares/nova` e `/cultivares/:id/editar` SHALL oferecer nome, cultura (SOJA/MILHO), descrição do ciclo e os 15 parâmetros agrupados em **Térmicos** (tBase 0–20 °C, gdaTotal 300–4000, gdaF1End, gdaF2End, gdaF3End), **Kc** (kcIni, kcMid, kcEnd em (0, 1,5]), **Hídricos** (depletionFraction em (0, 1), zrIni e zrMax em (0, 3] m) e **Ky** (kyF1–kyF4 em [0, 1,5]), com unidades e uma frase de ajuda por grupo. O cliente MUST validar antes do envio as regras cruzadas `gdaF1End < gdaF2End < gdaF3End < gdaTotal` e `zrIni ≤ zrMax`, apontando o erro no campo à direita da desigualdade, como a API. Cultivares de referência MUST abrir somente em leitura.

#### Scenario: Limiares fora de ordem
- **WHEN** gdaF2End = 400 e gdaF1End = 450
- **THEN** o campo gdaF2End mostra "deve ser maior que gdaF1End" e nada é enviado

#### Scenario: Cadastro válido
- **WHEN** todos os campos estão nas faixas e em ordem
- **THEN** `POST /cultivars` é enviado e a lista mostra a nova cultivar em Minhas cultivares

#### Scenario: Referência
- **WHEN** o usuário abre a cultivar de referência de soja
- **THEN** vê os parâmetros em modo leitura com a nota bibliográfica e sem botão Salvar

### Requirement: Edição com parâmetros congelados
Ao editar uma cultivar própria, se `PATCH /cultivars/:id` responder 409 `CULTIVAR_IN_USE`, o formulário SHALL desabilitar os grupos de parâmetros, exibir "Parâmetros congelados porque há safras vinculadas a esta cultivar; apenas nome e descrição podem ser alterados" e oferecer reenviar só nome e descrição.

#### Scenario: Cultivar em uso
- **WHEN** a agrônoma altera kcMid de uma cultivar com safra e salva
- **THEN** a API responde 409, os parâmetros ficam desabilitados com o aviso e um clique em "Salvar nome e descrição" envia o PATCH sem parâmetros

### Requirement: Exclusão de cultivar
A ação Excluir SHALL existir só para cultivares próprias, pedir confirmação e chamar `DELETE /cultivars/:id`; 409 (cultivar com safras) MUST ser exibido como "Esta cultivar tem safras vinculadas e não pode ser excluída".

#### Scenario: Com safras
- **WHEN** a API responde 409 `CULTIVAR_IN_USE`
- **THEN** o toast mostra a mensagem e a cultivar permanece na lista
