# Painel agrometeorológico

**O que você vai fazer:** ler o painel de uma safra, entender onde faltou água e quanto isso pode ter custado em produtividade.
**Quem pode fazer:** todos consultam. Agrônomo e administrador reprocessam e informam a produtividade potencial.

> **Importante.** O sistema apoia e não substitui a decisão do responsável técnico. O painel estima o efeito da falta de água a partir de dados de clima. Ele não enxerga a lavoura, a fertilidade do solo, as pragas nem o manejo. Use os números junto com o que você observa no campo.

O painel aparece na página de cada safra. Nas telas ele se chama **Módulo agrometeorológico (MSA)**. Para abri-lo, clique em **Safras** no menu e depois na safra.

## A ideia em uma página

A lavoura precisa de água todos os dias. A quantidade depende do clima e do tamanho da planta. O solo funciona como uma caixa-d'água: a chuva enche, a lavoura esvazia.

Para cada dia da safra, o sistema faz esta conta:

1. Calcula quanta água a lavoura precisaria naquele dia.
2. Soma a chuva e desconta o consumo, para saber quanta água sobrou no solo.
3. Verifica se a água que sobrou foi suficiente. Se não foi, a lavoura sofreu.

O resultado de cada dia é um número chamado [Ks](08-perguntas-e-glossario.md#ks-coeficiente-de-estresse-hídrico), que vai de 0 a 1:

- **Ks = 1,00:** a lavoura teve toda a água de que precisava.
- **Ks = 0,70:** a lavoura conseguiu usar 70% da água de que precisava.

Quanto menor o Ks, maior a falta de água. O painel resume o Ks por fase do ciclo, estima quanto cada fase perdeu em produtividade e, com a produtividade potencial informada na safra, calcula a produtividade predita em sacas por hectare.

## O exemplo deste capítulo

As imagens mostram uma safra de soja da Fazenda Boa Vista, no Talhão 1 — Sede, com emergência em 01/10/2025 e produtividade potencial de 65 sc/ha. Foi um plantio antecipado, feito logo após o vazio sanitário. O ciclo durou 77 dias e terminou em 16/12/2025.

O painel completo fica assim. As próximas seções explicam cada parte. O bloco **Produtividade** fica logo abaixo do cabeçalho, mas é mais fácil de entender depois dos cartões das janelas, e por isso vem depois deles neste capítulo.

![Painel completo da safra de exemplo](img/06-01-painel-completo.png)

## O cabeçalho

![Cabeçalho do painel](img/06-02-cabecalho-do-painel.png)

O cabeçalho informa:

- **Intervalo processado:** de que dia até que dia há resultados. O último dia fica cerca de cinco dias antes de hoje, porque os dados de clima chegam com esse atraso.
- **Janela atual:** a fase em que a lavoura está. No exemplo, **Ciclo encerrado**.
- **Selo verde SUCCEEDED:** o processamento terminou bem.
- **Selo da chuva:** se a chuva foi corrigida ou não. Veja a próxima seção.
- **Executada em** e **Origem:** quando o cálculo foi feito e por quê. A origem pode ser **Criação da safra**, **Semanal** ou **Manual**.

Os campos **Run** e **Motor** identificam o cálculo. Eles servem para auditoria e para a equipe técnica reproduzir o resultado. No dia a dia você não precisa deles.

Quando os parâmetros da cultivar foram alterados depois do cálculo, o cabeçalho mostra o aviso **Os parâmetros da cultivar … mudaram desde esta execução; a run usa o snapshot da época.** Os números na tela continuam válidos para os parâmetros antigos. Para usar os novos, clique em **Reprocessar**. Veja o [capítulo 4](04-cultivares.md#o-que-acontece-com-as-safras-que-já-usam-a-cultivar).

### O selo de correção da chuva

![Cabeçalho do painel, com o selo da chuva em destaque](img/06-03-selo-da-chuva.png)

A chuva é o dado mais incerto do painel. O selo diz qual chuva foi usada:

- **Chuva sem correção (ERA5-Land bruto):** o sistema usou a chuva estimada pelo [ERA5-Land](08-perguntas-e-glossario.md#era5-land), sem ajuste. É o caso do exemplo. Acontece quando não há estação meteorológica próxima cadastrada.
- **Chuva corrigida — estação…:** a chuva foi ajustada com as medições de uma estação. O selo traz o nome e o código da estação, os anos de dados usados e a distância até ela.

Com a chuva sem correção, dê mais atenção à comparação com o que choveu de fato na fazenda. Se você tem pluviômetro, compare os totais do período com o campo **Chuva acumulada** dos cartões. A [correção da chuva](08-perguntas-e-glossario.md#correção-da-chuva) é configurada pelo administrador, como mostra o [capítulo 7](07-administracao.md#estações-e-calibração-da-chuva).

## A linha do tempo F1–F4

![Linha do tempo fenológica da safra](img/06-04-linha-do-tempo.png)

A barra colorida mostra o ciclo dividido em quatro janelas:

| Janela | Fase da lavoura | No exemplo |
|---|---|---|
| **F1** | Germinação e estabelecimento | 01/10 a 06/10, 6 dias |
| **F2** | Crescimento vegetativo | 07/10 a 27/10, 21 dias |
| **F3** | Floração e enchimento de grãos | 28/10 a 24/11, 28 dias |
| **F4** | Maturação | 25/11 a 16/12, 22 dias |

A largura de cada faixa é proporcional à duração. As datas não são fixas: o sistema as calcula pelo calor acumulado desde a emergência, os [graus-dia](08-perguntas-e-glossario.md#gda-graus-dia-acumulados). Em um ano mais quente as janelas ficam mais curtas, mas o calor acima da [temperatura-base superior](08-perguntas-e-glossario.md#temperatura-base-superior-tb) da cultivar (30 °C na soja de referência) não conta: dias muito quentes acumulam um pouco menos graus-dia do que a temperatura média sugere.

Em uma safra em andamento, um traço vertical marca o dia de hoje. As janelas que ainda não chegaram aparecem em cinza, com a indicação **não alcançada**.

Passe o mouse sobre uma faixa para ver as datas.

## Os cartões das janelas

Cada janela tem um cartão com o resumo do que aconteceu nela.

![Os quatro cartões das janelas fenológicas](img/06-05-cartoes-das-janelas.png)

### As cores

A cor do cartão vem do **Ks médio** da janela:

| Cor | Selo | Ks médio | Leitura |
|---|---|---|---|
| Verde | **ok** | 0,85 ou mais | Água suficiente, ou falta pequena |
| Amarelo | **atenção** | de 0,70 a 0,85 | Falta de água moderada |
| Vermelho | **crítico** | abaixo de 0,70 | Falta de água severa |
| Cinza | **não alcançada** | — | A lavoura ainda não chegou a essa janela |

No exemplo, os quatro cartões estão verdes: F1 e F2 com Ks 1,00, F3 com Ks 0,86 — logo acima do limite de 0,85, ou seja, quase em **atenção** — e F4 com Ks 0,92<!-- valor:phases.F4.ksMean|2 -->.

### Como ler um cartão

![Cartão da janela F3 do exemplo](img/06-06-cartao-de-uma-janela.png)

O cartão de F3, floração e enchimento, mostra:

- **Ks médio: 0,86<!-- valor:phases.F3.ksMean|2 -->.** Na média dos 29<!-- valor:phases.F3.days|0 --> dias da janela, a lavoura usou 86% da água de que precisava. O valor fica logo acima de 0,85, por isso o cartão ainda está **ok**; um pouco menos de chuva e ele passaria a **atenção**.

- **Redução potencial de produtividade: 14,1<!-- valor:phases.F3.yieldReductionPct|1 -->%.** É a estimativa de quanto da produtividade pode ter sido perdida nessa janela só pela falta de água. Ela combina o Ks médio com a sensibilidade da janela, o [Ky](08-perguntas-e-glossario.md#ky-sensibilidade-ao-estresse).

- **ETc ajustada acumulada: 141,3<!-- valor:phases.F3.etcAdjAccum|1 --> mm.** A água que a lavoura realmente usou na janela.

- **Chuva acumulada: 124,4<!-- valor:phases.F3.precipAccum|1 --> mm.** O total de chuva da janela. Compare com o seu pluviômetro.

- **Dias na janela:** a duração da janela.

Os termos estão no glossário: [redução potencial de produtividade](08-perguntas-e-glossario.md#redução-potencial-de-produtividade) e [evapotranspiração da cultura](08-perguntas-e-glossario.md#evapotranspiração-da-cultura).

### Por que a mesma falta de água pesa diferente

Compare F3 e F4 no exemplo. O Ks de F4 é 0,92, não muito acima do de F3. Mas a redução estimada em F4 é de 3,3<!-- valor:phases.F4.yieldReductionPct|1 -->%, contra 14,1% em F3.

A diferença está na sensibilidade da planta. Na floração e no enchimento de grãos a soja é muito mais sensível à falta de água que na maturação. O sistema leva isso em conta por meio do [Ky](08-perguntas-e-glossario.md#ky-sensibilidade-ao-estresse) de cada janela.

Por isso, ao ler o painel, olhe primeiro para F3.

## Produtividade

Esta é a parte do painel que junta as quatro janelas em um único número: quanto a safra deve render, em sacas por hectare, considerando só a falta de água. O bloco **Produtividade** fica logo abaixo do cabeçalho.

> O sistema apoia e não substitui a decisão do responsável técnico. A produtividade predita é uma estimativa do efeito da água, e não uma previsão de colheita. O que fazer com ela, na adubação ou em qualquer outra decisão, é do responsável técnico.

![Bloco Produtividade do painel, com a tabela de redução por janela, a produtividade potencial, o índice do ciclo e a produtividade predita](img/06-11-produtividade.png)

### A tabela Redução por janela

A tabela da esquerda repete, para cada janela, o **Ks médio** e a **Redução** que você viu nos cartões, e acrescenta o **Fator**. O fator é o que sobra da produtividade depois da redução: 1 menos a redução. Uma janela sem falta de água tem fator 1,000. Uma janela que ainda não chegou aparece como **não alcançada — fator 1**.

No exemplo:

| Janela | Ks médio | Redução | Fator |
|---|---|---|---|
| F1 | 1,00 | 0,0% | 1,000 |
| F2 | 1,00 | 0,0% | 1,000 |
| F3 | 0,86 | 14,1% | 0,859 |
| F4 | 0,92 | 3,3% | 0,967 |

### Os três números da direita

- **Produtividade potencial (Ym): 65,0<!-- valor:yield.ym|1 --> sc/ha.** É o valor informado no cadastro da safra: quanto a lavoura renderia sem falta de água. Veja o [capítulo 5](05-safras.md#sobre-a-produtividade-potencial).

- **Índice do ciclo: 83,0 %<!-- valor:yield.yieldIndexPct|1 -->.** É o produto dos quatro fatores: 1,000 × 1,000 × 0,859 × 0,967 = 0,830. A leitura é direta: a estimativa é que a safra renda 83,0% da produtividade potencial. A falta de água na floração responde pela maior parte da perda.

- **Produtividade predita: 54,0<!-- valor:yield.predicted|1 --> sc/ha.** É a produtividade potencial multiplicada pelo índice: 65 × 0,830 = 54,0 sc/ha. A diferença para a Ym, cerca de 11 sacas, é a estimativa do que a falta de água custou nessa safra.

A linha **4 de 4 janelas alcançadas**, no alto do bloco, diz quantas janelas já entraram na conta com dados reais. A fórmula está escrita abaixo do título do bloco, para quem quiser conferir; a explicação completa está em [`docs/msa/algoritmos.md`](../msa/algoritmos.md), seção 6.

### Quando a safra ainda não terminou

Enquanto a lavoura não chega ao fim do ciclo, o bloco mostra o aviso **Predição parcial: considera o restante do ciclo sem estresse.** As janelas que ainda não chegaram entram com fator 1, como se não fosse faltar água nelas. A cada processamento semanal o número é atualizado com as janelas alcançadas. Em uma safra em F2, por exemplo, a produtividade predita ainda não sabe nada sobre a floração, que é a fase mais sensível.

### Quando a safra não tem produtividade potencial

Sem a Ym, o bloco mostra **não informada** no lugar do valor, calcula o índice do ciclo mesmo assim e deixa a produtividade predita em branco. O agrônomo vê o link **Informar a produtividade potencial**, que abre a janela de edição da safra. O produtor vê o texto **Produtividade potencial não informada pelo responsável técnico.**

### Quando a produtividade potencial mudou

Se a Ym da safra foi alterada depois do cálculo, o bloco mostra o aviso **A produtividade potencial da safra mudou … reprocesse para atualizar a predição.** Os números na tela foram calculados com o valor antigo, e o bloco mostra esse valor antigo em **Produtividade potencial (Ym)**. Clique em **Reprocessar** para refazer a conta com o valor novo.

## Os três gráficos

Os gráficos mostram o dia a dia. Eles respondem quando faltou água e por quê.

### Chuva, ETc e ETc ajustada

![Gráfico de chuva, ETc e ETc ajustada](img/06-07-grafico-chuva-e-etc.png)

- **Barras azuis:** a chuva de cada dia. A escala fica à direita.
- **Linha verde, ETc:** a água de que a lavoura precisava. A escala fica à esquerda.
- **Linha laranja, ETc ajustada:** a água que a lavoura conseguiu usar.

Quando as duas linhas andam juntas, não faltou água. **Quando a laranja fica abaixo da verde, houve estresse.** O espaço entre elas é a água que faltou.

No exemplo, as linhas se separam em novembro. As chuvas daquele período foram poucas e espaçadas, bem na floração.

As faixas coloridas ao fundo marcam as janelas F1 a F4.

### Depleção, RAW e TAW

![Gráfico de depleção, RAW e TAW](img/06-08-grafico-deplecao.png)

Este gráfico mostra a caixa-d'água do solo.

- **Linha azul, Dr:** quanta água já foi gasta. Zero é o solo cheio. Quanto mais alta a linha, mais seco o solo.
- **Linha laranja tracejada, RAW:** o limite de conforto. Abaixo dela a planta tira água do solo sem dificuldade.
- **Linha cinza tracejada, TAW:** o fundo da caixa. É toda a água que o solo guarda para a planta.

**Quando a linha azul cruza a laranja, começa o estresse.** Quanto mais perto ela chega da cinza, mais severa a falta de água. Depois de uma chuva boa, a linha azul cai.

As duas linhas tracejadas sobem no início do ciclo porque a raiz está crescendo e alcançando mais solo. Veja [TAW e RAW](08-perguntas-e-glossario.md#taw-e-raw) no glossário.

### Coeficiente de estresse (Ks)

![Gráfico do coeficiente de estresse Ks](img/06-09-grafico-ks.png)

É o resultado final, dia a dia. A linha fica em 1 enquanto há água suficiente e cai quando falta. As linhas tracejadas em 0,85 e 0,70 são os mesmos limites das cores dos cartões.

No exemplo, o Ks cai abaixo de 0,70 por alguns dias em novembro e se recupera com as chuvas seguintes. O Ks médio do cartão de F3 é a média de todos os dias da janela, e por isso fica acima do ponto mais baixo.

### Ver os números de um dia

Passe o mouse sobre qualquer gráfico. Aparece um quadro com todos os valores daquele dia: a janela, a chuva, a ETc, o Ks e os demais.

![Quadro com os valores de um dia, ao passar o mouse sobre o gráfico](img/06-10-detalhe-do-dia.png)

## Exportar em CSV

Os dois botões do cabeçalho baixam arquivos que abrem no Excel e em outras planilhas.

![Cabeçalho do painel, com os botões de exportação em destaque](img/06-18-exportar.png)

- **Exportar série diária** baixa uma linha por dia, com a janela, os graus-dia, a profundidade da raiz, a ET₀, o Kc, a ETc, a chuva, a depleção, o Ks, a ETc ajustada, o TAW e o RAW.
- **Exportar resumos** baixa uma linha por janela, com os dias, o Ks médio, a redução, a ETc ajustada e a chuva acumuladas, e ainda o índice do ciclo, a produtividade potencial e a produtividade predita, repetidos em todas as linhas. Essas três últimas colunas ficam vazias quando a safra não tem Ym.

O arquivo vai para a pasta de downloads do computador. O nome traz o talhão e a safra, por exemplo `serie-diaria-talhao-1-sede-2025-26-b652aedf.csv`, em que o trecho final identifica a execução. As colunas são separadas por ponto e vírgula e os números usam vírgula decimal, no padrão brasileiro.

Use a exportação para montar relatórios, comparar com os dados do pluviômetro ou guardar uma cópia fora do sistema.

## Histórico de execuções e reprocessamento

Toda vez que o painel é recalculado, o sistema guarda a execução anterior. A tabela **Histórico de runs**, no fim da página, lista todas.

![Histórico de execuções, com o botão Ver série em destaque](img/06-19-historico.png)

A coluna **Origem** diz o que provocou cada execução: **Criação da safra**, **Semanal** ou **Manual**. A coluna **Índice · predita** traz o índice do ciclo e a produtividade predita de cada execução, o que permite acompanhar como a estimativa evoluiu ao longo da safra. A linha marcada como **exibida** é a que está na tela.

Clique em **Ver série** para carregar os gráficos e o bloco Produtividade de uma execução antiga. Um aviso aparece acima dos gráficos, com o botão **Voltar à run mais recente**. Isso serve para ver como o painel estava em uma data anterior.

### Reprocessar

![Cabeçalho do painel, com o botão Reprocessar em destaque](img/06-20-reprocessar.png)

Clique em **Reprocessar** para recalcular o painel agora. Faça isso quando:

- você corrigiu a altitude ou os dados de solo do talhão;
- você informou ou alterou a produtividade potencial da safra;
- você alterou os parâmetros da cultivar;
- o administrador avisou que a correção da chuva foi calibrada;
- você quer os dados mais recentes sem esperar a segunda-feira.

A conta é determinística. Com os mesmos dados de entrada, reprocessar devolve exatamente os mesmos números. Eles só mudam quando os dados de clima, o talhão, a cultivar ou a produtividade potencial mudaram.

## Quando aparece Sem processamento do MSA

Em vez do painel, a página da safra pode mostrar o quadro **Sem processamento do MSA**. O quadro sempre diz o motivo.

![Safra recém-emergida, com o quadro Sem processamento do MSA em destaque](img/06-21-dados-insuficientes.png)

### Faltam dados de clima

É o caso da imagem: a última tentativa terminou com **NEEDS_DATA**, e o quadro lista os dias que faltam. A safra do exemplo emergiu há poucos dias, e os dados de clima chegam com cerca de cinco dias de atraso.

**O que fazer:** nada de imediato. A rotina de segunda-feira busca os dias que faltam e reprocessa a safra. Se quiser tentar antes, clique em **Reprocessar** depois de dois ou três dias. Se o aviso continuar por mais de uma semana, fale com o administrador.

### Falta a altitude do talhão

A página mostra o aviso **Talhão sem altitude**, com o link **Editar talhão**.

**O que fazer:** informe a altitude, como mostra o [capítulo 3](03-talhoes.md#altitude), volte à safra e clique em **Reprocessar**.

### O processamento falhou

O quadro mostra **FAILED** e uma mensagem de erro.

**O que fazer:** clique em **Reprocessar** uma vez. Se falhar de novo, copie a mensagem e envie ao administrador.

### O painel aparece, mas com um aviso amarelo

Quando já existe um resultado anterior e a tentativa mais recente não deu certo, o painel continua mostrando a última execução bem-sucedida. Um aviso no cabeçalho informa a data da tentativa e o motivo. Os números na tela são válidos, só não incluem os dias mais recentes.

### Um cartão diz que a janela não foi alcançada

Não é erro. A lavoura ainda não chegou àquela fase. O cartão é preenchido quando o ciclo avançar, e o bloco Produtividade conta a janela como sem estresse até lá.

## O painel visto pelo produtor

O produtor vê o mesmo painel, com os mesmos números. A diferença é que ele não tem o botão **Reprocessar** nem o de editar a produtividade potencial, e, quando a Ym não foi informada, o bloco Produtividade diz que o responsável técnico ainda não a informou.

![Página da safra vista pelo produtor, sem os botões de ação](img/06-22-painel-do-produtor.png)

## Roteiro rápido de leitura

1. **Selo da chuva.** Corrigida ou sem correção? Isso diz quanto confiar no detalhe.
2. **Cartão de F3.** Qual a cor? Qual a redução estimada?
3. **Bloco Produtividade.** Qual o índice do ciclo? Quantas sacas a falta de água custou? A predição é parcial?
4. **Gráfico de Ks.** Quando foi a queda e quanto durou?
5. **Campo.** O que você viu na lavoura confirma o painel?
6. **Avisos.** A cultivar ou a produtividade potencial mudaram desde o cálculo? Se sim, reprocesse.

---

Capítulo anterior: [Safras](05-safras.md) · Próximo: [Administração](07-administracao.md)
