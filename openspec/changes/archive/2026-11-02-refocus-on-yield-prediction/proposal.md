## Why

Em reunião com o professor Adilson (Meteorologia e Climatologia Agrícola) o objetivo do MSA foi redefinido: **predizer a produtividade da soja frente à produtividade potencial informada para a safra**, com base no estresse hídrico por janela fenológica. Saem o módulo estocástico (Monte Carlo, P10/P50/P90) e os cenários de decisão de adubação (a/b/c, registro de decisão), que eram a camada de "suporte à decisão oportuna" da Fase 1; sai também a segunda cultura (milho). Esta change reduz o escopo **antes** das mudanças de método que virão (graus-dia de Ometto, balanço de entressafra), para não adaptar código que será removido. Inclui ainda a regra de produto levantada pelo professor: ninguém digita parâmetros de cultivar — uma nova cultivar nasce como cópia da referência tabelada.

## What Changes

- **Motor determinístico (`msa-engine`)**: remover `monte-carlo.ts`, `random.ts`, `decision.ts` e seus testes/fixtures; `index.ts` deixa de exportá-los. `yield.ts` ganha `cycleYieldIndex(summaries)` = Π_j [1 − Ky_j·(1 − Ks̄_j)] sobre as janelas alcançadas (FAO-33, combinação multiplicativa; janela não alcançada conta como 1) e `predictedYield(ym, index)` = Ym × índice. Tipos `MonteCarloOptions/Result`, `Percentiles`, `PhasePercentiles`, `DecisionInput/Scenarios` removidos. **BREAKING**: `ENGINE_VERSION` 1.0.0 → 2.0.0 (interface muda).
- **Safra (`harvest-management`)**: novo campo `expectedYield` (`expected_yield Float?`, sc/ha, > 0) informado pelo agrônomo/ADMIN na criação e editável via PATCH; sem ele a run grava o índice mas não a produtividade predita.
- **Processamento (`msa-processing`)**: `runProcessing` chama `runDailyBalance` + `summarizeByPhase` + `cycleYieldIndex` uma vez. `MsaRun` perde `seed`, `iterations`, `sigmaPrecip`, `sigmaTemp` e ganha `expectedYield` (snapshot da safra no momento), `yieldIndex`, `predictedYield`, `phasesReached` (0–4). `MsaPhaseSummary` perde `validIterations` e as nove colunas `*P10/P50/P90`. **BREAKING**: tabela `msa_decisions`, enum `MsaScenario`, rotas `GET /msa/decision`, `POST/GET /msa/decisions`, DTOs e serviço de decisão removidos. `ProcessOptions.seed` removido.
- **Só soja (`cultivar-management`)**: enum `Crop` fica apenas `SOJA` (migration falha se existir cultivar MILHO — ambiente de desenvolvimento); referência de milho sai de `reference-cultivars.ts`; DTOs e validações sem `crop` variável.
- **Nova cultivar pré-preenchida (`cultivar-management`, `web-cultivars`)**: `GET /cultivars/reference` devolve a referência de soja; o formulário "Nova cultivar" abre com os 15 parâmetros já preenchidos e marca, campo a campo, o que diverge da referência (também na tela de detalhe). Nova ação "Atualizar a partir da referência" (`POST /cultivars/:id/sync-reference`, só campos não alterados pelo técnico ou todos, conforme escolha) — para quando a referência mudar (ex.: TB confirmado na change seguinte). Para isso, **resolve a questão aberta #5**: edição de parâmetros científicos de cultivar em uso liberada (o `cultivarSnapshot` garante reprodutibilidade); painel avisa "parâmetros da cultivar mudaram desde esta run".
- **Painel (`web-msa-dashboard`)**: remover `DecisionPanel`, cenários, registro e lista de decisões; cartões sem P10/P50/P90 e sem iterações; cabeçalho sem semente. Novo bloco **Produtividade** no topo: Ym informada, redução por janela (Ky·(1−Ks̄) em %), índice do ciclo e **produtividade predita em sc/ha**, com o aviso "considera o restante do ciclo sem estresse" enquanto `phasesReached < 4`; sem Ym, mostra o índice e um link para informar. CSV de resumos sem as colunas de percentil; novo CSV não é necessário. Painel do PRODUTOR idem, somente leitura.
- **Safras (`web-harvests`)**: campo "Produtividade potencial (sc/ha)" no formulário de criação e na edição; lista mostra Ym e predita quando houver run.
- **Validação (`msa-validation-tooling`)**: remover Caso 3 e `mc-validate.ts` (`pnpm msa:validate-mc`); Caso 2 passa a comparar também a produtividade predita com a observada da safra histórica (métrica: erro relativo), quando disponível.
- **Docs**: `algoritmos.md` (§6 ampliado com a combinação do ciclo e a predição; §7 e §8 removidos; glossário), `arquitetura.md` (fluxo e "Conceito Operacional" reescritos para predição de produtividade; Fase 1 sem "Suporte à Decisão"), `CLAUDE.md` (sem Monte Carlo/cenários; só soja; `Ym` por safra), `questoes-abertas.md` (#1 removido como superado; #5 decidido; registrar a decisão da reunião), `docs/modulos/{msa,cultivares,safras,frontend}.md`, manual cap. 04, 05, 06 e 08 (imagens 06-11 a 06-17 saem), `docs/dissertacao/mapa-objetivos-evidencias.md` (**OE5 marcado como substituído — confirmar com a pesquisadora e o orientador antes do archive**).
- **Operação**: migration remove colunas/tabelas (sem conversão de dados — runs antigas são descartadas, pois o motor 2.0.0 não as reproduz); após deploy, "Processar todas as safras ativas".

## Capabilities

### New Capabilities
<!-- Nenhuma: todo o comportamento novo cabe nas capabilities existentes. -->

### Modified Capabilities
- `msa-engine`: remove requisitos de Monte Carlo, PRNG e cenários de decisão; adiciona "Índice de produtividade do ciclo" e "Produtividade predita" — cenários: Ks̄ = 1 em todas → índice 1; F3 com Ks̄ 0,70 e Ky 1,0 e demais 1 → 0,70; F2 0,90/Ky 0,8 e F3 0,80/Ky 1,0 → 0,92 × 0,80 = 0,736; janela não alcançada → fator 1 e `phasesReached` menor que 4; `predictedYield(65, 0,736)` → 47,84 sc/ha. `ENGINE_VERSION` 2.0.0.
- `msa-processing`: run determinística (uma execução do balanço); `MsaRun` com `expectedYield`, `yieldIndex`, `predictedYield`, `phasesReached`; resumos sem percentis; remoção de decisões, cenários e semente.
- `harvest-management`: `expectedYield` opcional > 0 na criação e no PATCH.
- `cultivar-management`: só `SOJA`; referência exposta em `GET /cultivars/reference`; criação pré-preenchida a partir da referência; `POST /cultivars/:id/sync-reference`; edição de parâmetros científicos de cultivar em uso liberada.
- `web-cultivars`: formulário pré-preenchido, marcação de divergência da referência, ação de sincronização, sem campo de cultura.
- `web-harvests`: campo "Produtividade potencial (sc/ha)" na criação e edição; lista com Ym e predita.
- `web-msa-dashboard`: bloco Produtividade; cartões e cabeçalho sem percentis/iterações/semente; sem painel de decisão; aviso de cultivar alterada desde a run; CSV sem percentis.
- `msa-validation-tooling`: Caso 3 removido; Caso 2 compara produtividade predita com observada (erro relativo) quando disponível.
- `user-management`: desativar usuário deixa de citar "decisões" entre os registros que mantêm a referência (a tabela `msa_decisions` deixa de existir).

### Removed Capabilities
- `msa-monte-carlo-decision` (já arquivada) — capability extinta; os requisitos que ela deixou em `msa-engine`/`msa-processing`/`web-msa-dashboard` são removidos pelos deltas acima.

## Impact

- **Backend**: `msa/engine/`, `msa.service.ts`, `msa.repository.ts`, `msa.controller.ts`, `msa.routes.ts`, `msa/dtos/`, `cultivars/`, `harvests/`, `prisma/schema.prisma` + migration destrutiva, seed, `scripts/validation/`, `package.json` (script removido), `synthetic-season.ts` e testes de serviço.
- **Frontend**: `features/msa` (remover `DecisionPanel.tsx`; alterar `PhaseCards`, `MsaHeader`, `MsaPanel`), novo `YieldSummary.tsx`, `features/harvests`, `features/cultivars`, `lib/msa` (CSV, tipos), `lib/api/types.ts`, e2e Playwright (cenário de decisão sai; entra Ym → produtividade predita).
- **API (BREAKING)**: endpoints de decisão removidos; payloads de run/resumo mudam; `crop` deixa de ser variável.
- **Dados (BREAKING)**: runs e decisões existentes são descartadas pela migration.
- **Sem mudança** em ETL, filas, Compose ou Nginx.

## Non-goals

- Método de Ometto / `tUpper` (change seguinte, `adopt-ometto-degree-days`).
- Balanço de entressafra a partir de fevereiro.
- Eventos de estresse na linha do tempo e leitura do produtor.
- Faixa de incerteza na produtividade predita (sem Monte Carlo, a predição é um valor único; incerteza climática fica para avaliação futura).
- Recomendação de calagem/adubação (Fase 2 segue como está em `arquitetura.md`).
