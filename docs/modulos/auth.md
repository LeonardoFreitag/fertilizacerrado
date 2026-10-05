# Módulo de Autenticação (Auth)

## Responsabilidade

Gerencia o ciclo de vida de usuários, sessões e permissões da plataforma. É a base de segurança de todos os demais módulos.

---

## Roles

| Role | Descrição |
|---|---|
| `ADMIN` | Acesso total; gerencia usuários, planos e configurações da plataforma |
| `AGRONOMO` | Cria e acessa propriedades, talhões, safras, análises e recomendações dos seus clientes |
| `PRODUTOR` | Acesso somente-leitura às suas próprias propriedades, análises e recomendações |

---

## Modelo de Dados

### User

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | Chave primária |
| `email` | String | Único, obrigatório |
| `passwordHash` | String | bcrypt, fator 12 |
| `role` | Enum | ADMIN / AGRONOMO / PRODUTOR |
| `name` | String | Nome completo |
| `cpf` | String? | Pessoa física — validação de dígitos verificadores (algoritmo mod 11) |
| `cnpj` | String? | PJ — obrigatório quando `role = PRODUTOR` e pessoa jurídica; validação de dígitos verificadores |
| `crea` | String? | Registro profissional do agrônomo (campo opcional) |
| `phone` | String? | Telefone de contato |
| `emailVerified` | Boolean | Padrão `false`; confirmado via token no e-mail |
| `emailVerifiedAt` | DateTime? | Quando a verificação ocorreu |
| `resetToken` | String? | Token de recuperação de senha (hash SHA-256 armazenado) |
| `resetTokenExpiresAt` | DateTime? | Expiração de 1 hora |
| `refreshToken` | String? | Hash do último refresh token emitido (rotação a cada uso) |
| `createdAt` | DateTime | Auto |
| `updatedAt` | DateTime | Auto |

---

## Endpoints

### POST /api/v1/auth/register
Cria uma nova conta.

**Body:**
```json
{
  "name": "Maria Silva",
  "email": "maria@fazenda.com",
  "password": "MinhaS3nha!",
  "role": "AGRONOMO",
  "personType": "PF",
  "cpf": "123.456.789-09",
  "crea": "CREA-GO 12345"
}
```

**Regras:**
- `role` aceita apenas `AGRONOMO` ou `PRODUTOR`. O cadastro público rejeita `ADMIN` com 400 (`VALIDATION_ERROR`); contas de administrador não podem ser criadas por este endpoint
- `cpf` ou `cnpj` obrigatório (ao menos um)
- `personType` (`PF` | `PJ`) é opcional e **não é persistido** — serve apenas à validação:
  - `PJ`: `cnpj` obrigatório
  - `PF`: `cpf` obrigatório
  - omitido: vale apenas a regra de "ao menos um documento"
- CNPJ validado com o algoritmo oficial, incluindo o formato alfanumérico
- CPF validado com algoritmo mod 11
- E-mail único; dispara e-mail de verificação após cadastro
- `password`: mínimo 8 caracteres, 1 maiúscula, 1 número, 1 especial (validação Zod)

---

### POST /api/v1/auth/login
Autentica e retorna o access token. O refresh token **não** vem no corpo: é gravado apenas no cookie `refreshToken`.

**Retorna:**
```json
{
  "accessToken": "<JWT 15min>",
  "user": { "id": "...", "name": "...", "email": "...", "role": "AGRONOMO" }
}
```

**Cookie:** `refreshToken` (JWT, 7 dias) com `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` e `Secure` em produção.

**Regras:**
- Enquanto o e-mail não for verificado, o login responde 403 com o código `EMAIL_NOT_VERIFIED` e não emite tokens
- E-mail inexistente e senha incorreta respondem o mesmo 401 (`INVALID_CREDENTIALS`)

**Segurança:**
- Máximo 5 tentativas por IP em 15 min (rate limit Nginx + contador Redis)
- O refresh token é armazenado como hash SHA-256 no banco; o token bruto vai apenas no cookie HttpOnly

---

### POST /api/v1/auth/refresh
Renova o access token usando o refresh token.

- Rotação: emite novo refresh token e invalida o anterior (one-time-use)
- Se o token não bater com o hash armazenado → revoga toda a sessão (indício de replay attack)

---

### POST /api/v1/auth/logout
Invalida o refresh token no banco.

---

### POST /api/v1/auth/forgot-password
Dispara e-mail com link de recuperação.

- Token: 32 bytes `crypto.randomBytes`, armazenado como hash SHA-256
- Expira em 1 hora

---

### POST /api/v1/auth/reset-password
Redefine a senha usando o token de recuperação.

- Token de uso único; inválido ou expirado responde 400
- Encerra a sessão ativa (invalida o refresh token)
- Marca o e-mail como verificado: concluir o reset prova a posse da caixa de e-mail. É o caminho de recuperação para contas que perderam o e-mail de verificação, já que não há endpoint de reenvio

---

### GET /api/v1/auth/verify-email/:token
Confirma o e-mail do usuário. O link do e-mail aponta para a página do frontend `${FRONTEND_URL}/verificar-email/<token>`, que chama este endpoint e mostra o resultado (o link de recuperação de senha, análogo, vai para `${FRONTEND_URL}/redefinir-senha?token=<token>`).

---

### GET /api/v1/auth/me
Perfil do usuário autenticado (`id`, `name`, `email`, `role`); 401 sem access token válido. O frontend usa após o `refresh` para restaurar a sessão ao recarregar a página — o refresh devolve só o token e o JWT carrega apenas `sub` e `role`.

---

## Middleware de Autenticação

```typescript
// src/middleware/auth.middleware.ts
authenticate(req, res, next)  // valida JWT, injeta req.user
authorize(...roles)           // verifica role; 403 se não autorizado
```

**Uso em rotas:**
```typescript
router.get('/properties', authenticate, authorize('AGRONOMO', 'ADMIN'), propertiesController.list)
```

---

## Segurança Adicional

- `app.set('trust proxy', 1)` habilitado para `req.ip` correto atrás do Nginx
- Tokens JWT assinados com HS256; secret mínimo 32 chars validado via Zod no boot
- Senhas nunca retornadas em nenhum endpoint
- CPF/CNPJ armazenados sem pontuação; formatados apenas na saída

---

## Referências de Implementação

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/auth/auth.controller.ts` | Entrada HTTP, validação de DTO |
| `src/modules/auth/auth.service.ts` | Lógica de negócio, tokens |
| `src/modules/auth/auth.repository.ts` | Queries Prisma |
| `src/modules/auth/auth.routes.ts` | Definição de rotas e middlewares |
| `src/modules/auth/dtos/` | Schemas Zod para cada endpoint |
| `src/utils/cpf.util.ts` | Algoritmo de validação de CPF |
| `src/utils/cnpj.util.ts` | Algoritmo de validação de CNPJ |
| `src/middleware/auth.middleware.ts` | `authenticate` e `authorize` |
| `src/config/env.ts` | Validação das variáveis JWT_SECRET etc. |
