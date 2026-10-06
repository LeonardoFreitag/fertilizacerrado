#!/usr/bin/env bash
# Verificação do backup/restore: backup → derruba a stack removendo SÓ o volume do banco
# (preserva etl_cache, station_imports e node_modules) → restore → compara contagens e md5.
# DESTRUTIVO para o banco de dev: só roda com E2E_BACKUP_CONFIRM=1.
set -u
cd "$(dirname "$0")/../../.."
if [ "${E2E_BACKUP_CONFIRM:-}" != "1" ]; then
  echo "Este roteiro recria o banco de desenvolvimento a partir do backup. Para rodar: E2E_BACKUP_CONFIRM=1 bash $0"
  exit 0
fi
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)"; FAILS=$((FAILS+1)); fi; }
sql() { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
snapshot() {
  sql "SELECT (SELECT count(*) FROM users)||'|'||(SELECT count(*) FROM cultivars)||'|'||(SELECT count(*) FROM qm_calibrations)||'|'||(SELECT count(*) FROM harvests)||'|'||(SELECT count(*) FROM msa_runs)||'|'||(SELECT count(*) FROM era5_daily_data)||'|'||(SELECT count(*) FROM weather_stations)"
}
md5_summaries() { sql "SELECT string_agg(run_id::text||phase||coalesce(ks_mean::text,'')||coalesce(etc_adj_accum::text,''), ',' ORDER BY run_id, phase) FROM msa_phase_summaries" | md5 -q 2>/dev/null || sql "SELECT string_agg(run_id::text||phase||coalesce(ks_mean::text,'')||coalesce(etc_adj_accum::text,''), ',' ORDER BY run_id, phase) FROM msa_phase_summaries" | md5sum | cut -d' ' -f1; }
DB_NAME=$(grep '^DB_NAME=' .env | cut -d= -f2-)
PROJECT=$(docker compose config --format json 2>/dev/null | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).name)' 2>/dev/null || basename "$PWD" | tr '[:upper:]' '[:lower:]')

echo "== Estado antes =="
docker compose up -d >/dev/null 2>&1
BEFORE=$(snapshot); MD5_BEFORE=$(md5_summaries)
CACHE_BEFORE=$(docker compose exec -T etl sh -c 'find /data/cache -name "*.nc" | wc -l' | tr -d '[:space:]')
echo "      contagens: $BEFORE · md5 resumos: $MD5_BEFORE · cache ETL: $CACHE_BEFORE arquivo(s)"

echo "== Backup =="
OUT=$(bash backend/scripts/db/backup.sh | grep -o 'backups/[^ ]*\.dump')
check "dump gerado" 1 "$( [ -s "$OUT" ] && echo 1 || echo 0 )"
check "pg_restore --list lê o dump" 0 "$(docker compose exec -T db pg_restore --list < "$OUT" >/dev/null 2>&1; echo $?)"

echo "== Reset só do volume do banco =="
docker compose down >/dev/null 2>&1
docker volume rm "${PROJECT}_postgres_data" >/dev/null 2>&1; check "volume postgres_data removido" 1 "$( docker volume inspect "${PROJECT}_postgres_data" >/dev/null 2>&1 && echo 0 || echo 1 )"
check "volume etl_cache preservado" 1 "$( docker volume inspect "${PROJECT}_etl_cache" >/dev/null 2>&1 && echo 1 || echo 0 )"
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 40); do sleep 3; docker compose ps db 2>/dev/null | grep -q healthy && break; done
check "banco novo vazio (sem tabela users)" 0 "$(sql "SELECT count(*) FROM information_schema.tables WHERE table_name='users'")"

echo "== Restore =="
docker compose create api worker etl >/dev/null 2>&1   # cria sem iniciar: restore.sh os para/religa, e o migrate deploy só roda sobre o banco restaurado
RESTORE_CONFIRM="$DB_NAME" bash backend/scripts/db/restore.sh "$OUT" > /tmp/e2e-restore.log 2>&1; check "restore.sh concluiu" 0 "$?"
grep -q 'restauração concluída' /tmp/e2e-restore.log || tail -5 /tmp/e2e-restore.log
docker compose up -d >/dev/null 2>&1
for i in $(seq 1 30); do sleep 3; curl -s -o /dev/null -w '%{http_code}' localhost:3000/health | grep -q 200 && break; done
check "API no ar após o restore" 200 "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/health)"
check "contagens idênticas" "$BEFORE" "$(snapshot)"
check "md5 de msa_phase_summaries idêntico" "$MD5_BEFORE" "$(md5_summaries)"
check "hipertabelas restauradas" 2 "$(sql "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name IN ('era5_daily_data','station_daily_obs')")"
check "migrations marcadas como aplicadas (migrate deploy sem pendências)" 0 "$(docker compose logs --no-log-prefix api 2>/dev/null | grep -c 'Applying migration')"
check "cache do ETL intacto" "$CACHE_BEFORE" "$(docker compose exec -T etl sh -c 'find /data/cache -name "*.nc" | wc -l' | tr -d '[:space:]')"

echo; echo "FALHAS: $FAILS"
