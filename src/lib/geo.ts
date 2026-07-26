export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
const KM_PER_DEG_LAT = 111.32;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Bbox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
}

/** Bounding box fully containing the circle — cheap prefilter before haversine. */
export function bboxAroundKm(center: LatLon, radiusKm: number): Bbox {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cosLat = Math.max(Math.cos(center.lat * DEG), 1e-9);
  const dLon = radiusKm / (KM_PER_DEG_LAT * cosLat);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLon: center.lon - dLon,
    maxLon: center.lon + dLon,
  };
}

export function inBbox(p: LatLon, box: Bbox): boolean {
  return (
    p.lat >= box.minLat &&
    p.lat <= box.maxLat &&
    p.lon >= box.minLon &&
    p.lon <= box.maxLon
  );
}
