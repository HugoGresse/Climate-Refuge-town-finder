/**
 * Builds the commune referential: every metropolitan commune with its mairie
 * coordinates (geometric centre only as flagged fallback), population and
 * elevation at that point.
 *
 * Sources: geo.api.gouv.fr (Etalab) + Open-Meteo elevation API (Copernicus
 * GLO-90 DEM) — never the weather API's internal downscaling elevation.
 * Output: data/communes.json, a versioned derived artifact (gitignored).
 *
 * Usage: npm run pipeline:communes
 */
import { mkdir, writeFile } from "node:fs/promises";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // .env is optional — the free endpoint works without it, just slower.
}

const GEO_API =
  "https://geo.api.gouv.fr/communes?zone=metro&format=json" +
  "&fields=nom,code,codeDepartement,codeEpci,population,centre,mairie";
const API_KEY = process.env["OPEN_METEO_API_KEY"];
const ELEVATION_API = API_KEY
  ? "https://customer-api.open-meteo.com/v1/elevation"
  : "https://api.open-meteo.com/v1/elevation";
const ELEVATION_BATCH = 100;
const ELEVATION_PAUSE_MS = API_KEY ? 100 : 700;
const OUT_FILE = new URL("../data/communes.json", import.meta.url);

interface GeoPoint {
  readonly type: string;
  readonly coordinates: readonly [number, number]; // [lon, lat]
}

interface GeoApiCommune {
  readonly nom: string;
  readonly code: string;
  readonly codeDepartement: string;
  readonly codeEpci?: string;
  readonly population?: number;
  readonly centre?: GeoPoint;
  readonly mairie?: GeoPoint;
}

export interface Commune {
  readonly insee: string;
  readonly name: string;
  readonly dept: string;
  readonly epci: string | null;
  readonly population: number | null;
  readonly lat: number;
  readonly lon: number;
  /** "mairie" is the representative point; "centre" is a flagged fallback. */
  readonly coordSource: "mairie" | "centre";
  readonly elevationM: number | null;
}

async function fetchJson<T>(url: string, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 5000 * attempt;
        throw new RateLimitError(waitMs);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(error instanceof RateLimitError ? error.waitMs : 1000 * attempt);
      }
    }
  }
  throw lastError;
}

class RateLimitError extends Error {
  constructor(readonly waitMs: number) {
    super(`rate limited, waiting ${waitMs} ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCommune(raw: GeoApiCommune): Omit<Commune, "elevationM"> | null {
  const point = raw.mairie ?? raw.centre;
  if (!point) return null;
  const [lon, lat] = point.coordinates;
  return {
    insee: raw.code,
    name: raw.nom,
    dept: raw.codeDepartement,
    epci: raw.codeEpci ?? null,
    population: raw.population ?? null,
    lat,
    lon,
    coordSource: raw.mairie ? "mairie" : "centre",
  };
}

async function fetchElevations(
  points: readonly { lat: number; lon: number }[],
): Promise<(number | null)[]> {
  const elevations: (number | null)[] = [];
  const batches = Math.ceil(points.length / ELEVATION_BATCH);
  for (let b = 0; b < batches; b++) {
    const batch = points.slice(b * ELEVATION_BATCH, (b + 1) * ELEVATION_BATCH);
    const url =
      `${ELEVATION_API}?latitude=${batch.map((p) => p.lat.toFixed(5)).join(",")}` +
      `&longitude=${batch.map((p) => p.lon.toFixed(5)).join(",")}` +
      (API_KEY ? `&apikey=${API_KEY}` : "");
    try {
      const result = await fetchJson<{ elevation: number[] }>(url);
      for (let i = 0; i < batch.length; i++) {
        elevations.push(result.elevation[i] ?? null);
      }
    } catch (error) {
      console.warn(`elevation batch ${b + 1}/${batches} failed: ${String(error)}`);
      for (let i = 0; i < batch.length; i++) elevations.push(null);
    }
    if (b % 25 === 0) {
      console.log(`elevation ${b + 1}/${batches} batches`);
    }
    await sleep(ELEVATION_PAUSE_MS);
  }
  return elevations;
}

async function main(): Promise<void> {
  console.log("fetching communes from geo.api.gouv.fr…");
  const raw = await fetchJson<GeoApiCommune[]>(GEO_API);
  const withoutPoint: string[] = [];
  const bases = raw.flatMap((r) => {
    const commune = toCommune(r);
    if (!commune) {
      withoutPoint.push(r.code);
      return [];
    }
    return [commune];
  });
  const mairieCount = bases.filter((c) => c.coordSource === "mairie").length;
  console.log(
    `${bases.length} metropolitan communes ` +
      `(${mairieCount} mairie points, ${bases.length - mairieCount} centre fallbacks, ` +
      `${withoutPoint.length} skipped without coordinates)`,
  );

  console.log("fetching elevations (Copernicus DEM via Open-Meteo)…");
  const elevations = await fetchElevations(bases);
  const communes: Commune[] = bases.map((base, i) => ({
    ...base,
    elevationM: elevations[i] ?? null,
  }));
  const missingElevation = communes.filter((c) => c.elevationM === null).length;

  const artifact = {
    meta: {
      schemaVersion: 1,
      fetchedAt: new Date().toISOString(),
      sources: {
        communes: GEO_API,
        elevation: `${ELEVATION_API} (Copernicus GLO-90)`,
      },
      counts: {
        communes: communes.length,
        centreFallbacks: bases.length - mairieCount,
        skippedWithoutCoordinates: withoutPoint.length,
        missingElevation,
      },
    },
    communes,
  };

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(artifact));
  console.log(`wrote ${OUT_FILE.pathname} (${communes.length} communes)`);
}

await main();
