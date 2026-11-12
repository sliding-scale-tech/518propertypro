// The Payments page's search, status filter and totals, done in the browser over the list result
// (rentPayments.list returns every unit of the month for the team / owner / property filters,
// at most 3,000). Pure, no imports, so node tests load it (scripts/probes/ros_rent.test.mjs).

export type PaymentStatusFilter = "" | "unpaid" | "paid" | "not_markable";

/** The row fields the search and the totals read (rentPayments.list rows are assignable). */
export type SearchableRow = {
  propertyName: string;
  propertyAddress?: string | null;
  unit: string;
  tenants: string[];
  ownerName: string | null;
  status: "paid" | "unpaid" | "not_markable";
  rentCents: number | null;
  payment: { amountCents: number; counterparty?: string } | null;
};

export type PaymentsSummary = {
  paid: number;
  unpaid: number;
  notMarkable: number;
  total: number;
  /** Integer cents. */
  receivedCents: number;
  unpaidCents: number;
};

/** Lower case, trimmed, runs of whitespace as one space: "  12  ELM " -> "12 elm". */
export function normalizeSearch(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

/**
 * Does the row match the search? Any part of the property name or address, the unit, a tenant's
 * name (on the roster, or the name the payment was marked under) or the owner's name. An empty
 * search matches everything.
 */
export function rowMatchesSearch(row: SearchableRow, q: string | null | undefined): boolean {
  const needle = normalizeSearch(q);
  if (needle === "") return true;
  const fields = [
    row.propertyName,
    row.propertyAddress ?? "",
    row.unit,
    ...row.tenants,
    row.payment?.counterparty ?? "",
    row.ownerName ?? "",
  ];
  return fields.some((f) => normalizeSearch(f).includes(needle));
}

/** Counts and money of the rows (status filter NOT applied: the tiles and chips use it). */
export function summarizePayments(rows: readonly SearchableRow[]): PaymentsSummary {
  const s: PaymentsSummary = { paid: 0, unpaid: 0, notMarkable: 0, total: rows.length, receivedCents: 0, unpaidCents: 0 };
  for (const r of rows) {
    if (r.status === "paid") {
      s.paid += 1;
      s.receivedCents += r.payment?.amountCents ?? 0;
    } else if (r.status === "unpaid") {
      s.unpaid += 1;
      s.unpaidCents += r.rentCents ?? 0;
    } else s.notMarkable += 1;
  }
  return s;
}

/**
 * The page's view of the list: `matched` = rows matching the search (AND the server-side team /
 * owner / property filters already applied), `summary` over `matched`, `visible` = `matched` with
 * the status filter (the table, before paging). Order is kept.
 */
export function applyPaymentsView<T extends SearchableRow>(
  rows: readonly T[],
  f: { q?: string | null; status?: PaymentStatusFilter | null },
): { matched: T[]; visible: T[]; summary: PaymentsSummary } {
  const matched = rows.filter((r) => rowMatchesSearch(r, f.q));
  const status = f.status ?? "";
  const visible = status === "" ? matched : matched.filter((r) => r.status === status);
  return { matched, visible, summary: summarizePayments(matched) };
}

/** The rows "Select all" ticks: the markable rows of the page shown, at most `max`. */
export function selectableOnPage<T extends { canMark: boolean; unitId: string }>(pageRows: readonly T[], max: number): string[] {
  return pageRows.filter((r) => r.canMark).slice(0, max).map((r) => r.unitId);
}

/** The page sizes of the Payments page: buildings per page (a building is never split). */
export const BUILDING_PAGE_SIZES: readonly number[] = [10, 25, 50];
export const DEFAULT_BUILDING_PAGE_SIZE = 10;

/** One building on the Payments page: its rows in list order, split into the shown and greyed-out ones. */
export type PropertyGroup<T> = {
  propertyId: string;
  rows: T[];
  /** Paid and unpaid rows (listed one per line). */
  active: T[];
  /** Not-markable rows (folded into one line under the building). */
  notMarkable: T[];
};

/**
 * Rows grouped by building, in the order the buildings first appear (rentPayments.list sorts by
 * team, building and unit, so a building's rows are together). Paging counts these groups.
 */
export function groupByProperty<T extends { propertyId: string; status: SearchableRow["status"] }>(rows: readonly T[]): PropertyGroup<T>[] {
  const groups: PropertyGroup<T>[] = [];
  const byId = new Map<string, PropertyGroup<T>>();
  for (const r of rows) {
    let g = byId.get(r.propertyId);
    if (!g) {
      g = { propertyId: r.propertyId, rows: [], active: [], notMarkable: [] };
      byId.set(r.propertyId, g);
      groups.push(g);
    }
    g.rows.push(r);
    (r.status === "not_markable" ? g.notMarkable : g.active).push(r);
  }
  return groups;
}

/** Per building: paid and unpaid counts (the "3 of 12 paid" in the building header). */
export function paidProgressByProperty(rows: readonly { propertyId: string; status: SearchableRow["status"] }[]): Map<string, { paid: number; due: number }> {
  const out = new Map<string, { paid: number; due: number }>();
  for (const r of rows) {
    if (r.status === "not_markable") continue;
    const p = out.get(r.propertyId) ?? { paid: 0, due: 0 };
    p.due += 1;
    if (r.status === "paid") p.paid += 1;
    out.set(r.propertyId, p);
  }
  return out;
}

/** The distinct reasons of greyed-out rows, in order, for the folded line: "vacant on the roster, owner collects rent". */
export function reasonsSummary(rows: readonly { reason: string | null }[]): string {
  const seen: string[] = [];
  for (const r of rows) {
    const reason = (r.reason ?? "").trim();
    // "Vacant on the roster" -> "vacant on the roster" (only the first letter: month names keep theirs)
    const lower = reason.charAt(0).toLowerCase() + reason.slice(1);
    if (lower !== "" && !seen.includes(lower)) seen.push(lower);
  }
  return seen.join(", ");
}
