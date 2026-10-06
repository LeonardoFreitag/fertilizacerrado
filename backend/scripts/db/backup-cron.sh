#!/bin/sh
# Backup diário em produção (serviço `backup` do docker-compose.prod.yml): pg_dump -Fc via
# rede para /backups (volume db_backups) e remoção dos dumps mais antigos que
# BACKUP_RETENTION_DAYS (14). Também pode ser chamado à mão:
#   docker compose -f docker-compose.prod.yml exec backup /scripts/backup-cron.sh
set -eu
: "${PGHOST:=db}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
DIR=${BACKUP_DIR:-/backups}
DAYS=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$DIR"
OUT="$DIR/fertilizacerrado_$(date +%Y%m%d-%H%M%S).dump"
pg_dump -h "$PGHOST" -U "$PGUSER" -Fc "$PGDATABASE" > "$OUT"
echo "$(date -Iseconds) backup: $OUT ($(du -h "$OUT" | cut -f1))"
find "$DIR" -name 'fertilizacerrado_*.dump' -mtime +"$DAYS" -print -delete | sed 's/^/removido: /'
