#!/usr/bin/env bash
# Roteiro de ponta a ponta dos módulos cultivars e harvests contra a stack do Compose.
# Pré-requisitos e uso: ver README.md neste diretório (exige o seed executado:
# admin e cultivares de referência).
set -u
cd "$(dirname "$0")/../../.."          # raiz do repositório (onde está o .env)
S=$(mktemp -d); trap 'rm -rf "$S"; resume_workers' EXIT  # arquivos temporários do curl
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
FAILS=0
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)
# Workers parados durante o roteiro: a criação de safras enfileira backfill/processamento
# (ETL real no CDS, runs extras) que alterariam o estado verificado aqui.
purge_queues()   { for q in era5-ingest msa-process; do docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" EVAL "local n=0 for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) n=n+1 end return n" 0 "bull:$q:*" >/dev/null 2>&1; done; }
pause_workers()  { docker compose stop worker etl >/dev/null 2>&1; }
resume_workers() { purge_queues; docker compose start worker etl >/dev/null 2>&1; }

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
check()    { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:220}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:220}"; FAILS=$((FAILS+1)); fi; }
lacks()    { if echo "$2" | grep -q -- "$3"; then echo "FAIL  $1 (contém: $3)"; FAILS=$((FAILS+1)); else echo "PASS  $1"; fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }

register_and_verify() { # NAME EMAIL ROLE CPF -> echoes user id
  call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"
  [ "$STATUS" = 201 ] || { echo "FAIL  cadastro de $2 → $STATUS $BODY"; FAILS=$((FAILS+1)); }
  local id; id=$(echo "$BODY" | j user.id)
  sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""
  echo "$id"
}
login() { call POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | j accessToken; }
today()      { date -u +%F; }
tomorrow()   { date -u -v+1d +%F 2>/dev/null || date -u -d '+1 day' +%F; }

# Limpa os dados de teste preservando o admin do seed e as cultivares de referência.
pause_workers
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1
sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM cultivars WHERE is_default = false" >/dev/null
sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null

echo "== Usuários e propriedade =="
ANA_ID=$(register_and_verify  'Ana Agronoma'   ana@fc.local   AGRONOMO 529.982.247-25)
BIA_ID=$(register_and_verify  'Bia Agronoma'   bia@fc.local   AGRONOMO 123.456.789-09)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD"); ANA=$(login ana@fc.local 'MinhaS3nha!'); BIA=$(login bia@fc.local 'MinhaS3nha!'); PEDRO=$(login pedro@fc.local 'MinhaS3nha!')
check "admin do seed faz login" 1 "$( [ -n "$ADMIN" ] && echo 1 || echo 0 )"
call POST /properties "$ANA" "{\"name\":\"Fazenda Boa Vista\",\"state\":\"GO\",\"city\":\"Rio Verde\",\"ownerId\":\"$PEDRO_ID\"}"; P=$(echo "$BODY" | j id)
call POST /properties "$BIA" '{"name":"Sítio da Bia","state":"MT","city":"Sorriso"}'; P_BIA=$(echo "$BODY" | j id)
SQ='{"type":"Polygon","coordinates":[[[-49.3,-16.7],[-49.2906,-16.7],[-49.2906,-16.691],[-49.3,-16.691],[-49.3,-16.7]]]}'
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T1\",\"geometry\":$SQ}"; T1=$(echo "$BODY" | j id)
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T2\",\"geometry\":$SQ}"; T2=$(echo "$BODY" | j id)
call POST "/properties/$P_BIA/fields" "$BIA" "{\"name\":\"TB\",\"geometry\":$SQ}"; TB=$(echo "$BODY" | j id)
check "talhões criados" 3 "$(sql 'SELECT count(*) FROM fields')"

echo "== Cultivares: referência e visibilidade =="
check "duas cultivares de referência no banco" 2 "$(sql 'SELECT count(*) FROM cultivars WHERE is_default')"
SOJA_REF=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='SOJA'"); MILHO_REF=$(sql "SELECT id FROM cultivars WHERE is_default AND crop='MILHO'")
check "referência soja: valores do seed" "10|1200|120|450|900|0.2|1.15|0.5|0.5|0.3|0.95|0.2|0.8|1|0.4" "$(sql "SELECT t_base,gda_total,gda_f1_end,gda_f2_end,gda_f3_end,kc_ini,kc_mid,kc_end,depletion_fraction,zr_ini,zr_max,ky_f1,ky_f2,ky_f3,ky_f4 FROM cultivars WHERE id='$SOJA_REF'")"
check "referência milho: ky FAO-33" "0.4|0.4|1.5|0.5" "$(sql "SELECT ky_f1,ky_f2,ky_f3,ky_f4 FROM cultivars WHERE id='$MILHO_REF'")"
call GET /cultivars "";        check "sem token → 401" 401 "$STATUS"
call GET /cultivars "$PEDRO";  check "produtor lista → 200" 200 "$STATUS"; check "produtor vê as 2 de referência" 2 "$(echo "$BODY" | j length)"
call GET "/cultivars?crop=MILHO" "$PEDRO"; check "filtro por cultura" 1 "$(echo "$BODY" | j length)"; check "é milho" MILHO "$(echo "$BODY" | j 0.crop)"
call GET "/cultivars?crop=TRIGO" "$PEDRO"; check "cultura desconhecida → 400" 400 "$STATUS"
call GET "/cultivars/$SOJA_REF" "$PEDRO"; check "detalhe de referência → 200" 200 "$STATUS"; check "isDefault true" true "$(echo "$BODY" | j isDefault)"

echo "== Cultivares: cadastro =="
PARAMS='"tBase":10,"gdaTotal":1300,"gdaF1End":130,"gdaF2End":480,"gdaF3End":950,"kcIni":0.25,"kcMid":1.1,"kcEnd":0.5,"depletionFraction":0.5,"zrIni":0.3,"zrMax":0.9,"kyF1":0.2,"kyF2":0.8,"kyF3":1.0,"kyF4":0.4'
call POST /cultivars "$PEDRO" "{\"name\":\"Soja do Pedro\",\"crop\":\"SOJA\",$PARAMS}"; check "produtor cadastra → 403" 403 "$STATUS"
call POST /cultivars "$ANA" "{\"name\":\"Soja da Ana\",\"crop\":\"SOJA\",$PARAMS}";     check "agrônoma cadastra → 201" 201 "$STATUS"
C_ANA=$(echo "$BODY" | j id); check "isDefault false" false "$(echo "$BODY" | j isDefault)"; check "createdById = Ana" "$ANA_ID" "$(echo "$BODY" | j createdById)"
call POST /cultivars "$ANA" "{\"name\":\"Soja da Ana\",\"crop\":\"SOJA\",$PARAMS}";     check "mesmo nome, mesma criadora → 409" 409 "$STATUS"; contains "código CULTIVAR_NAME_IN_USE" "$BODY" CULTIVAR_NAME_IN_USE
call POST /cultivars "$BIA" "{\"name\":\"Soja da Ana\",\"crop\":\"SOJA\",$PARAMS}";     check "mesmo nome, outra criadora → 201" 201 "$STATUS"; C_BIA=$(echo "$BODY" | j id)
call POST /cultivars "$ANA" "{\"name\":\"Ref falsa\",\"crop\":\"SOJA\",$PARAMS,\"isDefault\":true}"; check "isDefault no corpo → 400" 400 "$STATUS"; contains "aponta isDefault" "$BODY" '"isDefault"'
call POST /cultivars "$ANA" "{\"name\":\"Incompleta\",\"crop\":\"SOJA\",${PARAMS/,\"kyF3\":1.0/}}"; check "parâmetro ausente → 400" 400 "$STATUS"; contains "aponta kyF3" "$BODY" '"kyF3"'
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"gdaF2End\":480/\"gdaF2End\":130}}"; check "gdaF2End ≤ gdaF1End → 400" 400 "$STATUS"; contains "aponta gdaF2End" "$BODY" '"gdaF2End"'
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"gdaF3End\":950/\"gdaF3End\":1300}}"; check "gdaF3End = gdaTotal → 400" 400 "$STATUS"; contains "aponta gdaF3End" "$BODY" '"gdaF3End"'
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"kcMid\":1.1/\"kcMid\":1.6}}"; check "kcMid 1.6 → 400" 400 "$STATUS"
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"depletionFraction\":0.5/\"depletionFraction\":1}}"; check "p = 1 → 400" 400 "$STATUS"; contains "aponta depletionFraction" "$BODY" '"depletionFraction"'
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"zrMax\":0.9/\"zrMax\":0.2}}"; check "zrIni > zrMax → 400 em zrMax" 400 "$STATUS"; contains "aponta zrMax" "$BODY" '"zrMax"'
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"zrMax\":0.9/\"zrMax\":3.5}}"; check "zrMax 3.5 → 400" 400 "$STATUS"
call POST /cultivars "$ANA" "{\"name\":\"X\",\"crop\":\"SOJA\",${PARAMS/\"kyF1\":0.2/\"kyF1\":-0.1}}"; check "ky negativo → 400" 400 "$STATUS"
call POST /cultivars "$ANA" "{\"name\":\"Ky limite\",\"crop\":\"MILHO\",${PARAMS/\"kyF3\":1.0/\"kyF3\":1.5}}"; check "ky 1.5 aceito → 201" 201 "$STATUS"; C_KY=$(echo "$BODY" | j id)

echo "== Cultivares: visibilidade das próprias =="
call GET /cultivars "$ANA";   check "Ana vê 2 ref + 2 suas" 4 "$(echo "$BODY" | j length)"; lacks "Ana não vê a da Bia" "$BODY" "\"id\":\"$C_BIA\""
call GET /cultivars "$BIA";   check "Bia vê 2 ref + 1 sua" 3 "$(echo "$BODY" | j length)"
call GET /cultivars "$ADMIN"; check "admin vê todas (5)" 5 "$(echo "$BODY" | j length)"
call GET "/cultivars/$C_BIA" "$ANA";   check "detalhe de cultivar alheia → 404" 404 "$STATUS"
call GET "/cultivars/$C_ANA" "$ADMIN"; check "admin detalha qualquer → 200" 200 "$STATUS"

echo "== Cultivares: edição e exclusão =="
call PATCH "/cultivars/$C_ANA" "$ANA" '{"kcMid":1.05}';          check "criadora edita → 200" 200 "$STATUS"; check "kcMid 1.05" 1.05 "$(echo "$BODY" | j kcMid)"
call PATCH "/cultivars/$C_ANA" "$ADMIN" '{"cycleDescription":"Editada pelo admin"}'; check "admin edita cultivar alheia → 200" 200 "$STATUS"
call PATCH "/cultivars/$C_ANA" "$BIA" '{"kcMid":1.0}';           check "outra agrônoma edita → 404" 404 "$STATUS"
call PATCH "/cultivars/$C_ANA" "$PEDRO" '{"kcMid":1.0}';         check "produtor edita → 403" 403 "$STATUS"
call PATCH "/cultivars/$C_ANA" "$ANA" '{}';                      check "corpo vazio → 400" 400 "$STATUS"
call PATCH "/cultivars/$C_ANA" "$ANA" '{"crop":"MILHO"}';        check "trocar crop → 400" 400 "$STATUS"
call PATCH "/cultivars/$C_ANA" "$ANA" '{"gdaF3End":400}';        check "PATCH que quebra relação → 400" 400 "$STATUS"; contains "aponta gdaF3End" "$BODY" '"gdaF3End"'
check "gdaF3End inalterado" 950 "$(sql "SELECT gda_f3_end FROM cultivars WHERE id='$C_ANA'")"
call PATCH "/cultivars/$SOJA_REF" "$ADMIN" '{"kcMid":1.0}';      check "admin edita referência → 403" 403 "$STATUS"; contains "código DEFAULT_CULTIVAR_READONLY" "$BODY" DEFAULT_CULTIVAR_READONLY
call DELETE "/cultivars/$SOJA_REF" "$ADMIN";                     check "admin exclui referência → 403" 403 "$STATUS"
call PATCH "/cultivars/$SOJA_REF" "$ANA" '{"name":"Soja minha"}'; check "agrônoma edita referência → 403" 403 "$STATUS"
call DELETE "/cultivars/$C_KY" "$PEDRO";                         check "produtor exclui → 403" 403 "$STATUS"
call DELETE "/cultivars/$C_KY" "$ANA";                           check "criadora exclui sem uso → 204" 204 "$STATUS"
check "cultivar removida" 0 "$(sql "SELECT count(*) FROM cultivars WHERE id='$C_KY'")"

echo "== Safras: criação =="
TODAY=$(today); TOMORROW=$(tomorrow)
H() { echo "{\"fieldId\":\"$1\",\"cultivarId\":\"$2\",\"emergenceDate\":\"$3\",\"season\":\"2025/26\"${4:+,$4}}"; }
call POST /harvests "" "$(H "$T1" "$SOJA_REF" 2025-11-10)";          check "sem token → 401" 401 "$STATUS"
call POST /harvests "$PEDRO" "$(H "$T1" "$SOJA_REF" 2025-11-10)";    check "produtor cria → 403" 403 "$STATUS"
call POST /harvests "$BIA" "$(H "$T1" "$SOJA_REF" 2025-11-10)";      check "talhão fora do escopo → 404" 404 "$STATUS"
call POST /harvests "$ANA" "$(H "$T1" "$C_BIA" 2025-11-10)";         check "cultivar alheia → 400 INVALID_CULTIVAR" 400 "$STATUS"; contains "código INVALID_CULTIVAR" "$BODY" INVALID_CULTIVAR
call POST /harvests "$ANA" "$(H "$T1" 00000000-0000-4000-8000-000000000000 2025-11-10)"; check "cultivar inexistente → 400" 400 "$STATUS"; contains "código INVALID_CULTIVAR" "$BODY" INVALID_CULTIVAR
call POST /harvests "$ANA" "$(H "$T1" "$SOJA_REF" "$TOMORROW")";     check "emergência amanhã → 400" 400 "$STATUS"; contains "código EMERGENCE_DATE_IN_FUTURE" "$BODY" EMERGENCE_DATE_IN_FUTURE
call POST /harvests "$ANA" "$(H "$T1" "$SOJA_REF" 2025-11-10T00:00:00Z)"; check "data com hora → 400" 400 "$STATUS"; contains "aponta emergenceDate" "$BODY" '"emergenceDate"'
call POST /harvests "$ANA" "{\"fieldId\":\"$T1\",\"cultivarId\":\"$SOJA_REF\",\"emergenceDate\":\"2025-11-10\",\"season\":\"2025/27\"}"; check "season 2025/27 → 400" 400 "$STATUS"; contains "aponta season" "$BODY" '"season"'
call POST /harvests "$ANA" "{\"fieldId\":\"$T1\",\"cultivarId\":\"$SOJA_REF\",\"emergenceDate\":\"2025-11-10\",\"season\":\"25/26\"}"; check "season 25/26 → 400" 400 "$STATUS"
call POST /harvests "$ANA" "$(H "$T1" "$SOJA_REF" 2025-11-10 '"notes":"Plantio direto"')"; check "safra válida → 201" 201 "$STATUS"
H1=$(echo "$BODY" | j id)
check "resposta da criação traz msaJobId" 1 "$( [ -n "$(echo "$BODY" | j msaJobId)" ] && echo 1 || echo 0 )"
check "status ACTIVE" ACTIVE "$(echo "$BODY" | j status)"; check "emergenceDate YYYY-MM-DD" 2025-11-10 "$(echo "$BODY" | j emergenceDate)"
check "field.propertyId" "$P" "$(echo "$BODY" | j field.propertyId)"; check "cultivar.crop" SOJA "$(echo "$BODY" | j cultivar.crop)"; check "notes" "Plantio direto" "$(echo "$BODY" | j notes)"
call POST /harvests "$ANA" "$(H "$T2" "$SOJA_REF" "$TODAY")";        check "emergência hoje → 201" 201 "$STATUS"; H2=$(echo "$BODY" | j id)
call POST /harvests "$ANA" "$(H "$T1" "$MILHO_REF" 2026-02-15)";     check "segunda ativa no T1 → 409" 409 "$STATUS"; contains "código FIELD_HAS_ACTIVE_HARVEST" "$BODY" FIELD_HAS_ACTIVE_HARVEST
call POST /harvests "$ADMIN" "$(H "$TB" "$C_BIA" 2025-10-20)";       check "admin cria com cultivar da Bia no talhão da Bia → 201" 201 "$STATUS"; HB=$(echo "$BODY" | j id)

echo "== Safras: criações simultâneas =="
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1   # recomeça só este bloco
for i in 1 2 3 4; do curl -s -o "$S/c$i.txt" -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ANA" -H 'Content-Type: application/json' -d "$(H "$T1" "$SOJA_REF" 2025-11-10)" "$API/harvests" > "$S/s$i.txt" & done; wait
check "4 criações simultâneas: exatamente um 201" 1 "$(cat "$S"/s?.txt | grep -c '^201$')"
check "demais são 409" 3 "$(cat "$S"/s?.txt | grep -c '^409$')"
check "uma única ACTIVE no T1" 1 "$(sql "SELECT count(*) FROM harvests WHERE field_id='$T1' AND status='ACTIVE'")"
# repõe o cenário anterior
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1
call POST /harvests "$ANA" "$(H "$T1" "$SOJA_REF" 2025-11-10 '"notes":"Plantio direto"')"; H1=$(echo "$BODY" | j id)
call POST /harvests "$ANA" "$(H "$T2" "$SOJA_REF" "$TODAY")"; H2=$(echo "$BODY" | j id)
call POST /harvests "$BIA" "$(H "$TB" "$C_BIA" 2025-10-20)"; HB=$(echo "$BODY" | j id)

echo "== Safras: consultas =="
call GET /harvests "$PEDRO";  check "produtor lista 2" 2 "$(echo "$BODY" | j length)"; lacks "não vê a da Bia" "$BODY" "\"id\":\"$HB\""
call GET /harvests "$ANA";    check "agrônoma lista 2" 2 "$(echo "$BODY" | j length)"
call GET /harvests "$BIA";    check "Bia lista 1" 1 "$(echo "$BODY" | j length)"
call GET /harvests "$ADMIN";  check "admin lista 3" 3 "$(echo "$BODY" | j length)"
check "ordem: emergência mais recente primeiro" "$TODAY" "$(echo "$BODY" | j 0.emergenceDate)"
call GET "/harvests?status=ACTIVE" "$ADMIN"; check "filtro status" 3 "$(echo "$BODY" | j length)"
call GET "/harvests?status=COMPLETED" "$ADMIN"; check "filtro status vazio" 0 "$(echo "$BODY" | j length)"
call GET "/harvests?fieldId=$T1" "$ANA";  check "filtro fieldId" 1 "$(echo "$BODY" | j length)"; check "é a H1" "$H1" "$(echo "$BODY" | j 0.id)"
call GET "/harvests?fieldId=$TB" "$ANA";  check "fieldId fora do escopo → 404" 404 "$STATUS"
call GET "/harvests?status=DONE" "$ANA";  check "status inválido → 400" 400 "$STATUS"
call GET "/harvests/$H1" "$PEDRO";        check "detalhe no escopo → 200" 200 "$STATUS"
call GET "/harvests/$HB" "$PEDRO";        check "detalhe fora do escopo → 404" 404 "$STATUS"
call GET "/harvests/$HB" "$ADMIN";        check "admin detalha qualquer → 200" 200 "$STATUS"
call GET "/harvests/nao-uuid" "$ANA";     check "id malformado → 400" 400 "$STATUS"
call GET "/properties/$P/fields/$T1/harvests" "$PEDRO"; check "rota aninhada → 200" 200 "$STATUS"; check "1 safra" 1 "$(echo "$BODY" | j length)"; check "é a H1" "$H1" "$(echo "$BODY" | j 0.id)"
call GET "/properties/$P/fields/$TB/harvests" "$ANA";   check "talhão de outra propriedade no path → 404" 404 "$STATUS"
call GET "/properties/$P_BIA/fields/$TB/harvests" "$ANA"; check "propriedade fora do escopo → 404" 404 "$STATUS"
call GET "/properties/$P/fields/$T1" "$ANA"; check "rota de talhão segue funcionando" 200 "$STATUS"

echo "== Safras: atualização =="
call PATCH "/harvests/$H1" "$PEDRO" '{"notes":"x"}';                 check "produtor atualiza → 403" 403 "$STATUS"
call PATCH "/harvests/$HB" "$ANA" '{"notes":"x"}';                   check "fora do escopo → 404" 404 "$STATUS"
call PATCH "/harvests/$H1" "$ANA" '{}';                              check "corpo vazio → 400" 400 "$STATUS"
call PATCH "/harvests/$H1" "$ANA" '{"emergenceDate":"2025-11-11"}';  check "emergenceDate imutável → 400" 400 "$STATUS"; contains "aponta emergenceDate" "$BODY" '"emergenceDate"'
call PATCH "/harvests/$H1" "$ANA" "{\"cultivarId\":\"$MILHO_REF\"}"; check "cultivarId imutável → 400" 400 "$STATUS"
call PATCH "/harvests/$H1" "$ANA" '{"notes":"Revisada","season":"2025/26"}'; check "notes e season → 200" 200 "$STATUS"; check "notes" Revisada "$(echo "$BODY" | j notes)"
call PATCH "/harvests/$H1" "$ANA" '{"status":"COMPLETED"}';          check "conclusão → 200" 200 "$STATUS"; check "COMPLETED" COMPLETED "$(echo "$BODY" | j status)"
call POST /harvests "$ANA" "$(H "$T1" "$MILHO_REF" 2026-02-15)";     check "nova safra após conclusão → 201" 201 "$STATUS"; H3=$(echo "$BODY" | j id)
call PATCH "/harvests/$H1" "$ANA" '{"status":"ACTIVE"}';             check "reativar H1 com H3 ativa → 409" 409 "$STATUS"; contains "código FIELD_HAS_ACTIVE_HARVEST" "$BODY" FIELD_HAS_ACTIVE_HARVEST
call PATCH "/harvests/$H3" "$ANA" '{"status":"CANCELLED"}';          check "cancelar H3 → 200" 200 "$STATUS"
call PATCH "/harvests/$H1" "$ANA" '{"status":"ACTIVE"}';             check "reativar H1 sem outra ativa → 200" 200 "$STATUS"; check "ACTIVE" ACTIVE "$(echo "$BODY" | j status)"
call PATCH "/harvests/$H1" "$ANA" '{"status":"ACTIVE"}';             check "mesmo status → 200 (no-op)" 200 "$STATUS"
call PATCH "/harvests/$H3" "$ADMIN" '{"status":"ACTIVE"}';           check "admin reativa H3 com H1 ativa → 409" 409 "$STATUS"
call GET "/harvests?fieldId=$T1&status=CANCELLED" "$ANA"; check "T1 tem 1 cancelada" 1 "$(echo "$BODY" | j length)"

echo "== Cultivar em uso =="
call PATCH "/cultivars/$C_BIA" "$BIA" '{"kcMid":1.0}';               check "parâmetro com safra ativa → 409" 409 "$STATUS"; contains "código CULTIVAR_IN_USE" "$BODY" CULTIVAR_IN_USE; contains "cita kcMid" "$BODY" kcMid
call PATCH "/cultivars/$C_BIA" "$BIA" '{"kcMid":1.1}';               check "mesmo valor atual → 409" 409 "$STATUS"
call PATCH "/cultivars/$C_BIA" "$BIA" '{"name":"Soja da Bia v1","kyF3":0.9}'; check "corpo misto → 409" 409 "$STATUS"; contains "cita kyF3" "$BODY" kyF3
check "nome não alterado no corpo misto" "Soja da Ana" "$(sql "SELECT name FROM cultivars WHERE id='$C_BIA'")"
call PATCH "/cultivars/$C_BIA" "$BIA" '{"name":"Soja da Bia","cycleDescription":"Precoce"}'; check "name e cycleDescription em uso → 200" 200 "$STATUS"; check "nome novo" "Soja da Bia" "$(echo "$BODY" | j name)"
call PATCH "/harvests/$HB" "$BIA" '{"status":"COMPLETED"}'
call PATCH "/cultivars/$C_BIA" "$BIA" '{"gdaTotal":1250}';          check "safra histórica também congela → 409" 409 "$STATUS"; contains "código CULTIVAR_IN_USE" "$BODY" CULTIVAR_IN_USE
call DELETE "/cultivars/$C_BIA" "$BIA";                              check "excluir em uso → 409" 409 "$STATUS"; contains "código CULTIVAR_IN_USE" "$BODY" CULTIVAR_IN_USE
call PATCH "/cultivars/$C_ANA" "$ANA" '{"kcMid":1.0}';               check "sem safras: parâmetro editável → 200" 200 "$STATUS"; check "kcMid 1.0" 1 "$(echo "$BODY" | j kcMid)"

echo "== Exclusão de talhão com safras =="
call DELETE "/properties/$P/fields/$T1" "$ANA";  check "talhão com safra ativa → 409" 409 "$STATUS"; contains "código FIELD_HAS_ACTIVE_HARVEST" "$BODY" FIELD_HAS_ACTIVE_HARVEST
call PATCH "/harvests/$H1" "$ANA" '{"status":"COMPLETED"}'
call DELETE "/properties/$P/fields/$T1" "$ANA";  check "talhão só com histórico → 409" 409 "$STATUS"; contains "código FIELD_HAS_HARVESTS" "$BODY" FIELD_HAS_HARVESTS
check "talhão permanece" 1 "$(sql "SELECT count(*) FROM fields WHERE id='$T1'")"
call POST "/properties/$P/fields" "$ANA" "{\"name\":\"T3\",\"geometry\":$SQ}"; T3=$(echo "$BODY" | j id)
call DELETE "/properties/$P/fields/$T3" "$ANA";  check "talhão sem safras → 204" 204 "$STATUS"
call DELETE "/properties/$P" "$ADMIN";           check "soft delete da propriedade com safras → 204" 204 "$STATUS"
call GET /harvests "$ADMIN";                     check "safras da propriedade excluída somem da listagem" 1 "$(echo "$BODY" | j length)"
call GET "/harvests/$H1" "$ADMIN";               check "detalhe de safra de propriedade excluída → 404" 404 "$STATUS"

echo
echo "FALHAS: $FAILS"
