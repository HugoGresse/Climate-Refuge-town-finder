/**
 * Builds per-commune hazard history from the GASPAR bulk dump
 * (files.georisques.fr — Licence Ouverte 2.0, BRGM/Géorisques):
 *
 * - CATNAT arrêtés since 1982, deduped by (arrêté, commune, event start):
 *   floods ("Inondations et/ou Coulées de Boue" + "Inondations Remontée
 *   Nappe"), coastal wave shocks, drought (clay-damage proxy).
 * - PPRN flood exposure: best state of any plan whose risks mention
 *   inondation/submersion (approved/opposable vs prescribed).
 * - AZI presence (atlas des zones inondables).
 *
 * Counts are history, not hazard scores — rate-normalisation and framing
 * happen at scoring time (METHODOLOGY.md §5). Output: data/hazards.json.
 *
 * Usage: npm run pipeline:hazards
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const GASPAR_URL = "https://files.georisques.fr/GASPAR/gaspar.zip";
const GASPAR_DIR = new URL("../data/gaspar/", import.meta.url);
const OUT_FILE = new URL("../data/hazards.json", import.meta.url);

const FLOOD_LABELS = [
  "Inondations et/ou Coulées de Boue",
  "Inondations Remontée Nappe",
];
const COASTAL_LABEL = "Chocs Mécaniques liés à l'action des Vagues";
const DROUGHT_LABEL = "Sécheresse";
/** DDRM (dossier départemental des risques majeurs) identified-risk labels. */
const DDRM_WILDFIRE = "Feu de forêt";
const DDRM_CLAY = "Tassements différentiels";
const COASTAL_RETREAT_CSV =
  "https://static.data.gouv.fr/resources/liste-des-communes-volontaires-pour-sadapter-au-recul-du-trait-de-cote/20260218-105039/trait-de-cote-commune-2026-95.csv";

interface CommuneHazards {
  floodCatnat: number;
  floodCatnatSince2000: number;
  lastFlood: string | null;
  coastalWaveCatnat: number;
  droughtCatnat: number;
  ppriState: "approved" | "prescribed" | null;
  azi: boolean;
  /** Risk identified in the DDRM — identification, not an intensity class. */
  wildfireDdrm: boolean;
  clayDdrm: boolean;
  /** Commune under an active coastal-retreat adaptation decree. */
  coastalRetreat: boolean;
}

/** Delimited split honoring double quotes (with "" escapes). */
export function splitDelimited(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export const splitSemicolonLine = (line: string): string[] =>
  splitDelimited(line, ";");

async function ensureDump(): Promise<void> {
  const zip = new URL("gaspar.zip", GASPAR_DIR);
  await mkdir(GASPAR_DIR, { recursive: true });
  if (!existsSync(zip)) {
    console.log("downloading gaspar.zip…");
    const response = await fetch(GASPAR_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${GASPAR_URL}`);
    await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  }
  const files = await readdir(GASPAR_DIR);
  if (!files.some((f) => f.startsWith("catnat_gaspar_"))) {
    const result = spawnSync("unzip", ["-oq", "gaspar.zip"], {
      cwd: GASPAR_DIR.pathname,
    });
    if (result.status !== 0) throw new Error("unzip failed");
  }
}

async function loadCsv(prefix: string): Promise<{ header: string[]; rows: string[][] }> {
  const files = await readdir(GASPAR_DIR);
  const name = files.filter((f) => f.startsWith(prefix)).sort().at(-1);
  if (!name) throw new Error(`no ${prefix}* file in data/gaspar`);
  const text = await readFile(new URL(name, GASPAR_DIR), "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = splitSemicolonLine(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).map(splitSemicolonLine);
  console.log(`${name}: ${rows.length} rows`);
  return { header, rows };
}

function column(header: string[], name: string): number {
  const index = header.indexOf(name);
  if (index === -1) throw new Error(`column ${name} missing in [${header.join(", ")}]`);
  return index;
}

function entry(map: Map<string, CommuneHazards>, insee: string): CommuneHazards {
  let existing = map.get(insee);
  if (!existing) {
    existing = {
      floodCatnat: 0,
      floodCatnatSince2000: 0,
      lastFlood: null,
      coastalWaveCatnat: 0,
      droughtCatnat: 0,
      ppriState: null,
      azi: false,
      wildfireDdrm: false,
      clayDdrm: false,
      coastalRetreat: false,
    };
    map.set(insee, existing);
  }
  return existing;
}

async function main(): Promise<void> {
  await ensureDump();
  const hazards = new Map<string, CommuneHazards>();

  const catnat = await loadCsv("catnat_gaspar_");
  const cInsee = column(catnat.header, "code_commune");
  const cLabel = column(catnat.header, "lib_risque_jo");
  const cStart = column(catnat.header, "date_debut");
  const cId = column(catnat.header, "id_gaspar");
  const seen = new Set<string>();
  for (const row of catnat.rows) {
    const insee = row[cInsee];
    const label = row[cLabel];
    const date = (row[cStart] ?? "").slice(0, 10);
    if (!insee || !label) continue;
    const dedupeKey = `${row[cId]}|${insee}|${label}|${date}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const commune = entry(hazards, insee);
    if (FLOOD_LABELS.includes(label)) {
      commune.floodCatnat++;
      if (date >= "2000-01-01") commune.floodCatnatSince2000++;
      if (commune.lastFlood === null || date > commune.lastFlood) {
        commune.lastFlood = date;
      }
    } else if (label === COASTAL_LABEL) {
      commune.coastalWaveCatnat++;
    } else if (label === DROUGHT_LABEL) {
      commune.droughtCatnat++;
    }
  }

  const pprn = await loadCsv("pprn_gaspar_");
  const pInsee = column(pprn.header, "CODE INSEE COMMUNE");
  const pRisks = [1, 2, 3].map((n) => column(pprn.header, `LIBELLE RISQUE ${n}`));
  const pState = column(pprn.header, "LIBELLE ETAT");
  for (const row of pprn.rows) {
    const insee = row[pInsee];
    if (!insee) continue;
    const risks = pRisks.map((i) => (row[i] ?? "").toLowerCase()).join(" ");
    if (!risks.includes("nondation") && !risks.includes("ubmersion")) continue;
    const state = (row[pState] ?? "").toLowerCase();
    const commune = entry(hazards, insee);
    if (state.includes("opposable") || state.includes("approuv")) {
      commune.ppriState = "approved";
    } else if (state.includes("prescrit") && commune.ppriState === null) {
      commune.ppriState = "prescribed";
    }
  }

  const azi = await loadCsv("azi_gaspar_");
  const aInsee = column(azi.header, "cod_commune");
  for (const row of azi.rows) {
    const insee = row[aInsee];
    if (insee) entry(hazards, insee).azi = true;
  }

  const ddrm = await loadCsv("ddrm_risq_gaspar_");
  const dInsee = column(ddrm.header, "cod_commune");
  const dRisk = column(ddrm.header, "lib_risque");
  for (const row of ddrm.rows) {
    const insee = row[dInsee];
    const risk = row[dRisk];
    if (!insee || !risk) continue;
    if (risk === DDRM_WILDFIRE) entry(hazards, insee).wildfireDdrm = true;
    else if (risk === DDRM_CLAY) entry(hazards, insee).clayDdrm = true;
  }

  // Coastal-retreat decree list (data.gouv, Licence Ouverte 2.0).
  const coastalDir = new URL("../data/hazard-src/", import.meta.url);
  await mkdir(coastalDir, { recursive: true });
  const coastalFile = new URL("coastal.csv", coastalDir);
  if (!existsSync(coastalFile)) {
    const response = await fetch(COASTAL_RETREAT_CSV);
    if (!response.ok) throw new Error(`coastal list HTTP ${response.status}`);
    await writeFile(coastalFile, await response.text());
  }
  const coastalLines = (await readFile(coastalFile, "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const coastalHeader = splitDelimited(coastalLines[0]!, ",");
  const ccInsee = coastalHeader.indexOf("code_commune");
  const ccActive = coastalHeader.indexOf("is_currently_active");
  let coastalCount = 0;
  for (const line of coastalLines.slice(1)) {
    const row = splitDelimited(line, ",");
    const insee = row[ccInsee];
    if (!insee || row[ccActive]?.toLowerCase() !== "true") continue;
    entry(hazards, insee).coastalRetreat = true;
    coastalCount++;
  }
  console.log(`coastal-retreat decree communes (active): ${coastalCount}`);

  const artifact = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: `${GASPAR_URL} (Licence Ouverte 2.0 — BRGM/Géorisques)`,
      floodObservationStart: 1982,
      communesWithData: hazards.size,
    },
    communes: Object.fromEntries(hazards),
  };
  await writeFile(OUT_FILE, JSON.stringify(artifact));
  console.log(`wrote hazards.json (${hazards.size} communes)`);

  // Sanity: flood *rate* by department (methodology: rates, never raw totals).
  const byDept = new Map<string, { floods: number; communes: number }>();
  for (const [insee, h] of hazards) {
    const dept = insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2);
    const d = byDept.get(dept) ?? { floods: 0, communes: 0 };
    d.floods += h.floodCatnat;
    d.communes++;
    byDept.set(dept, d);
  }
  const rates = [...byDept]
    .filter(([, d]) => d.communes >= 50)
    .map(([dept, d]) => [dept, d.floods / d.communes] as const)
    .sort((a, b) => b[1] - a[1]);
  console.log("top flood rates (arrêtés/commune):",
    rates.slice(0, 5).map(([dept, rate]) => `${dept}=${rate.toFixed(1)}`).join(" "));
}

await main();
