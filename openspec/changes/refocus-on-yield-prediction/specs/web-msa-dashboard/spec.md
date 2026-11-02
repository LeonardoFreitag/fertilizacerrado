## ADDED Requirements

### Requirement: Bloco Produtividade
O painel SHALL exibir, acima da linha do tempo, o bloco **Produtividade** da run visualizada com: a produtividade potencial da run (`run.expectedYield`, sc/ha); uma tabela por janela F1–F4 com Ks̄, Ky·(1−Ks̄) em % (`yieldReductionPct`) e "não alcançada" para janela sem dias; o índice do ciclo (`run.yieldIndex`, em %); a **produtividade predita** em destaque (`run.predictedYield`, sc/ha, uma casa decimal); e `phasesReached` de 4 janelas. Enquanto `run.phasesReached < 4` ou `currentPhase !== "COMPLETED"`, o bloco MUST mostrar o aviso "Predição parcial: considera o restante do ciclo sem estresse". Sem `expectedYield` na run, o bloco MUST mostrar o índice e, para `AGRONOMO`/`ADMIN`, o link "Informar a produtividade potencial" para o detalhe da safra (para `PRODUTOR`, o texto "produtividade potencial não informada"). Quando a Ym atual da safra difere da Ym da run, o bloco MUST avisar "A produtividade potencial da safra mudou; reprocesse para atualizar a predição". A montagem dos dados do bloco (linhas por janela, textos de aviso) MUST ser uma função pura testada.

#### Scenario: Ciclo completo com Ym
- **WHEN** a run tem `expectedYield 65`, `yieldIndex 0,736`, `predictedYield 47,84`, `phasesReached 4` e `currentPhase COMPLETED`
- **THEN** o bloco mostra "Ym 65 sc/ha", quatro linhas com Ks̄ e redução %, "índice 73,6 %", "predita 47,8 sc/ha", "4 de 4 janelas" e nenhum aviso de parcial

#### Scenario: Ciclo em curso
- **WHEN** a run tem `phasesReached 2`
- **THEN** F3 e F4 aparecem como "não alcançada" e o aviso "Predição parcial…" é exibido

#### Scenario: Sem Ym
- **WHEN** a run tem `expectedYield` nulo
- **THEN** o bloco mostra o índice, não mostra produtividade predita e a agrônoma vê o link "Informar a produtividade potencial"

#### Scenario: Ym alterada depois da run
- **WHEN** a safra tem `expectedYield 70` e a run tem `expectedYield 65`
- **THEN** o bloco mostra a predita com 65 e o aviso para reprocessar

## MODIFIED Requirements

### Requirement: Cabeçalho do painel e reprocessamento
`/safras/:id` (e `/safras/:id/msa`, que redireciona) SHALL mostrar safra, talhão (com propriedade), cultivar, intervalo processado (`dateFrom`–`dateTo`), status da última run — `SUCCEEDED`, `NEEDS_DATA` com a lista de datas faltantes, `FAILED` com o erro —, `engineVersion`, `reason`, data/hora da run e o **selo da chuva**: "Chuva corrigida — estação <nome> (<código>, N anos, D km)" quando a run tem `qmCalibration`, ou "Chuva sem correção (ERA5-Land bruto)". Quando `GET /msa` devolve `cultivarChangedSinceRun: true`, o cabeçalho MUST exibir o aviso "Os parâmetros da cultivar mudaram desde esta execução; reprocesse para usar os valores atuais". O cabeçalho MUST NOT exibir semente, iterações ou sigmas. Para `AGRONOMO`/`ADMIN` MUST haver **Reprocessar** (`POST /msa/process` → 202 `{jobId}` → polling como no acompanhamento inicial, com "processando…" sobre o painel atual até a nova run aparecer). `PRODUTOR` MUST NOT ver o botão.

#### Scenario: Reprocessar
- **WHEN** a agrônoma clica em Reprocessar
- **THEN** a API responde 202, o painel indica "processando…" e, quando a nova run conclui, os dados atualizam

#### Scenario: Metadados visíveis
- **WHEN** o painel exibe uma run `SUCCEEDED`
- **THEN** mostra `engineVersion`, `reason` e a data da run, e não mostra semente

#### Scenario: Cultivar alterada
- **WHEN** `cultivarChangedSinceRun` é verdadeiro
- **THEN** o aviso de parâmetros alterados aparece no cabeçalho com o botão Reprocessar ao lado (para quem pode)

#### Scenario: Selo da chuva
- **WHEN** a run tem `qmCalibration` da estação "Goiânia" com 10 anos a 10 km
- **THEN** o cabeçalho mostra "Chuva corrigida — estação Goiânia (…, 10 anos, 10 km)"; sem calibração mostra "Chuva sem correção (ERA5-Land bruto)"

### Requirement: Cartões por janela com severidade
Para cada janela F1–F4 o painel SHALL mostrar um cartão com Ks médio, redução potencial de produtividade (%), ETc ajustada e chuva acumuladas (mm) e dias, colorido por severidade do Ks médio: **ok** (verde) ≥ 0,85, **atenção** (âmbar) de 0,70 a 0,85, **crítico** (vermelho) < 0,70, **não alcançada** (cinza) sem Ks. A cor MUST vir acompanhada do rótulo textual. Os cartões MUST NOT exibir percentis nem iterações.

#### Scenario: Severidades
- **WHEN** F1 tem Ks 0,92, F2 0,78 e F3 0,61
- **THEN** F1 é verde "ok", F2 âmbar "atenção", F3 vermelho "crítico"

#### Scenario: Janela futura
- **WHEN** F4 tem `ksMean` nulo
- **THEN** o cartão é cinza com "não alcançada"

#### Scenario: Sem percentis
- **WHEN** o cartão de F3 é exibido
- **THEN** mostra Ks médio, redução %, ETc ajustada, chuva e dias, e nenhum texto "P10", "P50", "P90" ou "iterações"

### Requirement: Histórico de runs
O painel SHALL listar `GET /msa/runs` em tabela (data, status, `reason`, `engineVersion`, intervalo, índice do ciclo e produtividade predita quando houver) com seleção de uma run `SUCCEEDED` antiga para visualizar sua série diária nos gráficos, na linha do tempo e no bloco Produtividade, exibindo "Visualizando run de <data>" e a opção de voltar à mais recente. A tabela MUST NOT ter coluna de semente.

#### Scenario: Run antiga
- **WHEN** o usuário seleciona uma run anterior
- **THEN** `GET /msa/daily?runId=<id>` é consultado, os gráficos passam a mostrar aquela série e o bloco Produtividade mostra o índice e a predita daquela run

### Requirement: Exportação CSV
O painel SHALL oferecer "Exportar série diária" e "Exportar resumos", gerando no cliente arquivos CSV com separador `;`, vírgula decimal, BOM UTF-8 e cabeçalho em pt-BR, nomeados `serie-diaria-<safra>-<run>.csv` e `resumos-<safra>-<run>.csv`. O CSV de resumos SHALL ter uma linha por janela com as colunas `janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha`, em que as três últimas repetem em todas as linhas o índice do ciclo, a produtividade potencial e a produtividade predita da run (`ym_sc_ha` e `predita_sc_ha` vazias quando a run não tem Ym); MUST NOT ter linha final de formato diferente nem colunas de percentil ou de iterações. A geração MUST ser uma função pura testada.

#### Scenario: Série diária
- **WHEN** o usuário clica em Exportar série diária
- **THEN** um arquivo CSV com uma linha por dia (data, fase, GDA, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) é baixado

#### Scenario: Resumos sem percentis
- **WHEN** o usuário clica em Exportar resumos
- **THEN** o arquivo tem o cabeçalho "janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha" e exatamente quatro linhas de dados, todas com o mesmo índice, Ym e predita, sem "p10"/"p50"/"p90"

#### Scenario: Resumos sem Ym
- **WHEN** a run não tem `expectedYield` e o usuário exporta os resumos
- **THEN** `indice_ciclo` vem preenchido e `ym_sc_ha` e `predita_sc_ha` vêm vazios nas quatro linhas

#### Scenario: Formato pt-BR
- **WHEN** o CSV é gerado
- **THEN** `0.78` aparece como `0,78`, os campos são separados por `;` e o arquivo começa com o BOM

## REMOVED Requirements

### Requirement: Cenários de decisão e registro
**Reason**: Os cenários de decisão de adubação e o registro da decisão saem da Fase 1; o painel passa a mostrar a produtividade predita.
**Migration**: Remover `DecisionPanel.tsx`, `useDecisionScenarios`, `useDecisions`, `useRecordDecision`, os tipos `Scenario*`, `DecisionScenarios*`, `DecisionView`, `RecordDecisionPayload` e o cenário de decisão do e2e `msa.spec.ts`; o manual cap. 06 perde as seções de cenários e registro (imagens 06-12 a 06-17).
