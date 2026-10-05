## Why

Todas as peças existem — clima real no banco, motor validado, safras com cultivar — mas nada as liga: nenhum resultado do MSA foi calculado para uma safra, nada é persistido e o técnico não tem endpoint para consultar. Esta change fecha o ciclo descrito em `docs/modulos/msa.md`: processar uma safra, guardar o resultado com tudo o que é preciso para reproduzi-lo, expor pela API e registrar a decisão do técnico. O processamento é síncrono (o Monte Carlo leva ~0,1 s); fila e agendamento ficam para a change seguinte.

## What Changes

- **Talhão** ganha `altitudeM`, `thetaFC` e `thetaWP` (opcionais no cadastro; migration, DTOs, SQL de escrita, resposta e docs). Sem altitude o processamento falha com 422 `MISSING_FIELD_ALTITUDE`; sem solo usa 0,28/0,12 (Latossolo Vermelho, `algoritmos.md` §5) e grava no snapshot.
- **Persistência** (migration): `msa_runs` (status `SUCCEEDED`/`FAILED`/`NEEDS_DATA`, intervalo, semente, iterações, sigmas, `cultivarSnapshot`, `soilSnapshot`, `engineVersion`, `missingDates`, `error`, `triggeredById`), `msa_daily_results` (série baseline, PK `runId, date`), `msa_phase_summaries` (PK `runId, phase`, resumo + percentis + `validIterations`), `msa_decisions` (escolha do técnico com o payload do cenário e a justificativa); `harvests.latestRunId` aponta para a última run `SUCCEEDED`.
- **`ENGINE_VERSION`** exportada pelo motor e gravada em cada run.
- **Serviço** `msa.service.ts`: `processHarvest` — carrega safra/talhão/cultivar, valida altitude, define o intervalo (emergência → min(hoje − 6, dia em que o GDA atinge `gdaTotal`)), verifica cobertura (lacuna ⇒ run `NEEDS_DATA` sem calcular, sem interpolar), roda `runMonteCarlo` + `summarizeByPhase` e grava run, série e resumos em transação; erro ⇒ run `FAILED`. Reprocessar cria run nova; o histórico é mantido.
- **Endpoints** sob `/api/v1/harvests/:id/msa` (escopo herdado da safra; `PRODUTOR` só leitura): `POST /process`, `GET /`, `GET /daily?runId=`, `GET /runs`, `GET /decision?phase&doseBase&efficiencyBase`, `POST /decisions`, `GET /decisions`.
- Testes: unitários do service com `era5.repository` e repositório MSA simulados (NEEDS_DATA, altitude ausente, snapshot fiel, mesma semente ⇒ resumos idênticos); `e2e-msa.sh` com 150 dias sintéticos inseridos via SQL para a célula de um talhão de teste.
- Docs: `docs/modulos/msa.md` (endpoints reais, persistência, regras) e `docs/modulos/propriedades.md` (novos campos do talhão).

Fora do escopo: fila BullMQ e cron (`ingest --latest` + reprocessamento semanal), notificações, relaxar `CULTIVAR_IN_USE` (o snapshot agora existe; a decisão fica para a Heb), `MULTIPOLYGON`, perfil de solo por laudo (módulo de Análise de Solo).

## Capabilities

### New Capabilities
- `msa-processing`: processamento do MSA por safra com persistência reproduzível (snapshots, semente, versão do motor), consulta de resultados e histórico, geração de cenários sobre a última run e registro da decisão do técnico.

### Modified Capabilities
- `field-management`: "Cadastro de talhão com polígono" e "Atualização de talhão" passam a aceitar `altitudeM`, `thetaFC` e `thetaWP`, com `thetaFC > thetaWP` validado sobre o estado resultante.

## Impact

- **Código**: novo `src/modules/msa/{msa.routes,msa.controller,msa.service,msa.repository}.ts` e `dtos/`; alterações em `harvest.routes.ts` (montagem de `/:id/msa`), `property.repository.ts`/`field DTOs`/`property.service.ts` (campos do talhão), `engine/index.ts` (`ENGINE_VERSION`), `prisma/schema.prisma`.
- **Banco**: 3 colunas em `fields`; 4 tabelas novas; `latest_run_id` em `harvests`; 2 enums.
- **API**: 7 rotas novas; `POST/PATCH .../fields` aceitam 3 campos a mais. Nenhuma rota existente muda de comportamento.
- **Dependências, ambiente**: nenhuma alteração.
