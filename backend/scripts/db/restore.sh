#!/usr/bin/env bash
# Restaura um dump (-Fc) no banco da stack de desenvolvimento.
# DESTRUTIVO: recria o banco. Pede que se digite o nome do banco para confirmar.
# Procedimento do TimescaleDB: timescaledb_pre_restore() → pg_restore → timescaledb_post_restore().
# Uso: pnpm db:restore -- backups/fertilizacerrado_<data>.dump
set -euo pipefail
cd "$(dirname "$0")/../../.."
FILE=${1:-}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "uso: restore.sh <arquivo.dump>"; exit 1; }
DB_NAME=$(grep '^DB_NAME=' .env | cut -d= -f2-)
[ -n "$DB_NAME" ] || { echo "DB_NAME não encontrado no .env"; exit 1; }

echo "Isto vai APAGAR o banco '$DB_NAME' e restaurar '$FILE'."
if [ "${RESTORE_CONFIRM:-}" != "$DB_NAME" ]; then
  read -r -p "Digite o nome do banco para confirmar: " TYPED
  [ "$TYPED" = "$DB_NAME" ] || { echo "confirmação incorreta; nada foi alterado."; exit 1; }
fi

psql_admin() { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -Atc "$0"' "$1"; }
psql_db()    { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }

echo "parando api, worker e etl..."
docker compose stop api worker etl >/dev/null

echo "recriando o banco..."
psql_admin "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)"
psql_admin "CREATE DATABASE \"$DB_NAME\""
psql_db "CREATE EXTENSION IF NOT EXISTS timescaledb"
psql_db "CREATE EXTENSION IF NOT EXISTS postgis"
psql_db "CREATE EXTENSION IF NOT EXISTS pgcrypto"
psql_db "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""
psql_db "SELECT timescaledb_pre_restore()" >/dev/null

echo "restaurando..."
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' < "$FILE"
psql_db "SELECT timescaledb_post_restore()" >/dev/null

echo "religando os serviços..."
docker compose start api worker etl >/dev/null
echo "restauração concluída."
