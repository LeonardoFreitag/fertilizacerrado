-- add-preseason-water-balance: spin-up de entressafra desde o último 1º de fevereiro
-- antes da emergência (motor 2.2.0). Migration aditiva: nada é apagado; runs anteriores
-- ficam com os campos nulos (o painel sugere reprocessar). A coluna msa_daily_results.phase
-- já é texto e passa a receber 'PRE' nos dias de entressafra.
ALTER TABLE "msa_runs"
  ADD COLUMN "pre_season_from" DATE,
  ADD COLUMN "pre_season_kc" DOUBLE PRECISION,
  ADD COLUMN "pre_season_zr" DOUBLE PRECISION,
  ADD COLUMN "emergence_depletion_mm" DOUBLE PRECISION,
  ADD COLUMN "emergence_depletion_pct" DOUBLE PRECISION;
