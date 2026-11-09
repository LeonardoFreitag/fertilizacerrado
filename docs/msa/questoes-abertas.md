# MSA — Questões Abertas para a Pesquisadora

> Decisões técnicas tomadas durante a implementação da Fase 1 que dependem de
> julgamento científico. Cada item indica o que foi implementado, a alternativa,
> onde está no código e o que muda se a decisão for revista.
>
> Fonte: seções "Open Questions" dos designs em `openspec/changes/archive/`.
> As decisões tomadas em reunião estão em "Registro de decisões", ao fim do arquivo.

| # | Tema | Status |
|---|---|---|
| 1 | ~~Perturbação do Monte Carlo: sistemática × mista~~ | Removida em 2026-11-02 (superada: o Monte Carlo saiu do motor) |
| 2 | Agregação diária do ERA5-Land: dia UTC × dia local | Aguardando decisão |
| 3 | Fator de vento 0,748 (10 m → 2 m) | Aguardando decisão |
| 4 | Limiares de severidade do Ks (0,85 / 0,70) | Aguardando decisão |
| 5 | Parâmetros congelados de cultivar em uso | **Decidido** em 2026-11-02 (`refocus-on-yield-prediction`): edição liberada |
| 6 | Correção de viés (QM): defaults de distância, anos, limiar e cauda | Implementado com defaults; aguardando ajuste |
| 7 | Estação de referência para validação de ET₀ (Caso 1) | Decisão provisória: Goiânia |
| 8 | Talhões com múltiplos polígonos (MultiPolygon) | Baixa prioridade |
| 9 | CREA obrigatório para agrônomos | Não científica; decisão do produto |
| 10 | Temperatura-base superior (TB) da soja — valor e convenção | Implementado 30 °C provisório (2026-11-03); aguardando confirmação |
| 11 | Kc e Zr na entressafra (balanço a partir de fevereiro) | **Implementado (provisório)** em 2026-11-09 (`add-preseason-water-balance`): Kc 1,0, Zr = zrMax, conversão por proporção; aguardando confirmação (sensibilidade via `msa:validate-preseason`) |
| 12 | Regra da data de início do balanço hídrico | **Implementado (provisório)** em 2026-11-09: último 1º de fevereiro ≤ emergência; aguardando confirmação (inclusive a convenção para safrinha) |
| 13 | Conversão da depleção na emergência: proporcional sobre zrMax × balanço sobre zrIni × duas camadas | Aguardando decisão (números de Goiânia registrados em 2026-11-09) |

---

## 1. ~~Perturbação do Monte Carlo — sistemática × mista~~ (removida)

**Superada em 2026-11-02.** O módulo de Monte Carlo (`engine/monte-carlo.ts`,
`random.ts`) foi removido do motor na change `refocus-on-yield-prediction`,
depois que a reunião com o professor Adilson redefiniu o objetivo do MSA (ver
"Registro de decisões"). A pergunta sistemática × mista deixa de existir; uma
eventual faixa de incerteza da produtividade predita, se vier a ser avaliada,
será uma questão nova. A numeração dos itens seguintes foi mantida.

---

## 2. Agregação diária do ERA5-Land — dia UTC × dia local

**Implementado:** o dia é definido em UTC (00:00–23:59 UTC), conforme a
convenção nativa do produto ERA5-Land. Os acumulados (chuva, radiação) usam o
passo 00 UTC do dia seguinte.

**Alternativa:** reagrupar as horas para o dia local (UTC−3, Brasília), o que
alinha a chuva da madrugada ao dia agronômico. Efeito esperado: pequeno nos
totais por janela; maior no detalhe diário (um evento convectivo das 21h–01h
local pode cair em dias diferentes).

**Onde:** `backend/etl/era5/transform.py`, `docs/msa/era5-etl.md`.

**Se mudar:** reingestão completa das células (o cache do ETL evita novo
download); séries diárias passadas mudam, logo reprocessamento das safras.

---

## 3. Fator de vento 0,748 (10 m → 2 m)

**Implementado:** $u_2 = u_{10} \times 0{,}748$, derivado da Eq. 47 do FAO-56
com perfil logarítmico para superfície gramada de referência.

**Questão:** o ERA5-Land calcula o vento a 10 m sobre a rugosidade do seu
próprio modelo de superfície, não sobre grama de referência. Há literatura que
sugere fatores ligeiramente diferentes para reanálises. O efeito em ET₀ é de
segunda ordem no Cerrado (vento fraco), mas vale uma nota metodológica.

**Onde:** `backend/src/modules/msa/engine/et0.ts` → `windSpeedAt2m`.

---

## 4. Limiares de severidade do Ks — 0,85 / 0,70

**Implementado:** classificação visual por janela: Ks médio ≥ 0,85 "ok";
0,70–0,85 "atenção"; < 0,70 "crítico". Esses valores são **convenção de
interface**, escolhidos durante o projeto, sem referência bibliográfica.

**Questão:** confirmar, ajustar ou derivar de outro critério (ex.: redução de
produtividade Ky × (1 − Ks) acima de 10 % / 25 %).

**Onde:** `frontend/src/features/msa/severity.ts`, `docs/modulos/msa.md`.

**Se mudar:** constantes no frontend; sem reprocessamento.

---

## 5. Parâmetros congelados de cultivar em uso — **decidido (2026-11-02)**

**Decisão:** edição liberada, na change `refocus-on-yield-prediction`
(Decisão 10 do design). O `PATCH` nos parâmetros científicos de uma cultivar
com safras responde 200; só o `DELETE` de cultivar em uso continua bloqueado
(409 `CULTIVAR_IN_USE`).

**Justificativa:** desde `add-msa-processing`, cada run grava `cultivarSnapshot`
com os parâmetros efetivamente usados e o motor recebe o snapshot, não o
registro atual. A reprodutibilidade das runs passadas não depende do registro
da cultivar, então o congelamento era redundante.

**Consequências implementadas:**
- `GET /harvests/:id/msa` devolve `cultivarChangedSinceRun` (comparação das
  chaves de `CultivarParams` do snapshot com a cultivar atual) e o painel avisa
  "parâmetros da cultivar mudaram desde esta run"; o formulário de edição mostra
  "Runs já calculadas guardam os parâmetros da época; as próximas usam os novos
  valores".
- Como a referência tabelada pode mudar (ex.: o valor definitivo de T_B na
  questão nº 10), entrou `POST /cultivars/:id/sync-reference` (`unchanged` | `all`),
  apoiado no `referenceSnapshot` gravado na criação da cultivar.

**Onde:** `backend/src/modules/cultivars/cultivar.service.ts`,
`backend/src/modules/msa/msa.service.ts` (`cultivarChangedSinceRun`),
`docs/modulos/msa.md` §1.

**Histórico:** implementação original — 409 `CULTIVAR_IN_USE` para qualquer
parâmetro científico de cultivar com safra, motivada pela reprodutibilidade.

---

## 6. Correção de viés da precipitação (Quantile Mapping) — defaults adotados

**Implementado** (`add-era5-bias-correction`): QM empírico **por mês do ano**, em
duas etapas (frequência de dias chuvosos + mapeamento de 99 quantis nos dias
chuvosos), agnóstico à estação. Toda escolha científica é configuração com
default, gravada em cada calibração (`qm_calibrations`), para a pesquisadora
ajustar e recalibrar:

| Variável | Default | O que controla |
|---|---|---|
| `QM_MAX_DISTANCE_KM` | 50 | distância máxima do nó da célula à estação pareada (haversine; a mais próxima elegível vence) |
| `QM_MIN_YEARS` | 10 | anos mínimos de sobreposição válida ERA5 × observação para a estação ser elegível |
| `QM_WET_DAY_MM` | 0,1 | "dia chuvoso" observado: precipitação acima deste valor |
| `QM_MAX_RATIO` | 3 | fator máximo aplicado acima do P99 (extrapolação por razão do último quantil) |

Decisões fixas no código (mudá-las é uma nova versão de `method`, hoje
`empirical-monthly-v1`): só precipitação; 99 quantis com interpolação linear;
estratificação por mês do ano; uma estação por célula (sem ponderação por
distância); cauda por razão constante limitada.

**Alternativas a avaliar:** QM paramétrico (gama) para a cauda; ponderação de
duas ou três estações por distância inversa; corrigir também temperatura;
pareamento por dia local em vez de dia UTC (ligado ao item 2).

**Onde:** `backend/etl/era5/qm.py` (método), `qm_ops.py` (pareamento/aplicação),
`.env.example` (defaults), `docs/msa/era5-etl.md` (Etapa 3),
`docs/msa/validacao.md` (Caso 4 — `qm validate`).

**Se mudar:** alterar o `.env` e rodar "Calibrar todas as células" em `/admin`
(ou `qm calibrate --auto`); depois "Processar todas as safras ativas". As runs
antigas mantêm o `qm_calibration_id` da calibração que as produziu.

---

## 7. Estação de referência para validação de ET₀ — Goiânia

**Implementado:** o Caso 1 do protocolo usa Goiânia (INMET 83423), por ser uma
estação convencional com série longa, presente na base CLIMWAT 2.0 e central ao
bioma. É uma escolha provisória.

**Questão:** substituir pela estação mais próxima da área de estudo da
dissertação, se houver.

**Onde:** `docs/msa/validacao.md`, `backend/scripts/validation/`.

---

## 8. Talhões com múltiplos polígonos

**Implementado:** apenas `Polygon`. Talhões divididos por estrada ou curso
d'água precisam ser cadastrados como talhões separados.

**Alternativa:** aceitar `MultiPolygon`; o centróide e a célula ERA5 seriam
calculados sobre a união. Baixa prioridade.

---

## 9. CREA obrigatório para agrônomos

**Implementado:** opcional. Decisão de produto, não científica — mantida aqui
apenas porque apareceu nos designs. Considerar obrigatório se o sistema for
emitir laudos com responsabilidade técnica.

---

## 10. Temperatura-base superior (TB) da soja — valor e convenção

**Implementado** (`adopt-ometto-degree-days`, 2026-11-03): graus-dia pelo
**método de Ometto (1981)**, com temperatura-base inferior Tb (`tBase`, 10 °C)
e superior TB (`tUpper`), nos cinco casos descritos em `algoritmos.md` §1. A
cultivar de referência de soja recebeu **TB = 30 °C, valor provisório**; a
migration gravou o mesmo valor em todas as cultivares próprias e no
`referenceSnapshot` delas, para que o campo conte como "não alterado". O campo
é opcional (`null` = sem base superior; só os casos 1–3 de Ometto).

**Questão (a):** qual TB adotar para a soja no Cerrado. A faixa de **30 a 35 °C**
e o valor provisório de 30 °C vieram do briefing da reunião e **não têm fonte
bibliográfica conferida** — a confirmar com o professor Adilson e a pesquisadora,
com a referência a citar em `algoritmos.md` §1. Como a janela da soja no Cerrado tem muitos dias com
Tmax entre 30 e 35 °C (set–nov), a escolha desloca as datas de F2–F4 em dias
(Caso 5 de `validacao.md` quantifica).

**Questão (b):** convenção para **Tmin ≥ TB** (dia inteiro acima da base
superior, possível em ondas de calor). A formulação original não cobre a
situação; o motor adota o **teto TB − Tb**. Alternativa: GD = 0 (dia inteiro
fora da faixa útil), fisiologicamente defensável, mas descontínuo em relação ao
caso 4. A convenção e a alternativa são proposta nossa, sem fonte conferida —
a confirmar com o professor Adilson / a pesquisadora. Convenções correlatas, já fixadas: TB só atua quando Tmax > TB (com
Tmax = TB os casos 4/5 coincidem com 1/2); Tmax = Tmin cai no caso 1 ou 3; o
resultado fica em [0, TB − Tb].

**Onde:** `backend/src/modules/msa/engine/gda.ts` (`dailyGDA`, convenções),
`backend/src/modules/cultivars/reference-cultivars.ts` (`tUpper: 30`),
`prisma/migrations/*_adopt_ometto_degree_days`, `docs/msa/algoritmos.md` §1.

**Se mudar o valor:** `UPDATE` da referência (seed/`reference-cultivars.ts` +
execução do seed) e, nas cultivares próprias, `POST /cultivars/:id/sync-reference`
no modo `unchanged` (o campo nasceu "não alterado", então acompanha a
referência); em seguida "Processar todas as safras ativas". **Se mudar a
convenção** de Tmin ≥ TB: um ramo em `dailyGDA`, teste correspondente e nova
`ENGINE_VERSION`; reprocessar.

---

## 11. Kc e Zr na entressafra (balanço a partir de fevereiro)

**Decorrente da reunião com o professor Adilson (2026-11-02).**

**Implementado** (`add-preseason-water-balance`, 2026-11-09, motor 2.2.0): o
balanço de toda safra começa no último 1º de fevereiro ≤ emergência (item 12),
com o solo na capacidade de campo, e atravessa a entressafra **sem cultura**
(`phase = 'PRE'`, GDA 0) com **Kc constante 1,0** (`PRE_SEASON_KC` — evapo-
transpiração potencial direta, padrão Thornthwaite-Mather, solo com palhada do
plantio direto) e **Zr constante = zrMax** da cultivar (`PRE_SEASON_ZR_MODE =
'zrMax'`, 0,95 m — o perfil que a cultura vai explorar). No primeiro dia de
cultura a depleção do perfil é **convertida por proporção** para a zona
radicular inicial (`Dr_ini = Dr_pre × TAW(zrIni)/TAW(zrPre)`; hipótese de
umidade uniforme no perfil, registrada como limitação em `algoritmos.md` §5).
Nos dias `PRE` o Ks usa a fração de depleção **p da cultivar (0,50)** embora não
haja cultura — segunda aproximação registrada. Os dois parâmetros vêm do
ambiente e são **gravados em cada run** (`preSeasonKc`, `preSeasonZr`); a run
informa `emergenceDepletionMm`/`Pct`, e o painel mostra "o talhão entrou na
safra com N % da água disponível".

**Questão (o que falta confirmar):**
- **Valor de Kc da entressafra.** 1,0 (ETP direta) pode secar demais um solo
  com palhada, que evapora menos que a superfície de referência; alternativas:
  Kc de solo nu com palhada (≈ 0,4–0,7) ou um Kc de entressafra calibrado. O
  script `pnpm msa:validate-preseason` imprime a depleção na emergência para
  Kc 0,4 / 0,7 / 1,0 na célula escolhida (análise de sensibilidade; Caso 2 de
  `validacao.md`, passo "depleção na emergência × Thornthwaite-Mather").
- **Zr da entressafra.** `zrMax` (perfil inteiro, com conversão para `zrIni` na
  emergência) tende a subestimar a secagem da camada superficial; a alternativa
  `zrIni` (balanço já sobre 0,30 m, sem conversão efetiva) está implementada
  (`--zr-mode zrIni` no script; `PRE_SEASON_ZR_MODE=zrIni` no ambiente).
- **Uso do p da cultivar no Ks sem cultura** (substituto grosseiro do
  decaimento da evaporação do solo, FAO-56 cap. 7, Kr/REW) — aceitar ou
  implementar a evaporação em dois estágios.
- Cobertura/segunda safra na entressafra (Kc próprio) está fora do escopo: a
  entressafra é solo com palhada, Kc constante.

**Onde:** `backend/src/modules/msa/engine/pre-season.ts` (`PRE_SEASON_DEFAULTS`,
`convertDepletion`), `engine/water-balance.ts` (`runDailyBalance(…, { preSeason })`),
`backend/src/config/env.ts` + `config/pre-season.ts` (`PRE_SEASON_KC`,
`PRE_SEASON_ZR_MODE`), `.env.example`, `msa.service.ts` (`emergenceDepletion`),
`docs/msa/algoritmos.md` §5, `backend/scripts/validation/preseason-validate.ts`.

**Se mudar o valor** (Kc ou modo de Zr): alterar o `.env` e **reprocessar** as
safras ("Processar todas as safras ativas"); não há migration nem nova
`ENGINE_VERSION` — os valores ficam gravados em cada run. **Se mudar o modelo**
(Kc variável, evaporação em dois estágios, perfil em camadas): nova
`ENGINE_VERSION` e reprocessar.

---

## 12. Regra da data de início do balanço hídrico

**Decorrente da reunião com o professor Adilson (2026-11-02).**

**Implementado** (`add-preseason-water-balance`, 2026-11-09, motor 2.2.0):
**1º de fevereiro fixo** — `preSeasonStart(emergência)` devolve o último 1º de
fevereiro menor ou igual à emergência (ano = mês ≥ 2 ? ano : ano − 1):
emergência 2026-10-20 → 2026-02-01; 2027-01-15 → 2026-02-01 (spin-up de
~11 meses); 2027-02-01 → o próprio dia (sem entressafra, depleção 0). O solo é
assumido na capacidade de campo nessa data (fim da estação chuvosa, hipótese da
reunião). A regra vale igualmente para a primeira safra de um talhão (não exige
histórico) e para a safrinha. A cobertura ERA5-Land verificada ao criar a safra
e o backfill partem dessa data; `dateFrom` da run é o início do spin-up.

**Questão (o que falta confirmar):**
- A **data fixa** em si (1º de fevereiro) veio do briefing da reunião, sem fonte
  conferida; alternativas registradas: data da colheita anterior, início do
  período chuvoso por chuva acumulada, ou N meses antes da emergência.
- **Convenção para emergência anterior a 1º de fevereiro** do ano agrícola
  (ex.: safrinha emergida em janeiro): o spin-up vai ao 1º de fevereiro do
  **ano anterior** e atravessa a safra de verão anterior como se fosse solo sem
  cultura — a confirmar com o professor Adilson / a pesquisadora.
- Se 1º de fevereiro não é "solo cheio" em um ano seco, a hipótese inicial
  superestima a água; a comparação com Thornthwaite-Mather (Caso 2) e a chuva
  dos 30 dias anteriores à emergência (cartão do painel) ajudam a discutir.

**Onde:** `backend/src/modules/msa/engine/pre-season.ts` (`preSeasonStart`),
`msa.service.ts` (`runProcessing`: `from = preSeasonStart(emergence)`;
`resolveInterval(from, limit, series, cultivar, emergence)`),
`jobs/jobs.service.ts` (`scheduleHarvestProcessing`, `planHarvestJobs`),
`docs/modulos/msa.md` §2–3, `docs/msa/algoritmos.md` §5, `era5-etl.md`.

**Se mudar a regra da data:** alterar `preSeasonStart` (ou torná-la dependente
de dado da safra/talhão), **nova `ENGINE_VERSION`**, backfill ERA5 do novo
intervalo e reprocessar; a convenção da safrinha, se mudar, idem.

---

## 13. Conversão da depleção na emergência: proporcional sobre zrMax × balanço sobre zrIni × duas camadas

**Decorrente da implementação da entressafra** (`add-preseason-water-balance`,
2026-11-09); valores do briefing e desta análise, sem fonte bibliográfica
conferida — a confirmar com o professor Adilson / a pesquisadora.

**Implementado:** a entressafra é balanceada sobre um único reservatório
(`PRE_SEASON_ZR_MODE`: `zrMax` = 0,95 m por padrão, ou `zrIni` = 0,30 m) e, no
dia da emergência, a depleção é convertida para a zona radicular inicial por
proporção, `Dr_ini = Dr_pre × TAW(zrIni) / TAW(zrPre)` — hipótese de umidade
uniforme no perfil (`engine/pre-season.ts`, `convertDepletion`;
`algoritmos.md` §5).

**Questão:** a hipótese de umidade uniforme pode subestimar a água da camada
0–30 cm depois das primeiras chuvas (setembro/outubro): a chuva molha primeiro
a superfície, mas a conversão a dilui no perfil de 0,95 m, o que pode deixar
F1 em **crítico** artificialmente. Alternativas: (a) balancear a entressafra
sobre `zrIni` (sem conversão); (b) duas camadas — uma superficial (0–30 cm,
zona da plântula) e uma profunda —, com a chuva enchendo a superficial antes de
percolar; (c) manter a proporção, mas reduzir a evaporação do solo seco com
palhada (FAO-56 cap. 7, evaporação em dois estágios / `Ke`), em vez de Kc
constante igual a 1,0 — ver #11.

**Números medidos (célula de Goiânia −16,7/−49,3; solo θFC 0,28, θWP 0,12;
`pnpm msa:validate-preseason -- --cell -16.7,-49.3 --emergence <data> [--zr-mode zrIni]`):**

| Emergência | Modo de Zr | Kc 0,4 | Kc 0,7 | Kc 1,0 |
|---|---|---|---|---|
| 2025-11-01 | `zrMax` (0,95 m) → convertido para zrIni | 79,2 % | 88,1 % | **91,8 %** |
| 2025-11-01 | `zrIni` (0,30 m) | 80,2 % | 89,7 % | **92,8 %** |
| 2025-10-01 (safra do manual) | `zrMax` → convertido | 76,1 % | 84,1 % | **87,1 %** |
| 2025-10-01 (safra do manual) | `zrIni` | 63,5 % | 80,8 % | **90,3 %** |

(valores = depleção na emergência em % de TAW(zrIni) = 48 mm; chuva da
entressafra 309–333 mm contra ET₀ de 996–1.165 mm)

**Safra do manual** (emergência 2025-10-01, cultivar de referência com kcMid 1,10,
série real de Goiânia, Kc 1,0 na entressafra), motor 2.2.0:

| `PRE_SEASON_ZR_MODE` | Dr na emergência | Ks no 1º dia | Ks̄ de F1 | Redução F1 | Ks̄ F2 / F3 | Índice do ciclo |
|---|---|---|---|---|---|---|
| `zrMax` (padrão; é o do manual) | 41,8 mm (87 %) | 0,39 | **0,60** (crítico) | 7,9 % | 0,93 / 0,72 | 60,2 % |
| `zrIni` | 43,4 mm (90 %) | 0,33 | **0,56** (crítico) | 8,8 % | 0,92 / 0,71 | 58,8 % |

**Leitura:** com os dados reais, trocar o reservatório da entressafra **não
resolve** o F1 crítico — o modo `zrIni` esgota ainda mais depressa um
reservatório de 48 mm e chega à emergência com 90 % de depleção. Os 35,8 mm de
chuva dos 30 dias anteriores à emergência não repõem o perfil em nenhum dos
modos. O que domina é a estação seca (maio–setembro) somada à evaporação à taxa
plena de ETP (Kc 1,0): um solo seco coberto por palhada evapora muito menos que
isso (estágio 2 da evaporação, FAO-56). Portanto a alternativa (c) — reduzir a
evaporação do solo seco — tende a pesar mais que a (a); a alternativa (b) só
muda o resultado se a camada superficial for reabastecida por chuvas de
outubro maiores que as desta safra. O painel mostra para a safra do manual
"entrou na safra com 13 % da água disponível" e F1 em crítico; se a
pesquisadora considerar o valor irreal, o caminho é (c) + possivelmente (b).

**Onde:** `backend/src/modules/msa/engine/pre-season.ts` (`convertDepletion`),
`engine/water-balance.ts` (segmento `PRE`), `backend/src/config/pre-season.ts`
(`PRE_SEASON_ZR_MODE`), `backend/scripts/validation/preseason-validate.ts`,
`docs/msa/algoritmos.md` §5.

**Se mudar:** (a) é só `PRE_SEASON_ZR_MODE=zrIni` no `.env` + reprocessar; (b) e
(c) exigem nova `ENGINE_VERSION` (duas camadas ou Kc variável na entressafra),
teste e reprocessamento; o manual (cap. 06, cartão "Água no solo na
emergência") precisaria de nova captura.

---

## Registro de decisões

### 2026-11-09 — Balanço hídrico com entressafra (spin-up desde 1º de fevereiro)

**Decisão:** orientação do professor Adilson na reunião de 2026-11-02,
implementada na change `add-preseason-water-balance`. O balanço hídrico de
cada safra deixa de começar na emergência com o solo na capacidade de campo
(`initialDepletion = 0` em outubro/novembro, após meses de seca) e passa a
começar **no último 1º de fevereiro anterior à emergência**, com o solo cheio,
atravessando a entressafra sem cultura no padrão do balanço climatológico de
Thornthwaite & Mather (1955). A depleção na emergência vira um **resultado**
da run, e o painel informa "com quanta água o talhão entrou na safra".

**Consequências:**
- `ENGINE_VERSION` 2.1.0 → 2.2.0; runs antigas ficam no histórico com os
  campos da entressafra nulos e o painel sugere reprocessar; após o deploy,
  backfill ERA5 das células desde fevereiro e "Processar todas as safras
  ativas" (README raiz).
- Parâmetros **provisórios** por ambiente, gravados em cada run:
  `PRE_SEASON_KC = 1,0` e `PRE_SEASON_ZR_MODE = zrMax` (questão nº 11);
  regra da data fixa em 1º de fevereiro (questão nº 12). Ambas passam a
  "Implementado (provisório)", à espera de confirmação.
- Conversão da depleção na emergência por proporção
  (`Dr_ini = Dr_pre × TAW(zrIni)/TAW(zrPre)`) e uso do `p` da cultivar no Ks
  da entressafra — registrados como limitações em `algoritmos.md` §5.
- `phase = 'PRE'` fora das janelas F1–F4; `GET /msa/daily?includePreSeason=`;
  cobertura e backfill ao criar safra desde `preSeasonStart(emergência)`
  (≈ 8 meses a mais de ERA5-Land por célula nova); datas faltantes agrupadas
  por mês no painel.
- Caso 2 do protocolo de validação ganha a comparação da depleção na
  emergência com Thornthwaite-Mather em planilha e a sensibilidade ao Kc via
  `pnpm msa:validate-preseason` (0,4 / 0,7 / 1,0), descritiva, para a
  dissertação e para fechar a questão nº 11.
- Manual: cap. 05 ("por que a safra 'começa' em fevereiro") e cap. 06 (cartão
  "Água no solo na emergência", alternador "Mostrar entressafra").

### 2026-11-03 — Adoção do método de Ometto (1981) para graus-dia

**Decisão:** acordada na reunião de 2026-11-02 com o professor Adilson e
implementada na change `adopt-ometto-degree-days`. O motor passa a calcular os
graus-dia pelos cinco casos de Ometto, com temperatura-base inferior
(`tBase`, 10 °C) e superior (`tUpper`), em vez do método residual
`(Tmax + Tmin)/2 − Tb` (que é o caso 1 de Ometto). Referência bibliográfica e
fórmula ficam coerentes em `algoritmos.md` §1.

**Consequências:**
- `ENGINE_VERSION` 2.0.0 → 2.1.0; runs 2.0.0 ficam no histórico e o painel
  acusa "parâmetros da cultivar mudaram" (snapshot sem `tUpper`), sugerindo
  reprocessar; após o deploy, "Processar todas as safras ativas".
- 16º parâmetro de cultivar `tUpper` (opcional, > `tBase`, 15–50 °C);
  **TB = 30 °C provisório** na referência de soja e nas próprias (questão
  nº 10, aberta); campo no formulário de cultivar, com divergência e sync.
- Convenções: TB só atua com Tmax > TB; Tmin ≥ TB ⇒ teto TB − Tb; Tmax = Tmin
  sem divisão; resultado em [0, TB − Tb].
- Caso 5 do protocolo de validação (`validacao.md`) e script
  `pnpm msa:validate-gda` (residual × Ometto × Ometto com TB), descritivo, para
  a tabela da dissertação.
- Questões nº 11 (Kc/Zr da entressafra) e nº 12 (data de início do balanço)
  registradas para a change de balanço de entressafra.

### 2026-11-02 — Reunião com o professor Adilson (Meteorologia e Climatologia Agrícola)

**Decisão:** o objetivo do MSA passa a ser **predizer a produtividade da soja
frente à produtividade potencial (Ym) informada por safra**, com base no estresse
hídrico por janela fenológica, pela combinação multiplicativa do FAO-33
(índice do ciclo = Π_j [1 − Ky_j (1 − Ks̄_j)]; produtividade predita = Ym × índice).

**Consequências** (change `refocus-on-yield-prediction`):
- Monte Carlo, percentis P10/P50/P90, semente e parâmetros σP/σT **removidos**
  do motor, do schema, da API, do painel e da validação (Caso 3 do protocolo e
  Fase 3 do roteiro); o motor passa a 2.0.0, determinístico. Questão nº 1
  superada. A predição é um valor único, sem faixa de incerteza (limitação
  registrada em `algoritmos.md` §6).
- Cenários de decisão de adubação (a/b/c) e registro de decisões
  (`msa_decisions`) **removidos**; o sistema não recomenda nem registra
  decisão de manejo.
- Milho **removido**: soja é a única cultura da Fase 1.
- Ninguém digita parâmetros de cultivar do zero: **nova cultivar nasce sempre da
  referência tabelada**, com divergência visível campo a campo e ação
  "Atualizar a partir da referência". Questão nº 5 decidida (edição liberada).
- `Ym` informada por safra em sc/ha (`expectedYield`, teto de sanidade 250 —
  **a confirmar com a pesquisadora**); Caso 2 da validação passa a comparar a
  produtividade predita com a observada (erro relativo).
- OE5 da dissertação marcado como substituído em
  `docs/dissertacao/mapa-objetivos-evidencias.md`; a redação final do objetivo
  é da pesquisadora e do orientador.

**Próximas changes decorrentes da reunião:** graus-dia pelo método de Ometto
(`adopt-ometto-degree-days`, com `tUpper` na cultivar — feita em 2026-11-03,
ver entrada acima) e balanço hídrico de entressafra (questões nº 11 e 12).

---

## Como registrar a decisão

Para cada item decidido, abrir uma change no OpenSpec (`/opsx:propose`)
citando o número desta lista, para que a decisão, a justificativa e a alteração
de código fiquem rastreáveis no arquivo de changes. Decisões tomadas em reunião
entram também em "Registro de decisões", com data e consequências.
