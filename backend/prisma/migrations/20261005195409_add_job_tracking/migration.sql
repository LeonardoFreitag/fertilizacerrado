-- CreateEnum
CREATE TYPE "msa_run_reason" AS ENUM ('WEEKLY', 'BACKFILL', 'MANUAL');

-- AlterTable
ALTER TABLE "era5_ingestion_runs" ADD COLUMN     "job_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "msa_runs" ADD COLUMN     "job_id" TEXT,
ADD COLUMN     "reason" "msa_run_reason" NOT NULL DEFAULT 'MANUAL';
