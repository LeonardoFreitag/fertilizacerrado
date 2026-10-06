"""Acesso ao PostgreSQL/TimescaleDB: células, safras, runs e upsert."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Sequence

import psycopg
from psycopg.rows import dict_row

Cell = tuple[float, float]  # (lat, lon) na grade de 0,1°
BBox = tuple[float, float, float, float]  # (N, W, S, E)

UPSERT_SQL = """
INSERT INTO era5_daily_data
  (time, cell_lat, cell_lon, t2m_max, t2m_min, t2m_mean, d2m_mean, u2, rn,
   tp_raw, tp_corrected, qm_applied, qm_calibration_id, source, ingested_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
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
  qm_calibration_id = EXCLUDED.qm_calibration_id,
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


def cells_in_bbox(conn: psycopg.Connection, bbox: BBox) -> list[Cell]:
    """Células distintas de ``era5_cells`` dentro da bbox (N, W, S, E), bordas inclusas."""
    north, west, south, east = bbox
    rows = conn.execute(
        """
        SELECT DISTINCT cell_lat, cell_lon FROM era5_cells
        WHERE cell_lat BETWEEN %s AND %s AND cell_lon BETWEEN %s AND %s
        ORDER BY 1, 2
        """,
        (south, north, west, east),
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
    conn: psycopg.Connection,
    command: str,
    date_from: date | None,
    date_to: date | None,
    job_id: str | None = None,
) -> str:
    row = conn.execute(
        """
        INSERT INTO era5_ingestion_runs (id, command, date_from, date_to, status, job_id, updated_at)
        VALUES (gen_random_uuid(), %s, %s, %s, 'RUNNING', %s, now())
        RETURNING id
        """,
        (command, date_from, date_to, job_id),
    ).fetchone()
    conn.commit()
    return str(row["id"])


def touch_run(conn: psycopg.Connection, run_id: str) -> None:
    """Heartbeat: prova de vida da run em curso (ver ``mark_orphaned_runs``)."""
    conn.execute("UPDATE era5_ingestion_runs SET updated_at = now() WHERE id = %s", (run_id,))
    conn.commit()


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
        SET finished_at = now(), updated_at = now(), status = %s, cells_requested = %s,
            rows_upserted = %s, cds_request_id = %s, error = %s
        WHERE id = %s
        """,
        (status, cells_requested, rows_upserted, cds_request_id, error, run_id),
    )
    conn.commit()


def mark_orphaned_runs(conn: psycopg.Connection, hours: int = 6) -> int:
    """Runs ``RUNNING`` sem heartbeat há mais de ``hours`` (processo morreu no
    meio) viram ``FAILED`` com erro ``orphaned``. Devolve quantas."""
    cur = conn.execute(
        """
        UPDATE era5_ingestion_runs
        SET status = 'FAILED', finished_at = now(), updated_at = now(),
            error = 'orphaned: sem heartbeat há mais de ' || %s || ' h'
        WHERE status = 'RUNNING'
          AND COALESCE(updated_at, started_at) < now() - make_interval(hours => %s)
        """,
        (hours, hours),
    )
    conn.commit()
    return cur.rowcount


def recent_runs(conn: psycopg.Connection, limit: int = 10) -> list[dict]:
    return conn.execute(
        """
        SELECT id, command, started_at, finished_at, updated_at, status, date_from, date_to,
               cells_requested, rows_upserted, cds_request_id, job_id, error
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


# --- estações e observações ----------------------------------------------------


def upsert_station(conn: psycopg.Connection, meta) -> None:
    conn.execute(
        """
        INSERT INTO weather_stations (code, name, source, lat, lon, altitude_m, geometry, active, created_at, updated_at)
        VALUES (%(code)s, %(name)s, %(source)s::station_source, %(lat)s, %(lon)s, %(alt)s,
                ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, true, now(), now())
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, source = EXCLUDED.source, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
          altitude_m = COALESCE(EXCLUDED.altitude_m, weather_stations.altitude_m),
          geometry = EXCLUDED.geometry, updated_at = now()
        """,
        {"code": meta.code, "name": meta.name, "source": meta.source, "lat": meta.lat, "lon": meta.lon, "alt": meta.altitude_m},
    )
    conn.commit()


def station_exists(conn: psycopg.Connection, code: str) -> bool:
    return conn.execute("SELECT 1 FROM weather_stations WHERE code = %s", (code,)).fetchone() is not None


def upsert_obs(conn: psycopg.Connection, rows: Iterable[Sequence], source_file: str) -> int:
    rows = [tuple(r) + (source_file,) for r in rows]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO station_daily_obs (station_code, date, precip_mm, tmax, tmin, source_file, imported_at)
            VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (station_code, date) DO UPDATE SET
              precip_mm = EXCLUDED.precip_mm, tmax = EXCLUDED.tmax, tmin = EXCLUDED.tmin,
              source_file = EXCLUDED.source_file, imported_at = now()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def list_stations(conn: psycopg.Connection, active_only: bool = False) -> list[dict]:
    return conn.execute(
        """
        SELECT s.code, s.name, s.source, s.lat, s.lon, s.altitude_m, s.active,
               count(o.date) AS obs_count, min(o.date) AS obs_from, max(o.date) AS obs_to
        FROM weather_stations s
        LEFT JOIN station_daily_obs o ON o.station_code = s.code
        WHERE (%s = false OR s.active)
        GROUP BY s.code ORDER BY s.code
        """,
        (active_only,),
    ).fetchall()


def station_obs_series(conn: psycopg.Connection, code: str, date_from: date | None = None, date_to: date | None = None) -> dict[date, float | None]:
    rows = conn.execute(
        """
        SELECT date, precip_mm FROM station_daily_obs
        WHERE station_code = %s AND (%s::date IS NULL OR date >= %s) AND (%s::date IS NULL OR date <= %s)
        ORDER BY date
        """,
        (code, date_from, date_from, date_to, date_to),
    ).fetchall()
    return {r["date"]: (None if r["precip_mm"] is None else float(r["precip_mm"])) for r in rows}


def cell_raw_series(conn: psycopg.Connection, cell: Cell, date_from: date | None = None, date_to: date | None = None) -> dict[date, float]:
    rows = conn.execute(
        """
        SELECT time, tp_raw FROM era5_daily_data
        WHERE cell_lat = %s AND cell_lon = %s
          AND (%s::date IS NULL OR time >= %s) AND (%s::date IS NULL OR time <= %s)
        ORDER BY time
        """,
        (cell[0], cell[1], date_from, date_from, date_to, date_to),
    ).fetchall()
    return {r["time"]: float(r["tp_raw"]) for r in rows}


# --- calibrações QM ---------------------------------------------------------------


def save_calibration(conn: psycopg.Connection, cell: Cell, station_code: str, calibration, distance_km: float, variable: str = "tp") -> str:
    """Desativa a calibração ativa da célula/variável e grava a nova como ativa."""
    import json

    j = calibration.to_json()
    with conn.transaction():
        conn.execute(
            "UPDATE qm_calibrations SET active = false WHERE cell_lat = %s AND cell_lon = %s AND variable = %s AND active",
            (cell[0], cell[1], variable),
        )
        row = conn.execute(
            """
            INSERT INTO qm_calibrations (id, cell_lat, cell_lon, station_code, variable, method, period_from, period_to,
              n_days_by_month, wet_day_threshold_obs, wet_thresholds_era5, quantiles, max_ratio, distance_km, active, created_at)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s, %s, true, now())
            RETURNING id
            """,
            (
                cell[0], cell[1], station_code, variable, calibration.method, calibration.period_from, calibration.period_to,
                json.dumps(j["n_days_by_month"]), calibration.wet_day_mm, json.dumps(j["wet_thresholds_era5"]),
                json.dumps(j["quantiles"]), calibration.max_ratio, distance_km,
            ),
        ).fetchone()
    return str(row["id"])


def active_calibration(conn: psycopg.Connection, cell: Cell, variable: str = "tp") -> dict | None:
    return conn.execute(
        """
        SELECT c.*, s.name AS station_name FROM qm_calibrations c
        JOIN weather_stations s ON s.code = c.station_code
        WHERE c.cell_lat = %s AND c.cell_lon = %s AND c.variable = %s AND c.active
        """,
        (cell[0], cell[1], variable),
    ).fetchone()


def list_calibrations(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT c.id, c.cell_lat, c.cell_lon, c.station_code, s.name AS station_name, c.variable, c.method,
               c.period_from, c.period_to, c.distance_km, c.active, c.created_at
        FROM qm_calibrations c JOIN weather_stations s ON s.code = c.station_code
        ORDER BY c.cell_lat, c.cell_lon, c.active DESC, c.created_at DESC
        """
    ).fetchall()


def active_stations(conn: psycopg.Connection) -> list[dict]:
    return conn.execute("SELECT code, name, lat, lon FROM weather_stations WHERE active ORDER BY code").fetchall()


def update_corrected(conn: psycopg.Connection, cell: Cell, rows: Iterable[tuple], calibration_id: str | None) -> int:
    """``rows``: (time, tp_corrected). Com ``calibration_id`` nulo, marca sem correção."""
    rows = [(float(v), calibration_id is not None, calibration_id, cell[0], cell[1], t) for t, v in rows]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE era5_daily_data SET tp_corrected = %s, qm_applied = %s, qm_calibration_id = %s WHERE cell_lat = %s AND cell_lon = %s AND time = %s",
            rows,
        )
    conn.commit()
    return len(rows)
