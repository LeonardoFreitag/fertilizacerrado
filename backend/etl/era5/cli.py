"""Entrypoint: ``python -m era5.cli {ingest,backfill,status}``.

Toda execução de ``ingest``/``backfill`` grava uma linha em
``era5_ingestion_runs`` (RUNNING → SUCCEEDED/FAILED). Erros saem com código 1.
"""

from __future__ import annotations

import argparse
import logging
import shlex
import sys
from datetime import date, datetime, timedelta, timezone

from . import db, download, load, transform
from .config import ConfigError, Settings

log = logging.getLogger("era5")

LATEST_LAG_DAYS = 6  # lag de ~5 dias do ERA5-Land + margem
LATEST_WINDOW_DAYS = 10


def latest_window(today: date) -> tuple[date, date]:
    """``[hoje − 16, hoje − 6]``: cobre o lag e sobrepõe a semana anterior."""
    end = today - timedelta(days=LATEST_LAG_DAYS)
    return end - timedelta(days=LATEST_WINDOW_DAYS), end


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"data inválida: {value} (use AAAA-MM-DD)") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="era5", description="Ingestão ERA5-Land (CDS → TimescaleDB)")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="ingere todas as células de era5_cells")
    ingest.add_argument("--from", dest="date_from", type=parse_date)
    ingest.add_argument("--to", dest="date_to", type=parse_date)
    ingest.add_argument("--latest", action="store_true", help=f"janela [hoje−{LATEST_LAG_DAYS + LATEST_WINDOW_DAYS}, hoje−{LATEST_LAG_DAYS}]")

    backfill = sub.add_parser("backfill", help="ingere a célula do talhão de uma safra, da emergência a hoje−6")
    backfill.add_argument("--harvest", required=True, help="id (uuid) da safra")

    status = sub.add_parser("status", help="últimas execuções")
    status.add_argument("--limit", type=int, default=10)
    return parser


def _ingest_cells(
    settings: Settings,
    conn,
    *,
    command: str,
    cells: list[tuple[float, float]],
    date_from: date,
    date_to: date,
) -> int:
    run_id = db.open_run(conn, command, date_from, date_to)
    log.info("run %s: %d célula(s), %s → %s", run_id, len(cells), date_from, date_to)
    try:
        if not cells:
            log.warning("nenhuma célula em era5_cells; nada a ingerir")
            db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=0, rows_upserted=0)
            return 0

        client = download.make_client(settings)
        bbox = download.grid_bbox(cells)
        paths = download.fetch_range(client, bbox, date_from, date_to, settings.cache_dir)
        ds = transform.open_hourly(paths)

        total = 0
        skipped: list[tuple[float, float]] = []
        incomplete_total = 0
        for cell in cells:
            selection = transform.select_cell(ds, *cell)
            if selection is None:
                log.warning("célula %s a mais de %.2f° do nó mais próximo; pulada", cell, transform.NEAREST_TOLERANCE_DEG)
                skipped.append(cell)
                continue
            result = transform.aggregate_daily(selection.data, date_from, date_to)
            incomplete_total += len(result.incomplete_days)
            total += load.load_frame(conn, result.frame, cell)
            log.info("célula %s: %d dia(s) gravado(s), %d incompleto(s)", cell, len(result.frame), len(result.incomplete_days))

        note = None
        if skipped or incomplete_total:
            note = f"células puladas: {len(skipped)}; dias incompletos: {incomplete_total}"
        db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(cells), rows_upserted=total, error=note)
        log.info("concluído: %d linha(s) gravada(s)%s", total, f" ({note})" if note else "")
        return 0
    except Exception as exc:  # noqa: BLE001 — qualquer falha fecha a run como FAILED
        db.close_run(conn, run_id, status="FAILED", cells_requested=len(cells), error=f"{type(exc).__name__}: {exc}")
        raise


def cmd_ingest(args, settings: Settings, conn, command: str) -> int:
    if args.latest:
        date_from, date_to = latest_window(datetime.now(timezone.utc).date())
    elif args.date_from and args.date_to:
        date_from, date_to = args.date_from, args.date_to
    else:
        raise ConfigError("informe --from e --to, ou --latest")
    if date_from > date_to:
        raise ConfigError("--from posterior a --to")
    settings.require_cds_key()
    return _ingest_cells(settings, conn, command=command, cells=db.distinct_cells(conn), date_from=date_from, date_to=date_to)


def cmd_backfill(args, settings: Settings, conn, command: str) -> int:
    settings.require_cds_key()
    info = db.harvest_cell(conn, args.harvest)
    if info is None:
        run_id = db.open_run(conn, command, None, None)
        db.close_run(conn, run_id, status="FAILED", error=f"safra {args.harvest} não encontrada ou sem célula ERA5")
        raise ConfigError(f"safra {args.harvest} não encontrada (ou talhão sem célula em era5_cells)")
    date_to = datetime.now(timezone.utc).date() - timedelta(days=LATEST_LAG_DAYS)
    if info.emergence_date > date_to:
        raise ConfigError(f"emergência {info.emergence_date} ainda dentro do lag do ERA5-Land (até {date_to})")
    return _ingest_cells(settings, conn, command=command, cells=[info.cell], date_from=info.emergence_date, date_to=date_to)


def cmd_status(args, conn) -> int:
    runs = db.recent_runs(conn, args.limit)
    if not runs:
        print("nenhuma execução registrada")
        return 0
    print(f"{'iniciada em (UTC)':20} {'status':9} {'intervalo':23} {'cél.':>4} {'linhas':>6}  comando / erro")
    for r in runs:
        started = r["started_at"].strftime("%Y-%m-%d %H:%M:%S")
        interval = f"{r['date_from']} → {r['date_to']}" if r["date_from"] else "-"
        cells = "" if r["cells_requested"] is None else str(r["cells_requested"])
        rows = "" if r["rows_upserted"] is None else str(r["rows_upserted"])
        tail = r["command"] + (f"  [{r['error']}]" if r["error"] else "")
        print(f"{started:20} {r['status']:9} {interval:23} {cells:>4} {rows:>6}  {tail}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    command = "era5 " + " ".join(shlex.quote(a) for a in argv)
    try:
        settings = Settings.from_env()
        with db.connect(settings.database_url) as conn:
            if args.command == "status":
                return cmd_status(args, conn)
            if args.command == "ingest":
                return cmd_ingest(args, settings, conn, command)
            if args.command == "backfill":
                return cmd_backfill(args, settings, conn, command)
            raise ConfigError(f"comando desconhecido: {args.command}")
    except ConfigError as exc:
        log.error("%s", exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        log.error("%s: %s", type(exc).__name__, exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
