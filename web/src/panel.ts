import { haversineKm } from "../../src/lib/geo";
import type { AppState } from "./state";
import type { CommuneEntry, Dataset } from "./types";

export interface PanelCallbacks {
  onChange(next: Partial<AppState>): void;
  onFocus(commune: CommuneEntry): void;
}

/** -1 is the "ville avec hôpital et gare" preset (livability gate, not size). */
const POP_PRESETS: [number, string][] = [
  [0, "toutes les communes"],
  [1000, "≥ 1 000 hab."],
  [5000, "≥ 5 000 hab."],
  [-1, "avec hôpital et gare"],
];

function passesPreset(c: CommuneEntry, minPop: number): boolean {
  if (minPop === -1) return c.hosp && c.station;
  return (c.pop ?? 0) >= minPop;
}

const strip = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function renderPanel(
  root: HTMLElement,
  dataset: Dataset,
  getState: () => AppState,
  byInsee: Map<string, CommuneEntry>,
  callbacks: PanelCallbacks,
): { refresh(): void } {
  root.innerHTML = `
    <div class="panel-block">
      <label class="panel-label" for="origin-search">Ville d'origine</label>
      <input id="origin-search" type="search" autocomplete="off"
             placeholder="Rechercher une commune…" />
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="panel-block">
      <label class="panel-label" for="radius">Rayon <strong id="radius-value"></strong> à vol d'oiseau</label>
      <input id="radius" type="range" min="25" max="500" step="25" />
    </div>
    <div class="panel-block">
      <label class="panel-label" for="minpop">Taille de commune (classement)</label>
      <select id="minpop">
        ${POP_PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
    </div>
    <div class="panel-block">
      <div class="panel-label">Plus fraîches dans le rayon <span class="muted">(été 2016–2025)</span></div>
      <ol class="ranking" id="ranking"></ol>
    </div>
    <div class="panel-footer muted small">
      Outil d'information, pas un avis immobilier ou assurantiel.
      Estimations maillées — consultez le rapport Géorisques à l'adresse.
      <div class="footer-links">
        <a href="/methodologie.html">Méthodologie</a> ·
        <a href="/attributions.html">Sources</a> ·
        <a href="/mentions-legales.html">Mentions légales</a> ·
        <a href="/confidentialite.html">Confidentialité</a>
      </div>
    </div>`;

  const search = root.querySelector<HTMLInputElement>("#origin-search")!;
  const results = root.querySelector<HTMLElement>("#search-results")!;
  const radius = root.querySelector<HTMLInputElement>("#radius")!;
  const radiusValue = root.querySelector<HTMLElement>("#radius-value")!;
  const minPop = root.querySelector<HTMLSelectElement>("#minpop")!;
  const ranking = root.querySelector<HTMLOListElement>("#ranking")!;

  search.addEventListener("input", () => {
    const query = strip(search.value.trim());
    if (query.length < 2) {
      results.innerHTML = "";
      return;
    }
    const matches = dataset.communes
      .filter((c) => strip(c.name).startsWith(query))
      .sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0))
      .slice(0, 8);
    results.innerHTML = matches
      .map(
        (c) =>
          `<button data-insee="${c.insee}">${c.name} <span class="muted">(${c.dept}${
            c.pop ? ` · ${c.pop.toLocaleString("fr-FR")} hab.` : ""
          })</span></button>`,
      )
      .join("");
  });
  results.addEventListener("click", (event) => {
    const insee = (event.target as HTMLElement).closest("button")?.dataset["insee"];
    if (!insee) return;
    search.value = "";
    results.innerHTML = "";
    callbacks.onChange({ originInsee: insee });
  });
  radius.addEventListener("input", () => {
    radiusValue.textContent = `${radius.value} km`;
  });
  radius.addEventListener("change", () => {
    callbacks.onChange({ radiusKm: Number(radius.value) });
  });
  minPop.addEventListener("change", () => {
    callbacks.onChange({ minPop: Number(minPop.value) });
  });
  ranking.addEventListener("click", (event) => {
    const insee = (event.target as HTMLElement).closest("li")?.dataset["insee"];
    const commune = insee ? byInsee.get(insee) : undefined;
    if (commune) callbacks.onFocus(commune);
  });

  function refresh(): void {
    const state = getState();
    const origin = byInsee.get(state.originInsee);
    if (!origin) return;
    search.placeholder = origin.name;
    radius.value = String(state.radiusKm);
    radiusValue.textContent = `${state.radiusKm} km`;
    minPop.value = String(state.minPop);

    const rows = dataset.communes
      .filter(
        (c) =>
          passesPreset(c, state.minPop) &&
          haversineKm(
            { lat: origin.lat, lon: origin.lon },
            { lat: c.lat, lon: c.lon },
          ) <= state.radiusKm,
      )
      .sort((a, b) => a.jjaRecent - b.jjaRecent)
      .slice(0, 15);
    ranking.innerHTML = rows
      .map((c) => {
        const delta = c.jjaRecent - origin.jjaRecent;
        const sign = delta >= 0 ? "+" : "−";
        return `<li data-insee="${c.insee}">
          <strong>${c.name}</strong>
          <span class="muted">${c.elev ?? "?"} m</span>
          <span class="rank-values">${c.jjaRecent.toFixed(1)} °C
            <em>${sign}${Math.abs(delta).toFixed(1)}</em></span>
        </li>`;
      })
      .join("");
  }

  refresh();
  return { refresh };
}
