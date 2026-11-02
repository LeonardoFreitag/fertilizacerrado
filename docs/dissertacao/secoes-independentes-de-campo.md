# Dissertação — Seções independentes dos dados de talhão (minuta)

> **Como usar este arquivo.** Texto em primeira versão para colar na dissertação
> (`dissertacao_completa_v5.docx`). As marcações `[A GERAR: …]` indicam o único ponto
> da seção que depende do estudo de caso ou de uma rodada ainda não feita; tudo o
> mais está fechado. Os números citados foram obtidos no repositório em 2026-10-20
> (código em `git log -1`), com os comandos indicados em cada caso, para que
> qualquer valor possa ser refeito. Citações no padrão autor-data da lista de
> referências da dissertação; as marcadas com † ainda não constam da lista.
>
> **⚠️ Desatualizado em parte desde 2026-11-02.** A reunião com o professor Adilson
> redefiniu o objetivo do MSA para predição de produtividade (índice do ciclo FAO-33 ×
> Ym por safra) e removeu Monte Carlo, percentis, semente, cenários de decisão e milho
> (change `refocus-on-yield-prediction`; `docs/msa/questoes-abertas.md`, "Registro de
> decisões"; `mapa-objetivos-evidencias.md`, OE5). Os trechos que descrevem esses itens —
> quinto objetivo da seção 1.1.2, linha OE5 da Tabela 4.1, `validate-mc` em OE4, seção
> 4.6 inteira, `MsaDecision` e semente em 4.3/4.4, cenários em 4.7 e 4.8 — são a
> descrição do sistema anterior e devem ser reescritos pela pesquisadora com a nova
> redação do objetivo, a ser confirmada com o orientador. O restante continua válido.

---

## 1.1.2 Objetivos Específicos — redação revisada

Proposta de ajuste para que cada objetivo corresponda exatamente ao que foi
implementado (ver desvios em `mapa-objetivos-evidencias.md`):

- Implementar um *pipeline* robusto e resiliente em Python para download,
  recorte espacial, agregação diária e correção estatística de viés da
  precipitação do produto de reanálise ERA5-Land, calibrada com estações
  convencionais do INMET por Mapeamento de Quantis;
- Modelar um banco de dados geoespacial e de séries temporais em
  PostgreSQL com as extensões PostGIS e TimescaleDB, com indexação espacial GiST
  e particionamento temporal por hipertabela, avaliando seu desempenho nas
  consultas da aplicação;
- Desenvolver um *backend* em Node.js/TypeScript com processamento
  desacoplado por filas distribuídas (BullMQ/Redis) e processos trabalhadores
  dedicados ao cálculo diário do balanço hídrico e do estresse hídrico
  FAO-56 por safra;
- Conduzir a validação estatística do motor de cálculo contra os exemplos
  de referência do FAO-56 e contra o CROPWAT 8.0 (FAO), segundo critérios
  de RMSE, R², NSE e PBIAS;
- Construir um módulo estocástico de propagação de incerteza por simulação
  de Monte Carlo, do clima à recomendação, que forneça cenários de
  fertilização ajustados ao risco (P10/P50/P90).

---

## 3.7 Procedimentos de Desenvolvimento e Garantia de Qualidade do Software

Os capítulos anteriores descreveram a arquitetura concebida e os protocolos de
validação; esta seção descreve o processo pelo qual a concepção foi
convertida em software, uma vez que a reprodutibilidade de um artefato
computacional depende tanto do método de construção quanto do método de
avaliação.

### 3.7.1 Ambiente tecnológico

O sistema foi implementado em três linguagens, cada uma restrita à camada em
que oferece a melhor relação entre ecossistema e desempenho: Python 3.12 para
o *pipeline* de dados climáticos (bibliotecas `xarray`/`netCDF4` para os
arquivos NetCDF do ERA5-Land e `cdsapi` para o acesso ao *Climate Data Store*);
TypeScript sobre Node.js 20 para a API e o motor de cálculo (Express, Prisma
ORM, BullMQ); e React com Tailwind CSS para a interface. O banco de dados é o
PostgreSQL 15 com as extensões PostGIS (geometrias dos talhões) e TimescaleDB
(hipertabelas das séries diárias), e o Redis 7 sustenta as filas de
processamento. Todos os serviços são conteinerizados (Docker Compose), com um
Nginx como proxy reverso e balanceador, de modo que o ambiente de
desenvolvimento e o de produção diferem apenas por configuração.

### 3.7.2 Desenvolvimento orientado a especificação

Adotou-se um fluxo de desenvolvimento orientado a especificação (OpenSpec),
em que cada incremento funcional é precedido por três documentos versionados
junto ao código: uma proposta (o problema e o escopo), um projeto (*design*,
com as decisões técnicas e alternativas descartadas) e as especificações de
comportamento em cenários verificáveis. Ao término da implementação, as
especificações são consolidadas no conjunto vigente do sistema e a mudança é
arquivada. Esse mecanismo produz, como subproduto, a rastreabilidade entre
requisito, decisão e código que a seção 4.8 utiliza para discutir o processo.
Ao final da Fase 1, o repositório contém 13 mudanças arquivadas e 31
especificações vigentes, cobrindo desde a infraestrutura de execução até o
painel agrometeorológico.

### 3.7.3 Testes automatizados e integração contínua

Três níveis de verificação automatizada foram adotados: (i) testes unitários
das funções puras do motor de cálculo (ET₀, graus-dia e fenologia, balanço
hídrico, Monte Carlo, cenários de decisão), do *pipeline* Python
(transformação, correção de viés, carga) e dos validadores de entrada da API;
(ii) testes de invariantes físicas do balanço hídrico, que verificam, para
séries sintéticas, propriedades que devem valer independentemente dos dados
(por exemplo, 0 ≤ Ks ≤ 1, depleção limitada à água total disponível, ETc
nula sem demanda atmosférica); e (iii) roteiros de ponta a ponta
(*end-to-end*) que percorrem o fluxo completo — ingestão, calibração, cadastro
de safra, processamento e consulta — contra a pilha conteinerizada. Os dois
primeiros níveis são executados a cada alteração do código por integração
contínua (GitHub Actions), em quatro trabalhos independentes: *backend*
(verificação de tipos e testes), *frontend* (análise estática, tipos, testes e
construção), ETL (testes Python) e construção das três imagens Docker. Uma
mudança só é integrada quando os quatro trabalhos concluem sem erro.

### 3.7.4 Rastreabilidade entre fórmulas e código

Cada equação do motor (Capítulo 3, seções 3.4 e 3.6) está documentada em um
registro de algoritmos que aponta o arquivo e a função que a implementa, com
a referência bibliográfica correspondente (Allen et al., 1998; Doorenbos;
Kassam, 1979). O mesmo registro fixa as convenções numéricas adotadas (vento
a 2 m por $u_2 = 0{,}748\,u_{10}$; fluxo de calor no solo nulo no passo
diário; dia civil em UTC na agregação do ERA5-Land). Com isso, qualquer
resultado apresentado no Capítulo 4 pode ser rastreado até a equação, a
função e o teste que a cobre.

### 3.7.5 Reprodutibilidade das execuções

Cada execução do motor (*run*) grava, além dos resultados, uma cópia dos
parâmetros da cultivar e do talhão no momento do cálculo, a semente do gerador
pseudoaleatório do Monte Carlo e o identificador da calibração de viés então
ativa para a célula climática. Assim, uma recalibração posterior ou a edição
de uma cultivar não altera resultados já emitidos, e qualquer *run* pode ser
reexecutada com os mesmos insumos. Os scripts de validação (seção 3.5) seguem a
mesma regra: recebem a semente como parâmetro e gravam as séries de entrada
utilizadas.

---

## 4.1 Visão Geral do Sistema Implementado

O módulo agrometeorológico foi implementado integralmente na Fase 1 do
FertilizaCerrado, conforme a arquitetura em cinco estágios descrita na seção
3.1. Ao término da fase, o sistema compreende 5.747 linhas de código
TypeScript no *backend*, 2.152 linhas de Python no *pipeline* ERA5-Land e
6.264 linhas de TypeScript/React na interface (excluídos os testes), 15
entidades de dados persistidas e 308 testes automatizados (201 no *backend*,
48 na interface e 59 no *pipeline*). A Tabela 4.1 relaciona cada objetivo
específico ao módulo que o atende e à evidência apresentada neste capítulo.

**Tabela 4.1 — Correspondência entre objetivos específicos, módulos implementados e evidências.**

| Objetivo | Módulo implementado | Evidência | Seção |
|---|---|---|---|
| OE1 — Pipeline ERA5-Land com correção de viés | Serviço ETL Python (download, transformação, QM, carga), importador de estações INMET, calibrador por célula | Cobertura ingerida, tempo de ingestão, gráfico Q-Q e métricas QM × estação | 4.2 |
| OE2 — Banco geoespacial e de séries temporais | Esquema com 15 entidades; geometrias PostGIS; hipertabelas TimescaleDB para ERA5 e observações | Modelo de dados, volumetria e tempos de consulta | 4.3 |
| OE3 — Backend concorrente e motor FAO-56 | API REST, três filas BullMQ, processo trabalhador Node, motor MSA (GDA, ET₀, ETc, balanço hídrico, Ks, Ky) | Fluxo de orquestração, tempo de processamento por safra, série diária de um talhão, painel | 4.4 |
| OE4 — Validação estatística | Ferramentas `validate-et0` e `validate-mc`, protocolo e roteiro de validação, integração contínua | Métricas ET₀ × FAO-56 e × CROPWAT; balanço hídrico × CROPWAT; cobertura de testes | 4.5 |
| OE5 — Propagação de incerteza | Motor de Monte Carlo (1.000 iterações), percentis por janela, três cenários de decisão | Convergência, distribuições P10/P50/P90, cenários aplicados | 4.6 |

Os três primeiros objetivos correspondem a componentes de software e são
evidenciados pelo artefato em funcionamento e por suas medidas de desempenho;
os dois últimos correspondem a propriedades do cálculo e são evidenciados por
métricas estatísticas. A seção 4.7 reúne todos os componentes em um estudo de
caso, e a seção 4.8 discute o processo de construção e suas limitações.

---

## 4.2 Pipeline de Ingestão e Correção de Viés do ERA5-Land

### 4.2.1 Pipeline implementado

O *pipeline* foi implementado como um serviço Python independente, executado
em contêiner próprio e acionado por fila (BullMQ), em quatro etapas: download
dos arquivos NetCDF horários do ERA5-Land por meio da API do *Climate Data
Store* (CDS), com *cache* local por caixa delimitadora e período para evitar
requisições repetidas; transformação, que agrega as variáveis horárias em
valores diários (temperaturas máxima e mínima, temperatura do ponto de
orvalho, radiação líquida, vento convertido para 2 m e precipitação
acumulada), respeitando as convenções de acumulação do produto; correção de
viés da precipitação; e carga em lote por *upsert* na hipertabela de séries
diárias, chaveada pela célula da grade de 0,1° e pela data.

A unidade de armazenamento é a célula, não o talhão: cada talhão é associado,
no cadastro, à célula que contém seu centróide, e vários talhões compartilham
a mesma série. Essa decisão reduz a volumetria a uma série por célula
ocupada e torna o custo de ingestão independente do número de talhões.

Três tipos de requisição de ingestão são atendidos: a semanal (`latest`), que
cobre o intervalo de hoje − 16 a hoje − 6 dias para todas as células em uso,
respeitando a latência nativa de cerca de cinco dias do produto; a por
região (`range`), que preenche um período para todas as células de uma caixa
delimitadora; e a por célula (`cell`), disparada automaticamente ao
cadastrar uma safra cuja célula ainda não tenha cobertura desde a emergência
(*backfill*). Cada execução é registrada com identificador do trabalho,
progresso por período, horário de pulsação e estado final, o que permite
detectar e marcar execuções órfãs.

### 4.2.2 Correção de viés por Mapeamento de Quantis

A correção segue o esquema empírico em duas etapas (Piani et al., 2010;
Themeßl; Gobiet; Heinrich, 2012), calibrado por mês do ano a partir dos dias
de sobreposição entre a série ERA5-Land da célula e a estação INMET ativa mais
próxima do seu nó (distância ≤ 50 km e sobreposição ≥ 10 anos, ambos
configuráveis). Na primeira etapa corrige-se a frequência de dias chuvosos: o
limiar da reanálise é fixado no quantil $1 - f_{obs}(m)$ da série ERA5 do mês,
de modo que a fração de dias chuvosos corrigida iguale a observada — o que
elimina a "garoa" sistemática da reanálise. Na segunda etapa, nos dias
chuvosos, 99 quantis empíricos da reanálise são mapeados nos quantis
correspondentes da observação por interpolação linear:

$$P_{corr} = F_{obs}^{-1}\left[F_{era5}(P_{era5})\right],\quad P_{era5} > \theta_{era5}(m)$$

Acima do percentil 99 aplica-se a razão do último quantil, limitada a um
fator máximo (3, configurável), para não achatar nem amplificar
indevidamente extremos não representados na calibração (Maraun, 2016†).

Cada calibração é persistida com todos os seus parâmetros (período, número de
dias válidos por mês, limiares, quantis, distância da estação), e apenas uma
calibração por célula e variável permanece ativa; recalibrar desativa a
anterior sem apagá-la. A correção é aplicada na carga de cada ingestão e pode
ser reaplicada sob demanda, sempre a partir do valor bruto, o que a torna
idempotente. Uma recalibração anual automática está agendada para 1º de
janeiro. Nesta versão apenas a precipitação é corrigida; a estrutura é
genérica e prevê a extensão à temperatura.

A validação unitária da correção utilizou uma estação sintética com viés
conhecido (reanálise com intensidades 30 % maiores nos dias chuvosos e garoa
abaixo de 0,5 mm inexistente na observação): a calibração recuperou a fração
de dias chuvosos com erro inferior a 1 ponto percentual e reduziu o PBIAS de
cerca de −20 % para menos de 2 %.

### 4.2.3 Desempenho e cobertura

[A GERAR: tabela com células ingeridas, período coberto, número de dias,
tempo médio por período de ingestão e tamanho do cache; gráfico Q-Q/ECDF da
precipitação bruta × corrigida × observada para a estação do estudo de caso;
RMSE, PBIAS e fração de dias chuvosos por mês da validação cruzada
(`qm validate --calib-years … --test-years …`). Depende de escolher a
estação de referência e ingerir o período.]

---

## 4.3 Persistência Geoespacial e de Séries Temporais

### 4.3.1 Modelo de dados implementado

O esquema final compreende 15 entidades, organizadas em quatro grupos
(Figura 4.x — [A GERAR: diagrama ER a partir de `schema.prisma`]):

- **Cadastro e acesso** — usuário (com os perfis ADMIN, AGRONOMO e PRODUTOR),
  propriedade e talhão. O talhão armazena a geometria do polígono (PostGIS,
  SRID 4326, índice GiST), a altitude e a referência à célula ERA5-Land de seu
  centróide.
- **Clima** — célula da grade de 0,1° (`Era5Cell`), série diária por célula
  (`Era5DailyData`, hipertabela TimescaleDB particionada por data, com
  precipitação bruta e corrigida e o identificador da calibração aplicada),
  registro de execuções de ingestão, estações meteorológicas (com geometria
  PostGIS), observações diárias das estações (hipertabela) e calibrações do
  Mapeamento de Quantis.
- **Cultura** — cultivar, com os parâmetros fisiológicos (T_base, Kc por
  fase, fração de depleção, profundidade radicular, graus-dia das janelas,
  Ky), congelados enquanto houver safra vinculada; e safra, que associa
  talhão, cultivar e data de emergência.
- **Resultados** — execução do motor (`MsaRun`, com motivo, semente,
  identificadores do trabalho e da calibração, e cópia dos parâmetros
  utilizados), série diária de resultados (`MsaDailyResult`), resumo por
  janela fenológica (`MsaPhaseSummary`, com valor determinístico e percentis
  P10/P50/P90) e decisão registrada pelo técnico (`MsaDecision`).

A escolha de uma única imagem de banco com as duas extensões (PostGIS e
TimescaleDB) evitou um segundo sistema de armazenamento para as séries
temporais, e a hipertabela entrega o particionamento por tempo sem alteração
das consultas SQL emitidas pelo ORM.

### 4.3.2 Desempenho das consultas

[A GERAR: volumetria (linhas por tabela) e tempos de execução
(`EXPLAIN ANALYZE`, mediana de 10 execuções) das consultas do painel: série
diária da célula no intervalo da safra; localização da célula a partir de um
ponto; última execução com resumos por janela. Pode ser feito com dados
sintéticos antes do estudo de caso — basta ingerir um ano de uma região.]

---

## 4.4 Camada de Serviços, Orquestração e Motor Agrometeorológico

### 4.4.1 Orquestração por filas

A API não executa cálculos: apenas valida, autoriza e enfileira. Três filas no
Redis conectam os componentes (Tabela 4.2).

**Tabela 4.2 — Filas de processamento implementadas.**

| Fila | Consumidor | Função | Tolerância a falha |
|---|---|---|---|
| `era5-ingest` | Serviço ETL Python (concorrência 1) | Ingestão semanal, regional ou por célula; importação de estações; calibração e aplicação do QM | 3 tentativas com recuo exponencial a partir de 5 min |
| `msa-process` | Processo trabalhador Node (concorrência 4) | Processamento de uma safra (balanço hídrico + Monte Carlo) | 1 tentativa; cálculo determinístico — falha é registrada como *run* `FAILED` |
| `msa-weekly` | Processo trabalhador Node | Gatilho semanal (segundas, 02:00, horário de Brasília) e fluxo pai da rodada | Falha da ingestão impede o processamento com dados desatualizados |

O fluxo semanal é um *flow* com dependência: o trabalho pai só executa quando
a ingestão `latest` conclui, e então enfileira um processamento por safra
ativa com identificador determinístico por data, de modo que uma reexecução no
mesmo dia não duplica trabalho. Ao cadastrar uma safra, a API verifica a
cobertura da célula desde a emergência e, havendo lacuna, encadeia a ingestão
da célula ao processamento (*backfill*), devolvendo ao cliente o identificador
do trabalho para acompanhamento. Um painel administrativo expõe as contagens
por fila, o estado de cada trabalho e os disparos manuais (ingestão,
preenchimento regional, reprocessamento de todas as safras).

### 4.4.2 Motor de cálculo

O motor é um conjunto de funções puras em TypeScript, sem acesso a banco, o
que permitiu testá-lo isoladamente e reutilizá-lo nos scripts de validação.
Para cada safra, a partir da série diária da célula e dos parâmetros da
cultivar, o motor: acumula graus-dia desde a emergência e projeta as quatro
janelas fenológicas (F1–F4); calcula a ET₀ diária pela equação de
Penman-Monteith FAO-56 (Allen et al., 1998); deriva a ETc pelo Kc da fase,
com Kc_ini reduzido para o plantio direto; executa o balanço hídrico da zona
radicular (água total e prontamente disponível, depleção, Ks); e estima a
redução relativa de produtividade por janela pelo Ky (Doorenbos; Kassam,
1979). O resultado determinístico (*baseline*) é gravado como série diária e
como resumo por janela; o Monte Carlo (seção 4.6) acrescenta os percentis.

Quando a série da célula não cobre todo o período necessário, a *run* é
encerrada com o estado `NEEDS_DATA` e a lista de datas faltantes, em vez de
produzir um resultado parcial — decisão tomada para que o painel nunca exiba
um balanço hídrico calculado com lacunas.

### 4.4.3 Interface

[Selecionar 2–3 figuras de `docs/manual/img/`: desenho do talhão no mapa,
painel de janelas fenológicas com indicador de Ks, painel de cenários de
decisão. Texto a escrever a partir das figuras escolhidas.]

### 4.4.4 Tempo de processamento

[A GERAR: instrumentar o processamento de uma safra (série de ~150 dias:
balanço hídrico determinístico + 1.000 iterações) e o lote semanal com N
safras; relatar mediana e P95. Pode ser medido com a safra sintética.]

---

## 4.5 Validação do Motor de Cálculo

### 4.5.1 Verificação automatizada

Os 308 testes automatizados são executados a cada alteração do código. No
motor, 9 arquivos de teste cobrem geradores pseudoaleatórios, graus-dia e
fenologia, ET₀, balanço hídrico, Monte Carlo, redução de produtividade,
cenários de decisão, invariantes físicas e o serviço de orquestração; no
*pipeline*, 59 testes cobrem download, transformação, Mapeamento de Quantis,
importação de estações, carga e interface de linha de comando. [A GERAR:
percentual de cobertura de linhas — `vitest run --coverage` e
`pytest --cov`.]

### 4.5.2 ET₀ contra os exemplos de referência do FAO-56

Antes da comparação com o CROPWAT, o motor foi confrontado com os dois
exemplos resolvidos do próprio manual FAO-56 (Allen et al., 1998), que fixam
a resposta esperada de forma independente de qualquer software: o Exemplo 17
(Bangkok, média mensal de abril) e o Exemplo 18 (Uccle, Bélgica, dia 6 de
julho). Os dados foram transcritos tal como constam no manual e processados
pelo script `validate-et0` (Tabela 4.3).

**Tabela 4.3 — ET₀ calculada pelo motor FertilizaCerrado e valores de referência do FAO-56.**

| Exemplo | ET₀ motor (mm/dia) | ET₀ referência (mm/dia) | Erro (mm/dia) |
|---|---|---|---|
| Ex. 17 — Bangkok, abril (mensal) | 5,76 | 5,72 | +0,04 |
| Ex. 18 — Uccle, 6 de julho (diário) | 3,88 | 3,90 | −0,02 |
| RMSE | | | 0,028 |
| PBIAS | | | −0,16 % |

Os erros de 0,02 a 0,04 mm/dia são da ordem do arredondamento adotado no
manual nos passos intermediários (duas casas decimais em Δ, γ, $e_s$ e $e_a$),
e o RMSE de 0,028 mm/dia fica uma ordem de grandeza abaixo do critério de
aceitação de 0,5 mm/dia. Com apenas duas observações R² e NSE não são
informativos e por isso não são reportados; a comparação com o CROPWAT
(seção 4.5.3) fornece a amostra necessária.

### 4.5.3 ET₀ e balanço hídrico contra o CROPWAT 8.0

[A GERAR: Fase 1 do roteiro — série mensal CLIMWAT da estação de referência
(Goiânia, 83423, ou a mais próxima do estudo de caso), 12 observações, tabela
RMSE/R²/NSE/PBIAS e gráfico de dispersão; Fase 2 — balanço hídrico da safra
do estudo de caso exportado do painel × CROPWAT (ETc, depleção, Ks). Não
depende de talhão real para a Fase 1 — apenas da estação.]

---

## 4.6 Propagação de Incerteza por Monte Carlo

### 4.6.1 Implementação

A cada iteração sorteia-se um fator multiplicativo da precipitação
$f_i \sim \mathcal{N}(1;\,0{,}30^2)$, truncado em zero, e um deslocamento
térmico $\delta_i \sim \mathcal{N}(0;\,0{,}6^2)$ °C, aplicados a toda a série
da safra (perturbação sistemática por iteração, e não independente por dia,
de modo a representar o erro de viés da reanálise, e não o ruído diário —
ver seção 4.8). O balanço hídrico completo é recalculado em cada iteração e,
ao final das 1.000 iterações, obtêm-se, para cada janela fenológica, os
percentis P10, P50 e P90 do Ks médio e da redução de produtividade. O gerador
pseudoaleatório é semeado explicitamente e a semente é gravada na *run*.

### 4.6.2 Convergência do número de iterações

A convergência foi avaliada com a série sintética de 150 dias representativa
de uma safra de soja no Cerrado (emergência em outubro, altitude 741 m,
Latossolo com θ_FC = 0,28 e θ_WP = 0,12 cm³/cm³), executando o motor com 100,
500 e 1.000 iterações e a mesma semente, e repetindo para três sementes
(`validate-mc --seed 2026 | 7 | 42`). A Tabela 4.4 apresenta o resultado para
as janelas com estresse (F3 e F4); em F1 e F2 a série sintética não produz
déficit e Ks = 1 em todos os percentis.

**Tabela 4.4 — Convergência do P50 do Ks médio por janela com o número de iterações (três sementes).**

| Janela | Semente | P50 (100) | P50 (500) | P50 (1.000) | Variação 500→1.000 | P10 (1.000) | P90 (1.000) | Determinístico |
|---|---|---|---|---|---|---|---|---|
| F3 | 2026 | 0,9585 | 0,9722 | 0,9711 | 0,11 % | 0,8303 | 1,0000 | 0,9676 |
| F3 | 7 | 0,9601 | 0,9769 | 0,9719 | 0,52 % | 0,8346 | 1,0000 | 0,9676 |
| F3 | 42 | 0,9883 | 0,9756 | 0,9746 | 0,11 % | 0,8168 | 1,0000 | 0,9676 |
| F4 | 2026 | 0,9053 | 0,9211 | 0,9216 | 0,05 % | 0,6284 | 1,0000 | 0,9295 |
| F4 | 7 | 0,8962 | 0,9371 | 0,9289 | 0,88 % | 0,6518 | 1,0000 | 0,9295 |
| F4 | 42 | 0,9632 | 0,9216 | 0,9194 | 0,24 % | 0,6117 | 1,0000 | 0,9295 |

Três observações decorrem da tabela. Primeiro, o P50 a 1.000 iterações é
estável entre sementes: a amplitude entre as três sementes é de 0,0035 em F3
e 0,0095 em F4 (menos de 1 % do valor), enquanto a 100 iterações a amplitude
chega a 0,03 em F3 e 0,07 em F4 — o que confirma que 100 iterações são
insuficientes e 1.000 são adequadas para o P50. Segundo, o critério de
variação 500→1.000 inferior a 0,5 %, definido a priori, foi atendido em duas
das três sementes; para a semente 7, a variação foi de 0,52 % em F3 e 0,88 %
em F4. Como a dispersão entre sementes a 1.000 iterações é da mesma ordem
(≈ 0,4 % em F3 e ≈ 1 % em F4), o critério de 0,5 % é mais restritivo do que
a variabilidade amostral intrínseca do estimador permite distinguir; propõe-se
reportá-lo como "variação inferior a 1 %" ou, alternativamente, adotar 2.000
iterações caso se deseje manter 0,5 %. [Decisão da pesquisadora.] Terceiro, o
P50 estocástico situa-se sistematicamente abaixo do valor determinístico em F4
(0,92 contra 0,93) e ligeiramente acima em F3: a perturbação da chuva é
simétrica, mas a resposta do Ks ao déficit não é, de modo que a mediana da
distribuição não coincide com o resultado do clima médio — justamente o
comportamento que motiva a abordagem estocástica.

A amplitude P10–P90 (0,82–1,00 em F3; 0,61–1,00 em F4) mostra que, mesmo em
uma safra com estresse determinístico moderado (redução de produtividade de
2,9 % em F3 e 3,1 % em F4), cerca de um décimo das realizações climáticas
plausíveis leva a estresse severo na maturação (Ks < 0,65), informação que
o valor determinístico sozinho não transmite.

### 4.6.3 Normalidade das perturbações

[A GERAR: teste de Shapiro-Wilk sobre os 1.000 fatores $f_i$ e deslocamentos
$\delta_i$ de uma rodada (pendência 3 do roteiro); pode ser feito com a série
sintética.]

### 4.6.4 Cenários de decisão

Sobre o P50 do Ks da janela escolhida, o sistema calcula os três cenários
definidos na seção 3.6 — redução de dose ($D_{adj} = D_{base} \times Ks_{P50}$),
parcelamento proporcional à ETc projetada e ajuste do fator de eficiência —
e registra a escolha do técnico com justificativa, vinculada à *run* que a
fundamentou. [A GERAR: tabela dos três cenários para uma dose base do Boletim
100 / Sousa & Lobato (2004) aplicada ao talhão do estudo de caso.]

---

## 4.8 Discussão do Processo de Implementação

### 4.8.1 Decisões revistas durante a construção

O desenvolvimento orientado a especificação (seção 3.7.2) registrou as
decisões que divergiram do projeto inicial. As principais:

- **Concorrência por filas, e não por *threads*.** O projeto previa *worker
  threads* do Node.js para o cálculo; a implementação adotou processos
  trabalhadores separados consumindo filas BullMQ. A mudança isolou a API do
  custo de cálculo (uma réplica da API nunca executa o motor), permitiu que o
  *pipeline* Python e o motor Node compartilhassem o mesmo mecanismo de
  orquestração e trouxe de graça novas tentativas, dependências entre
  trabalhos e idempotência por identificador.
- **Armazenamento por célula, e não por talhão.** A série climática passou a
  ser chaveada pela célula da grade de 0,1°, com o talhão apontando para a
  célula de seu centróide; a extração por polígono prevista originalmente foi
  substituída por essa associação, pois a resolução de 9 km torna a média
  ponderada por área indistinguível do valor da célula dominante para talhões
  típicos.
- **Perturbação sistemática no Monte Carlo.** A perturbação de precipitação e
  temperatura é sorteada uma vez por iteração e aplicada a toda a safra, para
  representar o erro de viés da reanálise; a alternativa de sorteio diário
  independente foi registrada como questão aberta, por representar outro tipo
  de incerteza (ruído) e produzir distribuições mais estreitas.
- **Dia civil em UTC.** A agregação diária seguiu a convenção nativa do
  ERA5-Land; o pareamento com as estações do INMET (dia local) introduz um
  deslocamento de 3 h que a calibração mensal absorve, mas que permanece como
  limitação documentada.
- **Resultado parcial proibido.** Uma execução sem cobertura completa é
  encerrada como `NEEDS_DATA`, em vez de calcular com lacunas, após se
  constatar que lacunas de poucos dias na precipitação alteravam o Ks das
  janelas seguintes de forma invisível ao usuário.

### 4.8.2 Convenções sem respaldo bibliográfico direto

Algumas escolhas foram tomadas por conveniência de projeto e estão
explicitamente marcadas para revisão: os limiares de severidade exibidos no
painel (Ks ≥ 0,85 adequado; 0,70–0,85 atenção; < 0,70 crítico); o fator
0,748 de conversão do vento de 10 m para 2 m, derivado da Eq. 47 do FAO-56
para superfície gramada, enquanto o vento do ERA5-Land é calculado sobre a
rugosidade do próprio modelo de superfície; e os parâmetros padrão do
Mapeamento de Quantis (50 km, 10 anos, limiar de 0,1 mm, razão máxima 3).
Todos são configuráveis e gravados em cada execução ou calibração, de modo que
uma revisão posterior não invalida resultados já emitidos.

### 4.8.3 Limitações do sistema

- A latência de cerca de cinco dias do ERA5-Land e o processamento semanal
  em lote fazem do sistema uma ferramenta de decisão oportuna por janela
  fenológica, e não de resposta em tempo real — limitação assumida em projeto
  (seção 3.1) e compatível com a logística das operações de adubação.
- A resolução de 9 km não representa a variabilidade sub-grade da
  precipitação convectiva, dominante no verão do Cerrado; a correção de viés
  ajusta a distribuição, não a ocorrência de cada evento.
- A correção de viés depende de uma estação convencional com série longa a
  menos de 50 km; células sem estação elegível operam com a precipitação
  bruta, com aviso no painel.
- Apenas a precipitação é corrigida nesta versão; a temperatura, que governa
  os graus-dia e a ET₀, usa o valor bruto da reanálise.
- Talhões com múltiplos polígonos devem ser cadastrados separadamente.

### 4.8.4 Pendências identificadas na validação

A execução das validações desta seção revelou três pendências do próprio
protocolo: (i) a convenção de sinal do PBIAS difere entre o script de ET₀
(Moriasi et al., 2007†: positivo = subestimativa) e o de Mapeamento de
Quantis, e deve ser unificada antes da publicação dos números; (ii) o
critério de convergência de 0,5 % para o Monte Carlo é mais restritivo do que
a variabilidade entre sementes (seção 4.6.2); e (iii) a Fase 2 do roteiro
(balanço hídrico × CROPWAT) ainda depende de comparação em planilha, sem
script dedicado. As três são tratadas como trabalhos de fechamento da
dissertação e constam do registro de pendências do repositório.

---

## Checklist do que resta para fechar o Capítulo 4

Em ordem de dependência (detalhes em `mapa-objetivos-evidencias.md`):

1. Escolher talhão, safra e estação INMET do estudo de caso.
2. Rodar Fase 1 (ET₀ × CROPWAT, CLIMWAT da estação) — independe do talhão.
3. Benchmark de banco e tempo de processamento — podem usar dados sintéticos.
4. Shapiro-Wilk das perturbações — pode usar a série sintética.
5. Ingestão + calibração QM + Fase 4 (gráfico Q-Q, métricas).
6. Processar a safra real; Fase 2 (balanço × CROPWAT); P10/P50/P90 reais; cenários.
7. Escrever 4.7 (estudo de caso) e preencher os `[A GERAR]`.
