FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ETL_CACHE_DIR=/data/cache

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY era5 ./era5
COPY tests ./tests
COPY pytest.ini ./

# Usuário não-root; o cache dos NetCDF fica no volume etl_cache
RUN useradd --system --uid 1001 --create-home etl \
    && mkdir -p /data/cache /data/station-imports \
    && chown -R etl:etl /data/cache /app \
    && chmod 777 /data/station-imports
USER etl

# Padrão: worker BullMQ (fila era5-ingest). CLI: `docker compose run --rm etl <comando>`
ENTRYPOINT ["python", "-m", "era5.cli"]
CMD ["worker"]
