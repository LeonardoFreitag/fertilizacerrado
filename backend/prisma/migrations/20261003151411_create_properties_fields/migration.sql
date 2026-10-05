-- Extensões necessárias às colunas geográficas. Idempotente: o init.sql já as
-- cria em volumes novos, mas o shadow database e bancos anteriores não o executam.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "city" TEXT NOT NULL,
    "car" TEXT,
    "nirf" TEXT,
    "owner_id" UUID NOT NULL,
    "agronomist_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fields" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "area_ha" DECIMAL(12,2) NOT NULL,
    "geometry" geography(Polygon,4326) NOT NULL,
    "centroid" geography(Point,4326) NOT NULL,
    "soil_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "era5_cells" (
    "field_id" UUID NOT NULL,
    "cell_lat" DECIMAL(4,1) NOT NULL,
    "cell_lon" DECIMAL(5,1) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "era5_cells_pkey" PRIMARY KEY ("field_id")
);

-- CreateIndex
CREATE INDEX "properties_owner_id_idx" ON "properties"("owner_id");

-- CreateIndex
CREATE INDEX "properties_agronomist_id_idx" ON "properties"("agronomist_id");

-- CreateIndex
CREATE INDEX "fields_property_id_idx" ON "fields"("property_id");

-- CreateIndex
CREATE INDEX "fields_geometry_idx" ON "fields" USING GIST ("geometry");

-- CreateIndex
CREATE INDEX "era5_cells_cell_lat_cell_lon_idx" ON "era5_cells"("cell_lat", "cell_lon");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_agronomist_id_fkey" FOREIGN KEY ("agronomist_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "era5_cells" ADD CONSTRAINT "era5_cells_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
