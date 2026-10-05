# MSA — Algoritmos e Fórmulas Matemáticas

> **Audiência:** Heb Rejane Moreira Pires (pesquisadora), orientadores, banca avaliadora.  
> **Objetivo:** Rastreabilidade completa entre as equações descritas na dissertação e o código TypeScript implementado.

> **Onde está o código:** o motor de cálculo é a biblioteca de funções puras `backend/src/modules/msa/engine/` (sem banco, API ou ERA5-Land), exportada por `engine/index.ts`. Cada função tem JSDoc com a fonte e o número da equação. Os tipos (`CultivarParams`, `SoilParams`, `DailyWeather`, `DailyBalanceRow`, `PhaseSummary`, `MonteCarloResult`, `DecisionScenarios`) estão em `engine/types.ts`. As seções 1 a 8 estão implementadas; a persistência dos resultados, a fila de jobs e os endpoints ainda não.

---

## 1. Graus-Dia Acumulados (GDA)

### Conceito
O método dos graus-dia quantifica o desenvolvimento fenológico da cultura com base no acúmulo de calor diário acima de uma temperatura-base (T_base), eliminando a dependência do calendário.

### Equação

$$GDA_d = \max\left(\frac{T_{max,d} + T_{min,d}}{2} - T_{base},\ 0\right)$$

$$GDA_{acum} = \sum_{d=1}^{D} GDA_d$$

**Onde:**
- $T_{max,d}$ = temperatura máxima do dia *d* (°C), fonte ERA5-Land (`2m_temperature_max`)
- $T_{min,d}$ = temperatura mínima do dia *d* (°C), fonte ERA5-Land (`2m_temperature_min`)
- $T_{base}$ = temperatura-base da cultura (soja: **10°C**; milho: **10°C**)
- $GDA_{acum}$ = graus-dia acumulados desde a data de emergência

### Referência bibliográfica
> OMETO, J.C. (1981). *Bioclimatologia vegetal*. São Paulo: Editora Agronômica Ceres.

### Implementação
`src/modules/msa/engine/gda.ts` → `dailyGDA(tmax, tmin, tBase)` e `accumulateGDA(series, tBase)`

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
`src/modules/msa/engine/water-balance.ts` → `totalAvailableWater(thetaFC, thetaWP, zr)` (Eq. 82), `readilyAvailableWater(p, taw)` (Eq. 83), `stressCoefficient(dr, taw, raw)` (Eq. 84) e `runDailyBalance(days, cultivar, soil, { altitude, initialDepletion })`, que devolve por dia `{ date, phase, gda, gdaAccum, zr, et0, kc, etc, precipitation, dr, ks, etcAdj, taw, raw }`. Determinístico e sem alocação intermediária (projetado para as 1.000 iterações do Monte Carlo).

---

## 6. Redução de Produtividade por Estresse Hídrico

$$\frac{ETc_{adj}}{ETc} = 1 - Ky \cdot \left(1 - \frac{ETa}{ETc}\right)$$

Simplificando para uso por janela fenológica:

$$RY_j = Ky_j \cdot (1 - \overline{Ks}_j)$$

**Onde:**
- $RY_j$ = redução relativa de produtividade na janela $j$ (decimal, 0–1)
- $Ky_j$ = coeficiente de sensibilidade ao estresse da janela $j$
- $\overline{Ks}_j$ = Ks médio observado durante a janela $j$

### Referência bibliográfica
> DOORENBOS, J.; KASSAM, A.H. (1979). *Yield response to water*. FAO Irrigation and Drainage Paper No. 33. Rome: FAO. Equação 3.2.

### Implementação
`src/modules/msa/engine/yield.ts` → `yieldReduction(ksMean, ky)` e `summarizeByPhase(series, cultivar)`, que devolve para F1–F4 `{ days, ksMean, etcAdjAccum, precipAccum, yieldReductionPct }` (janela não alcançada: `days = 0`, `ksMean` e `yieldReductionPct` nulos).

---

## 7. Análise de Risco — Método de Monte Carlo

### Objetivo
Quantificar a incerteza climática das estimativas de Ks por janela fenológica, gerando perfis de risco P10/P50/P90.

### Procedimento (1.000 iterações)

Para cada iteração $i$:

1. Perturbar a série de precipitação:
$$P_{d,i} = P_d \cdot \left(1 + \varepsilon_P\right), \quad \varepsilon_P \sim \mathcal{N}(0;\ 0{,}30^2)$$

2. Perturbar a série de temperatura:
$$T_{d,i} = T_d + \varepsilon_T, \quad \varepsilon_T \sim \mathcal{N}(0;\ 0{,}6^2)\ \text{°C}$$

3. Recalcular: ET₀ → ETc → Balanço hídrico → $\overline{Ks}_j$ por janela

4. Registrar $\overline{Ks}_{j,i}$ para cada janela $j$

**Após 1.000 iterações, para cada janela:**

$$P10_j = \text{percentil}_{10}(\overline{Ks}_{j,i})$$
$$P50_j = \text{mediana}(\overline{Ks}_{j,i})$$
$$P90_j = \text{percentil}_{90}(\overline{Ks}_{j,i})$$

### Justificativa dos parâmetros de perturbação
- **±30% em precipitação:** representa a variabilidade interanual típica das chuvas do Cerrado (CV ~25–35% para estações chuvosas).  
- **±0,6°C em temperatura:** corresponde à incerteza de reanálise reportada para ERA5-Land no Brasil tropical (Hersbach et al., 2020).

### Convenções adotadas no motor

- **Perturbação sistemática por iteração.** Em cada iteração *i* sorteiam-se, nesta ordem, um fator de precipitação $f_i = \max(0,\ 1 + \varepsilon_P)$ e um deslocamento térmico $\delta_i = \varepsilon_T$; $f_i$ multiplica a precipitação de **todos** os dias e $\delta_i$ soma-se a $T_{max}$, $T_{min}$ e $T_{med}$ de **todos** os dias ($T_{dew}$ e $R_n$ não mudam). Ou seja, $\varepsilon_P$ e $\varepsilon_T$ não variam com *d*. Motivo: a incerteza que se quer capturar é a de viés da reanálise sobre a janela e a variabilidade interanual, ambas correlacionadas no tempo; ruído diário independente com σ = 30 % se cancelaria em grande parte na soma de uma janela de 20–40 dias (o desvio da soma cresce com √n enquanto a soma cresce com n) e estreitaria o intervalo P10–P90. A variante mista (viés por iteração + ruído diário) está em aberto para decisão da pesquisadora.
- **Truncamento.** $f_i$ é truncado em zero (com σ = 0,30, $P(f_i < 0) \approx 4 \cdot 10^{-4}$).
- **Percentis tipo 7** (Hyndman & Fan, 1996): interpolação linear entre ordens, o padrão de R (`quantile`) e NumPy (`linear`), para que os números sejam reproduzíveis em qualquer ferramenta do relatório.
- **Iterações válidas.** Se uma janela não é alcançada em alguma iteração ($\delta_i$ negativo reduz o GDA acumulado), seus percentis são calculados só sobre as iterações em que ela teve dias, e a contagem é informada.
- **Reprodutibilidade.** PRNG mulberry32 com semente obrigatória e amostrador normal por Box-Muller sem estado adicional: mesma semente ⇒ mesmo resultado, em qualquer máquina.

### Referência bibliográfica
> METROPOLIS, N.; ULAM, S. (1949). The Monte Carlo method. *Journal of the American Statistical Association*, 44(247), 335–341.  
> HERSBACH, H. et al. (2020). The ERA5 global reanalysis. *Quarterly Journal of the Royal Meteorological Society*, 146(730), 1999–2049.

### Implementação
`src/modules/msa/engine/monte-carlo.ts` → `runMonteCarlo(days, cultivar, soil, { iterations = 1000, seed, sigmaPrecip = 0.30, sigmaTemp = 0.6, altitude, initialDepletion })`, que devolve por janela F1–F4 `validIterations` e P10/P50/P90 de `ksMean`, `yieldReductionPct` e `etcAdjAccum`, além do baseline (resumo e série diária sem perturbação) e dos metadados. `percentile(sorted, p)` implementa o tipo 7. `src/modules/msa/engine/random.ts` → `mulberry32(seed)`, `sampleNormal(rand, mean, sd)`. Consome `runDailyBalance` e `summarizeByPhase`; 1.000 iterações de uma safra de 150 dias rodam em ~0,1 s.

Validação (Caso 3 de `validacao.md`): `pnpm msa:validate-mc` compara o P50 por janela com 100/500/1.000 iterações; o job BullMQ que executará isso por safra (`monte-carlo.worker.ts`) ainda não existe.

---

## 8. Cenários de Decisão

Após o Monte Carlo, o sistema gera três cenários de intervenção baseados em $P50$ da janela fenológica atual ou encerrada:

### Cenário (a) — Redução de Dose
$$Dose_{adj} = Dose_{base} \times \overline{Ks}_{P50}$$

### Cenário (b) — Parcelamento
A dose é dividida entre duas operações. A proporção é calculada pela razão da ETc projetada nas duas metades da próxima janela:
$$f_1 = \frac{ETc_{proj,1}}{ETc_{proj,1} + ETc_{proj,2}}, \quad f_2 = 1 - f_1$$
$$Dose_1 = Dose_{base} \times f_1, \quad Dose_2 = Dose_{base} \times f_2$$

### Cenário (c) — Fator de Eficiência
Ajusta a eficiência de uso do nutriente proporcional ao estresse hídrico:
$$Eficiência_{adj} = Eficiência_{base} \times \overline{Ks}_{P50}$$

> A interpretação agronômica e a escolha do cenário são responsabilidade do técnico. O sistema documenta a decisão tomada e a justificativa.

**Convenções adotadas no motor:** a "próxima janela" do cenário (b) é a seguinte à informada (F1→F2, F2→F3, F3→F4); para F4 não há parcelamento e o cenário vem nulo com o motivo. Os dias dessa janela na **série baseline** (sem perturbação) são divididos em duas metades consecutivas, a primeira com ⌈n/2⌉ dias, e $ETc_{proj}$ é a ETc (demanda potencial, $Kc \cdot ET_0$), não a ETc ajustada. Se a série não alcança a janela seguinte, ou a alcança com menos de 2 dias, o cenário também vem nulo com o motivo. Cada cenário traz uma frase de racional que descreve o cálculo; nenhum é recomendado.

### Implementação
`src/modules/msa/engine/decision.ts` → `generateDecisionScenarios({ phase, ksP50, baselineSeries, cultivar, doseBase, efficiencyBase })` devolve `{ a, b | null, bUnavailableReason, c }` com os números e os racionais; `nextPhase(phase)` dá a janela seguinte. O serviço que gravará a decisão do técnico (`decision.service.ts`) ainda não existe.

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
| $GDA$ | Graus-dia acumulados | °C·dia |
| $T_{base}$ | Temperatura-base da cultura | °C |
| $TAW$ | Total de água disponível | mm |
| $RAW$ | Água prontamente disponível | mm |
| $Dr$ | Depleção na zona radicular | mm |
| $Zr$ | Profundidade efetiva da zona radicular | m |
| $p$ | Fração de depleção permitida sem estresse | 0–1 |
| $\theta_{FC}$ | Umidade volumétrica na capacidade de campo | m³/m³ |
| $\theta_{WP}$ | Umidade volumétrica no ponto de murcha | m³/m³ |
| $P10/P50/P90$ | Percentis do Monte Carlo | adimensional |
| $R_n$ | Saldo de radiação líquida | MJ/m²/dia |
| $u_2$ | Velocidade do vento a 2 m | m/s |
| $e_s$ | Pressão de vapor saturado | kPa |
| $e_a$ | Pressão de vapor atual | kPa |
| $\Delta$ | Declividade da curva de pressão de vapor | kPa/°C |
| $\gamma$ | Constante psicrométrica | kPa/°C |
