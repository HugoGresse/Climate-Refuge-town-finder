# Climate Refuge Town Finder

Compare climate and natural-hazard indicators for French communes around an origin city, and surface towns with milder summers, fewer hazards, and enough services to actually live there.

> **Framing matters:** this is a *screening and comparison* tool ("Comparez le climat et les risques naturels des communes françaises"), not a verdict machine. Climate, hazard, exposure and livability are four different things and are kept separate throughout. French-first UI.

**Status: planning.** Work is tracked in [GitHub issues](https://github.com/HugoGresse/Climate-Refuge-town-finder/issues). UI style tokens live in [DESIGN.md](DESIGN.md). This README is the product + technical plan.

---

## Why build this

Official French tools already publish excellent per-commune data — [Climadiag Commune](https://meteofrance.com/climadiag-commune) (2030/2050/2100 indicators), [Géorisques](https://www.georisques.gouv.fr) (hazards, ERRIAL address-level reports), [DRIAS](https://www.drias-climat.fr) (bias-corrected projections). None of them answers the actual question:

> "Within ~150 km of where I live (default origin: Montpellier), which towns have meaningfully cooler summers, acceptable flood/fire risk, **and** a hospital, a train station and a functioning town centre?"

Cross-source comparison and ranking **within a travel radius, under livability constraints** is the value added. Recomputing indicators the state already publishes better is not.

## What it shows per commune

| Axis | Indicators | Source & period |
|---|---|---|
| **Heat (climate)** | CDD18 (cooling degree-days), tropical nights (Tmin ≥ 20 °C), longest heatwave spell; days ≥ 30/35 °C as context only | ERA5-Land 0.1°, pinned model — **1991–2020 normals** + **2011–2025 "recent experience"** layer, shown separately, never merged |
| **Extreme precip & wind** | Rx1day, days ≥ 40 mm, gusts ≥ 100 km/h — labelled *heavy precipitation*, explicitly **not** flood risk | **CERRA 5 km reanalysis, 1985–2021** (extremes need ~30 years; 5 recent years is weather, not climate) |
| **Hazards** | CATNAT flood history (rate-normalised, no arbitrary recency weighting), PPRI/TRI/AZI exposure, **wildfire**, clay shrink–swell (RGA), coastal submersion & retreat decree list, drought restriction history | Géorisques / GASPAR / Propluvia, each with source link + data date |
| **Livability** | Population + trend, BPE services (shops, schools), GP/medical density, rail & city access, DVF €/m², fibre | INSEE, DVF, ARCEP |
| **Future** | Warming-level overlay (TRACC framing: +2.0 / +2.7 / +4 °C) + **climate analogs** ("under +2.7 °C, Mende's summers resemble today's Montélimar") | Climadiag Commune if bulk reuse is authorised, else DRIAS/Explore2 8 km, 20-year windows, delta method |
| **Confidence** | Per-commune badges: \|Δelevation\| > 200 m, mixed coastal cell, urban heat island, missing data | pipeline flags |

Absolute values are always shown alongside deltas vs the origin — a town can be cooler than Montpellier and still be brutally hot.

## How ranking works (scoring honesty rules)

- **National percentile normalisation** (winsorised), never min-max, never normalised over the search circle — a town's score must not change because someone else picked a different origin.
- Correlated heat indicators are collapsed into an explicit **heat sub-index**; sliders weight sub-indices, not raw metrics.
- **Severe hazard flags are gates, not addends** — they cannot be averaged away by pleasant temperatures. Missing data is `unknown`, never 0.
- **Tie bands** computed by bootstrap over years — differences inside the band are labelled statistically meaningless. Sensitivity analysis marks towns whose rank flips under small weight changes.
- **Pareto view** ("these towns are dominated on nothing you care about") instead of a single winner. Presets before sliders: *Éviter la chaleur extrême · Priorité inondation · Équilibré · Petite ville avec services · Explorer sans classement*.
- v1 may ship with **no composite score at all**: hard filters + sortable components + better/similar/worse bands.
- **Population/livability filter is mandatory** (presets: village · petite ville · ville avec hôpital et gare · toutes); ranking unit is bassin de vie or communes ≥ 1 000 pop, the rest render on the map only.

## Method integrity (the parts that make the numbers defensible)

1. **No grid-cell rounding.** Bilinear interpolation of the four surrounding ERA5-Land cells at the commune's **mairie** coordinates (not the geometric centroid), then an explicit **asymmetric lapse correction** on `commune_elev − grid_elev`: ≈ −0.65 °C/100 m for Tmax, ~0–0.3 for Tmin (cold-air pooling: valleys invert at night). Elevation from a DEM, not from the API's downscaling value.
2. **Pinned reanalysis model** (no `best_match` blending), `timezone=Europe/Paris` for daily aggregation.
3. **Validation against Météo-France station observations** (meteo.data.gouv.fr): identical metrics recomputed from ~100–150 stations, bias/RMSE published **by elevation band**, wired into CI as golden-file gates with pre-registered tolerances. Known caveats documented: 24 h vs 06–06 UTC Tn/Tx windows, ERA5-Land underestimating urban-heat-island nights (which understates the benefit of leaving a city — stated explicitly).
4. **20-year windows minimum for projections**, anomalies averaged per model vs its own baseline (delta method), never averaged daily series.

## Architecture — static-first

No server, no queue, no quota state machine. A "search" is `haversine(origin, commune) < radius` + re-score over ~35k rows of one preloaded columnar file (~1 MB gzipped) — sub-100 ms client-side. Search state (origin, radius, weights, filters) lives in the **URL** → shareable permalinks, no accounts, no GDPR surface beyond hosting logs.

```
data-pipeline/            # run by the maintainer, not by users (TS; Python/xarray or DuckDB allowed for netCDF/GRIB)
  fetch-communes.ts       # geo.api.gouv.fr — mairie coords, INSEE vintage, merged-communes handling
  fetch-era5land.*        # bulk: Copernicus CDS or self-hosted Open-Meteo (AGPL, unlimited local calls)
  fetch-cerra.*           # extremes climatology 1985–2021
  fetch-georisques.ts     # CATNAT + PPRI/TRI/AZI + clay + coastal + drought
  fetch-livability.ts     # INSEE BPE, pop trend, medical density, DVF, fibre
  fetch-projections.*     # Climadiag / DRIAS / Explore2 (licence permitting)
  build-metrics.ts        # interpolate → lapse-correct → indices → percentiles
  validate.ts             # vs Météo-France stations; emits report + CI gate
  build-release.ts        # → versioned data release + manifest + checksums, atomic switchover
src/lib/                  # pure TS, shared, vitest: geo, downscale, metrics, normalise, score
web/                      # Vite + TS + MapLibre GL + IGN Géoplateforme tiles (free, keyless)
```

- **Data releases are immutable and versioned** (`data-YYYY-MM` + manifest + checksums); the footer shows "données au …" and the methodology version. The pipeline is deterministic from pinned source snapshots — the dataset is derived, not precious.
- **Data acquisition:** the Open-Meteo free JSON API is only for spot checks — a national 30-year precompute through it is quota-impossible (weighted-call billing ≈ 144 units/location for 5.5 y daily; full France ≈ 10⁶ units). Bulk paths: Copernicus CDS (France bbox, 30 y, ~3 GB), self-hosted Open-Meteo, or one month of their commercial tier to bootstrap.
- **Map rendering:** commune points filtered by zoom + population (35k points at national zoom is a blob); department/grid aggregation at low zoom; later ADMIN-EXPRESS polygons via PMTiles. Colourblind-safe ramp, non-colour encoding, sortable table as a full alternative, keyboard navigation.
- **Deployment: Coolify, as a static site** (Dockerfile with nginx/caddy serving `web/dist`). A backend gets added only if something genuinely dynamic appears.

## Roadmap

Phases invert the usual order: ship a defensible single-region explorer first, widen coverage last.

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 | `METHODOLOGY.md` — claim boundary, sources, periods, indices, normalisation, licences, 20 validation towns | A reviewer can predict what the numbers will say |
| 1 | Core lib + tests (geo, bilinear, lapse, CDD18, percentiles) | Fixtures from real station CSVs pass |
| 2 | Bulk ingest, pilot region (Occitanie + AuRA, 30 y) | Validation harness green; bias/RMSE by elevation band published |
| 3 | **Static explorer, shipped** — map, origin/radius, presets, table, permalinks, methodology page, mentions légales | Public URL |
| 4 | Hazards done properly (CATNAT rates, PPRI/TRI, wildfire, clay, coastal, drought) | Every severe flag manually reviewed in pilot sample |
| 5 | Livability + bassin-de-vie ranking unit | Mende distinguishable from a 40-person hamlet |
| 6 | National coverage + warming-level overlay + analogs | Full-France release |
| 7 | Polish — PMTiles polygons, Pareto view, comparison, export | — |

## Legal & attribution (release blockers, not polish)

- Attribution page: Copernicus/ECMWF (ERA5-Land, CERRA — *"Generated using Copernicus Climate Change Service information"*), Open-Meteo (CC BY 4.0, Zenodo DOI) if used, Etalab/IGN (communes, tiles), BRGM/Géorisques (Licence Ouverte 2.0 — source **and** last-update date), Météo-France (stations, DRIAS/Climadiag), OSM.
- **Mentions légales** (publisher + host), minimal-GDPR posture (no cookies, truncated IPs or none, privacy notice), self-hosted analytics or none.
- Disclaimer on every results view: screening information, not property/insurance/safety advice; hazard data indicative at commune scale; deep link to the official **Géorisques/ERRIAL address-level report** — *"consultez le rapport à l'adresse avant tout achat"*.
- Reputational governance: neutral wording, provenance + data date everywhere, an error-reporting channel, a correction/versioning policy, and a "data as of" + sunset policy in the footer.

## Development

```bash
npm install
npm test          # vitest — lib + pipeline unit tests
npm run dev       # Vite dev server (web/)
npm run pipeline  # rebuild dataset from cached source snapshots
```

*(Scaffolding pending — see issues.)*

## Design

UI follows the token set in [DESIGN.md](DESIGN.md): restrained single accent color, system font stack, 4 px grid, flat surfaces, calm motion (no springs), content-dense/chrome-light. Map stays neutral; the accent is reserved for the primary action and the origin marker.
