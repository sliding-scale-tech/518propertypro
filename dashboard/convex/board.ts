import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { currentOrg, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { amScope } from "./amScope";
import type { AmScope } from "./amScope";
import { scopedByStatus } from "./maintenance";
import { addMonths, localDateKey, monthKeyOf, startOfLocalDay } from "./tourSchedule";

/**
 * The unified Work orders board: one board, two records. A maintenance request and a work order
 * stay separate tables (PRD 6.3/6.4) but are cards in successive lanes of one flow:
 *
 *   review   requests new / under_review / more_info_needed   (asset manager)
 *   pat      requests forwarded_to_pat                        (maintenance lead)
 *   tech     work orders created / assigned / in_progress     (technician)
 *   signoff  work orders completed                            (maintenance lead reviews)
 *
 * A request that already has a work order is closed (work_order_created), so it never appears
 * as an open request: it shows only as its work order.
 *
 * Scope is derived server-side exactly like maintenance.ts / workOrders.ts: the admin view sees
 * the team, an asset manager only requests assigned to them and work orders on their units,
 * everyone else gets nothing. Reads are capped (CAP) so the board stays one cheap round trip.
 */

const CAP = 300;
const REVIEW_STATUSES = ["new", "under_review", "more_info_needed"] as const;
const OPEN_REQUEST_STATUSES = [...REVIEW_STATUSES, "forwarded_to_pat"] as const;
const OPEN_WO_STATUSES = ["created", "assigned", "in_progress", "completed"] as const;

export type Lane = "review" | "pat" | "tech" | "signoff";
type Severity = Doc<"maintenanceRequests">["severity"];

const SEVERITY_RANK: Record<Severity, number> = { emergency: 0, urgent: 1, routine: 2, informational: 3 };

export function boardViewOf(org: OrgContext): "admin" | "asset_manager" | null {
  const view = viewFor(org.isAdmin, org.jobRoles);
  return view === "admin" || view === "asset_manager" ? view : null;
}

export function userName(u: Doc<"users"> | null | undefined): string {
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown";
}

/** Small per-call cache so a card list does one read per distinct unit / property / user. */
export function makeLookups(ctx: QueryCtx) {
  const units = new Map<string, Doc<"units"> | null>();
  const properties = new Map<string, string>();
  const users = new Map<string, string>();
  return {
    unit: async (id: Id<"units"> | undefined) => {
      if (!id) return null;
      if (!units.has(id)) units.set(id, await ctx.db.get(id));
      return units.get(id) ?? null;
    },
    property: async (id: Id<"properties"> | undefined) => {
      if (!id) return undefined;
      if (!properties.has(id)) properties.set(id, (await ctx.db.get(id))?.name ?? "Unknown");
      return properties.get(id);
    },
    user: async (id: Id<"users"> | undefined) => {
      if (!id) return undefined;
      if (!users.has(id)) users.set(id, userName(await ctx.db.get(id)));
      return users.get(id);
    },
  };
}
export type Lookups = ReturnType<typeof makeLookups>;

/** Open requests and active work orders in the viewer's scope. */
export async function loadScope(ctx: QueryCtx, org: OrgContext) {
  const view = boardViewOf(org);
  const requests: Doc<"maintenanceRequests">[] = [];
  const wos: Doc<"workOrders">[] = [];
  // Managed + covered units for an asset manager (empty sets for the admin view, which reads all).
  const scope: AmScope = view === "asset_manager" ? await amScope(ctx, org) : { managed: new Set(), covering: new Set(), coveringFor: [] };
  if (!view) return { view, requests, wos, scope };

  for (const s of OPEN_REQUEST_STATUSES) requests.push(...(await scopedByStatus(ctx, org, s, CAP, scope)));

  if (view === "admin") {
    for (const s of OPEN_WO_STATUSES) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
          .order("desc")
          .take(CAP)),
      );
    }
  } else {
    for (const unitId of [...scope.managed, ...scope.covering]) {
      const rows = await ctx.db
        .query("workOrders")
        .withIndex("by_unit", (q) => q.eq("unitId", unitId))
        .order("desc")
        .take(100);
      wos.push(...rows.filter((w) => (OPEN_WO_STATUSES as readonly string[]).includes(w.status)));
    }
  }
  return { view, requests, wos: wos.filter((w) => w.orgId === org.orgId), scope };
}

export function requestLane(r: Doc<"maintenanceRequests">): Lane {
  return r.status === "forwarded_to_pat" ? "pat" : "review";
}
export function workOrderLane(w: Doc<"workOrders">): Lane {
  return w.status === "completed" ? "signoff" : "tech";
}

function requestStage(r: Doc<"maintenanceRequests">): string {
  if (r.status === "more_info_needed") return "Photos requested";
  if (r.status === "forwarded_to_pat") return "Waiting on maintenance lead";
  if (r.status === "under_review") return r.validatedAt ? "Validated" : "In review";
  return "New";
}
function workOrderStage(w: Doc<"workOrders">): string {
  if (w.status === "completed") return "Needs sign-off";
  if (w.status === "in_progress") return "In progress";
  if (w.status === "assigned") return "Assigned";
  return "Unassigned";
}

function oneLine(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type Card = {
  kind: "request" | "work_order";
  id: string;
  number: number;
  title: string;
  severity: Severity;
  severityScore: number | null;
  propertyName: string | null;
  unitNumber: string | null;
  tenantName: string | null;
  lane: Lane;
  stage: string; // raw status
  stagePill: string; // human label for the card pill
  avatar: { userId: Id<"users">; name: string; role: "asset_manager" | "technician" } | null;
  checklistDone: number;
  checklistTotal: number;
  needsPhotos: boolean;
  window: string | null;
  inException: boolean;
  // Asset-manager view only: true when the card is on a colleague's unit this person covers (read-only).
  covering?: boolean;
  createdAt: number;
};

export async function requestCard(L: Lookups, r: Doc<"maintenanceRequests">): Promise<Card> {
  const unit = await L.unit(r.unitId);
  const amId = r.assignedAssetManagerUserId;
  return {
    kind: "request",
    id: r._id,
    number: r.number,
    title: oneLine(r.description),
    severity: r.severity,
    severityScore: r.severityScore ?? null,
    propertyName: (await L.property(r.propertyId)) ?? null,
    unitNumber: unit?.unitNumber ?? r.spokenUnit ?? null,
    tenantName: r.callerName ?? null,
    lane: requestLane(r),
    stage: r.status,
    stagePill: requestStage(r),
    avatar: amId ? { userId: amId, name: (await L.user(amId)) ?? "Unknown", role: "asset_manager" } : null,
    checklistDone: 0,
    checklistTotal: 0,
    needsPhotos: r.status === "more_info_needed",
    window: null,
    inException: r.inExceptionQueue,
    createdAt: r.createdAt,
  };
}

export async function workOrderCard(ctx: QueryCtx, L: Lookups, w: Doc<"workOrders">): Promise<Card> {
  const request = w.requestId ? await ctx.db.get(w.requestId) : null;
  const techId = w.technicianUserId;
  return {
    kind: "work_order",
    id: w._id,
    number: w.number,
    title: oneLine(w.title),
    severity: w.priority,
    severityScore: request?.severityScore ?? null,
    propertyName: (await L.property(w.propertyId)) ?? null,
    unitNumber: (await L.unit(w.unitId))?.unitNumber ?? null,
    tenantName: request?.callerName ?? null,
    lane: workOrderLane(w),
    stage: w.status,
    stagePill: workOrderStage(w),
    avatar: techId ? { userId: techId, name: (await L.user(techId)) ?? "Unknown", role: "technician" } : null,
    checklistDone: w.checklist.filter((c) => c.done).length,
    checklistTotal: w.checklist.length,
    needsPhotos: false,
    window: w.window ?? null,
    inException: false,
    createdAt: w.createdAt,
  };
}

const bySeverityThenOldest = (a: Card, b: Card) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt;

/** Calendar-month bounds in the team's time zone. offset 0 = this month, -1 = last month. */
async function periodBounds(ctx: QueryCtx, org: OrgContext, period: "this_month" | "last_month") {
  const timeZone = (await ctx.db.get(org.orgId))?.timeZone ?? "UTC";
  const month = addMonths(monthKeyOf(localDateKey(Date.now(), timeZone)), period === "last_month" ? -1 : 0);
  return {
    start: startOfLocalDay(`${month}-01`, timeZone),
    end: startOfLocalDay(`${addMonths(month, 1)}-01`, timeZone),
    month,
  };
}

/** Rejected requests and finished / cancelled work orders in the period, with hours and materials. */
async function loadClosed(
  ctx: QueryCtx,
  org: OrgContext,
  L: Lookups,
  start: number,
  end: number,
  view: "admin" | "asset_manager" | "accountant",
  scope?: AmScope,
) {
  const rows: Array<{
    kind: "request" | "work_order";
    id: string;
    number: number;
    title: string;
    unitNumber: string | null;
    propertyId: Id<"properties"> | null;
    propertyName: string | null;
    outcome: "Closed" | "Rejected" | "Cancelled";
    reason: string | null;
    hours: number;
    materialsCents: number;
    closedAt: number;
  }> = [];

  for (const s of ["closed_out_of_scope", "closed_duplicate"] as const) {
    const found = await scopedByStatus(ctx, org, s, CAP, scope);
    for (const r of found) {
      if (r.updatedAt < start || r.updatedAt >= end) continue;
      rows.push({
        kind: "request",
        id: r._id,
        number: r.number,
        title: oneLine(r.description),
        unitNumber: (await L.unit(r.unitId))?.unitNumber ?? r.spokenUnit ?? null,
        propertyId: r.propertyId ?? null,
        propertyName: (await L.property(r.propertyId)) ?? null,
        outcome: "Rejected",
        reason: r.closeReason ?? null,
        hours: 0,
        materialsCents: 0,
        closedAt: r.updatedAt,
      });
    }
  }

  const woRows: Doc<"workOrders">[] = [];
  if (view === "admin" || view === "accountant") {
    // Accountants see finished work only (reviewed_closed), never cancelled orders.
    for (const s of (view === "accountant" ? ["reviewed_closed"] : ["reviewed_closed", "cancelled"]) as Array<"reviewed_closed" | "cancelled">) {
      woRows.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
          .order("desc")
          .take(CAP)),
      );
    }
  } else {
    const sc = scope ?? (await amScope(ctx, org));
    for (const unitId of [...sc.managed, ...sc.covering]) {
      const found = await ctx.db
        .query("workOrders")
        .withIndex("by_unit", (q) => q.eq("unitId", unitId))
        .order("desc")
        .take(100);
      woRows.push(...found.filter((w) => w.status === "reviewed_closed" || w.status === "cancelled"));
    }
  }
  for (const w of woRows) {
    if (w.orgId !== org.orgId) continue;
    const at = w.status === "reviewed_closed" ? (w.closedAt ?? w.updatedAt) : w.updatedAt;
    if (at < start || at >= end) continue;
    const [time, expenses] = await Promise.all([
      ctx.db.query("workOrderTime").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(200),
      ctx.db.query("workOrderExpenses").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(200),
    ]);
    rows.push({
      kind: "work_order",
      id: w._id,
      number: w.number,
      title: oneLine(w.title),
      unitNumber: (await L.unit(w.unitId))?.unitNumber ?? null,
      propertyId: w.propertyId,
      propertyName: (await L.property(w.propertyId)) ?? null,
      outcome: w.status === "reviewed_closed" ? "Closed" : "Cancelled",
      reason: w.cancelReason ?? null,
      hours: time.reduce((sum, t) => sum + t.hours, 0),
      materialsCents: expenses.filter((e) => e.kind === "material").reduce((sum, e) => sum + e.amountCents, 0),
      closedAt: at,
    });
  }
  rows.sort((a, b) => b.closedAt - a.closedAt);
  return rows;
}

const EMPTY_BOARD = {
  lanes: { review: [] as Card[], pat: [] as Card[], tech: [] as Card[], signoff: [] as Card[] },
  maintenanceLeads: [] as Array<{ userId: Id<"users">; name: string }>,
  closedThisMonth: {
    rows: [] as Awaited<ReturnType<typeof loadClosed>>,
    totals: { count: 0, hours: 0, materialsCents: 0 },
  },
  exceptions: { count: 0, top: [] as Array<Record<string, unknown>> },
  scope: "none" as "none" | "admin" | "asset_manager" | "accountant",
};

/**
 * The board. Filters: propertyId (both views), assetManagerUserId (admin view only; an asset
 * manager is always limited to their own units, whatever they pass). `period` picks the month
 * for the closed table (default this month).
 */
export const lanes = query({
  args: {
    propertyId: v.optional(v.id("properties")),
    assetManagerUserId: v.optional(v.id("users")),
    period: v.optional(v.union(v.literal("this_month"), v.literal("last_month"))),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return EMPTY_BOARD;

    // Accountant: read-only. Only the sign-off lane (completed work) and the closed table, the same
    // finished-work scope workOrders.readable allows. No requests, tenant names, exceptions or leads.
    if (viewFor(org.isAdmin, org.jobRoles) === "accountant") {
      const L = makeLookups(ctx);
      const done = await ctx.db
        .query("workOrders")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", "completed"))
        .order("desc")
        .take(CAP);
      const signoff: Card[] = [];
      for (const w of done) {
        if (w.orgId !== org.orgId) continue;
        if (args.propertyId && w.propertyId !== args.propertyId) continue;
        signoff.push({ ...(await workOrderCard(ctx, L, w)), tenantName: null, severityScore: null });
      }
      signoff.sort(bySeverityThenOldest);
      const { start, end } = await periodBounds(ctx, org, args.period ?? "this_month");
      let closed = (await loadClosed(ctx, org, L, start, end, "accountant")).filter((c) => c.kind === "work_order");
      if (args.propertyId) closed = closed.filter((c) => c.propertyId === args.propertyId);
      return {
        ...EMPTY_BOARD,
        lanes: { review: [] as Card[], pat: [] as Card[], tech: [] as Card[], signoff },
        closedThisMonth: {
          rows: closed,
          totals: {
            count: closed.length,
            hours: closed.reduce((s, c) => s + c.hours, 0),
            materialsCents: closed.reduce((s, c) => s + c.materialsCents, 0),
          },
        },
        scope: "accountant" as const,
      };
    }

    const { view, requests, wos, scope } = await loadScope(ctx, org);
    if (!view) return EMPTY_BOARD;

    const L = makeLookups(ctx);
    const amFilter = view === "admin" ? args.assetManagerUserId : undefined;

    // Property and AM filters; a work order's AM is its unit's AM.
    const keepRequest = (r: Doc<"maintenanceRequests">) => {
      if (args.propertyId && r.propertyId !== args.propertyId) return false;
      if (amFilter && r.assignedAssetManagerUserId !== amFilter) return false;
      return true;
    };
    const keepWo = async (w: Doc<"workOrders">) => {
      if (args.propertyId && w.propertyId !== args.propertyId) return false;
      if (amFilter && (await L.unit(w.unitId))?.assetManagerUserId !== amFilter) return false;
      return true;
    };

    const cards: Card[] = [];
    for (const r of requests.filter(keepRequest)) {
      cards.push({ ...(await requestCard(L, r)), covering: !!r.unitId && scope.covering.has(r.unitId) });
    }
    for (const w of wos) {
      if (await keepWo(w)) cards.push({ ...(await workOrderCard(ctx, L, w)), covering: scope.covering.has(w.unitId) });
    }

    const grouped = { review: [] as Card[], pat: [] as Card[], tech: [] as Card[], signoff: [] as Card[] };
    for (const c of cards) grouped[c.lane].push(c);
    for (const lane of Object.keys(grouped) as Lane[]) grouped[lane].sort(bySeverityThenOldest);

    // Exceptions: open requests that could not be routed safely. Admin view only (Pat resolves them).
    const exceptionRequests =
      view === "admin" ? requests.filter((r) => r.inExceptionQueue).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt) : [];
    const top = [];
    for (const r of exceptionRequests.slice(0, 5)) {
      top.push({
        id: r._id,
        number: r.number,
        title: oneLine(r.description),
        severity: r.severity,
        routeReason: r.routeReason ?? null,
        spokenUnit: r.spokenUnit ?? null,
        propertyName: (await L.property(r.propertyId)) ?? null,
        createdAt: r.createdAt,
      });
    }

    const { start, end } = await periodBounds(ctx, org, args.period ?? "this_month");
    let closed = await loadClosed(ctx, org, L, start, end, view, scope);
    if (args.propertyId) closed = closed.filter((c) => c.propertyId === args.propertyId);

    // Maintenance leads, so the lane title can name the person when there is exactly one.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const leads = [];
    for (const m of memberships) {
      if ((m.jobRoles ?? []).includes("maintenance_lead")) {
        leads.push({ userId: m.userId, name: (await L.user(m.userId)) ?? "Unknown" });
      }
    }

    return {
      lanes: grouped,
      maintenanceLeads: leads,
      closedThisMonth: {
        rows: closed,
        totals: {
          count: closed.length,
          hours: closed.reduce((s, c) => s + c.hours, 0),
          materialsCents: closed.reduce((s, c) => s + c.materialsCents, 0),
        },
      },
      exceptions: { count: exceptionRequests.length, top },
      scope: view,
    };
  },
});

/**
 * Cheap per-lane counts for the sidebar badge (no joins, no per-row reads), scoped like the board.
 * exceptions is admin view only.
 */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const zero = { review: 0, pat: 0, tech: 0, signoff: 0, exceptions: 0 };
    const org = await currentOrg(ctx);
    if (!org) return zero;
    const { view, requests, wos } = await loadScope(ctx, org);
    if (!view) return zero;
    return {
      review: requests.filter((r) => requestLane(r) === "review").length,
      pat: requests.filter((r) => requestLane(r) === "pat").length,
      tech: wos.filter((w) => workOrderLane(w) === "tech").length,
      signoff: wos.filter((w) => workOrderLane(w) === "signoff").length,
      exceptions: view === "admin" ? requests.filter((r) => r.inExceptionQueue).length : 0,
    };
  },
});
