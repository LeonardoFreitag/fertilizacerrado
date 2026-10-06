## MODIFIED Requirements

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
