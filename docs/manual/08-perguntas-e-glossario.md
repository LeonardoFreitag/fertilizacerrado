# Perguntas frequentes e glossário

**O que você vai encontrar:** respostas rápidas para as dúvidas mais comuns e a explicação, em linguagem simples, dos termos que aparecem nas telas.

Quem quiser as fórmulas e as referências científicas encontra tudo em [`docs/msa/algoritmos.md`](../msa/algoritmos.md).

## Perguntas frequentes

### Conta e acesso

**Não recebi o e-mail de confirmação. O que faço?**
Olhe a pasta de spam. Se não estiver lá, tente entrar com seu e-mail e senha e clique em **Reenviar e-mail de verificação**. Outra saída é usar **Esqueci minha senha**: concluir a troca de senha também confirma o e-mail.

**O sistema diz que minha conta está desativada.**
Um administrador desativou o acesso. Só ele pode reativar. Seus dados continuam guardados.

**Errei a senha várias vezes e fui bloqueado.**
Depois de cinco tentativas erradas, o sistema bloqueia novas tentativas por até 15 minutos e mostra quanto tempo falta. Espere ou use **Esqueci minha senha**.

**Posso mudar meu e-mail ou meu CPF?**
Não pela tela. Fale com o administrador.

### Propriedades e talhões

**Sou produtor e não vejo minha fazenda.**
A propriedade aparece quando o agrônomo a cadastra e escolhe você como **Produtor dono**. Confirme com ele se o cadastro foi feito com o e-mail da sua conta.

**Não sei a altitude do talhão.**
Use o GPS, o aplicativo de mapas do celular ou o levantamento topográfico da fazenda. Um erro de algumas dezenas de metros muda pouco o resultado. Sem altitude a safra não é processada.

**Não tenho análise física do solo. Posso usar o sistema?**
Pode. Deixe em branco a capacidade de campo e o ponto de murcha. O sistema usa valores típicos de latossolo do Cerrado e registra que usou o padrão.

**Por que dois talhões vizinhos mostram a mesma chuva?**
Os dados de clima vêm em quadrados de cerca de 9 km de lado. Talhões dentro do mesmo quadrado recebem os mesmos dados. Veja [ERA5-Land](#era5-land).

**Não consigo excluir um talhão.**
Talhões com safra cadastrada não podem ser excluídos, para preservar o histórico.

### Cultivares

**Posso cadastrar milho?**
Nesta fase, não. O sistema trabalha só com soja. A cultivar de referência e as cultivares próprias são todas de soja.

**Preciso digitar todos os parâmetros da minha cultivar?**
Não. Uma cultivar nova nasce como cópia da referência. Altere só o que você conhece da sua cultivar; o sistema marca os campos que ficaram diferentes. Veja o [capítulo 4](04-cultivares.md#cadastrar-a-sua-cultivar).

**Alterei um parâmetro da cultivar e o painel da safra não mudou.**
É esperado. O resultado que está na tela foi calculado com os parâmetros da época, e o painel avisa que a cultivar mudou desde aquela execução. Clique em **Reprocessar** para usar os valores novos.

**A referência mudou. Minhas cultivares mudam junto?**
Não. Use **Atualizar a partir da referência**, na tela de edição da cultivar, e escolha se quer trazer só os campos que você não alterou ou todos. Veja o [capítulo 4](04-cultivares.md#atualizar-a-partir-da-referência).

**O painel diz que os parâmetros da cultivar mudaram, mas não mexi em nada.**
É efeito de uma atualização do sistema. Com a adoção do método de Ometto para os graus-dia, toda cultivar ganhou um parâmetro novo, a [temperatura-base superior](#temperatura-base-superior-tb), preenchida com 30 °C. As execuções feitas antes dessa atualização não tinham esse parâmetro, e por isso o painel avisa que a cultivar mudou. Clique em **Reprocessar**: a nova execução usa o método atual, e o aviso some. As datas das janelas podem mudar alguns dias em relação à execução antiga; é o esperado.

### Safras e painel

**Cadastrei a safra e o painel não apareceu.**
O processamento leva de alguns segundos a alguns minutos. Se aparecer **Sem processamento do MSA**, leia o motivo na própria tela. Os casos mais comuns são falta de dados de clima para os dias mais recentes e talhão sem altitude. Veja o [capítulo 6](06-painel-agrometeorologico.md#quando-aparece-sem-processamento-do-msa).

**Por que o processamento pede dados desde fevereiro, se a lavoura nasceu em outubro?**
Porque a conta da água no solo começa no 1º de fevereiro anterior à emergência, quando o solo costuma estar cheio pelas chuvas de verão, e acompanha a entressafra inteira para saber com quanta água o talhão entrou na safra. Na primeira safra de uma região nova, o sistema precisa baixar esses meses antes de calcular, e o quadro **Sem processamento do MSA** lista os dias que faltam, agrupados por mês. O download é automático; quando termina, a safra é processada sozinha. Veja o [capítulo 5](05-safras.md#por-que-a-safra-começa-em-fevereiro) e [Entressafra](#entressafra-spin-up).

**Os dados param cinco ou seis dias antes de hoje. É defeito?**
Não. Os dados de clima são publicados com cerca de cinco dias de atraso. O sistema não trabalha com previsão do tempo nem com dados do dia.

**De quanto em quanto tempo o painel é atualizado?**
Toda segunda-feira o sistema busca os dados novos e reprocessa as safras ativas. Você também pode clicar em **Reprocessar** quando quiser.

**A chuva do painel é diferente da que medi no pluviômetro.**
É esperado. O painel usa uma estimativa para um quadrado de 9 km, e a chuva varia muito dentro dessa área, sobretudo em pancadas de verão. Se a diferença for grande e constante, anote isso nas notas da safra e leve em conta ao interpretar a estimativa. Veja também [Correção da chuva](#correção-da-chuva).

**O sistema me diz quanto adubo aplicar?**
Não. Ele estima a produtividade da safra a partir da falta de água e da produtividade potencial que você informou. O que fazer com essa estimativa, na adubação ou em qualquer outra decisão, é do responsável técnico. O sistema apoia e não substitui a decisão do responsável técnico.

**O que faço com a produtividade predita?**
Use-a como apoio. Ela diz quanto a falta de água, sozinha, pode ter custado em relação à produtividade potencial. Compare com o que você vê na lavoura e com o histórico do talhão antes de decidir qualquer coisa. Ela não enxerga pragas, doenças, fertilidade nem manejo.

**Mudei a produtividade potencial e o número do painel não mudou.**
É esperado. A estimativa na tela foi calculada com o valor da época. Clique em **Reprocessar** para refazer a conta com o valor novo. O painel avisa enquanto os dois valores forem diferentes.

**A safra ainda não terminou. A produtividade predita vale?**
Vale como estimativa parcial. O painel avisa **Predição parcial**: as janelas que ainda não chegaram entram na conta como se não fosse faltar água. A cada semana o número é atualizado com as janelas alcançadas.

**Reprocessei e os números não mudaram nada. É normal?**
Sim. A conta é determinística: com os mesmos dados de clima, de talhão, de cultivar e a mesma produtividade potencial, o resultado é o mesmo. Os números só mudam quando algum desses dados muda.

**Posso trocar a cultivar de uma safra?**
Não. Cancele a safra e cadastre outra com a cultivar correta.

## Glossário

Os termos estão em ordem alfabética.

### Água no solo na emergência

Cartão do bloco Produtividade que diz com quanta água o talhão entrou na safra: **O talhão entrou na safra com N % da água disponível**. 100% é o solo cheio, na capacidade de campo. O valor não é adivinhado: vem da conta da água no solo feita desde o 1º de fevereiro anterior, pela [entressafra](#entressafra-spin-up). O cartão mostra também a [depleção](#depleção-dr) na emergência em milímetros, a chuva dos 30 dias anteriores e o período da conta. Veja o [capítulo 6](06-painel-agrometeorologico.md#água-no-solo-na-emergência).

### Capacidade de campo e ponto de murcha

A capacidade de campo é a água que o solo guarda depois que o excesso de uma chuva escorre. O ponto de murcha é a água que sobra quando a planta já não consegue retirar mais nada. A diferença entre os dois é a água que a lavoura pode usar. Nas telas aparecem como θFC e θWP.

### Correção da chuva

Ajuste da chuva estimada pelo ERA5-Land com base em anos de medições de uma estação meteorológica próxima. O sistema compara as duas séries, mês a mês, e corrige as diferenças sistemáticas. O nome técnico é Quantile Mapping. Só existe para as regiões em que o administrador importou dados de estação.

### Depleção (Dr)

Quanta água falta no solo para ele voltar à capacidade de campo, em milímetros. Depois de uma boa chuva a depleção é zero. Em um período seco ela cresce dia a dia.

### Entressafra (spin-up)

O período sem lavoura que o sistema calcula antes da safra: do 1º de fevereiro anterior à emergência, com o solo cheio, até a véspera da emergência. Nesses dias não há planta, então os graus-dia não contam e a evaporação é a do solo coberto de palhada, com parâmetros padrão iguais para todos os talhões. O nome técnico, *spin-up*, quer dizer "dar partida": a conta roda pela entressafra só para chegar à emergência com a água do solo calculada. Nos gráficos, a entressafra aparece como uma faixa cinza quando a caixa **Mostrar entressafra** está marcada; na exportação, as linhas vêm com Fase `PRE`. Veja [Água no solo na emergência](#água-no-solo-na-emergência).

### Evento de estresse (momento de estresse)

Período de pelo menos três dias seguidos em que o [Ks](#ks-coeficiente-de-estresse-hídrico) ficou abaixo de 0,70 — a lavoura usou menos de 70% da água de que precisava. O painel lista esses momentos na seção **Como foi a safra**, com o período, a duração, a fase em que aconteceram e a água que faltou, em milímetros. Um momento que começa numa fase e termina na seguinte aparece inteiro. Veja o [capítulo 6](06-painel-agrometeorologico.md#como-foi-a-safra).

### ERA5-Land

Base de dados de clima do programa europeu Copernicus. Ela reconstrói, para o mundo todo, a temperatura, a chuva, o vento e a radiação solar de cada dia, combinando satélites, estações e modelos. Os dados vêm em quadrados de cerca de 9 km de lado e são publicados com uns cinco dias de atraso. É a fonte de clima do sistema.

### Evapotranspiração de referência

Sigla: **ET₀**. É a água que um gramado bem irrigado perderia para a atmosfera em um dia, em milímetros. Depende só do clima: sol, temperatura, umidade do ar e vento. Mede a "sede" da atmosfera naquele dia. O sistema usa o método FAO-56 Penman-Monteith.

### Evapotranspiração da cultura

Sigla: **ETc**. É a água que a sua lavoura usaria em um dia se não faltasse água no solo. O sistema calcula multiplicando a ET₀ pelo Kc. A **ETc ajustada** é a água que a lavoura realmente conseguiu usar, já descontada a falta de água. Calcula-se multiplicando a ETc pelo Ks.

### Execução (run)

Cada vez que o sistema processa uma safra, ele guarda uma execução completa, com data, intervalo de dias, resultados e os parâmetros usados, inclusive uma cópia dos parâmetros da cultivar e a produtividade potencial daquele momento. As telas chamam isso de **run**.

### GDA (graus-dia acumulados)

Medida do calor que a planta acumulou desde a emergência. A cada dia soma-se o calor útil daquele dia, calculado pelo método de Ometto a partir das temperaturas mínima e máxima: conta o calor acima da temperatura-base (10 °C na soja) e, se a cultivar tem [temperatura-base superior](#temperatura-base-superior-tb), só até ela. Em um dia comum, o resultado é a temperatura média menos a temperatura-base; em um dia muito quente, o dia acumula um pouco menos, porque o calor acima do limite não conta. A planta muda de fase quando atinge certos valores de GDA, e não em datas fixas.

### Índice do ciclo

Número de 0 a 100% que resume o efeito da falta de água na safra inteira. Cada janela do ciclo gera um fator: 1 quando não faltou água, menor quando faltou, descontado conforme a sensibilidade da janela (o Ky). O índice é o produto dos quatro fatores. Com índice de 57,1%, a estimativa é que a safra renda 57,1% da produtividade potencial. Uma janela que ainda não chegou entra como se não fosse faltar água. A fórmula está em [`docs/msa/algoritmos.md`](../msa/algoritmos.md), seção 6.

### Janelas F1 a F4

As quatro partes do ciclo da cultura: F1, germinação e estabelecimento; F2, crescimento vegetativo; F3, floração e enchimento de grãos; F4, maturação. O sistema resume os resultados por janela.

### Kc (coeficiente de cultura)

Número que compara o consumo de água da lavoura com o do gramado de referência. É baixo no início, quando a planta é pequena, chega ao máximo com a lavoura fechada e cai na maturação.

### Ks (coeficiente de estresse hídrico)

O número mais importante do painel. Vai de 0 a 1. Com Ks igual a 1, a lavoura teve toda a água de que precisava. Com Ks igual a 0,70, ela conseguiu usar 70% da água de que precisava. Quanto menor, maior a falta de água.

### Ky (sensibilidade ao estresse)

Número que diz quanto a produtividade cai quando falta água em cada janela. Na soja, a floração e o enchimento de grãos têm o maior Ky: é quando a falta de água mais custa.

### Perda por fase (de onde veio a perda)

Divisão da diferença entre a produtividade potencial e a predita entre as quatro fases, em sacas por hectare. A conta segue a ordem do ciclo — a perda de cada fase é calculada sobre o que restava depois das anteriores —, e as quatro parcelas somadas dão exatamente a perda total. Aparece em barras na seção **Como foi a safra**; a barra maior responde à pergunta "de onde veio a perda". Veja o [capítulo 6](06-painel-agrometeorologico.md#produtividade-esperada-e-de-onde-veio-a-perda).

### Produtividade potencial (Ym)

A produtividade que a lavoura alcançaria se não faltasse água em nenhum momento do ciclo, em sacas por hectare. Quem informa é o agrônomo, no cadastro da safra ou depois, pela página da safra. É o ponto de partida da estimativa do painel. Nas telas aparece como **Ym**.

### Produtividade predita

A produtividade estimada da safra, em sacas por hectare, considerando só o efeito da falta de água. É a produtividade potencial multiplicada pelo [índice do ciclo](#índice-do-ciclo). Com Ym de 65 sc/ha e índice de 57,1%, a produtividade predita é de 37,1 sc/ha. É uma estimativa de apoio, e não uma previsão de colheita: não considera pragas, doenças, fertilidade nem manejo. A fórmula está em [`docs/msa/algoritmos.md`](../msa/algoritmos.md), seção 6.

### Redução potencial de produtividade

Estimativa de quanto da produtividade pode ter sido perdida por falta de água em uma janela, em porcentagem. Combina o Ks médio da janela com o Ky dela. É uma estimativa do efeito da água apenas. Não considera pragas, doenças, fertilidade nem manejo. As reduções das quatro janelas se combinam no [índice do ciclo](#índice-do-ciclo).

### Severidade (ok, atenção, crítico)

Cor e selo dos cartões das janelas e da lista de safras. Vêm da [redução potencial de produtividade](#redução-potencial-de-produtividade) da janela: abaixo de 5% é **ok** (verde), de 5% a 15% é **atenção** (amarelo), acima de 15% é **crítico** (vermelho); **não alcançada** (cinza) é a janela a que a lavoura ainda não chegou. Nos gráficos e nos momentos de estresse, a referência é o Ks do dia: 0,85 e 0,70.

### TAW e RAW

**TAW** é a água total disponível: tudo o que o solo guarda para a planta na profundidade das raízes, em milímetros. **RAW** é a água facilmente disponível: a parte do TAW que a planta usa sem sofrer. Enquanto a depleção fica abaixo do RAW, não há estresse. Quando passa do RAW, o Ks começa a cair.

### Temperatura-base superior (TB)

Parâmetro da cultivar, em °C, que marca a temperatura acima da qual o calor a mais já não acelera a planta. É o par da **temperatura-base** (abaixo dela a planta não se desenvolve; 10 °C na soja). Entre as duas está o calor útil que o sistema soma nos [graus-dia](#gda-graus-dia-acumulados), pelo método de Ometto. Para a soja, a referência usa 30 °C, valor provisório. Com ela, um dia de 34 °C de máxima conta um pouco menos que um dia de 30 °C de máxima, e as janelas de uma safra quente ficam alguns dias mais longas do que ficariam sem o limite. O campo é opcional: vazio significa sem limite superior.

---

Capítulo anterior: [Administração](07-administracao.md) · [Voltar ao índice](README.md)
