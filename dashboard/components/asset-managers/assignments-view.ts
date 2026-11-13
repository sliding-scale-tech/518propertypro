// Search, team filter, asset-manager filter and sorting for the Property assignments table, plus the
// per-manager summary shown above it (pure, so the node tests load it:
// scripts/probes/assignments_view.test.mjs). Rows are the properties.list rows; the list comes whole
// from the server, so this runs in the browser.

import { normalizeSearch } from "../finance/payments-search";
import type { SortState } from "../ui/table-sort";
import { propertiesView, propertyInTeam, type PropertyFinderRow, type PropertySortKey } from "../properties/property-finders";

export type AssignmentRow = PropertyFinderRow & {
  defaultAssetManagerUserId?: string | null;
};

/** The sort columns of the table: building, team and units. */
export type AssignmentSortKey = Extract<PropertySortKey, "name" | "team" | "units">;
export const ASSIGNMENT_SORT_DEFAULT: SortState<AssignmentSortKey> = { key: "name", dir: "asc" };

/** The asset-manager filter value for "buildings with no default asset manager". */
export const AM_FILTER_NONE = "__none__";

/** The building's name or address contains the search (an empty search matches everything). */
export function buildingMatches(p: AssignmentRow, q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  return [p.name, p.address?.formatted ?? ""].some((f) => normalizeSearch(f).includes(needle));
}

/** The building's default asset manager matches the filter ("" / null = anyone, AM_FILTER_NONE = nobody). */
export function inAssetManagerFilter(p: AssignmentRow, am: string | null | undefined): boolean {
  if (!am) return true;
  if (am === AM_FILTER_NONE) return !p.defaultAssetManagerUserId;
  return p.defaultAssetManagerUserId === am;
}

/** Search AND team AND asset manager, then sorted (ties fall back to the building name). */
export function assignmentsView<T extends AssignmentRow>(
  rows: readonly T[],
  f: { q?: string | null; team?: string | null; am?: string | null; sort?: SortState<AssignmentSortKey> },
): T[] {
  const matched = rows.filter((p) => buildingMatches(p, f.q) && inAssetManagerFilter(p, f.am) && propertyInTeam(p, f.team ?? ""));
  return propertiesView(matched, { sort: f.sort ?? ASSIGNMENT_SORT_DEFAULT });
}

const TEAM_ORDER = ["gold", "silver", "make_up"] as const;

/** One manager's buildings: how many, and which teams (Gold, Silver, Make Up order) they are on. */
export function managerSummary(rows: readonly AssignmentRow[], userId: string): { buildings: number; teams: string[]; noTeam: number } {
  const mine = rows.filter((p) => p.defaultAssetManagerUserId === userId);
  const teams = TEAM_ORDER.filter((t) => mine.some((p) => p.category === t)) as string[];
  return { buildings: mine.length, teams, noTeam: mine.filter((p) => !p.category || !TEAM_ORDER.includes(p.category as (typeof TEAM_ORDER)[number])).length };
}
