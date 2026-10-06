## ADDED Requirements

### Requirement: Serviço de backup em produção
`docker-compose.prod.yml` SHALL definir o serviço `backup` (`postgres:15-alpine`, `restart: always`, só na `backend_net`, sem portas) com `crond` executando `backend/scripts/db/backup-cron.sh` diariamente às 03:30 `America/Sao_Paulo`, gravando dumps `pg_dump -Fc` no volume nomeado `db_backups` e removendo os mais antigos que `BACKUP_RETENTION_DAYS` (default 14). O `.env.example` SHALL listar `BACKUP_RETENTION_DAYS`.

#### Scenario: Configuração válida
- **WHEN** `docker compose -f docker-compose.prod.yml config` é executado
- **THEN** o serviço `backup` resolve para `postgres:15-alpine` com o volume `db_backups` em `/backups` e sem portas publicadas

#### Scenario: Execução manual
- **WHEN** `docker compose -f docker-compose.prod.yml exec backup /scripts/backup-cron.sh` é executado
- **THEN** um dump novo aparece em `/backups`
