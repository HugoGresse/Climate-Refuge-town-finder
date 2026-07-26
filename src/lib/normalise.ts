/**
 * Normalisation for ranking (README "scoring honesty" rules):
 * national percentile ranks — never min-max, one Pyrenean summit must not
 * stretch the whole scale — and always computed over all of France, never
 * over a search circle, so a commune's rank is origin-independent.
 */

/** Linear-interpolated quantile of an ascending-sorted array, p in [0,1]. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error("quantile of empty array");
  }
  if (!(p >= 0 && p <= 1)) {
    throw new Error(`p must be in [0,1], got ${p}`);
  }
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

/** Clamp extremes to the given quantiles. Display scaling only — ranks are unaffected. */
export function winsorise(
  values: readonly number[],
  pLow = 0.01,
  pHigh = 0.99,
): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = quantileSorted(sorted, pLow);
  const hi = quantileSorted(sorted, pHigh);
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

/** Percentile ranks 0–100 (midrank for ties), null-preserving. */
export function percentileRanks(
  values: readonly (number | null)[],
): (number | null)[] {
  const present = values
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const n = present.length;
  return values.map((v) => {
    if (v == null) return null;
    if (n <= 1) return 50;
    const below = lowerBound(present, v);
    const ties = upperBound(present, v) - below;
    return ((below + (ties - 1) / 2) / (n - 1)) * 100;
  });
}

function lowerBound(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
