/**
 * Elevation-aware downscaling of gridded reanalysis values to a commune point.
 *
 * Lapse rates are deliberately asymmetric (METHODOLOGY.md): daytime Tmax
 * follows a near-standard atmospheric lapse, but nighttime Tmin does not —
 * cold-air pooling makes valley floors colder than a uniform lapse predicts,
 * so Tmin is under-corrected on purpose.
 */
export const LAPSE_TMAX_C_PER_M = -0.0065;
export const LAPSE_TMIN_C_PER_M = -0.003;

/**
 * Bilinear interpolation inside one grid cell.
 * Corners are named by compass position; `fx` is the eastward fraction [0,1],
 * `fy` the northward fraction [0,1].
 */
export function bilinear(
  sw: number,
  se: number,
  nw: number,
  ne: number,
  fx: number,
  fy: number,
): number {
  assertFraction(fx, "fx");
  assertFraction(fy, "fy");
  const south = sw + (se - sw) * fx;
  const north = nw + (ne - nw) * fx;
  return south + (north - south) * fy;
}

export function lapseAdjust(
  tempC: number,
  elevDeltaM: number,
  lapseCPerM: number,
): number {
  return tempC + elevDeltaM * lapseCPerM;
}

/** Grid Tmax corrected to the commune's elevation (mairie-point DEM). */
export function tmaxAtCommune(
  gridTmaxC: number,
  communeElevM: number,
  gridElevM: number,
): number {
  return lapseAdjust(gridTmaxC, communeElevM - gridElevM, LAPSE_TMAX_C_PER_M);
}

/** Grid Tmin corrected to the commune's elevation — weaker slope, see above. */
export function tminAtCommune(
  gridTminC: number,
  communeElevM: number,
  gridElevM: number,
): number {
  return lapseAdjust(gridTminC, communeElevM - gridElevM, LAPSE_TMIN_C_PER_M);
}

/** Communes further than this from the grid elevation get a low-confidence flag. */
export const ELEV_CONFIDENCE_LIMIT_M = 200;

export function isElevationConfident(
  communeElevM: number,
  gridElevM: number,
): boolean {
  return Math.abs(communeElevM - gridElevM) <= ELEV_CONFIDENCE_LIMIT_M;
}

function assertFraction(value: number, name: string): void {
  if (!(value >= 0 && value <= 1)) {
    throw new Error(`${name} must be in [0,1], got ${value}`);
  }
}
