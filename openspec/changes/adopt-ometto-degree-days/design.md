## Context

`engine/gda.ts` implementa o residual simples e cita Ometto; `dailyGDA(tmax, tmin, tBase)` é chamado em `water-balance.ts` (`runDailyBalance`), em `accumulateGDA` e em `resolveInterval` (`msa.service.ts`, para achar o dia em que o GDA atinge `gdaTotal`). A cultivar tem 15 parâmetros científicos enumerados em `CULTIVAR_PARAM_KEYS` (zod `cultivarParamsShape`, tipo `CultivarParams` do motor, `pickCultivarParams`, `snapshotCultivar`, `referenceSnapshot`, `fieldsToSync`, frontend `CULTIVAR_PARAM_KEYS`/`CULTIVAR_GROUPS`), todos `number` obrigatórios. `cultivarChangedSinceRun` já compara a união das chaves numéricas (chave ausente = null), preparada para `tUpper`. O e2e shell e a spec de processamento afirmam "15 parâmetros"; o manual (cap. 06) tem números marcados (`<!-- valor:yield.* -->`) que dependem das janelas.

## Goals / Non-Goals

**Goals:**
- Graus-dia pelo método de Ometto (1981), com Tb e TB, fórmula coerente com a referência citada.
- `tUpper` como 16º parâmetro da cultivar, opcional (sem TB ⇒ casos 1–3), com valor provisório 30 °C na referência de soja.
- Reprodutibilidade preservada: runs 2.0.0 permanecem no histórico; runs novas gravam 2.1.0 e `tUpper` no snapshot.
- Ferramenta de validação que mostre o efeito nos calendários F1–F4 (residual × Ometto sem TB × Ometto com TB).

**Non-Goals:**
- Entressafra, timeline de estresses, valor definitivo de TB, mudança de Tb.
- Reprocessar automaticamente as safras no deploy (segue manual: "Processar todas as safras ativas").

## Decisions

**1. `dailyGDA(tmax, tmin, tBase, tUpper?: number | null)` com seleção explícita de caso.** Implementação por ramos, nesta ordem: validar entradas finitas e `tmax ≥ tmin` (senão `RangeError`); se `tBase ≥ tmax` → 0 (caso 3); `cap = tUpper != null && tmax > tUpper` (TB só atua quando Tmax a excede — com Tmax = TB os casos 4/5 reduzem a 1/2, continuidade); se `cap` e `tmin ≥ tUpper` → `tUpper − tBase` (teto); se `tmin ≥ tBase` → caso 1 (sem `cap`) ou 4 (com `cap`); senão → caso 2 ou 5. `tmax = tmin` só chega aos casos 1 e 3 (não há divisão). Resultado final `clamp(gd, 0, tUpper − tBase)` quando há TB, `max(gd, 0)` sem TB — defesa contra arredondamento. Alternativa descartada: calcular pela integral do triângulo numérico (mais geral, mais lento, sem valor para a dissertação, que cita as cinco equações de Ometto).

**2. Assinatura compatível, `ENGINE_VERSION` 2.1.0.** O quarto parâmetro é opcional; `accumulateGDA(series, tBase, tUpper?)`, `runDailyBalance` e `resolveInterval` leem `cultivar.tUpper ?? null`. Pelo critério de `engine/index.ts` (minor quando o resultado muda para a mesma entrada), 2.1.0. Sem `tUpper` e com Tmin ≥ Tb o resultado é idêntico ao residual (caso 1 = média − Tb), o que preserva os testes antigos como regressão.

**3. `tUpper` nulo é valor legítimo, não ausência.** `CultivarParams.tUpper: number | null` (motor e zod); `CULTIVAR_PARAM_KEYS` ganha `'tUpper'` (16 chaves) e `NULLABLE_PARAM_KEYS = ['tUpper']`; `cultivarParamsShape.tUpper = z.number().min(15).max(50).nullable()` (obrigatório no corpo de criação como número ou `null`, para o formulário mandar explicitamente "sem TB"); `refineCultivarParams` adiciona `tUpper > tBase` quando não nulo (erro em `tUpper`). `pickCultivarParams` passa a copiar também `null` para as chaves anuláveis, de modo que snapshot da run e `referenceSnapshot` sempre tragam `tUpper` (número ou null) e `fieldsToSync`/`divergentFields` comparem `null === null` como igual. Alternativa descartada: `tUpper` opcional (`undefined`) — a comparação de divergência e o sync tratariam "não informado" e "igual à referência" de forma ambígua.

**4. Migration aditiva `adopt_ometto_degree_days`.** `ALTER TABLE cultivars ADD COLUMN t_upper DOUBLE PRECISION` (nulo); `UPDATE cultivars SET t_upper = 30` (referência e próprias — todas soja); `UPDATE cultivars SET reference_snapshot = reference_snapshot || '{"tUpper": 30}'::jsonb WHERE is_default = false AND reference_snapshot IS NOT NULL`. Assim as cultivares próprias nascem "não alteradas" em `tUpper` e seguem a referência no modo `unchanged` quando #10 fixar o valor final. Nada é apagado; runs 2.0.0 ficam (snapshot sem `tUpper` ⇒ `cultivarChangedSinceRun = true` ⇒ aviso de reprocessar, que é o comportamento desejado). O seed grava `tUpper: 30` em `reference-cultivars.ts` com a nota "provisório, questão #10".

**5. Frontend.** `CULTIVAR_PARAM_KEYS` com `tUpper`; `CULTIVAR_GROUPS` Térmicos ganha `{ key: 'tUpper', label: 'Temperatura-base superior', unit: '°C', step: '0.1', optional: true }`; zod do cliente: vazio ⇒ `null`, número ⇒ `> tBase` (mensagem "deve ser maior que a temperatura-base") e faixa 15–50; `toNumbers` devolve `null` para vazio nas chaves anuláveis (não NaN), `divergentFields`/`fieldsToSync` comparam `null` como valor; formulário mostra "ref. 30,0" e ajuda "Acima desta temperatura o dia acumula menos graus-dia (Ometto); vazio = sem limite superior". `toValues` converte `null` em `''`. O `POST` envia `tUpper: null` quando vazio.

**6. Script `gda-validate.ts` (Caso 5).** `pnpm msa:validate-gda -- (<clima.csv> | --synthetic [dias] | --cell lat,lon --from AAAA-MM-DD [--to AAAA-MM-DD]) [--tbase 10] [--tupper 30] [--cultivar soja] [--out saida.csv]`. `--cell` lê `era5_daily_data` pelo Prisma (`DATABASE_URL`), como o backend; CSV no formato de `synthetic-cerrado-season.csv`. Para cada método — `residual` (fórmula antiga, reimplementada localmente no script para não voltar ao motor), `ometto` (sem TB) e `ometto-tb` (TB = `--tupper`) — roda `accumulateGDA` + `phaseFromGDA` e imprime, por janela F1–F4: data de início, data de fim, dias; mais o dia em que `gdaTotal` é atingido (ou "não atingido") e o GDA total ao fim da série. Linha final: diferença de dias por janela entre `ometto-tb` e `residual`. `--out` grava CSV `metodo;janela;inicio;fim;dias;gda_fim`. Sem critério de aceitação (é descritivo; serve à tabela da dissertação).

**7. Testes.** `gda-phenology-kc.test.ts`: os sete cenários da spec, bordas (Tmin = Tb; Tmax = TB; Tmax = Tmin; Tmin ≥ TB), continuidade (caso 4 com TB → Tmax tende ao caso 1), regressão (sem TB e Tmin ≥ Tb ≡ residual), `RangeError` (Tmax < Tmin, NaN), `accumulateGDA` com TB. `invariants.test.ts`: cultivar aleatória com `tUpper` null em metade dos casos ou em `(tBase + 5, 45]`; invariantes `0 ≤ gda ≤ tUpper − tBase` por dia (ou `≥ 0`). Testes de DTO: `tUpper` nulo aceito, `tUpper ≤ tBase` rejeitado em `tUpper`, faixa; `CULTIVAR_PARAM_KEYS` com 16. Serviço: snapshot com `tUpper`; `cultivarChangedSinceRun` com snapshot 2.0.0 (sem a chave) ⇒ true. e2e shell: referência com `tUpper 30`, criação com `null` e com 25, `tUpper ≤ tBase` → 400, sync após `UPDATE t_upper = 32` na referência.

**8. Docs e manual.** `algoritmos.md` §1 com as cinco equações, convenções, exemplo (Tb 10, TB 30: 34/20 → 16,43 vs 17 no residual) e nota de que o residual é o caso 1. Manual cap. 04 (campo no grupo Térmicos, com a explicação) e cap. 08 (glossário "Temperatura-base superior (TB)"); captura refeita (`pnpm manual:capture`) e os valores marcados do cap. 06 atualizados a partir do novo `captura.json`. `questoes-abertas.md`: #10 (TB para soja: 30 °C provisório; convenção Tmin ≥ TB = teto), #11 (Kc/Zr na entressafra) e #12 (data de início do balanço) registrados como decorrentes da reunião, para a change de entressafra.

## Risks / Trade-offs

- **Janelas mudam para todas as safras** → esperado; runs 2.0.0 ficam no histórico com aviso de cultivar alterada; "Processar todas as safras ativas" após o deploy.
- **TB = 30 °C é provisório** → constante só em `reference-cultivars.ts` + migration; a troca futura é `UPDATE` da referência + sync `unchanged` nas próprias (Decisão 4 garante que o campo conta como não alterado).
- **Tmin ≥ TB raro, mas possível em ondas de calor** → convenção explícita (teto TB − Tb), testada; registrada em #10 para a pesquisadora confirmar.
- **Números do manual defasados** → `manual-check` acusa; a tarefa de captura inclui atualizar os valores marcados.
- **`null` em `pickCultivarParams`** → só para `NULLABLE_PARAM_KEYS`; os demais continuam exigindo número.

## Migration Plan

1. Merge; CI roda testes e e2e shell atualizados.
2. `prisma migrate deploy` (aditiva, sem perda) e seed (atualiza a referência com `tUpper 30`).
3. Em `/admin`, "Processar todas as safras ativas" (runs 2.1.0).
4. Rollback: voltar a imagem anterior; a coluna `t_upper` extra é ignorada pelo motor 2.0.0 (Prisma antigo não a seleciona por nome? — ele seleciona `cultivar: true`, que inclui a coluna desconhecida; por isso o rollback de código exige reverter também a migration com `ALTER TABLE cultivars DROP COLUMN t_upper`).

## Open Questions

- **#10** Valor de TB para soja (30 °C provisório; literatura varia 30–35) e convenção para Tmin ≥ TB — pesquisadora e professor Adilson.
- Faixa de validação de `tUpper` (adotado 15–50 °C) — confirmar.
