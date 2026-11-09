"""Etapa 1 — download no CDS (API nova) com cache em ``ETL_CACHE_DIR``.

Toda requisição cobre **um mês civil** de uma bounding box (``AAAA-MM.nc``):
o CDS limita o *custo* de uma requisição (variáveis × horas × dias) e desde
2026-11 recusa três meses das sete variáveis horárias (``cost limits
exceeded``). Se mesmo um mês for recusado por custo, ``fetch_month`` divide a
requisição em dois grupos de variáveis e une os NetCDF num único arquivo
mensal — cache, transformação e carga não distinguem um mês dividido de um
mês inteiro. Vários meses são obtidos em paralelo (``ERA5_CDS_MAX_CONCURRENT``).

Escrita atômica: todo arquivo nasce como ``*.part`` no mesmo diretório e só é
renomeado para ``AAAA-MM.nc`` quando completo; ``_cached`` só enxerga o nome
final, então um download interrompido nunca vale como cache.
"""

from __future__ import annotations

import calendar
import hashlib
import logging
import threading
from concurrent.futures import FIRST_EXCEPTION, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .config import DATASET, Settings

log = logging.getLogger(__name__)

GRID = 0.1
MARGIN = 0.1
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

# Fallback quando o CDS recusa um mês inteiro por custo: térmicas/vento × radiação/precipitação.
VARIABLE_GROUPS: list[list[str]] = [VARIABLES[:4], VARIABLES[4:]]

# Fragmentos (minúsculos) da mensagem do CDS que identificam recusa por custo.
COST_ERROR_MARKERS = ("cost limits exceeded", "request is too large")

# A biblioteca HDF5/netCDF4 não é thread-safe: toda leitura/escrita de NetCDF
# feita pelas threads de download (união dos grupos) passa por este lock.
NETCDF_LOCK = threading.Lock()

BBox = tuple[float, float, float, float]  # (north, west, south, east) — ordem do CDS
YearMonth = tuple[int, int]
ProgressFn = Callable[[int, int], None]  # (meses concluídos, total)


class CdsCostError(RuntimeError):
    """O CDS recusou um mês por custo mesmo dividido por grupos de variáveis."""


def is_cost_error(exc: BaseException) -> bool:
    """O ``cdsapi`` relança os erros HTTP do CDS com a mensagem do serviço no
    texto da exceção; a recusa por custo é reconhecida pelo texto, qualquer
    que seja a classe."""
    text = str(exc).lower()
    return any(marker in text for marker in COST_ERROR_MARKERS)


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


def _bbox_dir(cache_dir: str | Path, bbox: BBox) -> Path:
    key = hashlib.sha1(",".join(f"{v:.1f}" for v in bbox).encode()).hexdigest()[:12]
    return Path(cache_dir) / f"bbox-{key}"


def cache_path(cache_dir: str | Path, bbox: BBox, year: int, month: int) -> Path:
    return _bbox_dir(cache_dir, bbox) / f"{year:04d}-{month:02d}.nc"


def build_request(bbox: BBox, year: int, month: int, variables: list[str] = VARIABLES) -> dict:
    """Requisição de um único mês (dias reais do mês, 24 horas)."""
    days = calendar.monthrange(year, month)[1]
    return {
        "variable": list(variables),
        "year": f"{year:04d}",
        "month": [f"{month:02d}"],
        "day": [f"{d:02d}" for d in range(1, days + 1)],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": list(bbox),
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


class LazyCdsClient:
    """Cliente do CDS criado só no primeiro ``retrieve``: o ``cdsapi.Client`` consulta
    o CDS já na construção (mensagens do catálogo) e, com o serviço inacessível,
    travaria até uma ingestão inteiramente servida pelo cache. Criação protegida
    por lock: ``fetch_range`` chama ``retrieve`` de várias threads."""

    def __init__(self, settings: Settings):
        self._url = settings.cds_api_url
        self._key = settings.require_cds_key()  # a chave continua exigida antes de começar
        self._client = None
        self._lock = threading.Lock()

    def retrieve(self, dataset: str, request: dict, target: str):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    import cdsapi  # import tardio: só quem baixa precisa do pacote configurado

                    self._client = cdsapi.Client(url=self._url, key=self._key, quiet=True)
        return self._client.retrieve(dataset, request, target)


def make_client(settings: Settings) -> LazyCdsClient:
    return LazyCdsClient(settings)


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
    """Baixa para ``<target>.part`` e renomeia ao final (atômico no mesmo diretório)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    log.info("CDS: %s %s area=%s variáveis=%d", DATASET, label, bbox, len(request["variable"]))
    client.retrieve(DATASET, request, str(tmp))
    tmp.replace(target)
    return target


def _merge_groups(parts: list[Path], target: Path) -> Path:
    """Une os NetCDF dos grupos de variáveis (mesmas coordenadas, variáveis
    disjuntas) num único arquivo mensal, via temporário no mesmo diretório."""
    import xarray as xr

    from .transform import normalize  # mesma normalização do transform (expver, valid_time)

    tmp = target.with_name(target.name.removesuffix(".nc") + ".merge.part")
    with NETCDF_LOCK:
        datasets = [normalize(xr.open_dataset(p)) for p in parts]
        try:
            merged = xr.merge(datasets, compat="no_conflicts", join="exact")
            merged.to_netcdf(tmp)
        finally:
            for ds in datasets:
                ds.close()
    tmp.replace(target)
    for p in parts:
        p.unlink(missing_ok=True)
    return target


def _cost_error(label: str, bbox: BBox, exc: BaseException) -> CdsCostError:
    return CdsCostError(
        f"CDS recusou a requisição de {label} para a bbox {bbox} mesmo dividida por "
        f"variáveis (custo acima do limite do serviço). Reduza a área (menos talhões por "
        f"backfill) ou aguarde a revisão dos limites do CDS. Mensagem do CDS: {exc}"
    )


def fetch_month(client, bbox: BBox, year: int, month: int, cache_dir: str | Path, today: date | None = None) -> Path:
    """Devolve o NetCDF do mês para a bbox, baixando só se não estiver em cache.
    Recusa por custo ⇒ duas requisições por grupo de variáveis unidas em um só
    ``AAAA-MM.nc``; segunda recusa ⇒ ``CdsCostError``."""
    today = today or datetime.now(timezone.utc).date()
    target = cache_path(cache_dir, bbox, year, month)
    label = f"{year:04d}-{month:02d}"
    if _cached(target, consolidated=month_is_consolidated(year, month, today), today=today):
        log.info("cache: %s", target)
        return target
    try:
        return _retrieve(client, bbox, build_request(bbox, year, month), target, label)
    except Exception as exc:  # noqa: BLE001 — só a recusa por custo tem tratamento; o resto propaga
        if not is_cost_error(exc):
            raise
        log.warning("CDS recusou %s por custo (%s); dividindo em %d grupos de variáveis", label, exc, len(VARIABLE_GROUPS))
    parts: list[Path] = []
    for i, group in enumerate(VARIABLE_GROUPS, start=1):
        part = target.with_name(f"{label}.g{i}.nc.part")
        # _retrieve grava em "<part>.part" e renomeia para `part`
        try:
            parts.append(_retrieve(client, bbox, build_request(bbox, year, month, group), part, f"{label} grupo {i}/{len(VARIABLE_GROUPS)}"))
        except Exception as exc:  # noqa: BLE001
            for p in parts:
                p.unlink(missing_ok=True)
            if is_cost_error(exc):
                raise _cost_error(label, bbox, exc) from exc
            raise
    log.info("CDS: %s unido a partir de %d grupos de variáveis", label, len(parts))
    return _merge_groups(parts, target)


@dataclass(frozen=True)
class Period:
    year: int
    month: int

    def label(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


def plan_periods(date_from: date, date_to: date) -> list[Period]:
    """Um período por mês civil de ``[date_from, date_to + 1 dia]``."""
    return [Period(y, m) for y, m in months_covering(date_from, date_to)]


def fetch_range(
    client,
    bbox: BBox,
    date_from: date,
    date_to: date,
    cache_dir: str | Path,
    today: date | None = None,
    on_progress: ProgressFn | None = None,
    max_concurrent: int = 1,
) -> list[Path]:
    """Arquivos mensais que cobrem o intervalo, em ordem cronológica, obtidos
    com até ``max_concurrent`` requisições simultâneas ao CDS. Chama
    ``on_progress(concluídos, total)`` após cada mês, **na thread chamadora**
    (o heartbeat da run usa a conexão do chamador). A primeira falha cancela
    os meses ainda não iniciados e é propagada."""
    today = today or datetime.now(timezone.utc).date()
    if max_concurrent < 1:
        raise ValueError("max_concurrent deve ser ≥ 1")
    periods = plan_periods(date_from, date_to)
    total = len(periods)
    results: dict[Period, Path] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=max_concurrent, thread_name_prefix="cds") as pool:
        pending: dict[Future, Period] = {
            pool.submit(fetch_month, client, bbox, p.year, p.month, cache_dir, today): p for p in periods
        }
        try:
            while pending:
                finished, _ = wait(pending, return_when=FIRST_EXCEPTION)
                for fut in finished:
                    period = pending.pop(fut)
                    results[period] = fut.result()  # relança a primeira exceção
                    done += 1
                    if on_progress:
                        on_progress(done, total)
        except BaseException:
            for fut in pending:
                fut.cancel()
            pool.shutdown(wait=True, cancel_futures=True)
            raise
    return [results[p] for p in periods]
