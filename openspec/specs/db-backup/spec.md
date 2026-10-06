# db-backup Specification

## Purpose
Backup e restauração do PostgreSQL/TimescaleDB: `pg_dump -Fc` local com retenção, restore com confirmação explícita e preparo do TimescaleDB, serviço de backup diário em produção e roteiro de verificação backup → limpeza → restore.

## Requirements

### Requirement: Backup local do banco
`backend/scripts/db/backup.sh` SHALL gerar um dump `pg_dump -Fc` do banco do contêiner `db` em `./backups/fertilizacerrado_<AAAAMMDD-HHMMSS>.dump` e manter apenas os últimos N arquivos (`BACKUP_KEEP`, default 14). O atalho `pnpm db:backup` na raiz SHALL chamá-lo; `./backups/` MUST estar no `.gitignore`.

#### Scenario: Backup
- **WHEN** `pnpm db:backup` é executado com a stack no ar
- **THEN** um arquivo `.dump` novo aparece em `./backups/` e `pg_restore --list` o lê

#### Scenario: Retenção
- **WHEN** já existem 14 dumps e um novo é gerado
- **THEN** o mais antigo é removido e restam 14

### Requirement: Restauração com confirmação
`backend/scripts/db/restore.sh <arquivo>` SHALL exigir que o operador digite o nome do banco para confirmar; em seguida MUST parar `api`, `worker` e `etl`, recriar o banco (`DROP DATABASE … WITH (FORCE)`, `CREATE DATABASE`), criar as extensões, executar `timescaledb_pre_restore()`, `pg_restore --no-owner --no-privileges`, `timescaledb_post_restore()` e religar os serviços. O atalho `pnpm db:restore -- <arquivo>` SHALL chamá-lo.

#### Scenario: Confirmação errada
- **WHEN** o operador digita um nome diferente do banco
- **THEN** nada é alterado e o script sai com código 1

#### Scenario: Restauração íntegra
- **WHEN** o dump é restaurado em um banco vazio
- **THEN** as hipertabelas voltam como hipertabelas, as contagens de `users`, `cultivars`, `qm_calibrations`, `harvests` e `msa_runs` são as do momento do backup e o `md5` do conteúdo de `msa_phase_summaries` é igual ao de antes

#### Scenario: Serviços religados
- **WHEN** a restauração termina
- **THEN** `api`, `worker` e `etl` estão no ar e `GET /health` responde 200

### Requirement: Backup diário em produção
`docker-compose.prod.yml` SHALL ter o serviço `backup` (`postgres:15-alpine`, cliente da mesma major do banco) rodando `crond` com uma entrada diária às 03:30 em `America/Sao_Paulo` que executa `backend/scripts/db/backup-cron.sh`: `pg_dump -Fc` via rede para `/backups` (volume `db_backups`) e remoção dos dumps mais antigos que `BACKUP_RETENTION_DAYS` (default 14). O serviço MUST pertencer só à `backend_net` e não publicar portas. O envio para armazenamento externo NÃO faz parte desta change.

#### Scenario: Execução agendada
- **WHEN** chega 03:30 em Brasília
- **THEN** um dump novo é gravado no volume `db_backups`

#### Scenario: Retenção por dias
- **WHEN** existem dumps com mais de `BACKUP_RETENTION_DAYS` dias
- **THEN** são removidos na execução seguinte

### Requirement: Roteiro de verificação do backup
`backend/scripts/e2e/e2e-backup.sh` SHALL, apenas com `E2E_BACKUP_CONFIRM=1`, fazer backup, registrar contagens e `md5`, derrubar a stack removendo **somente** o volume `postgres_data` (preservando `etl_cache` e `station_imports`), restaurar e comparar.

#### Scenario: Sem confirmação
- **WHEN** o roteiro roda sem `E2E_BACKUP_CONFIRM=1`
- **THEN** explica que é destrutivo e sai sem tocar na stack

#### Scenario: Ciclo completo
- **WHEN** o roteiro roda com a confirmação
- **THEN** termina com `FALHAS: 0` e o cache do ETL continua no volume
