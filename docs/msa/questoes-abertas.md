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
| 11 | Kc e Zr na entressafra (balanço a partir de fevereiro) | Registrada na reunião; decidir na change de entressafra |
| 12 | Regra da data de início do balanço hídrico | Registrada na reunião; decidir na change de entressafra |

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

**Decorrente da reunião com o professor Adilson (2026-11-02)**; a decidir na
change seguinte (balanço hídrico de entressafra).

**Implementado hoje:** o balanço começa na emergência da safra com depleção
inicial configurável (padrão 0 = capacidade de campo) e usa Kc e Zr da cultivar
por janela fenológica; não há cálculo fora do ciclo da soja.

**Questão:** ao estender o balanço para a entressafra (de fevereiro, após a
colheita, até a emergência seguinte), que Kc e Zr usar para o solo em pousio ou
com cobertura/segunda safra: Kc de solo nu com palhada (plantio direto), Kc de
cobertura, ou um Kc de entressafra calibrado; e qual Zr efetiva considerar sem
cultura. A resposta determina a depleção inicial real da safra seguinte, hoje
assumida 0. O enunciado (data de fevereiro, opções de Kc/Zr) é a nossa leitura
do briefing da reunião, sem fonte bibliográfica conferida — a confirmar com o
professor Adilson / a pesquisadora antes da change de entressafra.

**Onde (futuro):** `engine/kc.ts`, `engine/water-balance.ts`
(`initialDepletion`), `CultivarParams` ou parâmetros de talhão.

**Se mudar:** nova `ENGINE_VERSION`; a depleção inicial deixa de ser 0 por
padrão; reprocessar as safras.

---

## 12. Regra da data de início do balanço hídrico

**Decorrente da reunião com o professor Adilson (2026-11-02)**; a decidir na
change seguinte (balanço hídrico de entressafra), junto com o item 11.

**Implementado hoje:** o balanço começa na **data de emergência** informada na
safra, com o solo na capacidade de campo.

**Questão:** fixar a regra da data de início do balanço contínuo: data fixa
(ex.: 1º de fevereiro, após a colheita da safra anterior), data da colheita
anterior registrada, início do período chuvoso (critério de chuva acumulada),
ou um número de dias/meses antes da emergência. A regra precisa funcionar
também para a primeira safra de um talhão (sem histórico) e para safrinha. As
opções listadas e a data de 1º de fevereiro vieram do briefing da reunião, sem
fonte conferida — a confirmar com o professor Adilson / a pesquisadora.

**Onde (futuro):** `msa.service.ts` (`resolveInterval`), cadastro da safra
(`docs/modulos/msa.md` §2), `docs/msa/algoritmos.md` §5.

**Se mudar:** a run passa a cobrir um intervalo maior; exige série ERA5-Land da
entressafra (backfill) e reprocessamento.

---

## Registro de decisões

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
