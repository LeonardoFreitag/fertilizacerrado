## Context

O MSA hoje processa cada safra com `runMonteCarlo` (1.000 iterações, σP 0,30, σT 0,6 °C, semente gravada na run), persiste percentis P10/P50/P90 por janela em `msa_phase_summaries`, gera cenários de decisão (a/b/c) sobre o P50 do Ks e registra a escolha do técnico em `msa_decisions`. O painel web expõe tudo isso (cartões com percentis, `DecisionPanel`, lista de decisões, CSV com percentis), o manual descreve os cenários (cap. 06, imagens 06-11 a 06-17) e o mapa da dissertação liga esse bloco ao OE5.

Após a reunião com o professor Adilson, o objetivo da Fase 1 passa a ser **predizer a produtividade da soja frente à produtividade potencial (Ym) informada por safra**, com a combinação multiplicativa do FAO-33 sobre as janelas fenológicas. Esta change reduz o escopo antes das mudanças de método (`adopt-ometto-degree-days`, balanço de entressafra), para que o código a ser adaptado seja só o que permanece.

Estado atual relevante para o desenho:
- `engine/yield.ts` já calcula `yieldReductionPct = Ky_j · (1 − Ks̄_j) · 100` por janela em `summarizeByPhase`; o índice do ciclo deriva diretamente desses resumos.
- `synthetic-season.ts` (gerador de safra sintética, usado por `msa.service.test.ts`, `decision.test.ts`, `monte-carlo.test.ts` e `mc-validate.ts`) e `engine/test-fixtures.ts` importam o PRNG de `engine/random.ts`.
- `cultivar.service.ts` congela os 15 parâmetros quando há safra (`CULTIVAR_IN_USE`); desde `add-msa-processing` toda run grava `cultivarSnapshot`, o que torna o congelamento redundante para reprodutibilidade.
- `Crop` é enum Prisma com `SOJA` e `MILHO`; o seed cria uma referência de milho em todo banco de desenvolvimento; `@@unique([name, crop, createdById])`.
- `HarvestsPage` já consulta `GET /harvests/:id/msa` por safra para o selo de severidade (`MsaBadge`).
- `docs/modulos/cultivares.md` e `docs/modulos/safras.md`, citados na proposta, não existem: cultivares e safras estão em `docs/modulos/msa.md` §1 e §2.
- Caso 2 do protocolo (`docs/msa/validacao.md`) é o balanço hídrico × CROPWAT; o script `msa:validate-balance` ainda não existe (roteiro, pendência 2).

## Goals / Non-Goals

**Goals:**
- Run determinística: um balanço diário, quatro resumos, um índice do ciclo e uma produtividade predita (quando há Ym).
- Remover por completo Monte Carlo, PRNG do motor, cenários e decisões (código, schema, API, painel, docs, manual, validação) em uma única migration destrutiva.
- Soja como única cultura, sem quebrar o modelo para uma eventual segunda cultura no futuro.
- Nova cultivar sempre nasce da referência tabelada; divergência visível campo a campo; sincronização com a referência quando ela mudar.
- Edição de parâmetros de cultivar em uso liberada, com aviso no painel quando a run foi calculada com parâmetros diferentes dos atuais.
- Documentação e dissertação coerentes com o novo objetivo.

**Non-Goals:**
- Método de Ometto / `tUpper` (change seguinte).
- Balanço de entressafra, eventos de estresse na linha do tempo, leitura do produtor.
- Faixa de incerteza na produtividade predita.
- Recomendação de calagem/adubação (Fase 2).
- Conversão de runs antigas (o motor 2.0.0 não as reproduz; são descartadas).
- Script `msa:validate-balance` (continua pendência do roteiro; o Caso 2 muda só no protocolo e nas métricas).

## Decisions

**1. Índice do ciclo calculado a partir dos resumos, não da série.** `cycleYieldIndex(summaries: PhaseSummary[]): CycleYield` devolve `{ yieldIndex, phasesReached, factors }`, com `factors[j] = 1 − yieldReductionPct_j / 100` para janela com `days > 0` e `1` para janela sem dias, `yieldIndex = Π factors` e `phasesReached = número de janelas com days > 0`. Fonte: FAO-33 (Doorenbos & Kassam, 1979), combinação multiplicativa para estádios sucessivos (`docs/msa/algoritmos.md` §6, a ampliar). Reaproveitar `yieldReductionPct` evita recalcular Ky·(1−Ks̄) em dois lugares e dispensa passar a cultivar. Como as janelas são contíguas, contar janelas com dias equivale à última janela alcançada. `predictedYield(ym, yieldIndex)` devolve `ym × yieldIndex`; lança `RangeError` para `ym ≤ 0` ou índice fora de [0, 1]. Alternativa descartada: calcular o índice dia a dia (Π sobre dias) — não é o método do FAO-33 e muda o resultado para a mesma entrada.

**2. `ENGINE_VERSION` 2.0.0.** A interface pública do motor perde `runMonteCarlo`, `generateDecisionScenarios`, `percentile`, `mulberry32`, `sampleNormal`, `uniform` e os tipos associados; ganha `cycleYieldIndex`, `predictedYield` e `CycleYield`. Pelo critério já documentado em `engine/index.ts` (major quando a interface muda), é 2.0.0.

**3. PRNG sai do motor, não do repositório.** `mulberry32`, `uniform` e `sampleNormal` passam a viver em `src/modules/msa/synthetic-season.ts` (que já se declara "gerador de dados de teste, não parte do motor científico") e `engine/test-fixtures.ts` passa a reexportá-los de lá. `random.test.ts` é removido; `synthetic-season.ts` mantém a semente 2026 para que `examples/synthetic-cerrado-season.csv` e os testes de serviço continuem válidos. O requisito "Invariantes com entradas aleatórias" do motor permanece, agora citando o PRNG dos fixtures. Alternativa descartada: manter `engine/random.ts` só para testes — contradiz a proposta e deixa uma exportação morta no motor.

**4. Aviso de ciclo incompleto.** O painel mostra "considera o restante do ciclo sem estresse" enquanto `phasesReached < 4` **ou** `currentPhase !== 'COMPLETED'` (F4 alcançada mas não concluída também é ciclo incompleto). `phasesReached` continua gravado e exibido como na proposta; o segundo critério usa um campo que `GET /msa` já devolve.

**5. `expectedYield` na safra e snapshot na run.** `harvests.expected_yield Float?` (sc/ha, `> 0` e `≤ EXPECTED_YIELD_MAX_SC_HA = 250` como teto de sanidade, constante nomeada no DTO do backend e na validação do frontend; `null` permitido no PATCH para limpar). No processamento, `MsaRun.expectedYield` recebe o valor da safra no momento; `predictedYield = expectedYield × yieldIndex` ou `null` sem Ym. Alterar Ym depois da run **não** recalcula nada: a predição é parte da run (reprodutibilidade), e o painel mostra a Ym da run. Para refletir uma Ym nova, o técnico reprocessa. Alternativa descartada: calcular `predictedYield` na leitura a partir da Ym atual — simples, mas quebra a correspondência run ↔ resultado e o histórico de runs mostraria valores diferentes dos gravados.

**6. Persistência e migration destrutiva única** (`refocus_yield_prediction`), em SQL manual na ordem:
   1. `DELETE FROM msa_runs` (cascata apaga série diária e resumos; `harvests.latest_run_id` vai a `NULL` pelo `ON DELETE SET NULL`).
   2. `DROP TABLE msa_decisions; DROP TYPE msa_scenario`.
   3. `msa_runs`: `DROP COLUMN seed, iterations, sigma_precip, sigma_temp; ADD COLUMN expected_yield DOUBLE PRECISION NULL, yield_index DOUBLE PRECISION NULL, predicted_yield DOUBLE PRECISION NULL, phases_reached INTEGER NULL` (nulos em `NEEDS_DATA`/`FAILED`).
   4. `msa_phase_summaries`: `DROP COLUMN valid_iterations` e as nove colunas `*_p10/p50/p90`.
   5. `harvests ADD COLUMN expected_yield DOUBLE PRECISION NULL`.
   6. `cultivars ADD COLUMN reference_snapshot JSONB NULL` (Decisão 9).
   7. Cultura: `DELETE FROM cultivars WHERE crop = 'MILHO' AND NOT EXISTS (safra)`; se ainda restar linha `MILHO`, `RAISE EXCEPTION` com instrução; depois recriar o enum `crop` só com `SOJA` (criar tipo novo, `ALTER COLUMN ... TYPE ... USING crop::text::crop_new`, dropar o antigo, renomear). O seed deixa de criar a referência de milho.
   A proposta diz "migration falha se existir cultivar MILHO"; refinamento: falha só se a cultivar de milho estiver **em uso**, porque a referência de milho existe em todo banco de dev por causa do seed e nunca teve safra.

**7. Resposta de `GET /msa` ganha `cultivarChangedSinceRun`.** A função pura `cultivarChangedSinceRun(snapshot, current)` itera sobre as chaves de `CultivarParams` (as chaves científicas presentes no snapshot/tipo, não uma lista fixa de 15 nomes) e devolve `true` se algum valor difere entre o `cultivarSnapshot` da run e a cultivar atual da safra (`HarvestForProcessing.cultivar`, já carregada por `accessibleHarvest`). Assim a change seguinte, ao adicionar `tUpper` a `CultivarParams`, entra na comparação sem editar a função. Cálculo na leitura, sem coluna nova: o estado "mudou desde a run" depende do agora, não do momento da run.

**8. Só soja, sem apagar a coluna `crop`.** O enum Prisma `Crop` fica com `SOJA`; a coluna, o `@@unique([name, crop, createdById])` e o `crop` no `cultivarSnapshot` permanecem (o snapshot de runs antigas já é descartado; o de runs novas continua trazendo `crop: "SOJA"`). O DTO de criação **rejeita** `crop` (mesmo tratamento de `isDefault`: 400 identificando o campo), o serviço grava `SOJA`; o filtro `?crop=` da listagem é removido; a resposta continua trazendo `crop`. No frontend, `Crop = 'SOJA'`, `CROP_LABELS` só com soja, formulário sem o campo. Alternativa descartada: remover a coluna — obrigaria a mexer no unique, no snapshot e em todos os selects, para um ganho nulo, e dificultaria uma segunda cultura no futuro.

**9. Referência e sincronização.**
   - `GET /cultivars/reference` (declarada antes de `/:id`) devolve a cultivar de referência de soja **do banco** (`isDefault = true`, `crop = SOJA`), 404 `REFERENCE_CULTIVAR_MISSING` se o seed não rodou. Fonte da verdade continua `reference-cultivars.ts` → seed → banco; a API lê do banco para ter `id` e os mesmos valores que a listagem.
   - `cultivars.reference_snapshot` (JSON com os 15 parâmetros) é gravado na criação com os valores da referência naquele momento; a referência em si tem `null`. É o que permite saber o que o técnico alterou: campo "não alterado" = valor atual igual ao do `referenceSnapshot`. Comparar com a referência **atual** não serve, porque, quando a referência muda, os campos que o técnico nunca tocou passariam a parecer alterados. A migration faz backfill das cultivares próprias existentes com os valores atuais da referência.
   - `POST /cultivars/:id/sync-reference` com `{ mode: "unchanged" | "all" }` (mesmas regras de permissão do PATCH; 403 `DEFAULT_CULTIVAR_READONLY` na referência): `unchanged` substitui só os campos iguais ao `referenceSnapshot`; `all` substitui os 15. Nos dois modos grava o novo `referenceSnapshot`, valida o estado resultante pelo `cultivarParamsSchema` e responde 200 com a cultivar e `updatedFields: string[]`.
   - Divergência campo a campo no frontend compara com a referência atual (`GET /cultivars/reference`) — é o que interessa a quem lê a tela.

**10. Edição de cultivar em uso liberada (questão aberta #5).** `cultivar.service.update` deixa de consultar `countHarvests` (que continua servindo ao `DELETE`). O formulário de edição mostra sempre a nota "Runs já calculadas guardam os parâmetros da época; as próximas usam os novos valores" e o painel exibe o aviso da Decisão 7. O `CULTIVAR_IN_USE` do PATCH e a tela "parâmetros congelados" saem (frontend, manual 04, imagem 04-05).

**11. Frontend.** `YieldSummary.tsx` novo, no topo do painel: Ym da run, tabela por janela (Ks̄, Ky·(1−Ks̄) em %), índice do ciclo, produtividade predita em sc/ha e o aviso da Decisão 4; sem Ym, mostra o índice e um link para editar a safra (`AGRONOMO`/`ADMIN`) ou o texto "produtividade potencial não informada" (`PRODUTOR`). `PhaseCards` perde percentis e iterações; `MsaHeader` perde a semente e ganha o aviso de cultivar alterada; `MsaPanel` perde `DecisionPanel`; `lib/msa` perde `formatPercentiles` e as colunas de percentil do CSV de resumos. A lista de safras reutiliza o hook `useMsaLatest` já usado pelo `MsaBadge` para mostrar Ym e predita — sem campo novo na API de safras. Formulário de safra ganha "Produtividade potencial (sc/ha)" (opcional) na criação; o detalhe permite editar via PATCH junto das notas.

**12. Validação.** `mc-validate.ts`, `pnpm msa:validate-mc`, Caso 3 do protocolo e Fase 3 do roteiro saem. `metrics.ts` ganha `relativeError(predicted, observed) = (predicted − observed) / observed` e o Caso 2 passa a prever, quando a safra histórica tem produtividade observada, a comparação da `predictedYield` da run com a observada (sem critério de aceitação fixo nesta change; registrar o valor no relatório). Não há script novo: o Caso 2 continua sendo executado pela exportação CSV + CROPWAT + planilha, como no roteiro.

**13. Docs e manual.** `algoritmos.md` §6 ganha a combinação do ciclo e a predição (fórmula, convenções: janela não alcançada = 1, `phasesReached`), §7 e §8 saem, glossário sem σ/P/semente e com Ym, Ya, índice. `arquitetura.md`: tabela da Fase 1 sem "Suporte à Decisão", fluxo sem Monte Carlo, "Conceito Operacional" reescrito para predição de produtividade retrospectiva por janelas. `CLAUDE.md`: seções Monte Carlo e Cenários removidas; "Só soja"; "Ym informada por safra". `questoes-abertas.md`: #1 removida (superada), #5 marcada como decidida (edição liberada, snapshot garante reprodutibilidade), registro da decisão da reunião na seção final. `docs/modulos/msa.md`: §4 e "Cenários de Decisão" saem, §1–2 (cultivares/safras) ganham referência/sync e Ym, endpoints atualizados. Manual: cap. 04 sem "parâmetros bloqueados" e com "nova cultivar nasce da referência"/"atualizar a partir da referência"; cap. 05 com a Ym; cap. 06 sem cenários/decisões e com a seção "Produtividade"; cap. 08 sem Monte Carlo/percentis e com Ym/índice. Captura: imagens 06-12 a 06-17 e 04-05 removidas, `06-11-produtividade.png` e `04-05-divergencia-da-referencia.png` reaproveitam os números; `captura.json` passa a registrar Ym, índice e predita (o `manual-check` já confere valores marcados no cap. 06). `mapa-objetivos-evidencias.md`: OE5 marcado como substituído pelo objetivo de predição, com as evidências novas (índice por janela, predita × observada).

## Risks / Trade-offs

- **Migration destrutiva apaga todas as runs e decisões** → aceito pela proposta (dev); o `README` de operação instrui "Processar todas as safras ativas" após o deploy; backup (`db-backup`) antes de migrar em qualquer ambiente com dados.
- **Cultivar de milho em uso em algum banco** → migration falha com mensagem clara; resolver manualmente (concluir/cancelar não basta: a safra referencia a cultivar; é preciso apagar a safra ou trocar a cultivar via SQL).
- **F4 alcançada com poucos dias conta como "alcançada"** → o índice usa o Ks̄ parcial; o aviso da Decisão 4 cobre o caso porque `currentPhase` ainda não é `COMPLETED`.
- **Ym alterada depois da run não reflete no painel até reprocessar** → o painel mostra "Ym da run" e, se diferir da Ym atual da safra, oferece Reprocessar com a dica.
- **`referenceSnapshot` com backfill aproximado** → cultivares criadas antes desta change podem ter campos "não alterados" classificados errado se a referência mudar; o modo `all` do sync resolve, e o técnico vê a divergência campo a campo antes de confirmar.
- **Remoção de requisitos em specs já archivadas** (`msa-monte-carlo-decision`) → só os specs atuais são alterados; o archive é histórico.
- **OE5 da dissertação** → marcado como substituído, mas a reescrita do objetivo é da pesquisadora e do orientador; ver Open Questions.
- **Perda da faixa de incerteza** → a predição vira valor único; registrado em Non-goals e no §6 de `algoritmos.md` como limitação.

## Migration Plan

1. Merge com a migration e o seed novo; CI roda testes (motor, serviço, DTOs) e e2e shell atualizados (`e2e-msa.sh` sem decisões/semente, com `expectedYield`).
2. Deploy: `prisma migrate deploy` (apaga runs/decisões, altera enum, adiciona colunas); backup antes em ambiente com dados.
3. Pós-deploy: em `/admin`, "Processar todas as safras ativas" (runs 2.0.0).
4. Frontend e backend sobem juntos (payloads mudam); não há compatibilidade com o painel antigo.
5. Rollback: restaurar o backup e voltar a imagem anterior — as runs 2.0.0 não são legíveis pelo painel 1.x e vice-versa; não há rollback só de código.

## Open Questions

- **OE5 da dissertação**: a proposta pede marcar como substituído e **confirmar com a pesquisadora e o orientador antes do archive**. Redação sugerida do novo objetivo fica no mapa; a decisão não é desta change.
- **Teto de `expectedYield`**: adotado 250 sc/ha como sanidade (`EXPECTED_YIELD_MAX_SC_HA`; o recorde brasileiro de soja fica abaixo de 150). Confirmar com a pesquisadora; mudar é alterar a constante nos dois lados.
- **Produtividade observada da safra histórica** (Caso 2): nesta change entra só no protocolo e na métrica. Um campo `observedYield` na safra (para calcular o erro relativo no sistema) fica para avaliação futura.
