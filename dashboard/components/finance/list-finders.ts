// Search, filters and sorting for the Owner statements list and the Owners list (pure, so the
// node tests load it: scripts/probes/ros_list_finders.test.mjs). Both lists are small (one row per
// owner, a few hundred at most) and come whole from the server, so this runs in the browser.

import { normalizeSearch } from "./payments-search";
import { sortRows, type SortState } from "../ui/table-sort";

// --- Owner statements list (/owner-statements) -----------------------------------------------------

export type StatementStatusKey = "not_started" | "draft" | "final";
export const STATEMENT_STATUS_KEYS: readonly StatementStatusKey[] = ["not_started", "draft", "final"];

export type StatementSortKey = "owner" | "status" | "ending" | "available" | "updated";
export const STATEMENT_SORT_KEYS: readonly StatementSortKey[] = ["owner", "status", "ending", "available", "updated"];
export const STATEMENT_SORT_DEFAULT: SortState<StatementSortKey> = { key: "owner", dir: "asc" };

/** The fields these helpers read from a statements-list row (statement-list.tsx Row is assignable). */
export type StatementFinderRow = {
  owner: {
    legalName: string;
    emails?: string[];
    properties?: { name: string; address: string | null; category: string | null }[];
  };
  statement: {
    status: "draft" | "final" | "discarded";
    propertyNames: string[];
    endingCashCents?: number;
    availableCents?: number;
    updatedAt: number;
  } | null;
};

export function statementRowStatus(r: StatementFinderRow): StatementStatusKey | "discarded" {
  return r.statement ? r.statement.status : "not_started";
}

/** Owner name, owner email, or the name / address of any of the owner's properties (or the statement's). */
export function statementRowMatches(r: StatementFinderRow, q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  const fields = [
    r.owner.legalName,
    ...(r.owner.emails ?? []),
    ...(r.owner.properties ?? []).flatMap((p) => [p.name, p.address ?? ""]),
    ...(r.statement?.propertyNames ?? []),
  ];
  return fields.some((f) => normalizeSearch(f).includes(needle));
}

/** The owner has a property in the team ("" = any team). */
export function statementRowInTeam(r: StatementFinderRow, team: string): boolean {
  return team === "" || (r.owner.properties ?? []).some((p) => p.category === team);
}

/**
 * The list's view: `matched` = search AND team; `counts` over `matched` (the status chips);
 * `visible` = `matched` with the status filter, sorted.
 */
export function statementsView<T extends StatementFinderRow>(
  rows: readonly T[],
  f: { q?: string | null; team?: string; status?: StatementStatusKey | ""; sort?: SortState<StatementSortKey> },
): { matched: T[]; visible: T[]; counts: Record<StatementStatusKey | "all", number> } {
  const matched = rows.filter((r) => statementRowMatches(r, f.q) && statementRowInTeam(r, f.team ?? ""));
  const counts = { all: matched.length, not_started: 0, draft: 0, final: 0 };
  for (const r of matched) {
    const s = statementRowStatus(r);
    if (s !== "discarded") counts[s] += 1;
  }
  const status = f.status ?? "";
  const filtered = status === "" ? matched : matched.filter((r) => statementRowStatus(r) === status);
  return { matched, visible: sortStatements(filtered, f.sort ?? STATEMENT_SORT_DEFAULT), counts };
}

const STATUS_RANK: Record<string, number> = { not_started: 0, draft: 1, final: 2, discarded: 3 };

/** Sort by the column; ties (and the owner sort) by owner name. Amounts exist only on finals; others go last. */
export function sortStatements<T extends StatementFinderRow>(rows: readonly T[], sort: SortState<StatementSortKey>): T[] {
  const byName = sortRows(rows, (r) => r.owner.legalName, sort.key === "owner" ? sort.dir : "asc");
  if (sort.key === "owner") return byName;
  const value = (r: T): number | null => {
    switch (sort.key) {
      case "status":
        return STATUS_RANK[statementRowStatus(r)];
      case "ending":
        return r.statement?.status === "final" ? (r.statement.endingCashCents ?? null) : null;
      case "available":
        return r.statement?.status === "final" ? (r.statement.availableCents ?? null) : null;
      case "updated":
        return r.statement ? r.statement.updatedAt : null;
      default:
        return null;
    }
  };
  return sortRows(byName, value, sort.dir);
}

// --- Owners list (/owner-statements/owners) ----------------------------------------------------------

export type OwnerSortKey = "name" | "contact" | "properties" | "problems";
export const OWNER_SORT_KEYS: readonly OwnerSortKey[] = ["name", "contact", "properties", "problems"];
export const OWNER_SORT_DEFAULT: SortState<OwnerSortKey> = { key: "name", dir: "asc" };

export type OwnerFinderRow = {
  legalName: string;
  contactName: string | null;
  emails: string[];
  propertyNames?: string[];
  propertyCount: number;
  problems: string[];
  coOwnedPropertyNames: string[];
};

/** Legal name, contact, email or a linked property's name. */
export function ownerMatches(o: OwnerFinderRow, q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  return [o.legalName, o.contactName ?? "", ...o.emails, ...(o.propertyNames ?? [])].some((f) => normalizeSearch(f).includes(needle));
}

export function ownerProblemCount(o: OwnerFinderRow): number {
  return o.problems.length + (o.coOwnedPropertyNames.length > 0 ? 1 : 0);
}

/** Search AND (optionally) only owners with a problem, sorted (ties by legal name). */
export function ownersView<T extends OwnerFinderRow>(
  rows: readonly T[],
  f: { q?: string | null; problemsOnly?: boolean; sort?: SortState<OwnerSortKey> },
): T[] {
  const sort = f.sort ?? OWNER_SORT_DEFAULT;
  const matched = rows.filter((o) => ownerMatches(o, f.q) && (!f.problemsOnly || ownerProblemCount(o) > 0));
  const byName = sortRows(matched, (o) => o.legalName, sort.key === "name" ? sort.dir : "asc");
  if (sort.key === "name") return byName;
  return sortRows(
    byName,
    (o) => (sort.key === "contact" ? o.contactName || null : sort.key === "properties" ? o.propertyCount : ownerProblemCount(o)),
    sort.dir,
  );
}
