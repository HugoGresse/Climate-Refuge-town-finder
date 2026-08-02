"""Bulk ERA5-Land daily statistics from Copernicus CDS for France.

Downloads daily 2m-temperature max/min (UTC+01:00 day boundary — fixed
offset; documented deviation from Europe/Paris DST in METHODOLOGY.md §3)
for 1991-2025 over the metropolitan-France bbox at 0.1 deg. One netCDF
per year and statistic, resumable: existing files are skipped.

Python is allowed in the ETL leg (README): netCDF handling in TS would
be self-inflicted pain. The product code stays TypeScript.

Usage:
  .venv-etl/bin/python data-pipeline/fetch_era5land_cds.py --probe
  .venv-etl/bin/python data-pipeline/fetch_era5land_cds.py          # sequential
  .venv-etl/bin/python data-pipeline/fetch_era5land_cds.py --pump   # capped async loop

The pump exists because the shared CDS queue is often congested and the
per-user queue cap is small: it keeps MAX_INFLIGHT jobs queued at all
times, downloads completions, and resubmits rejected jobs.
"""

from __future__ import annotations

import json
import pathlib
import sys
import time

import cdsapi

DATASET = "derived-era5-land-daily-statistics"
DATASET_HOURLY = "reanalysis-era5-land"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "cds"
HOURLY_DIR = OUT_DIR / "hourly"
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


JOBS_FILE = OUT_DIR / "jobs.json"


def missing_targets() -> list[tuple[str, str, int]]:
    """(filename, statistic, year) for every file not yet downloaded."""
    targets = []
    for year in YEARS:
        for stat, tag in STATS.items():
            out = OUT_DIR / f"era5land_{tag}_{year}.nc"
            if not (out.exists() and out.stat().st_size > 1_000_000):
                targets.append((out.name, stat, year))
    return targets


def build_hourly_request(year: int) -> dict:
    return {
        "variable": ["2m_temperature"],
        "year": str(year),
        "month": [f"{m:02d}" for m in range(1, 13)],
        "day": [f"{d:02d}" for d in range(1, 32)],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": AREA,
        "format": "netcdf",
    }


def missing_targets_hourly() -> list[tuple[str, str, int]]:
    """Hourly year files still needed — a year whose daily tmax+tmin already
    exist (aggregated or from the daily-stats path) is skipped."""
    targets = []
    for year in YEARS:
        have_daily = all(
            (OUT_DIR / f"era5land_{tag}_{year}.nc").exists() for tag in STATS.values()
        )
        out = HOURLY_DIR / f"era5land_hourly_{year}.nc"
        if not have_daily and not (out.exists() and out.stat().st_size > 50_000_000):
            targets.append((out.name, "hourly", year))
    return targets


def unwrap_zip(path: pathlib.Path) -> None:
    """New-CDS netcdf downloads arrive as a zip with one .nc member."""
    import zipfile

    if not zipfile.is_zipfile(path):
        return
    with zipfile.ZipFile(path) as archive:
        members = [m for m in archive.namelist() if m.endswith(".nc")]
        if len(members) != 1:
            raise RuntimeError(f"{path.name}: expected one .nc member, got {members}")
        tmp = path.with_suffix(".unzip.nc")
        with archive.open(members[0]) as src, open(tmp, "wb") as dst:
            dst.write(src.read())
    tmp.replace(path)


def place_orphan(tmp: pathlib.Path) -> str:
    """Identify an adopted job's content (year + statistic) and rename it.

    July land means separate the two statistics unambiguously
    (Tmax ≈ 26 °C vs Tmin ≈ 14 °C over the France bbox).
    """
    import numpy as np
    import xarray as xr

    ds = xr.open_dataset(tmp)
    tdim = "valid_time" if "valid_time" in ds.dims else "time"
    var = next(iter(ds.data_vars))
    times = [str(t) for t in ds[tdim].values]
    year = int(times[0][:4])
    july = [i for i, t in enumerate(times) if t[5:7] == "07"]
    july_mean_c = float(np.nanmean(ds[var].isel({tdim: july}).values)) - 273.15
    ds.close()
    tag = "tmax" if july_mean_c > 20 else "tmin"
    final = OUT_DIR / f"era5land_{tag}_{year}.nc"
    if final.exists():
        tmp.unlink()
        return f"duplicate of {final.name}, discarded"
    tmp.rename(final)
    return final.name


MAX_INFLIGHT = 3  # CDS rejects per-user queued jobs beyond a small cap (observed ~3)
POLL_SECONDS = 120
COOLDOWN_MIN_S = 300
COOLDOWN_MAX_S = 3600


def pump() -> None:
    """Keep up to MAX_INFLIGHT jobs queued; poll, download, top up, repeat.

    Polite by design — CDS explicitly asks scripts to respect the per-dataset
    queue limit: at most one new submission per cycle, and any rejection
    (404 on poll or refused submit) triggers an exponential submission
    cooldown, reset when a download succeeds.
    """
    from cdsapi.api import Result

    client = cdsapi.Client(quiet=True, wait_until_complete=False, delete=False)
    months = [f"{m:02d}" for m in range(1, 13)]
    cooldown_s = 0
    submit_gate = 0.0
    submit_allowed = "--no-submit" not in sys.argv
    hourly = "--hourly" in sys.argv
    dataset = DATASET_HOURLY if hourly else DATASET
    targets_fn = missing_targets_hourly if hourly else missing_targets
    max_inflight = 6 if hourly else MAX_INFLIGHT
    out_dir = HOURLY_DIR if hourly else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    if not submit_allowed:
        print("poll-only mode: no new submissions", flush=True)
    if hourly:
        print(f"hourly mode: {dataset}, {len(targets_fn())} year files needed", flush=True)
    while True:
        jobs: dict[str, str] = (
            json.loads(JOBS_FILE.read_text()) if JOBS_FILE.exists() else {}
        )
        missing = targets_fn()
        if not missing:
            print("all files downloaded", flush=True)
            return
        missing_names = {name for name, _, _ in missing}
        jobs = {
            n: j
            for n, j in jobs.items()
            if n in missing_names or n.startswith("orphan_")
        }

        alive: dict[str, str] = {}
        rejected = False
        for name, job_id in list(jobs.items()):
            result = Result(client, {"request_id": job_id})
            try:
                result.update()
            except Exception as error:  # noqa: BLE001
                print(f"dropping {name}: {error}", file=sys.stderr)
                del jobs[name]
                rejected = True
                continue
            state = result.reply.get("state", "?")
            if state == "completed":
                result.download(str(out_dir / name))
                unwrap_zip(out_dir / name)
                if name.startswith("orphan_"):
                    placed = place_orphan(out_dir / name)
                    print(f"downloaded orphan → {placed}", flush=True)
                else:
                    print(f"downloaded {name}", flush=True)
                del jobs[name]
                cooldown_s = 0
            elif state in ("failed", "denied", "rejected", "deleted"):
                print(f"job {state} for {name} — will resubmit later", file=sys.stderr)
                del jobs[name]
                rejected = True
            else:
                alive[name] = state

        now = time.monotonic()
        if rejected:
            cooldown_s = min(max(COOLDOWN_MIN_S, cooldown_s * 2), COOLDOWN_MAX_S)
            submit_gate = now + cooldown_s
            print(f"submission cooldown {cooldown_s}s (per-dataset queue limit)", flush=True)

        if submit_allowed and now >= submit_gate and len(alive) < max_inflight:
            for name, stat, year in targets_fn():
                if name in jobs:
                    continue
                request = (
                    build_hourly_request(year)
                    if hourly
                    else build_request(year, months, stat)
                )
                try:
                    result = client.retrieve(dataset, request)
                    jobs[name] = result.reply["request_id"]
                    print(f"queued {name} → {jobs[name]}", flush=True)
                except Exception as error:  # noqa: BLE001
                    print(f"submit refused for {name}: {error}", file=sys.stderr)
                    cooldown_s = min(max(COOLDOWN_MIN_S, cooldown_s * 2), COOLDOWN_MAX_S)
                    submit_gate = time.monotonic() + cooldown_s
                break  # at most one submission per cycle

        JOBS_FILE.write_text(json.dumps(jobs, indent=1))
        remaining = len(targets_fn())
        print(f"remaining targets: {remaining} · alive: {alive}", flush=True)
        time.sleep(POLL_SECONDS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if "--probe" in sys.argv:
            probe(cdsapi.Client(quiet=True))
        elif "--pump" in sys.argv:
            pump()
        else:
            failures = fetch_all(cdsapi.Client(quiet=True))
            print(f"fetch finished, {failures} failures")
            sys.exit(1 if failures else 0)
    except Exception:
        print(LICENCE_HINT, file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
