# MSA — Protocolo de Validação Científica

## Objetivo

Verificar se as implementações de ET₀ (FAO-56 Penman-Monteith), balanço hídrico e Monte Carlo produzem resultados consistentes com ferramentas de referência reconhecidas internacionalmente, especialmente o **CROPWAT 8.0** da FAO.

> Este protocolo serve como base metodológica para a seção de validação da dissertação de Heb Rejane Moreira Pires.

---

## Ferramentas de Referência

| Ferramenta | Versão | Uso |
|---|---|---|
| **CROPWAT 8.0** | 8.0 (FAO, 2010) | Validação de ET₀ e balanço hídrico |
| **CLIMWAT 2.0** | 2.0 (FAO) | Dados climáticos de estações de referência |
| **R** + pacote `Evapotranspiration` | ≥ 4.0 | Cálculo independente de ET₀ FAO-56 |

---

## Métricas de Avaliação

### 1. Raiz do Erro Quadrático Médio (RMSE)

$$RMSE = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (S_i - O_i)^2}$$

**Critério de aceitação:** RMSE ≤ 0,5 mm/dia para ET₀

### 2. Coeficiente de Determinação (R²)

$$R^2 = \left(\frac{\sum_{i=1}^{n}(S_i - \bar{S})(O_i - \bar{O})}{\sqrt{\sum(S_i-\bar{S})^2 \cdot \sum(O_i-\bar{O})^2}}\right)^2$$

**Critério de aceitação:** R² ≥ 0,95

### 3. Nash-Sutcliffe Efficiency (NSE)

$$NSE = 1 - \frac{\sum_{i=1}^{n}(O_i - S_i)^2}{\sum_{i=1}^{n}(O_i - \bar{O})^2}$$

**Interpretação:**
- NSE = 1,0: modelo perfeito
- 0,75 ≤ NSE < 1,0: muito bom
- 0,65 ≤ NSE < 0,75: bom
- NSE < 0,65: insatisfatório

**Critério de aceitação:** NSE ≥ 0,80 para ET₀ diária

### 4. Viés Percentual (PBIAS)

$$PBIAS = \frac{\sum_{i=1}^{n}(O_i - S_i)}{\sum_{i=1}^{n} O_i} \times 100\%$$

**Critério de aceitação:** |PBIAS| ≤ 10%

**Onde:**
- $S_i$ = valor simulado pelo MSA
- $O_i$ = valor de referência (CROPWAT ou observado)
- $n$ = número de observações
- $\bar{S}$, $\bar{O}$ = médias das séries

### Referência bibliográfica
> MORIASI, D.N. et al. (2007). Model evaluation guidelines for systematic quantification of accuracy in watershed simulations. *Transactions of the ASABE*, 50(3), 885–900.  
> NASH, J.E.; SUTCLIFFE, J.V. (1970). River flow forecasting through conceptual models. *Journal of Hydrology*, 10(3), 282–290.

---

## Casos de Teste

### Caso 1 — Validação de ET₀ com Dados Estáticos (CROPWAT)

**Procedimento:**
1. Obter dados climáticos mensais de Goiânia-GO na base CLIMWAT 2.0
2. Calcular ET₀ mensal no CROPWAT 8.0 (modo Penman-Monteith)
3. Montar um CSV com os dados e a coluna `et0_reference` e rodar o script de validação, que usa o motor (`src/modules/msa/engine/et0.ts`):
   ```bash
   cd backend && pnpm msa:validate-et0 -- dados/goiania-cropwat.csv
   ```
   Colunas aceitas e exemplo em `backend/scripts/validation/README.md`; `backend/scripts/validation/examples/fao56-examples.csv` reproduz os Exemplos 17 e 18 do FAO-56 (teste de fumaça).
4. O script imprime RMSE, R², NSE e PBIAS com os critérios de aceitação e grava a comparação por linha em `<entrada>.comparison.csv`

**Dados de entrada:**
| Mês | T_med (°C) | UR (%) | u2 (m/s) | Rs (MJ/m²/dia) |
|---|---|---|---|---|
| Jan | 23,8 | 79 | 1,7 | 20,1 |
| Jul | 20,9 | 58 | 1,8 | 16,3 |
| ... | ... | ... | ... | ... |

**Resultado esperado:** |PBIAS| ≤ 5% em relação ao CROPWAT

---

### Caso 2 — Validação de Balanço Hídrico com Safra Histórica

**Procedimento:**
1. Selecionar uma safra de soja com data de emergência, cultivar e dados de solo conhecidos
2. Usar os dados ERA5-Land do período da safra como entrada
3. Executar o balanço hídrico no MSA
4. Executar o mesmo balanço no CROPWAT 8.0 (módulo Soil Water Balance)
5. Comparar $Dr_d$ e $Ks_d$ diários com RMSE e NSE

**Critério de aceitação:** NSE ≥ 0,80 para $Dr_d$

---

### Caso 3 — Validação do Monte Carlo

**Procedimento:**
1. Verificar a convergência dos percentis com 100, 500 e 1.000 iterações:
   ```bash
   cd backend
   pnpm msa:validate-mc -- dados/safra-era5.csv --cultivar soja --altitude 741 --seed 2026
   pnpm msa:validate-mc -- --synthetic 150 --cultivar soja          # sem dados ERA5: série sintética de referência
   ```
   O script (`backend/scripts/validation/mc-validate.ts`) roda as três contagens **com a mesma semente** (as primeiras 500 iterações são idênticas; mede-se só o efeito das adicionais) e imprime, por janela, o P50 do Ks médio nas três contagens, a variação relativa, P10/P90 a 1.000 iterações, o baseline e o número de iterações válidas. `--out` grava os números em CSV. O CSV de clima tem `date, tmax, tmin, [tmean], tdew, u2, rn, precipitation`; `backend/scripts/validation/examples/synthetic-cerrado-season.csv` é a série sintética de 150 dias (semente 2026), também usada pelo teste automatizado de convergência.
2. Garantir que a diferença entre P50 (500 iter.) e P50 (1.000 iter.) seja < 0,5 % em toda janela com dias — o script aplica o critério
3. Verificar se as perturbações geram distribuição normal esperada (teste Shapiro-Wilk, p > 0,05) — fica para o relatório em Python (`validation_report.py`); o motor usa Box-Muller com média e desvio verificados em 100 mil sorteios pelos testes unitários

**Critério de aceitação:** variação de P50 entre 500 e 1.000 iterações < 0,5%

**Resultado obtido com a série sintética (semente 2026, soja):** F1 e F2 sem estresse (P50 = 1); F3 P50 0,971 (variação 0,11 %); F4 P50 0,922 (variação 0,05 %). Repetir com várias sementes e com séries ERA5 reais para o relatório.

---

### Caso 4 — Validação da Correção de Viés (Quantile Mapping)

**Ferramenta:** `python -m era5.cli qm validate` (dentro do serviço `etl`), que calibra em um período A, aplica em um período B independente e compara ERA5 bruto × corrigido com a observação.

**Procedimento:**
1. Importar a série diária da estação INMET (BDMEP): `docker compose run --rm etl stations import <arquivo.csv> --format bdmep` (ou pelo upload em `/admin`).
2. Garantir a série ERA5 da célula no mesmo período (`ingest --from --to`, por trimestre).
3. Rodar a validação com períodos disjuntos (ex.: calibrar 2010–2019, testar 2020–2024):
   ```bash
   docker compose run --rm etl qm validate --cell -16.7 -49.3 --station 83423 \
     --calib-years 2010-2019 --test-years 2020-2024 --csv /data/cache/qm-validate-83423.csv
   ```
   A saída traz, por mês e no total: RMSE e PBIAS do ERA5 bruto e do corrigido contra a observação, e a fração de dias chuvosos observada, bruta e corrigida.
4. Avaliar a redução do viés sistemático e da diferença de frequência de dias chuvosos.

**Critério de aceitação:** redução do |PBIAS| em ≥ 30 % após correção QM no período de teste, e fração de dias chuvosos corrigida a menos de 2 p.p. da observada. Com a estação sintética dos testes (viés conhecido), o PBIAS cai de ≈ −20 % para < 2 %.

---

## Estações de Referência para o Cerrado

| Estação INMET | Código | UF | Lat | Lon |
|---|---|---|---|---|
| Goiânia | 83423 | GO | -16,63 | -49,22 |
| Brasília | 83377 | DF | -15,79 | -47,93 |
| Uberlândia | 83522 | MG | -18,92 | -48,24 |
| Rondonópolis | 83410 | MT | -16,46 | -54,59 |
| Sorriso | 83309 | MT | -12,54 | -55,72 |

---

## Relatório de Validação

O relatório de validação será gerado automaticamente pelo script `backend/etl/validation_report.py` e exportado em formato CSV e gráficos PNG para o diretório `docs/msa/validation_results/`.

**Estrutura do relatório:**
```
docs/msa/validation_results/
├── et0_cropwat_comparison.csv
├── et0_scatter_plot.png
├── water_balance_timeseries.png
├── monte_carlo_convergence.png
└── qm_bias_correction.png
```

---

## Cronograma de Validação

| Etapa | Quando | Responsável |
|---|---|---|
| Validação ET₀ (Caso 1) | Após implementação de `et0.calculator.ts` | Heb + dev |
| Validação balanço hídrico (Caso 2) | Após implementação de `water-balance.calculator.ts` | Heb + dev |
| Validação Monte Carlo (Caso 3) | Motor pronto (`engine/monte-carlo.ts`); repetir com séries ERA5 reais quando o ETL existir | Dev + Heb |
| Validação QM (Caso 4) | Após implementação de `era5_bias_correct.py` | Heb + dev |
| Relatório final de validação | Antes da defesa da dissertação | Heb |
