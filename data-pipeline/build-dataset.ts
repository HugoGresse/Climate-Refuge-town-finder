/**
 * Merges the commune referential, climate metrics and hazard history into the
 * static dataset the web explorer loads. Only communes whose recent layer has
 * enough years are included — partial ingests must not paint wrong colors.
 *
 * Usage: npm run pipeline:dataset   (after pipeline:metrics and pipeline:hazards)
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { percentileRanks } from "../src/lib/normalise.js";

const COMMUNES_FILE = new URL("../data/communes.json", import.meta.url);
const METRICS_FILE = new URL("../data/metrics-preview.json", import.meta.url);
const HAZARDS_FILE = new URL("../data/hazards.json", import.meta.url);
const LIVABILITY_FILE = new URL("../data/livability.json", import.meta.url);
const OUT_FILE = new URL("../web/public/data/dataset.json", import.meta.url);

const MIN_RECENT_YEARS = 8;

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

interface MetricsEntry {
  insee: string;
  name: string;
  dept: string;
  elevationM: number | null;
  normals: { jjaTmaxC: number | null };
  recent: {
    jjaTmaxC: number | null;
    cdd18: number | null;
    tropicalNights: number | null;
    days30: number | null;
    days35: number | null;
    yearsUsed: number | null;
  };
}

async function main(): Promise<void> {
  const referential = await readJson<{
    communes: { insee: string; lat: number; lon: number; population: number | null }[];
  }>(COMMUNES_FILE);
  const metrics = await readJson<{ meta: { layers: unknown }; communes: MetricsEntry[] }>(
    METRICS_FILE,
  );
  const hazards = await readJson<{
    meta: { source: string };
    communes: Record<
      string,
      {
        floodCatnat: number;
        floodCatnatSince2000: number;
        lastFlood: string | null;
        ppriState: string | null;
        azi: boolean;
        wildfireDdrm: boolean;
        clayDdrm: boolean;
        coastalRetreat: boolean;
      }
    >;
  }>(HAZARDS_FILE);

  const livability = await readJson<{
    meta: { source: string };
    communes: Record<string, Record<string, number>>;
  }>(LIVABILITY_FILE);

  const position = new Map(
    referential.communes.map((c) => [c.insee, c] as const),
  );

  const excluded: string[] = [];
  const communes = metrics.communes.flatMap((m) => {
    const base = position.get(m.insee);
    const years = m.recent.yearsUsed ?? 0;
    if (!base || years < MIN_RECENT_YEARS || m.recent.jjaTmaxC === null) {
      excluded.push(m.name);
      return [];
    }
    const hazard = hazards.communes[m.insee];
    return [
      {
        insee: m.insee,
        name: m.name,
        dept: m.dept,
        lat: base.lat,
        lon: base.lon,
        pop: base.population,
        elev: m.elevationM,
        jjaRecent: m.recent.jjaTmaxC,
        jjaNormals: m.normals.jjaTmaxC,
        cdd: m.recent.cdd18,
        tropN: m.recent.tropicalNights,
        d30: m.recent.days30,
        d35: m.recent.days35,
        floods: hazard?.floodCatnat ?? 0,
        floods2000: hazard?.floodCatnatSince2000 ?? 0,
        lastFlood: hazard?.lastFlood ?? null,
        ppri: hazard?.ppriState ?? null,
        azi: hazard?.azi ?? false,
        fire: hazard?.wildfireDdrm ?? false,
        clay: hazard?.clayDdrm ?? false,
        coastal: hazard?.coastalRetreat ?? false,
        hosp: (livability.communes[m.insee]?.["hospital"] ?? 0) > 0,
        urg: (livability.communes[m.insee]?.["urgences"] ?? 0) > 0,
        gp: livability.communes[m.insee]?.["gp"] ?? 0,
        pharm: (livability.communes[m.insee]?.["pharmacy"] ?? 0) > 0,
        station: (livability.communes[m.insee]?.["station"] ?? 0) > 0,
        lycee: (livability.communes[m.insee]?.["lycee"] ?? 0) > 0,
        superm: (livability.communes[m.insee]?.["supermarket"] ?? 0) > 0,
        trend: livability.communes[m.insee]?.["trendPctYr"] ?? null,
      },
    ];
  });

  // National burden percentiles (methodology §6: national, never per-circle).
  // Heat sub-index collapses the correlated day/night indicators: mean of the
  // CDD18 percentile (linear backbone) and the tropical-nights percentile.
  const cddPct = percentileRanks(communes.map((c) => c.cdd));
  const tropPct = percentileRanks(communes.map((c) => c.tropN));
  const floodPct = percentileRanks(communes.map((c) => c.floods));
  const withPct = communes.map((c, i) => {
    const cdd = cddPct[i];
    const trop = tropPct[i];
    const heat =
      cdd != null && trop != null ? Math.round((cdd + trop) / 2) : null;
    return {
      ...c,
      hPct: heat,
      fPct: floodPct[i] == null ? null : Math.round(floodPct[i]!),
    };
  });

  await mkdir(new URL(".", OUT_FILE), { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify({
      meta: {
        generatedAt: new Date().toISOString(),
        layers: metrics.meta.layers,
        model: "era5_land (pinned)",
        hazardsSource: hazards.meta.source,
        count: withPct.length,
      },
      communes: withPct,
    }),
  );
  console.log(
    `wrote dataset.json: ${withPct.length} communes` +
      (excluded.length ? ` (${excluded.length} excluded for coverage)` : ""),
  );
}

await main();
