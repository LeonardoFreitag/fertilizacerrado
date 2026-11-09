# web-msa-dashboard Specification

## Purpose
Painel agrometeorológico da safra: cabeçalho da última run com reprocessamento, aviso de cultivar alterada e datas faltantes agrupadas por mês, bloco Produtividade (produtividade potencial, redução por janela, índice do ciclo, produtividade predita e o cartão "Água no solo na emergência" com a depleção convertida do spin-up de entressafra), linha do tempo fenológica, cartões por janela com severidade do Ks, gráficos da série diária com o alternador "Mostrar entressafra" (série de cultura por padrão; dias `PRE` desde `preSeasonFrom` quando ligado), histórico de runs e exportação CSV (série exibida, com ou sem entressafra). Não há cenários de decisão nem registro da escolha do técnico.

## Requirements

### Requirement: Cabeçalho do painel e reprocessamento
`/safras/:id` (e `/safras/:id/msa`, que redireciona) SHALL mostrar safra, talhão (com propriedade), cultivar, intervalo processado (`dateFrom`–`dateTo`), status da última run — `SUCCEEDED`, `NEEDS_DATA` com a lista de datas faltantes, `FAILED` com o erro —, `engineVersion`, `reason`, data/hora da run e o **selo da chuva**: "Chuva corrigida — estação <nome> (<código>, N anos, D km)" quando a run tem `qmCalibration`, ou "Chuva sem correção (ERA5-Land bruto)". Quando `GET /msa` devolve `cultivarChangedSinceRun: true`, o cabeçalho MUST exibir o aviso "Os parâmetros da cultivar mudaram desde esta execução; reprocesse para usar os valores atuais". O cabeçalho MUST NOT exibir semente, iterações ou sigmas. As datas faltantes de uma run `NEEDS_DATA` (no cabeçalho, no estado "Sem processamento do MSA" e no histórico) SHALL ser exibidas por extenso quando são até 14, e **agrupadas por mês** quando são mais de 14 — "fev/2026: 28 dias; mar/2026: 31 dias; …" — com a lista completa em um expansível; o agrupamento MUST ser uma função pura testada. Para `AGRONOMO`/`ADMIN` MUST haver **Reprocessar** (`POST /msa/process` → 202 `{jobId}` → polling como no acompanhamento inicial, com "processando…" sobre o painel atual até a nova run aparecer). `PRODUTOR` MUST NOT ver o botão.

#### Scenario: Reprocessar
- **WHEN** a agrônoma clica em Reprocessar
- **THEN** a API responde 202, o painel indica "processando…" e, quando a nova run conclui, os dados atualizam

#### Scenario: Metadados visíveis
- **WHEN** o painel exibe uma run `SUCCEEDED`
- **THEN** mostra `engineVersion`, `reason` e a data da run, e não mostra semente

#### Scenario: Cultivar alterada
- **WHEN** `cultivarChangedSinceRun` é verdadeiro
- **THEN** o aviso de parâmetros alterados aparece no cabeçalho com o botão Reprocessar ao lado (para quem pode)

#### Scenario: Poucas datas faltantes
- **WHEN** a run `NEEDS_DATA` tem 2 datas faltantes
- **THEN** as duas datas aparecem por extenso

#### Scenario: Entressafra inteira faltando
- **WHEN** a run `NEEDS_DATA` tem 273 datas faltantes de 2025-02-01 a 2025-10-31
- **THEN** o painel mostra "fev/2025: 28 dias; mar/2025: 31 dias; … out/2025: 31 dias" e um expansível com a lista completa

#### Scenario: Selo da chuva
- **WHEN** a run tem `qmCalibration` da estação "Goiânia" com 10 anos a 10 km
- **THEN** o cabeçalho mostra "Chuva corrigida — estação Goiânia (…, 10 anos, 10 km)"; sem calibração mostra "Chuva sem correção (ERA5-Land bruto)"

### Requirement: Linha do tempo fenológica
O painel SHALL desenhar uma barra F1–F4 proporcional aos dias de cada janela presentes na série diária da run, com data de início e fim de cada janela, o marcador do dia atual (quando dentro do intervalo) e o fim do ciclo (último dia da série). Janelas ainda não alcançadas MUST aparecer tracejadas/cinza com a indicação "não alcançada". A montagem das faixas MUST ser uma função pura testada.

#### Scenario: Ciclo completo
- **WHEN** a série cobre F1 a F4
- **THEN** quatro segmentos coloridos aparecem com suas datas e o fim do ciclo

#### Scenario: Ciclo em curso
- **WHEN** a série termina em F2
- **THEN** F1 e F2 aparecem com datas, F3 e F4 em cinza "não alcançada" e o marcador "hoje" no fim de F2

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

### Requirement: Gráficos da série diária
O painel SHALL exibir três gráficos (Recharts) da série da run selecionada: (1) chuva em barras com ETc e ETc_adj em linhas e fundo colorido por janela; (2) Dr, RAW e TAW; (3) Ks diário com linhas de referência em 0,85 e 0,70. O tooltip MUST mostrar todos os valores do dia (data, fase, GDA acumulado, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) em pt-BR. Acima dos gráficos SHALL haver o alternador **"Mostrar entressafra"** (desligado por padrão): ligado, o painel carrega `GET /msa/daily?includePreSeason=true` e os três gráficos passam a começar em `preSeasonFrom`, com a faixa de fundo cinza rotulada "Entressafra" sobre os dias `PRE` (o tooltip mostra fase "Entressafra"); desligado, os gráficos mostram só a série de cultura. A linha do tempo F1–F4 MUST continuar começando na emergência em qualquer estado do alternador. Em runs sem entressafra (`preSeasonFrom` nulo) o alternador MUST ficar desabilitado.

#### Scenario: Três gráficos
- **WHEN** o painel carrega uma run `SUCCEEDED`
- **THEN** três gráficos são renderizados e passar o mouse sobre um dia mostra o tooltip completo

#### Scenario: Fundo por janela
- **WHEN** o gráfico de chuva/ETc é exibido
- **THEN** cada janela presente tem uma faixa de fundo com seu rótulo

#### Scenario: Entressafra nos gráficos
- **WHEN** o usuário liga "Mostrar entressafra"
- **THEN** `GET /msa/daily?includePreSeason=true` é consultado, os gráficos começam em `preSeasonFrom` com a faixa cinza "Entressafra", e a linha do tempo continua começando na emergência

#### Scenario: Padrão sem entressafra
- **WHEN** o painel abre
- **THEN** o alternador está desligado e os gráficos começam na emergência

### Requirement: Histórico de runs
O painel SHALL listar `GET /msa/runs` em tabela (data, status, `reason`, `engineVersion`, intervalo, índice do ciclo e produtividade predita quando houver) com seleção de uma run `SUCCEEDED` antiga para visualizar sua série diária nos gráficos, na linha do tempo e no bloco Produtividade, exibindo "Visualizando run de <data>" e a opção de voltar à mais recente. A tabela MUST NOT ter coluna de semente.

#### Scenario: Run antiga
- **WHEN** o usuário seleciona uma run anterior
- **THEN** `GET /msa/daily?runId=<id>` é consultado, os gráficos passam a mostrar aquela série e o bloco Produtividade mostra o índice e a predita daquela run

### Requirement: Exportação CSV
O painel SHALL oferecer "Exportar série diária" e "Exportar resumos", gerando no cliente arquivos CSV com separador `;`, vírgula decimal, BOM UTF-8 e cabeçalho em pt-BR, nomeados `serie-diaria-<safra>-<run>.csv` e `resumos-<safra>-<run>.csv`. A série diária exportada SHALL ser a série exibida: sem entressafra por padrão e com os dias `PRE` (coluna Fase = `PRE`) quando "Mostrar entressafra" está ligado. O CSV de resumos SHALL ter uma linha por janela com as colunas `janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha`, em que as três últimas repetem em todas as linhas o índice do ciclo, a produtividade potencial e a produtividade predita da run (`ym_sc_ha` e `predita_sc_ha` vazias quando a run não tem Ym); MUST NOT ter linha final de formato diferente nem colunas de percentil ou de iterações. A geração MUST ser uma função pura testada.

#### Scenario: Série diária
- **WHEN** o usuário clica em Exportar série diária com o alternador desligado
- **THEN** um arquivo CSV com uma linha por dia de cultura (data, fase, GDA, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) é baixado, sem linhas `PRE`

#### Scenario: Série diária com entressafra
- **WHEN** o usuário liga "Mostrar entressafra" e clica em Exportar série diária
- **THEN** o arquivo inclui os dias da entressafra com Fase `PRE` antes dos dias de cultura

#### Scenario: Resumos sem percentis
- **WHEN** o usuário clica em Exportar resumos
- **THEN** o arquivo tem o cabeçalho "janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha" e exatamente quatro linhas de dados, todas com o mesmo índice, Ym e predita, sem "p10"/"p50"/"p90"

#### Scenario: Resumos sem Ym
- **WHEN** a run não tem `expectedYield` e o usuário exporta os resumos
- **THEN** `indice_ciclo` vem preenchido e `ym_sc_ha` e `predita_sc_ha` vêm vazios nas quatro linhas

#### Scenario: Formato pt-BR
- **WHEN** o CSV é gerado
- **THEN** `0.78` aparece como `0,78`, os campos são separados por `;` e o arquivo começa com o BOM

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

### Requirement: Água no solo na emergência
Dentro do bloco Produtividade, o painel SHALL mostrar o cartão **"Água no solo na emergência"** da run visualizada: a frase "O talhão entrou na safra com N % da água disponível" (N = 100 − `emergenceDepletionPct`, inteiro), `emergenceDepletionMm` de `TAW(zrIni)` mm, a chuva acumulada nos 30 dias anteriores à emergência (somada da série com entressafra, carregada por `GET /msa/daily?includePreSeason=true`), e o período do spin-up (`preSeasonFrom` → emergência − 1) com `preSeasonKc` e `preSeasonZr`. Quando `preSeasonFrom` é nulo (run de motor anterior a 2.2.0), o cartão MUST mostrar "Esta execução não tem entressafra (motor anterior); reprocesse para calcular a água na emergência" e, para `AGRONOMO`/`ADMIN`, o botão Reprocessar. A montagem dos textos e da chuva dos 30 dias MUST ser função pura testada.

#### Scenario: Run com entressafra
- **WHEN** a run tem `emergenceDepletionPct 35`, `emergenceDepletionMm 16,8`, `preSeasonFrom 2025-02-01`, emergência `2025-11-01`, `preSeasonKc 1` e `preSeasonZr 0,95`
- **THEN** o cartão mostra "entrou na safra com 65 % da água disponível", "16,8 de 48,0 mm", a chuva de 2025-10-02 a 2025-10-31 e "entressafra 01/02/2025 → 31/10/2025 (Kc 1,00, Zr 0,95 m)"

#### Scenario: Run antiga
- **WHEN** a run tem `preSeasonFrom` nulo
- **THEN** o cartão mostra o aviso de motor anterior e a agrônoma vê o botão Reprocessar
