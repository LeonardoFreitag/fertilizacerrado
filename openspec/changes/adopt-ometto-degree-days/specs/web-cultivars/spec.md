## MODIFIED Requirements

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
