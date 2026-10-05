# document-validation Specification

## Purpose

Validação, normalização e formatação de CPF e CNPJ.

## Requirements

### Requirement: Validação de CPF
`src/utils/cpf.util.ts` SHALL expor uma função pura que valida um CPF pelos dois dígitos verificadores calculados por módulo 11. A função MUST aceitar a entrada com ou sem pontuação e MUST rejeitar valores que não tenham 11 dígitos e sequências de um mesmo dígito repetido.

#### Scenario: CPF válido com pontuação
- **WHEN** a entrada é `529.982.247-25`
- **THEN** o resultado é válido

#### Scenario: CPF válido sem pontuação
- **WHEN** a entrada é `52998224725`
- **THEN** o resultado é válido

#### Scenario: Dígito verificador incorreto
- **WHEN** a entrada é `529.982.247-26`
- **THEN** o resultado é inválido

#### Scenario: Dígitos repetidos
- **WHEN** a entrada é `111.111.111-11`
- **THEN** o resultado é inválido

#### Scenario: Tamanho incorreto
- **WHEN** a entrada tem menos ou mais de 11 dígitos
- **THEN** o resultado é inválido

### Requirement: Validação de CNPJ
`src/utils/cnpj.util.ts` SHALL expor uma função pura que valida um CNPJ pelo algoritmo oficial da Receita Federal, com 12 posições alfanuméricas seguidas de 2 dígitos verificadores numéricos calculados por módulo 11. A função MUST aceitar CNPJs numéricos e alfanuméricos, com ou sem pontuação e sem distinção entre maiúsculas e minúsculas, e MUST rejeitar sequências de um mesmo caractere repetido.

#### Scenario: CNPJ numérico válido
- **WHEN** a entrada é `11.222.333/0001-81`
- **THEN** o resultado é válido

#### Scenario: CNPJ alfanumérico válido
- **WHEN** a entrada é `12.ABC.345/01DE-35`
- **THEN** o resultado é válido

#### Scenario: CNPJ alfanumérico em minúsculas
- **WHEN** a entrada é `12.abc.345/01de-35`
- **THEN** o resultado é válido

#### Scenario: Dígito verificador incorreto
- **WHEN** a entrada é `11.222.333/0001-82`
- **THEN** o resultado é inválido

#### Scenario: Letra nos dígitos verificadores
- **WHEN** as duas últimas posições contêm uma letra
- **THEN** o resultado é inválido

#### Scenario: Caracteres repetidos
- **WHEN** a entrada é `00.000.000/0000-00`
- **THEN** o resultado é inválido

### Requirement: Normalização e formatação de documentos
Os utilitários de CPF e CNPJ SHALL expor funções de normalização, que removem a pontuação (e convertem o CNPJ para maiúsculas), e de formatação, que aplicam a máscara padrão para exibição.

#### Scenario: Normalização de CPF
- **WHEN** `529.982.247-25` é normalizado
- **THEN** o resultado é `52998224725`

#### Scenario: Normalização de CNPJ
- **WHEN** `12.abc.345/01de-35` é normalizado
- **THEN** o resultado é `12ABC34501DE35`

#### Scenario: Formatação de CPF
- **WHEN** `52998224725` é formatado
- **THEN** o resultado é `529.982.247-25`

#### Scenario: Formatação de CNPJ
- **WHEN** `11222333000181` é formatado
- **THEN** o resultado é `11.222.333/0001-81`
