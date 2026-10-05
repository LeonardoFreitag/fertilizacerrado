"""Configuração por variáveis de ambiente (nunca ``~/.cdsapirc``)."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_CDS_API_URL = "https://cds.climate.copernicus.eu/api"
DATASET = "reanalysis-era5-land"


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    database_url: str
    cds_api_url: str
    cds_api_key: str | None
    cache_dir: str
    redis_url: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        database_url = env.get("DATABASE_URL", "").strip()
        if not database_url:
            raise ConfigError("DATABASE_URL não definida")
        return cls(
            database_url=database_url,
            cds_api_url=env.get("CDS_API_URL", "").strip() or DEFAULT_CDS_API_URL,
            cds_api_key=env.get("CDS_API_KEY", "").strip() or None,
            cache_dir=env.get("ETL_CACHE_DIR", "").strip() or "./cache",
            redis_url=env.get("REDIS_URL", "").strip() or None,
        )

    def require_redis_url(self) -> str:
        if not self.redis_url:
            raise ConfigError("REDIS_URL não definida: o worker precisa do Redis das filas BullMQ")
        return self.redis_url

    def require_cds_key(self) -> str:
        """Token pessoal da API nova do CDS (sem ``uid:``)."""
        if not self.cds_api_key:
            raise ConfigError(
                "CDS_API_KEY não definida: informe o token pessoal da API do CDS "
                "(https://cds.climate.copernicus.eu/profile) e aceite a licença do dataset"
            )
        if ":" in self.cds_api_key:
            raise ConfigError(
                "CDS_API_KEY no formato antigo 'uid:key'; a API nova usa só o token"
            )
        return self.cds_api_key
