## MODIFIED Requirements

### Requirement: ETL como worker de longa duração
O serviço `etl` SHALL rodar `python -m era5.cli worker`, consumindo a fila `era5-ingest` com o pacote oficial `bullmq` do PyPI (concorrência 1), fora de qualquer profile e com `restart` nos dois Compose, mantendo o CLI (`docker compose run --rm etl ingest …`) disponível. Jobs MUST ter `kind` igual a `latest` (`[hoje − 16, hoje − 6]`, todas as células), `range` (`from`, `to`, `bbox` opcional), `cell` (`lat`, `lon`, `from`, `to`), `station-import` (`path`, `format`, `stationMeta?`), `qm-calibrate` (`cell`+`station` ou `auto`, `from`/`to` opcionais) ou `qm-apply` (`cell?`). Cada job MUST gravar sua run em `era5_ingestion_runs` com `job_id`, reportar progresso ao BullMQ (por mês nas ingestões; por célula nas calibrações) e atualizar `updated_at` da run (heartbeat). Falha MUST fechar a run como `FAILED` e falhar o job. `SIGTERM` MUST concluir o job ativo antes de encerrar.

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
- **WHEN** o job traz `kind` fora dos valores aceitos
- **THEN** o job falha imediatamente com mensagem indicando os valores aceitos, e a run é `FAILED`

#### Scenario: Job de importação de estação
- **WHEN** um job `{kind: "station-import", path, format: "generic"}` é consumido
- **THEN** as observações são importadas, a run registra o arquivo e as contagens, e o arquivo é removido do volume

#### Scenario: Job de calibração
- **WHEN** um job `{kind: "qm-calibrate", auto: true}` é consumido
- **THEN** cada célula de `era5_cells` é calibrada quando há estação elegível, a correção é aplicada e a run lista as células sem estação

## ADDED Requirements

### Requirement: Agendamento anual da calibração
O `worker` Node SHALL registrar o agendador `qm-annual-trigger` na fila `msa-weekly` com `pattern '0 3 1 1 *'` e `tz 'America/Sao_Paulo'`; ao disparar, SHALL enfileirar `era5-ingest {kind: "qm-calibrate", auto: true}` (que recalibra e aplica). `GET /admin/jobs/queues` SHALL expor `nextRun` do anual ao lado do semanal.

#### Scenario: Registro na subida
- **WHEN** o `worker` sobe
- **THEN** os dois agendadores existem e `GET /admin/jobs/queues` mostra `weekly.nextRun` e `annual.nextRun` (1º de janeiro, 06:00 UTC)

#### Scenario: Disparo anual
- **WHEN** o agendador anual dispara
- **THEN** um job `qm-calibrate {auto: true}` entra em `era5-ingest`
