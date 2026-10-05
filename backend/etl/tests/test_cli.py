from datetime import date

import pytest

from era5 import cli
from era5.config import ConfigError, Settings


def test_latest_window():
    assert cli.latest_window(date(2026, 10, 5)) == (date(2026, 9, 19), date(2026, 9, 29))


def test_settings_require_cds_key():
    s = Settings.from_env({"DATABASE_URL": "postgresql://x", "CDS_API_KEY": ""})
    assert s.cds_api_key is None
    with pytest.raises(ConfigError, match="CDS_API_KEY"):
        s.require_cds_key()


def test_settings_reject_old_key_format():
    s = Settings.from_env({"DATABASE_URL": "postgresql://x", "CDS_API_KEY": "1234:abcd"})
    with pytest.raises(ConfigError, match="uid:key"):
        s.require_cds_key()


def test_settings_defaults():
    s = Settings.from_env({"DATABASE_URL": "postgresql://x"})
    assert s.cds_api_url == "https://cds.climate.copernicus.eu/api"
    assert s.cache_dir == "./cache"


def test_settings_require_database_url():
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        Settings.from_env({})


def test_parser_subcommands():
    p = cli.build_parser()
    args = p.parse_args(["ingest", "--from", "2025-11-01", "--to", "2025-11-03"])
    assert args.date_from == date(2025, 11, 1) and args.date_to == date(2025, 11, 3)
    assert p.parse_args(["ingest", "--latest"]).latest is True
    assert p.parse_args(["backfill", "--harvest", "abc"]).harvest == "abc"
    assert p.parse_args(["status", "--limit", "3"]).limit == 3
    with pytest.raises(SystemExit):
        p.parse_args(["ingest", "--from", "01/11/2025", "--to", "2025-11-03"])
