"""Etapa 1 — download no CDS (API nova), uma requisição por mês, com cache."""

from __future__ import annotations

import calendar
import hashlib
import logging
from datetime import date, timedelta
from pathlib import Path

from .config import DATASET, Settings

log = logging.getLogger(__name__)

GRID = 0.1
MARGIN = 0.1

VARIABLES = [
    "2m_temperature",
    "2m_dewpoint_temperature",
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
    "surface_net_solar_radiation",
    "surface_net_thermal_radiation",
    "total_precipitation",
]

BBox = tuple[float, float, float, float]  # (north, west, south, east) — ordem do CDS


def _snap(value: float) -> float:
    return round(round(value / GRID) * GRID, 1)


def grid_bbox(cells: list[tuple[float, float]], margin: float = MARGIN) -> BBox:
    """Menor retângulo da grade que contém as células, expandido ``margin`` em
    cada direção. Ordem (N, W, S, E) como o parâmetro ``area`` do CDS."""
    if not cells:
        raise ValueError("nenhuma célula para calcular a bounding box")
    lats = [c[0] for c in cells]
    lons = [c[1] for c in cells]
    return (
        _snap(max(lats) + margin),
        _snap(min(lons) - margin),
        _snap(min(lats) - margin),
        _snap(max(lons) + margin),
    )


def months_covering(date_from: date, date_to: date) -> list[tuple[int, int]]:
    """Meses de ``[date_from, date_to + 1 dia]``: o total diário dos acumulados
    do último dia exige o passo 00 UTC do dia seguinte."""
    if date_from > date_to:
        raise ValueError("date_from posterior a date_to")
    end = date_to + timedelta(days=1)
    months: list[tuple[int, int]] = []
    y, m = date_from.year, date_from.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def cache_path(cache_dir: str | Path, bbox: BBox, year: int, month: int) -> Path:
    key = hashlib.sha1(",".join(f"{v:.1f}" for v in bbox).encode()).hexdigest()[:12]
    return Path(cache_dir) / f"bbox-{key}" / f"{year:04d}-{month:02d}.nc"


def build_request(bbox: BBox, year: int, month: int) -> dict:
    days = calendar.monthrange(year, month)[1]
    return {
        "variable": VARIABLES,
        "year": f"{year:04d}",
        "month": f"{month:02d}",
        "day": [f"{d:02d}" for d in range(1, days + 1)],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": list(bbox),
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


def make_client(settings: Settings):
    import cdsapi  # import tardio: só quem baixa precisa do pacote configurado

    return cdsapi.Client(url=settings.cds_api_url, key=settings.require_cds_key(), quiet=True)


def fetch_month(client, bbox: BBox, year: int, month: int, cache_dir: str | Path) -> Path:
    """Devolve o NetCDF do mês para a bbox, baixando só se não estiver em cache."""
    target = cache_path(cache_dir, bbox, year, month)
    if target.exists() and target.stat().st_size > 0:
        log.info("cache: %s", target)
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".nc.part")
    log.info("CDS: %s %04d-%02d area=%s", DATASET, year, month, bbox)
    client.retrieve(DATASET, build_request(bbox, year, month), str(tmp))
    tmp.replace(target)
    return target


def fetch_range(
    client, bbox: BBox, date_from: date, date_to: date, cache_dir: str | Path
) -> list[Path]:
    return [fetch_month(client, bbox, y, m, cache_dir) for y, m in months_covering(date_from, date_to)]
