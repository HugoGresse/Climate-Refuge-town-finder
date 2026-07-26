import "./style.css";
import { createMap } from "./map";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element missing");
}

app.innerHTML = `
  <header class="topbar">
    <h1>Climat &amp; risques — communes françaises</h1>
    <span class="status">prototype — aucune donnée climatique chargée</span>
  </header>
  <div class="map-container" id="map"></div>
  <aside class="data-notice">
    Outil d'information et de comparaison, pas un avis immobilier ou
    assurantiel. Les indicateurs arriveront région par région — voir la
    méthodologie dans le dépôt.
  </aside>
`;

const mapContainer = document.querySelector<HTMLDivElement>("#map");
if (!mapContainer) {
  throw new Error("#map container missing");
}

createMap(mapContainer);
