import { describe, expect, it } from "vitest";
import {
  bilinear,
  isElevationConfident,
  tmaxAtCommune,
  tminAtCommune,
} from "./downscale.js";

describe("bilinear", () => {
  it("returns each corner at the corner fractions", () => {
    expect(bilinear(1, 2, 3, 4, 0, 0)).toBe(1); // SW
    expect(bilinear(1, 2, 3, 4, 1, 0)).toBe(2); // SE
    expect(bilinear(1, 2, 3, 4, 0, 1)).toBe(3); // NW
    expect(bilinear(1, 2, 3, 4, 1, 1)).toBe(4); // NE
  });

  it("returns the mean at the cell centre", () => {
    expect(bilinear(1, 2, 3, 4, 0.5, 0.5)).toBeCloseTo(2.5, 10);
  });

  it("interpolates linearly along one axis", () => {
    expect(bilinear(1, 2, 3, 4, 0.25, 0)).toBeCloseTo(1.25, 10);
  });

  it("rejects fractions outside [0,1] and NaN", () => {
    expect(() => bilinear(1, 2, 3, 4, 1.1, 0)).toThrow();
    expect(() => bilinear(1, 2, 3, 4, 0, -0.1)).toThrow();
    expect(() => bilinear(1, 2, 3, 4, Number.NaN, 0)).toThrow();
  });
});

describe("lapse corrections", () => {
  it("cools Tmax by 0.65 °C per 100 m of extra commune elevation", () => {
    // Commune at 700 m on a 200 m grid cell: −3.25 °C.
    expect(tmaxAtCommune(30, 700, 200)).toBeCloseTo(26.75, 10);
  });

  it("corrects Tmin less than Tmax for the same elevation delta (cold-air pooling)", () => {
    const dTmax = 30 - tmaxAtCommune(30, 700, 200);
    const dTmin = 15 - tminAtCommune(15, 700, 200);
    expect(dTmin).toBeCloseTo(1.5, 10);
    expect(dTmin).toBeLessThan(dTmax);
  });

  it("warms a commune sitting below its grid cell", () => {
    expect(tmaxAtCommune(30, 100, 300)).toBeCloseTo(31.3, 10);
  });
});

describe("isElevationConfident", () => {
  it("accepts deltas up to 200 m inclusive and rejects beyond", () => {
    expect(isElevationConfident(400, 200)).toBe(true);
    expect(isElevationConfident(401, 200)).toBe(false);
    expect(isElevationConfident(0, 250)).toBe(false);
  });
});
