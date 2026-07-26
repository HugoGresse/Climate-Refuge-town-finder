/**
 * Climate indices over daily weather series.
 *
 * Pure functions. Dates are local calendar days (aggregated in Europe/Paris at
 * ingestion — METHODOLOGY.md). Missing observations are `null`. Annual rates
 * only use years with enough valid days, so a half-ingested year cannot bias
 * a rate. All threshold comparisons are inclusive (`>=`).
 *
 * Series are expected continuous (one row per calendar day): spell metrics
 * treat adjacent indices as consecutive days and a `null` breaks a run.
 */

export interface DailySeries {
  /** ISO `yyyy-mm-dd`, strictly ascending, no duplicates, no gaps. */
  readonly dates: readonly string[];
  readonly tmax: readonly (number | null)[];
  readonly tmin: readonly (number | null)[];
  readonly precip: readonly (number | null)[];
  readonly gust?: readonly (number | null)[];
}

/** Annual-rate result with the number of qualifying years. */
export interface AnnualResult {
  readonly value: number;
  readonly years: number;
}

export interface SpellResult {
  /** Longest run anywhere in the series, incomplete years included. */
  readonly absoluteMaxDays: number;
  /** Mean of per-year longest runs, complete years only. */
  readonly meanAnnualMaxDays: number;
  readonly years: number;
}

export interface Rx1dayResult {
  readonly value: number;
  readonly date: string;
}

/** Minimum valid days for a year to count toward an annual rate. */
export const MIN_YEAR_DAYS = 350;
/** Minimum valid days (of 92) for a June–August season to count. */
export const MIN_JJA_DAYS = 85;
/** Base temperature for cooling degree-days. */
export const CDD_BASE_C = 18;
export const TROPICAL_NIGHT_C = 20;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface YearSlice {
  readonly year: number;
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

export function assertValidSeries(s: DailySeries): void {
  const n = s.dates.length;
  const columns: [string, readonly (number | null)[]][] = [
    ["tmax", s.tmax],
    ["tmin", s.tmin],
    ["precip", s.precip],
  ];
  if (s.gust) {
    columns.push(["gust", s.gust]);
  }
  for (const [name, values] of columns) {
    if (values.length !== n) {
      throw new Error(
        `series column ${name} has ${values.length} values for ${n} dates`,
      );
    }
  }
  let prev = "";
  for (const date of s.dates) {
    if (!ISO_DAY.test(date)) {
      throw new Error(`invalid date ${date}`);
    }
    if (date <= prev) {
      throw new Error(`dates not strictly ascending at ${date}`);
    }
    prev = date;
  }
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

function yearSlices(dates: readonly string[]): YearSlice[] {
  const slices: YearSlice[] = [];
  let start = 0;
  for (let i = 1; i <= dates.length; i++) {
    if (i === dates.length || yearOf(dates[i]!) !== yearOf(dates[start]!)) {
      slices.push({ year: yearOf(dates[start]!), start, end: i });
      start = i;
    }
  }
  return slices;
}

type IsValid = (index: number) => boolean;

function validCount(slice: YearSlice, isValid: IsValid): number {
  let count = 0;
  for (let i = slice.start; i < slice.end; i++) {
    if (isValid(i)) count++;
  }
  return count;
}

function meanOverCompleteYears(
  dates: readonly string[],
  isValid: IsValid,
  minDays: number,
  perYear: (slice: YearSlice) => number,
): AnnualResult | null {
  const qualifying = yearSlices(dates).filter(
    (slice) => validCount(slice, isValid) >= minDays,
  );
  if (qualifying.length === 0) return null;
  const total = qualifying.reduce((sum, slice) => sum + perYear(slice), 0);
  return { value: total / qualifying.length, years: qualifying.length };
}

function notNull(values: readonly (number | null)[]): IsValid {
  return (i) => values[i] != null;
}

/** Mean days per year with value >= threshold, over sufficiently-covered years. */
export function daysAtOrAbovePerYear(
  dates: readonly string[],
  values: readonly (number | null)[],
  threshold: number,
  minDays = MIN_YEAR_DAYS,
): AnnualResult | null {
  return meanOverCompleteYears(dates, notNull(values), minDays, (slice) => {
    let count = 0;
    for (let i = slice.start; i < slice.end; i++) {
      const v = values[i];
      if (v != null && v >= threshold) count++;
    }
    return count;
  });
}

export function tropicalNightsPerYear(s: DailySeries): AnnualResult | null {
  return daysAtOrAbovePerYear(s.dates, s.tmin, TROPICAL_NIGHT_C);
}

/** Cooling degree-days base 18 °C from the daily mean, per year. */
export function cdd18PerYear(s: DailySeries): AnnualResult | null {
  const bothValid: IsValid = (i) => s.tmax[i] != null && s.tmin[i] != null;
  return meanOverCompleteYears(s.dates, bothValid, MIN_YEAR_DAYS, (slice) => {
    let sum = 0;
    for (let i = slice.start; i < slice.end; i++) {
      const tmax = s.tmax[i];
      const tmin = s.tmin[i];
      if (tmax == null || tmin == null) continue;
      sum += Math.max(0, (tmax + tmin) / 2 - CDD_BASE_C);
    }
    return sum;
  });
}

/** Mean daily Tmax over June–August, averaged over qualifying summers. */
export function jjaMeanTmax(s: DailySeries): AnnualResult | null {
  const summers = yearSlices(s.dates)
    .map((slice) => {
      let sum = 0;
      let count = 0;
      for (let i = slice.start; i < slice.end; i++) {
        const month = monthOf(s.dates[i]!);
        if (month < 6 || month > 8) continue;
        const v = s.tmax[i];
        if (v == null) continue;
        sum += v;
        count++;
      }
      return { sum, count };
    })
    .filter((summer) => summer.count >= MIN_JJA_DAYS);
  if (summers.length === 0) return null;
  const meanOfMeans =
    summers.reduce((acc, y) => acc + y.sum / y.count, 0) / summers.length;
  return { value: meanOfMeans, years: summers.length };
}

/** Longest consecutive run of days with value >= threshold. */
export function longestSpellAtOrAbove(
  dates: readonly string[],
  values: readonly (number | null)[],
  threshold: number,
): SpellResult | null {
  const runMax = (start: number, end: number): number => {
    let best = 0;
    let current = 0;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (v != null && v >= threshold) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
    }
    return best;
  };
  const annual = meanOverCompleteYears(
    dates,
    notNull(values),
    MIN_YEAR_DAYS,
    (slice) => runMax(slice.start, slice.end),
  );
  if (annual === null) return null;
  return {
    absoluteMaxDays: runMax(0, values.length),
    meanAnnualMaxDays: annual.value,
    years: annual.years,
  };
}

/** Highest single-day precipitation over the whole series. */
export function rx1day(s: DailySeries): Rx1dayResult | null {
  let best: Rx1dayResult | null = null;
  for (let i = 0; i < s.precip.length; i++) {
    const v = s.precip[i];
    if (v == null) continue;
    if (best === null || v > best.value) {
      best = { value: v, date: s.dates[i]! };
    }
  }
  return best;
}

export function heavyRainDaysPerYear(
  s: DailySeries,
  thresholdMm = 40,
): AnnualResult | null {
  return daysAtOrAbovePerYear(s.dates, s.precip, thresholdMm);
}

export function gustDaysPerYear(
  s: DailySeries,
  thresholdKmh = 100,
): AnnualResult | null {
  if (!s.gust) return null;
  return daysAtOrAbovePerYear(s.dates, s.gust, thresholdKmh);
}
