import { describe, expect, it } from "vitest";
import { percentileRanks, quantileSorted, winsorise } from "./normalise.js";

describe("percentileRanks", () => {
  it("spreads distinct values from 0 to 100", () => {
    expect(percentileRanks([10, 20, 30, 40, 50])).toEqual([0, 25, 50, 75, 100]);
  });

  it("gives tied values their midrank", () => {
    expect(percentileRanks([1, 2, 2, 3])).toEqual([0, 50, 50, 100]);
  });

  it("preserves nulls and ranks only present values", () => {
    expect(percentileRanks([10, null, 20])).toEqual([0, null, 100]);
  });

  it("returns 50 for a single value", () => {
    expect(percentileRanks([5])).toEqual([50]);
  });

  it("is order-independent", () => {
    expect(percentileRanks([50, 10, 30])).toEqual([100, 0, 50]);
  });
});

describe("quantileSorted", () => {
  it("interpolates linearly", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
  });

  it("rejects empty input and out-of-range p", () => {
    expect(() => quantileSorted([], 0.5)).toThrow();
    expect(() => quantileSorted([1], 1.5)).toThrow();
    expect(() => quantileSorted([1], Number.NaN)).toThrow();
  });
});

describe("winsorise", () => {
  it("clamps the tails to the requested quantiles", () => {
    const values = Array.from({ length: 101 }, (_, i) => i); // 0..100
    const clamped = winsorise(values, 0.05, 0.95);
    expect(Math.min(...clamped)).toBeCloseTo(5, 10);
    expect(Math.max(...clamped)).toBeCloseTo(95, 10);
    expect(clamped[50]).toBe(50);
  });

  it("neutralises a single extreme outlier", () => {
    const values = [...Array.from({ length: 99 }, (_, i) => i + 1), 100_000];
    const clamped = winsorise(values);
    // p99 interpolates between 99 and the outlier → ~1098, down from 100 000.
    expect(Math.max(...clamped)).toBeLessThan(1100);
    expect(Math.max(...clamped)).toBeGreaterThanOrEqual(99);
  });
});
