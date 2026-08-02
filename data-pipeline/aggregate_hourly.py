"""Aggregates raw hourly ERA5-Land 2m temperature into daily Tmax/Tmin
netCDF files on true Europe/Paris calendar days (DST-aware) — same file
naming and layout as the CDS daily-statistics path, so
transform_cds_to_cache.py consumes them unchanged.

METHODOLOGY.md §3: this replaces the utc+01:00 fixed-offset compromise
of the throttled daily-statistics dataset.

Usage: .venv-etl/bin/python data-pipeline/aggregate_hourly.py
"""

from __future__ import annotations

import pathlib
import sys
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import xarray as xr

CDS_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "cds"
HOURLY_DIR = CDS_DIR / "hourly"
PARIS = ZoneInfo("Europe/Paris")


def aggregate_year(path: pathlib.Path) -> None:
    year = int(path.stem.split("_")[-1])
    out_tmax = CDS_DIR / f"era5land_tmax_{year}.nc"
    out_tmin = CDS_DIR / f"era5land_tmin_{year}.nc"
    if out_tmax.exists() and out_tmin.exists():
        return

    ds = xr.open_dataset(path)
    tdim = "valid_time" if "valid_time" in ds.dims else "time"
    var = next(iter(ds.data_vars))
    times_utc = pd.to_datetime(ds[tdim].values).tz_localize("UTC")
    local_days = times_utc.tz_convert(PARIS).strftime("%Y-%m-%d").values

    # Keep only hours whose local day belongs to this year (edges spill).
    keep = np.array([d.startswith(str(year)) for d in local_days])
    data = ds[var].values[keep]  # (hours, lat, lon)
    days = local_days[keep]
    ds_days, first_idx = np.unique(days, return_index=True)
    order = np.argsort(first_idx)
    ds_days = ds_days[order]

    day_index = {d: i for i, d in enumerate(ds_days)}
    idx = np.array([day_index[d] for d in days])
    n_days = len(ds_days)
    shape = (n_days, data.shape[1], data.shape[2])
    tmax = np.full(shape, np.nan, dtype=np.float32)
    tmin = np.full(shape, np.nan, dtype=np.float32)
    for day in range(n_days):
        block = data[idx == day]
        with np.errstate(all="ignore"):
            tmax[day] = np.nanmax(block, axis=0)
            tmin[day] = np.nanmin(block, axis=0)

    coords = {
        "valid_time": np.array(ds_days, dtype="datetime64[D]"),
        "latitude": ds["latitude"].values,
        "longitude": ds["longitude"].values,
    }
    dims = ("valid_time", "latitude", "longitude")
    encoding = {"t2m": {"zlib": True, "complevel": 4}}
    xr.Dataset({"t2m": (dims, tmax)}, coords=coords).to_netcdf(out_tmax, encoding=encoding)
    xr.Dataset({"t2m": (dims, tmin)}, coords=coords).to_netcdf(out_tmin, encoding=encoding)
    ds.close()
    print(f"{year}: {n_days} local days → {out_tmax.name}, {out_tmin.name}", flush=True)


def main() -> None:
    files = sorted(HOURLY_DIR.glob("era5land_hourly_*.nc"))
    if not files:
        sys.exit("no hourly files in data/cds/hourly")
    for path in files:
        aggregate_year(path)
    print("aggregation done")


if __name__ == "__main__":
    main()
