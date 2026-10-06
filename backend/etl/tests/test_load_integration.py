"""Integração com o banco da stack: ``pytest -m integration`` com DATABASE_URL."""

import os
from datetime import date
from pathlib import Path

import pytest

from era5 import db, load, transform

pytestmark = pytest.mark.integration

NC = Path(__file__).parent / "fixtures" / "era5_synthetic.nc"
CELL = (-89.9, 179.9)  # célula improvável, para não colidir com dados reais
D1, D4 = date(2025, 11, 1), date(2025, 11, 4)


@pytest.fixture
def conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL não definida")
    with db.connect(url) as c:
        yield c
        c.execute("DELETE FROM era5_daily_data WHERE cell_lat = %s AND cell_lon = %s", CELL)
        c.execute("DELETE FROM era5_ingestion_runs WHERE command LIKE 'pytest%%'")
        c.commit()


@pytest.fixture
def frame():
    ds = transform.open_hourly([NC])
    sel = transform.select_cell(ds, -16.7, -49.3)
    return transform.aggregate_daily(sel.data, D1, D4).frame


def test_upsert_is_idempotent(conn, frame):
    assert load.load_frame(conn, frame, CELL) == 4
    assert db.count_rows(conn, CELL, D1, D4) == 4
    assert load.load_frame(conn, frame, CELL) == 4
    assert db.count_rows(conn, CELL, D1, D4) == 4


def test_reprocessing_updates_values(conn, frame):
    load.load_frame(conn, frame, CELL)
    changed = frame.copy()
    changed["tp_raw"] = changed["tp_raw"] + 1.0
    changed["tp_corrected"] = changed["tp_raw"]
    load.load_frame(conn, changed, CELL)
    row = conn.execute(
        "SELECT tp_raw, ingested_at FROM era5_daily_data WHERE cell_lat = %s AND cell_lon = %s AND time = %s",
        (*CELL, D1),
    ).fetchone()
    assert row["tp_raw"] == pytest.approx(25.0, abs=1e-3)
    assert db.count_rows(conn, CELL, D1, D4) == 4


def test_run_lifecycle(conn):
    run_id = db.open_run(conn, "pytest ingest --from 2025-11-01 --to 2025-11-04", D1, D4)
    db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=1, rows_upserted=4)
    runs = db.recent_runs(conn, 1)
    assert str(runs[0]["id"]) == run_id
    assert runs[0]["status"] == "SUCCEEDED" and runs[0]["rows_upserted"] == 4
    assert runs[0]["finished_at"] is not None


def test_hypertable_exists(conn):
    row = conn.execute(
        "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'era5_daily_data'"
    ).fetchone()
    assert row is not None


def test_run_with_job_id_and_heartbeat(conn):
    run_id = db.open_run(conn, "pytest worker ingest#j1", D1, D4, job_id="j1")
    before = conn.execute("SELECT updated_at FROM era5_ingestion_runs WHERE id = %s", (run_id,)).fetchone()["updated_at"]
    conn.execute("UPDATE era5_ingestion_runs SET updated_at = updated_at - interval '1 minute' WHERE id = %s", (run_id,))
    conn.commit()
    db.touch_run(conn, run_id)
    run = conn.execute("SELECT job_id, updated_at FROM era5_ingestion_runs WHERE id = %s", (run_id,)).fetchone()
    assert run["job_id"] == "j1" and run["updated_at"] >= before
    db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=1, rows_upserted=0)


def test_mark_orphaned_runs(conn):
    old = db.open_run(conn, "pytest worker órfã", D1, D4, job_id="j-old")
    fresh = db.open_run(conn, "pytest worker recente", D1, D4, job_id="j-new")
    conn.execute("UPDATE era5_ingestion_runs SET updated_at = now() - interval '7 hours' WHERE id = %s", (old,))
    conn.commit()
    assert db.mark_orphaned_runs(conn, hours=6) == 1
    rows = {str(r["id"]): r for r in conn.execute(
        "SELECT id, status, error FROM era5_ingestion_runs WHERE id IN (%s, %s)", (old, fresh)
    ).fetchall()}
    assert rows[old]["status"] == "FAILED" and rows[old]["error"].startswith("orphaned")
    assert rows[fresh]["status"] == "RUNNING"
    db.close_run(conn, fresh, status="SUCCEEDED", cells_requested=0, rows_upserted=0)


def test_cells_in_bbox(conn):
    cells = db.cells_in_bbox(conn, (90.0, -180.0, -90.0, 180.0))
    assert cells == db.distinct_cells(conn)
    assert db.cells_in_bbox(conn, (-89.0, 170.0, -89.5, 171.0)) == []


def test_calibration_one_active_and_apply_idempotent(conn):
    """Índice parcial: uma calibração ativa por célula; apply parte de tp_raw."""
    import numpy as np

    from era5 import qm, qm_ops, stations
    from era5.synthetic import synthetic_era5, synthetic_obs

    cell = (-89.8, 179.8)
    code = "PYTEST-QM"
    conn.execute("DELETE FROM qm_calibrations WHERE station_code = %s", (code,))
    conn.execute("DELETE FROM era5_daily_data WHERE cell_lat = %s AND cell_lon = %s", cell)
    conn.commit()
    try:
        dates, era5 = synthetic_era5(years=1, seed=7, start=date(2020, 1, 1))
        db.upsert_station(conn, stations.StationMeta(code, "pytest", "OUTRA", cell[0] + 0.05, cell[1]))
        db.upsert_obs(conn, ((code, d, float(v), None, None) for d, v in zip(dates, synthetic_obs(era5))), "pytest")
        db.upsert_daily(conn, ((d, cell[0], cell[1], 30, 18, 24, 17, 1.5, 12, float(v), float(v), False, None, "pytest") for d, v in zip(dates, era5)))
        cfg = qm.QmConfig(min_years=0.5)
        cal = qm.calibrate(dates, era5, synthetic_obs(era5), cfg)
        first = db.save_calibration(conn, cell, code, cal, 5.0)
        second = db.save_calibration(conn, cell, code, cal, 5.0)
        rows = conn.execute("SELECT id, active FROM qm_calibrations WHERE station_code = %s ORDER BY created_at", (code,)).fetchall()
        assert [str(r["id"]) for r in rows] == [first, second]
        assert [r["active"] for r in rows] == [False, True]
        n1 = qm_ops.apply_cell(conn, cell)
        a = db.cell_raw_series(conn, cell)
        corrected1 = conn.execute("SELECT time, tp_corrected FROM era5_daily_data WHERE cell_lat=%s AND cell_lon=%s ORDER BY time", cell).fetchall()
        n2 = qm_ops.apply_cell(conn, cell)
        corrected2 = conn.execute("SELECT time, tp_corrected FROM era5_daily_data WHERE cell_lat=%s AND cell_lon=%s ORDER BY time", cell).fetchall()
        assert n1 == n2 == len(a)
        assert [r["tp_corrected"] for r in corrected1] == [r["tp_corrected"] for r in corrected2]
        flagged = conn.execute("SELECT count(*) AS n FROM era5_daily_data WHERE cell_lat=%s AND cell_lon=%s AND qm_applied AND qm_calibration_id = %s", (cell[0], cell[1], second)).fetchone()["n"]
        assert flagged == len(a)
        assert not np.allclose([r["tp_corrected"] for r in corrected1], list(a.values()))  # algo mudou
    finally:
        conn.execute("UPDATE qm_calibrations SET active = false WHERE station_code = %s", (code,))
        conn.execute("DELETE FROM era5_daily_data WHERE cell_lat = %s AND cell_lon = %s", cell)
        conn.execute("DELETE FROM qm_calibrations WHERE station_code = %s", (code,))
        conn.execute("DELETE FROM weather_stations WHERE code = %s", (code,))
        conn.commit()
