# Methodology

Version 0.1 — draft. Every pipeline PR must link to the section it implements.
This document exists so a reviewer can predict what the numbers will say before
running the code. Changes to definitions here are a new methodology version and
therefore a new data release.

## 1. Claim boundary

**The product may assert:**

- Relative comparisons of *climate indicators* between communes, computed
  identically for every commune from the sources below, with stated periods.
- Official *hazard records and zonings* (CATNAT arrêtés, PPRI/TRI/AZI, clay,
  coastal-retreat decrees, drought restrictions) as published, with source and
  last-update date.
- *Livability facts* (population, services, medical density, prices) as
  published by INSEE and related official sources.

**The product may not assert:**

- That any commune is "safe", "at risk", or a "climate refuge". No verdict
  adjectives. Rankings are decision support over indicators, nothing more.
- Anything at sub-commune scale. Flood risk varies at 10–100 m; commune-level
  data cannot place a street or a parcel. Every hazard view links to the
  official Géorisques/ERRIAL address-level report.
- Absolute precision beyond the published uncertainty: temperatures displayed
  to 0.5 °C, ranks shown with tie bands.

**Four distinct concepts, never merged into one number silently:**
*climate* (long-term distributions), *hazard* (physical event potential),
*exposure* (what sits in harm's way, incl. regulatory zonings), *livability*
(services, demography, prices).

## 2. Commune representative point

- Coordinates: the **mairie** location from geo.api.gouv.fr; geometric centre
  only as fallback, flagged `coordSource: "centre"`.
- Elevation: DEM value (Copernicus GLO-90 via the Open-Meteo elevation API) at
  that point — never a weather API's internal downscaling elevation.
- Ranking unit: bassin de vie or communes with population ≥ 1 000; smaller
  communes render on the map but are not ranked (livability degeneracy rule).

## 3. Climate sources and periods

| Layer | Source | Period | Why |
|---|---|---|---|
| Heat normals | ERA5-Land 0.1°, **pinned model, never `best_match`** | **1991–2020** | WMO climate normal; 5 recent years is weather, not climate (SE of a 5-y JJA mean ≈ 0.5 °C) |
| Recent experience | ERA5-Land 0.1° | **2011–2025** | What moving there has felt like lately; displayed separately, never averaged with normals |
| Extremes | **CERRA ~5.5 km** | **1985–2021** | Extremes need ~30 seasons; ERA5 precipitation (~25 km) area-averages Cévennes episodes away |
| Projections | Climadiag Commune (if bulk-authorised) else DRIAS-2020 / Explore2 (8 km, ADAMONT bias-corrected) | 20-year windows min | Overlay by warming level (TRACC +2.0 / +2.7 / +4 °C), delta method per model vs its own 1991–2020 baseline; never average daily model series before counting extremes |

Daily aggregation in `Europe/Paris` local days. Known, documented offsets:
reanalysis calendar-day Tn/Tx vs Météo-France 06–06 UTC windows; ERA5-Land does
not resolve urban heat islands (city nights underestimated by 1–3 °C, which
*understates* the benefit of leaving a city — stated in the UI).

## 4. Downscaling rules

1. Bilinear interpolation of the four surrounding grid cells at the mairie
   point (no cell-centre rounding, no shared "cell cache" keyed on rounded
   coordinates).
2. Asymmetric lapse correction on `elev_commune − elev_grid_interpolated`:
   **Tmax −0.65 °C/100 m**, **Tmin −0.3 °C/100 m** (cold-air pooling: valley
   floors invert at night; a uniform lapse would make them implausibly warm).
   Constants live in `src/lib/downscale.ts`.
3. Confidence flags, shown in the UI, when |Δelev| > 200 m, mixed land/sea
   coastal cell, or dense urban cell. Flag, don't hide.

## 5. Indices

All thresholds inclusive (≥). Annual rates use only years with ≥ 350 valid
days (≥ 85 of 92 days for JJA aggregates); incomplete years are excluded, not
scaled. Implementations and edge-case tests: `src/lib/metrics.ts`.

**Heat (ranking backbone = linear indices; counts are context):**

- `CDD18` — cooling degree-days, base 18 °C on the daily mean. Linear, so a
  grid bias of −1 °C shifts it additively instead of halving it (which is what
  happens to `days ≥ 35`); tolerant to bias when comparing towns.
- `tropicalNights` — days/yr Tmin ≥ 20 °C. What sleep feels like; sharpest
  coast-vs-altitude discriminator.
- `heatwaveSpell` — longest run of days Tmax ≥ 35 °C: mean annual max +
  absolute max.
- `jjaMeanTmax`, `days ≥ 30 °C`, `days ≥ 35 °C` — displayed as context with a
  "gridded estimate, not a station" caveat; not the ranking backbone.

**Heavy precipitation & wind (labelled "heavy precipitation", explicitly not
flood risk):** `Rx1day` (max 1-day total + date), `days ≥ 40 mm/yr`,
`days gusts ≥ 100 km/h/yr` — from CERRA.

**Hazard indicators (records, not model output):** CATNAT flood arrêtés as
rate-normalised history (dedup by recognition/event/risk; no recency
multiplier), PPRI/TRI/AZI presence, wildfire zoning, clay RGA class, coastal
retreat decree membership, drought restriction history.

## 6. Normalisation and scoring

- National percentile ranks (midrank ties), computed **over all of France**,
  never over a search circle — a commune's rank is origin-independent.
- Winsorisation only for display scaling; never min-max anywhere.
- Correlated heat indices collapse into one **heat sub-index** before
  weighting; the indicator correlation matrix is published.
- Missing data is `unknown`, never zero. A composite score needs ≥ 60 % of
  weight backed by data (`src/lib/score.ts`), otherwise no score is shown.
- Severe hazard flags are **gates**: they exclude from "recommended" and are
  never averaged away.
- Tie bands from bootstrap over years; sensitivity analysis marks rank flips
  under small weight changes; a Pareto (non-dominated) view is first-class.
- v1 may ship without any composite score: filters + sortable components +
  better/similar/worse bands vs origin.

## 7. Validation (CI gates, not eyeballing)

- ~100–150 Météo-France stations (meteo.data.gouv.fr): identical indices
  recomputed from observations; bias/RMSE **by elevation band** published on
  the methodology page.
- Golden-file harness: 20 validation towns (below), expected ranges derived
  from station data during issue #8 — with a tolerance table, run in CI.
- Pre-registered release gates: max median temperature bias; max hot-day-count
  error per terrain class; max share of communes with missing indicators;
  manual review of every severe hazard flag in the pilot sample.
- Property tests: score monotonicity, radius-invariant percentiles,
  sign-correct lapse.

### Validation towns (pilot region, terrain-stratified)

| Town | Class | | Town | Class |
|---|---|---|---|---|
| Montpellier | urban coast plain | | Aurillac | mountain basin |
| Sète | coastal | | Le Puy-en-Velay | plateau ~630 m |
| Nîmes | plain, flood-prone | | Clermont-Ferrand | sheltered basin |
| Alès | piedmont, flood-prone | | Saint-Étienne | mid-altitude urban |
| Mende | plateau ~730 m | | Lyon | urban valley |
| Millau | gorge/plateau | | Grenoble | deep alpine valley |
| Rodez | plateau ~580 m | | Chambéry | alpine valley |
| Toulouse | urban plain | | Annecy | lake/alpine |
| Albi | plain | | Perpignan | hot dry plain |
| Carcassonne | windy corridor | | Font-Romeu-Odeillo-Via | high mountain ~1 800 m |

Expected values are filled from station data in issue #8 — they are **not**
hand-estimated here. Coarse sanity anchors only (approximate, station-based
figures to replace them): Montpellier JJA mean Tmax ≈ 30 ± 1 °C over
1991–2020; Font-Romeu markedly cooler than every plain town; Nîmes/Alès among
the highest CATNAT flood *rates* in the pilot.

## 8. Licences to confirm before each source ships

| Source | Licence | Obligation |
|---|---|---|
| ERA5-Land / CERRA (CDS) | Copernicus | attribution sentence + dataset DOIs |
| Open-Meteo (if used) | CC BY 4.0, free tier non-commercial | attribution + Zenodo DOI |
| geo.api.gouv.fr, INSEE, DVF | Licence Ouverte 2.0 | source + date |
| Géorisques/GASPAR (BRGM) | Licence Ouverte 2.0 | source + last-update date |
| IGN Géoplateforme tiles | free "essentiels" | attribution © IGN |
| Climadiag / DRIAS (Météo-France) | **bulk reuse to confirm before use** | do not scrape; ask |

Cadence: climate baseline rarely; communes/population annually; Géorisques
quarterly; any methodology change → new release id.
