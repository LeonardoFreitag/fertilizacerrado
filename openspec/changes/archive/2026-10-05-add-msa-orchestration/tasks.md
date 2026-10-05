## 1. Banco e dependências

- [x] 1.1 Adicionar ao `schema.prisma` o enum `MsaRunReason`, `reason`/`jobId` em `MsaRun` e `jobId`/`updatedAt` em `Era5IngestionRun`; gerar e aplicar a migration `add_job_tracking` (usar `migrate dev`; se recusar, `migrate diff --from-url <banco>`, nunca o banco como shadow)
- [x] 1.2 `pnpm add bullmq` (+ `cron-parser` em dev para o teste do cron); `requirements.txt` com `bullmq` e `redis`; rebuild do `etl`

## 2. Infraestrutura de filas (Node)

- [x] 2.1 `src/config/queue.ts`: conexão BullMQ a partir de `REDIS_URL` (`maxRetriesPerRequest: null`), nomes das filas, `Queue`s e `FlowProducer` compartilhados, fechamento
- [x] 2.2 `src/modules/jobs/flows.ts` (puro): `WEEKLY_CRON`/`WEEKLY_TZ`, `buildWeeklyFlow(date)`, `buildBackfillFlow(harvest, cell, from, to)`, `planHarvestJobs(coverage, from, limit)`, `jobIds`; testes unitários (árvores, ids determinísticos, próxima segunda 02:00 `America/Sao_Paulo` via `cron-parser`)
- [x] 2.3 `src/modules/jobs/jobs.service.ts`: `enqueueProcess`, `scheduleHarvestProcessing` (cobertura → flow/direto, erro logado ⇒ `null`), `enqueueIngestLatest`, `enqueueBackfillRegion`, `enqueueProcessAll`, `queueCounts` (+ `nextRun`), `getJob`

## 3. Worker Node

- [x] 3.1 `msaService.processHarvestAsSystem(harvestId, { seed, reason, jobId })` (sem escopo, `triggeredById` nulo) e `reason`/`jobId` em `processHarvest`
- [x] 3.2 `src/worker.ts`: workers `msa-process` (concorrência 4) e `msa-weekly` (`trigger` cria o flow; `run` enfileira `msa-process WEEKLY` por safra ativa com `jobId` determinístico), `upsertJobScheduler` do semanal, `SIGTERM`/`SIGINT` com `close()` + `$disconnect()`; script `worker` no `package.json` e `build` incluindo `dist/worker.js`

## 4. API

- [x] 4.1 `POST .../msa/process`: enfileira (202 `{ jobId, queue }`) por padrão; `?sync=true` só `ADMIN` (403 `SYNC_ADMIN_ONLY`) mantém o inline; DTO da query
- [x] 4.2 `harvestService.create` chama `jobsService.scheduleHarvestProcessing`; resposta com `msaJobId`
- [x] 4.3 `src/modules/jobs/{jobs.routes,jobs.controller,dtos}.ts` em `/api/v1/admin/jobs` (`ADMIN`): `GET /queues`, `GET /:queue/:id` (404), `POST /ingest-latest`, `POST /backfill-region`, `POST /process-all`; montar em `app.ts`
- [x] 4.4 `pnpm typecheck`, `pnpm build`, `pnpm test`

## 5. Worker Python

- [x] 5.1 `download.py`: `quarters_covering`, `cache_path_quarter`, `fetch_range` escolhendo mês (≤ 2 meses) ou trimestre (reaproveitando 3 mensais em cache), `build_request` com vários meses; testes unitários
- [x] 5.2 `db.py`: `job_id`/`updated_at` nas runs, `touch_run` (heartbeat), `mark_orphaned_runs(hours=6)`, células dentro de uma bbox; `cli.py`: subcomando `worker`, `job_id` nas runs do CLI nulo
- [x] 5.3 `era5/worker.py`: `Worker` BullMQ (`era5-ingest`, concorrência 1), despacho por `kind`, progresso por mês, heartbeat, run por job, `SIGTERM` gracioso, órfãs na subida; `CMD ["worker"]` no Dockerfile
- [x] 5.4 Testes: unitários do despacho (`kind` inválido), integração `mark_orphaned_runs` (run com `updated_at − 7 h` vira `FAILED orphaned`; recente fica); `pytest` no contêiner

## 6. Compose e ambiente

- [x] 6.1 `docker-compose.yml`: serviço `worker` (hot-reload), `etl` sem profile com `command: worker`, `REDIS_URL` e `depends_on redis`; `docker-compose.prod.yml`: `worker` (imagem da API, 1 réplica, `restart: always`, redes), `etl` idem; `.env.example` comentado; `docker compose config` dev e prod válidos
- [x] 6.2 `docker compose up -d --build`; confirmar `worker` e `etl` consumindo (logs), scheduler registrado (`GET /admin/jobs/queues` com `nextRun` em segunda 05:00 UTC)

## 7. Ponta a ponta e documentação

- [x] 7.1 Ajustar `e2e-msa.sh` (processamento síncrono via `?sync=true` com admin; agrônomo recebe 202/403) e `e2e-cultivars-harvests.sh` (`msaJobId` na resposta)
- [x] 7.2 `backend/scripts/e2e/e2e-orchestration.sh`: safra com emergência 2025-11-01 na célula em cache ⇒ `msaJobId` ⇒ aguarda ⇒ run `SUCCEEDED reason BACKFILL` com `jobId`; `GET /admin/jobs/queues` e `/:queue/:id`; `process-all` ⇒ runs `MANUAL`; `POST .../process` 202; `sync` 403/201; `docker compose kill worker` com job ativo ⇒ `up` ⇒ concluído; run órfã simulada ⇒ `restart etl` ⇒ `FAILED orphaned`; `ingest-latest` real só com `ERA5_E2E_CDS=1`; 403 para agrônomo em `/admin/jobs`
- [x] 7.3 Rodar todos os roteiros sem falhas
- [x] 7.4 Docs: `era5-etl.md` (agendamento real com BullMQ, filas e payloads, trimestres, cache como volume, backfill regional, órfãs), `msa.md` (fluxo assíncrono, 202 + `jobId`, `sync`, `reason`, admin), `arquitetura.md` (processos `worker` e `etl`), README do ETL (modo worker), README dos roteiros
