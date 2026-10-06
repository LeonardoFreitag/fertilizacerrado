"""Séries sintéticas determinísticas para testes e roteiros do QM (sem CDS)."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np


def synthetic_era5(years: int = 10, seed: int = 42, start: date = date(2014, 1, 1)) -> tuple[list[date], np.ndarray]:
    """Chuva diária "ERA5" do Cerrado: estação chuvosa out–abr, seca mai–set, e a
    garoa espúria típica da reanálise (muitos dias com < 0,5 mm)."""
    rng = np.random.default_rng(seed)
    dates = [start + timedelta(days=i) for i in range(int(years * 365.25))]
    out = np.zeros(len(dates))
    for i, d in enumerate(dates):
        wet_season = d.month >= 10 or d.month <= 4
        p_rain = 0.55 if wet_season else 0.08
        if rng.random() < p_rain:
            out[i] = rng.gamma(shape=0.8, scale=12.0 if wet_season else 4.0)
        elif rng.random() < 0.35:
            out[i] = rng.uniform(0.05, 0.5)
    return dates, out


def synthetic_obs(era5: np.ndarray, factor: float = 1.3, drizzle_mm: float = 0.5) -> np.ndarray:
    """Observação com viés conhecido: ERA5 × ``factor`` nos dias chuvosos; garoa
    (< ``drizzle_mm``) removida."""
    return np.where(era5 >= drizzle_mm, era5 * factor, 0.0)
