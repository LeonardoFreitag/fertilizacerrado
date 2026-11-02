-- refocus-on-yield-prediction: motor determinístico 2.0.0, predição de
-- produtividade, fim do Monte Carlo/cenários/decisões, só soja.
-- Migration destrutiva: runs antigas (motor 1.x) não são reproduzíveis pelo
-- motor 2.0.0 e são descartadas; após o deploy, "Processar todas as safras ativas".

-- 0. Guarda: falha ANTES de qualquer alteração se houver cultivar de milho em uso
-- (o sistema passa a aceitar só SOJA). Fica no topo para que uma falha não deixe
-- o banco parcialmente migrado, independentemente de transação externa.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(format('cultivar %s (%s) em %s safra(s)', c."id", c."name", n.cnt), '; ')
    INTO offending
  FROM "cultivars" c
  JOIN (SELECT "cultivar_id", count(*) AS cnt FROM "harvests" GROUP BY "cultivar_id") n ON n."cultivar_id" = c."id"
  WHERE c."crop" = 'MILHO';
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Migration refocus_yield_prediction: existem cultivares MILHO em uso (%). O sistema passa a aceitar só SOJA: remova essas safras ou troque a cultivar antes de migrar.', offending;
  END IF;
END $$;

-- 1. Runs antigas: a cascata apaga série diária e resumos; harvests.latest_run_id vai a NULL (ON DELETE SET NULL).
DELETE FROM "msa_runs";

-- 2. Decisões e cenários deixam de existir.
DROP TABLE "msa_decisions";
DROP TYPE "msa_scenario";

-- 3. msa_runs: sem Monte Carlo, com o resultado da predição.
ALTER TABLE "msa_runs"
  DROP COLUMN "seed",
  DROP COLUMN "iterations",
  DROP COLUMN "sigma_precip",
  DROP COLUMN "sigma_temp",
  ADD COLUMN "expected_yield" DOUBLE PRECISION,
  ADD COLUMN "yield_index" DOUBLE PRECISION,
  ADD COLUMN "predicted_yield" DOUBLE PRECISION,
  ADD COLUMN "phases_reached" INTEGER;

-- 4. msa_phase_summaries: sem percentis nem iterações.
ALTER TABLE "msa_phase_summaries"
  DROP COLUMN "valid_iterations",
  DROP COLUMN "ks_mean_p10",
  DROP COLUMN "ks_mean_p50",
  DROP COLUMN "ks_mean_p90",
  DROP COLUMN "yield_reduction_p10",
  DROP COLUMN "yield_reduction_p50",
  DROP COLUMN "yield_reduction_p90",
  DROP COLUMN "etc_adj_accum_p10",
  DROP COLUMN "etc_adj_accum_p50",
  DROP COLUMN "etc_adj_accum_p90";

-- 5. Produtividade potencial (Ym) da safra.
ALTER TABLE "harvests" ADD COLUMN "expected_yield" DOUBLE PRECISION;

-- 6. Snapshot da referência na cultivar (o que o técnico não alterou).
ALTER TABLE "cultivars" ADD COLUMN "reference_snapshot" JSONB;

-- Backfill das cultivares próprias de soja com a referência atual (aproximação:
-- campos iguais à referência de hoje contam como "não alterados").
UPDATE "cultivars" c
SET "reference_snapshot" = jsonb_build_object(
  'tBase', r."t_base", 'gdaTotal', r."gda_total",
  'gdaF1End', r."gda_f1_end", 'gdaF2End', r."gda_f2_end", 'gdaF3End', r."gda_f3_end",
  'kcIni', r."kc_ini", 'kcMid', r."kc_mid", 'kcEnd', r."kc_end",
  'depletionFraction', r."depletion_fraction", 'zrIni', r."zr_ini", 'zrMax', r."zr_max",
  'kyF1', r."ky_f1", 'kyF2', r."ky_f2", 'kyF3', r."ky_f3", 'kyF4', r."ky_f4"
)
FROM "cultivars" r
WHERE r."is_default" = true AND r."crop" = 'SOJA'
  AND c."is_default" = false AND c."crop" = 'SOJA';

-- 7. Só soja: remove cultivares de milho (sem safras, garantido pela guarda 0;
-- inclui a referência do seed anterior) e reduz o enum.
DELETE FROM "cultivars" c
WHERE c."crop" = 'MILHO'
  AND NOT EXISTS (SELECT 1 FROM "harvests" h WHERE h."cultivar_id" = c."id");


CREATE TYPE "crop_new" AS ENUM ('SOJA');
ALTER TABLE "cultivars" ALTER COLUMN "crop" TYPE "crop_new" USING ("crop"::text::"crop_new");
DROP TYPE "crop";
ALTER TYPE "crop_new" RENAME TO "crop";
