# web-auth Specification

## Purpose
Sessão no navegador da aplicação web: access token só em memória, renovação pelo cookie HttpOnly com retentativa única e deduplicada, restauração ao carregar, telas de login, cadastro, verificação de e-mail, recuperação de senha e logout, e mapeamento dos erros da API em mensagens pt-BR.

## Requirements

### Requirement: Sessão só em memória
O frontend SHALL guardar o access token e o perfil do usuário apenas em memória (store do módulo de sessão). O token MUST NOT ser gravado em `localStorage`, `sessionStorage`, cookies legíveis por script ou URL. A renovação SHALL usar exclusivamente o cookie `HttpOnly` `refreshToken` emitido pela API, enviando `credentials: 'include'` apenas nas chamadas a `/auth/*`.

#### Scenario: Nada persistido
- **WHEN** o usuário faz login
- **THEN** `localStorage` e `sessionStorage` não contêm o token nem o perfil

#### Scenario: Cookie restrito às rotas de auth
- **WHEN** o cliente chama `GET /api/v1/properties`
- **THEN** a requisição leva `Authorization: Bearer <token>` e não é feita com `credentials: 'include'`

### Requirement: Restauração da sessão ao carregar
Ao iniciar, a aplicação SHALL tentar `POST /api/v1/auth/refresh` com o cookie e, em sucesso, `GET /api/v1/auth/me` para preencher o perfil, antes de decidir redirecionamentos. Falha no refresh MUST ser silenciosa (usuário permanece deslogado).

#### Scenario: Recarregar com cookie válido
- **WHEN** o usuário recarrega `/propriedades` com o cookie de refresh válido
- **THEN** a página carrega autenticada, com nome e role no cabeçalho, sem passar pelo login

#### Scenario: Recarregar sem cookie
- **WHEN** o usuário abre `/propriedades` sem cookie de refresh
- **THEN** é redirecionado para `/entrar?next=/propriedades` sem mensagem de erro

### Requirement: Renovação transparente com retentativa única
O cliente HTTP SHALL, ao receber 401 em uma rota que não seja `/auth/login`, `/auth/refresh` ou `/auth/logout`, executar um único `POST /auth/refresh`, compartilhado por todas as requisições concorrentes que falharem no mesmo intervalo, atualizar o token e repetir a requisição original uma vez. Se o refresh falhar ou a repetição voltar 401, o cliente MUST limpar a sessão, emitir o evento de sessão expirada e o roteador MUST redirecionar para `/entrar?next=<rota atual>`.

#### Scenario: Token expirado
- **WHEN** uma chamada a `/properties` recebe 401 e o refresh devolve 200
- **THEN** a chamada é repetida com o novo token e o resultado é entregue ao chamador sem erro visível

#### Scenario: Concorrência
- **WHEN** três chamadas recebem 401 quase ao mesmo tempo
- **THEN** apenas um `POST /auth/refresh` é feito e as três são repetidas com o novo token

#### Scenario: Refresh inválido
- **WHEN** o refresh responde 401 `INVALID_REFRESH_TOKEN`
- **THEN** a sessão é limpa e o usuário é levado a `/entrar?next=<rota atual>`

#### Scenario: Login com senha errada não dispara refresh
- **WHEN** `POST /auth/login` responde 401 `INVALID_CREDENTIALS`
- **THEN** nenhum refresh é tentado e o formulário mostra "E-mail ou senha inválidos"

### Requirement: Telas de autenticação
O frontend SHALL oferecer: **login** (`/entrar`, e-mail e senha, link para cadastro e para recuperação); **cadastro** (`/cadastro`: nome, e-mail, senha com indicador das regras, role AGRONOMO ou PRODUTOR, pessoa física ou jurídica com máscara e validação de CPF/CNPJ, CREA opcional, telefone opcional) que ao concluir leva a `/verifique-seu-email`; **verificação** (`/verificar-email/:token`, chama `GET /auth/verify-email/:token` e mostra sucesso com link para o login ou o erro); **esqueci a senha** (`/esqueci-senha`, sempre confirma o envio com a mesma mensagem); **redefinir senha** (`/redefinir-senha?token=`, nova senha e confirmação); **sair** (`POST /auth/logout`, limpa a sessão e volta a `/entrar`). Validações MUST replicar as regras da API antes do envio.

#### Scenario: Cadastro pessoa física
- **WHEN** o usuário escolhe PF e digita `52998224725`
- **THEN** o campo exibe `529.982.247-25`, passa na validação e é enviado como `cpf` sem máscara, com `personType: "PF"`

#### Scenario: CPF inválido
- **WHEN** o usuário digita `111.111.111-11`
- **THEN** o campo mostra "CPF inválido" e o formulário não é enviado

#### Scenario: Senha fraca
- **WHEN** a senha digitada é `abcdefgh`
- **THEN** o indicador aponta as regras não atendidas (maiúscula, número, caractere especial) e o envio é bloqueado

#### Scenario: Cadastro concluído
- **WHEN** `POST /auth/register` responde 201
- **THEN** o usuário é levado a `/verifique-seu-email` com a orientação de abrir o link recebido

#### Scenario: Link de verificação
- **WHEN** o usuário abre `/verificar-email/<token válido>`
- **THEN** a página mostra "E-mail verificado" e o botão "Ir para o login"; com token inválido mostra o erro devolvido pela API

#### Scenario: Redefinição
- **WHEN** o usuário abre `/redefinir-senha?token=<t>` e envia uma senha válida duas vezes igual
- **THEN** `POST /auth/reset-password` é chamado e, em 200, a página confirma e oferece o login

#### Scenario: Sair
- **WHEN** o usuário clica em Sair
- **THEN** `POST /auth/logout` é chamado, a sessão em memória é limpa e a aplicação vai para `/entrar`

### Requirement: Mensagens mapeadas dos erros da API
O frontend SHALL traduzir os códigos da API em mensagens pt-BR: `INVALID_CREDENTIALS` → "E-mail ou senha inválidos"; `EMAIL_NOT_VERIFIED` (403) → "Confirme seu e-mail antes de entrar" com o botão **Reenviar e-mail de verificação**, que chama `POST /auth/resend-verification` com o e-mail digitado e confirma o envio (429 com `Retry-After` mapeado); `USER_INACTIVE` (403) → "Sua conta está desativada. Fale com o administrador."; `TOO_MANY_LOGIN_ATTEMPTS` (429) → "Muitas tentativas. Tente novamente em N minutos" usando o header `Retry-After`; `LAST_ADMIN` → "Não é possível desativar o último administrador ativo"; `ALREADY_VERIFIED` → "Este e-mail já está verificado"; `EMAIL_ALREADY_REGISTERED`, `CPF_ALREADY_REGISTERED`, `CNPJ_ALREADY_REGISTERED` → erro no campo correspondente; `VALIDATION_ERROR` → erros por campo a partir de `details`; `INVALID_TOKEN` → "Link inválido ou expirado"; demais → "Não foi possível concluir. Tente novamente". Nenhuma mensagem MUST expor o JSON bruto.

#### Scenario: E-mail não verificado
- **WHEN** o login responde 403 `EMAIL_NOT_VERIFIED`
- **THEN** o formulário mostra "Confirme seu e-mail antes de entrar" e o botão de reenvio; clicar nele chama o endpoint e mostra "E-mail reenviado, verifique sua caixa de entrada"

#### Scenario: Conta desativada
- **WHEN** o login responde 403 `USER_INACTIVE`
- **THEN** o formulário mostra "Sua conta está desativada. Fale com o administrador." sem botão de reenvio

#### Scenario: Bloqueio por tentativas
- **WHEN** o login responde 429 com `Retry-After: 900`
- **THEN** a mensagem indica "15 minutos" e o botão fica desabilitado até o fim do intervalo

#### Scenario: Conflito de e-mail no cadastro
- **WHEN** o cadastro responde 409 `EMAIL_ALREADY_REGISTERED`
- **THEN** o erro aparece sob o campo e-mail
