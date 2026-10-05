"""Acesso ao PostgreSQL/TimescaleDB: células, safras, runs e upsert."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Sequence

import psycopg
from psycopg.rows import dict_row

Cell = tuple[float, float]  # (lat, lon) na grade de 0,1°

UPSERT_SQL = """
INSERT INTO era5_daily_data
  (time, cell_lat, cell_lon, t2m_max, t2m_min, t2m_mean, d2m_mean, u2, rn,
   tp_raw, tp_corrected, qm_applied, source, ingested_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (time, cell_lat, cell_lon) DO UPDATE SET
  t2m_max = EXCLUDED.t2m_max,
  t2m_min = EXCLUDED.t2m_min,
  t2m_mean = EXCLUDED.t2m_mean,
  d2m_mean = EXCLUDED.d2m_mean,
  u2 = EXCLUDED.u2,
  rn = EXCLUDED.rn,
  tp_raw = EXCLUDED.tp_raw,
  tp_corrected = EXCLUDED.tp_corrected,
  qm_applied = EXCLUDED.qm_applied,
  source = EXCLUDED.source,
  ingested_at = now()
"""


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row)


def distinct_cells(conn: psycopg.Connection) -> list[Cell]:
    rows = conn.execute(
        "SELECT DISTINCT cell_lat, cell_lon FROM era5_cells ORDER BY 1, 2"
    ).fetchall()
    return [(float(r["cell_lat"]), float(r["cell_lon"])) for r in rows]


@dataclass(frozen=True)
class HarvestCell:
    harvest_id: str
    field_id: str
    emergence_date: date
    cell: Cell


def harvest_cell(conn: psycopg.Connection, harvest_id: str) -> HarvestCell | None:
    row = conn.execute(
        """
        SELECT h.id, h.field_id, h.emergence_date, c.cell_lat, c.cell_lon
        FROM harvests h
        JOIN era5_cells c ON c.field_id = h.field_id
        WHERE h.id = %s
        """,
        (harvest_id,),
    ).fetchone()
    if row is None:
        return None
    return HarvestCell(
        harvest_id=str(row["id"]),
        field_id=str(row["field_id"]),
        emergence_date=row["emergence_date"],
        cell=(float(row["cell_lat"]), float(row["cell_lon"])),
    )


def open_run(
    conn: psycopg.Connection, command: str, date_from: date | None, date_to: date | None
) -> str:
    row = conn.execute(
        """
        INSERT INTO era5_ingestion_runs (id, command, date_from, date_to, status)
        VALUES (gen_random_uuid(), %s, %s, %s, 'RUNNING')
        RETURNING id
        """,
        (command, date_from, date_to),
    ).fetchone()
    conn.commit()
    return str(row["id"])


def close_run(
    conn: psycopg.Connection,
    run_id: str,
    *,
    status: str,
    cells_requested: int | None = None,
    rows_upserted: int | None = None,
    cds_request_id: str | None = None,
    error: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE era5_ingestion_runs
        SET finished_at = now(), status = %s, cells_requested = %s,
            rows_upserted = %s, cds_request_id = %s, error = %s
        WHERE id = %s
        """,
        (status, cells_requested, rows_upserted, cds_request_id, error, run_id),
    )
    conn.commit()


def recent_runs(conn: psycopg.Connection, limit: int = 10) -> list[dict]:
    return conn.execute(
        """
        SELECT id, command, started_at, finished_at, status, date_from, date_to,
               cells_requested, rows_upserted, cds_request_id, error
        FROM era5_ingestion_runs
        ORDER BY started_at DESC
        LIMIT %s
        """,
        (limit,),
    ).fetchall()


def upsert_daily(conn: psycopg.Connection, rows: Iterable[Sequence]) -> int:
    """Upsert em lote; idempotente. Devolve o número de linhas enviadas."""
    rows = list(rows)
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(UPSERT_SQL, rows)
    conn.commit()
    return len(rows)


def count_rows(conn: psycopg.Connection, cell: Cell, date_from: date, date_to: date) -> int:
    row = conn.execute(
        """
        SELECT count(*) AS n FROM era5_daily_data
        WHERE cell_lat = %s AND cell_lon = %s AND time BETWEEN %s AND %s
        """,
        (cell[0], cell[1], date_from, date_to),
    ).fetchone()
    return int(row["n"])
