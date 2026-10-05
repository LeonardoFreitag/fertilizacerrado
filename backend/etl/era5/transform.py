"""Etapa 2 — horário → diário com as convenções do ERA5-Land.

* ``tp``, ``ssr`` e ``str`` são ACUMULADOS desde 00 UTC do dia: o total do dia
  D é o valor do passo 00 UTC do dia D+1, não a soma das 24 horas.
* Temperaturas em K → °C.
* Vento: velocidade horária sqrt(u² + v²), média diária, × 0,748 (10 m → 2 m,
  FAO-56 Eq. 47 — o mesmo fator de ``engine/et0.ts``).
* ``rn = (ssr + str) / 1e6`` em MJ/m²/dia (``str`` é negativo).
* Dia definido em UTC (conversão para o dia local está em aberto).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd
import xarray as xr

KELVIN = 273.15
WIND_10M_TO_2M = 0.748  # FAO-56 Eq. 47, z = 10 m
HOURS_PER_DAY = 24
NEAREST_TOLERANCE_DEG = 0.05

INSTANT_VARS = ("t2m", "d2m", "u10", "v10")
ACCUM_VARS = ("tp", "ssr", "str")
ALL_VARS = INSTANT_VARS + ACCUM_VARS

DAILY_COLUMNS = [
    "time", "t2m_max", "t2m_min", "t2m_mean", "d2m_mean", "u2", "rn",
    "tp_raw", "tp_corrected", "qm_applied",
]


class TransformError(ValueError):
    pass


def open_hourly(paths: Sequence[str | Path]) -> xr.Dataset:
    """Abre e concatena os NetCDF mensais, normalizando a coordenada de tempo
    para ``time`` e combinando a dimensão ``expver`` (ERA5T) quando presente."""
    if not paths:
        raise TransformError("nenhum arquivo NetCDF")
    datasets = [_normalize(xr.open_dataset(p)) for p in paths]
    ds = datasets[0] if len(datasets) == 1 else xr.concat(datasets, dim="time")
    ds = ds.sortby("time")
    # passos repetidos entre meses (não deveriam ocorrer) ficam com a última ocorrência
    _, index = np.unique(ds["time"].values, return_index=True)
    if len(index) != ds.sizes["time"]:
        ds = ds.isel(time=np.sort(index))
    missing = [v for v in ALL_VARS if v not in ds.data_vars]
    if missing:
        raise TransformError(f"variáveis ausentes no NetCDF: {', '.join(missing)}")
    return ds


def _normalize(ds: xr.Dataset) -> xr.Dataset:
    if "valid_time" in ds.dims or "valid_time" in ds.coords:
        ds = ds.rename({"valid_time": "time"})
    if "expver" in ds.dims:
        # ERA5 (final) e ERA5T ocupam fatias complementares: cada passo tem
        # valor em exatamente uma delas.
        ds = ds.reduce(np.nansum, dim="expver", keep_attrs=True).where(
            ds.notnull().any(dim="expver")
        )
    elif "expver" in ds.coords:
        ds = ds.drop_vars("expver")
    return ds


@dataclass(frozen=True)
class CellSelection:
    lat: float
    lon: float
    distance_deg: float
    data: xr.Dataset


def select_cell(ds: xr.Dataset, lat: float, lon: float, tolerance: float = NEAREST_TOLERANCE_DEG) -> CellSelection | None:
    """Ponto da grade mais próximo da célula; ``None`` se estiver a mais de
    ``tolerance`` graus (grade inesperada)."""
    point = ds.sel(latitude=lat, longitude=lon, method="nearest")
    got_lat = float(point["latitude"])
    got_lon = float(point["longitude"])
    distance = max(abs(got_lat - lat), abs(got_lon - lon))
    if distance > tolerance:
        return None
    return CellSelection(lat=lat, lon=lon, distance_deg=distance, data=point)


@dataclass
class DailyResult:
    frame: pd.DataFrame
    incomplete_days: list[date]


def aggregate_daily(point: xr.Dataset, date_from: date, date_to: date) -> DailyResult:
    """Um registro por dia UTC em ``[date_from, date_to]`` para um ponto da grade."""
    frame = point[list(ALL_VARS)].to_dataframe()[list(ALL_VARS)]
    frame.index = pd.to_datetime(frame.index.get_level_values("time")) if isinstance(frame.index, pd.MultiIndex) else pd.to_datetime(frame.index)
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()

    rows: list[dict] = []
    incomplete: list[date] = []
    day = date_from
    while day <= date_to:
        start = pd.Timestamp(day)
        next_midnight = start + pd.Timedelta(days=1)
        hours = frame.loc[start : next_midnight - pd.Timedelta(hours=1)]
        has_instant = len(hours) == HOURS_PER_DAY and not hours[list(INSTANT_VARS)].isna().any().any()
        has_accum = next_midnight in frame.index and not frame.loc[next_midnight, list(ACCUM_VARS)].isna().any()
        if not (has_instant and has_accum):
            incomplete.append(day)
            day += timedelta(days=1)
            continue

        accum = frame.loc[next_midnight]
        t2m = hours["t2m"] - KELVIN
        speed = np.hypot(hours["u10"], hours["v10"])
        tp_mm = float(accum["tp"]) * 1000.0
        rows.append(
            {
                "time": day,
                "t2m_max": float(t2m.max()),
                "t2m_min": float(t2m.min()),
                "t2m_mean": float(t2m.mean()),
                "d2m_mean": float((hours["d2m"] - KELVIN).mean()),
                "u2": float(speed.mean()) * WIND_10M_TO_2M,
                "rn": (float(accum["ssr"]) + float(accum["str"])) / 1e6,
                "tp_raw": tp_mm,
                "tp_corrected": tp_mm,  # sem Quantile Mapping nesta versão
                "qm_applied": False,
            }
        )
        day += timedelta(days=1)

    return DailyResult(frame=pd.DataFrame(rows, columns=DAILY_COLUMNS), incomplete_days=incomplete)
