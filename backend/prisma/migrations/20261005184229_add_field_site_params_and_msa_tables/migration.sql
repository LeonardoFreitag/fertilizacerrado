-- CreateEnum
CREATE TYPE "msa_run_status" AS ENUM ('SUCCEEDED', 'FAILED', 'NEEDS_DATA');

-- CreateEnum
CREATE TYPE "msa_scenario" AS ENUM ('A', 'B', 'C');

-- AlterTable
ALTER TABLE "fields" ADD COLUMN     "altitude_m" DOUBLE PRECISION,
ADD COLUMN     "theta_fc" DOUBLE PRECISION,
ADD COLUMN     "theta_wp" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "harvests" ADD COLUMN     "latest_run_id" UUID;

-- CreateTable
CREATE TABLE "msa_runs" (
    "id" UUID NOT NULL,
    "harvest_id" UUID NOT NULL,
    "status" "msa_run_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "seed" INTEGER,
    "iterations" INTEGER,
    "sigma_precip" DOUBLE PRECISION,
    "sigma_temp" DOUBLE PRECISION,
    "cultivar_snapshot" JSONB NOT NULL,
    "soil_snapshot" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "missing_dates" JSONB,
    "error" TEXT,
    "triggered_by_id" UUID,

    CONSTRAINT "msa_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msa_daily_results" (
    "run_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "phase" TEXT NOT NULL,
    "gda" DOUBLE PRECISION NOT NULL,
    "gda_accum" DOUBLE PRECISION NOT NULL,
    "zr" DOUBLE PRECISION NOT NULL,
    "et0" DOUBLE PRECISION NOT NULL,
    "kc" DOUBLE PRECISION NOT NULL,
    "etc" DOUBLE PRECISION NOT NULL,
    "precipitation" DOUBLE PRECISION NOT NULL,
    "dr" DOUBLE PRECISION NOT NULL,
    "ks" DOUBLE PRECISION NOT NULL,
    "etc_adj" DOUBLE PRECISION NOT NULL,
    "taw" DOUBLE PRECISION NOT NULL,
    "raw" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "msa_daily_results_pkey" PRIMARY KEY ("run_id","date")
);

-- CreateTable
CREATE TABLE "msa_phase_summaries" (
    "run_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "ks_mean" DOUBLE PRECISION,
    "etc_adj_accum" DOUBLE PRECISION NOT NULL,
    "precip_accum" DOUBLE PRECISION NOT NULL,
    "yield_reduction_pct" DOUBLE PRECISION,
    "valid_iterations" INTEGER NOT NULL,
    "ks_mean_p10" DOUBLE PRECISION,
    "ks_mean_p50" DOUBLE PRECISION,
    "ks_mean_p90" DOUBLE PRECISION,
    "yield_reduction_p10" DOUBLE PRECISION,
    "yield_reduction_p50" DOUBLE PRECISION,
    "yield_reduction_p90" DOUBLE PRECISION,
    "etc_adj_accum_p10" DOUBLE PRECISION,
    "etc_adj_accum_p50" DOUBLE PRECISION,
    "etc_adj_accum_p90" DOUBLE PRECISION,

    CONSTRAINT "msa_phase_summaries_pkey" PRIMARY KEY ("run_id","phase")
);

-- CreateTable
CREATE TABLE "msa_decisions" (
    "id" UUID NOT NULL,
    "harvest_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "scenario" "msa_scenario" NOT NULL,
    "dose_base" DOUBLE PRECISION NOT NULL,
    "efficiency_base" DOUBLE PRECISION NOT NULL,
    "scenario_payload" JSONB NOT NULL,
    "justification" TEXT NOT NULL,
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msa_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "msa_runs_harvest_id_started_at_idx" ON "msa_runs"("harvest_id", "started_at");

-- CreateIndex
CREATE INDEX "msa_decisions_harvest_id_created_at_idx" ON "msa_decisions"("harvest_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "harvests_latest_run_id_key" ON "harvests"("latest_run_id");

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_latest_run_id_fkey" FOREIGN KEY ("latest_run_id") REFERENCES "msa_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_runs" ADD CONSTRAINT "msa_runs_harvest_id_fkey" FOREIGN KEY ("harvest_id") REFERENCES "harvests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_runs" ADD CONSTRAINT "msa_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_daily_results" ADD CONSTRAINT "msa_daily_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "msa_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_phase_summaries" ADD CONSTRAINT "msa_phase_summaries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "msa_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_decisions" ADD CONSTRAINT "msa_decisions_harvest_id_fkey" FOREIGN KEY ("harvest_id") REFERENCES "harvests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_decisions" ADD CONSTRAINT "msa_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "msa_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_decisions" ADD CONSTRAINT "msa_decisions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

