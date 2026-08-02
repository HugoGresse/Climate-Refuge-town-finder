/**
 * Fetches daily ERA5-Land series (pinned model, Europe/Paris days) per commune
 * at its mairie point, with statistical downscaling forced to the referential
 * DEM elevation. Cached one gzipped JSON per commune — resumable, so partial
 * runs and quota pauses are harmless.
 *
 * Free tier is heavily weighted for 35-year pulls (~270 units/commune), hence
 * sequential fetching with adaptive pacing. When the API key's plan includes
 * the historical endpoint, the customer host is used automatically.
 *
 * Usage:
 *   npm run pipeline:era5land               # 20 validation towns
 *   npm run pipeline:era5land -- dept:48    # one department
 *   npm run pipeline:era5land -- pilot      # Occitanie + AuRA (needs paid plan)
 */
import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // optional
}

const ARGS = process.argv.slice(2);
/** --local targets a self-hosted open-meteo container (no quota, no key). */
const LOCAL = ARGS.includes("--local");

const API_KEY = process.env["OPEN_METEO_API_KEY"];
const FREE_HOST = "https://archive-api.open-meteo.com/v1/archive";
const CUSTOMER_HOST = "https://customer-archive-api.open-meteo.com/v1/archive";
const LOCAL_HOST = process.env["OM_LOCAL_HOST"] ?? "http://127.0.0.1:8080/v1/archive";

// Self-hosted archive is synced from 2015 (user decision — recent layer is
// the primary orientation; pre-2015 normals wait on the CDS path).
const START_DATE = process.env["OM_START"] ?? (LOCAL ? "2015-01-01" : "1991-01-01");
const END_DATE = "2025-12-31";
// No precipitation here: ERA5-Land via Open-Meteo serves none (verified —
// 12 784/12 784 nulls). Heavy-precip metrics come from CERRA (issue #7).
const DAILY_VARS = "temperature_2m_max,temperature_2m_min";
const MODEL = "era5_land";

const COMMUNES_FILE = new URL("../data/communes.json", import.meta.url);
const CACHE_DIR = new URL("../data/era5land/", import.meta.url);

/** METHODOLOGY.md §7 validation towns (terrain-stratified, pilot region). */
const VALIDATION_TOWNS = [
  "Montpellier", "Sète", "Nîmes", "Alès", "Mende", "Millau", "Rodez",
  "Aurillac", "Le Puy-en-Velay", "Clermont-Ferrand", "Saint-Étienne", "Lyon",
  "Grenoble", "Chambéry", "Annecy", "Toulouse", "Albi", "Carcassonne",
  "Perpignan", "Font-Romeu-Odeillo-Via",
];

const PILOT_DEPTS = [
  "09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82",
  "01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74",
];

interface Commune {
  readonly insee: string;
  readonly name: string;
  readonly dept: string;
  readonly population: number | null;
  readonly lat: number;
  readonly lon: number;
  readonly elevationM: number | null;
}

interface ArchiveResponse {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number;
  readonly daily: {
    readonly time: string[];
    readonly temperature_2m_max: (number | null)[];
    readonly temperature_2m_min: (number | null)[];
  };
}

class RateLimitError extends Error {
  constructor(readonly waitMs: number) {
    super(`rate limited, waiting ${Math.round(waitMs / 1000)} s`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveHost(): Promise<string> {
  if (LOCAL) {
    console.log(`using self-hosted open-meteo at ${LOCAL_HOST}`);
    return LOCAL_HOST;
  }
  if (!API_KEY) return FREE_HOST;
  const probe =
    `${CUSTOMER_HOST}?latitude=43.6&longitude=3.9&start_date=2024-01-01` +
    `&end_date=2024-01-02&daily=temperature_2m_max&models=${MODEL}` +
    `&timezone=Europe%2FParis&apikey=${API_KEY}`;
  const response = await fetch(probe);
  const body = (await response.json()) as { error?: boolean; reason?: string };
  if (!body.error) {
    console.log("using customer endpoint (plan includes historical API)");
    return CUSTOMER_HOST;
  }
  console.log(`customer endpoint refused (${body.reason}) — using free tier, slow pacing`);
  return FREE_HOST;
}

function buildUrl(host: string, commune: Commune): string {
  const elevation =
    commune.elevationM === null ? "" : `&elevation=${commune.elevationM}`;
  const key = host === CUSTOMER_HOST && API_KEY ? `&apikey=${API_KEY}` : "";
  return (
    `${host}?latitude=${commune.lat}&longitude=${commune.lon}${elevation}` +
    `&start_date=${START_DATE}&end_date=${END_DATE}&daily=${DAILY_VARS}` +
    `&models=${MODEL}&timezone=Europe%2FParis${key}`
  );
}

async function fetchSeries(url: string, attempts = 8): Promise<ArchiveResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        throw new RateLimitError(60_000 * Math.min(attempt, 4));
      }
      const body = (await response.json()) as
        | (ArchiveResponse & { error?: undefined })
        | { error: true; reason: string };
      if ("error" in body && body.error) {
        // Quota errors come back as 4xx JSON with a reason, not always 429.
        if (/limit|quota/i.test(body.reason)) {
          throw new RateLimitError(120_000 * Math.min(attempt, 4));
        }
        throw new Error(body.reason);
      }
      return body as ArchiveResponse;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const wait =
          error instanceof RateLimitError ? error.waitMs : 2000 * attempt;
        console.log(`  retry ${attempt}/${attempts - 1}: ${String(error)}`);
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

function selectTargets(communes: Commune[], mode: string): Commune[] {
  if (mode === "all") {
    return communes;
  }
  if (mode === "pilot") {
    return communes.filter((c) => PILOT_DEPTS.includes(c.dept));
  }
  if (mode.startsWith("dept:")) {
    const dept = mode.slice(5);
    return communes.filter((c) => c.dept === dept);
  }
  // validation: match by name, prefer pilot depts, then highest population
  return VALIDATION_TOWNS.flatMap((name) => {
    const matches = communes
      .filter((c) => c.name === name)
      .sort(
        (a, b) =>
          Number(PILOT_DEPTS.includes(b.dept)) -
            Number(PILOT_DEPTS.includes(a.dept)) ||
          (b.population ?? 0) - (a.population ?? 0),
      );
    if (matches.length === 0) {
      console.warn(`validation town not found: ${name}`);
      return [];
    }
    return [matches[0]!];
  });
}

async function main(): Promise<void> {
  const mode = ARGS.find((a) => !a.startsWith("--")) ?? "validation";
  const referential = JSON.parse(await readFile(COMMUNES_FILE, "utf8")) as {
    communes: Commune[];
  };
  const targets = selectTargets(referential.communes, mode);
  await mkdir(CACHE_DIR, { recursive: true });

  const host = await resolveHost();
  const pauseMs = LOCAL ? 25 : host === CUSTOMER_HOST ? 150 : 15_000;
  // The self-hosted API has no quota: batch many locations per request.
  const batchSize = LOCAL ? 50 : 1;

  const pending = targets.filter(
    (c) => !existsSync(new URL(`${c.insee}.json.gz`, CACHE_DIR)),
  );
  const skipped = targets.length - pending.length;
  let done = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const seriesList =
      batch.length === 1
        ? [await fetchSeries(buildUrl(host, batch[0]!))]
        : await fetchSeriesBatch(host, batch);
    for (let j = 0; j < batch.length; j++) {
      const commune = batch[j]!;
      const series = seriesList[j];
      if (!series) {
        console.warn(`no series for ${commune.name} (${commune.insee})`);
        continue;
      }
      const payload = {
        meta: {
          insee: commune.insee,
          name: commune.name,
          dept: commune.dept,
          requested: {
            lat: commune.lat,
            lon: commune.lon,
            elevationM: commune.elevationM,
          },
          grid: {
            lat: series.latitude,
            lon: series.longitude,
            elevation: series.elevation,
          },
          model: MODEL,
          period: { start: START_DATE, end: END_DATE },
          timezone: "Europe/Paris",
        },
        daily: series.daily,
      };
      await writeFile(
        new URL(`${commune.insee}.json.gz`, CACHE_DIR),
        gzipSync(JSON.stringify(payload)),
      );
      done++;
    }
    if (i % (batchSize * 20) === 0 || i + batchSize >= pending.length) {
      console.log(`${done + skipped}/${targets.length}`);
    }
    await sleep(pauseMs);
  }
  console.log(`finished: ${done} fetched, ${skipped} already cached, ${targets.length} total`);
}

async function fetchSeriesBatch(
  host: string,
  batch: readonly Commune[],
): Promise<(ArchiveResponse | null)[]> {
  const url =
    `${host}?latitude=${batch.map((c) => c.lat).join(",")}` +
    `&longitude=${batch.map((c) => c.lon).join(",")}` +
    `&elevation=${batch.map((c) => c.elevationM ?? "").join(",")}` +
    `&start_date=${START_DATE}&end_date=${END_DATE}&daily=${DAILY_VARS}` +
    `&models=${MODEL}&timezone=Europe%2FParis`;
  const list = (await fetchSeries(url)) as unknown;
  if (!Array.isArray(list)) {
    throw new Error("expected array response for multi-location request");
  }
  // Multi-location responses carry location_id; order matches the input.
  return batch.map((_, index) => (list[index] as ArchiveResponse) ?? null);
}

await main();
