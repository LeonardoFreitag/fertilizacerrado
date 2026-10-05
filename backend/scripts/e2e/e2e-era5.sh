#!/usr/bin/env bash
# Roteiro de ponta a ponta do ETL ERA5-Land contra o CDS real.
# Exige CDS_API_KEY no .env (e a licença do dataset aceita); sem a chave, pula com aviso.
# Pré-requisitos e uso: ver README.md neste diretório. Pode levar minutos (fila do CDS).
set -u
cd "$(dirname "$0")/../../.."
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT
API=http://localhost:3000/api/v1
FAILS=0
# Intervalo de teste: 3 dias de um mês consolidado (ajuste se quiser outro)
FROM=${ERA5_E2E_FROM:-2025-06-01}; TO=${ERA5_E2E_TO:-2025-06-03}
# O backfill vai da emergência a hoje−6: uma requisição ao CDS por mês (~10 min cada na fila).
# Só roda com ERA5_E2E_BACKFILL=1; o ingest acima já prova a cadeia inteira.
RUN_BACKFILL=${ERA5_E2E_BACKFILL:-0}

if ! grep -q '^CDS_API_KEY=.\+' .env 2>/dev/null; then
  echo "SKIP  CDS_API_KEY ausente no .env — roteiro ERA5 não executado"; exit 0
fi

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()     { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }
call()  { local m=$1 p=$2 t=$3 d=${4:-}; local a=(-s -X "$m" -o "$S/b.txt" -w '%{http_code}'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d"); STATUS=$(curl "${a[@]}" "$API$p"); BODY=$(cat "$S/b.txt"); }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:200}"; FAILS=$((FAILS+1)); fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }

echo "== Preparação: agrônomo, propriedade, talhão (célula −16,7/−49,3) e safra =="
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1; sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM users WHERE email = 'era5@fc.local'" >/dev/null
call POST /auth/register "" '{"name":"Era Agronoma","email":"era5@fc.local","password":"MinhaS3nha!","role":"AGRONOMO","cpf":"529.982.247-25"}'
sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""
call POST /auth/login "" '{"email":"era5@fc.local","password":"MinhaS3nha!"}'; TOKEN=$(echo "$BODY" | j accessToken)
call POST /properties "$TOKEN" '{"name":"Fazenda ERA5","state":"GO","city":"Goiânia"}'; P=$(echo "$BODY" | j id)
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
call POST "/properties/$P/fields" "$TOKEN" "{\"name\":\"T-ERA5\",\"geometry\":$SQ}"; F=$(echo "$BODY" | j id)
check "talhão criado com célula" '{"lat":-16.7,"lon":-49.3}' "$(echo "$BODY" | j era5Cell)"
SOJA=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='SOJA'")
call POST /harvests "$TOKEN" "{\"fieldId\":\"$F\",\"cultivarId\":\"$SOJA\",\"emergenceDate\":\"$FROM\",\"season\":\"2025/26\"}"; H=$(echo "$BODY" | j id)
check "safra criada" 201 "$STATUS"

echo "== ingest $FROM → $TO (1 célula) — medindo a fila do CDS =="
T0=$(date +%s)
docker compose run --rm etl ingest --from "$FROM" --to "$TO" 2>&1 | grep -v '^Container' | tee "$S/ingest.log" | tail -4
RC=${PIPESTATUS[0]}; T1=$(date +%s)
check "ingest terminou com código 0" 0 "$RC"
echo "      tempo total do ingest (fila do CDS incluída): $((T1-T0)) s"
check "3 linhas para a célula" 3 "$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=-16.7 AND cell_lon=-49.3 AND time BETWEEN '$FROM' AND '$TO'")"
check "run SUCCEEDED" SUCCEEDED "$(sql "SELECT status FROM era5_ingestion_runs ORDER BY started_at DESC LIMIT 1")"
echo "      valores: $(sql "SELECT time, round(t2m_max::numeric,1), round(t2m_min::numeric,1), round(u2::numeric,2), round(rn::numeric,2), round(tp_raw::numeric,2) FROM era5_daily_data WHERE cell_lat=-16.7 AND cell_lon=-49.3 AND time BETWEEN '$FROM' AND '$TO' ORDER BY time" | tr '\n' ' ')"
check "plausibilidade: tmax > tmin e rn > 0" t "$(sql "SELECT bool_and(t2m_max > t2m_min AND rn > 0 AND tp_raw >= 0) FROM era5_daily_data WHERE cell_lat=-16.7 AND cell_lon=-49.3 AND time BETWEEN '$FROM' AND '$TO'")"

echo "== ingest de novo (cache + upsert idempotente) =="
T0=$(date +%s); docker compose run --rm etl ingest --from "$FROM" --to "$TO" >/dev/null 2>&1; T1=$(date +%s)
echo "      segundo ingest: $((T1-T0)) s (sem requisição ao CDS)"
check "ainda 3 linhas" 3 "$(sql "SELECT count(*) FROM era5_daily_data WHERE cell_lat=-16.7 AND cell_lon=-49.3 AND time BETWEEN '$FROM' AND '$TO'")"

echo "== backfill --harvest =="
if [ "$RUN_BACKFILL" = 1 ]; then
  T0=$(date +%s)
  docker compose run --rm etl backfill --harvest "$H" 2>&1 | grep -v '^Container' | tail -3
  check "backfill terminou com código 0" 0 "${PIPESTATUS[0]}"
  echo "      tempo do backfill (emergência $FROM → hoje−6): $(( $(date +%s)-T0 )) s"
  check "run do backfill SUCCEEDED" SUCCEEDED "$(sql "SELECT status FROM era5_ingestion_runs WHERE command LIKE '%backfill%' ORDER BY started_at DESC LIMIT 1")"
else
  echo "SKIP  backfill completo (defina ERA5_E2E_BACKFILL=1; são $(( ( $(date +%s) - $(date -j -f %Y-%m-%d "$FROM" +%s 2>/dev/null || date -d "$FROM" +%s) ) / 2592000 + 1 )) meses de fila no CDS)"
  docker compose run --rm etl backfill --harvest 00000000-0000-4000-8000-000000000000 >/dev/null 2>&1
  check "backfill de safra inexistente registra run FAILED" FAILED "$(sql "SELECT status FROM era5_ingestion_runs WHERE command LIKE '%backfill%' ORDER BY started_at DESC LIMIT 1")"
fi

echo "== status =="
docker compose run --rm etl status --limit 3 2>&1 | grep -v '^Container'

echo "== leitura pelo Node → runDailyBalance =="
(cd backend && node -e '
require("ts-node").register({transpileOnly:true});
const {era5Repository}=require("./src/modules/msa/era5.repository");
const {runDailyBalance}=require("./src/modules/msa/engine");
const {referenceCultivar}=require("./src/modules/cultivars/reference-cultivars");
(async()=>{
  const series=await era5Repository.getDailySeriesForField(process.argv[1],process.argv[2],process.argv[3]);
  const cov=await era5Repository.getCoverage(process.argv[1],process.argv[2],process.argv[3]);
  const rows=runDailyBalance(series,referenceCultivar("SOJA"),{thetaFC:0.28,thetaWP:0.12},{altitude:741});
  console.log(JSON.stringify({days:series.length,coverage:cov,et0:rows.map(r=>+r.et0.toFixed(2))}));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});' "$F" "$FROM" "$TO") > "$S/node.txt" 2>&1
cat "$S/node.txt"
check "série de 3 dias lida e balanço executado" 3 "$(cat "$S/node.txt" | j days)"
check "cobertura completa" 0 "$(cat "$S/node.txt" | j coverage.missingDates.length)"

echo; echo "FALHAS: $FAILS"
