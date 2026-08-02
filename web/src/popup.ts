import type { CommuneEntry } from "./types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function delta(value: number | null, origin: number | null, originName: string): string {
  if (value == null || origin == null) return "";
  const d = value - origin;
  const signed = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
  return `<span class="delta">${signed} vs ${esc(originName)}</span>`;
}

const row = (label: string, value: string): string =>
  `<div class="popup-row"><span>${label}</span><strong>${value}</strong></div>`;

function services(c: CommuneEntry): string {
  const items = [
    c.hosp ? "hôpital" : null,
    c.urg ? "urgences" : null,
    c.gp > 0 ? `${c.gp} médecin${c.gp > 1 ? "s" : ""}` : null,
    c.pharm ? "pharmacie" : null,
    c.station ? "gare" : null,
    c.lycee ? "lycée" : null,
    c.superm ? "supermarché" : null,
  ].filter((s): s is string => s !== null);
  return items.length > 0 ? items.join(" · ") : "aucun recensé (BPE)";
}

export function popupHtml(c: CommuneEntry, origin: CommuneEntry | null): string {
  const o = origin && origin.insee !== c.insee ? origin : null;
  const flood =
    c.floods === 0
      ? "aucun arrêté"
      : `${c.floods} arrêté(s), dernier ${c.lastFlood ?? "?"}`;
  const badges = [
    c.ppri === "approved" ? "PPRI approuvé" : c.ppri === "prescribed" ? "PPRI prescrit" : null,
    c.azi ? "AZI" : null,
    c.fire ? "Feu de forêt (DDRM)" : null,
    c.clay ? "Argiles (DDRM)" : null,
    c.coastal ? "Recul du trait de côte" : null,
  ]
    .filter((b): b is string => b !== null)
    .map((b) => `<span class="badge">${b}</span>`)
    .join(" ");

  return `
    <div class="popup">
      <h2>${esc(c.name)} <span class="muted">(${c.dept})</span></h2>
      <div class="muted small">${c.elev ?? "?"} m · ${c.pop?.toLocaleString("fr-FR") ?? "?"} hab.</div>
      ${row("Tmax été 2016–2025", `${c.jjaRecent.toFixed(1)} °C ${delta(c.jjaRecent, o?.jjaRecent ?? null, o?.name ?? "")}`)}
      ${row("Normale 1991–2020", c.jjaNormals == null ? "—" : `${c.jjaNormals.toFixed(1)} °C`)}
      ${row("Nuits tropicales/an", c.tropN == null ? "—" : `${c.tropN.toFixed(0)} ${delta(c.tropN, o?.tropN ?? null, o?.name ?? "")}`)}
      ${row("Jours ≥ 35 °C/an", c.d35 == null ? "—" : c.d35.toFixed(1))}
      ${row("Degrés-jours clim (CDD18)", c.cdd == null ? "—" : c.cdd.toFixed(0))}
      ${row("Inondations CATNAT depuis 1982", flood)}
      ${row("Services", services(c))}
      ${badges ? `<div class="popup-badges">${badges}</div>` : ""}
      <div class="muted small disclaimer-line">Estimation maillée ERA5-Land, pas une station.
      <a href="https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi?commune=${c.insee}"
         target="_blank" rel="noopener">Rapport Géorisques à l'adresse</a></div>
    </div>`;
}
