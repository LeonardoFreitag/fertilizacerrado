#!/usr/bin/env bash
# Roteiro de ponta a ponta do processamento MSA por safra.
# Insere a série sintética de 2025-02-01 (início do spin-up) a 2026-03-30 (syntheticSeason(423, 2026, '2025-02-01')) para a célula do talhão
# de teste, processa, consulta, confere a predição de produtividade. Pré-requisitos: ver README.md.
set -u
cd "$(dirname "$0")/../../.."
S=$(mktemp -d); trap 'rm -rf "$S"; resume_workers' EXIT
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-); ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
FAILS=0
CELL_LAT=-16.7; CELL_LON=-49.3
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)
# Workers parados durante o roteiro: a criação de safras enfileira backfill/processamento
# (ETL real no CDS, runs extras) que alterariam o estado verificado aqui.
purge_queues()   { for q in era5-ingest msa-process; do docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" EVAL "local n=0 for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) n=n+1 end return n" 0 "bull:$q:*" >/dev/null 2>&1; done; }
pause_workers()  { docker compose stop worker etl >/dev/null 2>&1; }
resume_workers() { purge_queues; docker compose start worker etl >/dev/null 2>&1; }
EMERGENCE=2025-11-01   # emergência; o balanço começa em PRE_FROM (último 1º de fevereiro)
PRE_FROM=2025-02-01

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()     { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }
call()  { local m=$1 p=$2 t=$3 d=${4:-}; local a=(-s -X "$m" -o "$S/b.txt" -w '%{http_code}'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d"); STATUS=$(curl "${a[@]}" "$API$p"); BODY=$(cat "$S/b.txt"); }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:220}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:220}"; FAILS=$((FAILS+1)); fi; }
lacks()    { if echo "$2" | grep -q -- "$3"; then echo "FAIL  $1 (contém: $3)"; FAILS=$((FAILS+1)); else echo "PASS  $1"; fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }
register_and_verify() { call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"; local id; id=$(echo "$BODY" | j user.id); sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""; echo "$id"; }
login() { call POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | j accessToken; }

echo "== Preparação =="
pause_workers
sql "TRUNCATE msa_daily_results, msa_phase_summaries" >/dev/null 2>&1
sql "UPDATE harvests SET latest_run_id = NULL" >/dev/null 2>&1; sql "TRUNCATE msa_runs CASCADE" >/dev/null 2>&1
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1; sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM era5_daily_data WHERE source = 'synthetic'" >/dev/null
sql "DELETE FROM cultivars WHERE is_default = false" >/dev/null
sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null
ANA_ID=$(register_and_verify 'Ana Agronoma' ana@fc.local AGRONOMO 529.982.247-25)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
ANA=$(login ana@fc.local 'MinhaS3nha!'); PEDRO=$(login pedro@fc.local 'MinhaS3nha!'); ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
call POST /properties "$ANA" "{\"name\":\"Fazenda MSA\",\"state\":\"GO\",\"city\":\"Goiânia\",\"ownerId\":\"$PEDRO_ID\"}"; P=$(echo "$BODY" | j id)
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-MSA\",\"geometry\":$SQ,\"altitudeM\":741,\"thetaFC\":0.28,\"thetaWP\":0.12}"; F=$(echo "$BODY" | j id)
check "talhão com altitude e solo" "741|0.28|0.12" "$(echo "$BODY" | j altitudeM)|$(echo "$BODY" | j thetaFC)|$(echo "$BODY" | j thetaWP)"
check "célula do talhão" "{\"lat\":$CELL_LAT,\"lon\":$CELL_LON}" "$(echo "$BODY" | j era5Cell)"
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-sem-altitude\",\"geometry\":$SQ}"; F2=$(echo "$BODY" | j id)
SOJA=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='SOJA'")
call POST /harvests "$ANA" "{\"fieldId\":\"$F\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$EMERGENCE\",\"season\":\"2025/26\",\"expectedYield\":65}"; H=$(echo "$BODY" | j id); check "safra criada" 201 "$STATUS"
check "expectedYield 65 na safra" 65 "$(echo "$BODY" | j expectedYield)"
check "criação enfileira o MSA (msaJobId)" 1 "$( [ -n "$(echo "$BODY" | j msaJobId)" ] && echo 1 || echo 0 )"
call POST /harvests "$ANA" "{\"fieldId\":\"$F2\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$EMERGENCE\",\"season\":\"2025/26\"}"; H2=$(echo "$BODY" | j id)

echo "== Série sintética (2025-02-01 … 2026-03-30, 423 dias) via SQL para a célula =="
(cd backend && node -e '
require("ts-node").register({transpileOnly:true});
const {syntheticSeason}=require("./src/modules/msa/synthetic-season");
const [lat,lon]=[process.argv[1],process.argv[2]];
const rows=syntheticSeason(423,2026,"2025-02-01").map(d=>`('"'"'${d.date}'"'"',${lat},${lon},${d.tmax},${d.tmin},${((d.tmax+d.tmin)/2)},${d.tdew},${d.u2},${d.rn},${d.precipitation},${d.precipitation},false,'"'"'synthetic'"'"')`);
console.log("INSERT INTO era5_daily_data (time,cell_lat,cell_lon,t2m_max,t2m_min,t2m_mean,d2m_mean,u2,rn,tp_raw,tp_corrected,qm_applied,source) VALUES\n"+rows.join(",\n")+"\nON CONFLICT (time,cell_lat,cell_lon) DO UPDATE SET t2m_max=EXCLUDED.t2m_max,t2m_min=EXCLUDED.t2m_min,t2m_mean=EXCLUDED.t2m_mean,d2m_mean=EXCLUDED.d2m_mean,u2=EXCLUDED.u2,rn=EXCLUDED.rn,tp_raw=EXCLUDED.tp_raw,tp_corrected=EXCLUDED.tp_corrected,source=EXCLUDED.source;");' -- "$CELL_LAT" "$CELL_LON") > "$S/insert.sql"
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$S/insert.sql"
check "423 dias sintéticos na célula" 423 "$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=$CELL_LAT AND cell_lon=$CELL_LON AND source='synthetic'")"
LAST_SYN=$(sql "SELECT max(time) FROM era5_daily_data WHERE source='synthetic'")

echo "== Processamento (assíncrono por padrão; síncrono só para ADMIN via ?sync=true) =="
call POST "/harvests/$H/msa/process" "$PEDRO";  check "produtor processa → 403" 403 "$STATUS"
call POST "/harvests/$H/msa/process" "$ANA";    check "agrônoma → 202 enfileirado" 202 "$STATUS"; check "fila msa-process, status queued" "msa-process|queued" "$(echo "$BODY" | j queue)|$(echo "$BODY" | j status)"
check "jobId na resposta" 1 "$( [ -n "$(echo "$BODY" | j jobId)" ] && echo 1 || echo 0 )"
call POST "/harvests/$H/msa/process?sync=true" "$ANA"; check "sync para agrônoma → 403 SYNC_ADMIN_ONLY" 403 "$STATUS"; contains "código SYNC_ADMIN_ONLY" "$BODY" SYNC_ADMIN_ONLY
call POST "/harvests/$H2/msa/process?sync=true" "$ADMIN"; check "talhão sem altitude (sync) → 422" 422 "$STATUS"; contains "código MISSING_FIELD_ALTITUDE" "$BODY" MISSING_FIELD_ALTITUDE
check "nenhuma run criada para o 422" 0 "$(sql "SELECT count(*) FROM msa_runs WHERE harvest_id='$H2'")"
call GET "/harvests/$H/msa" "$ANA";             check "sem run → 404 NO_MSA_RESULT" 404 "$STATUS"; contains "código NO_MSA_RESULT" "$BODY" NO_MSA_RESULT
call POST "/harvests/$H/msa/process?seed=42&sync=true" "$ADMIN"; check "?seed → 400 (motor determinístico)" 400 "$STATUS"; contains "aponta seed" "$BODY" '"seed"'
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "processamento síncrono → 201" 201 "$STATUS"
check "reason MANUAL, sem jobId" "MANUAL|null" "$(echo "$BODY" | j run.reason)|$(echo "$BODY" | j run.jobId)"
RUN1=$(echo "$BODY" | j run.id)
check "status SUCCEEDED" SUCCEEDED "$(echo "$BODY" | j run.status)"
lacks "run sem seed/iterações/sigmas" "$BODY" '"seed"'
check "engineVersion" 2.2.0 "$(echo "$BODY" | j run.engineVersion)"
check "dateFrom/preSeasonFrom = 1º de fevereiro" "$PRE_FROM|$PRE_FROM" "$(echo "$BODY" | j run.dateFrom)|$(echo "$BODY" | j run.preSeasonFrom)"
check "Kc e Zr da entressafra gravados" "1|0.95" "$(echo "$BODY" | j run.preSeasonKc)|$(echo "$BODY" | j run.preSeasonZr)"
EDP=$(echo "$BODY" | j run.emergenceDepletionPct); echo "      depleção na emergência: $(echo "$BODY" | j run.emergenceDepletionMm) mm ($EDP %)"
check "entressafra seca ⇒ depleção na emergência > 0 e ≤ 100" 1 "$(node -e "console.log(($EDP>0&&$EDP<=100)?1:0)")"
YI=$(echo "$BODY" | j run.yieldIndex); PY=$(echo "$BODY" | j run.predictedYield); echo "      yieldIndex = $YI · predictedYield = $PY sc/ha"
check "expectedYield da run = Ym da safra" 65 "$(echo "$BODY" | j run.expectedYield)"
check "phasesReached 4" 4 "$(echo "$BODY" | j run.phasesReached)"
check "índice em (0, 1]" 1 "$(node -e "console.log(($YI>0&&$YI<=1)?1:0)")"
check "predita = Ym × índice (6 casas)" "$(node -e "console.log((65*$YI).toFixed(6))")" "$(node -e "console.log(Number(process.argv[1]).toFixed(6))" "$PY")"
TO1=$(echo "$BODY" | j run.dateTo); echo "      dateTo (GDA atinge gdaTotal): $TO1 (série vai até $LAST_SYN)"
check "ciclo encerra antes do fim da série" 1 "$( [ "$TO1" \< "$LAST_SYN" ] && echo 1 || echo 0 )"
check "snapshot da cultivar com 16 parâmetros (tUpper) + id" "1200|1.15|30|$SOJA" "$(echo "$BODY" | j run.cultivarSnapshot.gdaTotal)|$(echo "$BODY" | j run.cultivarSnapshot.kcMid)|$(echo "$BODY" | j run.cultivarSnapshot.tUpper)|$(echo "$BODY" | j run.cultivarSnapshot.id)"
check "snapshot do solo (sem defaults)" "0.28|0.12|741|false" "$(echo "$BODY" | j run.soilSnapshot.thetaFC)|$(echo "$BODY" | j run.soilSnapshot.thetaWP)|$(echo "$BODY" | j run.soilSnapshot.altitudeM)|$(echo "$BODY" | j run.soilSnapshot.soilDefaults)"
check "4 janelas" 4 "$(echo "$BODY" | j phases.length)"
check "currentPhase COMPLETED" COMPLETED "$(echo "$BODY" | j currentPhase)"
lacks "resumos sem percentis" "$BODY" percentiles
lacks "resumos sem validIterations" "$BODY" validIterations
check "cultivarChangedSinceRun ausente no resultado do processamento, false na consulta" "" "$(echo "$BODY" | j cultivarChangedSinceRun)"
check "latestRunId = run" "$RUN1" "$(sql "SELECT latest_run_id FROM harvests WHERE id='$H'")"
N_DAILY=$(sql "SELECT count(*) FROM msa_daily_results WHERE run_id='$RUN1'"); echo "      dias na série baseline: $N_DAILY"
check "série baseline gravada" 1 "$( [ "$N_DAILY" -gt 60 ] && echo 1 || echo 0 )"

echo "== Consultas =="
call GET "/harvests/$H/msa" "$PEDRO";          check "produtor lê o último → 200" 200 "$STATUS"; check "é a run 1" "$RUN1" "$(echo "$BODY" | j run.id)"
check "cultivarChangedSinceRun false" false "$(echo "$BODY" | j cultivarChangedSinceRun)"
check "predita na consulta" "$PY" "$(echo "$BODY" | j run.predictedYield)"
call GET "/harvests/$H/msa/daily" "$PEDRO";    check "série diária (sem entressafra) → 200" 200 "$STATUS"; check "primeiro dia = emergência" "$EMERGENCE" "$(echo "$BODY" | j days.0.date)"; lacks "sem PRE por padrão" "$BODY" '"phase":"PRE"'
N_CROP=$(echo "$BODY" | j days.length)
call GET "/harvests/$H/msa/daily?includePreSeason=true" "$PEDRO"; check "série com entressafra → 200" 200 "$STATUS"; check "primeiro dia = 1º de fevereiro, PRE, gda 0" "$PRE_FROM|PRE|0" "$(echo "$BODY" | j days.0.date)|$(echo "$BODY" | j days.0.phase)|$(echo "$BODY" | j days.0.gda)"
check "série completa = cultura + entressafra" "$N_DAILY" "$(echo "$BODY" | j days.length)"; check "dias de cultura < total" 1 "$( [ "$N_CROP" -lt "$N_DAILY" ] && echo 1 || echo 0 )"
call GET "/harvests/$H/msa/daily?includePreSeason=sim" "$PEDRO"; check "includePreSeason inválido → 400" 400 "$STATUS"; contains "aponta includePreSeason" "$BODY" '"includePreSeason"'
call GET "/harvests/$H/msa/daily?runId=00000000-0000-4000-8000-000000000000" "$ANA"; check "run de outra safra/inexistente → 404" 404 "$STATUS"
call GET "/harvests/$H/msa/runs" "$ANA";       check "histórico com 1 run" 1 "$(echo "$BODY" | j length)"
call GET "/harvests/$H/msa" "$ADMIN";          check "admin lê → 200" 200 "$STATUS"

echo "== Lacuna na entressafra ⇒ NEEDS_DATA =="
sql "DELETE FROM era5_daily_data WHERE source='synthetic' AND time IN ('2025-06-10','2025-06-11')" >/dev/null
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "lacuna em junho → 200 NEEDS_DATA" 200 "$STATUS"; check "missingDates de junho" '["2025-06-10","2025-06-11"]' "$(echo "$BODY" | j run.missingDates)"
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$S/insert.sql"   # repõe os dias

echo "== Lacuna ⇒ NEEDS_DATA =="
sql "DELETE FROM era5_daily_data WHERE source='synthetic' AND time IN ('2025-11-15','2025-11-16')" >/dev/null
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "com lacuna → 200" 200 "$STATUS"; check "status NEEDS_DATA" NEEDS_DATA "$(echo "$BODY" | j run.status)"
check "missingDates" '["2025-11-15","2025-11-16"]' "$(echo "$BODY" | j run.missingDates)"
check "latestRunId inalterado" "$RUN1" "$(sql "SELECT latest_run_id FROM harvests WHERE id='$H'")"
call GET "/harvests/$H/msa/runs" "$ANA";       check "histórico com 3 runs" 3 "$(echo "$BODY" | j length)"; check "mais recente primeiro" NEEDS_DATA "$(echo "$BODY" | j 0.status)"
echo "== Lacuna após o fim do ciclo não bloqueia =="
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$S/insert.sql"   # repõe os dias
AFTER=$(sql "SELECT (date '$TO1' + 3)::text"); sql "DELETE FROM era5_daily_data WHERE source='synthetic' AND time = '$AFTER'" >/dev/null
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "lacuna depois de dateTo → 201" 201 "$STATUS"; RUN3=$(echo "$BODY" | j run.id)
check "mesmo dateTo" "$TO1" "$(echo "$BODY" | j run.dateTo)"
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$S/insert.sql"

echo "== Reprodutibilidade (determinística, sem semente) =="
S1=$(sql "SELECT string_agg(phase||':'||coalesce(ks_mean::text,'null')||':'||coalesce(yield_reduction_pct::text,'null')||':'||etc_adj_accum, '|' ORDER BY phase) FROM msa_phase_summaries WHERE run_id='$RUN1'")
S3=$(sql "SELECT string_agg(phase||':'||coalesce(ks_mean::text,'null')||':'||coalesce(yield_reduction_pct::text,'null')||':'||etc_adj_accum, '|' ORDER BY phase) FROM msa_phase_summaries WHERE run_id='$RUN3'")
check "índice e predita idênticos" "$YI|$PY" "$(sql "SELECT yield_index||'|'||predicted_yield FROM msa_runs WHERE id='$RUN3'")"
check "resumos idênticos entre run 1 e run 3" "$S1" "$S3"
D1=$(sql "SELECT md5(string_agg(date||':'||ks||':'||dr||':'||et0, '|' ORDER BY date)) FROM msa_daily_results WHERE run_id='$RUN1'")
D3=$(sql "SELECT md5(string_agg(date||':'||ks||':'||dr||':'||et0, '|' ORDER BY date)) FROM msa_daily_results WHERE run_id='$RUN3'")
check "série baseline idêntica" "$D1" "$D3"
echo "      $S1"
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "reprocessamento → 201" 201 "$STATUS"
check "latestRunId = run mais recente SUCCEEDED" "$(echo "$BODY" | j run.id)" "$(sql "SELECT latest_run_id FROM harvests WHERE id='$H'")"

echo "== Ym alterada depois da run não recalcula =="
call PATCH "/harvests/$H" "$ANA" '{"expectedYield":70}'; check "PATCH expectedYield 70 → 200" 200 "$STATUS"; check "safra com 70" 70 "$(echo "$BODY" | j expectedYield)"
call GET "/harvests/$H/msa" "$ANA"; check "run mantém expectedYield 65" 65 "$(echo "$BODY" | j run.expectedYield)"; check "run mantém predita" "$PY" "$(echo "$BODY" | j run.predictedYield)"
call POST "/harvests/$H/msa/process?sync=true" "$ADMIN"; check "nova run usa 70" 70 "$(echo "$BODY" | j run.expectedYield)"; check "predita = 70 × índice (6 casas)" "$(node -e "console.log((70*$YI).toFixed(6))")" "$(node -e "console.log(Number(process.argv[1]).toFixed(6))" "$(echo "$BODY" | j run.predictedYield)")"

echo "== Safra sem Ym e cultivar alterada desde a run =="
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-MSA-2\",\"geometry\":$SQ,\"altitudeM\":741}"; F3=$(echo "$BODY" | j id)
PARAMS='"tBase":10,"tUpper":30,"gdaTotal":1200,"gdaF1End":120,"gdaF2End":450,"gdaF3End":900,"kcIni":0.2,"kcMid":1.15,"kcEnd":0.5,"depletionFraction":0.5,"zrIni":0.3,"zrMax":0.95,"kyF1":0.2,"kyF2":0.8,"kyF3":1.0,"kyF4":0.4'
call POST /cultivars "$ANA" "{\"name\":\"Soja MSA\",$PARAMS}"; check "cultivar própria → 201" 201 "$STATUS"; C=$(echo "$BODY" | j id)
call POST /harvests "$ANA" "{\"fieldId\":\"$F3\",\"cultivarId\":\"$C\",\"emergenceDate\":\"$EMERGENCE\",\"season\":\"2025/26\"}"; H3=$(echo "$BODY" | j id); check "safra sem Ym → 201" 201 "$STATUS"; check "expectedYield null" null "$(echo "$BODY" | j expectedYield)"
call POST "/harvests/$H3/msa/process?sync=true" "$ADMIN"; check "processa sem Ym → 201" 201 "$STATUS"
check "índice gravado, predita e Ym nulas" "1|null|null" "$(node -e "console.log(($(echo "$BODY" | j run.yieldIndex)>0)?1:0)")|$(echo "$BODY" | j run.predictedYield)|$(echo "$BODY" | j run.expectedYield)"
call PATCH "/cultivars/$C" "$ANA" '{"kcMid":1.1}'; check "edita cultivar em uso → 200" 200 "$STATUS"
call GET "/harvests/$H3/msa" "$PEDRO"; check "cultivarChangedSinceRun true" true "$(echo "$BODY" | j cultivarChangedSinceRun)"; check "snapshot da run intacto" 1.15 "$(echo "$BODY" | j run.cultivarSnapshot.kcMid)"
call POST "/harvests/$H3/msa/process?sync=true" "$ADMIN"; check "run nova usa 1.1" 1.1 "$(echo "$BODY" | j run.cultivarSnapshot.kcMid)"
call GET "/harvests/$H3/msa" "$PEDRO"; check "após reprocessar, false" false "$(echo "$BODY" | j cultivarChangedSinceRun)"

echo "== Emergência dentro do lag (safra criada 3 dias depois) =="
RECENT=$(date -u -v-3d +%F 2>/dev/null || date -u -d '-3 days' +%F)
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T-recente\",\"geometry\":$SQ,\"altitudeM\":741}"; F4=$(echo "$BODY" | j id)
call POST /harvests "$ANA" "{\"fieldId\":\"$F4\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$RECENT\",\"season\":\"2026/27\"}"; H4=$(echo "$BODY" | j id); check "safra recente → 201" 201 "$STATUS"
call POST "/harvests/$H4/msa/process?sync=true" "$ADMIN"; check "emergência no lag → 200 NEEDS_DATA" 200 "$STATUS"; check "missingDates = [emergência]" "[\"$RECENT\"]" "$(echo "$BODY" | j run.missingDates)"
check "nenhum dia PRE gravado" 0 "$(sql "SELECT count(*) FROM msa_daily_results d JOIN msa_runs r ON r.id = d.run_id WHERE r.harvest_id='$H4'")"
call GET "/harvests/$H4/msa" "$ANA"; check "GET /msa continua 404" 404 "$STATUS"

echo "== Rotas de decisão removidas =="
call GET "/harvests/$H/msa/decision?phase=F3&doseBase=100&efficiencyBase=0.6" "$ANA"; check "GET /msa/decision → 404" 404 "$STATUS"
call POST "/harvests/$H/msa/decisions" "$ANA" '{"phase":"F3","scenario":"A","doseBase":100,"efficiencyBase":0.6,"justification":"x"}'; check "POST /msa/decisions → 404" 404 "$STATUS"
call GET "/harvests/$H/msa/decisions" "$ANA"; check "GET /msa/decisions → 404" 404 "$STATUS"
check "tabela msa_decisions não existe" 0 "$(sql "SELECT count(*) FROM information_schema.tables WHERE table_name='msa_decisions'")"

echo "== Limpeza =="
sql "DELETE FROM era5_daily_data WHERE source='synthetic'" >/dev/null
echo; echo "FALHAS: $FAILS"
