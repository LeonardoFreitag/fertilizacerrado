# MSA — Questões Abertas para a Pesquisadora

> Decisões técnicas tomadas durante a implementação da Fase 1 que dependem de
> julgamento científico. Cada item indica o que foi implementado, a alternativa,
> onde está no código e o que muda se a decisão for revista.
>
> Fonte: seções "Open Questions" dos designs em `openspec/changes/archive/`.

| # | Tema | Status |
|---|---|---|
| 1 | Perturbação do Monte Carlo: sistemática × mista | Aguardando decisão |
| 2 | Agregação diária do ERA5-Land: dia UTC × dia local | Aguardando decisão |
| 3 | Fator de vento 0,748 (10 m → 2 m) | Aguardando decisão |
| 4 | Limiares de severidade do Ks (0,85 / 0,70) | Aguardando decisão |
| 5 | Parâmetros congelados de cultivar em uso | Aguardando decisão |
| 6 | Correção de viés (QM): defaults de distância, anos, limiar e cauda | Implementado com defaults; aguardando ajuste |
| 7 | Estação de referência para validação de ET₀ (Caso 1) | Decisão provisória: Goiânia |
| 8 | Talhões com múltiplos polígonos (MultiPolygon) | Baixa prioridade |
| 9 | CREA obrigatório para agrônomos | Não científica; decisão do produto |

---

## 1. Perturbação do Monte Carlo — sistemática × mista

**Implementado:** um único sorteio por iteração para o fator de precipitação
($f_i \sim \mathcal{N}(1;\ 0{,}30^2)$, truncado em ≥ 0) e um único para o
deslocamento térmico ($\delta_i \sim \mathcal{N}(0;\ 0{,}6^2)$ °C), aplicados a
toda a série da safra.

**Justificativa:** a incerteza relevante é o viés da reanálise e a variabilidade
interanual, ambos correlacionados no tempo. Ruído diário independente com
σ = 30 % se cancela em grande parte na soma de uma janela de 20–40 dias (o desvio
da soma cresce com √n enquanto a soma cresce com n), o que estreitaria
artificialmente o intervalo P10–P90.

**Alternativa:** variante mista — viés por iteração **mais** ruído diário
independente, com σ menores para cada componente.

**Onde:** `backend/src/modules/msa/engine/monte-carlo.ts`, `docs/msa/algoritmos.md` §7.

**Se mudar:** alteração local em `monte-carlo.ts`, sem efeito na API; exigiria
reprocessar as safras e incrementar `ENGINE_VERSION` (minor).

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

## 5. Parâmetros congelados de cultivar em uso

**Implementado:** uma cultivar com qualquer safra vinculada não aceita alteração
de parâmetros científicos (409 `CULTIVAR_IN_USE`); apenas nome e descrição.
Motivo original: reprodutibilidade dos resultados.

**Mudança de contexto:** desde `add-msa-processing`, cada run grava
`cultivarSnapshot` com os parâmetros efetivamente usados. A reprodutibilidade de
runs passadas já não depende do registro da cultivar.

**Alternativa:** liberar a edição; runs novas usam os novos valores, runs antigas
permanecem reproduzíveis pelo snapshot. O painel poderia indicar "parâmetros da
cultivar mudaram desde esta run".

**Onde:** `backend/src/modules/cultivars/cultivar.service.ts`.

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

## Como registrar a decisão

Para cada item decidido, abrir uma change no OpenSpec (`/opsx:propose`)
citando o número desta lista, para que a decisão, a justificativa e a alteração
de código fiquem rastreáveis no arquivo de changes.
