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

## Momentos de estresse × veranicos (Caso 2, complemento; questão nº 14)

```bash
DATABASE_URL=postgresql://... pnpm msa:validate-stress -- --harvest <uuid> --station 83423 --out dados/stress.csv
pnpm msa:validate-stress -- --harvest <uuid> --ks-threshold 0.8 --min-days 5   # sensibilidade
```

Lê a última run da safra, recalcula os eventos (`detectStressEvents`) e confronta com os veranicos da estação (`station_daily_obs`, chuva < `--dry-mm` por ≥ `--min-days`). Sem `--station`, usa a estação da calibração QM ativa da célula. Funções puras em `stress-methods.ts` (testadas).

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

## Entressafra (Caso 2 — sensibilidade do spin-up ao Kc)

```bash
cd backend
DATABASE_URL=postgresql://... pnpm msa:validate-preseason -- --cell -16.7,-49.3 --emergence 2025-11-01
pnpm msa:validate-preseason -- dados/celula.csv --emergence 2025-11-01 --kc 0.4,0.7,1.0 --zr-mode zrMax --out dados/preseason.csv
```

Roda o balanço de `preSeasonStart(emergência)` (último 1º de fevereiro) até a véspera da emergência para cada Kc (padrão 0,4; 0,7; 1,0), com a cultivar de referência, solo padrão 0,28/0,12 (`--soil fc,wp`) e altitude 741 (`--altitude`), e imprime por Kc: dias, chuva e ET₀ acumuladas, depleção ao fim da entressafra (mm e % da TAW do perfil, `--zr-mode zrMax` padrão ou `zrIni`) e depleção convertida para a zona radicular inicial (mm e % de TAW(zrIni)) — a condição inicial do balanço da cultura. Série incompleta encerra com código 1 listando as datas. `--out` grava `kc;zr_m;dias;chuva_mm;et0_mm;dr_pre_mm;dr_pre_pct;dr_ini_mm;dr_ini_pct`. Descritivo: alimenta a comparação com Thornthwaite-Mather em planilha (Caso 2) e a questão aberta #11.
