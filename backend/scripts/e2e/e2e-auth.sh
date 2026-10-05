#!/usr/bin/env bash
# Roteiro de ponta a ponta do módulo auth contra a stack do Compose.
# Pré-requisitos e uso: ver README.md neste diretório.
set -u
cd "$(dirname "$0")/../../.."          # raiz do repositório (onde está o .env)
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT  # arquivos temporários do curl
BASE=http://localhost:3000/api/v1/auth
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)
FAILS=0

sql()   { docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "$1"; }
rcli()  { docker compose exec -T redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" "$@"; }
flush() { rcli flushall >/dev/null; }

# call METHOD PATH [JSON] [curl args...] -> define STATUS, BODY, HEADERS
call() {
  local method=$1 path=$2 data=${3:-}; shift; shift; [ $# -gt 0 ] && shift
  local args=(-s -X "$method" -D "$S/h.txt" -o "$S/b.txt" -w '%{http_code}')
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  STATUS=$(curl "${args[@]}" "$@" "$BASE$path")
  BODY=$(cat "$S/b.txt"); HEADERS=$(cat "$S/h.txt")
}
check() { # NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado: $2, obtido: $3)  $BODY"; FAILS=$((FAILS+1)); fi
}
contains() { # NAME HAYSTACK NEEDLE
  if echo "$2" | grep -qi -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1 (não contém: $3)"; FAILS=$((FAILS+1)); fi
}
lacks() {
  if echo "$2" | grep -qi -- "$3"; then echo "FAIL  $1 (contém: $3)"; FAILS=$((FAILS+1)); else echo "PASS  $1"; fi
}
last_token() { docker compose logs --no-log-prefix api 2>/dev/null | grep -o "$1[A-Za-z0-9._-]*" | tail -1 | sed "s|$1||"; }
login() { call POST /login "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$S/jar.txt"; }

# Limpa os dados de teste preservando o administrador do seed.
sql "TRUNCATE properties CASCADE" >/dev/null 2>&1; sql "DELETE FROM cultivars WHERE is_default = false" >/dev/null; sql "DELETE FROM users WHERE role <> 'ADMIN'" >/dev/null; flush

echo "== Cadastro =="
REG='{"name":"Maria Silva","email":"Maria@Fazenda.com","password":"MinhaS3nha!","role":"AGRONOMO","cpf":"529.982.247-25","crea":"CREA-GO 12345"}'
call POST /register "$REG";                                              check "cadastro válido → 201" 201 "$STATUS"
sleep 0.3; VTOKEN=$(last_token 'verificar-email/')   # token recém-emitido para a Maria (lido do log da API)
contains "resposta traz dados públicos" "$BODY" '"role":"AGRONOMO"'
lacks "resposta sem campos sensíveis" "$BODY" 'passwordHash\|refreshToken\|resetToken\|accessToken'
call POST /register "${REG/Maria@Fazenda.com/MARIA@fazenda.COM}";        check "e-mail duplicado (outra capitalização) → 409" 409 "$STATUS"
call POST /register "${REG/Maria@Fazenda.com/outra@fazenda.com}";        check "CPF duplicado → 409" 409 "$STATUS"
contains "código do conflito de CPF" "$BODY" 'CPF_ALREADY_REGISTERED'
call POST /register "${REG/MinhaS3nha!/fraca}";                          check "senha fraca → 400" 400 "$STATUS"
contains "erro aponta o campo password" "$BODY" '"password"'
contains "código VALIDATION_ERROR" "$BODY" 'VALIDATION_ERROR'
call POST /register "${REG/AGRONOMO/ADMIN}";                             check "role ADMIN → 400" 400 "$STATUS"
call POST /register '{"name":"Sem Doc","email":"semdoc@x.com","password":"MinhaS3nha!","role":"PRODUTOR"}'
                                                                         check "sem documento → 400" 400 "$STATUS"
call POST /register '{"name":"PJ","email":"pj@x.com","password":"MinhaS3nha!","role":"PRODUTOR","personType":"PJ","cpf":"123.456.789-09"}'
                                                                         check "PJ sem CNPJ → 400" 400 "$STATUS"
contains "erro aponta o campo cnpj" "$BODY" '"cnpj"'
call POST /register '{"name":"X Y","email":"x@x.com","password":"MinhaS3nha!","role":"PRODUTOR","cpf":"529.982.247-26"}'
                                                                         check "CPF inválido → 400" 400 "$STATUS"
call POST /register '{"name":"X Y","email":"x@x.com","password":"MinhaS3nha!","role":"PRODUTOR","cnpj":"11.222.333/0001-82"}'
                                                                         check "CNPJ inválido → 400" 400 "$STATUS"
call POST /register '{"name":"Fazenda PJ","email":"pj@fazenda.com","password":"MinhaS3nha!","role":"PRODUTOR","personType":"PJ","cnpj":"12.abc.345/01de-35"}'
                                                                         check "PJ com CNPJ alfanumérico → 201" 201 "$STATUS"
call POST /register '{bad json';                                         check "JSON malformado → 400" 400 "$STATUS"
check "usuários criados" 2 "$(sql "SELECT count(*) FROM users WHERE role <> 'ADMIN'")"
check "CPF armazenado sem pontuação" 52998224725 "$(sql "SELECT cpf FROM users WHERE email='maria@fazenda.com'")"
check "CNPJ armazenado normalizado" 12ABC34501DE35 "$(sql "SELECT cnpj FROM users WHERE email='pj@fazenda.com'")"
check "hash bcrypt de custo 12" '$2b$12$' "$(sql "SELECT substr(password_hash,1,7) FROM users WHERE email='maria@fazenda.com'")"

echo "== Verificação de e-mail =="
login maria@fazenda.com 'MinhaS3nha!';                                   check "login antes de verificar → 403" 403 "$STATUS"
contains "código EMAIL_NOT_VERIFIED" "$BODY" 'EMAIL_NOT_VERIFIED'
lacks "sem cookie no 403" "$HEADERS" 'set-cookie'
call GET /verify-email/token-invalido;                                   check "token inválido → 400" 400 "$STATUS"
call GET "/verify-email/$VTOKEN";                                        check "token válido → 200" 200 "$STATUS"
check "email_verified no banco" t "$(sql "SELECT email_verified FROM users WHERE email='maria@fazenda.com'")"
VAT=$(sql "SELECT email_verified_at FROM users WHERE email='maria@fazenda.com'")
call GET "/verify-email/$VTOKEN";                                        check "link reaberto → 200" 200 "$STATUS"
check "email_verified_at inalterado" "$VAT" "$(sql "SELECT email_verified_at FROM users WHERE email='maria@fazenda.com'")"

echo "== Login =="
login maria@fazenda.com 'MinhaS3nha!';                                   check "login → 200" 200 "$STATUS"
ACCESS=$(echo "$BODY" | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
contains "corpo traz accessToken" "$BODY" '"accessToken"'
lacks "corpo sem refresh token" "$BODY" 'refreshToken'
COOKIE=$(echo "$HEADERS" | grep -i '^set-cookie')
contains "cookie HttpOnly" "$COOKIE" 'HttpOnly'
contains "cookie SameSite=Strict" "$COOKIE" 'SameSite=Strict'
contains "cookie Path=/api/v1/auth" "$COOKIE" 'Path=/api/v1/auth'
lacks "cookie sem Secure fora de produção" "$COOKIE" 'Secure'
RT=$(grep refreshToken "$S/jar.txt" | awk '{print $NF}')
check "banco guarda o SHA-256 do refresh token" "$(printf %s "$RT" | shasum -a 256 | cut -d' ' -f1)" "$(sql "SELECT refresh_token FROM users WHERE email='maria@fazenda.com'")"
node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));const h=JSON.parse(Buffer.from(process.argv[1].split(".")[0],"base64url"));console.log(h.alg,p.typ,p.role,p.exp-p.iat)' "$ACCESS" > "$S/claims.txt"
check "access token HS256, typ access, 15 min" "HS256 access AGRONOMO 900" "$(cat "$S/claims.txt")"
node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log(p.typ,p.exp-p.iat)' "$RT" > "$S/claims.txt"
check "refresh token de 7 dias" "refresh 604800" "$(cat "$S/claims.txt")"
call GET "/verify-email/$ACCESS";                                        check "access token como token de verificação → 400" 400 "$STATUS"
call POST /login '{"email":"maria@fazenda.com","password":"Errada1!"}';  check "senha incorreta → 401" 401 "$STATUS"; WRONG=$BODY
lacks "sem cookie no 401" "$HEADERS" 'set-cookie'
call POST /login '{"email":"ninguem@fazenda.com","password":"Errada1!"}'; check "e-mail inexistente → 401" 401 "$STATUS"
check "mesma mensagem nos dois 401" "$WRONG" "$BODY"
call POST /login '{"email":"x"}';                                        check "login com corpo inválido → 400" 400 "$STATUS"
flush

echo "== Refresh, reuso e logout =="
cp "$S/jar.txt" "$S/jar-old.txt"
call POST /refresh "" -b "$S/jar.txt" -c "$S/jar.txt";                   check "refresh → 200" 200 "$STATUS"
contains "refresh devolve accessToken" "$BODY" '"accessToken"'
RT2=$(grep refreshToken "$S/jar.txt" | awk '{print $NF}')
[ "$RT" != "$RT2" ] && echo "PASS  refresh token foi rotacionado" || { echo "FAIL  refresh token não rotacionou"; FAILS=$((FAILS+1)); }
check "banco guarda o hash do novo token" "$(printf %s "$RT2" | shasum -a 256 | cut -d' ' -f1)" "$(sql "SELECT refresh_token FROM users WHERE email='maria@fazenda.com'")"
call POST /refresh "" -b "$S/jar-old.txt";                               check "token antigo reusado → 401" 401 "$STATUS"
contains "401 limpa o cookie" "$HEADERS" 'refreshToken=;'
check "reuso apaga o hash no banco" "" "$(sql "SELECT coalesce(refresh_token,'') FROM users WHERE email='maria@fazenda.com'")"
call POST /refresh "" -b "$S/jar.txt";                                   check "token mais recente também revogado → 401" 401 "$STATUS"
call POST /refresh "";                                                   check "refresh sem cookie → 401" 401 "$STATUS"
call POST /refresh "" -H 'Cookie: refreshToken=abc.def.ghi';             check "refresh com token adulterado → 401" 401 "$STATUS"
call POST /refresh "" -H "Cookie: refreshToken=$ACCESS";                 check "access token como refresh → 401" 401 "$STATUS"

login maria@fazenda.com 'MinhaS3nha!'
# duas renovações simultâneas com o mesmo token: no máximo uma pode vencer
curl -s -o /dev/null -w '%{http_code}\n' -X POST -b "$S/jar.txt" "$BASE/refresh" > "$S/r1.txt" &
curl -s -o /dev/null -w '%{http_code}\n' -X POST -b "$S/jar.txt" "$BASE/refresh" > "$S/r2.txt" &
wait
check "renovações simultâneas: no máximo um 200" 1 "$( [ "$(cat "$S/r1.txt" "$S/r2.txt" | grep -c 200)" -le 1 ] && echo 1 || echo 0)"
echo "      (resultados: $(cat "$S/r1.txt") e $(cat "$S/r2.txt"))"

login maria@fazenda.com 'MinhaS3nha!'
call POST /logout "" -b "$S/jar.txt";                                    check "logout → 204" 204 "$STATUS"
contains "logout limpa o cookie" "$HEADERS" 'refreshToken=;'
check "logout apaga o hash no banco" "" "$(sql "SELECT coalesce(refresh_token,'') FROM users WHERE email='maria@fazenda.com'")"
call POST /refresh "" -b "$S/jar.txt";                                   check "refresh após logout → 401" 401 "$STATUS"
call POST /logout "";                                                    check "logout sem sessão → 204" 204 "$STATUS"

echo "== Recuperação de senha =="
login maria@fazenda.com 'MinhaS3nha!'; cp "$S/jar.txt" "$S/jar-prereset.txt"
call POST /forgot-password '{"email":"maria@fazenda.com"}';              check "forgot (conta existente) → 200" 200 "$STATUS"; FB=$BODY
TOKEN1=$(last_token 'redefinir-senha?token=')
call POST /forgot-password '{"email":"ninguem@fazenda.com"}';            check "forgot (conta inexistente) → 200" 200 "$STATUS"
check "mesma resposta nos dois casos" "$FB" "$BODY"
check "token de 32 bytes (64 hex)" 64 "${#TOKEN1}"
check "banco guarda o SHA-256 do token" "$(printf %s "$TOKEN1" | shasum -a 256 | cut -d' ' -f1)" "$(sql "SELECT reset_token FROM users WHERE email='maria@fazenda.com'")"
check "expiração em 1 hora" t "$(sql "SELECT reset_token_expires_at BETWEEN now() + interval '59 minutes' AND now() + interval '61 minutes' FROM users WHERE email='maria@fazenda.com'")"
call POST /forgot-password '{"email":"maria@fazenda.com"}'
TOKEN2=$(last_token 'redefinir-senha?token=')
call POST /reset-password "{\"token\":\"$TOKEN1\",\"password\":\"NovaS3nha!\"}"; check "token substituído por novo pedido → 400" 400 "$STATUS"
call POST /reset-password "{\"token\":\"$TOKEN2\",\"password\":\"fraca\"}";      check "nova senha fraca → 400" 400 "$STATUS"
call POST /reset-password "{\"token\":\"$TOKEN2\",\"password\":\"NovaS3nha!\"}"; check "reset válido (token continuou válido após senha fraca) → 200" 200 "$STATUS"
call POST /reset-password "{\"token\":\"$TOKEN2\",\"password\":\"Outra5enha!\"}"; check "token reutilizado → 400" 400 "$STATUS"
call POST /refresh "" -b "$S/jar-prereset.txt";                          check "sessão anterior encerrada pelo reset → 401" 401 "$STATUS"
login maria@fazenda.com 'MinhaS3nha!';                                   check "senha antiga → 401" 401 "$STATUS"
login maria@fazenda.com 'NovaS3nha!';                                    check "senha nova → 200" 200 "$STATUS"
call POST /forgot-password '{"email":"maria@fazenda.com"}'
TOKEN3=$(last_token 'redefinir-senha?token=')
sql "UPDATE users SET reset_token_expires_at = now() - interval '1 minute' WHERE email='maria@fazenda.com'" >/dev/null
call POST /reset-password "{\"token\":\"$TOKEN3\",\"password\":\"Expirada1!\"}"; check "token expirado → 400" 400 "$STATUS"
login maria@fazenda.com 'NovaS3nha!';                                    check "senha não mudou com token expirado" 200 "$STATUS"
# conta nunca verificada recuperada pelo reset
call POST /forgot-password '{"email":"pj@fazenda.com"}'
TOKEN4=$(last_token 'redefinir-senha?token=')
call POST /reset-password "{\"token\":\"$TOKEN4\",\"password\":\"NovaS3nha!\"}"; check "reset de conta não verificada → 200" 200 "$STATUS"
check "reset marca e-mail como verificado" "t|t" "$(sql "SELECT email_verified, email_verified_at IS NOT NULL FROM users WHERE email='pj@fazenda.com'")"
login pj@fazenda.com 'NovaS3nha!';                                       check "login da conta recuperada → 200" 200 "$STATUS"
flush

echo "== Limite de tentativas de login =="
for i in 1 2 3 4; do call POST /login '{"email":"maria@fazenda.com","password":"Errada1!"}'; done
check "4ª falha ainda é 401" 401 "$STATUS"
login maria@fazenda.com 'NovaS3nha!';                                    check "login correto com 4 falhas → 200" 200 "$STATUS"
call POST /login '{"email":"maria@fazenda.com","password":"Errada1!"}';  check "5ª falha → 401" 401 "$STATUS"
login maria@fazenda.com 'NovaS3nha!';                                    check "6ª tentativa, mesmo correta → 429" 429 "$STATUS"
contains "429 traz Retry-After" "$HEADERS" '^retry-after: [0-9]'
echo "      ($(echo "$HEADERS" | grep -i '^retry-after' | tr -d '\r'); TTL da chave: $(rcli ttl "$(rcli keys 'auth:login:fail:*' | head -1)")s)"
docker compose stop redis >/dev/null 2>&1
login maria@fazenda.com 'NovaS3nha!';                                    check "Redis parado: login → 200 (falha aberta)" 200 "$STATUS"
call POST /login '{"email":"maria@fazenda.com","password":"Errada1!"}';  check "Redis parado: senha errada → 401" 401 "$STATUS"
docker compose start redis >/dev/null 2>&1
for i in $(seq 1 20); do rcli ping 2>/dev/null | grep -q PONG && break; sleep 1; done
login maria@fazenda.com 'NovaS3nha!';                                    check "Redis de volta: bloqueio persiste → 429" 429 "$STATUS"
flush

echo "== CORS, helmet, erros =="
H=$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5173' http://localhost:3000/health)
contains "origem do frontend permitida" "$H" 'access-control-allow-origin: http://localhost:5173'
contains "credenciais permitidas" "$H" 'access-control-allow-credentials: true'
contains "X-Content-Type-Options nosniff" "$H" 'x-content-type-options: nosniff'
lacks "sem X-Powered-By" "$H" 'x-powered-by'
H=$(curl -s -D - -o /dev/null -H 'Origin: http://evil.example' http://localhost:3000/health)
lacks "outra origem não é ecoada" "$H" 'access-control-allow-origin: http://evil.example'
check "via Nginx: rota de auth responde" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://localhost/api/v1/auth/login)"
check "/health segue 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)"
check "404 em JSON com code" '"code":"NOT_FOUND"' "$(curl -s http://localhost:3000/nada | grep -o '"code":"NOT_FOUND"')"

echo
echo "FALHAS: $FAILS"
