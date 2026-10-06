from datetime import date
from pathlib import Path

import pytest

from era5 import stations

FIX = Path(__file__).parent / "fixtures"


def test_parse_bdmep_metadata_and_rows():
    p = stations.parse_bdmep(FIX / "bdmep_sample.csv")
    assert p.station is not None
    assert p.station.code == "83423" and p.station.name == "GOIANIA" and p.station.source == "INMET"
    assert p.station.lat == -16.64 and p.station.lon == -49.22 and p.station.altitude_m == 741.48
    assert len(p.observations) == 5 and p.invalid_rows == 1
    o = {x.date: x for x in p.observations}
    assert o[date(2020, 1, 1)].precip_mm == 12.4 and o[date(2020, 1, 1)].tmax == 31.2
    assert o[date(2020, 1, 3)].precip_mm is None and o[date(2020, 1, 3)].tmin is None
    assert o[date(2020, 1, 4)].precip_mm is None  # "null"
    assert o[date(2020, 1, 5)].precip_mm == 45.7


def test_parse_generic_dates_and_invalid_rows():
    p = stations.parse_generic(FIX / "generic_sample.csv")
    assert p.station is None
    assert [x.date for x in p.observations] == [date(2020, 1, 1), date(2020, 1, 2), date(2020, 1, 2)]
    assert p.observations[1].tmax is None
    assert p.invalid_rows == 1


def test_missing_columns(tmp_path):
    bad = tmp_path / "x.csv"
    bad.write_text("codigo,dia,chuva\n1,2,3\n")
    with pytest.raises(stations.ImportError_):
        stations.parse_generic(bad)
    bad.write_text("Nome: X\n\nData;Temp\n2020-01-01;1\n")
    with pytest.raises(stations.ImportError_):
        stations.parse_bdmep(bad)


def test_station_meta_parse():
    m = stations.StationMeta.parse("Goiânia sintética;INMET;-16,62;-49,25;750", code="SYN-GYN")
    assert m.lat == -16.62 and m.altitude_m == 750 and m.source == "INMET"
    with pytest.raises(stations.ImportError_):
        stations.StationMeta.parse("x;FONTE;1;2", code="A")
    full = stations.StationMeta.parse("B;Nome;ANA;-1;-2")
    assert full.code == "B" and full.altitude_m is None
    # detecção automática: com e sem código, inclusive 5 partes com altitude
    assert stations.StationMeta.parse_auto("Goiânia sintética;INMET;-16.62;-49.25;750", ["SYN-GYN"]).code == "SYN-GYN"
    assert stations.StationMeta.parse_auto("SYN-GYN;Goiânia;INMET;-16.62;-49.25", []).code == "SYN-GYN"
    with pytest.raises(stations.ImportError_):
        stations.StationMeta.parse_auto("Goiânia;INMET;-16.62;-49.25", ["A", "B"])
