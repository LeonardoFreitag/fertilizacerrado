"""Etapa 4 — carga: DataFrame diário → upsert por célula (idempotente).

Aplica a calibração QM ativa da célula, quando existir: ``tp_corrected``,
``qm_applied = true`` e ``qm_calibration_id``. Sem calibração, ``tp_corrected = tp_raw``.
"""

from __future__ import annotations

from typing import Iterator, Sequence

import pandas as pd
import psycopg

from . import db

SOURCE = "era5-land"


def rows_from_frame(frame: pd.DataFrame, cell: tuple[float, float], calibration_id: str | None = None) -> Iterator[Sequence]:
    lat, lon = cell
    for r in frame.itertuples(index=False):
        yield (
            r.time, lat, lon,
            float(r.t2m_max), float(r.t2m_min), float(r.t2m_mean), float(r.d2m_mean),
            float(r.u2), float(r.rn), float(r.tp_raw), float(r.tp_corrected),
            bool(r.qm_applied), calibration_id, SOURCE,
        )


def with_correction(conn: psycopg.Connection, frame: pd.DataFrame, cell: tuple[float, float]) -> tuple[pd.DataFrame, str | None]:
    """Preenche tp_corrected/qm_applied pela calibração ativa da célula (ou identidade)."""
    from . import qm_ops  # import tardio: evita ciclo e mantém o transform sem numpy extra

    if frame.empty:
        return frame, None
    dates = [pd.Timestamp(t).date() for t in frame["time"]]
    corrected, applied, cal_id = qm_ops.correct_values(conn, cell, dates, [float(v) for v in frame["tp_raw"]])
    out = frame.copy()
    out["tp_corrected"] = corrected
    out["qm_applied"] = applied
    return out, cal_id


def load_frame(conn: psycopg.Connection, frame: pd.DataFrame, cell: tuple[float, float]) -> int:
    frame, cal_id = with_correction(conn, frame, cell)
    return db.upsert_daily(conn, rows_from_frame(frame, cell, cal_id))
