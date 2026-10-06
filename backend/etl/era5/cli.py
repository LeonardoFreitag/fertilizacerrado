"""Entrypoint: ``python -m era5.cli {ingest,backfill,status,worker}``.

Toda execução de ``ingest``/``backfill`` (e todo job do ``worker``) grava uma
linha em ``era5_ingestion_runs`` (RUNNING → SUCCEEDED/FAILED). Erros saem com
código 1.
"""

from __future__ import annotations

import argparse
import logging
import shlex
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from . import db, download, load, qm_ops, stations, transform
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

    sub.add_parser("worker", help="consome a fila BullMQ era5-ingest até receber SIGTERM")

    st = sub.add_parser("stations", help="estações meteorológicas e observações").add_subparsers(dest="stations_cmd", required=True)
    st_import = st.add_parser("import", help="importa CSV de observações diárias")
    st_import.add_argument("path")
    st_import.add_argument("--format", choices=stations.FORMATS, required=True)
    st_import.add_argument("--station-meta", help="genérico: 'codigo;nome;FONTE;lat;lon[;alt]' (ou sem código se o CSV tiver uma só estação)")
    st.add_parser("list", help="lista estações e cobertura")

    q = sub.add_parser("qm", help="correção de viés (Quantile Mapping)").add_subparsers(dest="qm_cmd", required=True)
    q_cal = q.add_parser("calibrate", help="calibra uma célula (ou todas) contra a estação mais próxima elegível")
    q_cal.add_argument("--cell", nargs=2, type=float, metavar=("LAT", "LON"))
    q_cal.add_argument("--station", help="código da estação (opcional; padrão: a mais próxima elegível)")
    q_cal.add_argument("--auto", action="store_true", help="todas as células de era5_cells")
    q_cal.add_argument("--from", dest="date_from", type=parse_date)
    q_cal.add_argument("--to", dest="date_to", type=parse_date)
    q_cal.add_argument("--no-apply", action="store_true")
    q_apply = q.add_parser("apply", help="reaplica a calibração ativa às linhas existentes")
    q_apply.add_argument("--cell", nargs=2, type=float, metavar=("LAT", "LON"))
    q_apply.add_argument("--all", action="store_true")
    q.add_parser("status", help="calibrações por célula")
    q_val = q.add_parser("validate", help="Caso 4: calibra em A, avalia em B")
    q_val.add_argument("--cell", nargs=2, type=float, metavar=("LAT", "LON"), required=True)
    q_val.add_argument("--station", required=True)
    q_val.add_argument("--calib-years", required=True, help="ex.: 2010-2019")
    q_val.add_argument("--test-years", required=True, help="ex.: 2020-2024")
    q_val.add_argument("--csv", help="arquivo de saída")
    return parser


@dataclass(frozen=True)
class IngestSummary:
    run_id: str
    cells: int
    rows: int
    note: str | None


def _ingest_cells(
    settings: Settings,
    conn,
    *,
    command: str,
    cells: list[tuple[float, float]],
    date_from: date,
    date_to: date,
    job_id: str | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> IngestSummary:
    """Abre a run, baixa, transforma e grava; fecha a run como SUCCEEDED ou
    FAILED (e relança). ``on_progress(concluídos, total)`` a cada período
    (mês/trimestre) obtido; cada período e cada célula gravada renovam o
    heartbeat ``updated_at`` da run."""
    run_id = db.open_run(conn, command, date_from, date_to, job_id=job_id)
    log.info("run %s: %d célula(s), %s → %s", run_id, len(cells), date_from, date_to)
    try:
        if not cells:
            log.warning("nenhuma célula em era5_cells; nada a ingerir")
            db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=0, rows_upserted=0)
            return IngestSummary(run_id, 0, 0, None)

        def progress(done: int, total: int) -> None:
            db.touch_run(conn, run_id)
            if on_progress:
                on_progress(done, total)

        client = download.make_client(settings)
        bbox = download.grid_bbox(cells)
        paths = download.fetch_range(client, bbox, date_from, date_to, settings.cache_dir, on_progress=progress)
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
            db.touch_run(conn, run_id)
            log.info("célula %s: %d dia(s) gravado(s), %d incompleto(s)", cell, len(result.frame), len(result.incomplete_days))

        note = None
        if skipped or incomplete_total:
            note = f"células puladas: {len(skipped)}; dias incompletos: {incomplete_total}"
        db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(cells), rows_upserted=total, error=note)
        log.info("concluído: %d linha(s) gravada(s)%s", total, f" ({note})" if note else "")
        return IngestSummary(run_id, len(cells), total, note)
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
    _ingest_cells(settings, conn, command=command, cells=db.distinct_cells(conn), date_from=date_from, date_to=date_to)
    return 0


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
    _ingest_cells(settings, conn, command=command, cells=[info.cell], date_from=info.emergence_date, date_to=date_to)
    return 0


def cmd_stations(args, settings: Settings, conn) -> int:
    if args.stations_cmd == "list":
        rows = db.list_stations(conn)
        if not rows:
            print("nenhuma estação cadastrada")
            return 0
        print(f"{'código':10} {'nome':28} {'fonte':6} {'lat':>8} {'lon':>8} {'obs':>6}  período")
        for r in rows:
            per = f"{r['obs_from']} → {r['obs_to']}" if r["obs_from"] else "-"
            print(f"{r['code']:10} {r['name'][:28]:28} {r['source']:6} {r['lat']:8.3f} {r['lon']:8.3f} {r['obs_count']:6}  {per}{'' if r['active'] else '  (inativa)'}")
        return 0
    meta = None
    if args.station_meta:
        parsed = stations.parse_file(args.path, args.format)
        meta = stations.StationMeta.parse_auto(args.station_meta, sorted({o.station_code for o in parsed.observations}))
    run_id = db.open_run(conn, f"era5 stations import {args.path} --format {args.format}", None, None)
    try:
        summary = stations.import_file(conn, args.path, args.format, meta)
        note = "; ".join(summary.warnings + ([f"linhas inválidas: {summary.invalid_rows}"] if summary.invalid_rows else [])) or None
        db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(summary.stations), rows_upserted=summary.rows, error=note)
        log.info("importadas %d observação(ões) de %s%s", summary.rows, ", ".join(summary.stations), f" ({note})" if note else "")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.close_run(conn, run_id, status="FAILED", error=f"{type(exc).__name__}: {exc}")
        raise


def _print_calibrate(results) -> None:
    for r in results:
        if r.calibration_id:
            print(f"célula {r.cell}: calibrada com {r.station_code} ({r.distance_km:.1f} km, {r.years:.1f} anos) — {r.calibration_id} — {r.rows_applied} linha(s) corrigida(s)")
        else:
            print(f"célula {r.cell}: SEM calibração — {'; '.join(r.warnings)}")
        for w in (r.warnings if r.calibration_id else []):
            print(f"  aviso: {w}")


def cmd_qm(args, settings: Settings, conn) -> int:
    if args.qm_cmd == "calibrate":
        if not args.auto and not args.cell:
            raise ConfigError("informe --cell LAT LON ou --auto")
        command = "era5 qm calibrate " + ("--auto" if args.auto else f"--cell {args.cell[0]} {args.cell[1]}" + (f" --station {args.station}" if args.station else ""))
        run_id = db.open_run(conn, command, args.date_from, args.date_to)
        try:
            if args.auto:
                results = qm_ops.calibrate_auto(conn, settings, args.date_from, args.date_to)
            else:
                results = [qm_ops.calibrate_cell(conn, settings, (args.cell[0], args.cell[1]), args.station, args.date_from, args.date_to, do_apply=not args.no_apply)]
            _print_calibrate(results)
            ok = [r for r in results if r.calibration_id]
            note = None if len(ok) == len(results) else f"células sem estação elegível: {len(results) - len(ok)}"
            db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=len(results), rows_upserted=sum(r.rows_applied for r in results), error=note)
            return 0
        except Exception as exc:  # noqa: BLE001
            db.close_run(conn, run_id, status="FAILED", error=f"{type(exc).__name__}: {exc}")
            raise
    if args.qm_cmd == "apply":
        if not args.all and not args.cell:
            raise ConfigError("informe --cell LAT LON ou --all")
        run_id = db.open_run(conn, "era5 qm apply " + ("--all" if args.all else f"--cell {args.cell[0]} {args.cell[1]}"), None, None)
        try:
            if args.all:
                out = qm_ops.apply_all(conn)
                for cell, n in out.items():
                    print(f"célula {cell}: {n} linha(s)")
                total, cells = sum(out.values()), len(out)
            else:
                total, cells = qm_ops.apply_cell(conn, (args.cell[0], args.cell[1])), 1
                print(f"{total} linha(s)")
            db.close_run(conn, run_id, status="SUCCEEDED", cells_requested=cells, rows_upserted=total)
            return 0
        except Exception as exc:  # noqa: BLE001
            db.close_run(conn, run_id, status="FAILED", error=f"{type(exc).__name__}: {exc}")
            raise
    if args.qm_cmd == "status":
        rows = db.list_calibrations(conn)
        if not rows:
            print("nenhuma calibração")
            return 0
        print(f"{'célula':16} {'estação':10} {'período':23} {'km':>6} {'ativa':5}  id")
        for r in rows:
            print(f"{str(r['cell_lat'])+','+str(r['cell_lon']):16} {r['station_code']:10} {str(r['period_from'])+' → '+str(r['period_to']):23} {r['distance_km']:6.1f} {'sim' if r['active'] else 'não':5}  {r['id']}")
        return 0
    if args.qm_cmd == "validate":
        rows = qm_ops.validate(conn, settings, (args.cell[0], args.cell[1]), args.station, args.calib_years, args.test_years)
        print(f"{'mês':5} {'dias':>5} {'RMSE bruto':>10} {'RMSE corr':>10} {'PBIAS bruto':>11} {'PBIAS corr':>10} {'f_obs':>6} {'f_bruto':>7} {'f_corr':>6}")
        for r in rows:
            print(f"{r.label:5} {r.n_days:5} {r.rmse_raw:10.2f} {r.rmse_corr:10.2f} {r.pbias_raw:10.1f}% {r.pbias_corr:9.1f}% {r.wet_obs:6.3f} {r.wet_raw:7.3f} {r.wet_corr:6.3f}")
        if args.csv:
            import csv

            with open(args.csv, "w", newline="") as fh:
                w = csv.writer(fh)
                w.writerow(["mes", "dias", "rmse_bruto", "rmse_corrigido", "pbias_bruto", "pbias_corrigido", "frac_chuva_obs", "frac_chuva_bruto", "frac_chuva_corrigido"])
                for r in rows:
                    w.writerow([r.label, r.n_days, f"{r.rmse_raw:.3f}", f"{r.rmse_corr:.3f}", f"{r.pbias_raw:.2f}", f"{r.pbias_corr:.2f}", f"{r.wet_obs:.4f}", f"{r.wet_raw:.4f}", f"{r.wet_corr:.4f}"])
            print(f"CSV salvo em {args.csv}")
        return 0
    raise ConfigError(f"comando desconhecido: qm {args.qm_cmd}")


def cmd_status(args, conn) -> int:
    runs = db.recent_runs(conn, args.limit)
    if not runs:
        print("nenhuma execução registrada")
        return 0
    print(f"{'iniciada em (UTC)':20} {'status':9} {'intervalo':23} {'cél.':>4} {'linhas':>6}  {'job':8}  comando / erro")
    for r in runs:
        started = r["started_at"].strftime("%Y-%m-%d %H:%M:%S")
        interval = f"{r['date_from']} → {r['date_to']}" if r["date_from"] else "-"
        cells = "" if r["cells_requested"] is None else str(r["cells_requested"])
        rows = "" if r["rows_upserted"] is None else str(r["rows_upserted"])
        job = (r["job_id"] or "-")[:8]
        tail = r["command"] + (f"  [{r['error']}]" if r["error"] else "")
        print(f"{started:20} {r['status']:9} {interval:23} {cells:>4} {rows:>6}  {job:8}  {tail}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    command = "era5 " + " ".join(shlex.quote(a) for a in argv)
    try:
        settings = Settings.from_env()
        if args.command == "worker":
            from .worker import run_worker  # import tardio: só o worker precisa do bullmq

            return run_worker(settings)
        with db.connect(settings.database_url) as conn:
            if args.command == "status":
                return cmd_status(args, conn)
            if args.command == "ingest":
                return cmd_ingest(args, settings, conn, command)
            if args.command == "backfill":
                return cmd_backfill(args, settings, conn, command)
            if args.command == "stations":
                return cmd_stations(args, settings, conn)
            if args.command == "qm":
                return cmd_qm(args, settings, conn)
            raise ConfigError(f"comando desconhecido: {args.command}")
    except ConfigError as exc:
        log.error("%s", exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        log.error("%s: %s", type(exc).__name__, exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
