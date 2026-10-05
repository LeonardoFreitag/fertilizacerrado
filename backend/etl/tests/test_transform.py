from datetime import date
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from era5 import transform

FIXTURES = Path(__file__).parent / "fixtures"
NC = FIXTURES / "era5_synthetic.nc"
NC_EXPVER = FIXTURES / "era5_synthetic_expver.nc"
CELL = (-16.7, -49.3)
D1, D4 = date(2025, 11, 1), date(2025, 11, 4)


@pytest.fixture(scope="module")
def point():
    ds = transform.open_hourly([NC])
    sel = transform.select_cell(ds, *CELL)
    assert sel is not None and sel.distance_deg == 0
    return sel.data


@pytest.fixture(scope="module")
def daily(point):
    return transform.aggregate_daily(point, D1, D4)


def test_four_complete_days(daily):
    assert daily.incomplete_days == []
    assert list(daily.frame["time"]) == [date(2025, 11, d) for d in (1, 2, 3, 4)]
    assert list(daily.frame.columns) == transform.DAILY_COLUMNS


def test_temperatures_kelvin_to_celsius(daily):
    d1 = daily.frame.iloc[0]
    assert d1["t2m_min"] == pytest.approx(17.0, abs=1e-4)
    assert d1["t2m_max"] == pytest.approx(28.5, abs=1e-4)
    assert d1["t2m_mean"] == pytest.approx(np.mean([17.0 + 0.5 * h for h in range(24)]), abs=1e-4)
    assert d1["d2m_mean"] == pytest.approx(18.0, abs=1e-4)
    assert daily.frame.iloc[1]["t2m_max"] == pytest.approx(22.0, abs=1e-4)


def test_accumulated_from_next_midnight_not_sum_of_hours(daily, point):
    tp = daily.frame["tp_raw"].tolist()
    assert tp == pytest.approx([24.0, 0.0, 12.0, 48.0], abs=1e-3)
    # a soma das 24 horas do dia 1 seria 276 mm (0 + 1 + ... + 23): não é o total
    hours = point["tp"].sel(time=slice("2025-11-01T00", "2025-11-01T23")).values * 1000
    assert hours.sum() == pytest.approx(276.0, abs=1e-2)
    assert daily.frame["tp_corrected"].tolist() == pytest.approx(tp)
    assert not daily.frame["qm_applied"].any()


def test_net_radiation(daily):
    assert daily.frame["rn"].tolist() == pytest.approx([15.0, 12.0, 8.0, 12.0], abs=1e-4)


def test_wind_speed_then_mean_then_2m(daily):
    u2 = daily.frame["u2"].tolist()
    assert u2[0] == pytest.approx(5.0 * transform.WIND_10M_TO_2M, abs=1e-4)
    # dia 3: componentes alternam sinal (média dos componentes = 0), velocidade constante 5
    assert u2[2] == pytest.approx(5.0 * transform.WIND_10M_TO_2M, abs=1e-4)


def test_incomplete_last_day_is_omitted():
    ds = xr.open_dataset(NC).rename({"valid_time": "time"}).isel(time=slice(0, -1))  # remove 00 UTC do dia 5
    sel = transform.select_cell(ds, *CELL)
    result = transform.aggregate_daily(sel.data, D1, D4)
    assert result.incomplete_days == [D4]
    assert len(result.frame) == 3


def test_requested_day_without_data_is_incomplete(point):
    result = transform.aggregate_daily(point, D1, date(2025, 11, 6))
    assert result.incomplete_days == [date(2025, 11, 5), date(2025, 11, 6)]
    assert len(result.frame) == 4


def test_expver_slices_are_combined(daily):
    ds = transform.open_hourly([NC_EXPVER])
    assert "expver" not in ds.dims
    sel = transform.select_cell(ds, *CELL)
    result = transform.aggregate_daily(sel.data, D1, D4)
    assert result.incomplete_days == []
    for col in ("t2m_max", "tp_raw", "rn", "u2"):
        assert result.frame[col].tolist() == pytest.approx(daily.frame[col].tolist(), abs=1e-4)


def test_select_cell_tolerance():
    ds = transform.open_hourly([NC])
    assert transform.select_cell(ds, -16.7, -49.3) is not None
    assert transform.select_cell(ds, -16.72, -49.3) is not None  # 0,02° — dentro da tolerância
    assert transform.select_cell(ds, -16.9, -49.3) is None  # 0,2° — grade inesperada


def test_missing_variable_is_an_error(tmp_path):
    ds = xr.open_dataset(NC).drop_vars("str")
    path = tmp_path / "sem_str.nc"
    ds.to_netcdf(path)
    with pytest.raises(transform.TransformError, match="str"):
        transform.open_hourly([path])
