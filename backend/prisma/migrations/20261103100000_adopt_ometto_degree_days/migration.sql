-- adopt-ometto-degree-days: graus-dia pelo método de Ometto (1981) com
-- temperatura-base superior (TB). Migration aditiva: nada é apagado.

-- 1. Novo parâmetro científico da cultivar (nulo = sem limite superior).
ALTER TABLE "cultivars" ADD COLUMN "t_upper" DOUBLE PRECISION;

-- 2. Soja: TB = 30 °C provisório (docs/msa/questoes-abertas.md #10) na referência
-- e nas cultivares próprias existentes.
UPDATE "cultivars" SET "t_upper" = 30 WHERE "crop" = 'SOJA';

-- 3. O referenceSnapshot das próprias ganha o mesmo valor, para que tUpper conte
-- como "não alterado" e acompanhe a referência no sync `unchanged`.
UPDATE "cultivars"
SET "reference_snapshot" = "reference_snapshot" || '{"tUpper": 30}'::jsonb
WHERE "is_default" = false AND "reference_snapshot" IS NOT NULL;

-- Runs anteriores (motor 2.0.0) ficam no histórico: o snapshot sem tUpper faz
-- GET /msa devolver cultivarChangedSinceRun = true, e o painel sugere reprocessar.
