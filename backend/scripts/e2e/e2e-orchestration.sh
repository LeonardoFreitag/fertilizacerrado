#!/usr/bin/env bash
# Roteiro de ponta a ponta da orquestração (BullMQ): backfill automático na criação de
# safra (flow pai Node + filho Python), endpoints /admin/jobs, 202 + jobId, válvula sync,
# reinício do worker com job pendente e runs órfãs do ETL. Pré-requisitos: ver README.md
# (stack completa no ar — api, worker, etl — e o cache do ETL com os meses da célula de teste).
# Com ERA5_E2E_CDS=1 também dispara `ingest-latest` real no CDS (exige CDS_API_KEY).
set -u
cd "$(dirname "$0")/../../.."
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-); ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)
FAILS=0
CELL_LAT=-16.7; CELL_LON=-49.3
EMERGENCE=2025-11-01

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()     { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }
call()  { local m=$1 p=$2 t=$3 d=${4:-}; local a=(-s -X "$m" -o "$S/b.txt" -w '%{http_code}'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d"); STATUS=$(curl "${a[@]}" "$API$p"); BODY=$(cat "$S/b.txt"); }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:220}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:220}"; FAILS=$((FAILS+1)); fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }
register_and_verify() { call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"; local id; id=$(echo "$BODY" | j user.id); sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""; echo "$id"; }
login() { call POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | j accessToken; }
purge_queues() { for q in era5-ingest msa-process; do docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" EVAL "local n=0 for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) n=n+1 end return n" 0 "bull:$q:*" >/dev/null 2>&1; done; }
# wait_job FILA ID [SEGUNDOS] -> JOB_STATE (completed|failed|timeout); mantém BODY com o JobView
wait_job() { local q=$1 id=$2 limit=${3:-240} t=0; JOB_STATE=timeout; while [ $t -lt "$limit" ]; do call GET "/admin/jobs/$q/$id" "$ADMIN"; local st; st=$(echo "$BODY" | j state); if [ "$st" = completed ] || [ "$st" = failed ]; then JOB_STATE=$st; return; fi; sleep 2; t=$((t+2)); done; }

echo "== Preparação =="
docker compose up -d worker etl >/dev/null 2>&1
purge_queues
sql "TRUNCATE msa_decisions, msa_daily_results, msa_phase_summaries" >/dev/null 2>&1
sql "UPDATE harvests SET latest_run_id = NULL" >/dev/null 2>&1; sql "TRUNCATE msa_runs CASCADE" >/dev/null 2>&1
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1; sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM era5_daily_data WHERE source = 'synthetic'" >/dev/null
sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null
ANA_ID=$(register_and_verify 'Ana Agronoma' ana@fc.local AGRONOMO 529.982.247-25)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
ANA=$(login ana@fc.local 'MinhaS3nha!'); PEDRO=$(login pedro@fc.local 'MinhaS3nha!'); ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
call POST /properties "$ANA" "{\"name\":\"Fazenda Filas\",\"state\":\"GO\",\"city\":\"Goiânia\",\"ownerId\":\"$PEDRO_ID\"}"; P=$(echo "$BODY" | j id)
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-filas\",\"geometry\":$SQ,\"altitudeM\":741,\"thetaFC\":0.28,\"thetaWP\":0.12}"; F=$(echo "$BODY" | j id)
check "célula do talhão em cache" "{\"lat\":$CELL_LAT,\"lon\":$CELL_LON}" "$(echo "$BODY" | j era5Cell)"
SOJA=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='SOJA'")
if [ -z "${ERA5_E2E_CDS:-}" ]; then
  # Sem CDS: os arquivos do cache passam a contar como "baixados hoje" para o mês ainda
  # aberto não ser requisitado de novo (regra de atualização diária do download.py).
  docker compose exec -T etl sh -c 'find /data/cache -name "*.nc" -exec touch {} +' 2>/dev/null
  echo "      (ERA5_E2E_CDS não definido: sem requisições ao CDS; cache tratado como do dia)"
fi

echo "== Segurança dos endpoints de administração =="
call GET /admin/jobs/queues "";       check "sem token → 401" 401 "$STATUS"
call GET /admin/jobs/queues "$ANA";   check "agrônoma → 403" 403 "$STATUS"
call GET /admin/jobs/queues "$PEDRO"; check "produtor → 403" 403 "$STATUS"
call GET /admin/jobs/queues "$ADMIN"; check "admin → 200" 200 "$STATUS"
contains "contagens de era5-ingest" "$BODY" '"era5-ingest"'; contains "contagens de msa-process" "$BODY" '"msa-process"'; contains "contagens de msa-weekly" "$BODY" '"msa-weekly"'
check "semanal registrado: segunda 02:00 Brasília = 05:00Z" "T05:00:00.000Z|0 2 * * 1|America/Sao_Paulo" "$(echo "$BODY" | j weekly.nextRun | cut -c11-)|$(echo "$BODY" | j weekly.pattern)|$(echo "$BODY" | j weekly.tz)"
check "nextRun cai numa segunda-feira" 1 "$(node -e 'console.log(new Date(process.argv[1]).getUTCDay())' "$(echo "$BODY" | j weekly.nextRun)")"
call GET /admin/jobs/msa-process/nao-existe "$ADMIN"; check "job inexistente → 404" 404 "$STATUS"
call GET /admin/jobs/outra-fila/1 "$ADMIN";           check "fila desconhecida → 400" 400 "$STATUS"
call POST /admin/jobs/backfill-region "$ADMIN" '{"bbox":[-16.8,-49.4,-16.1,-48.7],"from":"2025-11-01","to":"2025-11-30"}'; check "bbox com N<S → 400" 400 "$STATUS"
call POST /admin/jobs/backfill-region "$ADMIN" '{"bbox":[-16.1,-49.4,-16.8,-48.7],"from":"2025-12-01","to":"2025-11-30"}'; check "to < from → 400" 400 "$STATUS"

echo "== Backfill automático na criação da safra (flow: era5-ingest cell → msa-process BACKFILL) =="
call POST /harvests "$ANA" "{\"fieldId\":\"$F\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$EMERGENCE\",\"season\":\"2025/26\"}"; H=$(echo "$BODY" | j id); check "safra criada → 201" 201 "$STATUS"
JOB=$(echo "$BODY" | j msaJobId); check "msaJobId presente" 1 "$( [ -n "$JOB" ] && echo 1 || echo 0 )"
call GET "/admin/jobs/msa-process/$JOB" "$ADMIN"; check "job pai consultável → 200" 200 "$STATUS"
check "pai é BACKFILL da safra" "$H|BACKFILL" "$(echo "$BODY" | j data.harvestId)|$(echo "$BODY" | j data.reason)"
contains "pai aguarda o filho ou já roda" "waiting-children active completed" "$(echo "$BODY" | j state)"
echo "      aguardando o ETL (Python) e o processamento (Node)..."
wait_job msa-process "$JOB" 300; check "flow concluído" completed "$JOB_STATE"
check "retorno do job: run SUCCEEDED" SUCCEEDED "$(echo "$BODY" | j returnvalue.status)"
ING=$(sql "SELECT status||'|'||coalesce(job_id,'')||'|'||command FROM era5_ingestion_runs ORDER BY started_at DESC LIMIT 1")
check "run do ETL SUCCEEDED com job_id, vinda do worker" "SUCCEEDED|worker" "$(echo "$ING" | cut -d'|' -f1)|$(echo "$ING" | cut -d'|' -f3 | cut -c1-6)"
check "job_id do ETL preenchido" 1 "$( [ -n "$(echo "$ING" | cut -d'|' -f2)" ] && echo 1 || echo 0 )"
ROWS=$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND time BETWEEN '$EMERGENCE' AND current_date - 6")
check "célula coberta da emergência a hoje−6 (≥ 300 dias)" 1 "$( [ "$ROWS" -ge 300 ] && echo 1 || echo 0 )"
call GET "/harvests/$H/msa" "$ANA"; check "resultado disponível → 200" 200 "$STATUS"
check "run reason BACKFILL com jobId do flow" "BACKFILL|$JOB|SUCCEEDED" "$(echo "$BODY" | j run.reason)|$(echo "$BODY" | j run.jobId)|$(echo "$BODY" | j run.status)"
check "triggeredById nulo (sistema)" null "$(echo "$BODY" | j run.triggeredById)"

echo "== Segunda safra na mesma célula: cobertura completa ⇒ só msa-process =="
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-filas-2\",\"geometry\":$SQ,\"altitudeM\":700}"; F2=$(echo "$BODY" | j id)
call POST /harvests "$ANA" "{\"fieldId\":\"$F2\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"2025-12-01\",\"season\":\"2025/26\"}"; HX=$(echo "$BODY" | j id); JOB2=$(echo "$BODY" | j msaJobId)
check "msaJobId determinístico (backfill_<harvestId>)" "backfill_$HX" "$JOB2"
wait_job msa-process "$JOB2" 120; check "processado sem ETL" completed "$JOB_STATE"
check "nenhuma run nova do ETL" "$ING" "$(sql "SELECT status||'|'||coalesce(job_id,'')||'|'||command FROM era5_ingestion_runs ORDER BY started_at DESC LIMIT 1")"

echo "== POST .../msa/process: 202 por padrão, sync só ADMIN =="
call POST "/harvests/$H/msa/process" "$PEDRO";     check "produtor → 403" 403 "$STATUS"
call POST "/harvests/$H/msa/process?seed=7" "$ANA"; check "agrônoma → 202" 202 "$STATUS"; JOB3=$(echo "$BODY" | j jobId)
check "corpo: queue msa-process, status queued" "msa-process|queued" "$(echo "$BODY" | j queue)|$(echo "$BODY" | j status)"
wait_job msa-process "$JOB3" 120; check "job manual concluído" completed "$JOB_STATE"
call GET "/harvests/$H/msa/runs" "$ANA"; check "run mais recente MANUAL com jobId e seed 7" "MANUAL|$JOB3|7" "$(echo "$BODY" | j 0.reason)|$(echo "$BODY" | j 0.jobId)|$(echo "$BODY" | j 0.seed)"
call POST "/harvests/$H/msa/process?sync=true" "$ANA";   check "sync para agrônoma → 403 SYNC_ADMIN_ONLY" 403 "$STATUS"; contains "código" "$BODY" SYNC_ADMIN_ONLY
call POST "/harvests/$H/msa/process?sync=true&seed=7" "$ADMIN"; check "sync para admin → 201 inline" 201 "$STATUS"
check "run inline: MANUAL, sem jobId, triggeredById preenchido" "MANUAL|null|1" "$(echo "$BODY" | j run.reason)|$(echo "$BODY" | j run.jobId)|$( [ -n "$(echo "$BODY" | j run.triggeredById)" ] && echo 1 || echo 0 )"
call POST "/harvests/00000000-0000-4000-8000-000000000000/msa/process" "$ANA"; check "safra inexistente → 404 (nada enfileirado)" 404 "$STATUS"

echo "== process-all (ADMIN) =="
call POST /admin/jobs/process-all "$ANA";   check "agrônoma → 403" 403 "$STATUS"
call POST /admin/jobs/process-all "$ADMIN"; check "admin → 202" 202 "$STATUS"
check "uma entrada por safra ativa (2)" 2 "$(echo "$BODY" | j count)"
PA=$(echo "$BODY" | j jobs.0.jobId); wait_job msa-process "$PA" 120; check "job do process-all concluído" completed "$JOB_STATE"
check "runs MANUAL via fila" 1 "$( [ "$(sql "SELECT count(*) FROM msa_runs WHERE reason='MANUAL' AND job_id IS NOT NULL")" -ge 3 ] && echo 1 || echo 0 )"

echo "== Worker reiniciado com job pendente =="
docker compose stop worker >/dev/null 2>&1
call POST "/harvests/$H/msa/process" "$ANA"; JOB4=$(echo "$BODY" | j jobId); check "enfileira com o worker parado → 202" 202 "$STATUS"
call GET "/admin/jobs/msa-process/$JOB4" "$ADMIN"; check "job espera na fila" waiting "$(echo "$BODY" | j state)"
docker compose start worker >/dev/null 2>&1
wait_job msa-process "$JOB4" 120; check "worker de volta conclui o job" completed "$JOB_STATE"

echo "== Run órfã do ETL (RUNNING sem heartbeat há 7 h) ⇒ FAILED orphaned na subida =="
ORPHAN=$(sql "WITH r AS (INSERT INTO era5_ingestion_runs (id, command, status, started_at, updated_at) VALUES (gen_random_uuid(), 'e2e órfã', 'RUNNING', now() - interval '7 hours', now() - interval '7 hours') RETURNING id) SELECT id FROM r")
RECENT=$(sql "WITH r AS (INSERT INTO era5_ingestion_runs (id, command, status) VALUES (gen_random_uuid(), 'e2e recente', 'RUNNING') RETURNING id) SELECT id FROM r")
docker compose restart etl >/dev/null 2>&1; sleep 6
check "órfã → FAILED" FAILED "$(sql "SELECT status FROM era5_ingestion_runs WHERE id='$ORPHAN'")"
contains "erro orphaned" "$(sql "SELECT error FROM era5_ingestion_runs WHERE id='$ORPHAN'")" orphaned
check "recente continua RUNNING" RUNNING "$(sql "SELECT status FROM era5_ingestion_runs WHERE id='$RECENT'")"
sql "DELETE FROM era5_ingestion_runs WHERE id IN ('$ORPHAN','$RECENT')" >/dev/null

if [ -n "${ERA5_E2E_CDS:-}" ]; then
  echo "== ingest-latest real no CDS (ERA5_E2E_CDS=1) =="
  call POST /admin/jobs/ingest-latest "$ADMIN"; check "admin → 202" 202 "$STATUS"; JI=$(echo "$BODY" | j jobId)
  check "fila era5-ingest" era5-ingest "$(echo "$BODY" | j queue)"
  wait_job era5-ingest "$JI" 1800; check "ingest latest concluído" completed "$JOB_STATE"
  check "progresso por período reportado" 1 "$( [ -n "$(echo "$BODY" | j progress.periodsTotal)" ] && echo 1 || echo 0 )"
else
  echo "== ingest-latest real pulado (defina ERA5_E2E_CDS=1 com CDS_API_KEY para rodar) =="
  call POST /admin/jobs/ingest-latest "$ANA"; check "agrônoma → 403" 403 "$STATUS"
fi

echo "== Limpeza =="
purge_queues
echo; echo "FALHAS: $FAILS"
