## ADDED Requirements

### Requirement: Script de validação dos eventos de estresse
`backend/scripts/validation/stress-validate.ts`, executado por `pnpm msa:validate-stress -- --harvest <uuid> [--station <código>] [--dry-mm 10] [--out <saida.csv>]`, SHALL ler a última run `SUCCEEDED` da safra (série de cultura e `cultivarSnapshot`) pela conexão do backend, recalcular os eventos de estresse com `detectStressEvents` e os parâmetros do ambiente, ler `station_daily_obs` da estação informada (padrão: a estação da calibração QM ativa da célula; sem estação MUST encerrar com código 1 explicando) e calcular os **veranicos** (`drySpells`: sequências de dias consecutivos com `precipMm < dryMm`, duração ≥ `STRESS_MIN_DAYS`; dia sem observação interrompe a sequência). SHALL imprimir as duas listas (início, fim, dias; janela dominante e déficit para os eventos) e, por evento, a fração dos seus dias cobertos por veranicos e o deslocamento em dias para o veranico mais próximo. Com `--out`, SHALL gravar `tipo;inicio;fim;dias;janela;deficit_mm;cobertura_pct`. Não há critério de aceitação: alimenta o Caso 2 de `docs/msa/validacao.md` (concordância de datas) e a questão aberta #14. `drySpells` e a sobreposição MUST ser funções puras testadas (`stress-methods.ts`).

#### Scenario: Safra com evento e veranico coincidentes
- **WHEN** a run tem um evento de 12 a 23 de janeiro e a estação registra chuva < 10 mm de 8 a 25 de janeiro
- **THEN** o script imprime o evento com cobertura 100 % e deslocamento −4 dias

#### Scenario: Sem estação
- **WHEN** a célula não tem calibração QM e `--station` não é informado
- **THEN** o script encerra com código 1 indicando como informar a estação

#### Scenario: Saída em CSV
- **WHEN** `--out` é informado
- **THEN** o arquivo tem o cabeçalho `tipo;inicio;fim;dias;janela;deficit_mm;cobertura_pct` e uma linha por evento e por veranico

#### Scenario: Veranico interrompido por dia sem dado
- **WHEN** a estação não tem observação em um dia no meio de um período seco
- **THEN** o período é dividido em dois veranicos (cada um só conta se durar ≥ `STRESS_MIN_DAYS`)
