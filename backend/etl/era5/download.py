"""Etapa 1 — download no CDS (API nova) com cache em ``ETL_CACHE_DIR``.

Intervalos de até dois meses são requisitados por mês (``AAAA-MM.nc``);
intervalos maiores, por trimestre civil (``AAAA-Qn.nc``), reaproveitando os
três arquivos mensais quando já estiverem em cache.
"""

from __future__ import annotations

import calendar
import hashlib
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .config import DATASET, Settings

log = logging.getLogger(__name__)

GRID = 0.1
MARGIN = 0.1
MONTHLY_MAX_MONTHS = 2  # acima disto, agrupa por trimestre
CONSOLIDATION_LAG_DAYS = 6  # mês "fechado" quando seu último dia + lag já passou

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
YearMonth = tuple[int, int]
YearQuarter = tuple[int, int]
ProgressFn = Callable[[int, int], None]  # (períodos concluídos, total)


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


def months_covering(date_from: date, date_to: date) -> list[YearMonth]:
    """Meses de ``[date_from, date_to + 1 dia]``: o total diário dos acumulados
    do último dia exige o passo 00 UTC do dia seguinte."""
    if date_from > date_to:
        raise ValueError("date_from posterior a date_to")
    end = date_to + timedelta(days=1)
    months: list[YearMonth] = []
    y, m = date_from.year, date_from.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def quarter_of(month: int) -> int:
    return (month - 1) // 3 + 1


def quarter_months(year: int, quarter: int) -> list[YearMonth]:
    first = (quarter - 1) * 3 + 1
    return [(year, first), (year, first + 1), (year, first + 2)]


def quarters_covering(date_from: date, date_to: date) -> list[YearQuarter]:
    """Trimestres civis distintos dos meses de ``months_covering``, em ordem."""
    seen: list[YearQuarter] = []
    for y, m in months_covering(date_from, date_to):
        q = (y, quarter_of(m))
        if q not in seen:
            seen.append(q)
    return seen


def _bbox_dir(cache_dir: str | Path, bbox: BBox) -> Path:
    key = hashlib.sha1(",".join(f"{v:.1f}" for v in bbox).encode()).hexdigest()[:12]
    return Path(cache_dir) / f"bbox-{key}"


def cache_path(cache_dir: str | Path, bbox: BBox, year: int, month: int) -> Path:
    return _bbox_dir(cache_dir, bbox) / f"{year:04d}-{month:02d}.nc"


def cache_path_quarter(cache_dir: str | Path, bbox: BBox, year: int, quarter: int) -> Path:
    return _bbox_dir(cache_dir, bbox) / f"{year:04d}-Q{quarter}.nc"


def build_request(bbox: BBox, year: int, months: int | list[int]) -> dict:
    """Requisição de um mês (``months`` inteiro) ou de vários meses do mesmo ano.
    Com vários meses, pede os dias 01–31: o CDS ignora dias inexistentes."""
    if isinstance(months, int):
        month_list = [months]
        days = calendar.monthrange(year, months)[1]
    else:
        month_list = sorted(months)
        days = 31
    return {
        "variable": VARIABLES,
        "year": f"{year:04d}",
        "month": [f"{m:02d}" for m in month_list],
        "day": [f"{d:02d}" for d in range(1, days + 1)],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": list(bbox),
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


def make_client(settings: Settings):
    import cdsapi  # import tardio: só quem baixa precisa do pacote configurado

    return cdsapi.Client(url=settings.cds_api_url, key=settings.require_cds_key(), quiet=True)


# --- cache ------------------------------------------------------------------


def month_is_consolidated(year: int, month: int, today: date, lag_days: int = CONSOLIDATION_LAG_DAYS) -> bool:
    """O ERA5-Land publica com ~5 dias de atraso: um mês só está completo quando
    seu último dia + lag já passou. Antes disso, o arquivo em cache é parcial."""
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    return last_day + timedelta(days=lag_days) < today


def _cached(path: Path, *, consolidated: bool, today: date) -> bool:
    """Arquivo de mês fechado vale para sempre; de mês aberto, só no dia em que
    foi baixado (o semanal precisa ver os dias novos)."""
    if not (path.exists() and path.stat().st_size > 0):
        return False
    if consolidated:
        return True
    downloaded = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date()
    return downloaded >= today


def _retrieve(client, bbox: BBox, request: dict, target: Path, label: str) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".nc.part")
    log.info("CDS: %s %s area=%s", DATASET, label, bbox)
    client.retrieve(DATASET, request, str(tmp))
    tmp.replace(target)
    return target


def fetch_month(client, bbox: BBox, year: int, month: int, cache_dir: str | Path, today: date | None = None) -> Path:
    """Devolve o NetCDF do mês para a bbox, baixando só se não estiver em cache."""
    today = today or datetime.now(timezone.utc).date()
    target = cache_path(cache_dir, bbox, year, month)
    if _cached(target, consolidated=month_is_consolidated(year, month, today), today=today):
        log.info("cache: %s", target)
        return target
    return _retrieve(client, bbox, build_request(bbox, year, month), target, f"{year:04d}-{month:02d}")


def fetch_quarter(client, bbox: BBox, year: int, quarter: int, cache_dir: str | Path, today: date | None = None) -> list[Path]:
    """Trimestre inteiro: os três mensais em cache, ou o trimestral em cache,
    ou uma requisição única ao CDS gravada como ``AAAA-Qn.nc``."""
    today = today or datetime.now(timezone.utc).date()
    months = quarter_months(year, quarter)
    monthly = [cache_path(cache_dir, bbox, y, m) for y, m in months]
    if all(_cached(p, consolidated=month_is_consolidated(y, m, today), today=today) for p, (y, m) in zip(monthly, months)):
        log.info("cache mensal: %s", ", ".join(p.name for p in monthly))
        return monthly
    target = cache_path_quarter(cache_dir, bbox, year, quarter)
    consolidated = all(month_is_consolidated(y, m, today) for y, m in months)
    if _cached(target, consolidated=consolidated, today=today):
        log.info("cache: %s", target)
        return [target]
    request = build_request(bbox, year, [m for _, m in months])
    return [_retrieve(client, bbox, request, target, f"{year:04d}-Q{quarter}")]


@dataclass(frozen=True)
class Period:
    kind: str  # "month" | "quarter"
    year: int
    index: int  # mês (1–12) ou trimestre (1–4)

    def label(self) -> str:
        return f"{self.year:04d}-{self.index:02d}" if self.kind == "month" else f"{self.year:04d}-Q{self.index}"


def plan_periods(date_from: date, date_to: date, today: date | None = None) -> list[Period]:
    """Até dois meses ⇒ por mês. Mais ⇒ por trimestre, exceto o trimestre ainda
    aberto (contém mês não consolidado), que volta a ser pedido por mês para
    não gravar um trimestral parcial."""
    today = today or datetime.now(timezone.utc).date()
    months = months_covering(date_from, date_to)
    if len(months) <= MONTHLY_MAX_MONTHS:
        return [Period("month", y, m) for y, m in months]
    periods: list[Period] = []
    for y, q in quarters_covering(date_from, date_to):
        if all(month_is_consolidated(yy, mm, today) for yy, mm in quarter_months(y, q)):
            periods.append(Period("quarter", y, q))
        else:
            periods.extend(Period("month", yy, mm) for yy, mm in months if (yy, quarter_of(mm)) == (y, q))
    return periods


def fetch_range(
    client,
    bbox: BBox,
    date_from: date,
    date_to: date,
    cache_dir: str | Path,
    today: date | None = None,
    on_progress: ProgressFn | None = None,
) -> list[Path]:
    """Arquivos (mensais e/ou trimestrais) que cobrem o intervalo; chama
    ``on_progress(concluídos, total)`` após cada período obtido."""
    today = today or datetime.now(timezone.utc).date()
    periods = plan_periods(date_from, date_to, today)
    paths: list[Path] = []
    for i, period in enumerate(periods, start=1):
        if period.kind == "month":
            paths.append(fetch_month(client, bbox, period.year, period.index, cache_dir, today))
        else:
            paths.extend(fetch_quarter(client, bbox, period.year, period.index, cache_dir, today))
        if on_progress:
            on_progress(i, len(periods))
    return paths
