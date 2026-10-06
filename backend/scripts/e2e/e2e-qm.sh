#!/usr/bin/env bash
# Roteiro de ponta a ponta da correção de viés (Quantile Mapping): estação sintética a
# ~10 km da célula de Goiânia (10 anos com viés conhecido), upload pela API (job
# station-import), calibração pela API (job qm-calibrate), aplicação, reprocessamento
# de uma safra com qmCalibrationId e validação do Caso 4. Remove tudo ao final.
# Pré-requisitos: stack completa (api, worker, etl) — ver README.md.
set -u
cd "$(dirname "$0")/../../.."
S=$(mktemp -d); trap 'rm -rf "$S"; cleanup' EXIT
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-); ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
FAILS=0
CELL_LAT=-16.7; CELL_LON=-49.3; STATION=SYN-GYN
EMERGENCE=2025-11-01

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()     { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }
call()  { local m=$1 p=$2 t=$3 d=${4:-}; local a=(-s -X "$m" -o "$S/b.txt" -w '%{http_code}'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d"); STATUS=$(curl "${a[@]}" "$API$p"); BODY=$(cat "$S/b.txt"); }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:220}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:220}"; FAILS=$((FAILS+1)); fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }
register_and_verify() { call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"; local id; id=$(echo "$BODY" | j user.id); sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""; echo "$id"; }
login() { call POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | j accessToken; }
wait_job() { local q=$1 id=$2 limit=${3:-180} t=0; JOB_STATE=timeout; while [ $t -lt "$limit" ]; do call GET "/admin/jobs/$q/$id" "$ADMIN"; local st; st=$(echo "$BODY" | j state); if [ "$st" = completed ] || [ "$st" = failed ]; then JOB_STATE=$st; return; fi; sleep 2; t=$((t+2)); done; }
etl() { docker compose run --rm -T etl "$@"; }

cleanup() {
  echo "== Limpeza =="
  sql "UPDATE qm_calibrations SET active = false WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON" >/dev/null 2>&1
  sql "DELETE FROM era5_daily_data WHERE source = 'synthetic-qm'" >/dev/null 2>&1
  etl qm apply --cell "$CELL_LAT" "$CELL_LON" >/dev/null 2>&1   # sem calibração ativa ⇒ tp_corrected = tp_raw
  sql "DELETE FROM qm_calibrations WHERE station_code='$STATION'" >/dev/null 2>&1
  sql "DELETE FROM station_daily_obs WHERE station_code='$STATION'" >/dev/null 2>&1
  sql "DELETE FROM weather_stations WHERE code='$STATION'" >/dev/null 2>&1
}

echo "== Preparação =="
docker compose up -d worker etl >/dev/null 2>&1
ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
sql "TRUNCATE msa_decisions, msa_daily_results, msa_phase_summaries" >/dev/null 2>&1
sql "UPDATE harvests SET latest_run_id = NULL" >/dev/null 2>&1; sql "TRUNCATE msa_runs CASCADE" >/dev/null 2>&1
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1; sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null
cleanup >/dev/null 2>&1
# fixture: 10 anos sintéticos (ERA5 na célula + estação com viés ×1,3 e garoa removida)
docker compose run --rm -T --entrypoint python etl -m tests.make_qm_fixture --cell "$CELL_LAT" "$CELL_LON" --out-dir /data/station-imports > "$S/fixture.log" 2>&1
docker compose exec -T etl cat /data/station-imports/qm_era5_synthetic.sql > "$S/era5.sql"
docker compose exec -T etl cat /data/station-imports/qm_station_synthetic.csv > "$S/obs.csv"
if ! { [ -s "$S/era5.sql" ] && [ -s "$S/obs.csv" ]; }; then echo "FAIL  fixture não gerada:"; cat "$S/fixture.log"; FAILS=$((FAILS+1)); exit 1; fi
check "fixture gerada (SQL + CSV)" 1 1
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$S/era5.sql"
check "ERA5 sintético 2014–2023 na célula" 3652 "$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND source='synthetic-qm'")"
docker compose exec -T etl rm -f /data/station-imports/qm_era5_synthetic.sql /data/station-imports/qm_station_synthetic.csv

echo "== Upload de observações (POST /admin/stations/upload → job station-import) =="
call POST /admin/stations/upload "" ; check "sem token → 401" 401 "$STATUS"
STATUS=$(curl -s -o "$S/b.txt" -w '%{http_code}' -X POST -H "Authorization: Bearer $ADMIN" -F "file=@$S/obs.csv;filename=obs.csv" -F "format=generic" -F 'stationMeta="Goiânia sintética;INMET;-16.62;-49.25;750"' "$API/admin/stations/upload"); BODY=$(cat "$S/b.txt")
check "upload → 202" 202 "$STATUS"; UJ=$(echo "$BODY" | j jobId); check "fila era5-ingest" era5-ingest "$(echo "$BODY" | j queue)"
wait_job era5-ingest "$UJ" 120; check "importação concluída" completed "$JOB_STATE"
check "arquivo removido do volume" 0 "$(docker compose exec -T etl sh -c 'ls /data/station-imports | grep -c obs.csv' | tr -d '\r')"
call GET /admin/stations "$ADMIN"; check "estação listada com 10 anos" "$STATION|3652" "$(echo "$BODY" | j 0.code)|$(echo "$BODY" | j 0.obsCount)"
check "estação a ~10 km do nó" 1 "$(sql "SELECT (ST_Distance(geometry, ST_SetSRID(ST_MakePoint($CELL_LON,$CELL_LAT),4326)::geography)/1000 BETWEEN 8 AND 12)::int FROM weather_stations WHERE code='$STATION'")"
STATUS=$(curl -s -o "$S/b.txt" -w '%{http_code}' -X POST -H "Authorization: Bearer $ADMIN" -F "file=@$S/obs.csv;filename=obs.csv" -F "format=generic" "$API/admin/stations/upload"); UJ2=$(cat "$S/b.txt" | j jobId)
wait_job era5-ingest "$UJ2" 120; check "reimportação idempotente" 3652 "$(sql "SELECT count(*) FROM station_daily_obs WHERE station_code='$STATION'")"

echo "== Calibração (POST /admin/qm/calibrate) =="
call POST /admin/qm/calibrate "$ADMIN" '{}'; check "corpo vazio → 400" 400 "$STATUS"
call POST /admin/qm/calibrate "$ADMIN" "{\"cell\":{\"lat\":$CELL_LAT,\"lon\":$CELL_LON},\"station\":\"$STATION\"}"; check "calibrate → 202" 202 "$STATUS"; CJ=$(echo "$BODY" | j jobId)
wait_job era5-ingest "$CJ" 180; check "calibração concluída" completed "$JOB_STATE"
check "uma calibração ativa na célula" 1 "$(sql "SELECT count(*) FROM qm_calibrations WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND active")"
call GET /admin/qm/calibrations "$ADMIN"; check "listagem com estação e distância" "$STATION|true" "$(echo "$BODY" | j 0.stationCode)|$(echo "$BODY" | j 0.active)"
CAL=$(echo "$BODY" | j 0.id)
check "método e período" "empirical-monthly-v1|2014-01-01" "$(echo "$BODY" | j 0.method)|$(echo "$BODY" | j 0.periodFrom)"
check "linhas sintéticas corrigidas (qm_applied)" 3652 "$(sql "SELECT count(*) FROM era5_daily_data WHERE source='synthetic-qm' AND qm_applied AND qm_calibration_id='$CAL'")"
check "linhas reais da célula também corrigidas" 1 "$( [ "$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND source='era5-land' AND NOT qm_applied")" = 0 ] && echo 1 || echo 0 )"
PB=$(sql "SELECT round((100*(sum(e.tp_corrected)-sum(o.precip_mm))/sum(o.precip_mm))::numeric,2) FROM era5_daily_data e JOIN station_daily_obs o ON o.date=e.time AND o.station_code='$STATION' WHERE e.source='synthetic-qm'")
check "PBIAS corrigido < 2 % (obtido $PB %)" 1 "$(node -e 'console.log(Math.abs(Number(process.argv[1]))<2?1:0)' -- "$PB")"
# recalibrar desativa a anterior
call POST /admin/qm/calibrate "$ADMIN" "{\"cell\":{\"lat\":$CELL_LAT,\"lon\":$CELL_LON},\"station\":\"$STATION\"}"; CJ2=$(echo "$BODY" | j jobId); wait_job era5-ingest "$CJ2" 180
check "recalibrar: 2 calibrações, 1 ativa" "2|1" "$(sql "SELECT count(*) FROM qm_calibrations WHERE station_code='$STATION'")|$(sql "SELECT count(*) FROM qm_calibrations WHERE station_code='$STATION' AND active")"
# estação longe ⇒ sem calibração (sem estação informada e a única a 10 km... usa auto numa célula inexistente longe)
call POST /admin/qm/calibrate "$ADMIN" "{\"cell\":{\"lat\":-20.0,\"lon\":-49.3},\"station\":\"$STATION\"}"; CJ3=$(echo "$BODY" | j jobId); wait_job era5-ingest "$CJ3" 120
check "célula sem sobreposição ⇒ job falha" failed "$JOB_STATE"

echo "== Validação (Caso 4) =="
etl qm validate --cell "$CELL_LAT" "$CELL_LON" --station "$STATION" --calib-years 2014-2020 --test-years 2021-2023 --csv /tmp/qm-validate.csv > "$S/val.txt" 2>&1
contains "tabela por mês e total" "$(cat "$S/val.txt")" '^total'
TOTAL_LINE=$(grep '^total' "$S/val.txt"); PBC=$(echo "$TOTAL_LINE" | awk '{print $6}' | tr -d '%')
check "PBIAS corrigido no período de teste < 2 % (obtido ${PBC:-?} %)" 1 "$(node -e 'console.log(Math.abs(Number(process.argv[1]))<2?1:0)' -- "$PBC")"

echo "== Reprocessamento com qmCalibrationId =="
ANA_ID=$(register_and_verify 'Ana Agronoma' ana@fc.local AGRONOMO 529.982.247-25)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
ANA=$(login ana@fc.local 'MinhaS3nha!')
docker compose stop worker >/dev/null 2>&1   # a criação da safra não deve enfileirar processamento concorrente
call POST /properties "$ANA" "{\"name\":\"Fazenda QM\",\"state\":\"GO\",\"city\":\"Goiânia\",\"ownerId\":\"$PEDRO_ID\"}"; P=$(echo "$BODY" | j id)
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-QM\",\"geometry\":$SQ,\"altitudeM\":741}"; F=$(echo "$BODY" | j id)
SOJA=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='SOJA'")
call POST /harvests "$ANA" "{\"fieldId\":\"$F\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$EMERGENCE\",\"season\":\"2025/26\"}"; H=$(echo "$BODY" | j id); check "safra criada" 201 "$STATUS"
call POST "/harvests/$H/msa/process?sync=true&seed=42" "$ADMIN"; check "processamento síncrono → 201" 201 "$STATUS"
ACTIVE=$(sql "SELECT id FROM qm_calibrations WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND active")
check "run registra a calibração ativa" "$ACTIVE" "$(echo "$BODY" | j run.qmCalibrationId)"
check "resumo da calibração na resposta" "$STATION|Goiânia sintética" "$(echo "$BODY" | j run.qmCalibration.stationCode)|$(echo "$BODY" | j run.qmCalibration.stationName)"
check "anos ≈ 10" 1 "$(node -e 'const y=Number(process.argv[1]);console.log(y>=9.5&&y<=10.5?1:0)' -- "$(echo "$BODY" | j run.qmCalibration.years)")"
call GET "/harvests/$H/msa" "$ANA"; check "GET /msa expõe qmCalibration" "$STATION" "$(echo "$BODY" | j run.qmCalibration.stationCode)"
call GET "/harvests/$H/msa/runs" "$ANA"; check "lista de runs idem" "$ACTIVE" "$(echo "$BODY" | j 0.qmCalibrationId)"
docker compose start worker >/dev/null 2>&1

echo; echo "FALHAS: $FAILS"
