/**
 * Composite scoring over sub-index burden percentiles (0–100, higher = worse).
 *
 * Rules (README "scoring honesty"): missing data stays unknown — a score is
 * only produced when enough weight is backed by data — and severe hazard
 * flags are gates, never averaged away by pleasant temperatures.
 */

export interface SubIndex {
  /** Burden percentile 0–100 (higher = worse), or null when unknown. */
  readonly burden: number | null;
  readonly weight: number;
}

export interface CompositeResult {
  /** 0–100, higher = better. Null when coverage is insufficient. */
  readonly score: number | null;
  /** Fraction [0,1] of total weight backed by data. */
  readonly coverage: number;
}

export const MIN_SCORE_COVERAGE = 0.6;

export function compositeScore(subs: readonly SubIndex[]): CompositeResult {
  let totalWeight = 0;
  let usedWeight = 0;
  let weightedBurden = 0;
  for (const sub of subs) {
    if (sub.weight < 0) {
      throw new Error(`negative weight ${sub.weight}`);
    }
    totalWeight += sub.weight;
    if (sub.burden != null) {
      usedWeight += sub.weight;
      weightedBurden += sub.burden * sub.weight;
    }
  }
  if (totalWeight === 0) {
    return { score: null, coverage: 0 };
  }
  const coverage = usedWeight / totalWeight;
  if (usedWeight === 0 || coverage < MIN_SCORE_COVERAGE) {
    return { score: null, coverage };
  }
  return { score: 100 - weightedBurden / usedWeight, coverage };
}

export interface HazardFlags {
  readonly floodSevere: boolean;
  readonly wildfireSevere: boolean;
  readonly coastalRetreat: boolean;
  readonly claySevere: boolean;
}

/** Severe hazards gate a commune out of recommendations — never averaged away. */
export function isGated(flags: HazardFlags): boolean {
  return (
    flags.floodSevere ||
    flags.wildfireSevere ||
    flags.coastalRetreat ||
    flags.claySevere
  );
}
