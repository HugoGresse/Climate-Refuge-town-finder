import { describe, expect, it } from "vitest";
import { bboxAroundKm, haversineKm, inBbox } from "./geo.js";

const PARIS = { lat: 48.8566, lon: 2.3522 };
const LYON = { lat: 45.764, lon: 4.8357 };
const MONTPELLIER = { lat: 43.6112, lon: 3.8767 };

describe("haversineKm", () => {
  it("matches the known Paris–Lyon great-circle distance (~392 km)", () => {
    const d = haversineKm(PARIS, LYON);
    expect(d).toBeGreaterThan(388);
    expect(d).toBeLessThan(396);
  });

  it("is zero for identical points", () => {
    expect(haversineKm(MONTPELLIER, MONTPELLIER)).toBeCloseTo(0, 10);
  });

  it("measures one degree of longitude at the equator (~111.2 km)", () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d).toBeCloseTo(111.19, 0);
  });

  it("is symmetric", () => {
    expect(haversineKm(PARIS, MONTPELLIER)).toBeCloseTo(
      haversineKm(MONTPELLIER, PARIS),
      10,
    );
  });
});

describe("bboxAroundKm", () => {
  it("contains every point of the circle", () => {
    const radius = 150;
    const box = bboxAroundKm(MONTPELLIER, radius);
    const northEdge = { lat: MONTPELLIER.lat + radius / 111.32, lon: MONTPELLIER.lon };
    expect(inBbox(northEdge, box)).toBe(true);
    expect(haversineKm(MONTPELLIER, northEdge)).toBeLessThanOrEqual(radius + 1);
  });

  it("excludes points clearly outside the circle's bbox", () => {
    const box = bboxAroundKm(MONTPELLIER, 150);
    const farNorth = { lat: MONTPELLIER.lat + 200 / 111.32 + 0.1, lon: MONTPELLIER.lon };
    expect(inBbox(farNorth, box)).toBe(false);
  });

  it("widens longitude span at high latitude", () => {
    const nearPole = bboxAroundKm({ lat: 70, lon: 0 }, 100);
    const equator = bboxAroundKm({ lat: 0, lon: 0 }, 100);
    const spanPole = nearPole.maxLon - nearPole.minLon;
    const spanEq = equator.maxLon - equator.minLon;
    expect(spanPole).toBeGreaterThan(spanEq);
  });
});
