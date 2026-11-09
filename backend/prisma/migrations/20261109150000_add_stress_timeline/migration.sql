-- add-stress-timeline-yield-forecast: eventos de estresse hídrico e perda de produtividade
-- por janela gravados na run (motor 2.3.0). Migration aditiva: runs anteriores ficam com os
-- campos nulos e GET /msa calcula a leitura a partir da série persistida.
ALTER TABLE "msa_runs"
  ADD COLUMN "stress_events" JSONB,
  ADD COLUMN "yield_loss" JSONB,
  ADD COLUMN "stress_ks_threshold" DOUBLE PRECISION,
  ADD COLUMN "stress_min_days" INTEGER;
