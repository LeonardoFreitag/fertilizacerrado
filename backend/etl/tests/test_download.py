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
