import { describe, expect, it } from "vitest";
import {
  assertValidSeries,
  cdd18PerYear,
  daysAtOrAbovePerYear,
  gustDaysPerYear,
  heavyRainDaysPerYear,
  jjaMeanTmax,
  longestSpellAtOrAbove,
  rx1day,
  tropicalNightsPerYear,
  type DailySeries,
} from "./metrics.js";

interface MutableSeries {
  dates: string[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  precip: (number | null)[];
  gust?: (number | null)[];
}

function daysOfYear(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function makeSeries(years: number[]): MutableSeries {
  const dates = years.flatMap(daysOfYear);
  return {
    dates,
    tmax: dates.map(() => 25),
    tmin: dates.map(() => 12),
    precip: dates.map(() => 0),
  };
}

/** Appends a truncated 2023 (10 days, five consecutive 40 °C) to test exclusion. */
function appendPartial2023(s: MutableSeries): void {
  for (const [i, date] of daysOfYear(2023).slice(0, 10).entries()) {
    s.dates.push(date);
    s.tmax.push(i < 5 ? 40 : 25);
    s.tmin.push(12);
    s.precip.push(0);
  }
}

// 2021: 10 days at 31 °C, 4 days at 36 °C (3 consecutive + 1 isolated).
// 2022: 6 days at 31 °C, 2 consecutive days at 36 °C. (365-day years.)
function hotFixture(): MutableSeries {
  const s = makeSeries([2021, 2022]);
  for (let i = 10; i < 20; i++) s.tmax[i] = 31;
  s.tmax[100] = 36;
  s.tmax[101] = 36;
  s.tmax[102] = 36;
  s.tmax[105] = 36;
  for (let i = 385; i < 391; i++) s.tmax[i] = 31;
  s.tmax[415] = 36;
  s.tmax[416] = 36;
  appendPartial2023(s);
  return s;
}

describe("assertValidSeries", () => {
  it("accepts a well-formed series", () => {
    expect(() => assertValidSeries(makeSeries([2021]) as DailySeries)).not.toThrow();
  });

  it("rejects duplicate and unsorted dates", () => {
    const dup = makeSeries([2021]);
    dup.dates[10] = dup.dates[9]!;
    expect(() => assertValidSeries(dup as DailySeries)).toThrow(/ascending/);

    const unsorted = makeSeries([2021]);
    const [a, b] = [unsorted.dates[5]!, unsorted.dates[6]!];
    unsorted.dates[5] = b;
    unsorted.dates[6] = a;
    expect(() => assertValidSeries(unsorted as DailySeries)).toThrow(/ascending/);
  });

  it("rejects column length mismatches and malformed dates", () => {
    const short = makeSeries([2021]);
    short.tmax.pop();
    expect(() => assertValidSeries(short as DailySeries)).toThrow(/tmax/);

    const bad = makeSeries([2021]);
    bad.dates[0] = "2021/01/01";
    expect(() => assertValidSeries(bad as DailySeries)).toThrow(/invalid date/);
  });
});

describe("daysAtOrAbovePerYear", () => {
  it("averages complete years and treats the threshold as inclusive", () => {
    const s = hotFixture();
    // ≥30: 2021 = 14, 2022 = 8 → 11. ≥35: (4 + 2) / 2 = 3.
    expect(daysAtOrAbovePerYear(s.dates, s.tmax, 30)).toEqual({ value: 11, years: 2 });
    expect(daysAtOrAbovePerYear(s.dates, s.tmax, 35)).toEqual({ value: 3, years: 2 });
    expect(daysAtOrAbovePerYear(s.dates, s.tmax, 31)?.value).toBe(11); // 31 counts
    expect(daysAtOrAbovePerYear(s.dates, s.tmax, 31.5)?.value).toBe(3); // 31 excluded
  });

  it("excludes the truncated year even when it contains extreme values", () => {
    const s = hotFixture();
    // The five 40 °C days of the 10-day 2023 stub must not raise the rate.
    const result = daysAtOrAbovePerYear(s.dates, s.tmax, 35);
    expect(result?.years).toBe(2);
    expect(result?.value).toBe(3);
  });

  it("drops a year whose coverage falls below the minimum", () => {
    const s = makeSeries([2021, 2022]);
    for (let i = 400; i < 410; i++) s.tmax[i] = 31; // 2022 only
    for (let i = 0; i < 100; i++) s.tmax[i] = null; // 2021 → 265 valid < 350
    const result = daysAtOrAbovePerYear(s.dates, s.tmax, 30);
    expect(result).toEqual({ value: 10, years: 1 });
  });

  it("returns null when no year qualifies", () => {
    expect(daysAtOrAbovePerYear([], [], 30)).toBeNull();
  });
});

describe("tropicalNightsPerYear", () => {
  it("counts nights with Tmin >= 20 inclusively", () => {
    const s = makeSeries([2021, 2022]);
    for (let i = 150; i < 170; i++) s.tmin[i] = 21; // 2021: 20 nights
    for (let i = 515; i < 525; i++) s.tmin[i] = 20; // 2022: 10 nights at exactly 20
    expect(tropicalNightsPerYear(s as DailySeries)).toEqual({ value: 15, years: 2 });
  });
});

describe("cdd18PerYear", () => {
  it("integrates (daily mean − 18) clamped at zero", () => {
    const s = makeSeries([2021, 2022]);
    for (let i = 0; i < 365; i++) {
      s.tmax[i] = 28; // mean 23 → 5 CDD/day → 1825 over 2021
      s.tmin[i] = 18;
    }
    for (let i = 365; i < 730; i++) {
      s.tmax[i] = 20; // mean 15 → 0 CDD
      s.tmin[i] = 10;
    }
    expect(cdd18PerYear(s as DailySeries)).toEqual({ value: 912.5, years: 2 });
  });
});

describe("jjaMeanTmax", () => {
  it("averages JJA days and drops summers with insufficient coverage", () => {
    const s = makeSeries([2021, 2022]);
    s.dates.forEach((date, i) => {
      const month = Number(date.slice(5, 7));
      if (month >= 6 && month <= 8) s.tmax[i] = 30;
    });
    // Null out 10 JJA days of 2022 → 82 valid < 85 → summer excluded.
    let removed = 0;
    for (let i = 365; i < 730 && removed < 10; i++) {
      const month = Number(s.dates[i]!.slice(5, 7));
      if (month >= 6 && month <= 8) {
        s.tmax[i] = null;
        removed++;
      }
    }
    expect(jjaMeanTmax(s as DailySeries)).toEqual({ value: 30, years: 1 });
  });
});

describe("longestSpellAtOrAbove", () => {
  it("reports mean annual max over complete years and absolute max overall", () => {
    const s = hotFixture();
    const spell = longestSpellAtOrAbove(s.dates, s.tmax, 35);
    // 2021 longest run 3, 2022 run 2 → mean 2.5; the truncated 2023 stub
    // holds 5 consecutive 40 °C days → absolute max 5.
    expect(spell).toEqual({ absoluteMaxDays: 5, meanAnnualMaxDays: 2.5, years: 2 });
  });

  it("breaks runs on null days", () => {
    const s = makeSeries([2021]);
    s.tmax[50] = 36;
    s.tmax[51] = 36;
    s.tmax[52] = null;
    s.tmax[53] = 36;
    const spell = longestSpellAtOrAbove(s.dates, s.tmax, 35);
    expect(spell?.absoluteMaxDays).toBe(2);
  });
});

describe("precipitation and gusts", () => {
  it("finds rx1day with its date and counts heavy-rain days per year", () => {
    const s = makeSeries([2021, 2022]);
    s.precip[50] = 40; // exactly at threshold — counts
    s.precip[60] = 55;
    s.precip[200] = 120.5; // 2021-07-20
    s.precip[435] = 41; // 2022
    expect(rx1day(s as DailySeries)).toEqual({ value: 120.5, date: "2021-07-20" });
    expect(heavyRainDaysPerYear(s as DailySeries)).toEqual({ value: 2, years: 2 });
  });

  it("returns null for gusts when the column is absent, counts when present", () => {
    const s = makeSeries([2021, 2022]);
    expect(gustDaysPerYear(s as DailySeries)).toBeNull();
    s.gust = s.dates.map(() => 50);
    s.gust[10] = 110;
    s.gust[11] = 120;
    s.gust[400] = 100; // exactly at threshold
    s.gust[401] = 130;
    expect(gustDaysPerYear(s as DailySeries)).toEqual({ value: 2, years: 2 });
  });
});
