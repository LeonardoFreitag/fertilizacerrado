-- CreateEnum
CREATE TYPE "station_source" AS ENUM ('INMET', 'ANA', 'OUTRA');

-- AlterTable
ALTER TABLE "era5_daily_data" ADD COLUMN     "qm_calibration_id" UUID;

-- AlterTable
ALTER TABLE "msa_runs" ADD COLUMN     "qm_calibration_id" UUID;

-- CreateTable
CREATE TABLE "weather_stations" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "station_source" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "altitude_m" DOUBLE PRECISION,
    "geometry" geography(Point,4326) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_stations_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "station_daily_obs" (
    "station_code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "precip_mm" REAL,
    "tmax" REAL,
    "tmin" REAL,
    "source_file" TEXT,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_daily_obs_pkey" PRIMARY KEY ("station_code","date")
);

-- CreateTable
CREATE TABLE "qm_calibrations" (
    "id" UUID NOT NULL,
    "cell_lat" DECIMAL(4,1) NOT NULL,
    "cell_lon" DECIMAL(5,1) NOT NULL,
    "station_code" TEXT NOT NULL,
    "variable" TEXT NOT NULL DEFAULT 'tp',
    "method" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "n_days_by_month" JSONB NOT NULL,
    "wet_day_threshold_obs" REAL NOT NULL,
    "wet_thresholds_era5" JSONB NOT NULL,
    "quantiles" JSONB NOT NULL,
    "max_ratio" REAL NOT NULL,
    "distance_km" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qm_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "station_daily_obs_date_idx" ON "station_daily_obs"("date" DESC);

-- CreateIndex
CREATE INDEX "qm_calibrations_cell_lat_cell_lon_variable_active_idx" ON "qm_calibrations"("cell_lat", "cell_lon", "variable", "active");

-- AddForeignKey
ALTER TABLE "era5_daily_data" ADD CONSTRAINT "era5_daily_data_qm_calibration_id_fkey" FOREIGN KEY ("qm_calibration_id") REFERENCES "qm_calibrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_runs" ADD CONSTRAINT "msa_runs_qm_calibration_id_fkey" FOREIGN KEY ("qm_calibration_id") REFERENCES "qm_calibrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_daily_obs" ADD CONSTRAINT "station_daily_obs_station_code_fkey" FOREIGN KEY ("station_code") REFERENCES "weather_stations"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qm_calibrations" ADD CONSTRAINT "qm_calibrations_station_code_fkey" FOREIGN KEY ("station_code") REFERENCES "weather_stations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hipertabela de observações (chunk de 1 ano: volume pequeno, muitos anos)
SELECT create_hypertable('station_daily_obs', 'date', chunk_time_interval => INTERVAL '1 year');

-- Uma calibração ativa por célula/variável (recalibrar desativa a anterior; nunca apaga)
CREATE UNIQUE INDEX "qm_calibrations_one_active_idx" ON "qm_calibrations"("cell_lat", "cell_lon", "variable") WHERE "active";
