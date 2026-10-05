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

from . import db
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
    date_from: date
    date_to: date
    bbox: tuple[float, float, float, float] | None = None
    cell: tuple[float, float] | None = None


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
    raise InvalidJob(f"kind desconhecido: {kind!r}")


def resolve_cells(conn, plan: JobPlan) -> list[tuple[float, float]]:
    if plan.kind == "cell":
        return [plan.cell]  # type: ignore[list-item]
    if plan.kind == "range" and plan.bbox is not None:
        return db.cells_in_bbox(conn, plan.bbox)
    return db.distinct_cells(conn)


def describe(plan: JobPlan) -> str:
    target = plan.cell if plan.kind == "cell" else (plan.bbox if plan.bbox else "todas as células")
    return f"{plan.kind} {plan.date_from}→{plan.date_to} {target}"


def _run_job(settings: Settings, job_id: str, job_name: str, plan: JobPlan, on_progress) -> IngestSummary:
    """Executado em thread: conexão própria, run com ``job_id``."""
    with db.connect(settings.database_url) as conn:
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
    settings.require_cds_key()
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
