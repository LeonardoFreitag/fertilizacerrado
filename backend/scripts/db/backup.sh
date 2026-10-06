#!/usr/bin/env bash
# Backup do banco da stack de desenvolvimento: pg_dump -Fc do contêiner `db` para
# ./backups/fertilizacerrado_<AAAAMMDD-HHMMSS>.dump, mantendo os últimos BACKUP_KEEP (14).
# Uso: pnpm db:backup   (ou bash backend/scripts/db/backup.sh)
set -euo pipefail
cd "$(dirname "$0")/../../.."
KEEP=${BACKUP_KEEP:-14}
DIR=./backups
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/fertilizacerrado_$STAMP.dump"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
echo "backup gravado: $OUT ($SIZE)"

# retenção: mantém os KEEP mais recentes
ls -1t "$DIR"/fertilizacerrado_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" && echo "removido (retenção $KEEP): $old"
done
