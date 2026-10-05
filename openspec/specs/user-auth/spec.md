# user-auth Specification

## Purpose

Ciclo de vida de contas e sessões: cadastro, verificação de e-mail, login, renovação e encerramento de sessão, recuperação e redefinição de senha.

## Requirements

### Requirement: Cadastro de usuário
O sistema SHALL criar uma conta em `POST /api/v1/auth/register` a partir de `name`, `email`, `password`, `role` e, opcionalmente, `cpf`, `cnpj`, `crea`, `phone` e `personType`. O `role` MUST ser `AGRONOMO` ou `PRODUTOR`. A senha MUST ter de 8 a 72 caracteres, com ao menos uma letra maiúscula, um número e um caractere especial. O e-mail MUST ser único, comparado sem distinção de maiúsculas. Em sucesso o sistema SHALL responder 201 com os dados públicos do usuário, sem emitir tokens de sessão, e SHALL enviar um e-mail de verificação.

#### Scenario: Cadastro válido de agrônomo
- **WHEN** um cliente envia nome, e-mail inédito, senha válida, `role` `AGRONOMO` e um CPF válido
- **THEN** a resposta é 201 com `id`, `name`, `email` e `role`, o usuário é criado com `emailVerified` falso e um e-mail de verificação é enviado

#### Scenario: E-mail já cadastrado
- **WHEN** o e-mail informado já pertence a uma conta, ainda que com outra capitalização
- **THEN** a resposta é 409 e nenhuma conta é criada

#### Scenario: Senha fraca
- **WHEN** a senha não tem letra maiúscula, número ou caractere especial, ou tem menos de 8 caracteres
- **THEN** a resposta é 400 identificando o campo `password`

#### Scenario: Tentativa de cadastro como administrador
- **WHEN** o corpo informa `role` igual a `ADMIN`
- **THEN** a resposta é 400 e nenhuma conta é criada

#### Scenario: Falha no envio do e-mail
- **WHEN** o cadastro é válido mas o envio do e-mail de verificação falha
- **THEN** a resposta ainda é 201 e a conta permanece criada

### Requirement: Documento obrigatório no cadastro
O cadastro SHALL exigir ao menos um entre `cpf` e `cnpj`. Quando `personType` é `PJ`, `cnpj` MUST ser informado; quando é `PF`, `cpf` MUST ser informado. Todo documento informado MUST ter dígitos verificadores válidos e MUST ser único entre as contas. Os documentos SHALL ser armazenados sem pontuação.

#### Scenario: Nenhum documento informado
- **WHEN** o corpo não contém `cpf` nem `cnpj`
- **THEN** a resposta é 400

#### Scenario: Pessoa jurídica sem CNPJ
- **WHEN** `personType` é `PJ` e `cnpj` não é informado
- **THEN** a resposta é 400 identificando o campo `cnpj`

#### Scenario: CPF com dígito verificador inválido
- **WHEN** o `cpf` informado não passa na validação de dígitos verificadores
- **THEN** a resposta é 400 identificando o campo `cpf`

#### Scenario: CNPJ com dígito verificador inválido
- **WHEN** o `cnpj` informado não passa na validação de dígitos verificadores
- **THEN** a resposta é 400 identificando o campo `cnpj`

#### Scenario: Documento com pontuação
- **WHEN** o cadastro informa `cpf` como `123.456.789-09`
- **THEN** o valor armazenado é `12345678909`

#### Scenario: Documento já cadastrado
- **WHEN** o CPF ou CNPJ informado já pertence a outra conta
- **THEN** a resposta é 409 e nenhuma conta é criada

### Requirement: Verificação de e-mail
O sistema SHALL confirmar o e-mail em `GET /api/v1/auth/verify-email/:token`. O token MUST ser assinado pelo servidor, específico para verificação de e-mail e válido por 24 horas. Em sucesso o sistema SHALL marcar `emailVerified` como verdadeiro e registrar `emailVerifiedAt`. O link enviado por e-mail MUST apontar para a página do frontend `${FRONTEND_URL}/verificar-email/<token>`, que chama o endpoint.

#### Scenario: Token válido
- **WHEN** o usuário acessa o link com um token válido
- **THEN** a resposta é 200, `emailVerified` passa a verdadeiro e `emailVerifiedAt` é preenchido

#### Scenario: Token inválido ou expirado
- **WHEN** o token está adulterado, expirado ou não é um token de verificação
- **THEN** a resposta é 400 e nenhum usuário é alterado

#### Scenario: E-mail já verificado
- **WHEN** o link é acessado novamente após a verificação
- **THEN** a resposta é 200 e `emailVerifiedAt` não é alterado

#### Scenario: Access token usado como token de verificação
- **WHEN** um access token válido é enviado no lugar do token de verificação
- **THEN** a resposta é 400

#### Scenario: Link do e-mail
- **WHEN** o e-mail de verificação é gerado com `FRONTEND_URL=http://localhost`
- **THEN** o link é `http://localhost/verificar-email/<token>`

### Requirement: Login
O sistema SHALL autenticar em `POST /api/v1/auth/login` com `email` e `password`. Em sucesso SHALL responder 200 com `accessToken` e os dados `id`, `name`, `email` e `role` do usuário, e SHALL gravar o refresh token em um cookie `HttpOnly`. O access token MUST ser um JWT HS256 com validade de 15 minutos. O refresh token MUST ter validade de 7 dias e MUST NOT aparecer no corpo da resposta. Contas com e-mail não verificado MUST NOT receber tokens.

#### Scenario: Credenciais corretas
- **WHEN** um usuário verificado envia e-mail e senha corretos
- **THEN** a resposta é 200 com `accessToken` e `user`, e contém `Set-Cookie` do refresh token com `HttpOnly`, `SameSite=Strict` e `Path=/api/v1/auth`

#### Scenario: Refresh token fora do corpo
- **WHEN** o login é bem-sucedido
- **THEN** o corpo JSON da resposta não contém o refresh token

#### Scenario: Senha incorreta
- **WHEN** a senha não confere
- **THEN** a resposta é 401 com mensagem genérica e nenhum cookie é gravado

#### Scenario: E-mail inexistente
- **WHEN** o e-mail não pertence a nenhuma conta
- **THEN** a resposta é 401 com a mesma mensagem do caso de senha incorreta

#### Scenario: E-mail não verificado
- **WHEN** as credenciais estão corretas mas `emailVerified` é falso
- **THEN** a resposta é 403 com o código `EMAIL_NOT_VERIFIED` e nenhum token é emitido

#### Scenario: Cookie seguro em produção
- **WHEN** o login ocorre com `NODE_ENV` igual a `production`
- **THEN** o cookie do refresh token tem o atributo `Secure`

### Requirement: Limite de tentativas de login
O sistema SHALL limitar a 5 as tentativas de login com credenciais incorretas por IP em uma janela de 15 minutos, usando um contador no Redis. Atingido o limite, o sistema SHALL responder 429 com o header `Retry-After` sem verificar credenciais. Se o Redis estiver indisponível, o login MUST continuar funcionando.

#### Scenario: Sexta tentativa bloqueada
- **WHEN** um IP falha 5 logins e tenta novamente dentro de 15 minutos
- **THEN** a resposta é 429 com `Retry-After`, mesmo que as credenciais desta tentativa estejam corretas

#### Scenario: Janela expirada
- **WHEN** passam 15 minutos desde a primeira falha
- **THEN** o IP volta a poder tentar o login

#### Scenario: Login bem-sucedido não zera o contador
- **WHEN** um IP com 4 falhas faz um login correto e depois falha mais uma vez
- **THEN** a tentativa seguinte é bloqueada com 429

#### Scenario: Redis fora do ar
- **WHEN** o Redis está indisponível e um usuário envia credenciais corretas
- **THEN** o login responde 200

### Requirement: Renovação de sessão com rotação
O sistema SHALL renovar a sessão em `POST /api/v1/auth/refresh` usando o refresh token do cookie. A cada uso o sistema SHALL emitir um novo access token e um novo refresh token e SHALL invalidar o anterior. Um refresh token com assinatura válida que não corresponde ao hash armazenado MUST revogar a sessão do usuário.

#### Scenario: Renovação válida
- **WHEN** o cookie contém o refresh token vigente
- **THEN** a resposta é 200 com novo `accessToken` e um novo cookie de refresh token, e o hash armazenado passa a ser o do novo token

#### Scenario: Token anterior não funciona mais
- **WHEN** um refresh token já usado em uma renovação é enviado novamente
- **THEN** a resposta é 401

#### Scenario: Reuso revoga a sessão
- **WHEN** um refresh token já usado é enviado novamente
- **THEN** o hash armazenado do usuário é apagado e o refresh token mais recente também deixa de funcionar

#### Scenario: Cookie ausente
- **WHEN** a requisição não traz o cookie de refresh token
- **THEN** a resposta é 401

#### Scenario: Token expirado ou adulterado
- **WHEN** o refresh token tem assinatura inválida ou está expirado
- **THEN** a resposta é 401 e o cookie é removido

#### Scenario: Renovações simultâneas
- **WHEN** duas requisições usam o mesmo refresh token ao mesmo tempo
- **THEN** no máximo uma recebe novos tokens

### Requirement: Logout
O sistema SHALL encerrar a sessão em `POST /api/v1/auth/logout`, apagando o hash do refresh token no banco e removendo o cookie. A operação MUST ser idempotente.

#### Scenario: Logout com sessão ativa
- **WHEN** o cookie contém o refresh token vigente
- **THEN** a resposta é 204, o hash armazenado é apagado e o cookie é removido

#### Scenario: Refresh após logout
- **WHEN** o refresh token usado antes do logout é enviado a `/refresh`
- **THEN** a resposta é 401

#### Scenario: Logout sem sessão
- **WHEN** a requisição não traz cookie ou traz um token inválido
- **THEN** a resposta é 204

### Requirement: Solicitação de recuperação de senha
O sistema SHALL aceitar `POST /api/v1/auth/forgot-password` com `email` e SHALL responder 200 com a mesma mensagem exista ou não a conta. Quando a conta existe, o sistema SHALL gerar um token de 32 bytes aleatórios criptograficamente seguros, armazenar apenas seu hash SHA-256 com expiração de 1 hora e enviar o token bruto por e-mail em um link para `${FRONTEND_URL}/redefinir-senha?token=<token>`.

#### Scenario: Conta existente
- **WHEN** o e-mail pertence a uma conta
- **THEN** a resposta é 200, `resetToken` guarda o hash SHA-256 do token, `resetTokenExpiresAt` fica 1 hora à frente e um e-mail com o link `${FRONTEND_URL}/redefinir-senha?token=<token>` é enviado

#### Scenario: Conta inexistente
- **WHEN** o e-mail não pertence a nenhuma conta
- **THEN** a resposta é 200 com a mesma mensagem e nenhum e-mail é enviado

#### Scenario: Novo pedido substitui o anterior
- **WHEN** um segundo pedido é feito antes de o primeiro token ser usado
- **THEN** apenas o token mais recente é aceito na redefinição

### Requirement: Redefinição de senha
O sistema SHALL redefinir a senha em `POST /api/v1/auth/reset-password` com `token` e `password`. O token MUST corresponder a um hash armazenado e não expirado e MUST ser de uso único. A nova senha MUST obedecer à mesma política do cadastro. Em sucesso o sistema SHALL encerrar a sessão ativa do usuário e marcar o e-mail como verificado.

#### Scenario: Redefinição válida
- **WHEN** o token é válido e a nova senha atende à política
- **THEN** a resposta é 200, o login com a nova senha funciona e o login com a senha antiga falha

#### Scenario: Token de uso único
- **WHEN** um token já utilizado é enviado novamente
- **THEN** a resposta é 400

#### Scenario: Token expirado
- **WHEN** o token é usado mais de 1 hora após a emissão
- **THEN** a resposta é 400 e a senha não é alterada

#### Scenario: Sessão encerrada
- **WHEN** a senha é redefinida enquanto existe um refresh token vigente
- **THEN** esse refresh token deixa de funcionar

#### Scenario: Conta não verificada recuperada pelo reset
- **WHEN** um usuário com `emailVerified` falso conclui a redefinição de senha
- **THEN** `emailVerified` passa a verdadeiro e o login é permitido

#### Scenario: Nova senha fraca
- **WHEN** a nova senha não atende à política
- **THEN** a resposta é 400 e o token continua válido

### Requirement: Proteção de credenciais
O sistema SHALL armazenar a senha apenas como hash bcrypt de fator 12 e os tokens de refresh e de recuperação apenas como hash SHA-256. Nenhum endpoint MUST retornar `passwordHash`, `resetToken` ou `refreshToken`.

#### Scenario: Senha no banco
- **WHEN** um usuário é cadastrado
- **THEN** `passwordHash` é um hash bcrypt com custo 12 e a senha em texto puro não é armazenada

#### Scenario: Token de refresh no banco
- **WHEN** um login é realizado
- **THEN** o campo `refreshToken` contém o SHA-256 do token do cookie e não o token em si

#### Scenario: Respostas sem campos sensíveis
- **WHEN** qualquer endpoint de auth devolve dados do usuário
- **THEN** a resposta não contém `passwordHash`, `resetToken` nem `refreshToken`

### Requirement: Seed do administrador
O sistema SHALL fornecer um seed em `prisma/seed.ts`, registrado em `package.json` como `prisma.seed` e executado por `pnpm prisma db seed`, que cria ou atualiza um usuário `ADMIN` a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD`. O seed MUST ser idempotente por e-mail (`upsert`), MUST gravar a senha como bcrypt de fator 12, MUST marcar o e-mail como verificado e MUST validar `ADMIN_PASSWORD` com a mesma política de senha do cadastro. Sem as duas variáveis definidas, o seed MUST encerrar com código 0 sem alterar o banco.

#### Scenario: Primeira execução
- **WHEN** `ADMIN_EMAIL` e `ADMIN_PASSWORD` estão definidas e não existe usuário com esse e-mail
- **THEN** o seed cria um usuário com `role` `ADMIN`, `emailVerified` verdadeiro, `emailVerifiedAt` preenchido e `passwordHash` bcrypt de custo 12, e encerra com código 0

#### Scenario: Execução repetida
- **WHEN** o seed é executado novamente com as mesmas variáveis
- **THEN** continua existindo um único usuário com esse e-mail e o seed encerra com código 0

#### Scenario: Rotação da senha
- **WHEN** `ADMIN_PASSWORD` é alterada e o seed é executado novamente
- **THEN** o login do administrador funciona com a nova senha e falha com a anterior

#### Scenario: Login do administrador
- **WHEN** o administrador criado pelo seed envia e-mail e senha em `POST /api/v1/auth/login`
- **THEN** a resposta é 200 e o access token carrega `role` `ADMIN`

#### Scenario: Variáveis ausentes
- **WHEN** `ADMIN_EMAIL` ou `ADMIN_PASSWORD` não está definida
- **THEN** o seed informa que não há administrador a criar e encerra com código 0 sem alterar o banco

#### Scenario: Senha fraca
- **WHEN** `ADMIN_PASSWORD` não atende à política de senha do cadastro
- **THEN** o seed encerra com código 1 identificando o problema e não altera o banco

#### Scenario: E-mail já usado por outro role
- **WHEN** existe um usuário com `ADMIN_EMAIL` e `role` diferente de `ADMIN`
- **THEN** o seed atualiza esse usuário para `ADMIN`, verificado, com a senha informada

### Requirement: Perfil do usuário autenticado
O sistema SHALL responder `GET /api/v1/auth/me`, autenticado por access token, com `id`, `name`, `email` e `role` do usuário. Sem token válido a resposta MUST ser 401.

#### Scenario: Token válido
- **WHEN** um usuário autenticado chama `GET /auth/me`
- **THEN** recebe 200 com `id`, `name`, `email` e `role`, sem `passwordHash` nem tokens

#### Scenario: Sem token
- **WHEN** `GET /auth/me` é chamado sem `Authorization`
- **THEN** a resposta é 401
