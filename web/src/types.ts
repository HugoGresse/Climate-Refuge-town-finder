export interface CommuneEntry {
  readonly insee: string;
  readonly name: string;
  readonly dept: string;
  readonly lat: number;
  readonly lon: number;
  readonly pop: number | null;
  readonly elev: number | null;
  /** JJA mean Tmax 2016–2025 — primary orientation layer. */
  readonly jjaRecent: number;
  readonly jjaNormals: number | null;
  readonly cdd: number | null;
  readonly tropN: number | null;
  readonly d30: number | null;
  readonly d35: number | null;
  readonly floods: number;
  readonly floods2000: number;
  readonly lastFlood: string | null;
  readonly ppri: string | null;
  readonly azi: boolean;
  readonly fire: boolean;
  readonly clay: boolean;
  readonly coastal: boolean;
  readonly hosp: boolean;
  readonly urg: boolean;
  readonly gp: number;
  readonly pharm: boolean;
  readonly station: boolean;
  readonly lycee: boolean;
  readonly superm: boolean;
  /** National heat-burden percentile (0 = coolest, 100 = hottest). */
  readonly hPct: number | null;
  /** National flood-history percentile. */
  readonly fPct: number | null;
}

export interface Dataset {
  readonly meta: { readonly count: number; readonly model: string };
  readonly communes: readonly CommuneEntry[];
}

export const ORIGIN_INSEE = "34172"; // Montpellier — default origin, picker later
