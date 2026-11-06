# MSA — Protocolo de Validação Científica

## Objetivo

Verificar se as implementações de ET₀ (FAO-56 Penman-Monteith), balanço hídrico e predição de produtividade (índice do ciclo FAO-33) produzem resultados consistentes com ferramentas de referência reconhecidas internacionalmente, especialmente o **CROPWAT 8.0** da FAO, e com a produtividade observada em safras históricas.

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

### Caso 2 — Validação de Balanço Hídrico e Produtividade com Safra Histórica

**Procedimento:**
1. Selecionar uma safra de soja com data de emergência, cultivar e dados de solo conhecidos; sempre que possível, com a **produtividade potencial** ($Y_m$, informada na safra como `expectedYield`, sc/ha) e a **produtividade observada** (colhida) registradas
2. Usar os dados ERA5-Land do período da safra como entrada
3. Executar o balanço hídrico no MSA
4. Executar o mesmo balanço no CROPWAT 8.0 (módulo Soil Water Balance)
5. Comparar $Dr_d$ e $Ks_d$ diários com RMSE e NSE
6. Quando a safra histórica tem produtividade observada, comparar a **produtividade predita** da run (`predictedYield` = $Y_m \times$ índice do ciclo, `docs/msa/algoritmos.md` §6) com a observada pelo **erro relativo**:

   $$E_{rel} = \frac{Y_{predita} - Y_{observada}}{Y_{observada}}$$

   Implementado em `relativeError()` (`backend/scripts/validation/metrics.ts`). Registrar no relatório, para cada safra, $Y_m$, o índice do ciclo, `phasesReached`, $Y_{predita}$, $Y_{observada}$ e $E_{rel}$.

**Critério de aceitação:** NSE ≥ 0,80 para $Dr_d$. Para a produtividade, **não há critério de aceitação fixo nesta etapa**: o erro relativo é registrado no relatório e serve para discutir a aderência do índice FAO-33 nas safras disponíveis (a predição é um valor único, sem faixa de incerteza — ver limitação em `algoritmos.md` §6).

---

> **Caso 3 (convergência do Monte Carlo) removido em 2026-11-02.** O módulo estocástico saiu do motor com a redefinição do objetivo do MSA para predição de produtividade (ver `docs/msa/questoes-abertas.md`, registro da reunião com o professor Adilson). A numeração do Caso 4 foi mantida para não quebrar referências no roteiro e no manual.

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

### Caso 5 — Comparação de métodos de graus-dia (residual × Ometto × Ometto com TB)

**Contexto:** desde `ENGINE_VERSION` 2.1.0 (change `adopt-ometto-degree-days`, 2026-11-03) o motor calcula os graus-dia pelo método de Ometto (1981), com temperatura-base inferior $T_b$ e superior $T_B$ (`docs/msa/algoritmos.md` §1). O método residual $\max((T_{max} + T_{min})/2 - T_b,\ 0)$ do motor ≤ 2.0.0 é o caso 1 de Ometto; os dois diferem nos dias que cruzam uma das bases — no Cerrado, sobretudo os dias com $T_{max} > T_B$ de setembro a novembro. Como as janelas F1–F4 definem o $\overline{Ks}$ por janela, o Ky aplicado, o índice do ciclo e a produtividade predita, este caso documenta **quanto** a troca de método desloca o calendário fenológico. O valor de $T_B$ da soja (30 °C) é provisório (`questoes-abertas.md`, questão nº 10); a comparação também serve para discutir essa escolha.

**Ferramenta:** `pnpm msa:validate-gda` (`backend/scripts/validation/gda-validate.ts`). Para a mesma série de $T_{max}$/$T_{min}$, acumula graus-dia por três métodos — `residual` (fórmula antiga, reimplementada no script para não depender do motor), `ometto` (motor, sem $T_B$) e `ometto-tb` (motor, com $T_B$ = `--tupper`, padrão 30 °C) — e projeta as janelas da cultivar de referência (`phaseFromGDA`).

**Procedimento:**
1. Série sintética de 150 dias (`syntheticSeason(150, 2026)`, a mesma dos testes de serviço; não precisa de banco):
   ```bash
   cd backend && pnpm msa:validate-gda -- --synthetic 150 --cultivar soja --out ../validacao/saida/gda-sintetica.csv
   ```
2. Célula de Goiânia em cache (`era5_daily_data`, pela conexão do backend — `DATABASE_URL`), a partir de uma data de emergência real da safra escolhida no Caso 2:
   ```bash
   cd backend && pnpm msa:validate-gda -- --cell -16.7,-49.3 --from 2025-10-25 --tbase 10 --tupper 30 --out ../validacao/saida/gda-goiania.csv
   ```
   Um CSV próprio com colunas `date, tmax, tmin` (demais colunas ignoradas; formato de `examples/synthetic-cerrado-season.csv`) também é aceito como entrada. `--to` limita o fim da série; sem ele, vai até o último dia em cache.
3. Opcionalmente, repetir o passo 2 com `--tupper 32` e `--tupper 35` para a sensibilidade ao valor de $T_B$ (questão nº 10).
4. Levar os CSVs (`metodo;janela;inicio;fim;dias;gda_fim`) para a tabela da dissertação.

**Saída:** por método e janela F1–F4, a data de início, a data de fim e o número de dias; o dia em que `gdaTotal` é atingido (ou "não atingido", se a série termina antes) e o GDA acumulado ao fim da série; e a diferença de dias por janela entre `ometto-tb` e `residual`. O script encerra com código 1 se faltar a coluna `tmin`/`tmax` ou se `--tupper ≤ --tbase`.

**Leitura esperada:** `residual` e `ometto` coincidem enquanto $T_{min} \ge T_b$ (na soja do Cerrado, quase sempre); `ometto-tb` acumula menos nos dias com $T_{max} > T_B$, então **nenhuma janela de `ometto-tb` começa antes da correspondente em `residual`** e as transições F2–F4 tendem a ficar alguns dias mais tarde nos meses quentes, com o fim do ciclo igual ou posterior. Em safras de emergência em dezembro–janeiro, com menos dias acima de 30 °C, a diferença é menor.

**Critério de aceitação:** **não há** — o caso é descritivo. Registrar, por série, os três calendários e as diferenças de dias por janela; na dissertação, uma tabela (série × método × janela: início, fim, dias; fim do ciclo; GDA ao fim) e a discussão do efeito sobre o $\overline{Ks}$ por janela e a produtividade predita do Caso 2.

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
├── yield_predicted_vs_observed.csv
├── gda_methods.csv
└── qm_bias_correction.png
```

`gda_methods.csv` é a junção dos CSVs do Caso 5 (`metodo;janela;inicio;fim;dias;gda_fim`, uma série por bloco: sintética e célula de Goiânia).

---

## Cronograma de Validação

| Etapa | Quando | Responsável |
|---|---|---|
| Validação ET₀ (Caso 1) | Após implementação de `et0.calculator.ts` | Heb + dev |
| Validação balanço hídrico e produtividade predita × observada (Caso 2) | Motor pronto (`engine/water-balance.ts`, `engine/yield.ts`); exige safras históricas com produtividade observada | Heb + dev |
| Validação QM (Caso 4) | Após implementação de `era5_bias_correct.py` | Heb + dev |
| Comparação de métodos de graus-dia (Caso 5) | Motor 2.1.0 (`engine/gda.ts`, Ometto); série sintética imediata, célula de Goiânia após o backfill | Heb + dev |
| Relatório final de validação | Antes da defesa da dissertação | Heb |
