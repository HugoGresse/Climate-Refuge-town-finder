"""Bulk ERA5-Land daily statistics from Copernicus CDS for France.

Downloads daily 2m-temperature max/min (UTC+01:00 day boundary — fixed
offset; documented deviation from Europe/Paris DST in METHODOLOGY.md §3)
for 1991-2025 over the metropolitan-France bbox at 0.1 deg. One netCDF
per year and statistic, resumable: existing files are skipped.

Python is allowed in the ETL leg (README): netCDF handling in TS would
be self-inflicted pain. The product code stays TypeScript.

Usage:
  .venv-etl/bin/python data-pipeline/fetch_era5land_cds.py --probe
  .venv-etl/bin/python data-pipeline/fetch_era5land_cds.py
"""

from __future__ import annotations

import pathlib
import sys

import cdsapi

DATASET = "derived-era5-land-daily-statistics"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "cds"
AREA = [51.5, -5.5, 41.0, 10.0]  # N, W, S, E — metropolitan France + margin
YEARS = range(1991, 2026)
STATS = {"daily_maximum": "tmax", "daily_minimum": "tmin"}
LICENCE_HINT = (
    "If this failed with a licence error: accept the dataset licence once at\n"
    "https://cds.climate.copernicus.eu/datasets/derived-era5-land-daily-statistics"
)


def build_request(year: int, months: list[str], stat: str) -> dict:
    return {
        "variable": ["2m_temperature"],
        "year": str(year),
        "month": months,
        "day": [f"{d:02d}" for d in range(1, 32)],
        "daily_statistic": stat,
        "time_zone": "utc+01:00",
        "frequency": "1_hourly",
        "area": AREA,
    }


def probe(client: cdsapi.Client) -> None:
    """One small month to validate auth, licence and file layout."""
    out = OUT_DIR / "probe_tmax_2024-06.nc"
    client.retrieve(DATASET, build_request(2024, ["06"], "daily_maximum"), str(out))
    import xarray as xr

    ds = xr.open_dataset(out)
    var = next(iter(ds.data_vars))
    da = ds[var]
    cell = da.sel(latitude=43.84, longitude=4.36, method="nearest")  # Nîmes
    june_mean_c = float(cell.mean()) - 273.15
    print(f"probe ok: dims={dict(da.sizes)} var={var}")
    print(f"lat {float(ds.latitude.min())}..{float(ds.latitude.max())} "
          f"lon {float(ds.longitude.min())}..{float(ds.longitude.max())}")
    print(f"Nîmes cell mean Tmax June 2024: {june_mean_c:.1f} °C")


def shard_years() -> list[int]:
    years = list(YEARS)
    if "--shard" in sys.argv:
        k, n = map(int, sys.argv[sys.argv.index("--shard") + 1].split("/"))
        years = [y for i, y in enumerate(years) if i % n == k]
    return years


def fetch_all(client: cdsapi.Client) -> int:
    months = [f"{m:02d}" for m in range(1, 13)]
    failures = 0
    for year in shard_years():
        for stat, tag in STATS.items():
            out = OUT_DIR / f"era5land_{tag}_{year}.nc"
            if out.exists() and out.stat().st_size > 1_000_000:
                continue
            try:
                client.retrieve(DATASET, build_request(year, months, stat), str(out))
                print(f"done {out.name} ({out.stat().st_size // 1_000_000} MB)")
            except Exception as error:  # noqa: BLE001 — log and continue, rerun resumes
                failures += 1
                print(f"FAILED {out.name}: {error}", file=sys.stderr)
    return failures


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client(quiet=True)
    try:
        if "--probe" in sys.argv:
            probe(client)
        else:
            failures = fetch_all(client)
            print(f"fetch finished, {failures} failures")
            sys.exit(1 if failures else 0)
    except Exception:
        print(LICENCE_HINT, file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
