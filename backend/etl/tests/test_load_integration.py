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
