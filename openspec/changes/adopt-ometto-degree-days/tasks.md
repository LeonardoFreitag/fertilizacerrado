## 1. Motor (`backend/src/modules/msa/engine`)

- [x] 1.1 `gda.ts`: `dailyGDA(tmax, tmin, tBase, tUpper?)` com os cinco casos de Ometto (1981), teto `TB − Tb` para Tmin ≥ TB, TB só quando Tmax > TB, `RangeError` para Tmax < Tmin / não finito / `tUpper ≤ tBase`, clamp final; `accumulateGDA(series, tBase, tUpper?)`; JSDoc com as equações e a referência coerente
- [x] 1.2 `types.ts`: `CultivarParams.tUpper: number | null` (JSDoc); `water-balance.ts` passa `cultivar.tUpper ?? null`; `index.ts` `ENGINE_VERSION` 2.1.0 (e teste em `yield.test.ts`)
- [x] 1.3 `gda-phenology-kc.test.ts`: os sete cenários numéricos (13; 3,571; 0; 16,43; 10,77; 20; 15), bordas (Tmin = Tb; Tmax = TB; Tmax = Tmin; Tmin ≥ TB), continuidade, regressão com o residual sem TB, entradas inválidas, `accumulateGDA` com TB (16,43; 29,43; 40,20); `invariants.test.ts`: `tUpper` nulo em metade dos casos ou em `(tBase + 5, 45]`, invariante `0 ≤ gda ≤ tUpper − tBase` por dia; `test-fixtures.ts` `SOJA` com `tUpper 30`

## 2. Cultivar: schema, migration, seed, API

- [x] 2.1 `prisma/schema.prisma`: `Cultivar.tUpper Float? @map("t_upper")`; migration aditiva `adopt_ometto_degree_days` (`ADD COLUMN t_upper`; `UPDATE cultivars SET t_upper = 30`; `UPDATE ... reference_snapshot = reference_snapshot || '{"tUpper": 30}' WHERE is_default = false AND reference_snapshot IS NOT NULL`); `reference-cultivars.ts` com `tUpper: 30` e nota "provisório — questão #10"; seed inalterado em lógica (passa pelo schema)
- [x] 2.2 `cultivar-params.schema.ts`: `CULTIVAR_PARAM_KEYS` com `tUpper` (16), `NULLABLE_PARAM_KEYS = ['tUpper']`, `cultivarParamsShape.tUpper = z.number().min(15).max(50).nullable()`, `refineCultivarParams` com `tUpper > tBase` (erro em `tUpper`), `CultivarParams` com `tUpper: number | null`, `pickCultivarParams` copiando `null` nas chaves anuláveis; `cultivar.service.ts` (`scientificParams`, `fieldsToSync` com `null === null`), `msa.service.ts` (`snapshotCultivar`, `resolveInterval` com `tUpper`); testes de DTO (null aceito, `tUpper ≤ tBase` → `tUpper`, faixa, 16 chaves, PATCH `tBase` que alcança `tUpper`) e de serviço (snapshot com `tUpper`; `cultivarChangedSinceRun` com snapshot 2.0.0 ⇒ true; `resolveInterval` com TB termina igual ou depois)
- [x] 2.3 `scripts/e2e/e2e-cultivars-harvests.sh`: referência com `tUpper 30`, `PARAMS` com `tUpper`, criação com `null` e com 25, `tUpper 10` → 400 em `tUpper`, PATCH `tUpper: null` → 200, sync `unchanged` após `UPDATE t_upper = 32` na referência → `updatedFields ["tUpper"]`, "16 parâmetros"; `e2e-msa.sh`: `engineVersion 2.1.0`, snapshot com `tUpper`, "16 parâmetros"; rodar a migration num banco de rascunho (referência + própria com snapshot) e no dev

## 3. Frontend (`frontend/src`)

- [x] 3.1 `lib/api/types.ts` (`CULTIVAR_PARAM_KEYS` com `tUpper`, `CultivarParams.tUpper: number | null`, `NULLABLE_PARAM_KEYS`), `lib/validation/cultivar.ts` (campo opcional: vazio ⇒ `null`, faixa 15–50, regra `tUpper > tBase`; grupo Térmicos com "Temperatura-base superior" e a ajuda), `lib/cultivars/reference.ts` (`toNumbers` devolve `null` para vazio nas chaves anuláveis; `divergentFields`/`fieldsToSync` comparam `null` como valor) com testes
- [x] 3.2 `CultivarFormPage`: `toValues` (`null` → `''`), envio com `tUpper: null` quando vazio, "ref. 30,0" / "ref. —" na divergência, `cultivarDiff` cobrindo `null`; `CultivarsPage` inalterada salvo tipos; `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [x] 3.3 e2e `msa.spec.ts` (teste "nova cultivar"): confere `#tUpper` pré-preenchido com 30, apaga e vê "ref. 30,0", repõe 30; `pnpm e2e` verde

## 4. Validação (`backend/scripts/validation`)

- [x] 4.1 `gda-validate.ts` + script `msa:validate-gda` no `package.json`: entradas (CSV / `--synthetic` / `--cell` via Prisma), três métodos, tabela por janela, diferença de dias, `--out` CSV, erros de coluna e de `--tupper ≤ --tbase`; teste unitário das funções puras (janelas por método) e execução com `--synthetic 150` e com a célula de Goiânia em cache; `README.md` da pasta
- [x] 4.2 `docs/msa/validacao.md` Caso 5 (procedimento, saída, uso na dissertação) e `docs/msa/roteiro-validacao.md` (nova fase correspondente)

## 5. Docs, manual e operação

- [x] 5.1 `docs/msa/algoritmos.md` §1: cinco equações, convenções (TB só com Tmax > TB; teto; Tmax = Tmin), exemplo numérico (34/20 → 16,43 vs 17), nota de que o residual é o caso 1, implementação; `CLAUDE.md` (TB = 30 °C provisório na tabela da soja; `ENGINE_VERSION` 2.1.0); `docs/modulos/msa.md` §1 (16 parâmetros, `tUpper`) e §3 (Ometto, 2.1.0)
- [x] 5.2 `docs/msa/questoes-abertas.md`: #10 (valor de TB para soja e convenção Tmin ≥ TB), #11 (Kc/Zr da entressafra) e #12 (regra da data de início do balanço), registrados como decorrentes da reunião com o professor Adilson; entrada no "Registro de decisões"
- [x] 5.3 Manual: cap. 04 (campo "Temperatura-base superior" no grupo Térmicos, com a explicação do efeito) e cap. 08 (glossário "Temperatura-base superior (TB)" e GDA citando Ometto); `pnpm manual:capture` e `pnpm manual:pdf` refeitos; valores marcados do cap. 06 atualizados a partir do novo `captura.json`
- [x] 5.4 Stack de dev: migration aplicada, seed, "Processar todas as safras ativas" e painel mostrando `engineVersion 2.1.0`; README (nota pós-deploy: reprocessar após o motor 2.1.0); `pnpm test` backend/frontend, e2e shell e Playwright verdes
