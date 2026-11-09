## ADDED Requirements

### Requirement: Seção "Como foi a safra"
O painel SHALL terminar com a seção **"Como foi a safra"** (`SeasonStory.tsx`, `id="resumo-da-safra"`), idêntica para `PRODUTOR`, `AGRONOMO` e `ADMIN`, alimentada por `stressEvents`, `yieldLoss`, os resumos e a série de cultura da run visualizada, e o cabeçalho do painel SHALL ter o link "Ir para o resumo da safra" que rola até ela. A seção SHALL conter, nesta ordem: (1) a **linha do tempo da cultura** (`CropTimeline.tsx`): barra proporcional aos dias com as janelas rotuladas Germinação, Crescimento, Floração e enchimento e Maturação, datas de início e fim, marcador "hoje" quando o ciclo não terminou, marcador "solo seco na emergência" quando `emergenceDepletionPct ≥ 70`, e cada evento como segmento vermelho sobre a barra com o rótulo "N dias com pouca água", com tooltip e uma lista acessível equivalente; (2) a lista **"Momentos de estresse"**, do mais danoso ao menos (`deficitMm × kyDominant` decrescente), cada linha no formato "12 a 23 de janeiro · 12 dias · floração e enchimento · a lavoura ficou sem cerca de 40 mm", com o sufixo "· esta é a fase que mais pesa na produção" quando a janela dominante é a de maior Ky, ou a frase "Nenhum período de falta de água relevante até agora" (ou "…neste ciclo" com o ciclo encerrado); (3) **"Produtividade esperada"**: a produtividade predita em destaque com "de um potencial de <Ym> sacas", a perda total em sacas e % e os avisos já existentes de predição parcial e Ym alterada; e **"De onde veio a perda"**: barras horizontais por janela com a perda em sacas (ou em % sem Ym), a maior destacada, e a frase "A maior perda veio da <janela> (−N sc/ha)" ou "Nenhuma janela teve perda relevante"; sem Ym a seção MUST mostrar só percentuais e o link "Informar a produtividade potencial" (ou o texto equivalente para `PRODUTOR`); (4) o rodapé fixo "Estimativa com base na água disponível no solo; não considera pragas, doenças, adubação, excesso de chuva ou granizo". Quando a run visualizada não tem `stressEvents` (run antiga escolhida no histórico), a seção MUST mostrar "Esta execução não tem a leitura da safra (motor anterior); reprocesse para gerá-la"; quando `stressComputedOnRead` é verdadeiro, MUST indicar "calculado agora com os parâmetros atuais". Todas as frases MUST vir de funções puras testadas em `lib/msa/story.ts` (datas por extenso em pt-BR, com o ano quando o intervalo muda de ano; plural; sacas arredondadas a 0,5 e milímetros a 5).

#### Scenario: Safra com estresse na floração
- **WHEN** a run tem `expectedYield 65`, `predictedYield 52`, um evento de 12 a 23 de janeiro com `dominantPhase F3` e `deficitMm 38`
- **THEN** a linha do tempo mostra o segmento vermelho sobre a floração com "12 dias com pouca água", a lista traz "12 a 23 de janeiro · 12 dias · floração e enchimento · a lavoura ficou sem cerca de 40 mm · esta é a fase que mais pesa na produção", o destaque diz "52,0 sc/ha" com "de um potencial de 65 sacas" e "perda de 13 sacas por hectare (20 %)" e a frase da maior perda cita a floração e enchimento

#### Scenario: Sem eventos
- **WHEN** `stressEvents` é uma lista vazia
- **THEN** a linha do tempo não tem segmentos vermelhos e a lista mostra "Nenhum período de falta de água relevante até agora"

#### Scenario: Solo seco na emergência
- **WHEN** `emergenceDepletionPct` é 87
- **THEN** a linha do tempo mostra o marcador "solo seco na emergência" no início da barra

#### Scenario: Sem produtividade potencial
- **WHEN** a run não tem `expectedYield`
- **THEN** "De onde veio a perda" mostra percentuais por janela, não há sacas, e a agrônoma vê "Informar a produtividade potencial"

#### Scenario: Mesma seção para o produtor
- **WHEN** um `PRODUTOR` abre o painel da própria safra
- **THEN** vê a seção completa com os mesmos textos e números, sem botões de ação

#### Scenario: Run antiga no histórico
- **WHEN** o usuário seleciona no histórico uma run 2.2.0 que não é a mais recente
- **THEN** a seção mostra "Esta execução não tem a leitura da safra (motor anterior); reprocesse para gerá-la"

#### Scenario: Âncora do cabeçalho
- **WHEN** o usuário clica em "Ir para o resumo da safra" no cabeçalho
- **THEN** a página rola até a seção "Como foi a safra"

## MODIFIED Requirements

### Requirement: Cartões por janela com severidade
Para cada janela F1–F4 o painel SHALL mostrar um cartão com Ks médio, redução potencial de produtividade (%), ETc ajustada e chuva acumuladas (mm) e dias, colorido por severidade da **perda** (`yieldReductionPct`): **ok** (verde) < 5 %, **atenção** (âmbar) de 5 a 15 %, **crítico** (vermelho) > 15 %, **não alcançada** (cinza) sem dias. A cor MUST vir acompanhada do rótulo textual e a legenda dos cartões MUST dizer que a cor segue a perda estimada de produtividade. Os cartões MUST NOT exibir percentis nem iterações.

#### Scenario: Severidades
- **WHEN** F1 tem redução 3 %, F2 10 % e F3 31 %
- **THEN** F1 é verde "ok", F2 âmbar "atenção", F3 vermelho "crítico"

#### Scenario: Janela futura
- **WHEN** F4 tem `yieldReductionPct` nulo
- **THEN** o cartão é cinza com "não alcançada"

#### Scenario: Sem percentis
- **WHEN** o cartão de F3 é exibido
- **THEN** mostra Ks médio, redução %, ETc ajustada, chuva e dias, e nenhum texto "P10", "P50", "P90" ou "iterações"

### Requirement: Gráficos da série diária
O painel SHALL exibir três gráficos (Recharts) da série da run selecionada: (1) chuva em barras com ETc e ETc_adj em linhas e fundo colorido por janela; (2) Dr, RAW e TAW; (3) Ks diário com linhas de referência em 0,85 e 0,70. Os três gráficos SHALL marcar cada evento de `stressEvents` da run visualizada com uma faixa vertical hachurada em vermelho (do `start` ao `end`), rotulada "estresse" no gráfico de Ks. O tooltip MUST mostrar todos os valores do dia (data, fase, GDA acumulado, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) em pt-BR. Acima dos gráficos SHALL haver o alternador **"Mostrar entressafra"** (desligado por padrão): ligado, o painel carrega `GET /msa/daily?includePreSeason=true` e os três gráficos passam a começar em `preSeasonFrom`, com a faixa de fundo cinza rotulada "Entressafra" sobre os dias `PRE` (o tooltip mostra fase "Entressafra"); desligado, os gráficos mostram só a série de cultura. A linha do tempo F1–F4 MUST continuar começando na emergência em qualquer estado do alternador. Em runs sem entressafra (`preSeasonFrom` nulo) o alternador MUST ficar desabilitado.

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

#### Scenario: Faixas de evento
- **WHEN** a run tem um evento de 12 a 23 de janeiro
- **THEN** os três gráficos mostram a faixa hachurada nesse intervalo, além das faixas de janela

### Requirement: Exportação CSV
O painel SHALL oferecer "Exportar série diária", "Exportar resumos" e "Exportar estresses", gerando no cliente arquivos CSV com separador `;`, vírgula decimal, BOM UTF-8 e cabeçalho em pt-BR, nomeados `serie-diaria-<safra>-<run>.csv`, `resumos-<safra>-<run>.csv` e `estresses-<safra>-<run>.csv`. A série diária exportada SHALL ser a série exibida: sem entressafra por padrão e com os dias `PRE` (coluna Fase = `PRE`) quando "Mostrar entressafra" está ligado. O CSV de resumos SHALL ter uma linha por janela com as colunas `janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha;perda_sc_ha`, em que `perda_sc_ha` é a perda atribuída à janela (`yieldLoss`, vazia sem Ym) e `indice_ciclo`, `ym_sc_ha` e `predita_sc_ha` repetem em todas as linhas o índice do ciclo, a produtividade potencial e a produtividade predita da run (`ym_sc_ha` e `predita_sc_ha` vazias quando a run não tem Ym); MUST NOT ter linha final de formato diferente nem colunas de percentil ou de iterações. O CSV de estresses SHALL ter uma linha por evento com `inicio;fim;dias;janela_dominante;janelas;ks_min;ks_medio;deficit_mm` (só o cabeçalho quando não há eventos). A geração MUST ser uma função pura testada.

#### Scenario: Série diária
- **WHEN** o usuário clica em Exportar série diária com o alternador desligado
- **THEN** um arquivo CSV com uma linha por dia de cultura (data, fase, GDA, ET₀, Kc, ETc, chuva, Dr, Ks, ETc_adj, TAW, RAW) é baixado, sem linhas `PRE`

#### Scenario: Série diária com entressafra
- **WHEN** o usuário liga "Mostrar entressafra" e clica em Exportar série diária
- **THEN** o arquivo inclui os dias da entressafra com Fase `PRE` antes dos dias de cultura

#### Scenario: Resumos sem percentis
- **WHEN** o usuário clica em Exportar resumos
- **THEN** o arquivo tem o cabeçalho "janela;dias;ks_medio;reducao_pct;etc_adj_mm;chuva_mm;indice_ciclo;ym_sc_ha;predita_sc_ha;perda_sc_ha" e exatamente quatro linhas de dados, todas com o mesmo índice, Ym e predita, com a perda por janela somando Ym − predita, sem "p10"/"p50"/"p90"

#### Scenario: Resumos sem Ym
- **WHEN** a run não tem `expectedYield` e o usuário exporta os resumos
- **THEN** `indice_ciclo` vem preenchido e `ym_sc_ha`, `predita_sc_ha` e `perda_sc_ha` vêm vazios nas quatro linhas

#### Scenario: Formato pt-BR
- **WHEN** o CSV é gerado
- **THEN** `0.78` aparece como `0,78`, os campos são separados por `;` e o arquivo começa com o BOM

#### Scenario: Estresses
- **WHEN** a run tem dois eventos e o usuário clica em Exportar estresses
- **THEN** o arquivo `estresses-<safra>-<run>.csv` tem o cabeçalho `inicio;fim;dias;janela_dominante;janelas;ks_min;ks_medio;deficit_mm` e duas linhas
