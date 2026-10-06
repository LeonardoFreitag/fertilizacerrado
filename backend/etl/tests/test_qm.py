"""Quantile Mapping com estação sintética de viés conhecido (sem banco, sem CDS)."""

from datetime import date, timedelta

import numpy as np
import pytest

from era5 import qm
from era5.qm import Calibration, QmConfig, StationCandidate, apply, calibrate, pair_station, pbias, wet_fraction
from era5.synthetic import synthetic_era5, synthetic_obs

CFG = QmConfig()


@pytest.fixture(scope="module")
def series():
    dates, era5 = synthetic_era5()
    return dates, era5, synthetic_obs(era5)


def test_bias_recovered(series):
    dates, era5, obs = series
    cal = calibrate(dates, era5, obs, CFG)
    corrected = apply(cal, dates, era5)
    assert cal.method == qm.METHOD
    assert abs(pbias(era5, obs)) > 15  # viés bruto relevante (garoa + 1,3×)
    assert abs(pbias(corrected, obs)) < 2.0
    f_obs = wet_fraction(obs, CFG.wet_day_mm)
    f_cor = wet_fraction(corrected, CFG.wet_day_mm)
    assert abs(f_cor - f_obs) < 0.01  # ±1 p.p.
    # por mês, a fração também é recuperada
    months = np.asarray([d.month for d in dates])
    for m in range(1, 13):
        sel = months == m
        assert abs(wet_fraction(corrected[sel], CFG.wet_day_mm) - wet_fraction(obs[sel], CFG.wet_day_mm)) < 0.02


def test_apply_is_idempotent_from_raw(series):
    dates, era5, obs = series
    cal = calibrate(dates, era5, obs, CFG)
    a = apply(cal, dates, era5)
    b = apply(cal, dates, era5)
    np.testing.assert_array_equal(a, b)


def test_round_trip_json(series):
    dates, era5, obs = series
    cal = calibrate(dates, era5, obs, CFG)
    j = cal.to_json()
    back = Calibration.from_json(
        method=cal.method, wet_day_mm=cal.wet_day_mm, max_ratio=cal.max_ratio, period_from=cal.period_from, period_to=cal.period_to,
        n_days_by_month={str(k): v for k, v in j["n_days_by_month"].items()},
        wet_thresholds_era5={str(k): v for k, v in j["wet_thresholds_era5"].items()},
        quantiles={str(k): v for k, v in j["quantiles"].items()},
    )
    np.testing.assert_allclose(apply(back, dates, era5), apply(cal, dates, era5))


def test_dry_month_zeroes_everything():
    dates = [date(2020, 6, 1) + timedelta(days=i) for i in range(30 * 5)]
    era5 = np.full(len(dates), 2.0)  # ERA5 chove todo dia em junho…
    obs = np.zeros(len(dates))  # …mas a estação nunca registra
    cal = calibrate(dates, era5, obs, CFG)
    assert cal.months[6].wet_threshold_era5 == float("inf")
    assert np.all(apply(cal, dates, era5) == 0.0)


def test_tail_ratio_is_capped():
    rng = np.random.default_rng(1)
    dates = [date(2010, 1, 1) + timedelta(days=i) for i in range(365 * 10)]
    era5 = rng.gamma(1.0, 5.0, len(dates))
    obs = era5 * 4.0  # razão 4 em toda a distribuição
    cal = calibrate(dates, era5, obs, QmConfig(max_ratio=3.0))
    extreme = np.array([1000.0])
    out = apply(cal, [date(2010, 1, 15)], extreme)
    assert out[0] == pytest.approx(3000.0)  # limitado a 3×, não 4×


def test_nan_days_are_ignored_in_calibration_and_kept_in_apply(series):
    dates, era5, obs = series
    obs2 = obs.copy()
    obs2[:200] = np.nan
    cal = calibrate(dates, era5, obs2, CFG)
    assert sum(c.n_days for c in cal.months.values()) == len(dates) - 200
    era5_nan = era5.copy()
    era5_nan[5] = np.nan
    out = apply(cal, dates, era5_nan)
    assert np.isnan(out[5]) and not np.isnan(out[6])


def test_pairing_distance_and_years():
    cell = (-16.7, -49.3)
    near = StationCandidate("A", "Perto", -16.62, -49.25, )  # ~10 km
    far = StationCandidate("B", "Longe", -16.0, -49.3)  # ~78 km
    years = {"A": 12.0, "B": 20.0}
    pairing, warns = pair_station(cell, [far, near], lambda s: years[s.code], CFG)
    assert pairing is not None and pairing.station.code == "A"
    assert 9 < pairing.distance_km < 11
    # perto mas com poucos anos ⇒ inelegível; a distante não conta
    years["A"] = 3.0
    pairing, warns = pair_station(cell, [near, far], lambda s: years[s.code], CFG)
    assert pairing is None
    assert any("3.0 ano" in w for w in warns) and any("km (>" in w for w in warns)
    assert pair_station(cell, [], lambda s: 0, CFG)[0] is None


def test_haversine_goiania():
    assert qm.haversine_km(-16.7, -49.3, -16.7, -49.2) == pytest.approx(10.65, abs=0.1)
