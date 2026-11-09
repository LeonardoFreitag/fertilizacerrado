import threading
import time
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


# --- cliente falso que grava NetCDF reais -------------------------------------

SHORT = {  # nome CDS → nome curto no NetCDF, como o CDS devolve
    "2m_temperature": "t2m",
    "2m_dewpoint_temperature": "d2m",
    "10m_u_component_of_wind": "u10",
    "10m_v_component_of_wind": "v10",
    "surface_net_solar_radiation": "ssr",
    "surface_net_thermal_radiation": "str",
    "total_precipitation": "tp",
}
COST_TEXT = "403 Client Error: ... cost limits exceeded. Your request is too large, please reduce your selection."
LICENCE_TEXT = "403 Client Error: required licences not accepted"


class FakeClient:
    """Grava um NetCDF mínimo com as variáveis pedidas (2 passos, grade 2×2).
    ``fail_full``: rótulos ``AAAA-MM`` cuja requisição inteira (7 variáveis) é
    recusada com ``error_text``; ``fail_groups``: idem para qualquer grupo."""

    def __init__(self, fail_full=(), fail_groups=(), error_text=COST_TEXT, delay=0.0, with_expver=False):
        self.calls = 0
        self.requests = []
        self.fail_full = set(fail_full)
        self.fail_groups = set(fail_groups)
        self.error_text = error_text
        self.delay = delay
        self.with_expver = with_expver
        self.in_flight = 0
        self.max_in_flight = 0
        self._lock = threading.Lock()

    def retrieve(self, dataset, request, target):
        import numpy as np
        import pandas as pd
        import xarray as xr

        with self._lock:
            self.calls += 1
            self.requests.append(request)
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            if self.delay:
                time.sleep(self.delay)
            label = f"{request['year']}-{request['month'][0]}"
            full = len(request["variable"]) == len(download.VARIABLES)
            if (full and label in self.fail_full) or (not full and label in self.fail_groups):
                raise Exception(self.error_text)
            times = pd.date_range(f"{request['year']}-{request['month'][0]}-01", periods=2, freq="h")
            coords = {"valid_time": times, "latitude": [-16.6, -16.7], "longitude": [-49.4, -49.3]}
            shape = (2, 2, 2)
            data = {SHORT[v]: (("valid_time", "latitude", "longitude"), np.full(shape, i, dtype="float32")) for i, v in enumerate(request["variable"], start=1)}
            ds = xr.Dataset(data, coords=coords)
            if self.with_expver and not full:
                ds = ds.expand_dims(expver=["0001"])
            with download.NETCDF_LOCK:
                ds.to_netcdf(target)
        finally:
            with self._lock:
                self.in_flight -= 1


def test_fetch_month_uses_cache(tmp_path):
    client = FakeClient()
    bbox = (-16.1, -49.4, -16.8, -48.7)
    first = download.fetch_month(client, bbox, 2025, 11, tmp_path, TODAY)
    second = download.fetch_month(client, bbox, 2025, 11, tmp_path, TODAY)
    assert first == second and first.exists()
    assert client.calls == 1
    assert first.name == "2025-11.nc" and not list(first.parent.glob("*.part"))


# --- planejamento mensal ------------------------------------------------------

TODAY = date(2026, 10, 5)
BBOX = (-16.6, -49.4, -16.8, -49.2)


def test_plan_periods_always_monthly():
    assert [p.label() for p in download.plan_periods(date(2026, 9, 19), date(2026, 9, 29))] == ["2026-09"]
    assert [p.label() for p in download.plan_periods(date(2025, 11, 20), date(2025, 12, 31))] == ["2025-11", "2025-12", "2026-01"]
    long = download.plan_periods(date(2025, 11, 1), date(2026, 9, 29))
    assert [p.label() for p in long] == [
        "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
        "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]  # 29/09 + 1 dia = 30/09: outubro não entra
    assert [p.label() for p in download.plan_periods(date(2025, 2, 1), date(2025, 10, 25))] == [f"2025-{m:02d}" for m in range(2, 11)]


def test_no_quarter_api():
    for name in ("quarters_covering", "quarter_months", "fetch_quarter", "cache_path_quarter", "MONTHLY_MAX_MONTHS"):
        assert not hasattr(download, name)


def test_build_request_single_month_with_real_days():
    req = download.build_request(BBOX, 2026, 2)
    assert req["year"] == "2026" and req["month"] == ["02"] and len(req["day"]) == 28
    half = download.build_request(BBOX, 2026, 2, download.VARIABLE_GROUPS[1])
    assert half["variable"] == ["surface_net_solar_radiation", "surface_net_thermal_radiation", "total_precipitation"]
    assert sorted(sum(download.VARIABLE_GROUPS, [])) == sorted(download.VARIABLES)


def test_month_is_consolidated_respects_lag():
    assert download.month_is_consolidated(2026, 8, TODAY)  # 31/08 + 6 < 05/10
    assert not download.month_is_consolidated(2026, 9, TODAY)  # 30/09 + 6 = 06/10 > 05/10
    assert not download.month_is_consolidated(2026, 10, TODAY)


# --- recusa por custo: divisão por grupos de variáveis --------------------------


def _variables(path):
    import xarray as xr

    with xr.open_dataset(path) as ds:
        return sorted(ds.data_vars)


def test_is_cost_error_by_message():
    assert download.is_cost_error(Exception(COST_TEXT))
    assert download.is_cost_error(RuntimeError("Request is TOO large"))
    assert not download.is_cost_error(Exception(LICENCE_TEXT))


def test_full_month_has_all_variables(tmp_path):
    client = FakeClient()
    path = download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    assert _variables(path) == sorted(SHORT.values())


def test_cost_error_splits_by_variable_group_and_merges(tmp_path):
    client = FakeClient(fail_full={"2025-11"}, with_expver=True)
    path = download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    assert client.calls == 3
    assert [len(r["variable"]) for r in client.requests] == [7, 4, 3]
    assert path.name == "2025-11.nc" and _variables(path) == sorted(SHORT.values())
    assert [p.name for p in path.parent.iterdir()] == ["2025-11.nc"]  # nenhum parcial sobrou
    # segunda chamada: cache
    download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    assert client.calls == 3


def test_cost_error_on_group_is_definitive(tmp_path):
    client = FakeClient(fail_full={"2025-11"}, fail_groups={"2025-11"})
    with pytest.raises(download.CdsCostError) as info:
        download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    msg = str(info.value)
    assert "2025-11" in msg and str(BBOX) in msg and "cost limits exceeded" in msg and "Reduza a área" in msg
    assert client.calls == 2  # inteira + primeiro grupo
    assert not download.cache_path(tmp_path, BBOX, 2025, 11).exists()
    assert not [p for p in download.cache_path(tmp_path, BBOX, 2025, 11).parent.iterdir() if p.suffix == ".nc"]


def test_non_cost_error_is_not_split(tmp_path):
    client = FakeClient(fail_full={"2025-11"}, error_text=LICENCE_TEXT)
    with pytest.raises(Exception, match="licences not accepted"):
        download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    assert client.calls == 1


def test_failed_merge_leaves_no_cache(tmp_path, monkeypatch):
    client = FakeClient(fail_full={"2025-11"})

    def boom(parts, target):
        raise RuntimeError("merge falhou")

    monkeypatch.setattr(download, "_merge_groups", boom)
    with pytest.raises(RuntimeError, match="merge falhou"):
        download.fetch_month(client, BBOX, 2025, 11, tmp_path, TODAY)
    target = download.cache_path(tmp_path, BBOX, 2025, 11)
    assert not target.exists()
    assert not download._cached(target, consolidated=True, today=TODAY)
    assert all(p.name.endswith(".part") for p in target.parent.iterdir())


def test_retrieve_writes_part_then_renames(tmp_path):
    seen = {}

    class Spy:
        def retrieve(self, dataset, request, target):
            seen["target"] = Path(target)
            assert Path(target).parent == download.cache_path(tmp_path, BBOX, 2025, 11).parent
            Path(target).write_bytes(b"x")

    path = download.fetch_month(Spy(), BBOX, 2025, 11, tmp_path, TODAY)
    assert seen["target"].name == "2025-11.nc.part" and not seen["target"].exists() and path.exists()


# --- fetch_range: concorrência e progresso -------------------------------------


def test_fetch_range_concurrent_keeps_order_and_progress(tmp_path):
    client = FakeClient(delay=0.05)
    seen = []
    paths = download.fetch_range(client, BBOX, date(2025, 11, 1), date(2026, 3, 29), tmp_path, TODAY, on_progress=lambda d, t: seen.append((d, t)), max_concurrent=3)
    assert seen == [(i, 5) for i in range(1, 6)]
    assert [p.name for p in paths] == ["2025-11.nc", "2025-12.nc", "2026-01.nc", "2026-02.nc", "2026-03.nc"]
    assert client.calls == 5 and 2 <= client.max_in_flight <= 3


def test_fetch_range_respects_max_concurrent_one(tmp_path):
    client = FakeClient(delay=0.02)
    download.fetch_range(client, BBOX, date(2025, 11, 1), date(2026, 1, 29), tmp_path, TODAY, max_concurrent=1)
    assert client.max_in_flight == 1


def test_fetch_range_cached_months_count_in_progress(tmp_path):
    client = FakeClient()
    for m in (11, 12):
        download.fetch_month(client, BBOX, 2025, m, tmp_path, TODAY)
    seen = []
    download.fetch_range(client, BBOX, date(2025, 11, 1), date(2026, 1, 29), tmp_path, TODAY, on_progress=lambda d, t: seen.append((d, t)), max_concurrent=2)
    assert client.calls == 3  # só 2026-01 foi ao CDS
    assert seen == [(1, 3), (2, 3), (3, 3)]


def test_fetch_range_propagates_first_error(tmp_path):
    client = FakeClient(fail_full={"2026-01"}, fail_groups={"2026-01"})
    with pytest.raises(download.CdsCostError):
        download.fetch_range(client, BBOX, date(2025, 11, 1), date(2026, 3, 29), tmp_path, TODAY, max_concurrent=2)


def test_fetch_range_rejects_zero_concurrency(tmp_path):
    with pytest.raises(ValueError):
        download.fetch_range(FakeClient(), BBOX, date(2025, 11, 1), date(2025, 11, 2), tmp_path, TODAY, max_concurrent=0)


def test_open_month_cache_is_refreshed_daily(tmp_path):
    """Mês ainda não consolidado: arquivo de dias anteriores é baixado de novo.
    Usa a data real: a regra compara o mtime do arquivo com o dia de hoje."""
    import os
    import time
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    open_month = (today.year, today.month)  # nunca consolidado (último dia + lag > hoje)
    y, m = today.year, today.month - 4  # mês fechado com folga
    if m <= 0:
        y, m = y - 1, m + 12
    client = FakeClient()
    target = download.fetch_month(client, BBOX, *open_month, tmp_path, today)
    yesterday = time.time() - 86400
    os.utime(target, (yesterday, yesterday))
    download.fetch_month(client, BBOX, *open_month, tmp_path, today)
    assert client.calls == 2
    # mês consolidado: o arquivo antigo continua valendo
    old = download.fetch_month(client, BBOX, y, m, tmp_path, today)
    os.utime(old, (yesterday, yesterday))
    download.fetch_month(client, BBOX, y, m, tmp_path, today)
    assert client.calls == 3
