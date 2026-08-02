import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type LngLatLike,
} from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { popupHtml } from "./popup";
import type { CommuneEntry, Dataset } from "./types";

/** IGN Géoplateforme Plan IGN v2 — free, keyless ("essentiels") raster layer. */
const IGN_TILE_URL =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
  "&FORMAT=image%2Fpng&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const FRANCE_CENTER: [number, number] = [2.6, 46.6];

/** Sequential single-hue ramp, light→dark, monotonic lightness. */
export const HEAT_STOPS: [number, string][] = [
  [21, "#ffe1cc"],
  [24, "#ffb27f"],
  [26.5, "#ff8b3d"],
  [29, "#e85d04"],
  [32, "#a33a00"],
];

/** Zoom bands: national zoom must not be a 35k-point blob (issue #16). */
const BANDS: { id: string; minzoom: number; maxzoom: number; minPop: number }[] = [
  { id: "communes-z0", minzoom: 0, maxzoom: 7, minPop: 5000 },
  { id: "communes-z1", minzoom: 7, maxzoom: 8.5, minPop: 1000 },
  { id: "communes-z2", minzoom: 8.5, maxzoom: 24, minPop: 0 },
];
export const COMMUNE_LAYERS = BANDS.map((b) => b.id);

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        ign: {
          type: "raster",
          tiles: [IGN_TILE_URL],
          tileSize: 256,
          attribution: "© IGN — Géoplateforme · Climat: ERA5-Land (Copernicus)",
        },
      },
      layers: [
        {
          id: "ign",
          type: "raster",
          source: "ign",
        },
      ],
    },
    center: FRANCE_CENTER,
    zoom: 5.3,
    minZoom: 4.5,
    maxZoom: 15,
    attributionControl: { compact: false },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  return map;
}

export function addCommuneLayers(
  map: MapLibreMap,
  dataset: Dataset,
  getOrigin: () => CommuneEntry | null,
): void {
  map.addSource("communes", {
    type: "geojson",
    data: communesGeojson(dataset, null, Number.POSITIVE_INFINITY),
  });
  for (const band of BANDS) {
    map.addLayer({
      id: band.id,
      type: "circle",
      source: "communes",
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
      filter: [">=", ["coalesce", ["get", "pop"], 0], band.minPop],
      paint: {
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "jjaRecent"],
          ...HEAT_STOPS.flat(),
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4.5, 9, 10],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": ["case", ["==", ["get", "inRadius"], 1], 0.95, 0.25],
        "circle-stroke-opacity": ["case", ["==", ["get", "inRadius"], 1], 1, 0.2],
      },
    });
    map.on("click", band.id, (event) => {
      const insee = event.features?.[0]?.properties?.["insee"] as string | undefined;
      const commune = dataset.communes.find((c) => c.insee === insee);
      if (commune) showCommunePopup(map, commune, getOrigin());
    });
    map.on("mouseenter", band.id, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", band.id, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

export function showCommunePopup(
  map: MapLibreMap,
  commune: CommuneEntry,
  origin: CommuneEntry | null,
): void {
  new Popup({ maxWidth: "340px" })
    .setLngLat([commune.lon, commune.lat] as LngLatLike)
    .setHTML(popupHtml(commune, origin))
    .addTo(map);
}

/** Recomputes the in-radius flag for every commune (cheap: one haversine each). */
export function updateRadiusHighlight(
  map: MapLibreMap,
  dataset: Dataset,
  origin: CommuneEntry,
  radiusKm: number,
): void {
  const source = map.getSource("communes") as GeoJSONSource | undefined;
  source?.setData(communesGeojson(dataset, origin, radiusKm));
  updateRadiusCircle(map, origin, radiusKm);
}

function communesGeojson(
  dataset: Dataset,
  origin: CommuneEntry | null,
  radiusKm: number,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: dataset.communes.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      properties: {
        insee: c.insee,
        jjaRecent: c.jjaRecent,
        pop: c.pop,
        inRadius:
          origin === null ||
          haversine(origin.lat, origin.lon, c.lat, c.lon) <= radiusKm
            ? 1
            : 0,
      },
    })),
  };
}

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const h =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) *
      Math.cos(lat2 * DEG) *
      Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Destination point at distance/bearing — used to draw the radius circle. */
function destination(lat: number, lon: number, km: number, bearingDeg: number): [number, number] {
  const δ = km / EARTH_KM;
  const θ = bearingDeg * DEG;
  const φ1 = lat * DEG;
  const λ1 = lon * DEG;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [λ2 / DEG, φ2 / DEG];
}

function updateRadiusCircle(map: MapLibreMap, origin: CommuneEntry, radiusKm: number): void {
  const ring: [number, number][] = [];
  for (let step = 0; step <= 72; step++) {
    ring.push(destination(origin.lat, origin.lon, radiusKm, step * 5));
  }
  const data: Feature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: ring },
    properties: {},
  };
  const existing = map.getSource("radius-circle") as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource("radius-circle", { type: "geojson", data });
  map.addLayer({
    id: "radius-circle",
    type: "line",
    source: "radius-circle",
    paint: {
      "line-color": "#ff6f0f",
      "line-width": 1.5,
      "line-dasharray": [2, 2],
      "line-opacity": 0.8,
    },
  });
}

export function createOriginMarker(map: MapLibreMap, origin: CommuneEntry): Marker {
  return new Marker({ color: "#ff6f0f" })
    .setLngLat([origin.lon, origin.lat])
    .addTo(map);
}

export function legendHtml(): string {
  const gradient = HEAT_STOPS.map(([, color]) => color).join(", ");
  return `
    <div class="legend-title">Tmax moyen été 2016–2025</div>
    <div class="legend-bar" style="background: linear-gradient(to right, ${gradient})"></div>
    <div class="legend-labels"><span>21 °C</span><span>32 °C</span></div>`;
}
