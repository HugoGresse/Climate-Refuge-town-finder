"""Aggregates monthly hourly ERA5-Land 2m-temperature files into daily
Tmax/Tmin netCDF per year, on true Europe/Paris calendar days (DST-aware).
Output matches the CDS daily-statistics layout, so
transform_cds_to_cache.py consumes it unchanged.

A year is aggregated only when all 12 of its monthly files are present;
December of the previous year contributes the late-UTC hours that belong
to January 1st locally (skipped for the first year of the archive).

Usage: .venv-etl/bin/python data-pipeline/aggregate_hourly.py
"""

from __future__ import annotations

import pathlib
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import xarray as xr

CDS_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "cds"
HOURLY_DIR = CDS_DIR / "hourly"
PARIS = ZoneInfo("Europe/Paris")


def month_file(year: int, month: int) -> pathlib.Path:
    return HOURLY_DIR / f"era5land_hourly_{year}-{month:02d}.nc"


def open_hours(path: pathlib.Path) -> tuple[np.ndarray, np.ndarray, xr.Dataset]:
    ds = xr.open_dataset(path)
    tdim = "valid_time" if "valid_time" in ds.dims else "time"
    var = next(iter(ds.data_vars))
    times_utc = pd.to_datetime(ds[tdim].values).tz_localize("UTC")
    local_days = times_utc.tz_convert(PARIS).strftime("%Y-%m-%d").values
    return ds[var].values, local_days, ds


def aggregate_year(year: int) -> bool:
    out_tmax = CDS_DIR / f"era5land_tmax_{year}.nc"
    out_tmin = CDS_DIR / f"era5land_tmin_{year}.nc"
    if out_tmax.exists() and out_tmin.exists():
        return False
    months = [month_file(year, m) for m in range(1, 13)]
    if not all(p.exists() for p in months):
        return False

    blocks: list[np.ndarray] = []
    day_blocks: list[np.ndarray] = []
    lat = lon = None
    prev_dec = month_file(year - 1, 12)
    sources = ([prev_dec] if prev_dec.exists() else []) + months
    for path in sources:
        data, local_days, ds = open_hours(path)
        keep = np.char.startswith(local_days.astype(str), str(year))
        if keep.any():
            blocks.append(data[keep].astype(np.float32))
            day_blocks.append(local_days[keep])
        if lat is None:
            lat = ds["latitude"].values
            lon = ds["longitude"].values
        ds.close()

    data = np.concatenate(blocks)
    days = np.concatenate(day_blocks)
    unique_days, first_idx = np.unique(days, return_index=True)
    order = np.argsort(first_idx)
    unique_days = unique_days[order]
    index_of = {d: i for i, d in enumerate(unique_days)}
    idx = np.array([index_of[d] for d in days])

    shape = (len(unique_days), data.shape[1], data.shape[2])
    tmax = np.full(shape, np.nan, dtype=np.float32)
    tmin = np.full(shape, np.nan, dtype=np.float32)
    with np.errstate(all="ignore"):
        for day in range(len(unique_days)):
            block = data[idx == day]
            tmax[day] = np.nanmax(block, axis=0)
            tmin[day] = np.nanmin(block, axis=0)

    coords = {
        "valid_time": np.array(unique_days, dtype="datetime64[D]"),
        "latitude": lat,
        "longitude": lon,
    }
    dims = ("valid_time", "latitude", "longitude")
    encoding = {"t2m": {"zlib": True, "complevel": 4}}
    xr.Dataset({"t2m": (dims, tmax)}, coords=coords).to_netcdf(out_tmax, encoding=encoding)
    xr.Dataset({"t2m": (dims, tmin)}, coords=coords).to_netcdf(out_tmin, encoding=encoding)
    print(f"{year}: {len(unique_days)} local days aggregated", flush=True)
    return True


def main() -> None:
    done = sum(aggregate_year(year) for year in range(1991, 2026))
    total = len(list(CDS_DIR.glob("era5land_tmax_*.nc")))
    print(f"aggregated {done} new years · {total}/35 years ready")


if __name__ == "__main__":
    main()
