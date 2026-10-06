"""Worker BullMQ da fila ``era5-ingest`` (``python -m era5.cli worker``).

Jobs vêm do Node (``backend/src/modules/jobs/flows.ts``) com ``kind``:

- ``latest``: ``[hoje − 16, hoje − 6]``, todas as células de ``era5_cells``;
- ``range``: ``from``/``to``, células dentro de ``bbox`` (N, W, S, E) ou todas;
- ``cell``: ``lat``/``lon``/``from``/``to``, só essa célula.

Concorrência 1 (o CDS serializa de qualquer forma). O trabalho bloqueante
(CDS, xarray, psycopg) roda em thread para o loop renovar o lock do job.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from . import db, qm_ops, stations
from .cli import LATEST_LAG_DAYS, IngestSummary, _ingest_cells, latest_window
from .config import ConfigError, Settings

log = logging.getLogger("era5.worker")

QUEUE = "era5-ingest"
CONCURRENCY = 1
ORPHAN_HOURS = 6


class InvalidJob(ValueError):
    """Payload fora do contrato — falha o job sem nova tentativa útil."""


@dataclass(frozen=True)
class JobPlan:
    kind: str
    date_from: date | None
    date_to: date | None
    bbox: tuple[float, float, float, float] | None = None
    cell: tuple[float, float] | None = None
    # station-import
    path: str | None = None
    format: str | None = None
    station_meta: str | None = None
    # qm
    station: str | None = None
    auto: bool = False


def _parse_date(data: dict, key: str) -> date:
    value = data.get(key)
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise InvalidJob(f"campo {key!r} inválido: {value!r}") from exc


def _parse_bbox(value) -> tuple[float, float, float, float]:
    try:
        n, w, s, e = (float(v) for v in value)
    except (TypeError, ValueError) as exc:
        raise InvalidJob(f"bbox inválida: {value!r}") from exc
    if n <= s or e <= w:
        raise InvalidJob(f"bbox inválida (N>S, E>W): {value!r}")
    return (n, w, s, e)


def plan_job(data: dict, today: date) -> JobPlan:
    """Função pura: payload do job → intervalo e alvo. Levanta ``InvalidJob``."""
    if not isinstance(data, dict):
        raise InvalidJob("payload do job deve ser um objeto")
    kind = data.get("kind")
    if kind == "latest":
        date_from, date_to = latest_window(today)
        return JobPlan(kind, date_from, date_to)
    if kind in ("range", "cell"):
        date_from, date_to = _parse_date(data, "from"), _parse_date(data, "to")
        if date_from > date_to:
            raise InvalidJob(f"from {date_from} posterior a to {date_to}")
        if kind == "range":
            bbox = _parse_bbox(data["bbox"]) if data.get("bbox") is not None else None
            return JobPlan(kind, date_from, date_to, bbox=bbox)
        try:
            cell = (float(data["lat"]), float(data["lon"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidJob("job 'cell' exige lat e lon numéricos") from exc
        return JobPlan(kind, date_from, date_to, cell=cell)
    if kind == "station-import":
        path, fmt = data.get("path"), data.get("format")
        if not path or fmt not in stations.FORMATS:
            raise InvalidJob("job 'station-import' exige path e format (bdmep|generic)")
        return JobPlan(kind, None, None, path=str(path), format=str(fmt), station_meta=data.get("stationMeta") or None)
    if kind in ("qm-calibrate", "qm-apply"):
        cell = None
        if data.get("cell") is not None:
            try:
                cell = (float(data["cell"]["lat"]), float(data["cell"]["lon"]))
            except (KeyError, TypeError, ValueError) as exc:
                raise InvalidJob("cell deve ser {lat, lon}") from exc
        auto = bool(data.get("auto"))
        if kind == "qm-calibrate" and not auto and cell is None:
            raise InvalidJob("job 'qm-calibrate' exige cell ou auto")
        date_from = _parse_date(data, "from") if data.get("from") else None
        date_to = _parse_date(data, "to") if data.get("to") else None
        return JobPlan(kind, date_from, date_to, cell=cell, station=data.get("station") or None, auto=auto)
    raise InvalidJob(f"kind desconhecido: {kind!r} (aceitos: latest, range, cell, station-import, qm-calibrate, qm-apply)")


def resolve_cells(conn, plan: JobPlan) -> list[tuple[float, float]]:
    if plan.kind == "cell":
        return [plan.cell]  # type: ignore[list-item]
    if plan.kind == "range" and plan.bbox is not None:
        return db.cells_in_bbox(conn, plan.bbox)
    return db.distinct_cells(conn)


def describe(plan: JobPlan) -> str:
    if plan.kind == "station-import":
        return f"station-import {plan.path} ({plan.format})"
    if plan.kind in ("qm-calibrate", "qm-apply"):
        target = "auto" if plan.auto or plan.cell is None else f"{plan.cell}" + (f" station {plan.station}" if plan.station else "")
        period = f" {plan.date_from}→{plan.date_to}" if plan.date_from or plan.date_to else ""
        return f"{plan.kind} {target}{period}"
    target = plan.cell if plan.kind == "cell" else (plan.bbox if plan.bbox else "todas as células")
    return f"{plan.kind} {plan.date_from}→{plan.date_to} {target}"


def _run_station_import(settings: Settings, conn, job_id: str, plan: JobPlan) -> IngestSummary:
    import os

    run_id = db.open_run(conn, f"worker station-import#{job_id} {describe(plan)}", None, None, job_id=job_id)
    try:
        meta = None
        if plan.station_meta:
            parsed = stations.parse_file(plan.path, plan.format)
            meta = stations.StationMeta.parse_auto(plan.station_meta, sorted({o.station_code for o in parsed.observations}))
        summary = stations.import_file(conn, plan.path, plan.format, meta, source_file=os.path.basename(plan.path))
        note = "; ".join(summary.warnings + ([f"linhas inválidas: {summary.invalid_rows}"] if summary.invalid_rows else [])) or None
        db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(summary.stations), rows_upserted=summary.rows, error=note)
        try:
            os.remove(plan.path)
        except OSError as exc:
            log.warning("não foi possível remover %s: %s", plan.path, exc)
        return IngestSummary(run_id, len(summary.stations), summary.rows, note)
    except Exception as exc:  # noqa: BLE001
        db.close_run(conn, run_id, status="FAILED", error=f"{type(exc).__name__}: {exc}")
        raise


def _run_qm(settings: Settings, conn, job_id: str, plan: JobPlan, on_progress) -> IngestSummary:
    run_id = db.open_run(conn, f"worker {plan.kind}#{job_id} {describe(plan)}", plan.date_from, plan.date_to, job_id=job_id)
    try:
        def progress(done: int, total: int) -> None:
            db.touch_run(conn, run_id)
            on_progress(done, total)

        if plan.kind == "qm-calibrate":
            if plan.auto or plan.cell is None:
                results = qm_ops.calibrate_auto(conn, settings, plan.date_from, plan.date_to, on_progress=progress)
            else:
                results = [qm_ops.calibrate_cell(conn, settings, plan.cell, plan.station, plan.date_from, plan.date_to)]
            ok = [r for r in results if r.calibration_id]
            missing = [r for r in results if not r.calibration_id]
            note = "; ".join(f"célula {r.cell} sem calibração: {'; '.join(r.warnings)}" for r in missing) or None
            if not ok and plan.cell is not None:
                raise RuntimeError(note or "sem estação elegível")
            db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(results), rows_upserted=sum(r.rows_applied for r in ok), error=note)
            return IngestSummary(run_id, len(results), sum(r.rows_applied for r in ok), note)
        if plan.cell is not None:
            out = {plan.cell: qm_ops.apply_cell(conn, plan.cell)}
        else:
            out = qm_ops.apply_all(conn, on_progress=progress)
        total = sum(out.values())
        db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(out), rows_upserted=total)
        return IngestSummary(run_id, len(out), total, None)
    except Exception as exc:  # noqa: BLE001
        db.close_run(conn, run_id, status="FAILED", error=f"{type(exc).__name__}: {exc}")
        raise


def _run_job(settings: Settings, job_id: str, job_name: str, plan: JobPlan, on_progress) -> IngestSummary:
    """Executado em thread: conexão própria, run com ``job_id``."""
    with db.connect(settings.database_url) as conn:
        if plan.kind == "station-import":
            return _run_station_import(settings, conn, job_id, plan)
        if plan.kind in ("qm-calibrate", "qm-apply"):
            return _run_qm(settings, conn, job_id, plan, on_progress)
        cells = resolve_cells(conn, plan)
        if plan.date_to > datetime.now(timezone.utc).date() - timedelta(days=LATEST_LAG_DAYS):
            log.warning("job %s: 'to' %s dentro do lag do ERA5-Land; os últimos dias podem faltar", job_id, plan.date_to)
        return _ingest_cells(
            settings,
            conn,
            command=f"worker {job_name}#{job_id} {describe(plan)}",
            cells=cells,
            date_from=plan.date_from,
            date_to=plan.date_to,
            job_id=job_id,
            on_progress=on_progress,
        )


def sweep_orphans(settings: Settings) -> int:
    with db.connect(settings.database_url) as conn:
        return db.mark_orphaned_runs(conn, ORPHAN_HOURS)


async def _serve(settings: Settings) -> int:
    from bullmq import Worker  # import tardio: o CLI puro não precisa do pacote

    redis_url = settings.require_redis_url()
    # a chave do CDS só é exigida nos jobs de ingestão (station-import e qm não a usam)
    loop = asyncio.get_running_loop()

    orphans = await asyncio.to_thread(sweep_orphans, settings)
    if orphans:
        log.warning("%d run(s) RUNNING sem heartbeat há > %d h marcada(s) como FAILED (orphaned)", orphans, ORPHAN_HOURS)

    async def process(job, token: str):
        plan = plan_job(job.data, datetime.now(timezone.utc).date())
        log.info("job %s (%s): %s", job.id, job.name, describe(plan))

        def on_progress(done: int, total: int) -> None:
            # chamado na thread de trabalho; o updateProgress é assíncrono no loop
            loop.call_soon_threadsafe(
                lambda: asyncio.ensure_future(job.updateProgress({"periodsDone": done, "periodsTotal": total}))
            )

        summary = await asyncio.to_thread(_run_job, settings, str(job.id), job.name, plan, on_progress)
        return {"runId": summary.run_id, "cells": summary.cells, "rows": summary.rows, "note": summary.note}

    worker = Worker(QUEUE, process, {"connection": redis_url, "concurrency": CONCURRENCY})
    worker.on("completed", lambda job, result: log.info("job %s concluído: %s", job.id, result))
    worker.on("failed", lambda job, err: log.error("job %s falhou (tentativa %s): %s", getattr(job, "id", "?"), getattr(job, "attemptsMade", "?"), err))
    worker.on("error", lambda err, *_: log.error("worker: %s", err))

    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker no ar: fila %s, concorrência %d, cache %s", QUEUE, CONCURRENCY, settings.cache_dir)

    await stop.wait()
    log.info("sinal recebido; concluindo o job ativo e encerrando...")
    await worker.close()  # espera o job em curso; não pega novos
    log.info("encerrado.")
    return 0


def run_worker(settings: Settings) -> int:
    try:
        return asyncio.run(_serve(settings))
    except ConfigError:
        raise
    except KeyboardInterrupt:
        return 0
