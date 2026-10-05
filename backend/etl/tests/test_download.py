from datetime import date
from pathlib import Path

import pytest

from era5 import download


def test_grid_bbox_with_margin():
    bbox = download.grid_bbox([(-16.7, -49.3), (-16.2, -48.8)])
    assert bbox == (-16.1, -49.4, -16.8, -48.7)  # N, W, S, E


def test_grid_bbox_single_cell():
    assert download.grid_bbox([(-16.7, -49.3)]) == (-16.6, -49.4, -16.8, -49.2)


def test_grid_bbox_requires_cells():
    with pytest.raises(ValueError):
        download.grid_bbox([])


def test_months_covering_includes_next_month_for_last_day():
    assert download.months_covering(date(2025, 11, 1), date(2025, 11, 30)) == [(2025, 11), (2025, 12)]
    assert download.months_covering(date(2025, 11, 5), date(2025, 11, 20)) == [(2025, 11)]
    assert download.months_covering(date(2025, 12, 20), date(2026, 1, 3)) == [(2025, 12), (2026, 1)]


def test_months_covering_rejects_inverted_range():
    with pytest.raises(ValueError):
        download.months_covering(date(2025, 11, 2), date(2025, 11, 1))


def test_cache_path_depends_on_bbox_and_month(tmp_path):
    a = download.cache_path(tmp_path, (-16.1, -49.4, -16.8, -48.7), 2025, 11)
    b = download.cache_path(tmp_path, (-16.1, -49.4, -16.8, -48.7), 2025, 12)
    c = download.cache_path(tmp_path, (-16.0, -49.4, -16.8, -48.7), 2025, 11)
    assert a.parent == b.parent and a != b
    assert a.parent != c.parent
    assert a.name == "2025-11.nc"


def test_build_request_new_api_fields():
    req = download.build_request((-16.1, -49.4, -16.8, -48.7), 2025, 11)
    assert req["data_format"] == "netcdf" and req["download_format"] == "unarchived"
    assert req["area"] == [-16.1, -49.4, -16.8, -48.7]
    assert len(req["day"]) == 30 and len(req["time"]) == 24
    assert "surface_net_thermal_radiation" in req["variable"]
    assert "surface_solar_radiation_downwards" not in req["variable"]


class FakeClient:
    def __init__(self):
        self.calls = 0

    def retrieve(self, dataset, request, target):
        self.calls += 1
        Path(target).write_bytes(b"netcdf")


def test_fetch_month_uses_cache(tmp_path):
    client = FakeClient()
    bbox = (-16.1, -49.4, -16.8, -48.7)
    first = download.fetch_month(client, bbox, 2025, 11, tmp_path)
    second = download.fetch_month(client, bbox, 2025, 11, tmp_path)
    assert first == second and first.exists()
    assert client.calls == 1


# --- trimestres ---------------------------------------------------------------

TODAY = date(2026, 10, 5)
BBOX = (-16.6, -49.4, -16.8, -49.2)


def test_quarters_covering():
    assert download.quarters_covering(date(2025, 11, 1), date(2026, 3, 29)) == [(2025, 4), (2026, 1)]
    assert download.quarters_covering(date(2026, 3, 1), date(2026, 3, 31)) == [(2026, 1), (2026, 2)]  # 01/04 fecha 31/03


def test_cache_path_quarter_shares_bbox_dir(tmp_path):
    q = download.cache_path_quarter(tmp_path, BBOX, 2025, 4)
    m = download.cache_path(tmp_path, BBOX, 2025, 11)
    assert q.parent == m.parent and q.name == "2025-Q4.nc"


def test_build_request_multi_month():
    req = download.build_request(BBOX, 2025, [10, 11, 12])
    assert req["month"] == ["10", "11", "12"] and len(req["day"]) == 31
    assert download.build_request(BBOX, 2025, 11)["month"] == ["11"]


def test_month_is_consolidated_respects_lag():
    assert download.month_is_consolidated(2026, 8, TODAY)
    assert not download.month_is_consolidated(2026, 9, TODAY)  # 30/09 + 6 = 06/10 > 05/10
    assert download.month_is_consolidated(2026, 9, date(2026, 10, 7))


def test_plan_periods_short_range_is_monthly():
    periods = download.plan_periods(date(2026, 9, 19), date(2026, 9, 29), TODAY)
    assert [p.label() for p in periods] == ["2026-09"]
    periods = download.plan_periods(date(2025, 11, 20), date(2025, 12, 31), TODAY)  # Nov, Dez, Jan = 3 meses
    assert [p.label() for p in periods] == ["2025-Q4", "2026-Q1"]


def test_plan_periods_long_range_by_quarter_except_open_quarter():
    periods = download.plan_periods(date(2025, 11, 1), date(2026, 9, 29), TODAY)
    assert [p.label() for p in periods] == ["2025-Q4", "2026-Q1", "2026-Q2", "2026-07", "2026-08", "2026-09"]


def test_fetch_quarter_reuses_three_monthly_files(tmp_path):
    client = FakeClient()
    for m in (10, 11, 12):
        download.fetch_month(client, BBOX, 2025, m, tmp_path, TODAY)
    assert client.calls == 3
    paths = download.fetch_quarter(client, BBOX, 2025, 4, tmp_path, TODAY)
    assert [p.name for p in paths] == ["2025-10.nc", "2025-11.nc", "2025-12.nc"]
    assert client.calls == 3  # nenhuma requisição nova


def test_fetch_quarter_single_request_then_cached(tmp_path):
    client = FakeClient()
    first = download.fetch_quarter(client, BBOX, 2026, 1, tmp_path, TODAY)
    second = download.fetch_quarter(client, BBOX, 2026, 1, tmp_path, TODAY)
    assert first == second == [download.cache_path_quarter(tmp_path, BBOX, 2026, 1)]
    assert client.calls == 1


def test_fetch_range_reports_progress(tmp_path):
    client = FakeClient()
    seen = []
    paths = download.fetch_range(client, BBOX, date(2025, 11, 1), date(2026, 3, 29), tmp_path, TODAY, on_progress=lambda d, t: seen.append((d, t)))
    assert seen == [(1, 2), (2, 2)]
    assert [p.name for p in paths] == ["2025-Q4.nc", "2026-Q1.nc"]


def test_open_month_cache_is_refreshed_daily(tmp_path):
    """Mês ainda não consolidado: arquivo de dias anteriores é baixado de novo."""
    import os
    import time

    client = FakeClient()
    target = download.fetch_month(client, BBOX, 2026, 9, tmp_path, TODAY)
    yesterday = time.time() - 86400
    os.utime(target, (yesterday, yesterday))
    download.fetch_month(client, BBOX, 2026, 9, tmp_path, TODAY)
    assert client.calls == 2
    # mês consolidado: o arquivo antigo continua valendo
    old = download.fetch_month(client, BBOX, 2026, 8, tmp_path, TODAY)
    os.utime(old, (yesterday, yesterday))
    download.fetch_month(client, BBOX, 2026, 8, tmp_path, TODAY)
    assert client.calls == 3
