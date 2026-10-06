"""Operações de calibração/aplicação do QM sobre o banco (CLI e worker)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

import numpy as np

from . import db
from .config import Settings
from . import qm
from .qm import Calibration, Pairing, QmConfig, StationCandidate, apply, calibrate, haversine_km, pair_station, pbias, rmse, valid_overlap, wet_fraction

log = logging.getLogger("era5.qm")

Cell = tuple[float, float]


def qm_config(settings: Settings) -> QmConfig:
    return QmConfig(settings.qm_wet_day_mm, settings.qm_max_ratio, settings.qm_max_distance_km, settings.qm_min_years)


def calibration_from_row(row: dict) -> Calibration:
    return Calibration.from_json(
        method=row["method"], wet_day_mm=float(row["wet_day_threshold_obs"]), max_ratio=float(row["max_ratio"]),
        period_from=row["period_from"], period_to=row["period_to"],
        n_days_by_month=row["n_days_by_month"], wet_thresholds_era5=row["wet_thresholds_era5"], quantiles=row["quantiles"],
    )


def _aligned(era5: dict[date, float], obs: dict[date, float | None]) -> tuple[list[date], np.ndarray, np.ndarray]:
    dates = sorted(set(era5) | set(obs))
    e = np.array([era5.get(d, np.nan) for d in dates], dtype=float)
    o = np.array([np.nan if obs.get(d) is None else obs[d] for d in dates], dtype=float)
    return dates, e, o


def overlap_years_for(conn, cell: Cell, code: str, date_from: date | None, date_to: date | None) -> float:
    era5 = db.cell_raw_series(conn, cell, date_from, date_to)
    obs = db.station_obs_series(conn, code, date_from, date_to)
    _, e, o = _aligned(era5, obs)
    return float(np.count_nonzero(valid_overlap(e, o))) / qm.DAYS_PER_YEAR


@dataclass
class CalibrateResult:
    cell: Cell
    calibration_id: str | None
    station_code: str | None
    distance_km: float | None
    years: float | None
    rows_applied: int = 0
    warnings: list[str] = field(default_factory=list)


def calibrate_cell(conn, settings: Settings, cell: Cell, station_code: str | None, date_from: date | None, date_to: date | None, do_apply: bool = True) -> CalibrateResult:
    """Calibra a célula contra a estação informada ou a mais próxima elegível; aplica em seguida."""
    cfg = qm_config(settings)
    candidates = [StationCandidate(s["code"], s["name"], float(s["lat"]), float(s["lon"])) for s in db.active_stations(conn)]
    pairing: Pairing | None = None
    warnings: list[str] = []
    if station_code:
        st = next((s for s in candidates if s.code == station_code), None)
        if st is None:
            raise ValueError(f"estação {station_code} não cadastrada ou inativa")
        dist = haversine_km(cell[0], cell[1], st.lat, st.lon)
        years = overlap_years_for(conn, cell, st.code, date_from, date_to)
        if years < cfg.min_years:
            warnings.append(f"estação {st.code} com {years:.1f} ano(s) de sobreposição (< {cfg.min_years})")
        else:
            pairing = Pairing(st, dist, years)
    else:
        pairing, warnings = pair_station(cell, candidates, lambda s: overlap_years_for(conn, cell, s.code, date_from, date_to), cfg)
    if pairing is None:
        return CalibrateResult(cell, None, None, None, None, 0, warnings or ["sem estação elegível"])

    era5 = db.cell_raw_series(conn, cell, date_from, date_to)
    obs = db.station_obs_series(conn, pairing.station.code, date_from, date_to)
    dates, e, o = _aligned(era5, obs)
    mask = valid_overlap(e, o)
    cal = calibrate([d for d, m in zip(dates, mask) if m], e[mask], o[mask], cfg)
    for m, mc in cal.months.items():
        wet_obs = int(np.count_nonzero(o[mask][np.asarray([d.month for d, k in zip(dates, mask) if k]) == m] > cfg.wet_day_mm)) if mc.n_days else 0
        if 0 < wet_obs < 30:
            warnings.append(f"mês {m:02d}: só {wet_obs} dia(s) chuvoso(s) observado(s) — quantis instáveis")
    cal_id = db.save_calibration(conn, cell, pairing.station.code, cal, pairing.distance_km)
    log.info("célula %s calibrada com %s (%.1f km, %.1f anos): %s", cell, pairing.station.code, pairing.distance_km, pairing.years, cal_id)
    applied = apply_cell(conn, cell) if do_apply else 0
    return CalibrateResult(cell, cal_id, pairing.station.code, pairing.distance_km, pairing.years, applied, warnings)


def calibrate_auto(conn, settings: Settings, date_from: date | None, date_to: date | None, on_progress: Callable[[int, int], None] | None = None) -> list[CalibrateResult]:
    results = []
    cells = db.distinct_cells(conn)
    for i, cell in enumerate(cells, start=1):
        results.append(calibrate_cell(conn, settings, cell, None, date_from, date_to))
        if on_progress:
            on_progress(i, len(cells))
    return results


def apply_cell(conn, cell: Cell) -> int:
    """Reaplica a calibração ativa (ou remove a correção se não houver) a partir de tp_raw."""
    row = db.active_calibration(conn, cell)
    raw = db.cell_raw_series(conn, cell)
    if not raw:
        return 0
    dates = sorted(raw)
    values = np.array([raw[d] for d in dates], dtype=float)
    if row is None:
        return db.update_corrected(conn, cell, zip(dates, values), None)
    cal = calibration_from_row(row)
    corrected = apply(cal, dates, values)
    return db.update_corrected(conn, cell, zip(dates, corrected), str(row["id"]))


def apply_all(conn, on_progress: Callable[[int, int], None] | None = None) -> dict[Cell, int]:
    out = {}
    cells = db.distinct_cells(conn)
    for i, cell in enumerate(cells, start=1):
        out[cell] = apply_cell(conn, cell)
        if on_progress:
            on_progress(i, len(cells))
    return out


def correct_values(conn, cell: Cell, dates: list[date], tp_raw: list[float]) -> tuple[list[float], bool, str | None]:
    """Para a carga: devolve (tp_corrected, qm_applied, calibration_id) da calibração ativa."""
    row = db.active_calibration(conn, cell)
    if row is None:
        return list(tp_raw), False, None
    cal = calibration_from_row(row)
    corrected = apply(cal, dates, np.asarray(tp_raw, dtype=float))
    return [float(v) for v in corrected], True, str(row["id"])


# --- validação (Caso 4) --------------------------------------------------------


def _years_range(text: str) -> tuple[int, int]:
    a, _, b = text.partition("-")
    return int(a), int(b or a)


@dataclass
class ValidationRow:
    label: str  # "01".."12" ou "total"
    n_days: int
    rmse_raw: float
    rmse_corr: float
    pbias_raw: float
    pbias_corr: float
    wet_obs: float
    wet_raw: float
    wet_corr: float


def validate(conn, settings: Settings, cell: Cell, station_code: str, calib_years: str, test_years: str) -> list[ValidationRow]:
    cfg = qm_config(settings)
    ca, cb = _years_range(calib_years)
    ta, tb = _years_range(test_years)
    era5 = db.cell_raw_series(conn, cell)
    obs = db.station_obs_series(conn, station_code)
    dates, e, o = _aligned(era5, obs)
    mask = valid_overlap(e, o)
    years = np.asarray([d.year for d in dates])
    cal_sel = mask & (years >= ca) & (years <= cb)
    test_sel = mask & (years >= ta) & (years <= tb)
    if not np.any(cal_sel) or not np.any(test_sel):
        raise ValueError("sem dias válidos no período de calibração ou de teste")
    cal = calibrate([d for d, k in zip(dates, cal_sel) if k], e[cal_sel], o[cal_sel], cfg)
    test_dates = [d for d, k in zip(dates, test_sel) if k]
    raw = e[test_sel]
    corr = apply(cal, test_dates, raw)
    target = o[test_sel]
    months = np.asarray([d.month for d in test_dates])
    rows = []
    for m in list(range(1, 13)) + [0]:
        sel = months == m if m else np.ones(len(test_dates), dtype=bool)
        if not np.any(sel):
            continue
        rows.append(ValidationRow(
            "total" if m == 0 else f"{m:02d}", int(np.count_nonzero(sel)),
            rmse(raw[sel], target[sel]), rmse(corr[sel], target[sel]),
            pbias(raw[sel], target[sel]), pbias(corr[sel], target[sel]),
            wet_fraction(target[sel], cfg.wet_day_mm), wet_fraction(raw[sel], cfg.wet_day_mm), wet_fraction(corr[sel], cfg.wet_day_mm),
        ))
    return rows
