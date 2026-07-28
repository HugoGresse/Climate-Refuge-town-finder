import { Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { popupHtml } from "./popup";
import { ORIGIN_INSEE, type CommuneEntry, type Dataset } from "./types";

/** IGN Géoplateforme Plan IGN v2 — free, keyless ("essentiels") raster layer. */
const IGN_TILE_URL =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
  "&FORMAT=image%2Fpng&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const FRANCE_CENTER: [number, number] = [2.6, 46.6];

/**
 * Sequential single-hue ramp, light→dark, monotonic lightness (heat = burden).
 * Contrast relief comes from popups and the white circle strokes.
 */
export const HEAT_STOPS: [number, string][] = [
  [21, "#ffe1cc"],
  [24, "#ffb27f"],
  [26.5, "#ff8b3d"],
  [29, "#e85d04"],
  [32, "#a33a00"],
];

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

export async function addCommuneLayer(map: MapLibreMap): Promise<Dataset> {
  const response = await fetch("/data/dataset.json");
  if (!response.ok) throw new Error(`dataset load failed: HTTP ${response.status}`);
  const dataset = (await response.json()) as Dataset;
  const origin =
    dataset.communes.find((c) => c.insee === ORIGIN_INSEE) ?? null;

  const geojson = {
    type: "FeatureCollection" as const,
    features: dataset.communes.map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
      properties: { insee: c.insee, jjaRecent: c.jjaRecent },
    })),
  };

  map.addSource("communes", { type: "geojson", data: geojson });
  map.addLayer({
    id: "communes-heat",
    type: "circle",
    source: "communes",
    paint: {
      "circle-color": [
        "interpolate",
        ["linear"],
        ["get", "jjaRecent"],
        ...HEAT_STOPS.flat(),
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5, 9, 11],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  const byInsee = new Map(dataset.communes.map((c) => [c.insee, c] as const));
  map.on("click", "communes-heat", (event) => {
    const feature = event.features?.[0];
    const insee = feature?.properties?.["insee"] as string | undefined;
    const commune = insee ? byInsee.get(insee) : undefined;
    if (!commune) return;
    new Popup({ maxWidth: "340px" })
      .setLngLat([commune.lon, commune.lat])
      .setHTML(popupHtml(commune, origin))
      .addTo(map);
  });
  map.on("mouseenter", "communes-heat", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "communes-heat", () => {
    map.getCanvas().style.cursor = "";
  });

  if (origin) {
    new Marker({ color: "#ff6f0f" })
      .setLngLat([origin.lon, origin.lat])
      .setPopup(new Popup().setText(`Origine : ${origin.name}`))
      .addTo(map);
  }
  return dataset;
}

export function legendHtml(): string {
  const gradient = HEAT_STOPS.map(([, color]) => color).join(", ");
  return `
    <div class="legend-title">Tmax moyen été 2016–2025</div>
    <div class="legend-bar" style="background: linear-gradient(to right, ${gradient})"></div>
    <div class="legend-labels"><span>21 °C</span><span>32 °C</span></div>`;
}

export function communeGeojsonCount(dataset: Dataset): number {
  return dataset.communes.length;
}
