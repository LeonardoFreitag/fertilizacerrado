#!/usr/bin/env bash
# Roteiro de ponta a ponta do módulo de Usuários: listagem paginada, leitura/edição por
# role, desativação/reativação (login 403, refresh 401), LAST_ADMIN, reenvio de
# verificação (admin e público com limite), troca de senha. Pré-requisitos: README.md.
set -u
cd "$(dirname "$0")/../../.."
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT
API=http://localhost:3000/api/v1
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-); ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)
FAILS=0

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
j()     { node -e 'let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{o={}};const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)' "$1"; }
call()  { local m=$1 p=$2 t=$3 d=${4:-}; local a=(-s -X "$m" -o "$S/b.txt" -D "$S/h.txt" -w '%{http_code}'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d"); STATUS=$(curl "${a[@]}" "$API$p"); BODY=$(cat "$S/b.txt"); HEADERS=$(cat "$S/h.txt"); }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  ${BODY:0:200}"; FAILS=$((FAILS+1)); fi; }
contains() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)  ${2:0:200}"; FAILS=$((FAILS+1)); fi; }
last_verify_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o 'verificar-email/[A-Za-z0-9._-]*' | tail -1 | sed 's|verificar-email/||'; }
register_and_verify() { call POST /auth/register "" "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"MinhaS3nha!\",\"role\":\"$3\",\"cpf\":\"$4\"}"; local id; id=$(echo "$BODY" | j user.id); sleep 0.3; call GET "/auth/verify-email/$(last_verify_token)" ""; echo "$id"; }
login_full() { curl -s -c "$S/cookies_$3.txt" -o "$S/b.txt" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$API/auth/login" > "$S/s.txt"; STATUS=$(cat "$S/s.txt"); BODY=$(cat "$S/b.txt"); }
refresh_with() { STATUS=$(curl -s -b "$S/cookies_$1.txt" -o "$S/b.txt" -w '%{http_code}' -X POST "$API/auth/refresh"); BODY=$(cat "$S/b.txt"); }

echo "== Preparação =="
docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern 'auth:resend-verify:*' 2>/dev/null | xargs -r -I{} docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" del {} >/dev/null 2>&1
sql "TRUNCATE harvests CASCADE" >/dev/null 2>&1; sql "TRUNCATE properties CASCADE" >/dev/null 2>&1
sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null; sql "DELETE FROM users WHERE email = 'admin2@fc.local'" >/dev/null
call POST /auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"; ADMIN=$(echo "$BODY" | j accessToken); ADMIN_ID=$(echo "$BODY" | j user.id)
ANA_ID=$(register_and_verify 'Ana Agronoma' ana@fc.local AGRONOMO 529.982.247-25)
PEDRO_ID=$(register_and_verify 'Pedro Produtor' pedro@fc.local PRODUTOR 000.000.001-91)
call POST /auth/register "" '{"name":"Bia Nao Verificada","email":"bia@fc.local","password":"MinhaS3nha!","role":"AGRONOMO","cnpj":"11.222.333/0001-81"}'; BIA_ID=$(echo "$BODY" | j user.id)
login_full ana@fc.local 'MinhaS3nha!' ana; ANA=$(echo "$BODY" | j accessToken)
login_full pedro@fc.local 'MinhaS3nha!' pedro; PEDRO=$(echo "$BODY" | j accessToken)

echo "== Listagem paginada e escopo =="
call GET "/users?pageSize=2&page=1" "$ADMIN"; check "admin lista paginada → 200" 200 "$STATUS"
check "items/page/pageSize/total" "2|1|2|4" "$(echo "$BODY" | j items.length)|$(echo "$BODY" | j page)|$(echo "$BODY" | j pageSize)|$(echo "$BODY" | j total)"
contains "campos administrativos (active, document)" "$BODY" '"active":'
call GET "/users?pageSize=2&page=2" "$ADMIN"; check "página 2 com 2 itens" 2 "$(echo "$BODY" | j items.length)"
call GET "/users?active=false" "$ADMIN"; check "filtro inativos vazio" 0 "$(echo "$BODY" | j total)"
call GET "/users?pageSize=51" "$ADMIN"; check "pageSize 51 → 400" 400 "$STATUS"
call GET "/users?q=ped" "$ANA"; check "agrônoma busca produtor" "Pedro Produtor" "$(echo "$BODY" | j items.0.name)"
check "agrônoma não vê campos administrativos" "" "$(echo "$BODY" | j items.0.active)"
call GET "/users?q=pe" "$ANA"; check "termo curto → 400" 400 "$STATUS"
call GET "/users?q=abc" "$PEDRO"; check "produtor → 403" 403 "$STATUS"

echo "== Leitura e edição =="
call GET "/users/$ANA_ID" "$ANA"; check "próprio perfil → 200" 200 "$STATUS"; check "documento mascarado" "***.982.247-**" "$(echo "$BODY" | j document)"
call GET "/users/$PEDRO_ID" "$ANA"; check "outro usuário → 404" 404 "$STATUS"
call GET "/users/$PEDRO_ID" "$ADMIN"; check "admin lê qualquer um → 200" 200 "$STATUS"
call PATCH "/users/$ANA_ID" "$ANA" '{"name":"Ana Silva","phone":"62981234567","crea":"GO-1234"}'; check "autoedição → 200" 200 "$STATUS"; check "nome alterado" "Ana Silva" "$(echo "$BODY" | j name)"
call PATCH "/users/$ANA_ID" "$ANA" '{"role":"ADMIN"}'; check "autoedição de role → 403 FORBIDDEN_FIELDS" 403 "$STATUS"; contains "código" "$BODY" FORBIDDEN_FIELDS
call PATCH "/users/$ANA_ID" "$PEDRO" '{"name":"Xavier"}'; check "editar outro → 404" 404 "$STATUS"
call PATCH "/users/$PEDRO_ID" "$ADMIN" '{"role":"AGRONOMO"}'; check "admin troca role → 200" 200 "$STATUS"; check "role AGRONOMO" AGRONOMO "$(echo "$BODY" | j role)"
call PATCH "/users/$PEDRO_ID" "$ADMIN" '{"role":"PRODUTOR"}' >/dev/null
call PATCH "/users/$PEDRO_ID" "$ADMIN" '{}'; check "corpo vazio → 400" 400 "$STATUS"

echo "== Último administrador =="
call POST "/users/$ADMIN_ID/deactivate" "$ADMIN"; check "admin desativa a si mesmo → 409 LAST_ADMIN" 409 "$STATUS"; contains "código" "$BODY" LAST_ADMIN
call PATCH "/users/$ADMIN_ID" "$ADMIN" '{"role":"AGRONOMO"}'; check "rebaixar a si mesmo → 409" 409 "$STATUS"
call PATCH "/users/$ANA_ID" "$ADMIN" '{"role":"ADMIN"}'; check "promove Ana a ADMIN → 200" 200 "$STATUS"
login_full ana@fc.local 'MinhaS3nha!' ana2; ANA_ADMIN=$(echo "$BODY" | j accessToken)
call POST "/users/$ADMIN_ID/deactivate" "$ANA_ADMIN"; check "com 2 admins, desativar o outro → 200" 200 "$STATUS"; check "admin original inativo" false "$(echo "$BODY" | j active)"
call POST "/users/$ANA_ID/deactivate" "$ANA_ADMIN"; check "agora Ana é a última: desativar a si → 409" 409 "$STATUS"
call POST "/users/$ADMIN_ID/reactivate" "$ANA_ADMIN"; check "reativa o admin original → 200" 200 "$STATUS"
call POST /auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"; check "admin original volta a logar" 200 "$STATUS"; ADMIN=$(echo "$BODY" | j accessToken)
call PATCH "/users/$ANA_ID" "$ADMIN" '{"role":"AGRONOMO"}'; check "Ana volta a AGRONOMO" 200 "$STATUS"

echo "== Desativação de agrônomo: login 403, refresh 401, dados preservados =="
call POST /properties "$ANA" "{\"name\":\"Fazenda Ana\",\"state\":\"GO\",\"city\":\"Goiânia\",\"ownerId\":\"$PEDRO_ID\"}"; P=$(echo "$BODY" | j id)
call POST "/users/$ANA_ID/deactivate" "$PEDRO"; check "produtor não desativa → 403" 403 "$STATUS"
call POST "/users/$ANA_ID/deactivate" "$ADMIN"; check "admin desativa Ana → 200" 200 "$STATUS"
refresh_with ana; check "refresh de Ana → 401" 401 "$STATUS"
login_full ana@fc.local 'MinhaS3nha!' ana3; check "login de Ana → 403 USER_INACTIVE" 403 "$STATUS"; contains "código" "$BODY" USER_INACTIVE
call GET /auth/me "$ANA"; check "/me com token ainda válido → 401" 401 "$STATUS"
call GET "/properties/$P" "$ADMIN"; check "propriedade mantém a agrônoma como referência" "$ANA_ID" "$(echo "$BODY" | j agronomist.id)"
call GET "/users?q=ana" "$ADMIN"; check "listagem mostra inativa" false "$(echo "$BODY" | j items.0.active)"
call GET "/users?active=false" "$ADMIN"; check "filtro inativos → 1" 1 "$(echo "$BODY" | j total)"
call POST "/users/$ANA_ID/reactivate" "$ADMIN"; check "reativa → 200" 200 "$STATUS"
login_full ana@fc.local 'MinhaS3nha!' ana4; check "login de Ana volta → 200" 200 "$STATUS"; ANA=$(echo "$BODY" | j accessToken)

echo "== Reenvio de verificação =="
call POST "/users/$ANA_ID/resend-verification" "$ADMIN"; check "admin reenvia para verificado → 409 ALREADY_VERIFIED" 409 "$STATUS"
call POST "/users/$BIA_ID/resend-verification" "$ADMIN"; check "admin reenvia para Bia → 204" 204 "$STATUS"
T1=$(last_verify_token); sleep 1.1   # JWT com iat em segundos: garante token diferente
call POST /auth/resend-verification "" '{"email":"bia@fc.local"}'; check "público → 200" 200 "$STATUS"; sleep 0.3
check "novo token no log" 1 "$( [ "$(last_verify_token)" != "$T1" ] && echo 1 || echo 0 )"
call POST /auth/resend-verification "" '{"email":"ninguem@fc.local"}'; check "e-mail inexistente → 200 (mesma mensagem)" 200 "$STATUS"
call POST /auth/resend-verification "" '{"email":"bia@fc.local"}' >/dev/null; call POST /auth/resend-verification "" '{"email":"bia@fc.local"}' >/dev/null
call POST /auth/resend-verification "" '{"email":"bia@fc.local"}'; check "4º pedido na hora → 429" 429 "$STATUS"; contains "Retry-After" "$HEADERS" 'Retry-After'
call GET "/auth/verify-email/$(last_verify_token)" ""; check "token reenviado verifica Bia" 200 "$STATUS"

echo "== Troca de senha =="
call PATCH /users/me/password "$ANA" '{"currentPassword":"errada","newPassword":"OutraS3nha!"}'; check "senha atual errada → 401" 401 "$STATUS"
call PATCH /users/me/password "$ANA" '{"currentPassword":"MinhaS3nha!","newPassword":"fraca"}'; check "nova fraca → 400" 400 "$STATUS"
call PATCH /users/me/password "$ANA" '{"currentPassword":"MinhaS3nha!","newPassword":"OutraS3nha!"}'; check "troca → 204" 204 "$STATUS"
refresh_with ana4; check "refresh anterior revogado → 401" 401 "$STATUS"
login_full ana@fc.local 'OutraS3nha!' ana5; check "login com a nova senha → 200" 200 "$STATUS"
login_full ana@fc.local 'MinhaS3nha!' ana6; check "senha antiga → 401" 401 "$STATUS"

echo; echo "FALHAS: $FAILS"
