import { describe, expect, it } from "vitest";
import { compositeScore, isGated, type HazardFlags } from "./score.js";

const noFlags: HazardFlags = {
  floodSevere: false,
  wildfireSevere: false,
  coastalRetreat: false,
  claySevere: false,
};

describe("compositeScore", () => {
  it("inverts the weighted mean burden into a 0–100 score", () => {
    const result = compositeScore([
      { burden: 20, weight: 1 },
      { burden: 60, weight: 1 },
    ]);
    expect(result).toEqual({ score: 60, coverage: 1 });
  });

  it("respects weights", () => {
    const result = compositeScore([
      { burden: 0, weight: 3 },
      { burden: 100, weight: 1 },
    ]);
    expect(result.score).toBeCloseTo(75, 10);
  });

  it("returns null when unknown sub-indices drop coverage below the minimum", () => {
    const result = compositeScore([
      { burden: 40, weight: 1 },
      { burden: null, weight: 1 },
    ]);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0.5);
  });

  it("still scores when coverage stays above the minimum", () => {
    const result = compositeScore([
      { burden: 30, weight: 1 },
      { burden: 60, weight: 1 },
      { burden: null, weight: 1 },
    ]);
    expect(result.coverage).toBeCloseTo(2 / 3, 10);
    expect(result.score).toBeCloseTo(100 - 45, 10);
  });

  it("handles empty input and rejects negative weights", () => {
    expect(compositeScore([])).toEqual({ score: null, coverage: 0 });
    expect(() => compositeScore([{ burden: 10, weight: -1 }])).toThrow();
  });
});

describe("isGated", () => {
  it("is false with no severe flags", () => {
    expect(isGated(noFlags)).toBe(false);
  });

  it("is true when any severe flag is raised", () => {
    for (const key of Object.keys(noFlags) as (keyof HazardFlags)[]) {
      expect(isGated({ ...noFlags, [key]: true })).toBe(true);
    }
  });
});
