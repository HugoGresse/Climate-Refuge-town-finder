/**
 * Station-truth validation (issue #8, METHODOLOGY.md §7): recompute the
 * primary heat indicators from Météo-France daily observations
 * (meteo.data.gouv.fr, Licence Ouverte) and compare with the pipeline's
 * commune values — bias and RMSE by elevation band.
 *
 * Known, documented offsets: ERA5-Land is a ~10 km grid (no urban heat
 * island), and reanalysis "days" differ slightly from station observation
 * windows. The point is to MEASURE the offset, not to hide it.
 *
 * Usage: npm run pipeline:validate
 */
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { haversineKm } from "../src/lib/geo.js";

const BASE =
  "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT";
const DEPTS = ["34", "30", "48", "66", "63", "38", "12", "69"];
const FILES = ["previous-1950-2024", "latest-2025-2026"];
const CACHE_DIR = new URL("../data/mf/", import.meta.url);
const DATASET_FILE = new URL("../web/public/data/dataset.json", import.meta.url);
const REPORT_JSON = new URL("../data/validation-report.json", import.meta.url);
const REPORT_MD = new URL("../docs/VALIDATION.md", import.meta.url);

const FROM = "20160101";
const TO = "20251231";
const MIN_JJA_DAYS = 8 * 85;
const MATCH_MAX_KM = 8;
/**
 * A station only validates a commune whose mairie sits at a comparable
 * altitude — else the comparison measures the valley-vs-summit difference,
 * not the model (a 1 900 m station paired with a 1 200 m mairie is "warm
 * bias" by construction).
 */
const MATCH_MAX_DELEV_M = 150;

interface StationAgg {
  name: string;
  lat: number;
  lon: number;
  alti: number;
  jjaTxSum: number;
  jjaTxCount: number;
  tropCount: number;
  tnCount: number;
}

async function download(name: string): Promise<URL> {
  const target = new URL(name, CACHE_DIR);
  if (existsSync(target)) return target;
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} for ${name}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(target),
  );
  console.log(`downloaded ${name}`);
  return target;
}

async function parseFile(path: URL, stations: Map<string, StationAgg>): Promise<void> {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let idx: Record<string, number> | null = null;
  for await (const line of lines) {
    const parts = line.split(";");
    if (idx === null) {
      idx = {};
      parts.forEach((h, i) => (idx![h.trim()] = i));
      continue;
    }
    const date = parts[idx["AAAAMMJJ"]!];
    if (!date || date < FROM || date > TO) continue;
    const id = parts[idx["NUM_POSTE"]!]!;
    let station = stations.get(id);
    if (!station) {
      station = {
        name: parts[idx["NOM_USUEL"]!] ?? id,
        lat: Number(parts[idx["LAT"]!]),
        lon: Number(parts[idx["LON"]!]),
        alti: Number(parts[idx["ALTI"]!]),
        jjaTxSum: 0,
        jjaTxCount: 0,
        tropCount: 0,
        tnCount: 0,
      };
      stations.set(id, station);
    }
    const month = date.slice(4, 6);
    const tx = parts[idx["TX"]!];
    const tn = parts[idx["TN"]!];
    if (tx && month >= "06" && month <= "08") {
      station.jjaTxSum += Number(tx);
      station.jjaTxCount++;
    }
    if (tn) {
      station.tnCount++;
      if (Number(tn) >= 20) station.tropCount++;
    }
  }
}

function band(alti: number): string {
  if (alti < 200) return "<200 m";
  if (alti < 600) return "200–600 m";
  if (alti < 1000) return "600–1000 m";
  return "≥1000 m";
}

async function main(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
  const stations = new Map<string, StationAgg>();
  for (const dept of DEPTS) {
    for (const period of FILES) {
      await parseFile(await download(`Q_${dept}_${period}_RR-T-Vent.csv.gz`), stations);
    }
    console.log(`dept ${dept} parsed (${stations.size} stations cumulated)`);
  }

  const dataset = JSON.parse(await readFile(DATASET_FILE, "utf8")) as {
    communes: {
      insee: string;
      name: string;
      lat: number;
      lon: number;
      elev: number | null;
      jjaRecent: number;
      tropN: number | null;
    }[];
  };

  const rows = [];
  for (const s of stations.values()) {
    if (s.jjaTxCount < MIN_JJA_DAYS || !Number.isFinite(s.lat)) continue;
    let best = null;
    let bestKm = Infinity;
    for (const c of dataset.communes) {
      if (c.elev === null || Math.abs(c.elev - s.alti) > MATCH_MAX_DELEV_M) {
        continue;
      }
      const km = haversineKm({ lat: s.lat, lon: s.lon }, { lat: c.lat, lon: c.lon });
      if (km < bestKm) {
        bestKm = km;
        best = c;
      }
    }
    if (!best || bestKm > MATCH_MAX_KM) continue;
    const stationJja = s.jjaTxSum / s.jjaTxCount;
    const stationTropPerYear = s.tnCount > 0 ? s.tropCount / (s.tnCount / 365.25) : null;
    rows.push({
      station: s.name,
      alti: s.alti,
      band: band(s.alti),
      commune: best.name,
      distanceKm: Math.round(bestKm * 10) / 10,
      stationJja: Math.round(stationJja * 10) / 10,
      modelJja: best.jjaRecent,
      biasJja: Math.round((best.jjaRecent - stationJja) * 100) / 100,
      stationTropN: stationTropPerYear === null ? null : Math.round(stationTropPerYear * 10) / 10,
      modelTropN: best.tropN,
    });
  }

  const bands = new Map<string, { biases: number[] }>();
  for (const r of rows) {
    const entry = bands.get(r.band) ?? { biases: [] };
    entry.biases.push(r.biasJja);
    bands.set(r.band, entry);
  }
  const bandStats = [...bands].map(([name, { biases }]) => {
    const mean = biases.reduce((a, b) => a + b, 0) / biases.length;
    const rmse = Math.sqrt(biases.reduce((a, b) => a + b * b, 0) / biases.length);
    return {
      band: name,
      n: biases.length,
      meanBias: Math.round(mean * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
    };
  });

  await writeFile(
    REPORT_JSON,
    JSON.stringify({
      meta: {
        generatedAt: new Date().toISOString(),
        source: "Météo-France données quotidiennes (meteo.data.gouv.fr, Licence Ouverte)",
        period: "2016-2025 (JJA for Tmax)",
        depts: DEPTS,
        note: "bias = model (commune, ERA5-Land downscaled) − station observation",
      },
      bandStats,
      stations: rows,
    }, null, 1),
  );

  const md = [
    "# Validation contre les stations Météo-France",
    "",
    `Générée le ${new Date().toISOString().slice(0, 10)} — période 2016–2025,`,
    `départements ${DEPTS.join(", ")} (${rows.length} stations appariées à ≤ ${MATCH_MAX_KM} km).`,
    "Biais = valeur modèle (commune, ERA5-Land désagrégé) − observation station.",
    "",
    "## Tmax moyen d'été (JJA) — par bande d'altitude",
    "",
    "| Bande | Stations | Biais moyen (°C) | RMSE (°C) |",
    "|---|---|---|---|",
    ...bandStats
      .sort((a, b) => a.band.localeCompare(b.band))
      .map((b) => `| ${b.band} | ${b.n} | ${b.meanBias} | ${b.rmse} |`),
    "",
    "## Stations",
    "",
    "| Station | Alt. | Commune appariée | JJA station | JJA modèle | Biais | Nuits trop. station | modèle |",
    "|---|---|---|---|---|---|---|---|",
    ...rows
      .sort((a, b) => a.alti - b.alti)
      .map(
        (r) =>
          `| ${r.station} | ${r.alti} m | ${r.commune} (${r.distanceKm} km) | ${r.stationJja} | ${r.modelJja} | ${r.biasJja} | ${r.stationTropN ?? "—"} | ${r.modelTropN ?? "—"} |`,
      ),
    "",
    "Écarts attendus et documentés : maille ~10 km sans îlot de chaleur urbain",
    "(nuits urbaines sous-estimées), fenêtres journalières réanalyse vs station.",
  ].join("\n");
  await writeFile(REPORT_MD, md);

  console.log(`\n${rows.length} stations matched`);
  for (const b of bandStats) {
    console.log(`${b.band.padEnd(11)} n=${String(b.n).padStart(3)}  bias ${b.meanBias}  rmse ${b.rmse}`);
  }
  console.log("wrote docs/VALIDATION.md + data/validation-report.json");
}

await main();
