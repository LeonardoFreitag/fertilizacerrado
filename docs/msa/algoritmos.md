# MSA — Algoritmos e Fórmulas Matemáticas

> **Audiência:** Heb Rejane Moreira Pires (pesquisadora), orientadores, banca avaliadora.  
> **Objetivo:** Rastreabilidade completa entre as equações descritas na dissertação e o código TypeScript implementado.

> **Onde está o código:** o motor de cálculo é a biblioteca de funções puras `backend/src/modules/msa/engine/` (sem banco, API ou ERA5-Land), exportada por `engine/index.ts`. Cada função tem JSDoc com a fonte e o número da equação. Os tipos (`CultivarParams`, `SoilParams`, `DailyWeather`, `DailyBalanceRow`, `PhaseSummary`, `CycleYield`) estão em `engine/types.ts`. As seções 1 a 6 estão implementadas no motor (`ENGINE_VERSION` 2.1.0 — graus-dia pelo método de Ometto desde 2026-11-03; determinístico: uma execução do balanço por run); a persistência dos resultados, a fila de jobs e os endpoints estão descritos em `docs/modulos/msa.md`.

> **Escopo (desde 2026-11-02):** o MSA prediz a produtividade da soja frente à produtividade potencial informada por safra. O módulo de Monte Carlo (antiga seção 7) e os cenários de decisão de adubação (antiga seção 8) foram removidos — ver `docs/msa/questoes-abertas.md`, registro da reunião com o professor Adilson.

---

## 1. Graus-Dia Acumulados (GDA) — método de Ometto (1981)

### Conceito
O método dos graus-dia quantifica o desenvolvimento fenológico da cultura pelo acúmulo diário de calor útil ao crescimento, eliminando a dependência do calendário. O motor adota o método de **Ometto (1981)**, que delimita o calor útil por **duas** temperaturas-base da cultura:

- $T_b$ — **temperatura-base inferior** (`tBase`): abaixo dela a planta não se desenvolve. Soja: **10 °C**.
- $T_B$ — **temperatura-base superior** (`tUpper`, opcional): acima dela o calor adicional **não** acelera o desenvolvimento. Soja: **30 °C**, valor provisório (`docs/msa/questoes-abertas.md`, questão nº 10).

Ometto aproxima a marcha diária da temperatura por um triângulo entre $T_{min}$ e $T_{max}$ e toma como graus-dia a parte desse triângulo compreendida entre $T_b$ e $T_B$. Conforme a posição do dia em relação às duas bases, resultam cinco situações: dia inteiro dentro das bases; dia que cruza $T_b$; dia frio; dia que cruza $T_B$; dia que cruza as duas.

### Equações

Com $T_{max,d}$ e $T_{min,d}$ as temperaturas máxima e mínima do dia *d* (°C), o GDA do dia é:

**Caso 1 — $T_b < T_{min} \le T_{max}$ (dia dentro das bases):**

$$GDA_d = \frac{T_{max} - T_{min}}{2} + (T_{min} - T_b)$$

**Caso 2 — $T_{min} < T_b < T_{max}$ (mínima abaixo da base inferior):**

$$GDA_d = \frac{(T_{max} - T_b)^2}{2\,(T_{max} - T_{min})}$$

**Caso 3 — $T_b \ge T_{max}$ (dia frio):**

$$GDA_d = 0$$

**Caso 4 — $T_b < T_{min} \le T_B < T_{max}$ (máxima acima da base superior):**

$$GDA_d = \frac{2\,(T_{max} - T_{min})(T_{min} - T_b) + (T_{max} - T_{min})^2 - (T_{max} - T_B)^2}{2\,(T_{max} - T_{min})}$$

**Caso 5 — $T_{min} < T_b < T_B < T_{max}$ (mínima abaixo de $T_b$ e máxima acima de $T_B$):**

$$GDA_d = \frac{1}{2} \cdot \frac{(T_{max} - T_b)^2 - (T_{max} - T_B)^2}{T_{max} - T_{min}}$$

**Acumulado desde a emergência:**

$$GDA_{acum}(D) = \sum_{d=1}^{D} GDA_d$$

**Onde:**
- $T_{max,d}$ = temperatura máxima do dia *d* (°C), fonte ERA5-Land (`2m_temperature_max`)
- $T_{min,d}$ = temperatura mínima do dia *d* (°C), fonte ERA5-Land (`2m_temperature_min`)
- $T_b$ = temperatura-base inferior da cultivar (`tBase`; soja: 10 °C; única cultura da Fase 1)
- $T_B$ = temperatura-base superior da cultivar (`tUpper`; soja: 30 °C, provisório; nula = sem base superior)
- $GDA_{acum}$ = graus-dia acumulados desde a data de emergência

### Convenções adotadas no motor

- **Sem $T_B$** (`tUpper` nulo ou omitido): só os casos 1–3; o resultado fica em $[0, +\infty)$.
- **$T_B$ só atua quando $T_{max} > T_B$.** Com $T_{max} = T_B$ os casos 4 e 5 coincidem algebricamente com 1 e 2; da mesma forma, com $T_{min} = T_b$ os casos 1 e 2 coincidem. Os ramos são contínuos nas bordas (testado com tolerância 1e-9).
- **$T_{min} \ge T_B$** (dia inteiro acima da base superior, possível em ondas de calor): $GDA_d = T_B - T_b$, o **teto** do método. A situação não está na formulação original; a convenção está registrada na questão nº 10 para confirmação da pesquisadora.
- **$T_{max} = T_{min}$:** não há divisão por zero — o dia cai no caso 1 (se $T_{min} > T_b$) ou no caso 3 ($T_b \ge T_{max}$); os casos 2, 4 e 5 exigem $T_{max} > T_{min}$ por construção.
- **Faixa do resultado:** $0 \le GDA_d \le T_B - T_b$ com $T_B$; $GDA_d \ge 0$ sem $T_B$. O motor aplica o truncamento final e os testes de invariantes o verificam com `tUpper` aleatório.
- **Entradas inválidas** — $T_{max} < T_{min}$, valores não finitos ou $T_B \le T_b$ — lançam `RangeError`: indicam erro a montante (série climática ou cultivar), não um resultado.

### Exemplo numérico (soja: $T_b$ = 10 °C, $T_B$ = 30 °C)

| Dia ($T_{max}$ / $T_{min}$) | Caso | Cálculo | $GDA_d$ (°C·dia) | Residual $(T_{max}+T_{min})/2 - T_b$ |
|---|---|---|---|---|
| 28 / 18 | 1 | (28 − 18)/2 + (18 − 10) | **13,00** | 13,00 |
| 20 / 6 | 2 | (20 − 10)² / [2 (20 − 6)] = 100 / 28 | **3,571** | 3,00 |
| 8 / 2 | 3 | — | **0** | 0 (−5, truncado) |
| 34 / 20 | 4 | [2 · 14 · 10 + 14² − 4²] / (2 · 14) = 460 / 28 | **16,43** | 17,00 |
| 34 / 8 | 5 | ½ (24² − 4²) / 26 = 280 / 26 | **10,77** | 11,00 |
| 32 / 31 | teto ($T_{min} \ge T_B$) | 30 − 10 | **20,00** | 21,50 |
| 25 / 25 | 1 ($T_{max} = T_{min}$) | 0 + (25 − 10) | **15,00** | 15,00 |

Acumulado de três dias (34/20), (28/18), (34/8): 16,43 → 29,43 → 40,20 °C·dia.

Leitura do caso 4, o mais frequente no Cerrado: num dia de 34/20 °C, típico de setembro a novembro, o método residual conta 17 °C·dia; Ometto com $T_B$ = 30 °C conta 16,43 — os 4 °C acima da base superior não aceleram o desenvolvimento. Nas janelas da soja, $T_{min}$ raramente cai abaixo de $T_b$ (casos 2 e 5 são raros); o efeito relevante vem dos dias com $T_{max} > T_B$, que, somado ao longo da safra, **adia** as transições F2–F4 em relação ao calendário do motor 2.0.0. O deslocamento é quantificado no Caso 5 de `docs/msa/validacao.md` (`pnpm msa:validate-gda`).

### Nota sobre o motor ≤ 2.0.0 (método residual)

Até `ENGINE_VERSION` 2.0.0 o motor calculava

$$GDA_d = \max\left(\frac{T_{max} + T_{min}}{2} - T_b,\ 0\right)$$

embora já citasse Ometto (1981) como fonte. Esse método residual é exatamente o **caso 1** de Ometto — basta rearranjar: $(T_{max} - T_{min})/2 + (T_{min} - T_b) = (T_{max} + T_{min})/2 - T_b$. Os dois motores coincidem sempre que $T_{min} \ge T_b$ e $T_{max} \le T_B$ (ou sem $T_B$) e diferem nos dias que cruzam uma das bases. Runs com `engineVersion` 2.0.0 permanecem no histórico (o `cultivarSnapshot` delas não tem `tUpper`), e o painel acusa "parâmetros da cultivar mudaram desde esta execução", sugerindo reprocessar.

### Referência bibliográfica
> OMETTO, J.C. (1981). *Bioclimatologia vegetal*. São Paulo: Editora Agronômica Ceres. — método das temperaturas-base inferior e superior, cinco situações.

### Implementação
`src/modules/msa/engine/gda.ts`:

| Função | O que calcula |
|---|---|
| `dailyGDA(tmax, tmin, tBase, tUpper?)` | $GDA_d$ pelos cinco casos e convenções acima; `tUpper` nulo ou omitido = sem base superior |
| `accumulateGDA(series, tBase, tUpper?)` | $GDA_{acum}$ dia a dia, série do mesmo tamanho da entrada |

Chamadores: `runDailyBalance` (`engine/water-balance.ts`, passo 1 de cada dia, com `cultivar.tUpper ?? null`) e `resolveInterval` (`src/modules/msa/msa.service.ts`), que percorre a série desde a emergência até atingir `gdaTotal` para fixar o intervalo da run. Testes: `gda-phenology-kc.test.ts` (os sete cenários da tabela; bordas $T_{min} = T_b$, $T_{max} = T_B$, $T_{max} = T_{min}$, $T_{min} \ge T_B$; continuidade; regressão com o residual sem $T_B$; entradas inválidas) e `invariants.test.ts` ($0 \le GDA_d \le T_B - T_b$ com `tUpper` nulo ou aleatório).

---

## 2. Determinação da Janela Fenológica

Após calcular $GDA_{acum}$ diário, o sistema compara com os limiares da cultivar:

| Janela | Intervalo GDA (soja padrão Cerrado) | Coeficiente Ky |
|---|---|---|
| F1 — Germinação/Emergência | 0 – 120 °C·dia | 0,20 |
| F2 — Crescimento vegetativo | 120 – 450 °C·dia | 0,80 |
| F3 — Floração/Enchimento | 450 – 900 °C·dia | 1,00 |
| F4 — Maturação | 900 – 1.200 °C·dia | 0,40 |

> Os limiares são parametrizados por cultivar no banco de dados; os valores acima são a referência para soja convencional.

**Convenção adotada no motor:** a janela do dia *d* é determinada pelo GDA acumulado **ao fim** do dia *d* (inclui o GDA do próprio dia), com limite inferior inclusivo: F1 se GDA < `gdaF1End`; F2 se `gdaF1End` ≤ GDA < `gdaF2End`; F3 se `gdaF2End` ≤ GDA < `gdaF3End`; F4 se `gdaF3End` ≤ GDA < `gdaTotal`; `COMPLETED` se GDA ≥ `gdaTotal`.

**Profundidade radicular (Zr):** linear de `zrIni` (GDA 0) a `zrMax` no início de F3 (GDA = `gdaF2End`), constante depois; nunca decresce.

### Implementação
`src/modules/msa/engine/phenology.ts` → `phaseFromGDA(gdaAccum, cultivar)` e `rootDepth(gdaAccum, cultivar)`

---

## 3. Evapotranspiração de Referência (ET₀) — FAO-56 Penman-Monteith

### Equação padrão FAO-56

$$ET_0 = \frac{0{,}408 \cdot \Delta \cdot (R_n - G) + \gamma \cdot \dfrac{900}{T + 273} \cdot u_2 \cdot (e_s - e_a)}{\Delta + \gamma \cdot (1 + 0{,}34 \cdot u_2)}$$

**Parâmetros:**

| Símbolo | Descrição | Fonte ERA5-Land |
|---|---|---|
| $ET_0$ | Evapotranspiração de referência (mm/dia) | — calculado |
| $\Delta$ | Declividade da curva de pressão de vapor saturado (kPa/°C) | calculado de $T_{med}$ |
| $R_n$ | Saldo de radiação líquida à superfície (MJ/m²/dia) | `surface_net_solar_radiation` |
| $G$ | Fluxo de calor no solo (MJ/m²/dia) | ≈ 0 para passo diário |
| $\gamma$ | Constante psicrométrica (kPa/°C) | função da altitude |
| $T$ | Temperatura média diária do ar (°C) | `2m_temperature` |
| $u_2$ | Velocidade do vento a 2 m de altura (m/s) | `10m_u/v_wind` → ajuste log |
| $e_s$ | Pressão de vapor saturado (kPa) | calculado de $T_{max}$ e $T_{min}$ |
| $e_a$ | Pressão de vapor atual (kPa) | `2m_dewpoint_temperature` |

### Equações auxiliares

**Pressão de vapor saturado:**
$$e_s = \frac{e^0(T_{max}) + e^0(T_{min})}{2}, \quad e^0(T) = 0{,}6108 \cdot \exp\!\left(\frac{17{,}27 \cdot T}{T + 237{,}3}\right)$$

**Declividade da curva de pressão de vapor:**
$$\Delta = \frac{4098 \cdot \left[0{,}6108 \cdot \exp\!\left(\dfrac{17{,}27 \cdot T_{med}}{T_{med} + 237{,}3}\right)\right]}{(T_{med} + 237{,}3)^2}$$

**Ajuste de velocidade do vento de 10 m para 2 m:**
$$u_2 = u_{10} \cdot \frac{\ln(2/z_0)}{\ln(10/z_0)}, \quad z_0 = 0{,}1 \text{ m (culturas rasteiras)}$$

Simplificado: $u_2 = u_{10} \times 0{,}748$

**Constante psicrométrica:**
$$\gamma = 0{,}000665 \cdot P_{atm}, \quad P_{atm} = 101{,}3 \cdot \left(\frac{293 - 0{,}0065 \cdot z}{293}\right)^{5{,}26}$$

### Referência bibliográfica
> ALLEN, R.G.; PEREIRA, L.S.; RAES, D.; SMITH, M. (1998). *Crop evapotranspiration: Guidelines for computing crop water requirements*. FAO Irrigation and Drainage Paper No. 56. Rome: FAO. Capítulo 2, Equação 6.

### Implementação
`src/modules/msa/engine/et0.ts` → `referenceET0({ tmax, tmin, tmean?, tdew, u2, rn, altitude })` (Eq. 6, G = 0 pela Eq. 42) e `referenceET0Detailed(...)` (devolve Δ, γ, es, ea, P). Auxiliares exportadas separadamente, cada uma com o número da equação do FAO-56:

| Função | Eq. FAO-56 |
|---|---|
| `atmosphericPressure(altitude)` | 7 |
| `psychrometricConstant(P)` | 8 |
| `saturationVapourPressure(T)` | 11 |
| `meanSaturationVapourPressure(tmax, tmin)` | 12 |
| `slopeVapourPressureCurve(tmean)` | 13 |
| `actualVapourPressureFromDewpoint(tdew)` | 14 |
| `actualVapourPressureFromPsychrometer(tdry, twet, P, aPsy)` | 15, 16 |
| `actualVapourPressureFromRH(tmax, tmin, rhMax, rhMin)` | 17 |
| `actualVapourPressureFromMeanRH(tmax, tmin, rhMean)` | 19 |
| `dewpointFromVapourPressure(ea)` | inversa algébrica da 11/14 |
| `extraterrestrialRadiation(lat, doy)` | 21–25 |
| `daylightHours(lat, doy)` | 34 |
| `solarRadiationFromSunshine(n, N, Ra)` | 35 |
| `clearSkyRadiation(Ra, altitude)` | 37 |
| `netShortwaveRadiation(Rs)` | 38 |
| `netLongwaveRadiation(tmax, tmin, ea, Rs, Rso)` | 39 |
| `netRadiationFromSolar(rs, tmax, tmin, ea, lat, doy, altitude)` | 37–40 |
| `windSpeedAt2m(uz, z = 10)` | 47 (fator 0,748 para z = 10 m) |

Os testes (`et0.test.ts`) reproduzem os Exemplos 2, 3, 4, 5, 17 (Bangkok, ET₀ 5,72) e 18 (Bruxelas, ET₀ 3,9) do FAO-56, conferindo cada intermediário impresso no livro.

---

## 4. Evapotranspiração da Cultura (ETc)

$$ETc = Kc \cdot ET_0$$

**Coeficiente de cultura $Kc$ por fase (soja plantio direto, Cerrado):**

| Fase | Kc | Referência |
|---|---|---|
| F1 — Inicial | 0,20 | Allen et al. (1998), Tabela 12 + ajuste plantio direto |
| F2 — Desenvolvimento | interpolado linealmente de 0,20 → 1,15 | |
| F3 — Médio | 1,15 | |
| F4 — Final | interpolado linealmente de 1,15 → 0,50 | |

> O Kc_ini reduzido (0,20 em vez de 0,40) reflete a condição de cobertura morta do plantio direto predominante no Cerrado.

### Referência bibliográfica
> ALLEN et al. (1998), Tabela 12.  
> EMBRAPA SOJA (2020). *Tecnologias de Produção de Soja*. Londrina: Embrapa Soja.

### Implementação
`src/modules/msa/engine/kc.ts` → `kcForPhase(phase, gdaAccum, cultivar)`. A interpolação de F2 (`kcIni` → `kcMid`) e de F4 (`kcMid` → `kcEnd`) é feita em GDA, não em dias, e é contínua nas quatro transições; após o ciclo (`COMPLETED`) vale `kcEnd`.

---

## 5. Balanço Hídrico Diário (Solo)

### Modelo FAO-56 de depleção da zona radicular

$$Dr_d = Dr_{d-1} - (P_d - RO_d) - I_d - CR_d + ETc_{adj,d} + DP_d$$

Para o modelo simplificado adotado (sem irrigação, sem ascensão capilar, sem escoamento superficial explícito):

$$Dr_d = \max\left(Dr_{d-1} - P_d + ETc_{adj,d},\ 0\right) \leq TAW$$

**Parâmetros:**

| Símbolo | Descrição |
|---|---|
| $Dr_d$ | Depleção da água na zona radicular no final do dia *d* (mm) |
| $P_d$ | Precipitação ERA5-Land do dia *d* (mm) |
| $ETc_{adj,d}$ | ETc ajustada pelo coeficiente de estresse hídrico |
| $TAW$ | Total de água disponível na zona radicular (mm) |
| $RAW$ | Água prontamente disponível = $p \times TAW$ (mm) |

**Total de água disponível:**
$$TAW = 1000 \cdot (\theta_{FC} - \theta_{WP}) \cdot Zr$$

**Água prontamente disponível:**
$$RAW = p \cdot TAW$$

**Onde:** $p$ = fração de depleção permitida sem estresse = **0,50** (soja)

### Coeficiente de estresse hídrico (Ks)

$$Ks = \begin{cases} 1 & \text{se } Dr_d \leq RAW \\ \dfrac{TAW - Dr_d}{TAW - RAW} & \text{se } RAW < Dr_d \leq TAW \\ 0 & \text{se } Dr_d > TAW \end{cases}$$

$$ETc_{adj} = Ks \cdot ETc$$

**Valores de solo típicos adotados para o Latossolo Vermelho do Cerrado:**

| Parâmetro | Valor |
|---|---|
| $\theta_{FC}$ (capacidade de campo) | 0,28 m³/m³ |
| $\theta_{WP}$ (ponto de murcha) | 0,12 m³/m³ |
| Profundidade radicular Zr (soja) | 0,30 m (F1) → 0,95 m (F3/F4) |

> Os parâmetros de solo são editáveis por talhão com base no laudo físico-hídrico do laboratório.

### Referência bibliográfica
> ALLEN et al. (1998), Capítulo 8 — *Water stress coefficient, Ks*. Equações 84, 87, 82.  
> DOORENBOS, J.; PRUITT, W.O. (1977). *Guidelines for predicting crop water requirements*. FAO Paper No. 24.

**Semântica do passo diário adotada no motor:** para cada dia, (1) GDA do dia e acumulado → fase, Zr e Kc; (2) TAW e RAW pelo Zr do dia — ao aprofundar a raiz, TAW cresce e a depleção **não** é alterada; (3) Ks com a depleção do **início** do dia; ET₀, ETc = Kc·ET₀, ETc_adj = Ks·ETc; (4) Dr_d = clamp(Dr_{d−1} − P_d + ETc_adj, 0, TAW) — chuva acima da depleção zera Dr (excedente = percolação). Depleção inicial configurável (padrão 0 = capacidade de campo).

### Implementação
`src/modules/msa/engine/water-balance.ts` → `totalAvailableWater(thetaFC, thetaWP, zr)` (Eq. 82), `readilyAvailableWater(p, taw)` (Eq. 83), `stressCoefficient(dr, taw, raw)` (Eq. 84) e `runDailyBalance(days, cultivar, soil, { altitude, initialDepletion })`, que devolve por dia `{ date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw }`. Determinístico e sem alocação intermediária; executado uma vez por run.

---

## 6. Redução de Produtividade por Estresse Hídrico e Predição de Produtividade

### 6.1 Redução por janela fenológica

Equação 3.2 do FAO-33 (resposta da produtividade à água):

$$1 - \frac{Y_a}{Y_m} = Ky \cdot \left(1 - \frac{ET_a}{ET_m}\right)$$

Simplificando para uso por janela fenológica, com $ET_a/ET_m \approx \overline{Ks}_j$ (pois $ETc_{adj} = Ks \cdot ETc$, §5):

$$RY_j = Ky_j \cdot (1 - \overline{Ks}_j)$$

**Onde:**
- $Y_a$ = produtividade real (atual) da cultura
- $Y_m$ = produtividade máxima (potencial) da cultura, sem restrição hídrica
- $RY_j$ = redução relativa de produtividade na janela $j$ (decimal, 0–1)
- $Ky_j$ = coeficiente de sensibilidade ao estresse da janela $j$ (tabela da §2)
- $\overline{Ks}_j$ = Ks médio dos dias da janela $j$

### 6.2 Índice de produtividade do ciclo (combinação das janelas)

Para déficits hídricos em estádios sucessivos, o FAO-33 combina as reduções de cada estádio de forma **multiplicativa**: a produtividade relativa do ciclo é o produto das produtividades relativas das janelas.

$$\frac{Y_a}{Y_m} = \prod_{j=1}^{4} \left[1 - Ky_j \cdot (1 - \overline{Ks}_j)\right] = \prod_{j=1}^{4} (1 - RY_j)$$

O resultado é o **índice de produtividade do ciclo** (`yieldIndex`, adimensional, 0–1). O fator de cada janela, $1 - RY_j$, vale 1 quando não houve estresse ($\overline{Ks}_j = 1$) e decresce com o estresse ponderado pela sensibilidade $Ky_j$.

### 6.3 Produtividade predita

$$Y_a = Y_m \times \frac{Y_a}{Y_m} = Y_m \times \text{índice do ciclo}$$

**Convenções adotadas no motor:**

- **$Y_m$ é informada por safra** pelo agrônomo (campo `expectedYield`, sc/ha, > 0 e ≤ 250 como teto de sanidade). A run grava o valor vigente no momento do processamento; alterar a $Y_m$ da safra depois **não** recalcula a run — para refletir o novo valor, reprocessa-se a safra. Sem $Y_m$, a run grava o índice do ciclo e a produtividade predita fica nula.
- **Janela não alcançada conta como fator 1.** Uma janela sem dias (a safra ainda não chegou nela) entra no produto com $1 - RY_j = 1$, isto é, a predição **considera o restante do ciclo sem estresse**. O número de janelas com dias é `phasesReached` (0–4); enquanto `phasesReached < 4` (ou a última janela ainda não terminou), a predição é parcial e o painel avisa. Como as janelas são contíguas, `phasesReached` é também o índice da última janela alcançada.
- **Predição retrospectiva e semanal.** O índice é recalculado a cada processamento (lote semanal do ERA5-Land, lag de ~5 dias) e só muda quando novas janelas são alcançadas ou quando o Ks̄ de uma janela em curso se atualiza.
- **Sem faixa de incerteza (limitação).** A produtividade predita é um **valor único**: o motor não propaga a incerteza climática nem a do modelo. A avaliação de uma faixa de incerteza (por exemplo, por perturbação da série ou por ensemble) fica para trabalho futuro; nas safras históricas, o erro relativo predita × observada (`validacao.md`, Caso 2) é a medida disponível da qualidade da predição.
- **Fatores truncados em [0, 1]** e `RangeError` para $Y_m \le 0$ ou índice fora de [0, 1] — entradas assim indicam erro a montante, não um resultado.

### 6.4 Exemplo numérico

Safra com F1 e F4 sem estresse, F2 com $\overline{Ks} = 0{,}90$ ($Ky = 0{,}8$) e F3 com $\overline{Ks} = 0{,}80$ ($Ky = 1{,}0$), $Y_m = 65$ sc/ha:

| Janela | $\overline{Ks}_j$ | $Ky_j$ | $RY_j = Ky_j (1 - \overline{Ks}_j)$ | Fator $1 - RY_j$ |
|---|---|---|---|---|
| F1 | 1,00 | 0,20 | 0,00 | 1,00 |
| F2 | 0,90 | 0,80 | 0,08 | 0,92 |
| F3 | 0,80 | 1,00 | 0,20 | 0,80 |
| F4 | 1,00 | 0,40 | 0,00 | 1,00 |

$$\text{índice do ciclo} = 1{,}00 \times 0{,}92 \times 0{,}80 \times 1{,}00 = 0{,}736$$

$$Y_a = 65 \times 0{,}736 = 47{,}84\ \text{sc/ha}$$

Se a mesma safra estivesse ainda em F3 (`phasesReached = 3`), F4 entraria com fator 1 e o resultado seria o mesmo 47,84 sc/ha, marcado como predição parcial.

### Referência bibliográfica
> DOORENBOS, J.; KASSAM, A.H. (1979). *Yield response to water*. FAO Irrigation and Drainage Paper No. 33. Rome: FAO. Equação 3.2 (redução por estádio) e combinação multiplicativa para déficits em estádios sucessivos (Capítulo 3, *Yield response to water deficit in successive growth periods*).

### Implementação
`src/modules/msa/engine/yield.ts`:

| Função | O que calcula |
|---|---|
| `yieldReduction(ksMean, ky)` | $RY_j$, truncado em [0, 1] (§6.1) |
| `summarizeByPhase(series, cultivar)` | resumo F1–F4 `{ days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct }`; janela não alcançada: `days = 0`, `ksMean` e `yieldReductionPct` nulos |
| `cycleYieldIndex(summaries)` | `{ yieldIndex, phasesReached, factors }` — `factors[j] = 1 − yieldReductionPct_j / 100` nas janelas com dias, 1 nas demais; `yieldIndex = Π factors` (§6.2) |
| `predictedYield(ym, yieldIndex)` | $Y_m \times$ índice, na unidade de $Y_m$ (§6.3) |

O serviço (`src/modules/msa/msa.service.ts`, `runProcessing` → `yieldFields(cycle, expectedYield)`) chama `runDailyBalance` + `summarizeByPhase` + `cycleYieldIndex` uma vez por run e grava em `msa_runs` os campos `expectedYield` (snapshot da safra), `yieldIndex`, `phasesReached` e `predictedYield` (nulo sem $Y_m$). Os testes (`yield.test.ts`) cobrem os casos da especificação: índice 1 sem estresse; F3 0,70/Ky 1,0 → 0,70; o exemplo da §6.4 (0,736 e 47,84 sc/ha); janela não alcançada → fator 1 e `phasesReached` menor que 4; `invariants.test.ts` garante $0 \le$ `yieldIndex` $\le 1$.

---

## Glossário de Símbolos

| Símbolo | Descrição | Unidade |
|---|---|---|
| $ET_0$ | Evapotranspiração de referência | mm/dia |
| $ETc$ | Evapotranspiração da cultura | mm/dia |
| $ETc_{adj}$ | ETc ajustada pelo estresse hídrico | mm/dia |
| $Kc$ | Coeficiente de cultura | adimensional |
| $Ks$ | Coeficiente de estresse hídrico | 0–1 |
| $Ky$ | Coeficiente de sensibilidade ao estresse | adimensional |
| $RY_j$ | Redução relativa de produtividade na janela $j$ = $Ky_j (1 - \overline{Ks}_j)$ | 0–1 |
| $GDA$ | Graus-dia acumulados (método de Ometto, 1981 — §1) | °C·dia |
| $T_b$ | Temperatura-base inferior da cultivar (`tBase`; soja 10 °C) | °C |
| $T_B$ | Temperatura-base superior da cultivar (`tUpper`, opcional; soja 30 °C, provisório — questão nº 10); acima dela o dia não acumula calor adicional (Ometto) | °C |
| $TAW$ | Total de água disponível | mm |
| $RAW$ | Água prontamente disponível | mm |
| $Dr$ | Depleção na zona radicular | mm |
| $Zr$ | Profundidade efetiva da zona radicular | m |
| $p$ | Fração de depleção permitida sem estresse | 0–1 |
| $\theta_{FC}$ | Umidade volumétrica na capacidade de campo | m³/m³ |
| $\theta_{WP}$ | Umidade volumétrica no ponto de murcha | m³/m³ |
| $Y_m$ | Produtividade potencial (máxima) da safra, informada pelo agrônomo (`expectedYield`) | sc/ha |
| $Y_a$ | Produtividade predita = $Y_m \times$ índice do ciclo (`predictedYield`) | sc/ha |
| índice do ciclo | $Y_a/Y_m = \prod_j (1 - RY_j)$ (`yieldIndex`) | 0–1 |
| `phasesReached` | Número de janelas fenológicas alcançadas (com dias) na run | 0–4 |
| $R_n$ | Saldo de radiação líquida | MJ/m²/dia |
| $u_2$ | Velocidade do vento a 2 m | m/s |
| $e_s$ | Pressão de vapor saturado | kPa |
| $e_a$ | Pressão de vapor atual | kPa |
| $\Delta$ | Declividade da curva de pressão de vapor | kPa/°C |
| $\gamma$ | Constante psicrométrica | kPa/°C |
