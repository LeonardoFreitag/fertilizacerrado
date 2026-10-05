## Context

Redis 7 já está na stack (limite de login). `msaService.processHarvest` é síncrono e exige um `AuthUser` para o escopo. O ETL é um CLI Python invocado por `docker compose run`, com cache mensal por `(bbox, mês)` no volume `etl_cache` — 16 meses da célula de Goiânia já baixados. As runs do ETL não têm `job_id` nem heartbeat; uma run interrompida por fora fica `RUNNING` para sempre (registrado como pendência na change de ingestão). O BullMQ tem implementação oficial em Node e em Python compartilhando os mesmos scripts Lua, o que permite um fluxo pai/filho entre as duas linguagens.

## Goals / Non-Goals

**Goals:**

- Segunda-feira 02:00 (horário de Brasília) o sistema ingere a última janela do ERA5-Land e reprocessa todas as safras ativas, sem ninguém apertar botão.
- Criar uma safra basta para ela receber clima e resultado automaticamente.
- API só enfileira; nenhum processamento pesado em requisição HTTP (exceto `?sync=true` para `ADMIN`).
- Workers param sem perder trabalho: terminam o job atual e não pegam novos.
- Operador vê o estado das filas e dispara ingestões/reprocessamentos pela API.

**Non-Goals:**

- Interface gráfica de filas; alertas; métricas Prometheus.
- Paralelizar requisições ao CDS (a fila do CDS é o gargalo e penaliza requisições concorrentes).
- Mudar o motor ou a persistência de resultados.

## Decisions

### 1. Três filas, dois workers

| Fila | Worker | Concorrência | Jobs |
|---|---|---|---|
| `era5-ingest` | Python (`era5.cli worker`) | 1 | `{kind: "latest"}`, `{kind: "range", from, to, bbox?}`, `{kind: "cell", lat, lon, from, to}` |
| `msa-process` | Node (`worker.ts`) | 4 | `{harvestId, seed?, reason}` |
| `msa-weekly` | Node | 1 | `trigger` (repetível) e `run` (pai do flow) |

Concorrência 1 no ETL porque a fila do CDS é externa e sequencial na prática; 4 no MSA porque cada processamento leva ~0,1 s de CPU e ~150 inserts — o limite é o banco, não o cálculo. O Node usa `bullmq@5`; o Python, `bullmq` (PyPI, oficial, mesmo autor) com `redis` assíncrono. As versões são escolhidas para compartilhar a mesma geração de scripts Lua (ver Risks).

### 2. Conexões Redis separadas

O cliente `ioredis` existente tem `maxRetriesPerRequest: 1` (falha rápido para o limite de login falhar aberto). O BullMQ exige `maxRetriesPerRequest: null`. `src/config/queue.ts` cria conexões próprias a partir de `REDIS_URL` para filas, `FlowProducer` e workers; o limite de login continua com o cliente antigo. Em produção os dois apontam para o mesmo Redis; a separação é de parâmetros, não de instância.

### 3. Processo `worker` separado da API

`src/worker.ts` é um segundo entrypoint da mesma imagem: carrega `env`, cria os workers e o agendador, trata `SIGTERM`/`SIGINT` com `await worker.close()` (espera o job ativo, recusa novos) e `prisma.$disconnect()`. A API nunca instancia `Worker` nem `JobScheduler` — só `Queue`/`FlowProducer` para enfileirar. Com `--scale api=3`, três processos agendando o mesmo cron seria redundante (o BullMQ deduplica repetíveis, mas não há motivo para três agendadores); com um `worker`, o cron tem um dono. Em desenvolvimento o serviço `worker` roda `ts-node-dev src/worker.ts` com hot-reload, como a API.

### 4. Fluxo semanal

O repetível `msa-weekly:trigger` (`upsertJobScheduler`, `pattern: '0 2 * * 1'`, `tz: 'America/Sao_Paulo'`) não pode ser ele próprio um flow; seu processador cria o flow:

```
msa-weekly:run (pai, fila msa-weekly)
└── era5-ingest {kind: "latest"} (filho, fila era5-ingest, attempts 3, backoff exponencial 5 min, failParentOnFailure)
```

O pai só sai de `waiting-children` quando o filho completa; seu processador lista as safras `ACTIVE` e enfileira um `msa-process {reason: WEEKLY}` para cada (jobId determinístico `weekly_<data>_<harvestId>` para idempotência se o pai for reexecutado). Se o filho esgota as 3 tentativas, `failParentOnFailure` falha o pai e nenhuma safra é processada com dados da semana anterior — melhor um relatório atrasado do que um relatório com clima velho apresentado como novo. `msa-process` tem `attempts: 1`: o processamento é determinístico; se falhou, repetir sem mudar nada só repete a falha (a run `FAILED` já guarda o motivo).

O worker Node registra o scheduler na subida; registrar de novo é idempotente (`upsertJobScheduler` substitui).

### 5. Backfill ao criar safra

`harvestService.create`, depois de gravar a safra, chama `jobsService.scheduleHarvestProcessing(harvest, 'BACKFILL')`:

1. `era5Repository.getCoverage(fieldId, emergenceDate, hoje − 6)`.
2. Lacuna ⇒ flow pai `msa-process {harvestId, reason: BACKFILL}` com filho `era5-ingest {kind: "cell", lat, lon, from: emergenceDate, to: hoje − 6}`; a resposta traz o `jobId` do pai.
3. Sem lacuna ⇒ `msa-process` direto.
4. Emergência dentro do lag (`from > hoje − 6`) ⇒ nada a ingerir; enfileira só o processamento (que registrará `NEEDS_DATA`, deixando rastro de que a safra existe e ainda não tem dados).

A decisão fica numa função pura `planHarvestJobs(coverage, from, limit)` → `'process' | 'backfill' | 'process-only-lag'`, testada sem Redis. Falha ao enfileirar (Redis fora) não desfaz a criação da safra: a safra é o dado do técnico; o job pode ser reenfileirado por `process-all`. O erro é logado e `msaJobId` vem `null`.

### 6. `POST .../msa/process` assíncrono, com válvula `sync`

Padrão: enfileira `msa-process {reason: MANUAL, seed?}` e responde 202 `{ jobId, queue: "msa-process", status: "queued" }`. `?sync=true` só para `ADMIN`: executa inline e responde como hoje (201/200/422/500) — é o que o roteiro de validação e os testes usam, e o que um operador usa para depurar uma safra específica. `AGRONOMO` com `sync=true` recebe 403 `SYNC_ADMIN_ONLY`.

O worker executa `msaService.processHarvestAsSystem(harvestId, { seed, reason, jobId })`: mesma lógica de `processHarvest`, sem checagem de escopo (o job já foi autorizado por quem o enfileirou) e com `triggeredById = null`. `msa_runs` ganha `reason` (enum `MsaRunReason`) e `jobId` para rastrear de onde veio cada run.

### 7. ETL como worker Python

`era5/worker.py`: `Worker("era5-ingest", process, {"connection": REDIS_URL, "concurrency": 1})`. `process(job)` despacha por `kind`:

- `latest` → `[hoje − 16, hoje − 6]`, todas as células de `era5_cells` (a bbox é recalculada a cada job — talhões novos entram sozinhos);
- `range` → `[from, to]`, células de `era5_cells` dentro de `bbox` (ou todas);
- `cell` → só a célula dada.

Cada job abre uma run com `job_id`, reporta progresso ao BullMQ (`updateProgress({ months_done, months_total })`) e atualiza `updated_at` da run a cada mês carregado (heartbeat). Exceções viram run `FAILED` e falha do job (o BullMQ decide a tentativa seguinte). Na subida, `mark_orphaned_runs(older_than=6h)`: `RUNNING` com `updated_at` (ou `started_at`) há mais de 6 h ⇒ `FAILED`, erro `orphaned`. Desligamento: `SIGTERM` → `await worker.close()` (termina o job em curso). O CLI atual permanece para operação manual; `cli.py worker` é o novo subcomando e vira o `CMD` do contêiner.

### 8. Requisições por trimestre, cache mensal preservado

Para intervalos longos (`range`, `cell` de backfill), `download.py` agrupa por trimestre civil: uma requisição `year/month ∈ trimestre/day/time` por trimestre, gravada em `cache/<bbox>/<AAAA>-Q<n>.nc`. Antes de pedir um trimestre, verifica se os 3 arquivos mensais já existem no cache (formato da change anterior) e, se sim, usa-os sem requisitar — os 16 meses de Goiânia continuam valendo. Um trimestre parcialmente coberto por meses em cache é pedido inteiro (simplicidade; o CDS devolve o trimestre numa requisição só). Para `latest` (≤ 2 meses) continua por mês. `open_hourly` já concatena arquivos de granularidades diferentes.

Por que trimestre e não ano: o CDS limita o tamanho de uma requisição (número de campos); 3 meses × 7 variáveis × 24 h × 92 dias ≈ 46 mil campos para uma bbox pequena fica confortável; um ano quadruplicaria e aumentaria o tempo de fila por requisição sem ganho proporcional.

### 9. Endpoints de administração

`/api/v1/admin/jobs` (`authenticate` + `authorize('ADMIN')`):

| Rota | Faz |
|---|---|
| `GET /queues` | `getJobCounts()` das três filas + `nextRun` do scheduler semanal |
| `GET /:queue/:id` | estado (`getState`), `progress`, `attemptsMade`, `failedReason`, `returnvalue`, timestamps |
| `POST /ingest-latest` | enfileira `era5-ingest {kind: "latest"}` |
| `POST /backfill-region` | body `{ bbox: [N, W, S, E], from, to }` → `era5-ingest {kind: "range"}` |
| `POST /process-all` | enfileira `msa-process {reason: MANUAL}` para cada safra `ACTIVE`; devolve a lista de `jobId` |

Respostas 202 com `{ jobId, queue }`. `backfill-region` existe para preparar células antes de talhões novos (ex.: a região de um cliente) — o cache por bbox faz o job de um talhão futuro na mesma região resolver sem CDS.

### 10. Esquema

- `msa_runs`: `reason msa_run_reason NOT NULL DEFAULT 'MANUAL'` (`WEEKLY|BACKFILL|MANUAL`), `job_id text NULL`.
- `era5_ingestion_runs`: `job_id text NULL`, `updated_at timestamptz NOT NULL DEFAULT now()` (heartbeat; atualizado pelo ETL explicitamente, não por trigger).
- Models Prisma atualizados; migration gerada com `prisma migrate dev` (interativo funcionou nas changes anteriores; se recusar, `migrate diff --from-url` **do próprio banco**, nunca como shadow — lição da change anterior).

### 11. Idempotência e deduplicação

- `msa-process` enfileirado pelo semanal usa `jobId = weekly_<AAAA-MM-DD>_<harvestId>`: se o pai reexecutar, o BullMQ ignora duplicatas.
- `era5-ingest latest` do flow semanal usa `jobId = ingest-latest:<AAAA-MM-DD>`.
- `backfill` ao criar safra usa `jobId = backfill_<harvestId>`; recriar a mesma safra não acontece (ids novos), mas reenfileirar manualmente colide — por isso `process-all` usa ids aleatórios.
- O processamento em si é idempotente por natureza (cria run nova); a ingestão é upsert.

### 12. Testes

- **Unitários Node**: `planHarvestJobs` (3 casos); `buildWeeklyFlow()` e `buildBackfillFlow()` devolvem a árvore esperada (`queueName`, `name`, `data`, `opts.failParentOnFailure`, `attempts`, `backoff`); `WEEKLY_CRON` + `tz` produzem a próxima segunda-feira 02:00 em `America/Sao_Paulo` (via `cron-parser`, dependência do BullMQ, com `tz`); `jobIds` determinísticos.
- **Unitários Python**: `quarters_covering`, reaproveitamento do cache mensal (3 arquivos presentes ⇒ sem requisição; 2 presentes ⇒ requisição do trimestre), despacho por `kind`, `mark_orphaned_runs` (integração, banco da stack).
- **`e2e-orchestration.sh`**: stack com `api`, `worker` e `etl`; cria safra com emergência em 2025-11-01 (célula de Goiânia, cache completo) ⇒ `msaJobId` ⇒ aguarda ⇒ `GET /msa` `SUCCEEDED` com `reason BACKFILL` e `jobId`; `GET /admin/jobs/queues`; `POST /admin/jobs/process-all` ⇒ runs `MANUAL`; `POST .../msa/process` ⇒ 202; `?sync=true` por agrônomo ⇒ 403, por admin ⇒ 201; `docker compose kill worker` com um job ativo ⇒ `up` ⇒ job concluído (stalled → retomado); run órfã simulada (`UPDATE … RUNNING, updated_at − 7 h`) ⇒ `docker compose restart etl` ⇒ `FAILED orphaned`; `POST /admin/jobs/ingest-latest` real contra o CDS só com `ERA5_E2E_CDS=1` (minutos). Regressão dos roteiros existentes (o `process` síncrono dos roteiros passa a usar `?sync=true` com admin, ou aguarda o job).

## Risks / Trade-offs

- **[Compatibilidade BullMQ Node × Python]** → Os dois pacotes compartilham os scripts Lua, mas versões distantes divergem no formato de dados (ex.: `markers`, `prioritized`). Pinos escolhidos da mesma geração; o e2e de flow (pai Node + filho Python) é o teste real. Se o flow misto falhar, fallback: o pai Node processa o filho "virtualmente" — o worker Node enfileira o ingest, espera o evento `completed` via `QueueEvents` e então segue — sem mudar a interface.
- **[Job travado no CDS]** → Lock do BullMQ (30 s) renovado pelo worker Python durante a espera; se o processo morrer, o job volta para a fila (stalled) e a run antiga vira órfã no restart. `attempts: 3` limita o custo.
- **[Semanal e backfill concorrentes na mesma célula]** → Upsert idempotente; o pior caso é trabalho repetido.
- **[`process-all` com muitas safras]** → Enfileira N jobs de ~0,1 s; concorrência 4 contra o banco. Se N crescer a milhares, limitar por lote.
- **[Falha ao enfileirar na criação de safra]** → Safra criada, `msaJobId: null`, erro logado; operador reenfileira com `process-all`. Alternativa (falhar a criação) puniria o técnico por indisponibilidade do Redis.
- **[Cron no fuso de Brasília com horário de verão]** → O Brasil não tem horário de verão desde 2019; `America/Sao_Paulo` é UTC−3 fixo. Se voltar, o `tz` do BullMQ acompanha a IANA.
- **[Worker Python sem heartbeat durante a fila do CDS]** → O `updated_at` só muda por mês concluído; uma requisição de 2 h na fila do CDS deixa a run sem heartbeat por 2 h. O limite de órfã é 6 h, acima do pior caso observado (~10 min) com folga; documentado.

## Notas de implementação

- **Versões**: `bullmq` 5.81.5 (Node; 6.x existe, mas o pacote Python acompanha a geração 5 dos scripts Lua), `cron-parser` 4.9.0 (dev, só no teste do cron), `bullmq` 3.3.0 + `redis` 7.4.1 (PyPI). O flow misto pai Node + filho Python funcionou de primeira (`e2e-orchestration.sh`: safra de 2025-11-01 do cache ao resultado em ~30 s); o fallback via `QueueEvents` não foi necessário.
- **Conexão**: o BullMQ 5 depende de `ioredis` 5 e a aplicação usa `ioredis` 6 — passar uma instância compartilhada quebra a tipagem. `queue.ts` passa **opções** (`queueConnectionOptions()`, derivadas de `REDIS_URL`) e deixa o BullMQ abrir as próprias conexões, inclusive a bloqueante do worker. O cliente do limite de login (`redis.ts`) segue separado.
- **Ids**: o BullMQ proíbe `:` em `jobId` customizado ("Custom Id cannot contain :"); os ids determinísticos usam `_` — `weekly_<AAAA-MM-DD>`, `ingest-latest_<data>`, `weekly_<data>_<harvestId>`, `backfill_<harvestId>`. Os nomes `msa-weekly:run`/`msa-weekly:trigger` na documentação são notação `fila:nome`, não ids.
- **Redis `noeviction`**: o BullMQ avisa na subida que `allkeys-lru` pode descartar jobs; os dois Compose passaram a `--maxmemory-policy noeviction` (spec `container-infrastructure` e `CLAUDE.md` atualizados). As chaves do limite de login têm TTL e não dependem de eviction.
- **Cache de mês aberto**: a change anterior reutilizava para sempre o arquivo do mês corrente, o que faria o `latest` semanal nunca ver dias novos. `download.py` agora trata um mês **consolidado** (último dia + 6 d já passou) como permanente e um mês **aberto** como válido só no dia do download. O trimestre que contém um mês aberto é pedido por mês (não grava trimestral parcial). O `e2e-orchestration.sh` faz `touch` no cache quando roda sem `ERA5_E2E_CDS` para permanecer offline.
- **Worker Python**: `asyncio.to_thread` para o trabalho bloqueante, conexão psycopg própria por job, `updateProgress` via `loop.call_soon_threadsafe`; `require_redis_url()` e `require_cds_key()` na subida (falha rápida). `_ingest_cells` passou a devolver `IngestSummary` (run, células, linhas) e aceitar `job_id`/`on_progress`.
- **Teste de reinício do worker**: jobs de `msa-process` duram ~0,1 s, então o cenário "kill com job ativo" é impraticável no e2e; o roteiro para o `worker`, enfileira, confirma `waiting` e religa — cobre a persistência do job e a retomada. A run órfã é testada com `restart etl` sobre uma run `RUNNING` inserida com `updated_at − 7 h`.
- **Não feito**: reuso de cache por bbox *contida* (bbox.json) — cada bbox tem o próprio diretório; sem necessidade enquanto a bbox do semanal for estável. `removeOnComplete`/`removeOnFail` continuam nos defaults (ver Open Questions).

## Migration Plan

1. Migration das colunas novas; `pnpm add bullmq`; `pip` com `bullmq` e `redis` (rebuild do `etl`).
2. Compose: `worker` novo; `etl` sem profile e com `command: worker`. `docker compose up -d --build`.
3. O scheduler semanal é registrado pelo `worker` na subida — nenhum passo manual.
4. Rollback: remover os serviços e voltar `etl` ao profile; as colunas novas são anuláveis/default e não quebram a versão anterior.

## Open Questions

- **Janela do semanal**: segunda 02:00 cobre o lag de ~5 dias com margem; se o CDS atrasar mais, o `latest` de 10 dias com sobreposição compensa na semana seguinte. Avaliar com a Heb se um segundo disparo (quinta) é útil.
- **Retenção de jobs**: defaults do BullMQ (`removeOnComplete`/`removeOnFail`) mantêm tudo; definir limites (ex.: 1.000 concluídos, 5.000 falhos) quando houver volume.
- **Notificação ao técnico** quando o processamento semanal termina (e-mail) — change própria.
