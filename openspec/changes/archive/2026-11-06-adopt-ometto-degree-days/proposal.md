## Why

O motor calcula graus-dia pelo método residual simples (`max((Tmax+Tmin)/2 − Tbase, 0)`, `engine/gda.ts`), embora `docs/msa/algoritmos.md` §1 e o JSDoc citem OMETTO (1981) como fonte — referência e fórmula não coincidem. Em reunião com o professor Adilson ficou acordado adotar de fato o **método de Ometto** (cinco situações, com temperatura-base inferior Tb e superior TB). No Cerrado, Tmin raramente cai abaixo de Tb na janela da soja; o efeito relevante é o dos dias com Tmax > TB (set–nov), que hoje acumulam calor a mais e antecipam F2–F4 no calendário. Como as janelas definem Ks̄ por janela, Ky, índice do ciclo e produtividade predita, esta change vem antes do balanço de entressafra e da timeline de estresses.

## What Changes

- **Motor (`msa-engine`)**: `dailyGDA(tmax, tmin, tBase, tUpper?)` implementa Ometto (1981):
  1. Tb < Tmin ≤ Tmax → (Tmax−Tmin)/2 + (Tmin−Tb)
  2. Tmin < Tb < Tmax → (Tmax−Tb)² / [2(Tmax−Tmin)]
  3. Tb ≥ Tmax → 0
  4. Tb < Tmin ≤ TB < Tmax → [2(Tmax−Tmin)(Tmin−Tb) + (Tmax−Tmin)² − (Tmax−TB)²] / [2(Tmax−Tmin)]
  5. Tmin < Tb < TB < Tmax → ½[(Tmax−Tb)² − (Tmax−TB)²] / (Tmax−Tmin)
  Convenções: `tUpper` nulo → só casos 1–3; Tmin ≥ TB → GD = TB − Tb (teto); Tmax = Tmin → sem divisão (cai no caso 1 ou 3); Tmax < Tmin → `RangeError`; resultado sempre em [0, TB − Tb] (ou ≥ 0 sem TB). `accumulateGDA`, `runDailyBalance` e `resolveInterval` (`msa.service.ts`) passam `tUpper`. `ENGINE_VERSION` 2.0.0 → 2.1.0 (resultado muda para a mesma entrada; interface compatível — parâmetro opcional).
- **Cultivar (`cultivar-management`)**: 16º parâmetro científico `tUpper` (`t_upper Float?`, °C), validação `tUpper > tBase` quando informado, em `cultivarParamsSchema`, `CultivarParams`, `referenceCultivar('SOJA')`, `referenceSnapshot` e `cultivarSnapshot` da run. Migration: referência de soja recebe **30 °C** (provisório — questão aberta #10); cultivares próprias recebem o mesmo valor **e** `reference_snapshot.tUpper = 30`, de modo que o campo conte como "não alterado" e o sync `unchanged` o acompanhe quando a referência mudar. `GET /cultivars/reference` e `sync-reference` já cobrem o campo por construção (iteram os parâmetros).
- **Processamento (`msa-processing`)**: snapshot com `tUpper`; `cultivarChangedSinceRun` (união de chaves) acusa divergência em runs 2.0.0 sem `tUpper` → painel sugere reprocessar.
- **Web (`web-cultivars`)**: campo "Temperatura-base superior (°C)" no grupo térmico, pré-preenchido pela referência, com regra cruzada `> tBase`, divergência e sync como os demais; ajuda explicando o efeito (dias acima de TB acumulam menos).
- **Validação (`msa-validation-tooling`)**: Caso 5 em `docs/msa/validacao.md` e script `pnpm msa:validate-gda` — para a célula de Goiânia em cache e a safra sintética, comparar datas de início/fim de F1–F4, dias por janela e GDA total em três métodos: residual, Ometto sem TB, Ometto com TB = 30; saída CSV + tabela para a dissertação.
- **Docs**: `algoritmos.md` §1 reescrito (cinco casos, convenções, exemplo numérico, referência Ometto 1981 agora coerente; nota de que o residual é o caso 1), `CLAUDE.md` (TB na tabela da soja; ENGINE_VERSION 2.1.0), `questoes-abertas.md` (novo #10: valor de TB para soja e convenção Tmin ≥ TB; registrar #11 Kc/Zr da entressafra e #12 regra da data de início do balanço como decorrentes da reunião, para a change seguinte), `docs/modulos/msa.md` (§1 e §3), manual cap. 04 (novo campo) e 08 (glossário: TB).
- **Operação**: após deploy, "Processar todas as safras ativas" (engineVersion 2.1.0).

## Capabilities

### New Capabilities
<!-- Nenhuma. -->

### Modified Capabilities
- `msa-engine`: requisito "Graus-dia" reescrito com os cinco casos e convenções; cenários com Tb = 10, TB = 30: (28/18) → 13; (20/6) → 3,571; (8/2) → 0; (34/20) → 16,43 (residual daria 17); (34/8) → 10,77; (32/31) → 20 (teto); (25/25) → 15; `tUpper` nulo e Tmin ≥ Tb → igual ao residual (regressão); invariantes: `0 ≤ gda ≤ tUpper − tBase`; `ENGINE_VERSION` 2.1.0.
- `cultivar-management`: `tUpper` opcional `> tBase`; referência com 30; snapshot e `referenceSnapshot` com 16 parâmetros; sync cobre o campo.
- `msa-processing`: `resolveInterval` usa Ometto; snapshot com `tUpper`; 2.1.0.
- `web-cultivars`: campo, regra cruzada, divergência.
- `msa-validation-tooling`: Caso 5 e `msa:validate-gda`.

## Impact

- `backend/src/modules/msa/engine/{gda,types,water-balance,index}.ts` e testes (`gda-phenology-kc.test.ts`: cinco casos, bordas Tmin = Tb, Tmax = TB, Tmax = Tmin, Tmin ≥ TB; `invariants.test.ts`); `msa.service.ts` (`resolveInterval`, snapshot); `cultivars/` (schema zod, service, `reference-cultivars.ts`, seed); `prisma/schema.prisma` + migration (`t_upper`, update de referência e próprias, `reference_snapshot`); `scripts/validation/gda-validate.ts` + `package.json`; `frontend/src/features/cultivars`, `lib/api/types.ts`, `lib/validation/cultivar.ts`, `lib/cultivars/reference.ts`.
- API: `tUpper` nos payloads e respostas de cultivar (opcional); sem outra mudança.
- Exige reprocessamento das safras ativas; runs 2.0.0 ficam no histórico (o painel avisa "parâmetros da cultivar mudaram" por causa do `tUpper` ausente no snapshot).
- Manual: a captura precisa ser refeita — os números do capítulo 06 (índice, predita) mudam com as janelas.

## Non-goals

- Balanço de entressafra a partir de fevereiro (change seguinte).
- Timeline de estresses e leitura do produtor.
- Mudar Tb da soja (permanece 10 °C) ou definir o valor final de TB (questão #10).
