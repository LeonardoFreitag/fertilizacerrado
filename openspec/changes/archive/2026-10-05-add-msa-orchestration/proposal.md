## Why

Hoje cada passo do MSA é disparado à mão: `docker compose run --rm etl ingest --latest`, depois `POST .../msa/process` safra a safra. O conceito operacional do produto (`docs/arquitetura.md`, "Decisão Oportuna") é um ciclo semanal em lote: ingerir o ERA5-Land consolidado e reprocessar todas as safras ativas antes da próxima janela de manejo. Esta change implementa a orquestração com BullMQ sobre o Redis já existente — agendamento semanal, backfill automático ao criar safra, workers com desligamento gracioso e endpoints de administração — deixando a API apenas enfileirando.

## What Changes

- **Processo `worker` (Node)** em `src/worker.ts`, serviço `worker` nos dois Compose com a mesma imagem da API (`node dist/worker.js`): hospeda os workers BullMQ das filas `msa-process` (concorrência 4) e `msa-weekly`, e registra o agendador semanal (segunda-feira 02:00 `America/Sao_Paulo`). As réplicas da API não rodam cron nem workers.
- **ETL como worker de longa duração**: o serviço `etl` sai do profile, roda `python -m era5.cli worker` consumindo a fila `era5-ingest` com o pacote oficial `bullmq` do PyPI (mesmo Redis), concorrência 1. O CLI continua disponível (`docker compose run --rm etl ingest …`). Requisições ao CDS agrupadas por **trimestre** para intervalos longos, reaproveitando o cache mensal existente. Runs órfãs (`RUNNING` há mais de 6 h) viram `FAILED` ao iniciar o worker; heartbeat (`updated_at`) a cada mês concluído; `job_id` na run.
- **Fluxo semanal** via `FlowProducer`: pai `msa-weekly` com filho `era5-ingest {kind: "latest"}`; o pai só roda quando o filho conclui e enfileira um `msa-process {reason: WEEKLY}` por safra `ACTIVE`. Falha do filho (após 3 tentativas com backoff exponencial) falha o pai — nada é processado com dados velhos.
- **Backfill ao criar safra**: `POST /harvests` verifica a cobertura da célula de `emergenceDate` a `hoje − 6`; com lacuna, enfileira o flow `era5-ingest {kind: "cell"}` → `msa-process {reason: BACKFILL}`; sem lacuna, só o processamento. A resposta inclui `msaJobId`.
- **`POST /harvests/:id/msa/process` passa a enfileirar** (202 com `jobId`, `reason: MANUAL`); `?sync=true` (só `ADMIN`) mantém o processamento inline para validação e testes.
- **Endpoints `ADMIN`** em `/api/v1/admin/jobs`: contagens por fila e próximo disparo semanal, estado de um job, `ingest-latest`, `backfill-region {bbox, from, to}` (por trimestre), `process-all`.
- `msa_runs` ganha `reason` (`WEEKLY`/`BACKFILL`/`MANUAL`) e `jobId`; `era5_ingestion_runs` ganha `job_id` e `updated_at`.
- Volume nomeado `etl_cache` já existe nos dois Compose; a change garante que o `worker` e o `etl` em produção tenham 1 réplica e `restart: always`.
- Testes unitários (montagem dos flows, decisão cobertura → backfill, cron no fuso, agrupamento por trimestre, marcação de órfãs) e `e2e-orchestration.sh`.
- Docs: `era5-etl.md` (agendamento real, filas, cache como volume, backfill regional), `msa.md` (fluxo assíncrono, 202 + `jobId`), `arquitetura.md` (processos `worker` e `etl`), README do ETL, `.env.example`.

Fora do escopo: painel web de filas (Bull Board), notificações ao técnico, retenção/limpeza automática de jobs além dos defaults do BullMQ, Quantile Mapping, escala horizontal do worker Python (concorrência > 1 contra o CDS).

## Capabilities

### New Capabilities
- `msa-orchestration`: processos worker (Node e Python), filas `era5-ingest`/`msa-process`/`msa-weekly`, fluxo semanal agendado, backfill automático na criação de safra, tratamento de runs órfãs, endpoints de administração de jobs e desligamento gracioso.

### Modified Capabilities
- `msa-processing`: `POST .../msa/process` passa a enfileirar (202 + `jobId`), com `?sync=true` restrito a `ADMIN` para o comportamento inline; runs registram `reason` e `jobId`.
- `harvest-management`: a criação de safra enfileira backfill/processamento e devolve `msaJobId`.
- `era5-ingestion`: serviço `etl` como worker de longa duração (sem profile), requisições por trimestre com reaproveitamento do cache mensal, `job_id`/`updated_at` nas runs e marcação de órfãs.
- `container-infrastructure`: serviço `worker` nas duas stacks; `etl` sem profile, com `restart`, 1 réplica em produção.

## Impact

- **Código**: novos `src/worker.ts`, `src/config/queue.ts`, `src/modules/jobs/` (service, controller, routes, flows, DTOs), `backend/etl/era5/worker.py`; alterações em `msa.service`/`msa.controller`/`msa.routes` (enfileirar, `sync`), `harvest.service`/`harvest.controller` (`msaJobId`), `server.ts` (não muda), `download.py` (trimestres), `db.py`/`cli.py` (órfãs, heartbeat, `job_id`, comando `worker`), `requirements.txt` (`bullmq`, `redis`), `package.json` (`bullmq`, script `worker`), Compose dev/prod, `.env.example`, Dockerfile da API (nada: mesma imagem).
- **Banco**: 2 colunas em `msa_runs`, 2 em `era5_ingestion_runs`, 1 enum.
- **Redis**: passa a guardar filas BullMQ (prefixo `bull:`), além do contador de login.
- **Dependências**: Node `bullmq`; Python `bullmq`, `redis`.
- **Ambiente**: nenhuma variável nova obrigatória; `REDIS_URL` passa a ser injetada também no `etl`.
