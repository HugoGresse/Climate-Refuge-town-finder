import "./style.css";
import {
  addCommuneLayers,
  createMap,
  createOriginMarker,
  legendHtml,
  showCommunePopup,
  updateRadiusHighlight,
} from "./map";
import { renderPanel } from "./panel";
import { readStateFromUrl, writeStateToUrl, type AppState } from "./state";
import type { CommuneEntry, Dataset } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element missing");
}

app.innerHTML = `
  <header class="topbar">
    <h1>Climat &amp; risques — communes françaises</h1>
    <span class="status" id="status">chargement…</span>
  </header>
  <div class="content">
    <aside class="panel" id="panel"></aside>
    <div class="map-container" id="map"></div>
  </div>
  <aside class="legend" id="legend"></aside>
`;

const mapContainer = document.querySelector<HTMLDivElement>("#map")!;
const panelRoot = document.querySelector<HTMLElement>("#panel")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const legend = document.querySelector<HTMLElement>("#legend")!;

async function loadDataset(): Promise<Dataset> {
  const response = await fetch("/data/dataset.json");
  if (!response.ok) throw new Error(`dataset load failed: HTTP ${response.status}`);
  return (await response.json()) as Dataset;
}

async function start(): Promise<void> {
  const dataset = await loadDataset();
  const byInsee = new Map(dataset.communes.map((c) => [c.insee, c] as const));
  let state: AppState = readStateFromUrl();
  if (!byInsee.has(state.originInsee)) {
    state.originInsee = dataset.communes[0]?.insee ?? state.originInsee;
  }
  const origin = (): CommuneEntry | null => byInsee.get(state.originInsee) ?? null;

  const map = createMap(mapContainer);
  if (import.meta.env.DEV) {
    Object.assign(window, { __map: map });
  }

  map.on("load", () => {
    addCommuneLayers(map, dataset, origin);
    const o = origin();
    if (!o) return;
    const marker = createOriginMarker(map, o);
    updateRadiusHighlight(map, dataset, o, state.radiusKm);

    const panel = renderPanel(
      panelRoot,
      dataset,
      () => state,
      byInsee,
      {
        onChange(next) {
          state = { ...state, ...next };
          writeStateToUrl(state);
          const current = origin();
          if (!current) return;
          marker.setLngLat([current.lon, current.lat]);
          updateRadiusHighlight(map, dataset, current, state.radiusKm);
          panel.refresh();
          if (next.originInsee) {
            map.flyTo({ center: [current.lon, current.lat], zoom: 7.5 });
          }
        },
        onFocus(commune) {
          map.flyTo({ center: [commune.lon, commune.lat], zoom: 9.5 });
          showCommunePopup(map, commune, origin());
        },
      },
    );

    status.textContent =
      `${dataset.meta.count.toLocaleString("fr-FR")} communes — été 2016–2025, ERA5-Land`;
    legend.innerHTML = legendHtml();
  });
}

start().catch((error: unknown) => {
  status.textContent = "données indisponibles";
  console.error(error);
});
