## Context

`docs/msa/algoritmos.md` define a matemática (GDA, janelas F1–F4, ET₀ Penman-Monteith, Kc por fase, balanço hídrico de depleção, redução de produtividade FAO-33) e `docs/msa/validacao.md` o protocolo (RMSE, R², NSE, PBIAS; Caso 1 = ET₀ vs. CROPWAT). O model `Cultivar` já carrega todos os parâmetros que o motor consome. Os exemplos trabalhados do FAO-56 foram conferidos no texto original (cap. 3 e 4, fao.org/4/x0490e) e seus valores constam nas decisões abaixo.

## Goals / Non-Goals

**Goals:**

- Cada função corresponde a uma equação identificada; o JSDoc traz fonte, capítulo/tabela e número da equação.
- Nenhuma importação fora de `engine/` além de tipos próprios: o motor roda em testes, no Monte Carlo e em scripts sem banco.
- Reproduzir os Exemplos 17 e 18 do FAO-56 dentro de ±0,1 mm/dia e os Exemplos 2–5 nas auxiliares.
- `runDailyBalance` determinístico, O(n) e sem alocações por dia além da linha de saída.
- Ferramenta para o Caso 1 do protocolo de validação rodar hoje, com dados do CROPWAT em CSV.

**Non-Goals:**

- Monte Carlo, cenários de decisão, persistência, filas e endpoints (changes seguintes consomem o motor).
- Irrigação, escoamento, ascensão capilar, percolação explícita (o modelo simplificado de `algoritmos.md` §5).
- Kc com ajuste climático (Eq. 62/65 do FAO-56) ou curva por dias de calendário; apenas o Kc por GDA documentado.
- Parâmetros de solo por talhão no banco.

## Decisions

### 1. Tipos próprios, sem acoplar ao Prisma

`engine/types.ts` define `CultivarParams` (os 15 parâmetros numéricos do model, mesmos nomes), `SoilParams { thetaFC, thetaWP }`, `DailyWeather`, `ET0Input`, `DailyBalanceRow`, `PhaseSummary`, `Phase = 'F1' | 'F2' | 'F3' | 'F4' | 'COMPLETED'`. Um objeto `Cultivar` do Prisma satisfaz `CultivarParams` estruturalmente; o motor não importa `@prisma/client`. Os nomes coincidem com `CULTIVAR_PARAM_KEYS` do módulo de cultivares de propósito, para passar o registro direto.

### 2. Convenções de unidade e de fase

- Temperaturas em °C, pressões em kPa, radiação em MJ m⁻² dia⁻¹, vento em m s⁻¹, água em mm, Zr em m, GDA em °C·dia.
- Fase do dia `d` é determinada pelo GDA acumulado **ao fim** do dia `d` (inclui o GDA do próprio dia). Limites: `F1: gda < gdaF1End`, `F2: gdaF1End ≤ gda < gdaF2End`, `F3: gdaF2End ≤ gda < gdaF3End`, `F4: gdaF3End ≤ gda < gdaTotal`, `COMPLETED: gda ≥ gdaTotal` — limite inferior inclusivo, para que a transição seja exata e testável.
- `rootDepth`: linear de `zrIni` (GDA 0) a `zrMax` em `gdaF2End` (início de F3), constante depois; nunca decresce.
- `kcForPhase`: F1 = `kcIni`; F2 interpola `kcIni → kcMid` em `[gdaF1End, gdaF2End]`; F3 = `kcMid`; F4 interpola `kcMid → kcEnd` em `[gdaF3End, gdaTotal]`; COMPLETED = `kcEnd`. A interpolação é por GDA (não por dias), coerente com a fenologia térmica; é contínua nas quatro transições.

### 3. ET₀: `ea` por ponto de orvalho, `tmean` opcional, G = 0

`referenceET0(input: ET0Input)` com `ET0Input = { tmax, tmin, tmean?, tdew, u2, rn, altitude }`. `tmean` ausente → `(tmax + tmin) / 2` (Eq. 9). `ea` vem de `tdew` (Eq. 14), que é o que o ERA5-Land fornece (`2m_dewpoint_temperature`). `G = 0` (Eq. 42, passo diário). A função devolve só o número; uma variante `referenceET0Detailed` devolve também os intermediários (Δ, γ, es, ea, P) para depuração e para a planilha de validação.

Para dados de estação/CROPWAT, que vêm com umidade relativa e Rs ou horas de sol, o motor exporta as conversões — todas em `et0.ts`, cada uma com sua equação:

| Função | Eq. FAO-56 |
|---|---|
| `atmosphericPressure(altitude)` | 7 |
| `psychrometricConstant(P)` | 8 |
| `saturationVapourPressure(T)` | 11 |
| `meanSaturationVapourPressure(tmax, tmin)` | 12 |
| `slopeVapourPressureCurve(tmean)` | 13 |
| `actualVapourPressureFromDewpoint(tdew)` | 14 |
| `actualVapourPressureFromPsychrometer(tdry, twet, P, aPsy = 0.000662)` | 15, 16 |
| `actualVapourPressureFromRH(tmax, tmin, rhMax, rhMin)` | 17 |
| `actualVapourPressureFromMeanRH(tmax, tmin, rhMean)` | 19 |
| `dewpointFromVapourPressure(ea)` | inversa algébrica da 11/14 (ver nota) |
| `extraterrestrialRadiation(lat, doy)` | 21–25 |
| `daylightHours(lat, doy)` | 34 |
| `solarRadiationFromSunshine(n, N, Ra, as = 0.25, bs = 0.50)` | 35 |
| `clearSkyRadiation(Ra, altitude)` | 37 |
| `netShortwaveRadiation(Rs, albedo = 0.23)` | 38 |
| `netLongwaveRadiation(tmax, tmin, ea, Rs, Rso)` | 39 |
| `netRadiationFromSolar(rs, tmax, tmin, ea, lat, doy, altitude)` | 37–40 (compõe as anteriores) |
| `windSpeedAt2m(uz, z = 10)` | 47 — fator 0,748 para z = 10 m |

Nota sobre a inversa: a expressão do Anexo 3 do FAO-56 (`Tdew = [116,91 + 237,3 ln ea] / [16,78 − ln ea]`) é uma aproximação que erra até ~0,01 °C em relação à Eq. 11; o motor usa a inversa algébrica exata (`237,3 x / (17,27 − x)`, `x = ln(ea/0,6108)`), para que `e°(Tdew(ea)) = ea` valha exatamente — o teste de ida e volta exige isso. A diferença em ET₀ é desprezível.

As três conversões de `ea` por UR/psicrômetro e a inversa da Eq. 14 não estavam no pedido; entram porque sem elas o Caso 1 (dados CLIMWAT: T, UR, u2, Rs) e os Exemplos 4 e 5 não são executáveis. `windSpeedAt2m` usa a forma geral da Eq. 47 (`uz · 4,87 / ln(67,8 z − 5,42)`), que dá 0,748 para z = 10 m; o fator fixo citado em `algoritmos.md` é o caso particular.

### 4. Valores de referência dos testes (conferidos no FAO-56)

**Exemplo 18 — Uccle/Bruxelas, 6 de julho (dia juliano 187), 50,80° N, 100 m**: Tmax 21,5, Tmin 12,3, RHmax 84 %, RHmin 63 %, vento a 10 m = 10 km/h (2,78 m/s) → u2 2,078; n = 9,25 h. Intermediários do texto: P 100,1; Tmean 16,9; Δ 0,122; γ 0,0666; es 1,997; ea 1,409; Ra 41,09; N 16,1; Rs 22,07; Rso 30,90; Rns 17,00; Rnl 3,71; Rn 13,28; G 0; **ET₀ 3,9 mm/dia**.

**Exemplo 17 — Bangkok, abril (dia juliano 105), 13,73° N, 2 m**: Tmax 34,8, Tmin 25,6, ea 2,85 kPa, u2 2,0, n 8,5 h. Intermediários: Tmean 30,2; Δ 0,246; P 101,3; γ 0,0674; es 4,42; Ra 38,06; N 12,31; Rs 22,65; Rso 28,54; Rns 17,44; Rnl 3,11; Rn 14,33; G 0,14 (mensal, Eq. 43); **ET₀ 5,72 mm/dia**. O motor usa G = 0 (passo diário); o efeito é de ~0,01 mm/dia, dentro da tolerância de ±0,1.

Os testes verificam a cadeia inteira (de UR/`ea` e horas de sol até ET₀) e também cada intermediário contra os valores impressos, com tolerância de 1 % ou 0,01 na unidade, o que for maior — assim um erro numa auxiliar aparece na auxiliar, não só no total.

**Exemplos do cap. 3**: Ex. 2 (z 1800 m → P 81,8, γ 0,054); Ex. 3 (Tmax 24,5, Tmin 15 → e°(Tmax) 3,075, e°(Tmin) 1,705, es 2,39); Ex. 4 (z 1200 m, Tdry 25,6, Twet 19,5, aspirado → ea 1,91); Ex. 5 (Tmin 18, RHmax 82, Tmax 25, RHmin 54 → ea 1,70).

### 5. Balanço hídrico: semântica do dia

Para cada dia `d`, nesta ordem:

1. `gda_d = dailyGDA(tmax, tmin, tBase)`; `gdaAccum += gda_d`; `phase`, `zr`, `kc` a partir de `gdaAccum`.
2. `taw = totalAvailableWater(thetaFC, thetaWP, zr)` (Eq. 82); `raw = p · taw` (Eq. 83). Ao aprofundar a raiz, TAW cresce e **Dr é mantido** (a água da camada nova conta como disponível) — é o comportamento do FAO-56 quando se adota Dr absoluto em mm.
3. `ks = stressCoefficient(dr_{d-1}, taw, raw)` (Eq. 84) com a depleção **do início do dia**; `et0`, `etc = kc · et0`, `etcAdj = ks · etc`.
4. `dr_d = clamp(dr_{d-1} − P_d + etcAdj, 0, taw)`: chuva acima da depleção zera Dr (excedente = percolação implícita); Dr nunca excede TAW.

`options = { altitude, initialDepletion = 0 }`. A altitude é obrigatória (entra em P e γ; 1.000 m muda ET₀ em ~2 %), por isso `options` não é opcional como no pedido — um default silencioso para o nível do mar seria um erro escondido. `initialDepletion = 0` = solo na capacidade de campo na emergência.

Implementação: um único laço, variáveis escalares locais, saída em `Array(days.length)` preenchido por índice, uma linha-objeto por dia (é o contrato de saída). Nada de `map`/`reduce` encadeados nem objetos intermediários. Linhas com `precipitation` ou temperaturas inválidas (`NaN`) lançam `RangeError` com o índice — falhar cedo é melhor do que propagar `NaN` por 1.000 iterações.

### 6. `stressCoefficient` fora do laço e à prova de bordas

`Ks = 1` se `dr ≤ raw`; `(taw − dr)/(taw − raw)` se `raw < dr ≤ taw`; `0` se `dr > taw`. Caso degenerado `raw = taw` (p = 1, impedido pelo DTO, mas o motor não confia nisso): `Ks = dr ≤ taw ? 1 : 0`. Resultado sempre em `[0, 1]` — é a propriedade testada com entradas aleatórias.

### 7. Redução de produtividade e resumo por janela

`yieldReduction(ksMean, ky) = ky · (1 − ksMean)` (FAO-33, Eq. 3.2 simplificada como em `algoritmos.md` §6), limitada a `[0, 1]`. `summarizeByPhase(series, cultivar)` devolve sempre quatro entradas (F1–F4), em ordem, com `days`, `ksMean`, `etcAdjAccum`, `precipAccum`, `yieldReductionPct`; janela não alcançada tem `days = 0` e `ksMean`/`yieldReductionPct` `null`, em vez de um `1`/`0` que pareceria resultado. Dias `COMPLETED` são ignorados no resumo.

### 8. Testes de propriedade sem dependência nova

Um PRNG determinístico (mulberry32, semente fixa) gera 200 cultivares, solos e séries válidos por teste; afirma-se `0 ≤ Ks ≤ 1`, `etcAdj ≤ etc`, `0 ≤ Dr ≤ TAW`, `Zr` não decrescente e `gdaAccum` não decrescente. Semente fixa torna o teste reproduzível; `fast-check` ficaria para quando houver mais invariantes a explorar.

### 9. Script de validação

`backend/scripts/validation/et0-validate.ts`, executado por `pnpm msa:validate-et0 -- caminho.csv [--out saida.csv]` (ts-node, como o seed). Lê CSV com cabeçalho; colunas reconhecidas: `id`/`date`, `lat`, `altitude`, `doy` (ou derivado de `date`), `tmax`, `tmin`, `tmean?`, umidade por **uma** das vias `tdew` | `ea` | `rhmean` | `rhmax`+`rhmin`, vento por `u2` | `u10`, radiação por `rn` | `rs` | `n` (horas de sol → Eq. 35), e `et0_reference`. Para cada linha calcula ET₀ com o motor, imprime RMSE, R², NSE e PBIAS (fórmulas de `validacao.md`) e os critérios de aceitação, e grava o CSV de comparação (`<entrada>.comparison.csv` por padrão). Com `n < 3`, R² e NSE são impressos com aviso de que não são informativos.

`examples/fao56-examples.csv` traz os Exemplos 17 e 18 como vêm no livro (UR ou `ea`, horas de sol, vento a 10 m ou 2 m) com `et0_reference` 5,72 e 3,9 — serve de teste de fumaça do script e de modelo de preenchimento para os dados do CROPWAT de Goiânia.

### 10. Documentação

`algoritmos.md`: cada seção "Implementação" aponta para `src/modules/msa/engine/<arquivo>.ts → função`; a §3 ganha a tabela de auxiliares da Decisão 3; §7 e §8 ficam marcadas como "previsto" (não implementadas). `validacao.md`: Caso 1 passa a citar o script e o CSV de exemplo.

## Risks / Trade-offs

- **[Tolerância de ±0,1 mm/dia pode esconder erro sistemático pequeno]** → Mitigado testando cada intermediário contra o valor impresso no FAO-56, não só o total.
- **[Fase pelo GDA ao fim do dia]** → No dia de transição, Kc e Zr já são da fase nova. Diferença de um dia em relação à convenção "início do dia"; documentado e consistente em todo o motor.
- **[TAW cresce sem alterar Dr]** → Conservador em relação a redistribuir Dr proporcionalmente; é o que o FAO-56 faz e o que o CROPWAT reproduz. O Caso 2 da validação dirá se precisa de ajuste.
- **[`options.altitude` obrigatório diverge do pedido]** → Deliberado (Decisão 5).
- **[Script lê CSV com parser próprio]** → Não trata aspas ou vírgula decimal. Suficiente para exportações do CROPWAT em inglês; documentado no cabeçalho do script.
- **[Exemplo 17 é mensal, motor é diário]** → G = 0 em vez de 0,14; efeito ~0,01 mm/dia. Registrado no teste. Resultado obtido: 5,76 mm/dia (+0,04) para Bangkok e 3,88 (−0,02) para Bruxelas — ambos dentro de ±0,1; a diferença restante vem do arredondamento dos intermediários impressos no livro.

### 11. Notas da implementação

- As métricas do script ficaram em `backend/scripts/validation/metrics.ts`, com teste próprio; o `vitest.config.ts` passou a incluir `scripts/**/*.test.ts`.
- `test-fixtures.ts` (cultivar/solo de referência e PRNG mulberry32) é compartilhado pelos testes do motor e excluído do `tsc` para não ir ao `dist/`.
- Saídas `*.comparison.csv` entram no `.gitignore`.

## Migration Plan

Nenhum: biblioteca nova sem efeito em banco ou API. Rollback = remover os arquivos.

## Open Questions

- **Perfil de solo por talhão**: `thetaFC`/`thetaWP` virão do laudo físico-hídrico (módulo de Análise de Solo, Fase 2); até lá o Monte Carlo usará os valores típicos do Latossolo de `algoritmos.md` §5.
- **Kc com ajuste climático (Eq. 62/65)**: avaliar após o Caso 2 se a divergência com o CROPWAT justifica.
