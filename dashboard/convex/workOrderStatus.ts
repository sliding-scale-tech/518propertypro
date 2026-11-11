/**
 * Pure logic for Sarah's check_work_order_status tool (Sarah Configuration section 10: "If live
 * work-order lookup is supported, Sarah can provide the recorded status"). No Convex imports, so
 * it is unit-tested with plain Node (scripts/probes/work_order_status.test.mjs).
 *
 * Design (user decision 2026-10-31): an EXACT address + unit match is enough to hear a request's
 * status. Verification is a SOFT signal that never blocks: a verified caller (caller ID or a name
 * matching a resident of the unit) additionally hears the scheduled visit day, date and time;
 * everyone else hears only that a visit is scheduled and that the asset manager will confirm the
 * time. Nothing tells the caller whether they were verified.
 *
 * Three jobs:
 *  1. verifyStatusCaller: is the caller verified for this unit (or for some of its requests)?
 *  2. buildStatusItems: the unit's requests and work orders as tenant-safe items, each with a
 *     plain-English status. Every status value in the schema is mapped; an unknown one makes the
 *     whole answer fail closed, so Sarah routes the question instead of guessing.
 *  3. rankByIssue: which item the caller's own description most likely refers to.
 *
 * What an item carries is deliberately narrow: a short summary (the request or work-order title),
 * the date reported, the status sentence and a due date. Never notes, costs, expenses, access
 * notes, the tenant's preferred time (what they asked for, not a scheduled visit), technician or
 * asset-manager names, phone numbers, close explanations, or anything about another unit or
 * another resident.
 */

import { matchResidentName } from "./residentMatch";

/** Closed items stay visible this long after they were closed; open items always show. */
export const STATUS_WINDOW_DAYS = 30;
/** At most this many items are returned for one unit, newest first. */
export const MAX_STATUS_ITEMS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RequestLike = {
  id: string;
  number: number;
  status: string;
  title?: string;
  issueType: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  closeReason?: string;
  callerNumber?: string;
  callbackNumber?: string;
};

export type WorkOrderLike = {
  id: string;
  number: number;
  requestId?: string;
  status: string;
  title: string;
  dueDate?: number;
  window?: string;
  windowStart?: number;
  windowEnd?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  closedAt?: number;
};

// --- 1. Verification ---------------------------------------------------------------------------

/** Last ten digits, the same comparison tourSchedule.phoneKey uses. Null when too short. */
export function phoneDigits(phone: string | undefined | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

export type Verification =
  /** Verified for the whole unit: visit details may be read for any of its requests. */
  | { verified: true; scope: "unit"; how: "caller_id" | "name" }
  /** Verified only for the requests whose own caller / callback number is this caller ID. */
  | { verified: true; scope: "requests"; how: "caller_id_on_request"; requestIds: string[] }
  | { verified: false };

/**
 * A soft signal (it never blocks the status; it only unlocks the visit day, date and time).
 * At least one of:
 *  a) caller ID belongs to an active resident of THIS unit (residentPhones), or it is the caller /
 *     callback number recorded on one of the unit's requests (then only those requests count);
 *  b) the spoken name matches an active resident of THIS unit (residentMatch).
 * A unit-wide match (resident phone or name) wins over the per-request one.
 */
export function verifyStatusCaller(input: {
  callerId?: string | null;
  callerIdIsUnitResident: boolean;
  callerName?: string | null;
  residents: ReadonlyArray<{ id: string; fullName: string }>;
  requests: ReadonlyArray<Pick<RequestLike, "id" | "callerNumber" | "callbackNumber">>;
}): Verification {
  if (input.callerIdIsUnitResident && phoneDigits(input.callerId)) {
    return { verified: true, scope: "unit", how: "caller_id" };
  }
  if (matchResidentName(input.callerName, input.residents).matched) {
    return { verified: true, scope: "unit", how: "name" };
  }
  const key = phoneDigits(input.callerId);
  if (key) {
    const ids = input.requests
      .filter((r) => phoneDigits(r.callerNumber) === key || phoneDigits(r.callbackNumber) === key)
      .map((r) => r.id);
    if (ids.length > 0) return { verified: true, scope: "requests", how: "caller_id_on_request", requestIds: ids };
  }
  return { verified: false };
}

// --- 2. Status mapping -------------------------------------------------------------------------

export type DateFormatter = (ms: number) => string;

/** "Tuesday, November 3" in the team's time zone. */
export function spokenDate(timeZone: string): DateFormatter {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
  return (ms) => f.format(ms);
}

/** "1:00 PM" in the team's time zone. */
export function spokenClock(timeZone: string): DateFormatter {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  return (ms) => f.format(ms).replace(/\s/g, " ");
}

/** Request statuses that are still open (maintenance.ts OPEN). */
const OPEN_REQUEST = new Set(["new", "under_review", "more_info_needed", "forwarded_to_pat"]);
/** Work-order statuses that are finished. */
const DONE_WORK_ORDER = new Set(["completed", "reviewed_closed", "cancelled"]);

/**
 * Plain-English status for a request that has no work order (yet). Keyed by every value of
 * maintenanceRequests.status. work_order_created is answered from the work order instead.
 */
export const REQUEST_STATUS_TEXT: Record<string, string | null> = {
  new: "We've received it, and it's waiting for your asset manager to review.",
  under_review: "It's with your asset manager for review.",
  more_info_needed: "Your asset manager has asked for more information about it.",
  forwarded_to_pat: "Your asset manager has approved it and passed it to our maintenance team for the next step.",
  work_order_created: null, // see the work order
  closed_out_of_scope: null, // see closedText
  closed_duplicate: "It was closed because it's already covered by another request for your unit.",
};

/**
 * The reason a closed request may be read out, only for the preset reasons a tenant is meant to
 * hear (maintenanceReasons.OUT_OF_SCOPE_REASONS, and Sarah's own tenant-responsibility close).
 * Anything else ("Other", free text) is closed with no reason: the written explanation is internal.
 */
export function closedText(closeReason: string | undefined): string {
  const r = (closeReason ?? "").trim().toLowerCase();
  if (r.startsWith("tenant responsibility")) {
    return "It was closed because it's the tenant's responsibility under our policy, so a technician won't be sent for it.";
  }
  if (r.startsWith("not a repair")) {
    return "It was closed because it isn't a repair, and it was passed to our leasing team.";
  }
  if (r.startsWith("duplicate of")) {
    return "It was closed because it's already covered by another open request for your unit.";
  }
  if (r.startsWith("resolved on the call")) return "It was closed as resolved.";
  return "It was closed by your asset manager.";
}

/** Window text that only makes sense on the day it was typed ("Today 2-4pm") is never read out. */
const RELATIVE_WINDOW = /\b(?:today|tonight|tomorrow|yesterday|this|next|asap|now)\b/i;

/**
 * "2-4pm" as typed by staff on an older work order, when it is safe to read next to a date; else
 * null. A picked window (windowStart/windowEnd) is read from its times instead, see visitTime.
 */
export function visitWindow(window: string | undefined): string | null {
  const w = (window ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!w || w.length > 40 || RELATIVE_WINDOW.test(w)) return null;
  return w;
}

/** The visit's day: the picked window's start, else the due date. */
export function visitDay(w: Pick<WorkOrderLike, "windowStart" | "windowEnd" | "dueDate">): number | undefined {
  return w.windowStart !== undefined && w.windowEnd !== undefined ? w.windowStart : w.dueDate;
}

/** The time to read after the date ("between 1:00 PM and 3:00 PM"), or null when there is none. */
export function visitTime(w: Pick<WorkOrderLike, "window" | "windowStart" | "windowEnd">, clock?: DateFormatter): string | null {
  if (w.windowStart !== undefined && w.windowEnd !== undefined) {
    return clock ? `between ${clock(w.windowStart)} and ${clock(w.windowEnd)}` : null;
  }
  return visitWindow(w.window);
}

/**
 * Plain-English status for a work order. Keyed by every value of workOrders.status. A visit is
 * "scheduled" when the work order is assigned and has a picked window or a date (workOrders.dueDate).
 * Its day, date and time are read only to a verified caller (showVisit); everyone else hears that
 * one is scheduled. `clock` ("1:00 PM" in the team's zone) reads a picked window's times.
 */
export const WORK_ORDER_STATUS_TEXT: Record<string, (w: WorkOrderLike, day: DateFormatter, showVisit: boolean, clock?: DateFormatter) => string> = {
  created: () => "It's been approved, and a technician will be assigned.",
  assigned: (w, day, showVisit, clock) => {
    const when = visitDay(w);
    if (!when) return "A technician has been assigned. The visit hasn't been scheduled yet.";
    if (!showVisit) return "A technician visit is scheduled, and your asset manager will confirm the exact time with you.";
    const time = visitTime(w, clock);
    return `A technician visit is scheduled for ${day(when)}${time ? `, ${time}` : ""}.`;
  },
  in_progress: () => "The work is in progress.",
  completed: (w, day) => (w.completedAt ? `The work was completed on ${day(w.completedAt)}.` : "The work has been completed."),
  reviewed_closed: (w, day) =>
    w.completedAt ? `The work was completed on ${day(w.completedAt)}, and it's now closed.` : "The work has been completed and closed.",
  cancelled: () => "The work order for it was cancelled. Your asset manager can tell you more.",
};

export type StatusItem = {
  /** Opaque reference for a follow-up call ("MR-1042" / "WO-2051"). Never read out. */
  ref: string;
  requestId: string | null;
  workOrderId: string | null;
  summary: string;
  reportedAt: number;
  status: string; // the plain-English sentence
  statusKey: string; // "request:new", "work_order:assigned", ...
  open: boolean;
  /** The scheduled visit date, only when the caller may hear it (showVisit) and one is set. */
  visitDate: number | null;
  /** When it closed (finished items only); what the 30-day window is measured from. */
  closedAt: number | null;
  /** Text used only to rank against the caller's description; never returned. */
  matchText: string;
};

const ISSUE_LABELS: Record<string, string> = {
  electrical: "electrical",
  water_leak: "water leak",
  broken_item: "broken item",
  gas: "gas",
  fire: "fire",
  flooding: "flooding",
  tenant_responsibility: "tenant responsibility",
  other: "maintenance",
};

/** A short, speakable summary: the title, else the issue type. Control characters stripped. */
function summaryOf(title: string | undefined, issueType: string): string {
  const clean = (title ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const base = clean || `${ISSUE_LABELS[issueType] ?? "maintenance"} request`;
  return base.length > 80 ? `${base.slice(0, 77).trimEnd()}...` : base;
}

export type BuildResult = { ok: true; items: StatusItem[]; total: number } | { ok: false; reason: "unknown_status"; statusKey: string };

/**
 * The unit's requests and work orders as items: one per request (described by its newest work
 * order once there is one), plus one per work order with no request (made by hand). Kept: every
 * open item, and finished ones closed in the last STATUS_WINDOW_DAYS. Newest first, at most
 * MAX_STATUS_ITEMS. Any status value not mapped above fails the whole answer closed.
 */
export function buildStatusItems(
  requests: ReadonlyArray<RequestLike>,
  workOrders: ReadonlyArray<WorkOrderLike>,
  now: number,
  day: DateFormatter,
  /** May the visit day, date and time be read for this request (null = a hand-made work order)? */
  showVisitFor: (requestId: string | null) => boolean = () => false,
  /** "1:00 PM" in the team's zone, for a picked window's times. */
  clock?: DateFormatter,
): BuildResult {
  const since = now - STATUS_WINDOW_DAYS * DAY_MS;
  const requestIds = new Set(requests.map((r) => r.id));
  const byRequest = new Map<string, WorkOrderLike[]>();
  for (const w of workOrders) {
    if (w.requestId && requestIds.has(w.requestId)) {
      byRequest.set(w.requestId, [...(byRequest.get(w.requestId) ?? []), w]);
    }
  }
  const items: StatusItem[] = [];

  const fromWorkOrder = (w: WorkOrderLike, r: RequestLike | null): StatusItem | { unknown: string } => {
    const text = Object.prototype.hasOwnProperty.call(WORK_ORDER_STATUS_TEXT, w.status) ? WORK_ORDER_STATUS_TEXT[w.status] : undefined;
    if (!text) return { unknown: `work_order:${w.status}` };
    const open = !DONE_WORK_ORDER.has(w.status);
    const showVisit = showVisitFor(r?.id ?? null);
    return {
      ref: r ? `MR-${r.number}` : `WO-${w.number}`,
      requestId: r?.id ?? null,
      workOrderId: w.id,
      summary: summaryOf(r?.title ?? w.title, r?.issueType ?? "other"),
      reportedAt: r?.createdAt ?? w.createdAt,
      status: text(w, day, showVisit, clock),
      statusKey: `work_order:${w.status}`,
      open,
      visitDate: showVisit && w.status === "assigned" ? (visitDay(w) ?? null) : null,
      closedAt: open ? null : (w.closedAt ?? w.completedAt ?? w.updatedAt),
      matchText: `${r?.title ?? ""} ${r?.description ?? ""} ${w.title} ${ISSUE_LABELS[r?.issueType ?? ""] ?? ""}`,
    };
  };

  for (const r of requests) {
    if (!Object.prototype.hasOwnProperty.call(REQUEST_STATUS_TEXT, r.status)) {
      return { ok: false, reason: "unknown_status", statusKey: `request:${r.status}` };
    }
    // A request reopened after its work order was cancelled is described by its own (open) status.
    const wos = (byRequest.get(r.id) ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
    if (r.status === "work_order_created") {
      if (wos.length === 0) return { ok: false, reason: "unknown_status", statusKey: "request:work_order_created_without_work_order" };
      const item = fromWorkOrder(wos[0], r);
      if ("unknown" in item) return { ok: false, reason: "unknown_status", statusKey: item.unknown };
      items.push(item);
      continue;
    }
    const open = OPEN_REQUEST.has(r.status);
    const status = r.status === "closed_out_of_scope" ? closedText(r.closeReason) : REQUEST_STATUS_TEXT[r.status]!;
    items.push({
      ref: `MR-${r.number}`,
      requestId: r.id,
      workOrderId: null,
      summary: summaryOf(r.title, r.issueType),
      reportedAt: r.createdAt,
      status,
      statusKey: `request:${r.status}`,
      open,
      visitDate: null,
      closedAt: open ? null : r.updatedAt,
      matchText: `${r.title ?? ""} ${r.description} ${ISSUE_LABELS[r.issueType] ?? ""}`,
    });
  }
  // Work orders made by hand, with no request behind them.
  for (const w of workOrders) {
    if (w.requestId && requestIds.has(w.requestId)) continue;
    const item = fromWorkOrder(w, null);
    if ("unknown" in item) return { ok: false, reason: "unknown_status", statusKey: item.unknown };
    items.push(item);
  }

  const kept = items.filter((i) => i.open || (i.closedAt ?? 0) >= since);
  kept.sort((a, b) => Number(b.open) - Number(a.open) || b.reportedAt - a.reportedAt);
  return { ok: true, items: kept.slice(0, MAX_STATUS_ITEMS), total: kept.length };
}

// --- 3. Which one is the caller asking about? ----------------------------------------------------

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "was", "were", "are", "about",
  "my", "our", "its", "not", "but", "they", "them", "there", "been", "since", "still", "again",
  "issue", "problem", "request", "work", "order", "repair", "maintenance", "called", "reported",
  "unit", "apartment", "some", "someone", "just", "like", "really", "getting", "doesnt", "dont",
  "isnt", "wont", "cant", "working", "broken", "fixed", "fix",
]);

function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/**
 * The ref of the one item whose words best overlap the caller's description, or null when none
 * does or two tie. Only a hint: Sarah still confirms it with the caller.
 */
export function rankByIssue(items: ReadonlyArray<Pick<StatusItem, "ref" | "matchText">>, issueDescription: string | undefined | null): string | null {
  const said = stems(issueDescription ?? "");
  if (said.size === 0 || items.length === 0) return null;
  const scored = items
    .map((i) => {
      const have = stems(i.matchText);
      let n = 0;
      for (const s of said) if (have.has(s)) n++;
      return { ref: i.ref, n };
    })
    .sort((a, b) => b.n - a.n);
  if (scored[0].n === 0) return null;
  if (scored.length > 1 && scored[1].n === scored[0].n) return null;
  return scored[0].ref;
}
