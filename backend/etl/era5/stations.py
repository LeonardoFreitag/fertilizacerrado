"""Importação de observações diárias de estações (CSV BDMEP/INMET ou genérico).

BDMEP (https://bdmep.inmet.gov.br, exige login): cabeçalho de metadados
(``Nome:``, ``Codigo Estacao:``, ``Latitude:``, ``Longitude:``, ``Altitude:``…),
depois a linha de colunas e os dados com ``;`` e vírgula decimal. Genérico:
``station_code,date,precip_mm[,tmax,tmin]`` com ponto decimal.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterator

FORMATS = ("bdmep", "generic")
SOURCES = ("INMET", "ANA", "OUTRA")


class ImportError_(RuntimeError):
    """Arquivo sem o formato esperado."""


@dataclass(frozen=True)
class StationMeta:
    code: str
    name: str
    source: str
    lat: float
    lon: float
    altitude_m: float | None = None

    @classmethod
    def parse_auto(cls, text: str, codes_in_file: list[str]) -> "StationMeta":
        """Detecta se o texto traz o código: ``codigo;nome;FONTE;...`` tem a fonte na 3ª
        posição; ``nome;FONTE;...`` na 2ª (o código vem então do CSV, que deve ter uma só estação)."""
        parts = [p.strip() for p in text.split(";")]
        if len(parts) >= 3 and parts[2].upper() in SOURCES:
            return cls.parse(text)
        if len(parts) >= 2 and parts[1].upper() in SOURCES:
            if len(codes_in_file) != 1:
                raise ImportError_("metadados sem código exigem CSV com uma única estação (ou use codigo;nome;FONTE;lat;lon[;alt])")
            return cls.parse(text, code=codes_in_file[0])
        raise ImportError_("metadados da estação: use codigo;nome;FONTE;lat;lon[;alt] ou nome;FONTE;lat;lon[;alt] (FONTE: INMET, ANA ou OUTRA)")

    @classmethod
    def parse(cls, text: str, code: str | None = None) -> "StationMeta":
        """``nome;FONTE;lat;lon[;alt]`` (ou com código na frente: ``codigo;nome;FONTE;lat;lon[;alt]``)."""
        parts = [p.strip() for p in text.split(";")]
        if code is None:
            if len(parts) < 5:
                raise ImportError_("--station-meta: use codigo;nome;FONTE;lat;lon[;alt]")
            code, parts = parts[0], parts[1:]
        if len(parts) < 4:
            raise ImportError_("--station-meta: use nome;FONTE;lat;lon[;alt]")
        name, source, lat, lon = parts[:4]
        alt = parts[4] if len(parts) > 4 and parts[4] else None
        source = source.upper()
        if source not in SOURCES:
            raise ImportError_(f"fonte {source!r} inválida (use INMET, ANA ou OUTRA)")
        return cls(code, name, source, float(lat.replace(",", ".")), float(lon.replace(",", ".")), None if alt is None else float(alt.replace(",", ".")))


@dataclass
class Observation:
    station_code: str
    date: date
    precip_mm: float | None
    tmax: float | None = None
    tmin: float | None = None


@dataclass
class ParsedFile:
    station: StationMeta | None
    observations: list[Observation] = field(default_factory=list)
    invalid_rows: int = 0
    warnings: list[str] = field(default_factory=list)


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _num(value: str | None) -> float | None:
    if value is None:
        return None
    v = value.strip()
    if v == "" or v.lower() in ("null", "nan", "na", "-", "-9999", "-9999.0"):
        return None
    try:
        return float(v.replace(",", "."))
    except ValueError:
        return None


def _date(value: str) -> date | None:
    v = value.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def _read_text(path: str | Path) -> str:
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


# --- BDMEP -------------------------------------------------------------------

_META_KEYS = {
    "nome": "name",
    "codigo estacao": "code",
    "latitude": "lat",
    "longitude": "lon",
    "altitude": "altitude_m",
}


def _find_column(header: list[str], *prefixes: str) -> int | None:
    norm = [_strip_accents(h).strip().upper() for h in header]
    for i, h in enumerate(norm):
        for p in prefixes:
            if h.startswith(p):
                return i
    return None


def parse_bdmep(path: str | Path) -> ParsedFile:
    text = _read_text(path)
    lines = text.splitlines()
    meta: dict[str, str] = {}
    header_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if ":" in stripped and ";" not in stripped.split(":")[0]:
            key, _, value = stripped.partition(":")
            k = _strip_accents(key).strip().lower()
            if k in _META_KEYS:
                meta[_META_KEYS[k]] = value.strip().rstrip(";").strip()
            continue
        if ";" in stripped and _strip_accents(stripped).upper().startswith("DATA"):
            header_idx = i
            break
    if header_idx is None:
        raise ImportError_("BDMEP: linha de cabeçalho 'Data Medicao;...' não encontrada")
    missing = [k for k in ("code", "lat", "lon") if k not in meta]
    if missing:
        raise ImportError_(f"BDMEP: metadados ausentes no cabeçalho: {', '.join(missing)}")

    header = [h.strip() for h in lines[header_idx].split(";")]
    i_date = _find_column(header, "DATA")
    i_prec = _find_column(header, "PRECIPITACAO TOTAL")
    i_tmax = _find_column(header, "TEMPERATURA MAXIMA")
    i_tmin = _find_column(header, "TEMPERATURA MINIMA")
    if i_date is None or i_prec is None:
        raise ImportError_("BDMEP: colunas 'Data Medicao' e 'PRECIPITACAO TOTAL' são obrigatórias")

    station = StationMeta(
        code=meta["code"],
        name=meta.get("name", meta["code"]),
        source="INMET",
        lat=float(meta["lat"].replace(",", ".")),
        lon=float(meta["lon"].replace(",", ".")),
        altitude_m=_num(meta.get("altitude_m")),
    )
    parsed = ParsedFile(station)
    for line in lines[header_idx + 1 :]:
        if not line.strip():
            continue
        cols = line.split(";")
        d = _date(cols[i_date]) if i_date < len(cols) else None
        if d is None:
            parsed.invalid_rows += 1
            continue
        parsed.observations.append(
            Observation(
                station.code,
                d,
                _num(cols[i_prec]) if i_prec < len(cols) else None,
                _num(cols[i_tmax]) if i_tmax is not None and i_tmax < len(cols) else None,
                _num(cols[i_tmin]) if i_tmin is not None and i_tmin < len(cols) else None,
            )
        )
    return parsed


# --- genérico -------------------------------------------------------------------


def parse_generic(path: str | Path) -> ParsedFile:
    text = _read_text(path)
    reader = csv.DictReader(io.StringIO(text))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "station_code" not in fields or "date" not in fields or "precip_mm" not in fields:
        raise ImportError_("genérico: colunas obrigatórias station_code, date, precip_mm")
    parsed = ParsedFile(None)
    codes: set[str] = set()
    for row in reader:
        r = {k.strip().lower(): v for k, v in row.items() if k}
        code = (r.get("station_code") or "").strip()
        d = _date(r.get("date") or "")
        if not code or d is None:
            parsed.invalid_rows += 1
            continue
        codes.add(code)
        parsed.observations.append(Observation(code, d, _num(r.get("precip_mm")), _num(r.get("tmax")), _num(r.get("tmin"))))
    if len(codes) > 1:
        parsed.warnings.append(f"arquivo com {len(codes)} estações: {', '.join(sorted(codes))}")
    return parsed


def parse_file(path: str | Path, fmt: str) -> ParsedFile:
    if fmt == "bdmep":
        return parse_bdmep(path)
    if fmt == "generic":
        return parse_generic(path)
    raise ImportError_(f"formato desconhecido: {fmt} (use {', '.join(FORMATS)})")


def iter_rows(observations: list[Observation]) -> Iterator[tuple]:
    for o in observations:
        yield (o.station_code, o.date, o.precip_mm, o.tmax, o.tmin)


@dataclass
class ImportSummary:
    stations: list[str]
    rows: int
    invalid_rows: int
    warnings: list[str]


def import_file(conn, path: str | Path, fmt: str, meta: StationMeta | None = None, source_file: str | None = None) -> ImportSummary:
    """Parse + upsert da estação e das observações. ``meta`` é obrigatório no
    genérico quando a estação ainda não existe."""
    from . import db  # import tardio: os parsers não dependem do banco

    parsed = parse_file(path, fmt)
    station = parsed.station or meta
    codes = sorted({o.station_code for o in parsed.observations})
    if station is not None:
        db.upsert_station(conn, station)
    for code in codes:
        if station is not None and code == station.code:
            continue
        if not db.station_exists(conn, code):
            raise ImportError_(f"estação {code} não cadastrada: informe --station-meta (nome;FONTE;lat;lon[;alt])")
    rows = db.upsert_obs(conn, iter_rows(parsed.observations), source_file or str(Path(path).name))
    return ImportSummary(codes if codes else ([station.code] if station else []), rows, parsed.invalid_rows, parsed.warnings)
