# web-msa-dashboard Specification

## Purpose
Painel agrometeorológico da safra: cabeçalho da última run com reprocessamento, linha do tempo fenológica, cartões por janela com severidade do Ks, gráficos da série diária, cenários de decisão com registro da escolha do técnico, histórico de runs e exportação CSV.

## Requirements

### Requirement: Cabeçalho do painel e reprocessamento
`/safras/:id` (e `/safras/:id/msa`, que redireciona) SHALL mostrar safra, talhão (com propriedade), cultivar, intervalo processado (`dateFrom`–`dateTo`), status da última run — `SUCCEEDED`, `NEEDS_DATA` com a lista de datas faltantes, `FAILED` com o erro —, `engineVersion`, semente, `reason`, data/hora da run e o **selo da chuva**: "Chuva corrigida — estação <nome> (<código>, N anos, D km)" quando a run tem `qmCalibration`, ou "Chuva sem correção (ERA5-Land bruto)". Para `AGRONOMO`/`ADMIN` MUST haver **Reprocessar** (`POST /msa/process` → 202 `{jobId}` → polling como no acompanhamento inicial, com "processando…" sobre o painel atual até a nova run aparecer). `PRODUTOR` MUST NOT ver o botão.

#### Scenario: Reprocessar
- **WHEN** a agrônoma clica em Reprocessar
- **THEN** a API responde 202, o painel indica "processando…" e, quando a nova run conclui, os dados atualizam

#### Scenario: Metadados visíveis
- **WHEN** o painel exibe uma run `SUCCEEDED`
- **THEN** mostra `engineVersion`, a semente e a data da run

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
Para cada janela F1–F4 o painel SHALL mostrar um cartão com Ks médio, percentis P10/P50/P90 do Ks, redução potencial de produtividade (%) com percentis, ETc ajustada e chuva acumuladas (mm), dias e iterações válidas, colorido por severidade do Ks médio: **ok** (verde) ≥ 0,85, **atenção** (âmbar) de 0,70 a 0,85, **crítico** (vermelho) < 0,70, **não alcançada** (cinza) sem Ks. A cor MUST vir acompanhada do rótulo textual.

#### Scenario: Severidades
- **WHEN** F1 tem Ks 0,92, F2 0,78 e F3 0,61
- **THEN** F1 é verde "ok", F2 âmbar "atenção", F3 vermelho "crítico"

#### Scenario: Janela futura
- **WHEN** F4 tem `ksMean` nulo
- **THEN** o cartão é cinza com "não alcançada" e sem percentis

### Requirement: Gráficos da série diária
O painel SHALL exibir três gráficos (Recharts) da série da run selecionada: (1) chuva em barras com ETc e ETc_adj em linhas e fundo colorido por janela; (2) Dr, RAW e TAW; (3) Ks diário com linhas de referência em 0,85 e 0,70. O tooltip MUST mostrar todos os valores do dia (data, fase, GDA acumulado, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) em pt-BR.

#### Scenario: Três gráficos
- **WHEN** o painel carrega uma run `SUCCEEDED`
- **THEN** três gráficos são renderizados e passar o mouse sobre um dia mostra o tooltip completo

#### Scenario: Fundo por janela
- **WHEN** o gráfico de chuva/ETc é exibido
- **THEN** cada janela presente tem uma faixa de fundo com seu rótulo

### Requirement: Cenários de decisão e registro
O painel SHALL oferecer um formulário com janela (F1–F4; padrão a atual ou última alcançada), dose base (≥ 0) e eficiência base (0–1) que consulta `GET /msa/decision` e mostra os cenários **A** (dose ajustada e redução %), **B** (parcelamento: janela seguinte, dias e doses das duas metades) e **C** (eficiência ajustada) lado a lado com o racional da API; B indisponível MUST aparecer em cinza com `bUnavailableReason`. "Registrar decisão" em cada cenário abre um diálogo com justificativa obrigatória (3–2000 caracteres) e envia `POST /msa/decisions` com janela, cenário, dose, eficiência, justificativa e `runId`. A lista de decisões (`GET /msa/decisions`) MUST mostrar quem decidiu, quando, janela, cenário, dose/eficiência e justificativa, mais recente primeiro. 422 `PHASE_NOT_REACHED`/`SCENARIO_UNAVAILABLE` MUST virar mensagem. `PRODUTOR` vê cenários e decisões sem o botão de registrar.

#### Scenario: Cenários F3
- **WHEN** a agrônoma escolhe F3, dose 100 e eficiência 0,6
- **THEN** vê A com a dose ajustada pelo P50 do Ks, B com as duas parcelas (ou o motivo da indisponibilidade) e C com a eficiência ajustada

#### Scenario: Registro
- **WHEN** ela registra o cenário A com a justificativa "Estiagem em F3"
- **THEN** `POST /decisions` é enviado e a decisão aparece no topo da lista com seu nome

#### Scenario: Janela não alcançada
- **WHEN** a janela escolhida ainda não foi alcançada
- **THEN** a API responde 422 e o painel mostra "Janela ainda não alcançada nesta run"

### Requirement: Histórico de runs
O painel SHALL listar `GET /msa/runs` em tabela (data, status, `reason`, semente, `engineVersion`, intervalo) com seleção de uma run `SUCCEEDED` antiga para visualizar sua série diária nos gráficos e na linha do tempo, exibindo "Visualizando run de <data>" e a opção de voltar à mais recente.

#### Scenario: Run antiga
- **WHEN** o usuário seleciona uma run anterior
- **THEN** `GET /msa/daily?runId=<id>` é consultado e os gráficos passam a mostrar aquela série

### Requirement: Exportação CSV
O painel SHALL oferecer "Exportar série diária" e "Exportar resumos", gerando no cliente arquivos CSV com separador `;`, vírgula decimal, BOM UTF-8 e cabeçalho em pt-BR, nomeados `serie-diaria-<safra>-<run>.csv` e `resumos-<safra>-<run>.csv`. A geração MUST ser uma função pura testada.

#### Scenario: Série diária
- **WHEN** o usuário clica em Exportar série diária
- **THEN** um arquivo CSV com uma linha por dia (data, fase, GDA, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) é baixado

#### Scenario: Formato pt-BR
- **WHEN** o CSV é gerado
- **THEN** `0.78` aparece como `0,78`, os campos são separados por `;` e o arquivo começa com o BOM
