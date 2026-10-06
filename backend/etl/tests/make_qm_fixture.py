"""Fixture do roteiro e2e-qm.sh: 10 anos sintéticos para uma célula e uma
"estação" a ~10 km, com viés conhecido.

    python -m tests.make_qm_fixture --cell -16.7 -49.3 --out-dir /data/station-imports

Gera ``qm_era5_synthetic.sql`` (linhas de era5_daily_data, source='synthetic-qm',
2014–2023) e ``qm_station_synthetic.csv`` (genérico, estação SYN-GYN).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from era5.synthetic import synthetic_era5, synthetic_obs

STATION_CODE = "SYN-GYN"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", nargs=2, type=float, required=True)
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--years", type=int, default=10)
    args = ap.parse_args()
    lat, lon = args.cell
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    dates, era5 = synthetic_era5(args.years)
    obs = synthetic_obs(era5)

    sql = out / "qm_era5_synthetic.sql"
    with sql.open("w") as fh:
        fh.write("INSERT INTO era5_daily_data (time, cell_lat, cell_lon, t2m_max, t2m_min, t2m_mean, d2m_mean, u2, rn, tp_raw, tp_corrected, qm_applied, source) VALUES\n")
        rows = [f"('{d}',{lat},{lon},30,18,24,17,1.5,12,{v:.3f},{v:.3f},false,'synthetic-qm')" for d, v in zip(dates, era5)]
        fh.write(",\n".join(rows))
        fh.write("\nON CONFLICT (time, cell_lat, cell_lon) DO UPDATE SET tp_raw = EXCLUDED.tp_raw, tp_corrected = EXCLUDED.tp_corrected, qm_applied = false, qm_calibration_id = NULL, source = EXCLUDED.source;\n")

    csv = out / "qm_station_synthetic.csv"
    with csv.open("w") as fh:
        fh.write("station_code,date,precip_mm\n")
        for d, v in zip(dates, obs):
            fh.write(f"{STATION_CODE},{d},{v:.3f}\n")
    print(f"{sql} ({len(dates)} linhas)\n{csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
