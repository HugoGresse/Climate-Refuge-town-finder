/**
 * Golden-file gates on the 20 validation towns (METHODOLOGY.md §7).
 *
 * These ranges pin the *pipeline* to its verified 2026-08 output (±0.6 °C):
 * a regression in downscaling, day boundaries, layer slicing or unit handling
 * trips them. They are NOT station-truth validation — that comparison against
 * Météo-France observations is the remaining work of issue #8.
 *
 * Runs in CI against the committed web/public/data/dataset.json.
 */
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

interface Entry {
  name: string;
  dept: string;
  jjaRecent: number;
  tropN: number | null;
  floods: number;
  hosp: boolean;
  station: boolean;
}

/** [name, dept, expected JJA Tmax 2016–2025] — tolerance ±0.6 °C. */
const EXPECTED_JJA: [string, string, number][] = [
  ["Nîmes", "30", 31.1],
  ["Alès", "30", 29.9],
  ["Perpignan", "66", 29.7],
  ["Montpellier", "34", 29.1],
  ["Carcassonne", "11", 28.4],
  ["Toulouse", "31", 28.0],
  ["Sète", "34", 27.5],
  ["Lyon", "69", 27.3],
  ["Albi", "81", 27.3],
  ["Grenoble", "38", 26.9],
  ["Chambéry", "73", 26.5],
  ["Millau", "12", 26.4],
  ["Saint-Étienne", "42", 25.5],
  ["Le Puy-en-Velay", "43", 24.9],
  ["Annecy", "74", 24.9],
  ["Clermont-Ferrand", "63", 24.8],
  ["Rodez", "12", 24.5],
  ["Mende", "48", 24.5],
  ["Aurillac", "15", 24.1],
  ["Font-Romeu-Odeillo-Via", "66", 21.7],
];
const JJA_TOLERANCE = 0.6;

const byKey = new Map<string, Entry>();

beforeAll(async () => {
  const dataset = JSON.parse(
    await readFile(
      new URL("../web/public/data/dataset.json", import.meta.url),
      "utf8",
    ),
  ) as { communes: Entry[] };
  for (const c of dataset.communes) {
    byKey.set(`${c.name}|${c.dept}`, c);
  }
});

const get = (name: string, dept: string): Entry => {
  const entry = byKey.get(`${name}|${dept}`);
  if (!entry) throw new Error(`validation town missing from dataset: ${name}`);
  return entry;
};

describe("golden gates — validation towns", () => {
  it("holds every JJA value within the pre-registered band", () => {
    for (const [name, dept, expected] of EXPECTED_JJA) {
      const actual = get(name, dept).jjaRecent;
      expect(
        Math.abs(actual - expected),
        `${name}: ${actual} vs expected ${expected} ±${JJA_TOLERANCE}`,
      ).toBeLessThanOrEqual(JJA_TOLERANCE);
    }
  });

  it("preserves the physical ordering coast/plain → plateau → mountain", () => {
    const jja = (n: string, d: string): number => get(n, d).jjaRecent;
    expect(jja("Nîmes", "30")).toBeGreaterThan(jja("Montpellier", "34"));
    expect(jja("Montpellier", "34")).toBeGreaterThan(jja("Lyon", "69"));
    expect(jja("Lyon", "69")).toBeGreaterThan(jja("Mende", "48"));
    expect(jja("Mende", "48")).toBeGreaterThan(
      jja("Font-Romeu-Odeillo-Via", "66"),
    );
  });

  it("keeps tropical nights discriminating coast from altitude", () => {
    expect(get("Perpignan", "66").tropN ?? 0).toBeGreaterThan(35);
    expect(get("Mende", "48").tropN ?? 99).toBeLessThan(5);
    expect(get("Font-Romeu-Odeillo-Via", "66").tropN).toBe(0);
  });

  it("keeps known hazard and livability anchors", () => {
    expect(get("Nîmes", "30").floods).toBeGreaterThanOrEqual(15);
    expect(get("Mende", "48").hosp).toBe(true);
    expect(get("Mende", "48").station).toBe(true);
  });
});
