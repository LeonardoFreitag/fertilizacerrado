-- CreateEnum
CREATE TYPE "ingestion_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "era5_daily_data" (
    "time" DATE NOT NULL,
    "cell_lat" DECIMAL(4,1) NOT NULL,
    "cell_lon" DECIMAL(5,1) NOT NULL,
    "t2m_max" REAL NOT NULL,
    "t2m_min" REAL NOT NULL,
    "t2m_mean" REAL NOT NULL,
    "d2m_mean" REAL NOT NULL,
    "u2" REAL NOT NULL,
    "rn" REAL NOT NULL,
    "tp_raw" REAL NOT NULL,
    "tp_corrected" REAL NOT NULL,
    "qm_applied" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'era5-land',
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "era5_daily_data_pkey" PRIMARY KEY ("time","cell_lat","cell_lon")
);

-- CreateTable
CREATE TABLE "era5_ingestion_runs" (
    "id" UUID NOT NULL,
    "command" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" "ingestion_status" NOT NULL DEFAULT 'RUNNING',
    "date_from" DATE,
    "date_to" DATE,
    "cells_requested" INTEGER,
    "rows_upserted" INTEGER,
    "cds_request_id" TEXT,
    "error" TEXT,

    CONSTRAINT "era5_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "era5_daily_data_cell_lat_cell_lon_time_idx" ON "era5_daily_data"("cell_lat", "cell_lon", "time");

-- CreateIndex
CREATE INDEX "era5_ingestion_runs_started_at_idx" ON "era5_ingestion_runs"("started_at");

-- Hipertabela TimescaleDB particionada por mês (a PK já inclui a coluna de tempo)
SELECT create_hypertable('era5_daily_data', 'time', chunk_time_interval => INTERVAL '1 month');
