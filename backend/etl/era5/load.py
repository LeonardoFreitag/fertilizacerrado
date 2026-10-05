"""Etapa 4 — carga: DataFrame diário → upsert por célula (idempotente)."""

from __future__ import annotations

from typing import Iterator, Sequence

import pandas as pd
import psycopg

from . import db

SOURCE = "era5-land"


def rows_from_frame(frame: pd.DataFrame, cell: tuple[float, float]) -> Iterator[Sequence]:
    lat, lon = cell
    for r in frame.itertuples(index=False):
        yield (
            r.time, lat, lon,
            float(r.t2m_max), float(r.t2m_min), float(r.t2m_mean), float(r.d2m_mean),
            float(r.u2), float(r.rn), float(r.tp_raw), float(r.tp_corrected),
            bool(r.qm_applied), SOURCE,
        )


def load_frame(conn: psycopg.Connection, frame: pd.DataFrame, cell: tuple[float, float]) -> int:
    return db.upsert_daily(conn, rows_from_frame(frame, cell))
