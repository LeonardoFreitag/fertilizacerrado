## MODIFIED Requirements

### Requirement: Graceful shutdown
O servidor em `src/server.ts` SHALL capturar `SIGTERM` e `SIGINT`, parar de aceitar novas conexões, aguardar as requisições em andamento, desconectar o cliente do banco de dados, encerrar a conexão com o Redis e então encerrar com código 0. Se o encerramento não concluir em 10 segundos, o processo MUST encerrar com código 1.

#### Scenario: SIGTERM sem requisições em andamento
- **WHEN** o processo recebe `SIGTERM`
- **THEN** o servidor HTTP é fechado, o banco é desconectado, a conexão com o Redis é encerrada e o processo encerra com código 0

#### Scenario: SIGINT durante o desenvolvimento
- **WHEN** o processo recebe `SIGINT`
- **THEN** o comportamento é idêntico ao de `SIGTERM`

#### Scenario: Requisição em andamento
- **WHEN** o processo recebe `SIGTERM` enquanto uma requisição está sendo processada
- **THEN** a requisição é concluída antes de o processo encerrar

#### Scenario: Encerramento travado
- **WHEN** o fechamento não conclui em 10 segundos após o sinal
- **THEN** o processo encerra com código 1

#### Scenario: Sinal repetido
- **WHEN** um segundo sinal chega durante o encerramento
- **THEN** a rotina de encerramento não é executada novamente

#### Scenario: Redis nunca conectado
- **WHEN** o processo recebe `SIGTERM` sem que nenhuma operação no Redis tenha ocorrido
- **THEN** o processo encerra com código 0

## ADDED Requirements

### Requirement: CORS e headers de segurança da aplicação
A aplicação SHALL enviar headers de segurança HTTP em todas as respostas e SHALL permitir requisições cross-origin com credenciais apenas da origem configurada em `FRONTEND_URL`.

#### Scenario: Origem do frontend
- **WHEN** uma requisição chega com `Origin` igual a `FRONTEND_URL`
- **THEN** a resposta contém `Access-Control-Allow-Origin` com essa origem e `Access-Control-Allow-Credentials: true`

#### Scenario: Outra origem
- **WHEN** uma requisição chega com `Origin` diferente de `FRONTEND_URL`
- **THEN** a resposta não contém `Access-Control-Allow-Origin` para essa origem

#### Scenario: Headers de segurança
- **WHEN** um cliente recebe qualquer resposta da aplicação
- **THEN** a resposta contém `X-Content-Type-Options: nosniff` e não contém `X-Powered-By`

### Requirement: Respostas de erro padronizadas
A aplicação SHALL responder erros em JSON com os campos `error` e `code`. Falhas de validação de entrada MUST responder 400 com `code` igual a `VALIDATION_ERROR` e um campo `details` com as mensagens por campo. Erros não previstos MUST responder 500 sem expor detalhes internos.

#### Scenario: Corpo inválido
- **WHEN** um endpoint recebe um corpo que não passa no schema Zod
- **THEN** a resposta é 400 com `code` `VALIDATION_ERROR` e `details` identificando os campos inválidos

#### Scenario: Erro de negócio
- **WHEN** um handler lança um erro de aplicação com status e código
- **THEN** a resposta usa esse status e contém `error` e `code`

#### Scenario: Erro inesperado
- **WHEN** um handler lança uma exceção não prevista
- **THEN** a resposta é 500 com mensagem genérica, sem stack trace
