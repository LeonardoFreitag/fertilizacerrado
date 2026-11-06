# Validação do motor MSA

Ferramentas do protocolo de `docs/msa/validacao.md`. Rodam no host; só `msa:validate-gda --cell` usa o banco (`DATABASE_URL`).

## ET₀ (Caso 1 — CROPWAT)

```bash
cd backend
pnpm msa:validate-et0 -- scripts/validation/examples/fao56-examples.csv
pnpm msa:validate-et0 -- dados/goiania-cropwat.csv --out dados/goiania.comparison.csv
```

Lê um CSV com cabeçalho (vírgula, ponto decimal, sem aspas), calcula ET₀ com `src/modules/msa/engine` para cada linha e imprime RMSE, R², NSE e PBIAS com os critérios de aceitação. A comparação por linha (entrada, intermediários, ET₀, referência, erro) é gravada em `<entrada>.comparison.csv`, ou no caminho de `--out`.

| Coluna | Obrigatória | Observação |
|---|---|---|
| `id` ou `date` | não | identificação; `date` (YYYY-MM-DD) também fornece `doy` |
| `altitude` | sim | metros |
| `tmax`, `tmin` | sim | °C |
| `tmean` | não | °C; omitida → (tmax + tmin) / 2 |
| `tdew` \| `ea` \| `rhmean` \| `rhmax` + `rhmin` | uma via | °C, kPa ou % |
| `u2` \| `u10` | uma via | m/s; `u10` é convertido pela Eq. 47 |
| `rn` \| `rs` \| `n` | uma via | MJ/m²/dia; `n` = horas de sol (Eq. 35). `rs`/`n` exigem `lat` e `doy` (ou `date`) |
| `et0_reference` | sim | ET₀ de referência (CROPWAT), mm/dia |

`examples/fao56-examples.csv` reproduz os Exemplos 17 (Bangkok, mensal) e 18 (Bruxelas, diário) do FAO-56 como estão no livro; serve de teste de fumaça e de modelo para os dados do CROPWAT. Com menos de 3 observações, R² e NSE não são informativos — o script avisa.

Para dados do CLIMWAT/CROPWAT de Goiânia (tabela do Caso 1: T média, UR, u2, Rs), preencha `tmax`/`tmin` com os valores mensais da estação, `rhmean`, `u2`, `rs`, `lat` −16,63, `altitude` 741 e `doy` do dia 15 de cada mês.

## Balanço hídrico e produtividade (Caso 2 — safra histórica)

Não há script próprio: o Caso 2 usa a exportação CSV do painel (série diária) comparada ao CROPWAT 8.0 em planilha, conforme `docs/msa/roteiro-validacao.md` (Fase 2). Quando a safra histórica tem produtividade observada, compare também a `predictedYield` da run com a observada pelo erro relativo `(predita − observada) / observada` — `relativeError()` em `metrics.ts` — e registre o valor no relatório.

`examples/synthetic-cerrado-season.csv` é a série sintética de 150 dias (`syntheticSeason(150, 2026)` em `src/modules/msa/synthetic-season.ts`), usada pelos testes de serviço como safra de referência sem dados ERA5-Land.

## Graus-dia (Caso 5 — residual × Ometto × Ometto com TB)

```bash
cd backend
pnpm msa:validate-gda -- --synthetic 150                                  # safra sintética (semente 2026)
pnpm msa:validate-gda -- scripts/validation/examples/synthetic-cerrado-season.csv --out dados/gda.csv
DATABASE_URL=postgresql://... pnpm msa:validate-gda -- --cell -16.7,-49.3 --from 2025-10-25 --tupper 30
```

Para a mesma série, acumula graus-dia por três métodos — `residual` (`max((Tmax+Tmin)/2 − Tb, 0)`, o do motor ≤ 2.0.0, reimplementado no script), `ometto` (motor, sem TB) e `ometto-tb` (motor, TB = `--tupper`, padrão 30 °C) — e imprime, por método e janela F1–F4 da cultivar de referência, início, fim e dias; o dia em que `gdaTotal` é atingido; o GDA ao fim; e a diferença de dias `ometto-tb − residual`. Descritivo, sem critério de aceitação: alimenta a tabela da dissertação. `--out` grava `metodo;janela;inicio;fim;dias;gda_fim`.

| Opção | Padrão | Observação |
|---|---|---|
| `<clima.csv>` / `--synthetic [dias]` / `--cell lat,lon --from AAAA-MM-DD [--to …]` | — | CSV com `date, tmax, tmin`; sintética determinística; ou `era5_daily_data` da célula |
| `--tbase` | 10 | temperatura-base inferior (°C) |
| `--tupper` | 30 | temperatura-base superior (°C); deve ser > `--tbase` |
| `--cultivar` | soja | só a referência de soja nesta fase |
