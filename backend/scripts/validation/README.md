# Validação do motor MSA

Ferramentas do protocolo de `docs/msa/validacao.md`. Rodam no host, sem banco.

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

## Monte Carlo (Caso 3 — convergência)

```bash
cd backend
pnpm msa:validate-mc -- --synthetic 150 --cultivar soja --seed 2026
pnpm msa:validate-mc -- scripts/validation/examples/synthetic-cerrado-season.csv --cultivar soja
pnpm msa:validate-mc -- dados/safra.csv --cultivar milho --altitude 500 --soil 0.30,0.14 --seed 7 --out dados/mc.csv
```

Roda `runMonteCarlo` com 100, 500 e 1.000 iterações e **a mesma semente**, e imprime por janela F1–F4 o P50 do Ks médio nas três contagens, a variação relativa |P50₅₀₀ − P50₁₀₀₀| / P50₁₀₀₀ com o critério (< 0,5 %), P10/P90 a 1.000 iterações, o baseline e as iterações válidas; no fim, a redução de produtividade P50 por janela.

| Opção | Padrão | Observação |
|---|---|---|
| `<clima.csv>` ou `--synthetic [dias]` | — | CSV com `date, tmax, tmin, [tmean], tdew, u2, rn, precipitation`, ou série sintética determinística (`src/modules/msa/synthetic-season.ts`) |
| `--cultivar soja\|milho` | obrigatório | cultivar de referência (`src/modules/cultivars/reference-cultivars.ts`) |
| `--altitude <m>` | 741 | Goiânia |
| `--soil <fc,wp>` | 0.28,0.12 | Latossolo Vermelho típico |
| `--seed <n>` | 2026 | semente do PRNG (e da série sintética) |
| `--out <csv>` | — | grava os números por janela |
| `--write-weather <csv>` | — | grava a série de clima usada (foi assim que o exemplo foi gerado) |

`examples/synthetic-cerrado-season.csv` é a série sintética de 150 dias com semente 2026 — a mesma do teste automatizado de convergência.
