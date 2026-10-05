"""Gera ``fixtures/era5_synthetic.nc`` (e a variante com ``expver``): 1 célula
(−16,7; −49,3), 4 dias horários de 2025-11-01 a 2025-11-04 mais o passo
00 UTC de 2025-11-05, com valores escolhidos para cálculo à mão.

Convenção dos acumulados reproduzida fielmente: o passo 00 UTC de um dia
carrega o total do dia anterior; dentro do dia, o valor cresce com a hora.

Dia 1: t2m rampa 290,15 → 301,65 K (17,0 → 28,5 °C); tp 1 mm/h (24 mm);
       ssr 20 MJ, str −5 MJ (rn 15); u10 = 3, v10 = 4 (5 m/s → u2 3,74)
Dia 2: t2m 295,15 K constante; tp 0; ssr 16, str −4 (rn 12); vento idem
Dia 3: t2m 293,15 K; tp 0,5 mm/h (12 mm); ssr 10, str −2 (rn 8);
       u10 alterna +5/−5, v10 = 0 (média dos componentes = 0; velocidade 5)
Dia 4: t2m 296,15 K; tp 2 mm/h (48 mm); ssr 18, str −6 (rn 12); vento dia 1

Rode ``python -m tests.make_fixture`` em ``backend/etl`` para regenerar.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

FIXTURES = Path(__file__).parent / "fixtures"
START = "2025-11-01T00:00:00"
STEPS = 4 * 24 + 1  # 4 dias + 00 UTC do 5º
LAT, LON = -16.7, -49.3

DAY_SPEC = [
    # (t2m por hora, d2m K, tp m/h, ssr J, str J, u10 por hora, v10 por hora)
    dict(t2m=lambda h: 290.15 + 0.5 * h, d2m=291.15, tp=0.001, ssr=20e6, str=-5e6, u10=lambda h: 3.0, v10=lambda h: 4.0),
    dict(t2m=lambda h: 295.15, d2m=290.15, tp=0.0, ssr=16e6, str=-4e6, u10=lambda h: 3.0, v10=lambda h: 4.0),
    dict(t2m=lambda h: 293.15, d2m=289.15, tp=0.0005, ssr=10e6, str=-2e6, u10=lambda h: 5.0 if h % 2 == 0 else -5.0, v10=lambda h: 0.0),
    dict(t2m=lambda h: 296.15, d2m=292.15, tp=0.002, ssr=18e6, str=-6e6, u10=lambda h: 3.0, v10=lambda h: 4.0),
]


def build() -> xr.Dataset:
    times = pd.date_range(START, periods=STEPS, freq="h")
    data = {v: np.zeros(STEPS) for v in ("t2m", "d2m", "u10", "v10", "tp", "ssr", "str")}
    for i, t in enumerate(times):
        day = (t.normalize() - pd.Timestamp(START)).days
        hour = t.hour
        spec = DAY_SPEC[min(day, 3)]
        if day < 4:
            data["t2m"][i] = spec["t2m"](hour)
            data["d2m"][i] = spec["d2m"]
            data["u10"][i] = spec["u10"](hour)
            data["v10"][i] = spec["v10"](hour)
        # acumulados: na hora 0 vale o total do dia anterior; depois cresce com a hora
        if hour == 0:
            prev = DAY_SPEC[day - 1] if day > 0 else None
            data["tp"][i] = prev["tp"] * 24 if prev else 0.0
            data["ssr"][i] = prev["ssr"] if prev else 0.0
            data["str"][i] = prev["str"] if prev else 0.0
        else:
            data["tp"][i] = spec["tp"] * hour
            data["ssr"][i] = spec["ssr"] * hour / 24
            data["str"][i] = spec["str"] * hour / 24

    ds = xr.Dataset(
        {v: (("valid_time", "latitude", "longitude"), arr.reshape(STEPS, 1, 1).astype("float32")) for v, arr in data.items()},
        coords={"valid_time": times, "latitude": [LAT], "longitude": [LON]},
        attrs={"title": "fixture sintética ERA5-Land para testes do ETL FertilizaCerrado"},
    )
    ds["t2m"].attrs["units"] = ds["d2m"].attrs["units"] = "K"
    ds["tp"].attrs["units"] = "m"
    ds["ssr"].attrs["units"] = ds["str"].attrs["units"] = "J m**-2"
    ds["u10"].attrs["units"] = ds["v10"].attrs["units"] = "m s**-1"
    return ds


def build_expver(ds: xr.Dataset) -> xr.Dataset:
    """Mesmos dados em duas fatias complementares (ERA5 = 1, ERA5T = 5)."""
    half = STEPS // 2
    final = ds.isel(valid_time=slice(0, half))
    preliminary = ds.isel(valid_time=slice(half, None))
    a = final.reindex(valid_time=ds["valid_time"]).expand_dims(expver=[1])
    b = preliminary.reindex(valid_time=ds["valid_time"]).expand_dims(expver=[5])
    return xr.concat([a, b], dim="expver")


def main() -> None:
    FIXTURES.mkdir(exist_ok=True)
    ds = build()
    ds.to_netcdf(FIXTURES / "era5_synthetic.nc")
    build_expver(ds).to_netcdf(FIXTURES / "era5_synthetic_expver.nc")
    print("fixtures gravadas em", FIXTURES)


if __name__ == "__main__":
    main()
