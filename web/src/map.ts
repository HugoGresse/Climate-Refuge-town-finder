import { Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/** IGN Géoplateforme Plan IGN v2 — free, keyless ("essentiels") raster layer. */
const IGN_TILE_URL =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
  "&FORMAT=image%2Fpng&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const FRANCE_CENTER: [number, number] = [2.6, 46.6];

/** Default origin until the picker exists (issue #9). */
export const DEFAULT_ORIGIN = {
  name: "Montpellier",
  lngLat: [3.8767, 43.6112] as [number, number],
};

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
          attribution: "© IGN — Géoplateforme",
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

  new Marker({ color: "#ff6f0f" })
    .setLngLat(DEFAULT_ORIGIN.lngLat)
    .setPopup(new Popup().setText(`Origine : ${DEFAULT_ORIGIN.name}`))
    .addTo(map);

  return map;
}
