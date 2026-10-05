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
    && mkdir -p /data/cache \
    && chown -R etl:etl /data/cache /app
USER etl

# Não é daemon: `docker compose run --rm etl <comando>`
ENTRYPOINT ["python", "-m", "era5.cli"]
CMD ["status"]
