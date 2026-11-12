// Pure filter / sort / page helpers for the Tenants area (residents, resident calls, callbacks).
// No Convex imports, so the node tests load it directly (scripts/probes/tenants_paging.test.mjs).
// The queries read the caller's authorised rows first (authorisation stays in the handlers), then
// hand them to these helpers, so a page is always a slice of the full, truthfully counted list.

import { severityBand } from "./severity";

export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

/** A requested page size: one of the offered sizes, else the default. */
export function clampPageSize(n: number | undefined): number {
  return n !== undefined && PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export type PageOf<T> = { rows: T[]; total: number; page: number; pageCount: number; pageSize: number };

/** One page of `rows`. A page past the end shows the last page; below 1 (or not a number) the first. */
export function pageOf<T>(rows: readonly T[], page: number | undefined, pageSize: number | undefined): PageOf<T> {
  const size = clampPageSize(pageSize);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const wanted = page !== undefined && Number.isFinite(page) ? Math.floor(page) : 1;
  const p = Math.min(Math.max(1, wanted), pageCount);
  return { rows: rows.slice((p - 1) * size, p * size), total, page: p, pageCount, pageSize: size };
}

export type SortDir = "asc" | "desc";

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

/** Search text: trimmed, lower case; `digits` (3 or more) also matches phone numbers. */
export function parseSearch(raw: string | undefined): { text: string; digits: string } | null {
  const text = raw?.trim().toLowerCase() ?? "";
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return { text, digits: digits.length >= 3 ? digits : "" };
}

function phoneHit(numbers: ReadonlyArray<string | undefined | null>, digits: string): boolean {
  return digits !== "" && numbers.some((p) => (p ?? "").replace(/\D/g, "").includes(digits));
}

/** Compares possibly missing values: missing always last, whatever the direction. */
function cmpOptional<T>(a: T | undefined | null, b: T | undefined | null, dir: SortDir, cmp: (x: T, y: T) => number): number {
  const an = a === undefined || a === null || a === "";
  const bn = b === undefined || b === null || b === "";
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  const c = cmp(a as T, b as T);
  return dir === "asc" ? c : -c;
}

// --- Residents ------------------------------------------------------------------------------------

export type ResidentViewRow = {
  fullName: string;
  phones: string[];
  email?: string;
  leaseEnd?: string;
  active: boolean;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  /** The building's team ("gold" | "silver" | "make_up"). */
  category?: string;
};

export const RESIDENT_SORT_KEYS = ["name", "unit", "lease", "status"] as const;
export type ResidentSortKey = (typeof RESIDENT_SORT_KEYS)[number];
export const RESIDENT_SORT_DEFAULT: { key: ResidentSortKey; dir: SortDir } = { key: "name", dir: "asc" };
export type ResidentStatus = "active" | "inactive" | "all";

export function residentsView<T extends ResidentViewRow>(
  rows: readonly T[],
  opts: {
    q?: string;
    status?: ResidentStatus;
    propertyId?: string;
    team?: string;
    sort?: { key: ResidentSortKey; dir: SortDir };
  },
): T[] {
  const s = parseSearch(opts.q);
  const status = opts.status ?? "active";
  const sort = opts.sort ?? RESIDENT_SORT_DEFAULT;
  const kept = rows.filter((r) => {
    if (status === "active" && !r.active) return false;
    if (status === "inactive" && r.active) return false;
    if (opts.propertyId && r.propertyId !== opts.propertyId) return false;
    if (opts.team && r.category !== opts.team) return false;
    if (!s) return true;
    return (
      r.fullName.toLowerCase().includes(s.text) ||
      r.unitNumber.toLowerCase().includes(s.text) ||
      r.propertyName.toLowerCase().includes(s.text) ||
      (r.email ?? "").toLowerCase().includes(s.text) ||
      phoneHit(r.phones, s.digits)
    );
  });
  const byName = (a: T, b: T) => natural(a.fullName, b.fullName);
  const byUnit = (a: T, b: T) => natural(a.propertyName, b.propertyName) || natural(a.unitNumber, b.unitNumber);
  const sign = sort.dir === "asc" ? 1 : -1;
  return kept
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      let c = 0;
      if (sort.key === "name") c = sign * byName(x.r, y.r);
      else if (sort.key === "unit") c = sign * byUnit(x.r, y.r);
      else if (sort.key === "lease") c = cmpOptional(x.r.leaseEnd, y.r.leaseEnd, sort.dir, (a, b) => (a < b ? -1 : a > b ? 1 : 0));
      else c = sign * (Number(y.r.active) - Number(x.r.active));
      return c || byName(x.r, y.r) || byUnit(x.r, y.r) || x.i - y.i;
    })
    .map((x) => x.r);
}

// --- Resident calls -------------------------------------------------------------------------------

export type CallViewRow = {
  callerName?: string;
  unit?: string;
  callerNumber?: string;
  callbackNumber?: string;
  mrNumber?: string;
  woNumber?: string;
  reason: string;
  description?: string;
  category?: string;
  callType?: string;
  severity: number;
  status: "open" | "resolved";
  statusLabel: string;
  createdAt: number;
  durationSec: number | null;
};

export const CALL_SORT_KEYS = ["when", "caller", "severity", "duration", "status"] as const;
export type CallSortKey = (typeof CALL_SORT_KEYS)[number];
export const CALL_SORT_DEFAULT: { key: CallSortKey; dir: SortDir } = { key: "when", dir: "desc" };
export type CallStatus = "open" | "resolved" | "all";

export function callTypeOf(row: { callType?: string; category?: string }): string {
  return row.callType ?? row.category ?? "";
}

export function callsView<T extends CallViewRow>(
  rows: readonly T[],
  opts: {
    q?: string;
    status?: CallStatus;
    /** "high" | "medium" | "low" */
    severity?: string;
    type?: string;
    sort?: { key: CallSortKey; dir: SortDir };
  },
): T[] {
  const s = parseSearch(opts.q);
  const status = opts.status ?? "open";
  const sort = opts.sort ?? CALL_SORT_DEFAULT;
  const kept = rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (opts.severity && severityBand(r.severity) !== opts.severity) return false;
    if (opts.type && callTypeOf(r) !== opts.type) return false;
    if (!s) return true;
    return (
      (r.callerName ?? "").toLowerCase().includes(s.text) ||
      (r.unit ?? "").toLowerCase().includes(s.text) ||
      r.reason.toLowerCase().includes(s.text) ||
      (r.description ?? "").toLowerCase().includes(s.text) ||
      (r.mrNumber ?? "").toLowerCase().includes(s.text) ||
      (r.woNumber ?? "").toLowerCase().includes(s.text) ||
      phoneHit([r.callerNumber, r.callbackNumber], s.digits)
    );
  });
  const sign = sort.dir === "asc" ? 1 : -1;
  return kept
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      let c = 0;
      if (sort.key === "when") c = sign * (x.r.createdAt - y.r.createdAt);
      else if (sort.key === "severity") c = sign * (x.r.severity - y.r.severity);
      else if (sort.key === "caller") c = cmpOptional(x.r.callerName, y.r.callerName, sort.dir, natural);
      else if (sort.key === "duration") c = cmpOptional(x.r.durationSec, y.r.durationSec, sort.dir, (a, b) => a - b);
      else c = sign * natural(x.r.statusLabel, y.r.statusLabel);
      // Same-key ties: newest first, so the order never depends on read order.
      return c || y.r.createdAt - x.r.createdAt || x.i - y.i;
    })
    .map((x) => x.r);
}

// --- Callbacks ------------------------------------------------------------------------------------

export type CallbackViewRow = {
  callerName: string | null;
  callbackNumber: string | null;
  callerEmail: string | null;
  reason: string;
  issueSummary: string;
  assignedName: string | null;
  status: "open" | "called_back" | "closed";
};

export type CallbackStatus = CallbackViewRow["status"] | "all";

/** Callbacks matching the status and search. Keeps the order of `rows` (newest first). */
export function callbacksView<T extends CallbackViewRow>(rows: readonly T[], opts: { q?: string; status?: CallbackStatus }): T[] {
  const s = parseSearch(opts.q);
  const status = opts.status ?? "all";
  return rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (!s) return true;
    return (
      (r.callerName ?? "").toLowerCase().includes(s.text) ||
      (r.callerEmail ?? "").toLowerCase().includes(s.text) ||
      r.issueSummary.toLowerCase().includes(s.text) ||
      r.reason.toLowerCase().includes(s.text) ||
      (r.assignedName ?? "").toLowerCase().includes(s.text) ||
      phoneHit([r.callbackNumber], s.digits)
    );
  });
}

/** Rows per status over `rows`, plus the total ("all"). */
export function countByStatus(rows: ReadonlyArray<{ status: string }>): Record<"open" | "called_back" | "closed" | "all", number> {
  const out = { open: 0, called_back: 0, closed: 0, all: rows.length };
  for (const r of rows) if (r.status === "open" || r.status === "called_back" || r.status === "closed") out[r.status]++;
  return out;
}
