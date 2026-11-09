## Why

O painel já calcula tudo o que o produtor precisa saber — Ks diário, Ks̄ por janela, redução por janela, índice do ciclo, produtividade predita e a água no solo na emergência — mas apresenta isso como um painel técnico: cartões com coeficientes, três gráficos e uma tabela. Na reunião de 2026-11-02, o professor Adilson pediu que, **ao final do painel, uma linha do tempo da cultura aponte os prováveis momentos de estresse sofridos e a produtividade esperada, pensando em como o produtor vai ler**. Esta change fecha a série decorrente da reunião: detecta os episódios de estresse como eventos (início, fim, duração, janela, água que faltou), atribui a perda de produtividade a cada janela em sacas e entrega uma leitura em linguagem simples no fim do painel — a mesma para todos os papéis, com o detalhe técnico acima dela. Resolve a questão aberta #4 (limiares de severidade).

## What Changes

- **Motor (`msa-engine`)** — novo `engine/stress.ts`, funções puras:
  - `detectStressEvents(series, cultivar, { ksThreshold, minDays })`: percorre só dias de cultura (ignora `PRE` e `COMPLETED`); dias consecutivos com `ks < ksThreshold` formam um evento quando duram ≥ `minDays`; cada evento traz `start`, `end`, `days`, `ksMin`, `ksMean`, `deficitMm = Σ(etc − etcAdj)`, `phases` (janelas atravessadas, com dias em cada), `dominantPhase` (a de mais dias; empate → a de maior Ky — por isso a cultivar entra na assinatura) e `kyDominant`. Um evento que cruza a fronteira de janela não é dividido.
  - `attributeYieldLoss(summaries, ym)`: perda sequencial por janela, `loss_j = Ym × Π_{k<j} f_k × (1 − f_j)` com `f_j = 1 − yieldReductionPct_j/100`, de modo que `Σ loss_j = Ym − Ya` exatamente (soma telescópica); devolve por janela `{ phase, factor, lossPct, lossScHa }` e o total. Sem Ym (`null`) devolve só fatores e percentuais (`lossScHa` nulo).
  - Severidade da **janela** passa a ser por perda, não por Ks: `windowSeverity(yieldReductionPct)` → ok < 5 %, atenção 5–15 %, crítico > 15 % (`LOSS_WARNING_PCT`, `LOSS_CRITICAL_PCT` exportadas; valores a confirmar — questão #4). Severidade do **dia** continua por Ks (`daySeverity(ks)`, 0,85 / 0,70), usada nos gráficos e nos eventos. `ENGINE_VERSION` 2.2.0 → 2.3.0 (funções novas; resultados existentes não mudam).
- **Processamento (`msa-processing`)**: a run grava `stressEvents` (JSON, com `ksThreshold` e `minDays` usados) e `yieldLoss` (JSON da atribuição), calculados da série no `runProcessing`; `GET /msa` devolve ambos; para a última run sem esses campos (motor ≤ 2.2.0) a API calcula na leitura a partir da série persistida e dos resumos (mesmas funções do motor), para não forçar reprocessamento; `GET /msa/runs` devolve os campos gravados (nulos nas runs antigas). Parâmetros `STRESS_KS_THRESHOLD` (padrão 0,70) e `STRESS_MIN_DAYS` (padrão 3) em `config/env.ts`, gravados na run.
- **Painel (`web-msa-dashboard`)** — nova seção final **"Como foi a safra"** (`SeasonStory.tsx`), igual para `PRODUTOR`, `AGRONOMO` e `ADMIN`, abaixo de tudo o que existe, com âncora no cabeçalho ("Ir para o resumo da safra"):
  1. **Linha do tempo da cultura** (`CropTimeline.tsx`): barra com as quatro janelas nomeadas em linguagem do campo (Germinação · Crescimento · Floração e enchimento · Maturação), datas, marcador de hoje, e sobre ela os **eventos de estresse** como segmentos vermelhos com rótulo curto ("12 dias sem água"); um marcador na emergência quando `emergenceDepletionPct ≥ 70` ("solo seco na emergência"). Tooltip e lista acessível com os mesmos dados.
  2. **Lista "Momentos de estresse"**: uma linha por evento, do mais danoso ao menos (ordem por `deficitMm × kyDominant`): "12 a 23 de janeiro · 12 dias · floração e enchimento · faltaram cerca de 40 mm · esta é a fase que mais pesa na produção". Sem eventos: "Nenhum período de falta de água relevante até agora".
  3. **"Produtividade esperada"**: número grande em sc/ha ao lado da potencial informada ("de 65 esperadas, 52"), perda total em sacas e %, e a frase de ciclo incompleto já existente; abaixo, **"De onde veio a perda"**: barras horizontais por janela em sacas (atribuição sequencial), com a janela de maior perda destacada e a leitura "A maior perda veio da floração e enchimento (−9,8 sc/ha)". Sem Ym: só percentuais e o convite a informar (quem pode).
  4. Rodapé fixo em uma frase: o que o número é e o que não é ("estimativa com base na água disponível no solo; não considera pragas, doenças, adubação ou granizo").
  - Os cartões por janela passam a colorir por severidade de **perda** (com o rótulo textual); os gráficos continuam com as linhas de referência de Ks e ganham as faixas dos eventos (hachura vermelha). CSV de resumos ganha `perda_sc_ha`; novo CSV `estresses-<safra>-<run>.csv`.
  - Textos: todas as frases da seção vêm de funções puras em `lib/msa/story.ts` (datas por extenso em pt-BR, plural, arredondamento a 0,5 saca e 5 mm), testadas.
- **Validação (`msa-validation-tooling`)**: novo `pnpm msa:validate-stress` — lista os eventos da última run de uma safra e os veranicos registrados pela estação pareada (dias consecutivos sem chuva ≥ 10 mm) e mostra a sobreposição; alimenta o Caso 2 (concordância de datas, sem critério fixo).
- **Docs**: `algoritmos.md` (§6: atribuição sequencial, prova de que soma Ym − Ya; **§7 novo**: eventos de estresse e severidades — o documento hoje vai até a §6, por isso §7 e não §9), `questoes-abertas.md` (#4 decidida com os limiares e sua natureza de convenção; novo #14: `STRESS_KS_THRESHOLD`/`STRESS_MIN_DAYS` a confirmar; registrar que a leitura do produtor está entregue), `modulos/msa.md`, `modulos/frontend.md`, `CLAUDE.md`, manual cap. 06 (seção "Como foi a safra" com prints) e cap. 08 (glossário: evento de estresse, perda por janela), recaptura.

## Capabilities

### New Capabilities
<!-- nenhuma -->

### Modified Capabilities
- `msa-engine`: eventos de estresse; atribuição de perda; severidade de janela por perda e do dia por Ks; `ENGINE_VERSION` 2.3.0.
- `msa-processing`: `stressEvents`, `yieldLoss`, `stressKsThreshold`, `stressMinDays` na run e em `GET /msa`; cálculo na leitura para a última run de motor anterior; 2.3.0.
- `web-msa-dashboard`: seção "Como foi a safra" (linha do tempo com eventos, lista, produtividade esperada, origem da perda, rodapé, âncora no cabeçalho); cartões por severidade de perda; faixas de evento nos gráficos; CSV de resumos com `perda_sc_ha` e CSV de estresses.
- `msa-validation-tooling`: script `msa:validate-stress` (eventos × veranicos observados) para o Caso 2.

## Impact

- `engine/stress.ts` (+ testes), `types.ts`, `index.ts`; `msa.service.ts`, `msa.repository.ts`, `msa.dto.ts`, `config/env.ts`, `config/stress.ts`, `.env.example`; migration aditiva (`msa_runs.stress_events JSONB`, `yield_loss JSONB`, `stress_ks_threshold`, `stress_min_days`); frontend `features/msa/{SeasonStory,CropTimeline}.tsx`, `PhaseCards`, `MsaCharts`, `MsaHeader`, `MsaPanel`, `lib/msa/{story,msa,csv}.ts`, `lib/api/types.ts` + testes; Playwright (seção presente para os três papéis; eventos visíveis na safra do manual, que tem F1 e F3 com perda alta); `scripts/validation/stress-validate.ts`; manual (recaptura, `captura.json`, PDF).
- Sem mudança de ETL, filas ou API além dos campos novos. Runs 2.2.0 continuam válidas: a leitura é calculada na consulta.

## Non-goals

- Projeção do restante do ciclo com climatologia (a predição segue "sem estresse daqui em diante").
- Alertas por e-mail/push de eventos (Fase 3).
- Relatório PDF da safra (Fase 3 — mas a seção "Como foi a safra" é desenhada para ser a primeira página dele).
- Resolver #11/#13 (entressafra) — os textos usam os campos existentes e se beneficiam automaticamente quando o método mudar.
