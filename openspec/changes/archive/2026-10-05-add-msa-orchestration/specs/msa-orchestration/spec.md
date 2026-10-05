## ADDED Requirements

### Requirement: Processo worker separado da API
O sistema SHALL ter um processo `worker` (`src/worker.ts`, serviço `worker` nos dois Compose, mesma imagem da API, `node dist/worker.js`) que hospeda os workers BullMQ das filas `msa-process` (concorrência 4) e `msa-weekly` e registra o agendador semanal. As réplicas da API MUST NOT instanciar workers nem agendadores — apenas enfileiram. O `worker` MUST tratar `SIGTERM`/`SIGINT` terminando o job ativo sem aceitar novos e desconectando o banco e o Redis antes de encerrar.

#### Scenario: Worker processa a fila
- **WHEN** um job `msa-process` é enfileirado e o serviço `worker` está no ar
- **THEN** o job é consumido pelo `worker` e a run correspondente aparece em `msa_runs` com o `jobId`

#### Scenario: API não consome filas
- **WHEN** o serviço `worker` está parado e um job é enfileirado pela API
- **THEN** o job permanece `waiting` até o `worker` subir

#### Scenario: Desligamento gracioso
- **WHEN** o `worker` recebe `SIGTERM` com um job ativo
- **THEN** conclui esse job, não inicia outros e encerra com código 0

#### Scenario: Retomada após queda
- **WHEN** o `worker` é morto (`kill -9`) com um job ativo e sobe de novo
- **THEN** o job é detectado como estagnado e reprocessado até concluir

### Requirement: ETL como worker de longa duração
O serviço `etl` SHALL rodar `python -m era5.cli worker`, consumindo a fila `era5-ingest` com o pacote oficial `bullmq` do PyPI (concorrência 1), fora de qualquer profile e com `restart` nos dois Compose, mantendo o CLI (`docker compose run --rm etl ingest …`) disponível. Jobs MUST ter `kind` igual a `latest` (`[hoje − 16, hoje − 6]`, todas as células), `range` (`from`, `to`, `bbox` opcional) ou `cell` (`lat`, `lon`, `from`, `to`). Cada job MUST gravar sua run em `era5_ingestion_runs` com `job_id`, reportar progresso ao BullMQ por mês concluído e atualizar `updated_at` da run a cada mês (heartbeat). Falha MUST fechar a run como `FAILED` e falhar o job. `SIGTERM` MUST concluir o job ativo antes de encerrar.

#### Scenario: Job latest
- **WHEN** um job `{kind: "latest"}` é consumido
- **THEN** a run tem `date_from = hoje − 16`, `date_to = hoje − 6`, `job_id` igual ao id do job e termina `SUCCEEDED`

#### Scenario: Job cell pelo cache
- **WHEN** um job `{kind: "cell", lat: -16.7, lon: -49.3, from: "2025-11-01", to: "2026-03-30"}` é consumido com os meses já em cache
- **THEN** nenhuma requisição é feita ao CDS, a run termina `SUCCEEDED` com as linhas da célula e o progresso do job chega a 100 %

#### Scenario: Progresso e heartbeat
- **WHEN** um job de vários meses está em execução
- **THEN** `job.progress` reporta meses concluídos/total e `updated_at` da run avança a cada mês

#### Scenario: Falha do CDS
- **WHEN** o CDS responde erro no job
- **THEN** a run termina `FAILED` com a mensagem e o job falha, ficando elegível à próxima tentativa

#### Scenario: Kind desconhecido
- **WHEN** o job traz `kind` fora de `latest`/`range`/`cell`
- **THEN** o job falha imediatamente com mensagem indicando os valores aceitos, e a run é `FAILED`

### Requirement: Runs órfãs do ETL
Ao iniciar, o worker Python SHALL marcar como `FAILED` com erro `orphaned` toda run `RUNNING` cujo `updated_at` (ou `started_at`) tenha mais de 6 horas.

#### Scenario: Run órfã no restart
- **WHEN** existe uma run `RUNNING` com `updated_at` há 7 horas e o serviço `etl` reinicia
- **THEN** a run passa a `FAILED` com `error` igual a `orphaned`

#### Scenario: Run recente preservada
- **WHEN** existe uma run `RUNNING` com `updated_at` há 10 minutos e o serviço `etl` reinicia
- **THEN** a run permanece `RUNNING`

### Requirement: Requisições ao CDS por trimestre
Para intervalos que abrangem mais de dois meses, `download.py` SHALL agrupar as requisições ao CDS por trimestre civil, gravando `cache/<bbox>/<AAAA>-Q<n>.nc`. Antes de requisitar um trimestre, MUST reutilizar os três arquivos mensais em cache quando todos existirem. Intervalos de até dois meses (`latest`) continuam por mês.

#### Scenario: Trimestres de um backfill
- **WHEN** o intervalo é 2025-11-01 a 2026-03-30
- **THEN** os grupos são 2025-Q4 (out–dez) e 2026-Q1 (jan–mar), mais o mês seguinte ao fim para fechar os acumulados

#### Scenario: Cache mensal reaproveitado
- **WHEN** os arquivos `2025-10.nc`, `2025-11.nc` e `2025-12.nc` existem no cache da bbox
- **THEN** 2025-Q4 não é requisitado ao CDS

#### Scenario: Trimestre parcialmente em cache
- **WHEN** só `2025-11.nc` e `2025-12.nc` existem
- **THEN** 2025-Q4 é requisitado inteiro e gravado como `2025-Q4.nc`

### Requirement: Fluxo semanal agendado
O `worker` SHALL registrar um job repetível `msa-weekly:trigger` com `pattern '0 2 * * 1'` e `tz 'America/Sao_Paulo'`. Ao disparar, SHALL criar um flow com pai `msa-weekly:run` e filho `era5-ingest {kind: "latest"}` (`attempts 3`, backoff exponencial, `failParentOnFailure`). O pai, ao executar, SHALL enfileirar um `msa-process {reason: "WEEKLY"}` por safra `ACTIVE`, com `jobId` determinístico `weekly_<data>_<harvestId>`. Se o filho falhar após as tentativas, o pai MUST falhar e nenhuma safra MUST ser processada.

#### Scenario: Próximo disparo
- **WHEN** o scheduler está registrado
- **THEN** `GET /api/v1/admin/jobs/queues` devolve `nextRun` numa segunda-feira às 02:00 em `America/Sao_Paulo` (05:00 UTC)

#### Scenario: Ingestão antes do processamento
- **WHEN** o trigger dispara
- **THEN** o job `msa-process` de cada safra ativa só é enfileirado depois que `era5-ingest latest` conclui

#### Scenario: Falha da ingestão
- **WHEN** `era5-ingest latest` falha nas 3 tentativas
- **THEN** o pai `msa-weekly:run` fica `failed` e nenhum `msa-process` da semana é enfileirado

#### Scenario: Reexecução do pai não duplica
- **WHEN** o pai é executado de novo na mesma data
- **THEN** os `msa-process` com o mesmo `jobId` não são duplicados

### Requirement: Backfill automático na criação de safra
Ao criar uma safra, o sistema SHALL verificar a cobertura da célula do talhão de `emergenceDate` a `hoje − 6`: com lacuna, SHALL enfileirar um flow com filho `era5-ingest {kind: "cell"}` e pai `msa-process {reason: "BACKFILL"}`; sem lacuna, SHALL enfileirar só `msa-process {reason: "BACKFILL"}`; com emergência dentro do lag, só o processamento. A resposta de `POST /api/v1/harvests` MUST incluir `msaJobId` (ou `null` se o enfileiramento falhar, sem desfazer a criação). A decisão MUST ser uma função pura testável.

#### Scenario: Célula sem dados
- **WHEN** a safra é criada para um talhão cuja célula não tem dias no intervalo
- **THEN** a resposta é 201 com `msaJobId`, e `GET /admin/jobs/msa-process/<msaJobId>` mostra o pai aguardando o filho `era5-ingest cell`

#### Scenario: Célula com cobertura completa
- **WHEN** a célula já tem todos os dias do intervalo
- **THEN** só `msa-process` é enfileirado, sem ingestão

#### Scenario: Resultado automático
- **WHEN** o flow de backfill conclui
- **THEN** `GET /api/v1/harvests/:id/msa` devolve uma run `SUCCEEDED` com `reason BACKFILL` e `jobId`

#### Scenario: Redis indisponível
- **WHEN** o enfileiramento falha na criação da safra
- **THEN** a safra é criada, a resposta é 201 com `msaJobId: null` e o erro é logado

### Requirement: Endpoints de administração de jobs
`/api/v1/admin/jobs` SHALL exigir `ADMIN` e oferecer: `GET /queues` (contagens `waiting`, `active`, `completed`, `failed`, `delayed` e `waiting-children` por fila, mais `nextRun` do semanal), `GET /:queue/:id` (estado, `progress`, `attemptsMade`, `failedReason`, timestamps; 404 se não existe), `POST /ingest-latest`, `POST /backfill-region` (`{ bbox: [N, W, S, E], from, to }` → `era5-ingest range`), `POST /process-all` (`msa-process {reason: "MANUAL"}` por safra `ACTIVE`). Respostas de enfileiramento MUST ser 202 com `jobId` e `queue`.

#### Scenario: Contagens
- **WHEN** um `ADMIN` chama `GET /admin/jobs/queues`
- **THEN** a resposta traz as três filas com contagens e `nextRun`

#### Scenario: Estado de um job
- **WHEN** um `ADMIN` chama `GET /admin/jobs/msa-process/<id>` de um job concluído
- **THEN** a resposta traz `state: "completed"`, `attemptsMade` e `finishedOn`

#### Scenario: Job inexistente
- **WHEN** o id não existe na fila
- **THEN** a resposta é 404

#### Scenario: Process-all
- **WHEN** um `ADMIN` chama `POST /admin/jobs/process-all` com 3 safras ativas
- **THEN** a resposta é 202 com 3 `jobId` e, após o processamento, cada safra tem uma run `MANUAL` nova

#### Scenario: Backfill regional
- **WHEN** um `ADMIN` envia `bbox [-16.1, -49.4, -16.8, -48.7]`, `from 2025-10-01`, `to 2026-03-31`
- **THEN** um job `era5-ingest range` é enfileirado e, ao rodar, as células de `era5_cells` dentro da bbox são ingeridas por trimestre

#### Scenario: Não administrador
- **WHEN** um `AGRONOMO` chama qualquer rota de `/admin/jobs`
- **THEN** a resposta é 403
