-- CreateEnum
CREATE TYPE "crop" AS ENUM ('SOJA', 'MILHO');

-- CreateEnum
CREATE TYPE "harvest_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "cultivars" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "crop" "crop" NOT NULL,
    "cycle_description" TEXT,
    "t_base" DOUBLE PRECISION NOT NULL,
    "gda_total" DOUBLE PRECISION NOT NULL,
    "gda_f1_end" DOUBLE PRECISION NOT NULL,
    "gda_f2_end" DOUBLE PRECISION NOT NULL,
    "gda_f3_end" DOUBLE PRECISION NOT NULL,
    "kc_ini" DOUBLE PRECISION NOT NULL,
    "kc_mid" DOUBLE PRECISION NOT NULL,
    "kc_end" DOUBLE PRECISION NOT NULL,
    "depletion_fraction" DOUBLE PRECISION NOT NULL,
    "zr_ini" DOUBLE PRECISION NOT NULL,
    "zr_max" DOUBLE PRECISION NOT NULL,
    "ky_f1" DOUBLE PRECISION NOT NULL,
    "ky_f2" DOUBLE PRECISION NOT NULL,
    "ky_f3" DOUBLE PRECISION NOT NULL,
    "ky_f4" DOUBLE PRECISION NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cultivars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvests" (
    "id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "cultivar_id" UUID NOT NULL,
    "emergence_date" DATE NOT NULL,
    "season" TEXT NOT NULL,
    "status" "harvest_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "harvests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cultivars_created_by_id_idx" ON "cultivars"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "cultivars_name_crop_created_by_id_key" ON "cultivars"("name", "crop", "created_by_id");

-- CreateIndex
CREATE INDEX "harvests_field_id_idx" ON "harvests"("field_id");

-- CreateIndex
CREATE INDEX "harvests_cultivar_id_idx" ON "harvests"("cultivar_id");

-- CreateIndex
CREATE INDEX "harvests_status_idx" ON "harvests"("status");

-- AddForeignKey
ALTER TABLE "cultivars" ADD CONSTRAINT "cultivars_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_cultivar_id_fkey" FOREIGN KEY ("cultivar_id") REFERENCES "cultivars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
