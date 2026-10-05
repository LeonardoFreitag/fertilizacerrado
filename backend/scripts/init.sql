-- Executado pelo entrypoint do PostgreSQL apenas na primeira inicialização
-- do volume (diretório de dados vazio).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Geometrias dos talhões (PostGIS) e séries temporais ERA5-Land (TimescaleDB)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Vale para novas conexões ao banco criado por POSTGRES_DB.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Sao_Paulo');
END
$$;
