"""Transforms CDS ERA5-Land netCDF grids into per-commune daily caches.

This is the methodology-critical step (METHODOLOGY.md §4): bilinear
interpolation of the four surrounding grid nodes at the mairie point,
then the asymmetric lapse correction on the elevation difference —
Tmax -0.65 °C/100 m, Tmin -0.30 °C/100 m. Constants mirror
src/lib/downscale.ts; keep both in sync.

Node elevations come from the same Copernicus DEM as the commune
referential (Open-Meteo elevation API), cached once. Sea nodes (NaN in
ERA5-Land) are masked and weights renormalised; communes touching a sea
node get a coastalMixed confidence flag.

Output: data/era5land/{insee}.json.gz — same schema the TS pipeline
reads, so build-metrics.ts works unchanged. Existing files are skipped
(resume); --force overwrites.

Usage:
  .venv-etl/bin/python data-pipeline/transform_cds_to_cache.py            # pilot depts
  .venv-etl/bin/python data-pipeline/transform_cds_to_cache.py --depts 48,34
"""

from __future__ import annotations

import gzip
import json
import pathlib
import ssl
import sys
import time
import urllib.request

import certifi
import numpy as np
import xarray as xr

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDS_DIR = ROOT / "data" / "cds"
OUT_DIR = ROOT / "data" / "era5land"
COMMUNES_FILE = ROOT / "data" / "communes.json"
ELEV_CACHE = CDS_DIR / "grid_node_elevations.json"

YEARS = range(1991, 2026)
LAPSE_TMAX_C_PER_M = -0.0065  # = src/lib/downscale.ts
LAPSE_TMIN_C_PER_M = -0.0030
KELVIN = 273.15

PILOT_DEPTS = [
    "09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81",
    "82", "01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74",
]


def load_env_key() -> str | None:
    env = ROOT / ".env"
    if not env.exists():
        return None
    for line in env.read_text().splitlines():
        if line.startswith("OPEN_METEO_API_KEY="):
            return line.split("=", 1)[1].strip()
    return None


def fetch_node_elevations(nodes: list[tuple[float, float]]) -> dict[str, float]:
    """DEM elevation for grid nodes, cached; batched 100/request."""
    cache: dict[str, float] = {}
    if ELEV_CACHE.exists():
        cache = json.loads(ELEV_CACHE.read_text())
    missing = [n for n in nodes if f"{n[0]:.4f}:{n[1]:.4f}" not in cache]
    if not missing:
        return cache
    key = load_env_key()
    host = (
        "https://customer-api.open-meteo.com/v1/elevation"
        if key
        else "https://api.open-meteo.com/v1/elevation"
    )
    for i in range(0, len(missing), 100):
        batch = missing[i : i + 100]
        url = (
            f"{host}?latitude={','.join(f'{lat:.4f}' for lat, _ in batch)}"
            f"&longitude={','.join(f'{lon:.4f}' for _, lon in batch)}"
            + (f"&apikey={key}" if key else "")
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60, context=SSL_CONTEXT) as response:
                    payload = json.loads(response.read())
                for (lat, lon), elev in zip(batch, payload["elevation"]):
                    cache[f"{lat:.4f}:{lon:.4f}"] = elev
                break
            except Exception as error:  # noqa: BLE001
                if attempt == 4:
                    raise
                print(f"elevation batch retry: {error}", file=sys.stderr)
                time.sleep(10 * (attempt + 1))
        time.sleep(0.15 if key else 2.0)
        if i % 2000 == 0:
            print(f"node elevations {i}/{len(missing)}")
    ELEV_CACHE.write_text(json.dumps(cache))
    return cache


def main() -> None:
    force = "--force" in sys.argv
    depts = PILOT_DEPTS
    if "--depts" in sys.argv:
        depts = sys.argv[sys.argv.index("--depts") + 1].split(",")

    years = [
        y
        for y in YEARS
        if (CDS_DIR / f"era5land_tmax_{y}.nc").exists()
        and (CDS_DIR / f"era5land_tmin_{y}.nc").exists()
    ]
    if not years:
        sys.exit("no complete year files in data/cds — run fetch_era5land_cds.py first")
    if len(years) < len(list(YEARS)):
        print(f"WARNING: only {len(years)}/{len(list(YEARS))} years available — partial run")

    referential = json.loads(COMMUNES_FILE.read_text())
    communes = [c for c in referential["communes"] if c["dept"] in depts]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not force:
        communes = [
            c for c in communes if not (OUT_DIR / f"{c['insee']}.json.gz").exists()
        ]
    print(f"{len(communes)} communes to transform")
    if not communes:
        return

    # Grid geometry + static land mask from one reference file.
    ref = xr.open_dataset(CDS_DIR / f"era5land_tmax_{years[0]}.nc")
    var = next(iter(ref.data_vars))
    tdim = "valid_time" if "valid_time" in ref.dims else "time"
    lats = ref["latitude"].values.astype(np.float64)
    lons = ref["longitude"].values.astype(np.float64)
    land = np.isfinite(ref[var].isel({tdim: 0}).values)  # (lat, lon)
    ref.close()
    dlat = lats[1] - lats[0]
    dlon = lons[1] - lons[0]

    # Per-commune corner indices, weights, land mask, elevations.
    c_lat = np.array([c["lat"] for c in communes])
    c_lon = np.array([c["lon"] for c in communes])
    fi = (c_lat - lats[0]) / dlat
    fj = (c_lon - lons[0]) / dlon
    i0 = np.clip(np.floor(fi).astype(int), 0, len(lats) - 2)
    j0 = np.clip(np.floor(fj).astype(int), 0, len(lons) - 2)
    fi = np.clip(fi - i0, 0.0, 1.0)
    fj = np.clip(fj - j0, 0.0, 1.0)
    corner_i = np.stack([i0, i0, i0 + 1, i0 + 1], axis=1)  # (C, 4)
    corner_j = np.stack([j0, j0 + 1, j0, j0 + 1], axis=1)
    weights = np.stack(
        [(1 - fi) * (1 - fj), (1 - fi) * fj, fi * (1 - fj), fi * fj], axis=1
    )
    corner_land = land[corner_i, corner_j]  # (C, 4) bool
    weights = np.where(corner_land, weights, 0.0)
    weight_sums = weights.sum(axis=1)
    all_sea = weight_sums == 0
    if all_sea.any():
        for idx in np.flatnonzero(all_sea):
            print(f"skip {communes[idx]['name']}: all four grid nodes are sea")
        keep = ~all_sea
        communes = [c for c, k in zip(communes, keep) if k]
        corner_i, corner_j = corner_i[keep], corner_j[keep]
        weights, weight_sums = weights[keep], weight_sums[keep]
        corner_land = corner_land[keep]
    weights = weights / weight_sums[:, None]
    coastal_mixed = ~corner_land.all(axis=1)

    nodes = sorted(
        {
            (round(float(lats[i]), 4), round(float(lons[j]), 4))
            for i, j in zip(corner_i.ravel(), corner_j.ravel())
        }
    )
    node_elev = fetch_node_elevations(nodes)
    corner_elev = np.array(
        [
            [
                node_elev[f"{round(float(lats[i]), 4):.4f}:{round(float(lons[j]), 4):.4f}"]
                for i, j in zip(ci, cj)
            ]
            for ci, cj in zip(corner_i, corner_j)
        ]
    )
    grid_elev = (weights * corner_elev).sum(axis=1)
    commune_elev = np.array(
        [c["elevationM"] if c["elevationM"] is not None else g
         for c, g in zip(communes, grid_elev)]
    )
    delev = commune_elev - grid_elev

    flat_idx = corner_i * len(lons) + corner_j  # (C, 4)
    n_communes = len(communes)
    all_dates: list[str] = []
    tmax_parts: list[np.ndarray] = []
    tmin_parts: list[np.ndarray] = []

    for year in years:
        for tag, parts in (("tmax", tmax_parts), ("tmin", tmin_parts)):
            path = CDS_DIR / f"era5land_{tag}_{year}.nc"
            ds = xr.open_dataset(path)
            v = next(iter(ds.data_vars))
            data = ds[v].values.reshape(ds[v].shape[0], -1)  # (T, lat*lon)
            corner_vals = data[:, flat_idx]  # (T, C, 4)
            interp = np.nansum(corner_vals * weights[None, :, :], axis=2)
            parts.append((interp - KELVIN).astype(np.float32))
            if tag == "tmax":
                all_dates.extend(
                    str(d)[:10] for d in ds[tdim].values.astype("datetime64[D]")
                )
            ds.close()
        print(f"year {year} done")

    tmax = np.concatenate(tmax_parts) + delev[None, :] * LAPSE_TMAX_C_PER_M
    tmin = np.concatenate(tmin_parts) + delev[None, :] * LAPSE_TMIN_C_PER_M

    for index, commune in enumerate(communes):
        payload = {
            "meta": {
                "insee": commune["insee"],
                "name": commune["name"],
                "dept": commune["dept"],
                "requested": {
                    "lat": commune["lat"],
                    "lon": commune["lon"],
                    "elevationM": commune["elevationM"],
                },
                "grid": {
                    "lat": commune["lat"],
                    "lon": commune["lon"],
                    "elevation": round(float(grid_elev[index]), 1),
                },
                "model": "era5_land_cds",
                "downscaling": "bilinear+asymmetric-lapse",
                "coastalMixed": bool(coastal_mixed[index]),
                "period": {"start": all_dates[0], "end": all_dates[-1]},
                "timezone": "utc+01:00",
            },
            "daily": {
                "time": all_dates,
                "temperature_2m_max": [round(float(v), 2) for v in tmax[:, index]],
                "temperature_2m_min": [round(float(v), 2) for v in tmin[:, index]],
            },
        }
        out = OUT_DIR / f"{commune['insee']}.json.gz"
        out.write_bytes(gzip.compress(json.dumps(payload).encode()))
        if index % 500 == 0:
            print(f"written {index}/{n_communes}")
    print(f"finished: {n_communes} communes → {OUT_DIR}")


if __name__ == "__main__":
    main()
