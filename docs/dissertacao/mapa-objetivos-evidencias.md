# Dissertação — Mapa Objetivos → Módulos → Evidências (base da seção 4.1)

> Cruzamento dos objetivos específicos (dissertacao_completa_v5, seção 1.1.2) com o que
> existe no repositório em 2026-10-20 (specs OpenSpec, docs/, código e testes),
> atualizado em 2026-11-02 após a reunião com o professor Adilson.
> Objetivo: saber, antes de escrever o Capítulo 4, o que já tem evidência e o que ainda
> precisa ser gerado. Status: ✅ pronto · 🟡 parcial · ❌ a gerar.

> **⚠️ OE5 substituído em 2026-11-02 — confirmar antes do archive.** A reunião com o
> professor Adilson redefiniu o objetivo do MSA para **predição da produtividade da
> soja frente à produtividade potencial por janela fenológica**; o módulo de Monte
> Carlo e os cenários de decisão foram removidos (change `refocus-on-yield-prediction`;
> `docs/msa/questoes-abertas.md`, "Registro de decisões"). A redação proposta abaixo é
> uma sugestão técnica: **a redação final do objetivo deve ser confirmada com a
> pesquisadora (Heb) e o orientador antes de a change ser arquivada**, e a seção
> 1.1.2 revisada em `secoes-independentes-de-campo.md` precisa ser ajustada.

## Tabela-síntese (proposta de Tabela 4.1)

| OE | Objetivo específico (resumo) | Módulo(s) entregue(s) | Onde está no repo | Evidência para o Cap. 4 | Status |
|---|---|---|---|---|---|
| OE1 | Pipeline Python de download, fatiamento e correção de viés (QM) do ERA5-Land | ETL Python 3.12 (contêiner próprio), worker `era5-ingest`, CLI, correção QM calibrada por estação INMET | `backend/etl/`, specs `era5-ingestion`, `era5-cell-assignment`, `era5-data-access`, `era5-bias-correction`, `weather-stations`; módulos `admin-qm`, `admin-stations`; `docs/msa/era5-etl.md` | (a) Diagrama do pipeline (já descrito em 3.2) · (b) Tabela de cobertura: células, período, nº de dias, tempo de ingestão por lote · (c) Gráfico Q-Q / ECDF antes × depois do QM para uma estação · (d) Métricas QM × INMET (Fase 4 do roteiro) · (e) 59 testes Python | (a) ✅ (b) ❌ (c) ❌ (d) ❌ (e) ✅ |
| OE2 | Banco geoespacial PostgreSQL/PostGIS + TimescaleDB com índice GiST e resposta sub-segundo | Schema Prisma com geometria PostGIS (talhões) e hipertabela TimescaleDB (série diária ERA5 por célula 0,1°) | `backend/prisma/schema.prisma`, `docker-compose.yml` (`timescale/timescaledb-ha:pg15`), specs `field-management`, `property-management` | (a) Diagrama ER simplificado (gerar a partir do `schema.prisma`) · (b) Volumetria das tabelas · (c) **Benchmark de consulta** (`EXPLAIN ANALYZE` das consultas do painel: série por talhão/safra, célula por ponto) — o objetivo promete sub-segundo, precisa de número | (a) ❌ (b) ❌ (c) ❌ |
| OE3 | Backend concorrente Node.js (worker threads + filas) para balanço hídrico FAO-56 diário | API REST Express + BullMQ/Redis; `worker.ts` com `processWorker` (job por safra) e `weeklyWorker` (lote semanal); motor MSA (ET₀, GDA/fenologia/Kc, balanço hídrico, Ks, Ky) | `backend/src/modules/msa/engine/`, `backend/src/modules/jobs/`, `backend/src/worker.ts`, specs `msa-engine`, `msa-processing`, `msa-orchestration`, `backend-runtime`; `docs/msa/algoritmos.md` | (a) Diagrama de sequência API → fila → worker → painel · (b) Tempo de processamento por safra (dias × ms) e por lote semanal · (c) Saída do balanço hídrico diário de um talhão real (figura) · (d) 2–3 telas do painel (reaproveitar `docs/manual/img/`) · (e) ~249 testes TS (motor, invariantes, fluxos) | (a) 🟡 (b) ❌ (c) ❌ (d) ✅ (e) ✅ |
| OE4 | Validação estatística contra pyfao56 e CROPWAT 8.0 | Ferramentas de validação (`msa:validate-et0`; `relativeError` em `metrics.ts` para predita × observada), protocolo e roteiro de execução, CI | `backend/scripts/validation/`, `docs/msa/validacao.md`, `docs/msa/roteiro-validacao.md`, spec `msa-validation-tooling`, `.github/workflows/ci.yml` | (a) Tabela RMSE/R²/NSE/PBIAS de ET₀ × CROPWAT (Fase 1) · (b) Balanço hídrico × CROPWAT (Fase 2) · (c) Resumo dos testes automatizados (nº, cobertura, CI) | (a) ❌ (b) ❌ (c) 🟡 |
| OE5 (original) | ~~Módulo estocástico Monte Carlo ponta a ponta com recomendação ajustada ao risco~~ **(substituído em 2026-11-02)** | ~~`monte-carlo.ts`, `decision.ts`, P10/P50/P90 por janela~~ — removidos do motor (`ENGINE_VERSION` 2.0.0) | histórico: `openspec/changes/archive/*msa-monte-carlo-decision*` | ~~convergência, distribuições, cenários, Shapiro-Wilk~~ | — |
| OE5 (substituto, redação sugerida) | Predizer a produtividade da soja frente à produtividade potencial informada por safra, a partir do estresse hídrico por janela fenológica, pelo índice de produtividade do ciclo (FAO-33) | `yield.ts` (`yieldReduction`, `summarizeByPhase`, `cycleYieldIndex` = Π_j [1 − Ky_j (1 − Ks̄_j)], `predictedYield` = Ym × índice); `expectedYield` (Ym) por safra; run com `yieldIndex`, `phasesReached`, `predictedYield`; bloco **Produtividade** no painel | `backend/src/modules/msa/engine/yield.ts`, `msa.service.ts` (`yieldFields`), specs `msa-engine`, `msa-processing`, `harvest-management`, `web-msa-dashboard`; `docs/msa/algoritmos.md` §6; `docs/msa/validacao.md` Caso 2 | (a) Tabela por janela de um talhão real: dias, Ks̄, Ky, Ky·(1−Ks̄), fator (1−RY) e índice do ciclo · (b) Predita × observada em safras históricas com erro relativo (`relativeError`, Fase 2.5 do roteiro) · (c) Tela do bloco Produtividade (`docs/manual/img/06-11-produtividade.png`) · (d) Discussão da limitação: valor único, sem faixa de incerteza | (a) ❌ (b) ❌ (c) 🟡 (d) ❌ |

## Desvios entre o texto dos objetivos e o que foi implementado

Precisam ser resolvidos antes do Cap. 4 (ou ajustando o objetivo, ou declarando o desvio na discussão):

1. **"worker threads" (OE3)** — a implementação usa *workers* BullMQ em processo separado (`worker.ts`), não `worker_threads` do Node. Sugestão de redação: "processos trabalhadores desacoplados por filas distribuídas (BullMQ/Redis)". É arquiteturalmente mais defensável (escala horizontal, reprocessamento, retry) do que threads.
2. **"pyfao56" (OE4)** — não há uso no repositório; o protocolo adota CROPWAT 8.0 + CLIMWAT e o pacote R `Evapotranspiration` como cálculo independente. Ou se roda o pyfao56 (é rápido: mesmo CSV do `validate-et0`), ou se troca a referência no objetivo.
3. **"TimescaleDB" (OE2)** — confirmado (imagem `timescaledb-ha:pg15`, hipertabela no schema). Sem desvio.
4. **Fonte de calibração** — o objetivo diz "INMET/ANA"; o implementado usa estações INMET (BDMEP). Conferir se ANA entrou; senão, remover do objetivo.

## O que ainda precisa ser gerado (ordem sugerida)

Ordenado por dependência: os itens 1–3 são pré-requisito do estudo de caso.

1. **Escolher o talhão e a safra do estudo de caso** (seção 4.7) e a estação INMET de referência mais próxima (≥ 10 anos de sobreposição, ≤ 50 km — critério do QM).
2. **Ingestão ERA5 completa do período** para a célula do talhão + importação BDMEP → gera (OE1-b) e (OE1-d).
3. **Validação QM (Fase 4)** → gráfico Q-Q/ECDF e métricas (OE1-c, OE1-d).
4. **Fase 1 — ET₀ × CROPWAT** (`msa:validate-et0` com CSV de Goiânia/CLIMWAT) → tabela (OE4-a). Script pronto; falta rodar e registrar em `validacao/notas.md`.
5. **Fase 2 — balanço hídrico × CROPWAT** → (OE4-b). Pendência: script `msa:validate-balance` ainda não existe (roteiro, pendência 2).
6. **Índice de produtividade do ciclo do talhão real** — processar a safra do estudo de caso com Ym informada e montar a tabela por janela (Ks̄, Ky·(1−Ks̄), fator, índice) a partir do CSV "Resumo por janela" → (OE5-a, OE5-c). *(Substitui a antiga convergência do Monte Carlo.)*
7. **Predita × observada** — levantar a produtividade colhida de uma ou mais safras históricas do talhão (o sistema não guarda a produtividade observada), reprocessar com a Ym de cada safra e calcular o erro relativo (roteiro, Fase 2.5) → (OE5-b); discutir a ausência de faixa de incerteza → (OE5-d). *(Substitui a antiga tabela de cenários de decisão; o confronto estático × dinâmico da seção 4.7 precisa ser reformulado ou retirado com a pesquisadora e o orientador.)*
8. **Benchmark de banco** — script com `EXPLAIN ANALYZE` das 3–4 consultas do painel em volume realista → (OE2-c).
9. **Medição de desempenho do worker** — instrumentar `processWorker` (tempo por safra) e o lote semanal → (OE3-b).
10. **Diagrama ER** a partir do `schema.prisma` (ex.: `prisma-erd-generator`) → (OE2-a).
11. **Unificar o sinal do PBIAS** nos dois scripts (roteiro, pendência 1) antes de publicar qualquer número.

## Material para a seção 4.8 (discussão do processo de implementação)

- **Desenvolvimento orientado a especificação:** 13 mudanças OpenSpec arquivadas (2026-10-03 a 2026-10-06) e 31 specs vigentes em `openspec/specs/` — cada módulo tem proposta, design e tarefas rastreáveis.
- **Decisões tomadas durante a implementação:** `docs/msa/questoes-abertas.md` registra os pontos levados à pesquisadora (dia UTC × local na agregação ERA5; fator de vento 0,748; limiares de Ks 0,85/0,70; defaults do QM; estação de referência Goiânia; talhões multipolígono; CREA obrigatório; nº 5 — edição de cultivar em uso — decidido; nº 1 — perturbação do MC — superado) e, em "Registro de decisões", a reunião de 2026-11-02 que redefiniu o objetivo (predição de produtividade; remoção do Monte Carlo, dos cenários e do milho). São o conteúdo natural de "decisões revistas / limitações".
- **Qualidade:** ~249 testes TypeScript (motor, invariantes, DTOs, fluxos, front) + 59 testes Python (ETL), executados em CI (`ci.yml`); testes de invariantes físicas do balanço hídrico.
- **Limitações a declarar:** lag ~5 dias do ERA5-Land; resolução ~9 km (uma célula pode cobrir vários talhões); processamento em lote semanal, sem tempo real; QM só para precipitação; dependência de estação INMET próxima para calibrar; produtividade predita como valor único (sem faixa de incerteza) e dependente da Ym informada pelo agrônomo.

## Material para o Capítulo 3 (nova seção 3.7 — Procedimentos de desenvolvimento)

Stack (Node 20 + TypeScript, Prisma, PostgreSQL 15 + PostGIS + TimescaleDB, Redis 7 + BullMQ, Python 3.12 para ETL, React + Tailwind), conteinerização (Docker Compose dev/prod, Nginx), desenvolvimento orientado a especificação (OpenSpec), testes automatizados (Vitest/pytest) e integração contínua, critérios de aceitação por módulo (specs), e o protocolo de validação já descrito em 3.5.
