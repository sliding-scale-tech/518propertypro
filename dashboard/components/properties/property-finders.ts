// Search, team filter and sorting for the Properties list and the unit inventory (pure, so the node
// tests load it: scripts/probes/list_finders_properties.test.mjs). Both lists are small (a few hundred
// rows at most) and come whole from the server, so this runs in the browser.

import { normalizeSearch } from "../finance/payments-search";
import { sortRows, type SortState } from "../ui/table-sort";

// --- Properties list -----------------------------------------------------------------------------

export type PropertySortKey = "name" | "address" | "team" | "units";
export const PROPERTY_SORT_KEYS: readonly PropertySortKey[] = ["name", "address", "team", "units"];
export const PROPERTY_SORT_DEFAULT: SortState<PropertySortKey> = { key: "name", dir: "asc" };

/** The fields these helpers read from a properties.list row. */
export type PropertyFinderRow = {
  name: string;
  address?: { formatted: string } | null;
  category?: string | null;
  ownerName?: string | null;
  unitCount: number;
};

const TEAM_RANK: Record<string, number> = { gold: 0, silver: 1, make_up: 2 };

/** Name, address or owner name contains the search (an empty search matches everything). */
export function propertyMatches(p: PropertyFinderRow, q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  return [p.name, p.address?.formatted ?? "", p.ownerName ?? ""].some((f) => normalizeSearch(f).includes(needle));
}

/** The building is on the team ("" = any team). */
export function propertyInTeam(p: PropertyFinderRow, team: string): boolean {
  return team === "" || p.category === team;
}

/** Search AND team, then sorted; ties fall back to the name. */
export function propertiesView<T extends PropertyFinderRow>(
  rows: readonly T[],
  f: { q?: string | null; team?: string; sort?: SortState<PropertySortKey> },
): T[] {
  const matched = rows.filter((p) => propertyMatches(p, f.q) && propertyInTeam(p, f.team ?? ""));
  const sort = f.sort ?? PROPERTY_SORT_DEFAULT;
  const byName = sortRows(matched, (p) => p.name, sort.key === "name" ? sort.dir : "asc");
  if (sort.key === "name") return byName;
  const value = (p: T): string | number | null =>
    sort.key === "address"
      ? p.address?.formatted || null
      : sort.key === "team"
        ? (TEAM_RANK[p.category ?? ""] ?? 3)
        : p.unitCount;
  return sortRows(byName, value, sort.dir);
}

// --- Unit inventory ------------------------------------------------------------------------------

export type UnitSortKey = "unit" | "tenant" | "rent" | "manager" | "available";
export const UNIT_SORT_KEYS: readonly UnitSortKey[] = ["unit", "tenant", "rent", "manager", "available"];
export const UNIT_SORT_DEFAULT: SortState<UnitSortKey> = { key: "unit", dir: "asc" };

export type UnitAvailabilityFilter = "" | "available" | "unavailable" | "vacant";
export const UNIT_AVAILABILITY_FILTERS: readonly UnitAvailabilityFilter[] = ["", "available", "unavailable", "vacant"];

/** The fields these helpers read from a units.list row. */
export type UnitFinderRow = {
  unitNumber: string;
  bedrooms?: string | null;
  rent?: number | null;
  available: boolean;
  assetManagerName?: string | null;
};

/** Unit number, bedrooms, a tenant's name, the asset manager, or the status words ("available", "vacant"...). */
export function unitMatches<T extends UnitFinderRow & { _id: string }>(u: T, tenants: readonly string[], q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  const status = [u.available ? "available" : "unavailable", tenants.length === 0 ? "vacant" : "occupied"];
  return [u.unitNumber, u.bedrooms ?? "", u.assetManagerName ?? "", ...tenants, ...status].some((f) => normalizeSearch(f).includes(needle));
}

/** The unit's availability / occupancy filter ("" = all). */
export function unitInFilter(u: UnitFinderRow, tenants: readonly string[], filter: UnitAvailabilityFilter): boolean {
  if (filter === "") return true;
  if (filter === "vacant") return tenants.length === 0;
  return filter === "available" ? u.available : !u.available;
}

/** Search AND filter, then sorted (unit number is the tie-break, compared naturally: 2 before 10). */
export function unitsView<T extends UnitFinderRow & { _id: string }>(
  rows: readonly T[],
  tenantsOf: (u: T) => readonly string[],
  f: { q?: string | null; filter?: UnitAvailabilityFilter; sort?: SortState<UnitSortKey> },
): T[] {
  const matched = rows.filter((u) => unitMatches(u, tenantsOf(u), f.q) && unitInFilter(u, tenantsOf(u), f.filter ?? ""));
  const sort = f.sort ?? UNIT_SORT_DEFAULT;
  const byUnit = sortRows(matched, (u) => u.unitNumber, sort.key === "unit" ? sort.dir : "asc");
  if (sort.key === "unit") return byUnit;
  const value = (u: T): string | number | null =>
    sort.key === "tenant"
      ? tenantsOf(u).join(", ") || null
      : sort.key === "rent"
        ? (u.rent ?? null)
        : sort.key === "manager"
          ? (u.assetManagerName ?? null)
          : u.available
            ? 1
            : 0;
  return sortRows(byUnit, value, sort.dir);
}
