## REMOVED Requirements

### Requirement: Requisições ao CDS por trimestre
**Reason**: O CDS passou a recusar requisições de três meses × 24 horas × sete variáveis por custo (`cost limits exceeded`), o que fazia todo backfill desde o spin-up de fevereiro falhar. As requisições passam a ser sempre mensais, com divisão por grupos de variáveis e concorrência configurável, especificadas em `era5-ingestion` ("Download por mês com cache", "Divisão por grupos de variáveis ao exceder o custo do CDS", "Concorrência das requisições ao CDS").

**Migration**: Nenhuma ação de dados: o cache mensal `AAAA-MM.nc` continua válido; arquivos `AAAA-Qn.nc` deixam de ser lidos e podem ser apagados. Backfills que falharam por custo devem ser reenfileirados (reprocessar a safra ou Backfill regional no painel admin).

## MODIFIED Requirements

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
- **THEN** um job `era5-ingest range` é enfileirado e, ao rodar, as células de `era5_cells` dentro da bbox são ingeridas mês a mês (sete requisições mensais, `2025-10` a `2026-04`, com `periodsDone/periodsTotal` por mês)

#### Scenario: Não administrador
- **WHEN** um `AGRONOMO` chama qualquer rota de `/admin/jobs`
- **THEN** a resposta é 403
