/** App state lives in the URL — shareable permalinks, no accounts (README). */

export interface AppState {
  originInsee: string;
  radiusKm: number;
  /** Population floor for ranking; map still renders smaller communes. */
  minPop: number;
}

export const DEFAULT_STATE: AppState = {
  originInsee: "34172", // Montpellier
  radiusKm: 150,
  minPop: 1000,
};

export function readStateFromUrl(): AppState {
  const params = new URLSearchParams(location.search);
  const radius = Number(params.get("r"));
  const minPop = Number(params.get("p"));
  return {
    originInsee: params.get("o") ?? DEFAULT_STATE.originInsee,
    radiusKm: Number.isFinite(radius) && radius >= 25 && radius <= 500
      ? radius
      : DEFAULT_STATE.radiusKm,
    minPop: Number.isFinite(minPop) && minPop >= 0 ? minPop : DEFAULT_STATE.minPop,
  };
}

export function writeStateToUrl(state: AppState): void {
  const params = new URLSearchParams();
  params.set("o", state.originInsee);
  params.set("r", String(state.radiusKm));
  params.set("p", String(state.minPop));
  history.replaceState(null, "", `?${params.toString()}`);
}
