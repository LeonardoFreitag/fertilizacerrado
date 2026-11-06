## MODIFIED Requirements

### Requirement: Métricas do protocolo de validação
O script SHALL calcular RMSE `= sqrt(mean((S − O)²))`, R² como o quadrado do coeficiente de correlação de Pearson entre S e O, NSE `= 1 − Σ(O − S)² / Σ(O − Ō)²` e PBIAS `= Σ(O − S) / Σ O × 100`, e comparar com os critérios RMSE ≤ 0,5, R² ≥ 0,95, NSE ≥ 0,80 e |PBIAS| ≤ 10 %. `metrics.ts` SHALL exportar também `relativeError(predicted, observed) = (predicted − observed) / observed` (erro relativo da produtividade predita do Caso 2, em fração; `RangeError` para `observed ≤ 0`), e `docs/msa/validacao.md` SHALL descrever no Caso 2 a comparação da produtividade predita pela run com a produtividade observada da safra histórica, quando disponível, registrando o erro relativo no relatório.

#### Scenario: Séries idênticas
- **WHEN** S = O em todas as linhas
- **THEN** RMSE 0, R² 1, NSE 1 e PBIAS 0

#### Scenario: Viés constante
- **WHEN** S = O + 0,5 em todas as linhas
- **THEN** RMSE 0,5, R² 1, PBIAS negativo e NSE menor que 1

#### Scenario: Erro relativo da produtividade
- **WHEN** `relativeError(47,84, 52)` é avaliado
- **THEN** o resultado é −0,08 (tolerância 1e-9)

#### Scenario: Observado inválido
- **WHEN** `relativeError(47,84, 0)` é avaliado
- **THEN** a função lança `RangeError`

## REMOVED Requirements

### Requirement: Script de convergência do Monte Carlo
**Reason**: O motor deixa de ter Monte Carlo; o Caso 3 do protocolo e a Fase 3 do roteiro são removidos.
**Migration**: Remover `backend/scripts/validation/mc-validate.ts`, o script `msa:validate-mc` do `package.json`, a seção "Monte Carlo (Caso 3 — convergência)" do `scripts/validation/README.md`, o Caso 3 de `docs/msa/validacao.md` e a Fase 3 de `docs/msa/roteiro-validacao.md`. `examples/synthetic-cerrado-season.csv` permanece como série sintética de referência para testes.
