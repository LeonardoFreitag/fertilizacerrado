"""Quantile Mapping empírico da precipitação, por mês do ano, em duas etapas
(``empirical-monthly-v1``). Funções puras sobre arrays alinhados por data.

1. Frequência: o limiar do ERA5 de cada mês é o quantil ``1 − f_obs`` da série
   ERA5, onde ``f_obs`` é a fração de dias observados com chuva ``> wet_day_mm``.
   Abaixo do limiar ⇒ 0.
2. Intensidade: nos dias chuvosos de cada série, 99 quantis (1–99 %); aplicação
   por interpolação linear; acima do P99, razão do último quantil limitada a
   ``max_ratio``.

Referências: Piani et al. (2010); Themeßl et al. (2012) para a cauda.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Sequence

import numpy as np

METHOD = "empirical-monthly-v1"
QUANTILE_LEVELS = np.arange(1, 100)  # 1..99 %
MONTHS = range(1, 13)


@dataclass(frozen=True)
class QmConfig:
    wet_day_mm: float = 0.1
    max_ratio: float = 3.0
    max_distance_km: float = 50.0
    min_years: int = 10


@dataclass
class MonthCalibration:
    n_days: int
    wet_threshold_era5: float  # +inf quando o mês observado não tem chuva
    era5_quantiles: list[float]  # vazio quando não há dias chuvosos em alguma série
    obs_quantiles: list[float]


@dataclass
class Calibration:
    method: str
    wet_day_mm: float
    max_ratio: float
    period_from: date
    period_to: date
    months: dict[int, MonthCalibration] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "n_days_by_month": {m: c.n_days for m, c in self.months.items()},
            "wet_thresholds_era5": {m: (None if math.isinf(c.wet_threshold_era5) else c.wet_threshold_era5) for m, c in self.months.items()},
            "quantiles": {m: {"era5": c.era5_quantiles, "obs": c.obs_quantiles} for m, c in self.months.items()},
        }

    @classmethod
    def from_json(cls, *, method: str, wet_day_mm: float, max_ratio: float, period_from: date, period_to: date,
                  n_days_by_month: dict, wet_thresholds_era5: dict, quantiles: dict) -> "Calibration":
        months = {}
        for m in MONTHS:
            k = str(m)
            if k not in n_days_by_month:
                continue
            thr = wet_thresholds_era5.get(k)
            q = quantiles.get(k, {"era5": [], "obs": []})
            months[m] = MonthCalibration(int(n_days_by_month[k]), math.inf if thr is None else float(thr), list(q["era5"]), list(q["obs"]))
        return cls(method, wet_day_mm, max_ratio, period_from, period_to, months)


# --- utilidades --------------------------------------------------------------


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def valid_overlap(era5: np.ndarray, obs: np.ndarray) -> np.ndarray:
    """Máscara dos dias com os dois valores presentes."""
    return ~(np.isnan(era5) | np.isnan(obs))


DAYS_PER_YEAR = 365.0  # 10 anos civis completos (3.652 dias) contam como ≥ 10


def overlap_years(dates: Sequence[date], mask: np.ndarray) -> float:
    """Anos de sobreposição válida (dias válidos / 365)."""
    return float(np.count_nonzero(mask)) / DAYS_PER_YEAR


def wet_fraction(values: np.ndarray, threshold: float) -> float:
    if values.size == 0:
        return 0.0
    return float(np.count_nonzero(values > threshold)) / values.size


# --- calibração ---------------------------------------------------------------


def calibrate_month(era5: np.ndarray, obs: np.ndarray, cfg: QmConfig) -> MonthCalibration:
    """``era5`` e ``obs`` já alinhados e sem NaN, de um único mês do ano."""
    n = int(era5.size)
    if n == 0:
        return MonthCalibration(0, math.inf, [], [])
    f_obs = wet_fraction(obs, cfg.wet_day_mm)
    if f_obs == 0.0:
        return MonthCalibration(n, math.inf, [], [])
    # limiar tal que a fração de dias ERA5 acima dele iguale f_obs
    threshold = float(np.percentile(era5, 100.0 * (1.0 - f_obs), method="linear"))
    era5_wet = era5[era5 > threshold]
    obs_wet = obs[obs > cfg.wet_day_mm]
    if era5_wet.size == 0 or obs_wet.size == 0:
        return MonthCalibration(n, threshold, [], [])
    q_era5 = np.percentile(era5_wet, QUANTILE_LEVELS, method="linear")
    q_obs = np.percentile(obs_wet, QUANTILE_LEVELS, method="linear")
    return MonthCalibration(n, threshold, [float(v) for v in q_era5], [float(v) for v in q_obs])


def calibrate(dates: Sequence[date], era5: Sequence[float], obs: Sequence[float], cfg: QmConfig) -> Calibration:
    """Calibra todos os meses sobre os dias de sobreposição válida."""
    d = list(dates)
    e = np.asarray(era5, dtype=float)
    o = np.asarray(obs, dtype=float)
    if not (len(d) == e.size == o.size):
        raise ValueError("dates, era5 e obs devem ter o mesmo tamanho")
    mask = valid_overlap(e, o)
    months_of = np.asarray([x.month for x in d])
    cal = Calibration(METHOD, cfg.wet_day_mm, cfg.max_ratio, min(d), max(d))
    for m in MONTHS:
        sel = mask & (months_of == m)
        cal.months[m] = calibrate_month(e[sel], o[sel], cfg)
    return cal


# --- aplicação ----------------------------------------------------------------


def apply_month(values: np.ndarray, month: MonthCalibration, max_ratio: float) -> np.ndarray:
    out = np.zeros_like(values, dtype=float)
    if math.isinf(month.wet_threshold_era5):
        return out  # mês sem chuva observada: tudo zero
    wet = values > month.wet_threshold_era5
    if not month.era5_quantiles:
        out[wet] = values[wet]  # sem mapeamento: identidade acima do limiar
        return out
    qe = np.asarray(month.era5_quantiles)
    qo = np.asarray(month.obs_quantiles)
    v = values[wet]
    # interpolação linear entre quantis; abaixo do P1, escala linear de 0 ao P1
    mapped = np.interp(v, qe, qo, left=np.nan, right=np.nan)
    below = v < qe[0]
    if qe[0] > 0:
        mapped[below] = v[below] * (qo[0] / qe[0])
    else:
        mapped[below] = qo[0]
    above = v > qe[-1]
    ratio = min(qo[-1] / qe[-1], max_ratio) if qe[-1] > 0 else 1.0
    mapped[above] = v[above] * ratio
    out[wet] = np.maximum(mapped, 0.0)
    return out


def apply(calibration: Calibration, dates: Sequence[date], values: Sequence[float]) -> np.ndarray:
    """``tp_corrected`` para cada dia; NaN permanece NaN."""
    d = list(dates)
    v = np.asarray(values, dtype=float)
    out = np.full(v.shape, np.nan)
    months_of = np.asarray([x.month for x in d])
    for m, cal in calibration.months.items():
        sel = (months_of == m) & ~np.isnan(v)
        if np.any(sel):
            out[sel] = apply_month(v[sel], cal, calibration.max_ratio)
    return out


# --- pareamento ---------------------------------------------------------------


@dataclass(frozen=True)
class StationCandidate:
    code: str
    name: str
    lat: float
    lon: float


@dataclass(frozen=True)
class Pairing:
    station: StationCandidate
    distance_km: float
    years: float


def pair_station(
    cell: tuple[float, float],
    stations: Sequence[StationCandidate],
    overlap_years_of: "callable",
    cfg: QmConfig,
) -> tuple[Pairing | None, list[str]]:
    """Estação ativa mais próxima dentro de ``max_distance_km`` com ao menos
    ``min_years`` de sobreposição válida. Devolve (pareamento | None, avisos)."""
    warnings: list[str] = []
    ranked = sorted(((haversine_km(cell[0], cell[1], s.lat, s.lon), s) for s in stations), key=lambda t: t[0])
    for dist, s in ranked:
        if dist > cfg.max_distance_km:
            warnings.append(f"estação {s.code} a {dist:.1f} km (> {cfg.max_distance_km:g} km)")
            break  # as seguintes estão ainda mais longe
        years = float(overlap_years_of(s))
        if years < cfg.min_years:
            warnings.append(f"estação {s.code} a {dist:.1f} km com {years:.1f} ano(s) de sobreposição (< {cfg.min_years})")
            continue
        return Pairing(s, dist, years), warnings
    if not ranked:
        warnings.append("nenhuma estação ativa cadastrada")
    return None, warnings


# --- métricas (Caso 4) ----------------------------------------------------------


def rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2))) if a.size else float("nan")


def pbias(sim: np.ndarray, obs: np.ndarray) -> float:
    """Viés percentual: 100 · Σ(sim − obs) / Σ obs."""
    total = float(np.sum(obs))
    return float(100.0 * np.sum(sim - obs) / total) if total > 0 else float("nan")
