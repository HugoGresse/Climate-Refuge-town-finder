import "./style.css";
import { addCommuneLayer, createMap, legendHtml } from "./map";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element missing");
}

app.innerHTML = `
  <header class="topbar">
    <h1>Climat &amp; risques — communes françaises</h1>
    <span class="status" id="status">chargement…</span>
  </header>
  <div class="map-container" id="map"></div>
  <aside class="legend" id="legend"></aside>
  <aside class="data-notice">
    Outil d'information et de comparaison, pas un avis immobilier ou
    assurantiel. Estimations maillées à l'échelle communale — consultez le
    rapport Géorisques à l'adresse avant toute décision.
  </aside>
`;

const mapContainer = document.querySelector<HTMLDivElement>("#map");
const status = document.querySelector<HTMLSpanElement>("#status");
const legend = document.querySelector<HTMLElement>("#legend");
if (!mapContainer || !status || !legend) {
  throw new Error("layout containers missing");
}

const map = createMap(mapContainer);
if (import.meta.env.DEV) {
  Object.assign(window, { __map: map });
}
map.on("load", () => {
  addCommuneLayer(map)
    .then((dataset) => {
      status.textContent =
        `${dataset.meta.count} communes pilotes — été 2016–2025, ERA5-Land`;
      legend.innerHTML = legendHtml();
    })
    .catch((error: unknown) => {
      status.textContent = "données indisponibles";
      console.error(error);
    });
});
