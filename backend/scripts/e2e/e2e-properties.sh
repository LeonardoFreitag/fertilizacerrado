#!/usr/bin/env bash
# Roteiro de ponta a ponta do módulo properties contra a stack do Compose.
# Pré-requisitos e uso: ver README.md neste diretório.
set -u
cd "$(dirname "$0")/../../.."          # raiz do repositório (onde está o .env)
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT  # arquivos temporários do curl
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
FAILS=0

sql() { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()   { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }

# call METHOD PATH TOKEN [JSON] -> STATUS, BODY, HEADERS
call() {
  local method=$1 path=$2 token=$3 data=${4:-}
  local args=(-s -X "$method" -D "$S/h.txt" -o "$S/b.txt" -w '%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  STATUS=$(curl "${args[@]}" "$API$path"); BODY=$(cat "$S/b.txt"); HEADERS=$(cat "$S/h.txt")
}
check()    { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:200}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:200}"; FAILS=$((FAILS+1)); fi; }
between()  { if node -e 'process.exit((+process.argv[1]>=+process.argv[2]&&+process.argv[1]<=+process.argv[3])?0:1)' "$2" "$3" "$4"; then echo "PASS  $1 ($2)"; else echo "FAIL  $1 ($2 fora de [$3,$4])"; FAILS=$((FAILS+1)); fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verify-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verify-email/||'; }

register_and_verify() { # NAME EMAIL ROLE CPF -> echoes user id
  call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"
  [ "$STATUS" = 201 ] || { echo "FAIL  cadastro de $2 → $STATUS $BODY"; FAILS=$((FAILS+1)); }
  local id; id=$(echo "$BODY" | j user.id)
  sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""
  echo "$id"
}
login() { call POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | j accessToken; }

sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM cultivars WHERE is_default = false" >/dev/null; sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null

echo "== Usuários =="
ANA_ID=$(register_and_verify  'Ana Agronoma'   ana@fc.local   AGRONOMO 529.982.247-25)
BIA_ID=$(register_and_verify  'Bia Agronoma'   bia@fc.local   AGRONOMO 123.456.789-09)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD"); ANA=$(login ana@fc.local 'MinhaS3nha!'); BIA=$(login bia@fc.local 'MinhaS3nha!'); PEDRO=$(login pedro@fc.local 'MinhaS3nha!')
check "admin do seed faz login" 1 "$( [ -n "$ADMIN" ] && echo 1 || echo 0 )"
check "access token do admin tem role ADMIN" ADMIN "$(node -e 'console.log(JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url")).role)' "$ADMIN")"
ADMIN_ID=$(sql "SELECT id FROM users WHERE role='ADMIN' LIMIT 1")

echo "== Propriedades: criação =="
call POST /properties "" '{"name":"X","state":"GO","city":"Y"}';                          check "sem token → 401" 401 "$STATUS"
call POST /properties "$PEDRO" '{"name":"Fazenda do Pedro","state":"GO","city":"Rio Verde"}'; check "produtor cria → 403" 403 "$STATUS"
call POST /properties "$ANA" '{"name":"Sítio da Ana","state":"GO","city":"Jataí"}';          check "agrônoma cria para si → 201" 201 "$STATUS"
P_ANA=$(echo "$BODY" | j id)
check "ownerId = agrônoma" "$ANA_ID" "$(echo "$BODY" | j ownerId)"; check "agronomistId nulo" null "$(echo "$BODY" | j agronomistId)"
contains "resposta traz owner resumido" "$BODY" '"owner":{"id"'; check "fieldsCount 0" 0 "$(echo "$BODY" | j fieldsCount)"
call POST /properties "$ANA" "{\"name\":\"Fazenda Boa Vista\",\"state\":\"GO\",\"city\":\"Rio Verde\",\"car\":\"GO-123\",\"ownerId\":\"$PEDRO_ID\"}"; check "agrônoma cria para o produtor → 201" 201 "$STATUS"
P_PEDRO=$(echo "$BODY" | j id)
check "ownerId = produtor" "$PEDRO_ID" "$(echo "$BODY" | j ownerId)"; check "agronomistId = agrônoma" "$ANA_ID" "$(echo "$BODY" | j agronomistId)"
call POST /properties "$ANA" "{\"name\":\"Sem acesso\",\"state\":\"GO\",\"city\":\"Mineiros\",\"ownerId\":\"$PEDRO_ID\",\"agronomistId\":\"$BIA_ID\"}"; check "agrônoma se exclui → 400" 400 "$STATUS"; contains "código AGRONOMIST_WITHOUT_ACCESS" "$BODY" AGRONOMIST_WITHOUT_ACCESS
call POST /properties "$ADMIN" '{"name":"Sem dono","state":"MT","city":"Sorriso"}';           check "admin sem ownerId → 400" 400 "$STATUS"
call POST /properties "$ADMIN" "{\"name\":\"Dono admin\",\"state\":\"MT\",\"city\":\"Sorriso\",\"ownerId\":\"$ADMIN_ID\"}"; check "ownerId admin → 400 INVALID_OWNER" 400 "$STATUS"; contains "código INVALID_OWNER" "$BODY" INVALID_OWNER
call POST /properties "$ADMIN" "{\"name\":\"Inexistente\",\"state\":\"MT\",\"city\":\"Sorriso\",\"ownerId\":\"00000000-0000-4000-8000-000000000000\"}"; check "ownerId inexistente → 400" 400 "$STATUS"
call POST /properties "$ADMIN" "{\"name\":\"Resp errado\",\"state\":\"MT\",\"city\":\"Sorriso\",\"ownerId\":\"$PEDRO_ID\",\"agronomistId\":\"$PEDRO_ID\"}"; check "agronomistId produtor → 400 INVALID_AGRONOMIST" 400 "$STATUS"; contains "código INVALID_AGRONOMIST" "$BODY" INVALID_AGRONOMIST
call POST /properties "$ANA" '{"name":"UF ruim","state":"XX","city":"X"}';                      check "UF inválida → 400" 400 "$STATUS"; contains "aponta state" "$BODY" '"state"'
call POST /properties "$ADMIN" "{\"name\":\"Fazenda da Bia\",\"state\":\"MT\",\"city\":\"Sorriso\",\"ownerId\":\"$BIA_ID\"}"; check "admin cria para a Bia → 201" 201 "$STATUS"
P_BIA=$(echo "$BODY" | j id)

echo "== Escopo =="
call GET /properties "$PEDRO";  check "produtor lista 1" 1 "$(echo "$BODY" | j length)"; check "é a sua" "$P_PEDRO" "$(echo "$BODY" | j 0.id)"
call GET /properties "$ANA";    check "agrônoma lista 2" 2 "$(echo "$BODY" | j length)"
call GET /properties "$BIA";    check "Bia lista 1" 1 "$(echo "$BODY" | j length)"
call GET /properties "$ADMIN";  check "admin lista 3" 3 "$(echo "$BODY" | j length)"
call GET "/properties/$P_ANA" "$PEDRO";  check "detalhe fora do escopo → 404" 404 "$STATUS"
call GET "/properties/$P_PEDRO" "$PEDRO"; check "detalhe no escopo → 200" 200 "$STATUS"; contains "traz agronomist" "$BODY" "\"agronomist\":{\"id\":\"$ANA_ID\""
call GET "/properties/$P_PEDRO" "$BIA";   check "Bia não vê a do Pedro → 404" 404 "$STATUS"
call GET /properties/nao-uuid "$ANA";     check "id malformado → 400" 400 "$STATUS"

echo "== PATCH / DELETE de propriedade =="
call PATCH "/properties/$P_PEDRO" "$ANA" '{"name":"Fazenda Boa Vista II"}'; check "agrônoma atualiza nome → 200" 200 "$STATUS"; check "nome novo" "Fazenda Boa Vista II" "$(echo "$BODY" | j name)"; check "car intacto" GO-123 "$(echo "$BODY" | j car)"
call PATCH "/properties/$P_PEDRO" "$ANA" "{\"agronomistId\":\"$BIA_ID\"}"; check "agrônoma troca responsável → 400 FORBIDDEN_FIELDS" 400 "$STATUS"; contains "código FORBIDDEN_FIELDS" "$BODY" FORBIDDEN_FIELDS
call PATCH "/properties/$P_ANA" "$BIA" '{"name":"Invasão"}';                 check "Bia atualiza fora do escopo → 404" 404 "$STATUS"
call PATCH "/properties/$P_PEDRO" "$PEDRO" '{"name":"Minha"}';               check "produtor atualiza → 403" 403 "$STATUS"
call PATCH "/properties/$P_PEDRO" "$ANA" '{}';                               check "corpo vazio → 400" 400 "$STATUS"
call PATCH "/properties/$P_PEDRO" "$ADMIN" "{\"agronomistId\":\"$BIA_ID\"}"; check "admin troca responsável → 200" 200 "$STATUS"; check "novo agronomistId" "$BIA_ID" "$(echo "$BODY" | j agronomistId)"
call GET "/properties/$P_PEDRO" "$ANA";   check "Ana perdeu acesso → 404" 404 "$STATUS"
call PATCH "/properties/$P_PEDRO" "$ADMIN" "{\"agronomistId\":\"$ANA_ID\"}"; check "admin devolve à Ana → 200" 200 "$STATUS"
call PATCH "/properties/$P_BIA" "$ADMIN" '{"agronomistId":null}';            check "admin anula responsável → 200" 200 "$STATUS"; check "agronomistId nulo" null "$(echo "$BODY" | j agronomistId)"
call DELETE "/properties/$P_BIA" "$BIA";   check "agrônoma exclui → 403" 403 "$STATUS"
call DELETE "/properties/$P_BIA" "$ADMIN"; check "admin exclui → 204" 204 "$STATUS"
check "linha permanece com deleted_at" t "$(sql "SELECT deleted_at IS NOT NULL FROM properties WHERE id='$P_BIA'")"
call GET "/properties/$P_BIA" "$ADMIN";    check "excluída → 404 (até para admin)" 404 "$STATUS"
call GET "/properties/$P_BIA/fields" "$BIA"; check "talhões da excluída → 404" 404 "$STATUS"
call DELETE "/properties/$P_BIA" "$ADMIN"; check "exclusão repetida → 404" 404 "$STATUS"
call GET /properties "$ADMIN";  check "admin lista 2 após exclusão" 2 "$(echo "$BODY" | j length)"

echo "== Talhões =="
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
BOWTIE='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.29,-16.69],[-49.29,-16.7],[-49.3,-16.69],[-49.3,-16.7]]]}'
F="/properties/$P_PEDRO/fields"
call POST "$F" "$PEDRO" "{\"name\":\"T1\",\"geometry\":$SQ}";          check "produtor cadastra talhão → 403" 403 "$STATUS"
call POST "/properties/$P_ANA/fields" "$BIA" "{\"name\":\"T1\",\"geometry\":$SQ}"; check "Bia em propriedade fora do escopo → 404" 404 "$STATUS"
call POST "$F" "$ANA" '{"name":"Sem geometria"}';                       check "sem geometry → 400" 400 "$STATUS"; contains "aponta geometry" "$BODY" '"geometry"'
call POST "$F" "$ANA" '{"name":"T","geometry":{"type":"MultiPolygon","coordinates":[]}}'; check "MultiPolygon → 400" 400 "$STATUS"
call POST "$F" "$ANA" '{"name":"T","geometry":{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.29,-16.7],[-49.29,-16.69],[-49.3,-16.69]]]}}'; check "anel aberto → 400" 400 "$STATUS"
call POST "$F" "$ANA" '{"name":"T","geometry":{"type":"Polygon","coordinates":[[[-49.3,95],[-49.29,95],[-49.29,94],[-49.3,95]]]}}'; check "lat 95 → 400" 400 "$STATUS"
call POST "$F" "$ANA" '{"name":"T","geometry":{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.29,-16.7],[-49.3,-16.7]]]}}'; check "3 posições → 400" 400 "$STATUS"
call POST "$F" "$ANA" "{\"name\":\"Laço\",\"geometry\":$BOWTIE}";      check "figura em 8 → 400 INVALID_GEOMETRY" 400 "$STATUS"; contains "código INVALID_GEOMETRY" "$BODY" INVALID_GEOMETRY; contains "razão do PostGIS" "$BODY" 'Self-intersection'
call POST "$F" "$ANA" "{\"name\":\"T\",\"geometry\":$SQ,\"areaHa\":0}";       check "areaHa 0 → 400" 400 "$STATUS"
call POST "$F" "$ANA" "{\"name\":\"T\",\"geometry\":$SQ,\"areaHa\":2000000}"; check "areaHa 2.000.000 → 400" 400 "$STATUS"

call POST "$F" "$ANA" "{\"name\":\"Talhão 1\",\"geometry\":$SQ,\"soilType\":\"LVdf\"}"; check "talhão válido → 201" 201 "$STATUS"
T1=$(echo "$BODY" | j id)
check "geometry igual à enviada" "$(echo "$SQ" | j coordinates)" "$(echo "$BODY" | j geometry.coordinates)"
check "centroid é Point" Point "$(echo "$BODY" | j centroid.type)"
between "área calculada (~1 km²)" "$(echo "$BODY" | j areaHa)" 99 101
check "era5Cell" '{"lat":-16.7,"lon":-49.3}' "$(echo "$BODY" | j era5Cell)"
check "soilType" LVdf "$(echo "$BODY" | j soilType)"
check "centróide dentro do polígono (ST_Within)" t "$(sql "SELECT ST_Within(centroid::geometry, geometry::geometry) FROM fields WHERE id='$T1'")"
check "era5_cells no banco" "-16.7|-49.3" "$(sql "SELECT cell_lat, cell_lon FROM era5_cells WHERE field_id='$T1'")"

call POST "$F" "$ANA" "{\"name\":\"Talhão 2\",\"geometry\":$SQ,\"areaHa\":85.5}"; check "área informada → 201" 201 "$STATUS"; check "areaHa 85.5" 85.5 "$(echo "$BODY" | j areaHa)"
T2=$(echo "$BODY" | j id)
ALT='{"type":"Polygon","coordinates":[[[-49.3,-16.7,800],[-49.2906,-16.7,800],[-49.2906,-16.691,801],[-49.3,-16.691,801],[-49.3,-16.7,800]]]}'
call POST "$F" "$ANA" "{\"name\":\"Com altitude\",\"geometry\":$ALT}"; check "altitude aceita → 201" 201 "$STATUS"; check "altitude descartada" "$(echo "$SQ" | j coordinates)" "$(echo "$BODY" | j geometry.coordinates)"
T3=$(echo "$BODY" | j id)
check "dois talhões na mesma célula (agrupamento)" "-16.7|-49.3|3" "$(sql "SELECT cell_lat, cell_lon, count(*) FROM era5_cells GROUP BY 1,2")"

call GET "$F" "$PEDRO";       check "produtor lista talhões → 200" 200 "$STATUS"; check "3 talhões" 3 "$(echo "$BODY" | j length)"; contains "lista traz era5Cell" "$BODY" '"era5Cell":{"lat":-16.7'
call GET "$F" "$BIA";         check "Bia lista fora do escopo → 404" 404 "$STATUS"
call GET "$F/$T1" "$PEDRO";   check "detalhe → 200" 200 "$STATUS"; check "detalhe tem notes null" null "$(echo "$BODY" | j notes)"
call GET "/properties/$P_ANA/fields/$T1" "$ANA"; check "talhão de outra propriedade → 404" 404 "$STATUS"
call GET "/properties/$P_PEDRO" "$ANA"; check "fieldsCount 3" 3 "$(echo "$BODY" | j fieldsCount)"

echo "== Altitude e solo do talhão =="
call POST "$F" "$ANA" "{\"name\":\"T-site\",\"geometry\":$SQ,\"altitudeM\":741,\"thetaFC\":0.30,\"thetaWP\":0.14}"; check "talhão com altitude e solo → 201" 201 "$STATUS"
TS=$(echo "$BODY" | j id); check "valores gravados" "741|0.3|0.14" "$(echo "$BODY" | j altitudeM)|$(echo "$BODY" | j thetaFC)|$(echo "$BODY" | j thetaWP)"
call POST "$F" "$ANA" "{\"name\":\"T-x\",\"geometry\":$SQ,\"thetaFC\":0.12,\"thetaWP\":0.28}"; check "teores invertidos → 400 em thetaFC" 400 "$STATUS"; contains "aponta thetaFC" "$BODY" '"thetaFC"'
call POST "$F" "$ANA" "{\"name\":\"T-x\",\"geometry\":$SQ,\"altitudeM\":6000}"; check "altitude 6000 → 400" 400 "$STATUS"
call PATCH "$F/$TS" "$ANA" '{"thetaWP":0.35}'; check "PATCH que inverte os teores → 400 em thetaWP" 400 "$STATUS"; contains "aponta thetaWP" "$BODY" '"thetaWP"'
check "talhão inalterado" "0.14" "$(sql "SELECT theta_wp FROM fields WHERE id='$TS'")"
call PATCH "$F/$TS" "$ANA" '{"altitudeM":null}'; check "limpar altitude → 200" 200 "$STATUS"; check "altitudeM nulo" null "$(echo "$BODY" | j altitudeM)"
call PATCH "$F/$TS" "$ANA" '{"thetaFC":0.35}'; check "subir thetaFC mantendo relação → 200" 200 "$STATUS"
call DELETE "$F/$TS" "$ANA"

echo "== PATCH de talhão =="
call GET "$F/$T1" "$ANA"; BEFORE=$BODY
call PATCH "$F/$T1" "$ANA" '{"name":"Talhão 1A","notes":"renomeado"}'; check "só nome → 200" 200 "$STATUS"
check "nome novo" "Talhão 1A" "$(echo "$BODY" | j name)"
check "geometry intacta" "$(echo "$BEFORE" | j geometry)" "$(echo "$BODY" | j geometry)"
check "centroid intacto" "$(echo "$BEFORE" | j centroid)" "$(echo "$BODY" | j centroid)"
check "areaHa intacta" "$(echo "$BEFORE" | j areaHa)" "$(echo "$BODY" | j areaHa)"
check "era5Cell intacta" "$(echo "$BEFORE" | j era5Cell)" "$(echo "$BODY" | j era5Cell)"
check "era5_cells.updated_at não mudou" 1 "$(sql "SELECT count(*) FROM era5_cells WHERE field_id='$T1' AND updated_at = created_at")"
# geometria com o dobro da área (lado em lon duplicado), em outra célula (+0.5°)
BIG='{"type":"Polygon","coordinates":[[[-48.8,-16.2],[-48.7812,-16.2],[-48.7812,-16.191],[-48.8,-16.191],[-48.8,-16.2]]]}'
call PATCH "$F/$T1" "$ANA" "{\"geometry\":$BIG}";  check "nova geometria sem área → 200" 200 "$STATUS"
between "área recalculada (~2 km²)" "$(echo "$BODY" | j areaHa)" 198 203
check "centroid moveu" 1 "$( [ "$(echo "$BEFORE" | j centroid)" != "$(echo "$BODY" | j centroid)" ] && echo 1 || echo 0)"
check "era5Cell refeita" '{"lat":-16.2,"lon":-48.8}' "$(echo "$BODY" | j era5Cell)"
check "uma única linha em era5_cells para o talhão" 1 "$(sql "SELECT count(*) FROM era5_cells WHERE field_id='$T1'")"
call PATCH "$F/$T2" "$ANA" "{\"geometry\":$BIG,\"areaHa\":150}"; check "nova geometria com área → 200" 200 "$STATUS"; check "areaHa informada" 150 "$(echo "$BODY" | j areaHa)"; check "centroid refletiu" "$(echo "$BODY" | j era5Cell)" '{"lat":-16.2,"lon":-48.8}'
call GET "$F/$T3" "$ANA"; BEFORE=$BODY
call PATCH "$F/$T3" "$ANA" "{\"geometry\":$BOWTIE}"; check "geometria inválida no PATCH → 400" 400 "$STATUS"
call GET "$F/$T3" "$ANA"; check "talhão inalterado após 400" "$BEFORE" "$BODY"
call PATCH "$F/$T3" "$PEDRO" '{"name":"X"}'; check "produtor atualiza talhão → 403" 403 "$STATUS"
call PATCH "$F/$T3" "$ANA" '{}'; check "corpo vazio → 400" 400 "$STATUS"
call PATCH "$F/$T3" "$ANA" '{"areaHa":50}'; check "só areaHa → 200" 200 "$STATUS"; check "areaHa 50" 50 "$(echo "$BODY" | j areaHa)"; check "geometry intacta" "$(echo "$BEFORE" | j geometry)" "$(echo "$BODY" | j geometry)"

echo "== DELETE de talhão =="
call DELETE "$F/$T3" "$PEDRO"; check "produtor exclui → 403" 403 "$STATUS"
call DELETE "$F/$T3" "$ANA";   check "agrônoma exclui → 204" 204 "$STATUS"
check "talhão removido" 0 "$(sql "SELECT count(*) FROM fields WHERE id='$T3'")"
check "era5_cells em cascata" 0 "$(sql "SELECT count(*) FROM era5_cells WHERE field_id='$T3'")"
call DELETE "$F/$T3" "$ANA";   check "inexistente → 404" 404 "$STATUS"
call DELETE "$F/$T1" "$ADMIN"; check "admin exclui → 204" 204 "$STATUS"

echo
echo "FALHAS: $FAILS"
