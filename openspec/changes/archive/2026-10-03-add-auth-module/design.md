## Context

A change `add-backend-base-structure` entregou Express 5, `env.ts` com Zod (já validando `JWT_*`, `SMTP_*`, `REDIS_URL`, `APP_URL`, `FRONTEND_URL`), um `PrismaClient` sem models, e o Nginx de produção com a zona `api_auth` (10 req/min) para `/api/v1/auth/`. O `app.ts` reserva o ponto de montagem dos routers entre `/health` e o fallback 404. Aquela change adiou explicitamente `helmet`, CORS e o framework de testes para este módulo.

A fonte de requisitos é `docs/modulos/auth.md`, complementada pelo pedido da feature. Onde os dois divergem ou são omissos, as decisões abaixo registram a escolha.

## Goals / Non-Goals

**Goals:**

- Os sete endpoints de `/api/v1/auth` funcionando de ponta a ponta contra Postgres e Redis reais.
- `authenticate` e `authorize` prontos para os módulos seguintes, sem consulta ao banco por requisição.
- Nenhum segredo recuperável no banco: senha em bcrypt, tokens de refresh e de reset apenas como hash.
- Validadores de CPF/CNPJ puros, testados e reutilizáveis.

**Non-Goals:**

- Gestão de usuários (listar, editar, desativar, trocar role) e criação de `ADMIN`.
- Reenvio de e-mail de verificação e troca de e-mail.
- Múltiplas sessões por usuário, listagem ou revogação seletiva de dispositivos.
- Envio de e-mail por fila (BullMQ), templates HTML elaborados.
- 2FA, login social, bloqueio de conta por usuário.

## Decisions

### 1. Camadas do módulo

`routes → controller → service → repository`, conforme `docs/modulos/auth.md`:

- **controller**: faz `schema.parse` do DTO, chama o service, grava/limpa o cookie e monta a resposta. Não contém regra de negócio.
- **service**: regras, hashing, emissão e verificação de tokens, envio de e-mail.
- **repository**: único ponto que usa o Prisma para `User`.
- **dtos/**: um schema Zod por endpoint, exportando também o tipo inferido.

O router é montado em `app.ts` como `/api/v1/auth`.

### 2. Model `User`

Campos conforme o pedido. Escolhas de mapeamento:

- `id` com `@default(uuid()) @db.Uuid`; tabela `users`, colunas em snake_case via `@map`.
- `role` como enum Prisma `Role { ADMIN AGRONOMO PRODUTOR }`.
- `email` único, armazenado em minúsculas e sem espaços nas pontas.
- `cpf` e `cnpj` únicos e anuláveis, armazenados sem pontuação (CNPJ em maiúsculas).
- `resetToken` com índice (a busca do reset é pelo hash).
- `phone` anulável, como em `docs/modulos/auth.md`.

Unicidade de CPF/CNPJ impede duas contas para o mesmo documento. Alternativa (permitir duplicatas) descartada: o documento é o identificador fiscal do cliente nos módulos seguintes.

### 3. Cadastro público não aceita `ADMIN`

O DTO de `register` aceita apenas `AGRONOMO` e `PRODUTOR`. Aceitar `ADMIN` num endpoint público seria escalada de privilégio trivial. A criação de administradores fica para o módulo de Usuários (ou seed), fora desta change.

### 4. Pessoa física × jurídica

O model não tem campo de tipo de pessoa. O DTO aceita `personType` opcional (`PF` | `PJ`), usado só na validação e não persistido:

- sempre: ao menos um entre `cpf` e `cnpj`;
- `personType = PJ`: `cnpj` obrigatório;
- `personType = PF`: `cpf` obrigatório;
- omitido: vale apenas a regra de "ao menos um" (compatível com o exemplo de body da documentação).

O tipo é derivável depois pela presença de `cnpj`. Alternativa: coluna `personType` no banco — descartada por não constar no model pedido.

### 5. Validação de CPF e CNPJ

`src/utils/cpf.util.ts` e `src/utils/cnpj.util.ts` exportam funções puras: `isValidCpf`/`isValidCnpj`, `normalizeCpf`/`normalizeCnpj` (remove pontuação) e `formatCpf`/`formatCnpj` (para saída).

- CPF: 11 dígitos, rejeita sequências de dígito repetido, dois dígitos verificadores por módulo 11.
- CNPJ: algoritmo oficial da Receita Federal na versão que cobre o **CNPJ alfanumérico** (em vigor desde julho de 2026): 12 posições alfanuméricas + 2 dígitos verificadores numéricos, com o valor de cada caractere igual ao código ASCII menos 48 e pesos 2–9 por módulo 11. Essa forma é retrocompatível com CNPJs puramente numéricos. Sequências de caractere repetido são rejeitadas.

Os DTOs usam essas funções via `refine` e normalizam com `transform`, de modo que o service só vê documentos já normalizados.

### 6. Senha

bcrypt nativo (`bcrypt`), fator 12. Política no DTO: 8 a 72 caracteres, ao menos 1 maiúscula, 1 número e 1 caractere especial. O teto de 72 existe porque o bcrypt ignora bytes além desse limite.

`bcrypt` nativo em vez de `bcryptjs`: é várias vezes mais rápido no fator 12 e o estágio builder do Dockerfile já tem a toolchain de native addons.

### 7. Access token

JWT HS256 assinado com `JWT_SECRET`, expiração `JWT_EXPIRES_IN` (15 min), claims `sub` (id do usuário), `role` e `typ: "access"`. Entregue no corpo da resposta e enviado pelo cliente em `Authorization: Bearer`.

A verificação fixa `algorithms: ['HS256']` e exige `typ = access`, para que tokens de outro propósito assinados com o mesmo segredo (ver Decisão 10) não sirvam como access token.

### 8. Refresh token: JWT em cookie, hash no banco, rotação

O refresh token é um JWT HS256 assinado com `JWT_REFRESH_SECRET`, expiração `JWT_REFRESH_EXPIRES_IN` (7 d), claims `sub`, `typ: "refresh"` e um `jti` aleatório. O banco guarda apenas `sha256(token)` em `User.refreshToken`.

Por que JWT e não um valor opaco, como sugere o exemplo da documentação: a regra "se o token não bater com o hash armazenado, revoga toda a sessão" exige identificar o usuário a partir de um token que **não** está no banco. Com um token assinado, o `sub` identifica o usuário mesmo quando o hash não confere; com um token opaco, um token reusado simplesmente não seria encontrado.

Fluxo do `refresh`:

1. Lê o cookie; ausente ou com assinatura/expiração inválida → 401 e limpa o cookie.
2. Calcula o hash e executa uma troca atômica: `updateMany` em `users` com `id = sub AND refresh_token = hashAntigo`, gravando o hash do novo token.
3. Uma linha afetada → emite novo access token e novo cookie.
4. Nenhuma linha afetada → reuso ou sessão já encerrada: grava `refresh_token = NULL` para o `sub` (revoga a sessão), limpa o cookie e responde 401.

A troca condicional em um único `UPDATE` evita que duas requisições simultâneas com o mesmo token obtenham ambas um token novo.

O token bruto nunca aparece no corpo de resposta — divergência deliberada do exemplo de `docs/modulos/auth.md`, que lista `refreshToken` no JSON, em favor da regra "token bruto apenas em cookie HttpOnly".

### 9. Cookie

Nome `refreshToken`; `HttpOnly`; `Secure` quando `NODE_ENV = production`; `SameSite=Strict`; `Path=/api/v1/auth`; `Max-Age` igual à validade do refresh token. O `Path` restrito faz o navegador enviar o cookie apenas às rotas de auth.

`SameSite=Strict` mais CORS restrito ao `FRONTEND_URL` é a defesa contra CSRF em `refresh` e `logout`, que são as únicas rotas autenticadas por cookie. Pressupõe frontend e API no mesmo site (mesmo domínio registrável), o que vale para `localhost` em desenvolvimento e para a topologia com Nginx em produção.

### 10. Verificação de e-mail sem coluna de token

O model não tem campo para token de verificação. O token é um JWT HS256 assinado com `JWT_SECRET`, claims `sub` e `typ: "verify-email"`, validade de 24 horas. O link do e-mail aponta para `${APP_URL}/api/v1/auth/verify-email/<token>`.

`verify-email` é idempotente: usuário já verificado responde 200 sem alterar `emailVerifiedAt`.

Alternativa: token aleatório com hash em coluna própria — descartada por exigir campos fora do model pedido.

### 11. Login exige e-mail verificado; reset de senha também verifica

Login de conta não verificada responde 403 com código `EMAIL_NOT_VERIFIED`, sem emitir tokens.

Como não há endpoint de reenvio, uma conta cujo e-mail de verificação se perdeu ficaria presa. A saída é o fluxo de recuperação: concluir `reset-password` prova a posse da caixa de e-mail, então ele também marca `emailVerified = true`. Assim o usuário preso usa "esqueci minha senha".

### 12. Respostas que não revelam existência de conta

- `login`: e-mail inexistente e senha errada devolvem o mesmo 401 genérico; quando o usuário não existe, executa-se um `bcrypt.compare` contra um hash fixo para igualar o tempo de resposta.
- `forgot-password`: sempre 200 com a mesma mensagem.
- `register` com e-mail, CPF ou CNPJ já cadastrado responde 409. Isso revela a existência da conta, mas é o comportamento pedido pela documentação ("e-mail único") e fica limitado pela zona `api_auth` do Nginx.

### 13. Limite de tentativas de login no Redis

`src/config/redis.ts` exporta um cliente `ioredis` único (conexão lazy). Chave `auth:login:fail:<ip>`:

- antes de validar credenciais: contador ≥ 5 → 429 com `Retry-After` igual ao TTL restante;
- a cada falha de credencial: `INCR`, com `EXPIRE` de 15 min quando o contador é criado (janela fixa a partir da primeira falha);
- login bem-sucedido não zera o contador — zerar permitiria a quem tem uma conta válida renovar o limite e seguir testando outras.

Só falhas de credencial contam; erros de validação e conta não verificada não contam. A lógica fica em `src/modules/auth/login-rate-limit.ts`; `INCR` e `EXPIRE ... NX` vão na mesma transação, para que a chave nunca fique sem TTL.

Se o Redis estiver indisponível, o limite **falha aberto**: o erro é logado e o login prossegue. A zona `api_auth` do Nginx continua valendo em produção. Falhar fechado derrubaria todo login por uma indisponibilidade do Redis.

O IP vem de `req.ip`, correto atrás do Nginx graças ao `trust proxy` já configurado.

### 14. Recuperação e redefinição de senha

- `forgot-password`: gera `crypto.randomBytes(32)` em hex, grava `sha256` em `resetToken` e `resetTokenExpiresAt = agora + 1h`, envia link `${FRONTEND_URL}/reset-password?token=<bruto>`. Um novo pedido substitui o token anterior.
- `reset-password`: busca por `sha256(token)` com expiração futura; inválido ou expirado → 400. Em sucesso, numa única atualização: novo `passwordHash`, `resetToken` e `resetTokenExpiresAt` nulos, `refreshToken` nulo (encerra a sessão ativa) e `emailVerified = true`.

### 15. E-mail

`src/utils/mailer.ts` com `nodemailer` e as variáveis `SMTP_*`. Quando `SMTP_HOST` não está definido (permitido fora de produção), usa o transporte JSON do nodemailer e escreve o e-mail no log — assim os links de verificação e de reset ficam acessíveis em desenvolvimento sem servidor SMTP.

O envio é aguardado dentro da requisição, mas uma falha de envio é logada e não altera a resposta: o cadastro continua 201 e o `forgot-password` continua 200. Alternativa (fila BullMQ com retry) fica para quando o BullMQ entrar no projeto.

### 16. `authenticate` e `authorize`

- `authenticate`: exige `Authorization: Bearer <token>`, verifica conforme a Decisão 7 e injeta `req.user = { id, role }`. Não consulta o banco. Falha → 401.
- `authorize(...roles)`: 403 se `req.user.role` não está na lista; 401 se usado sem `authenticate` antes.

`req.user` é tipado por augmentation de `Express.Request` em `src/types/express.d.ts`.

Consequência de não consultar o banco: mudança de role ou remoção do usuário só se reflete quando o access token expira (até 15 min).

### 17. Erros

`src/utils/app-error.ts` define `AppError(status, code, message)`. O error handler de `app.ts` passa a tratar:

- `AppError` → status e `{ error, code }`;
- `ZodError` → 400 com `{ error, code: "VALIDATION_ERROR", details }`, sendo `details` os erros por campo;
- violação de unicidade do Prisma (`P2002`) → 409 (cobre a corrida entre a checagem e o `INSERT` no cadastro);
- demais → 500 genérico, como hoje.

Como o Express 5 encaminha rejeições de handlers async ao error handler, os controllers não precisam de wrapper.

### 18. Middlewares globais em `app.ts`

Ordem: `trust proxy` → `helmet()` → `cors({ origin: env.FRONTEND_URL, credentials: true })` → `express.json()` → `cookieParser()` → `/health` → `/api/v1/auth` → 404 → error handler.

### 19. Graceful shutdown

Após `server.close`, o handler desconecta o Prisma e encerra o cliente Redis (`quit`) antes de `exit(0)`. O timeout de 10 s continua cobrindo o conjunto.

### 20. Migration e imagem

A migration é criada no host com `pnpm prisma migrate dev --name create_users` (o `prisma/` é somente leitura no container) e aplicada no container pelo `migrate deploy` do startup. Com o primeiro model, `--allow-no-models` sai do Dockerfile e do `package.json`.

### 21. Testes

Vitest 3 entra como devDependency com o script `test` (a versão 5 exige Node 22, e o projeto fixa Node 20). Cobertura automatizada desta change: validadores de CPF/CNPJ, DTO de cadastro e os middlewares `authenticate`/`authorize` (sem infraestrutura; o `vitest.config.ts` injeta variáveis fictícias para o `env.ts`). Os fluxos HTTP são verificados de ponta a ponta contra a stack do Compose, por roteiro manual com `curl`, como na change anterior. Testes de integração automatizados com banco ficam para uma change de infraestrutura de testes.

## Risks / Trade-offs

- **[Uma sessão por usuário]** → Com um único campo `refreshToken`, fazer login em um segundo dispositivo invalida o primeiro. É a consequência direta do model pedido; múltiplas sessões exigiriam uma tabela de sessões.
- **[Refresh simultâneo encerra a sessão]** → Duas abas renovando ao mesmo tempo com o mesmo cookie: a segunda é tratada como reuso e a sessão é revogada. Mitigação: o frontend deve serializar a renovação; comportamento documentado.
- **[Limite de login por IP atinge redes compartilhadas]** → Usuários atrás do mesmo NAT dividem o contador de 5 falhas. Aceito por ser a regra da documentação; a janela é de 15 min.
- **[Limite falha aberto sem Redis]** → Em desenvolvimento não há Nginx limitando. Aceito; o erro é logado.
- **[Cadastro revela e-mails existentes]** → 409 em `register`. Mitigado apenas pelo rate limit.
- **[Role defasado no access token]** → Até 15 min de atraso para refletir mudança de role ou remoção. Aceito em troca de não consultar o banco a cada requisição.
- **[Sem criação de ADMIN]** → Nenhum administrador pode existir até o módulo de Usuários ou um seed. Nenhuma rota desta change exige `ADMIN`.
- **[E-mail síncrono]** → Um SMTP lento atrasa `register` e `forgot-password`. Mitigação: timeouts curtos de conexão no transporte; fila fica para depois.
- **[Token de verificação não é de uso único]** → Sendo JWT sem estado, o link funciona por 24 h. O efeito é idempotente, então reuso não causa dano.

## Migration Plan

1. Instalar dependências e criar a migration `create_users` no host.
2. `docker compose up -d --build` reconstrói a imagem da API; o `migrate deploy` do startup aplica a migration.
3. Rollback: reverter o código e remover a tabela `users` (não há dados de produção).

## Open Questions

- **Criação do primeiro ADMIN**: seed por variáveis de ambiente ou endpoint do módulo de Usuários? A decidir na change de Usuários.
- **Destino do link de verificação**: hoje aponta para a API e responde JSON. Quando o frontend existir, pode passar a redirecionar para uma página de confirmação.
