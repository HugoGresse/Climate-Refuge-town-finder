/**
 * Computes climate indices from cached ERA5-Land series, in the two layers
 * METHODOLOGY.md defines and never merges: 1991–2020 normals and 2011–2025
 * recent experience. Emits data/metrics-preview.json and prints a spot-check
 * table sorted by summer heat.
 *
 * Usage: npm run pipeline:metrics
 */
import { gunzipSync } from "node:zlib";
import { readdir, readFile, writeFile } from "node:fs/promises";
import {
  assertValidSeries,
  cdd18PerYear,
  daysAtOrAbovePerYear,
  heavyRainDaysPerYear,
  jjaMeanTmax,
  longestSpellAtOrAbove,
  rx1day,
  tropicalNightsPerYear,
  type DailySeries,
} from "../src/lib/metrics.js";

const CACHE_DIR = new URL("../data/era5land/", import.meta.url);
const OUT_FILE = new URL("../data/metrics-preview.json", import.meta.url);

const LAYERS = {
  normals: { from: "1991-01-01", to: "2020-12-31" },
  recent: { from: "2011-01-01", to: "2025-12-31" },
} as const;

interface CachedPayload {
  readonly meta: {
    readonly insee: string;
    readonly name: string;
    readonly dept: string;
    readonly requested: { lat: number; lon: number; elevationM: number | null };
    readonly grid: { lat: number; lon: number; elevation: number };
  };
  readonly daily: {
    readonly time: string[];
    readonly temperature_2m_max: (number | null)[];
    readonly temperature_2m_min: (number | null)[];
    readonly precipitation_sum: (number | null)[];
  };
}

interface LayerMetrics {
  readonly jjaTmaxC: number | null;
  readonly cdd18: number | null;
  readonly tropicalNights: number | null;
  readonly days30: number | null;
  readonly days35: number | null;
  readonly spell35Mean: number | null;
  readonly spell35Max: number | null;
  readonly rx1dayMm: number | null;
  readonly rx1dayDate: string | null;
  readonly heavyRainDays40: number | null;
  readonly yearsUsed: number | null;
}

function sliceSeries(payload: CachedPayload, from: string, to: string): DailySeries {
  const { time, temperature_2m_max, temperature_2m_min, precipitation_sum } =
    payload.daily;
  const start = time.findIndex((d) => d >= from);
  if (start === -1) {
    return { dates: [], tmax: [], tmin: [], precip: [] };
  }
  let end = time.length;
  for (let i = start; i < time.length; i++) {
    if (time[i]! > to) {
      end = i;
      break;
    }
  }
  return {
    dates: time.slice(start, end),
    tmax: temperature_2m_max.slice(start, end),
    tmin: temperature_2m_min.slice(start, end),
    precip: precipitation_sum.slice(start, end),
  };
}

const round1 = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 10) / 10;

function computeLayer(series: DailySeries): LayerMetrics {
  const jja = jjaMeanTmax(series);
  const cdd = cdd18PerYear(series);
  const tropical = tropicalNightsPerYear(series);
  const d30 = daysAtOrAbovePerYear(series.dates, series.tmax, 30);
  const d35 = daysAtOrAbovePerYear(series.dates, series.tmax, 35);
  const spell = longestSpellAtOrAbove(series.dates, series.tmax, 35);
  const rx = rx1day(series);
  const r40 = heavyRainDaysPerYear(series);
  return {
    jjaTmaxC: round1(jja?.value),
    cdd18: round1(cdd?.value),
    tropicalNights: round1(tropical?.value),
    days30: round1(d30?.value),
    days35: round1(d35?.value),
    spell35Mean: round1(spell?.meanAnnualMaxDays),
    spell35Max: spell?.absoluteMaxDays ?? null,
    rx1dayMm: round1(rx?.value),
    rx1dayDate: rx?.date ?? null,
    heavyRainDays40: round1(r40?.value),
    yearsUsed: jja?.years ?? null,
  };
}

async function main(): Promise<void> {
  const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith(".json.gz"));
  if (files.length === 0) {
    throw new Error("no cached series — run pipeline:era5land first");
  }
  const communes = [];
  for (const file of files) {
    const payload = JSON.parse(
      gunzipSync(await readFile(new URL(file, CACHE_DIR))).toString(),
    ) as CachedPayload;
    const full: DailySeries = {
      dates: payload.daily.time,
      tmax: payload.daily.temperature_2m_max,
      tmin: payload.daily.temperature_2m_min,
      precip: payload.daily.precipitation_sum,
    };
    assertValidSeries(full);
    communes.push({
      insee: payload.meta.insee,
      name: payload.meta.name,
      dept: payload.meta.dept,
      elevationM: payload.meta.requested.elevationM,
      gridElevationM: payload.meta.grid.elevation,
      normals: computeLayer(sliceSeries(payload, LAYERS.normals.from, LAYERS.normals.to)),
      recent: computeLayer(sliceSeries(payload, LAYERS.recent.from, LAYERS.recent.to)),
    });
  }
  communes.sort((a, b) => (b.normals.jjaTmaxC ?? -99) - (a.normals.jjaTmaxC ?? -99));

  await writeFile(
    OUT_FILE,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          model: "era5_land",
          layers: LAYERS,
          count: communes.length,
        },
        communes,
      },
      null,
      1,
    ),
  );

  console.log(
    "\nname                      elev  JJA_n  JJA_r  CDD_n  CDD_r  tropN_r  d35_r  rx1d",
  );
  for (const c of communes) {
    console.log(
      c.name.padEnd(25) +
        String(c.elevationM ?? "?").padStart(5) +
        String(c.normals.jjaTmaxC ?? "—").padStart(7) +
        String(c.recent.jjaTmaxC ?? "—").padStart(7) +
        String(Math.round(c.normals.cdd18 ?? 0)).padStart(7) +
        String(Math.round(c.recent.cdd18 ?? 0)).padStart(7) +
        String(c.recent.tropicalNights ?? "—").padStart(9) +
        String(c.recent.days35 ?? "—").padStart(7) +
        String(c.recent.rx1dayMm ?? "—").padStart(6),
    );
  }
  console.log(`\nwrote ${OUT_FILE.pathname} (${communes.length} communes)`);
}

await main();
