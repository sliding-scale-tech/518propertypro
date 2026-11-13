import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { canManageMaintenance, currentOrg, hasRole, isAdminView, requireOrg } from "./authz";
import type { OrgContext } from "./authz";
import { amScope, canSeeUnit } from "./amScope";
import type { AmScope } from "./amScope";
import {
  addRequestNote,
  attachableRequest,
  attachRequestMedia,
  canAct,
  canAttachMedia,
  canRead,
  canRemoveRequestMedia,
  closureOf,
  isAssetManager,
  scopedByStatus,
  scopeOf,
} from "./maintenance";
import {
  addWorkOrderNote,
  attachableJob,
  attachWorkOrderFile,
  canAttachWoMedia,
  canManageWo,
  canRemoveWoFile,
  deleteStorageIfUnreferenced,
  removeWoFileRow,
  woFileIsDocument,
  expensesTabFor,
  readable as readableWorkOrder,
  woReach,
} from "./workOrders";
import { writeAudit } from "./audit";
import { addMonths, localDateKey, monthKeyOf, startOfLocalDay } from "./tourSchedule";
import { tenantPreferredTimeText } from "./workOrderWindow";
import { billingView } from "./workOrderBilling";

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

/**
 * The board's scope: the admin view (team), or the asset manager's units for anyone HOLDING the
 * asset manager role (B31: whatever else they hold); null for everyone else.
 */
export function boardViewOf(org: OrgContext): "admin" | "asset_manager" | null {
  if (isAdminView(org)) return "admin";
  return hasRole(org, "asset_manager") ? "asset_manager" : null;
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
    mediaCount: async (requestId: Id<"maintenanceRequests">) => {
      const rows = await ctx.db
        .query("maintenanceMedia")
        .withIndex("by_request", (q) => q.eq("requestId", requestId))
        .take(30);
      return rows.length;
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
  needsPhotos: boolean;
  window: string | null;
  inException: boolean;
  // Asset-manager view only: true when the card is on a colleague's unit this person covers (read-only).
  covering?: boolean;
  createdAt: number;
  dueDate?: number | null;
  commentCount?: number;
  attachmentCount?: number;
};

export async function requestCard(L: Lookups, r: Doc<"maintenanceRequests">): Promise<Card> {
  const unit = await L.unit(r.unitId);
  const amId = r.assignedAssetManagerUserId;
  return {
    kind: "request",
    id: r._id,
    number: r.number,
    title: oneLine(r.title?.trim() || r.description),
    severity: r.severity,
    severityScore: r.severityScore ?? null,
    propertyName: (await L.property(r.propertyId)) ?? null,
    unitNumber: unit?.unitNumber ?? r.spokenUnit ?? null,
    tenantName: r.callerName ?? null,
    lane: requestLane(r),
    stage: r.status,
    stagePill: requestStage(r),
    avatar: amId ? { userId: amId, name: (await L.user(amId)) ?? "Unknown", role: "asset_manager" } : null,
    needsPhotos: r.status === "more_info_needed",
    window: null,
    inException: r.inExceptionQueue,
    createdAt: r.createdAt,
    dueDate: null,
    commentCount: 0,
    attachmentCount: await L.mediaCount(r._id),
  };
}

export async function workOrderCard(ctx: QueryCtx, L: Lookups, w: Doc<"workOrders">): Promise<Card> {
  const request = w.requestId ? await ctx.db.get(w.requestId) : null;
  const techId = w.technicianUserId;
  const [notes, files] = await Promise.all([
    ctx.db.query("workOrderNotes").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(30),
    ctx.db.query("workOrderFiles").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(30),
  ]);
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
    needsPhotos: false,
    window: w.window ?? null,
    inException: false,
    createdAt: w.createdAt,
    dueDate: w.dueDate ?? null,
    commentCount: notes.length,
    attachmentCount: files.length,
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
        title: oneLine(r.title?.trim() || r.description),
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
    // An asset manager + accountant gets the asset manager's board (legacy query, no client uses it).
    if (hasRole(org, "accountant") && !boardViewOf(org)) {
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
        title: oneLine(r.title?.trim() || r.description),
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

// =====================================================================================
// Figma Work Orders screens: kanban (5 columns), table, drawer detail, comments, media.
// Same scoping as the legacy lanes above: admin view = team, asset manager = own + covered
// units (covered = read-only), everyone else gets nothing.
// =====================================================================================

const priorityLevelValidator = v.union(
  v.literal("emergency"),
  v.literal("urgent"),
  v.literal("routine"),
  v.literal("informational"),
);
const kindValidator = v.union(v.literal("request"), v.literal("work_order"));
const MAX_BOARD_NOTE = 1000;

export type StatusKey =
  | "am_review"
  | "admin_review"
  | "escalated"
  | "in_progress"
  | "completed"
  | "closed"
  | "rejected";

export const STATUS_LABEL: Record<StatusKey, string> = {
  am_review: "Asset Manager Review",
  admin_review: "Admin Review",
  escalated: "Escalated",
  in_progress: "Work in Progress",
  completed: "Completed (Needs Sign Off)",
  closed: "Closed",
  rejected: "Rejected as Out of Scope",
};

/** Status label rule for a request. null = it has a work order and shows only as that work order. */
export function requestStatusKey(r: Doc<"maintenanceRequests">): StatusKey | null {
  switch (r.status) {
    case "new":
    case "under_review":
    case "more_info_needed":
      return "am_review";
    case "forwarded_to_pat":
      return r.severity === "emergency" || r.severity === "urgent" ? "escalated" : "admin_review";
    case "closed_out_of_scope":
    case "closed_duplicate":
      return "rejected";
    case "work_order_created":
      return null;
  }
}

/** Status label rule for a work order (a cancelled one reads as Closed; the raw status tells them apart). */
export function workOrderStatusKey(w: Doc<"workOrders">): StatusKey {
  switch (w.status) {
    case "created":
    case "assigned":
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "reviewed_closed":
    case "cancelled":
      return "closed";
  }
}

type Assignee = { userId: Id<"users">; name: string; role: "asset_manager" | "technician" };

type Item = {
  kind: "request" | "work_order";
  id: string;
  numberRaw: number;
  number: string;
  title: string;
  propertyId: Id<"properties"> | null;
  propertyName: string | null;
  unitNumber: string | null;
  priorityLevel: Severity;
  severityScore: number | null;
  createdAt: number;
  assignee: Assignee | null;
  statusKey: StatusKey;
  statusLabel: string;
  status: string; // raw status
  dueDate: number | null;
  covering: boolean;
  needsPhotos: boolean;
  technicianUserId: Id<"users"> | null;
  assetManagerUserId: Id<"users"> | null;
  src: { kind: "request"; r: Doc<"maintenanceRequests"> } | { kind: "work_order"; w: Doc<"workOrders"> };
};

async function requestItem(L: Lookups, scope: AmScope, r: Doc<"maintenanceRequests">, key: StatusKey): Promise<Item> {
  const amId = r.assignedAssetManagerUserId;
  return {
    kind: "request",
    id: r._id,
    numberRaw: r.number,
    number: `MR-${r.number}`,
    title: oneLine(r.title?.trim() || r.description),
    propertyId: r.propertyId ?? null,
    propertyName: (await L.property(r.propertyId)) ?? null,
    unitNumber: (await L.unit(r.unitId))?.unitNumber ?? r.spokenUnit ?? null,
    priorityLevel: r.severity,
    severityScore: r.severityScore ?? null,
    createdAt: r.createdAt,
    // Review cards show the asset manager; an escalated request has no technician yet ("Unassigned").
    assignee: amId && key !== "escalated" ? { userId: amId, name: (await L.user(amId)) ?? "Unknown", role: "asset_manager" } : null,
    statusKey: key,
    statusLabel: STATUS_LABEL[key],
    status: r.status,
    dueDate: null,
    covering: !!r.unitId && scope.covering.has(r.unitId),
    needsPhotos: r.status === "more_info_needed",
    technicianUserId: null,
    assetManagerUserId: amId ?? null,
    src: { kind: "request", r },
  };
}

async function workOrderItem(ctx: QueryCtx, L: Lookups, scope: AmScope, w: Doc<"workOrders">): Promise<Item> {
  const key = workOrderStatusKey(w);
  const request = w.requestId ? await ctx.db.get(w.requestId) : null;
  const unit = await L.unit(w.unitId);
  const techId = w.technicianUserId;
  return {
    kind: "work_order",
    id: w._id,
    numberRaw: w.number,
    number: `WO-${w.number}`,
    title: oneLine(w.title),
    propertyId: w.propertyId,
    propertyName: (await L.property(w.propertyId)) ?? null,
    unitNumber: unit?.unitNumber ?? null,
    priorityLevel: w.priority,
    severityScore: request?.severityScore ?? null,
    createdAt: w.createdAt,
    assignee: techId ? { userId: techId, name: (await L.user(techId)) ?? "Unknown", role: "technician" } : null,
    statusKey: key,
    statusLabel: STATUS_LABEL[key],
    status: w.status,
    dueDate: w.dueDate ?? null,
    covering: scope.covering.has(w.unitId),
    needsPhotos: false,
    technicianUserId: techId ?? null,
    assetManagerUserId: unit?.assetManagerUserId ?? null,
    src: { kind: "work_order", w },
  };
}

/** Everything in the viewer's scope as normalized items. includeClosed adds closed/rejected/cancelled. */
async function loadItems(ctx: QueryCtx, org: OrgContext, includeClosed: boolean) {
  const base = await loadScope(ctx, org);
  const { view, scope } = base;
  const L = makeLookups(ctx);
  if (!view) return { view, scope, L, items: [] as Item[], capped: false };

  const requests = [...base.requests];
  const wos = [...base.wos];
  if (includeClosed) {
    for (const s of ["closed_out_of_scope", "closed_duplicate"] as const) {
      requests.push(...(await scopedByStatus(ctx, org, s, CAP, scope)));
    }
    if (view === "admin") {
      for (const s of ["reviewed_closed", "cancelled"] as const) {
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
        wos.push(
          ...rows.filter((w) => w.orgId === org.orgId && (w.status === "reviewed_closed" || w.status === "cancelled")),
        );
      }
    }
  }

  const items: Item[] = [];
  for (const r of requests) {
    const key = requestStatusKey(r);
    if (key) items.push(await requestItem(L, scope, r, key));
  }
  for (const w of wos) items.push(await workOrderItem(ctx, L, scope, w));
  // Each status is read up to CAP rows, newest first. When a status filled its read, older items
  // of that status are not on the board: say so instead of presenting the total as complete.
  const perStatus = new Map<string, number>();
  for (const r of requests) perStatus.set(`r:${r.status}`, (perStatus.get(`r:${r.status}`) ?? 0) + 1);
  for (const w of wos) perStatus.set(`w:${w.status}`, (perStatus.get(`w:${w.status}`) ?? 0) + 1);
  const capped = [...perStatus.values()].some((n) => n >= CAP);
  return { view, scope, L, items, capped };
}

type BoardFilters = {
  search?: string;
  priority?: Severity;
  technicianUserId?: Id<"users">;
  propertyId?: Id<"properties">;
  assetManagerUserId?: Id<"users">;
};

function applyFilters(items: Item[], f: BoardFilters, view: "admin" | "asset_manager"): Item[] {
  const needle = f.search?.trim().toLowerCase();
  return items.filter((i) => {
    if (f.priority && i.priorityLevel !== f.priority) return false;
    if (f.technicianUserId && i.technicianUserId !== f.technicianUserId) return false;
    if (f.propertyId && i.propertyId !== f.propertyId) return false;
    if (view === "admin" && f.assetManagerUserId && i.assetManagerUserId !== f.assetManagerUserId) return false;
    if (needle) {
      const hay = [i.number, String(i.numberRaw), i.title, i.unitNumber, i.propertyName];
      if (!hay.some((h) => h?.toLowerCase().includes(needle))) return false;
    }
    return true;
  });
}

const filterArgs = {
  search: v.optional(v.string()),
  priority: v.optional(priorityLevelValidator),
  technicianUserId: v.optional(v.id("users")),
  propertyId: v.optional(v.id("properties")),
  assetManagerUserId: v.optional(v.id("users")),
};

// --- Kanban --------------------------------------------------------------------------

const KANBAN_COLUMNS: Array<{ key: StatusKey; title: string; subtitle: string }> = [
  { key: "am_review", title: "Asset Manager Review", subtitle: "Requests awaiting the asset manager's review." },
  { key: "admin_review", title: "Admin Review", subtitle: "Forwarded requests awaiting admin review and a work order." },
  { key: "escalated", title: "Escalated", subtitle: "Pending Admin Work Order creation and assignment." },
  { key: "in_progress", title: "Work in Progress", subtitle: "Assigned to technician and actively being worked on." },
  { key: "completed", title: "Completed (Needs Sign Off)", subtitle: "Work completed by technician, awaiting admin sign off." },
];

/** Cards each Kanban column starts with, and the step of "Show 20 more" (client). */
const KANBAN_START = 20;

const emptyKanban = () => ({
  scope: "none" as "none" | "admin" | "asset_manager",
  capped: false,
  cap: CAP,
  columns: KANBAN_COLUMNS.map((c) => ({ ...c, count: 0, cards: [] as KanbanCard[] })),
  exceptions: { count: 0 },
});

export type KanbanCard = Omit<Item, "src" | "status" | "statusKey" | "technicianUserId" | "assetManagerUserId" | "propertyId"> & {
  commentCount: number;
  attachmentCount: number;
};

/**
 * The Figma board: five columns (see KANBAN_COLUMNS). Closed and rejected items are Table only.
 * Filters (all optional): search (title / unit / property / MR-WO number), priority,
 * technicianUserId, propertyId, assetManagerUserId (admin view only). Each column returns `limits[key]`
 * cards (default 20); at most 300 per status are read at all (`capped` says when that bites).
 * Card sort: emergency first, then oldest first.
 */
export const kanban = query({
  args: {
    ...filterArgs,
    // Cards to return per column (key = column key); a column not listed starts at KANBAN_START.
    // The client's "Show 20 more" raises one column's limit. `count` stays the column's full size.
    limits: v.optional(
      v.object({
        am_review: v.optional(v.number()),
        admin_review: v.optional(v.number()),
        escalated: v.optional(v.number()),
        in_progress: v.optional(v.number()),
        completed: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return emptyKanban();
    const { view, items, L, capped } = await loadItems(ctx, org, false);
    if (!view) return emptyKanban();

    const kept = applyFilters(items, args, view);
    const columns = [];
    for (const def of KANBAN_COLUMNS) {
      const inCol = kept
        .filter((i) => i.statusKey === def.key)
        .sort((a, b) => SEVERITY_RANK[a.priorityLevel] - SEVERITY_RANK[b.priorityLevel] || a.createdAt - b.createdAt);
      const cards: KanbanCard[] = [];
      const limit = Math.min(CAP, Math.max(1, Math.floor(args.limits?.[def.key as keyof NonNullable<typeof args.limits>] ?? KANBAN_START)));
      for (const i of inCol.slice(0, limit)) {
        let commentCount = 0;
        let attachmentCount = 0;
        if (i.src.kind === "request") {
          const r = i.src.r;
          const audit = await ctx.db
            .query("auditEvents")
            .withIndex("by_entity", (q) => q.eq("entity", "request").eq("entityId", r._id))
            .take(100);
          commentCount = audit.filter((a) => a.action === "note_added").length;
          attachmentCount = await L.mediaCount(r._id);
        } else {
          const w = i.src.w;
          const [notes, files, reqMedia] = await Promise.all([
            ctx.db.query("workOrderNotes").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(100),
            ctx.db.query("workOrderFiles").withIndex("by_work_order", (q) => q.eq("workOrderId", w._id)).take(40),
            w.requestId ? L.mediaCount(w.requestId) : Promise.resolve(0),
          ]);
          commentCount = notes.length;
          attachmentCount = files.length + reqMedia;
        }
        const { src, status, statusKey, technicianUserId, assetManagerUserId, propertyId, ...card } = i;
        void src;
        void status;
        void statusKey;
        void technicianUserId;
        void assetManagerUserId;
        void propertyId;
        cards.push({ ...card, commentCount, attachmentCount });
      }
      columns.push({ ...def, count: inCol.length, cards });
    }
    return {
      scope: view,
      columns,
      // true: a status holds more than CAP items, so the oldest are not listed (counts too).
      capped,
      cap: CAP,
      exceptions: { count: view === "admin" ? items.filter((i) => i.src.kind === "request" && i.src.r.inExceptionQueue).length : 0 },
    };
  },
});

// --- Table ---------------------------------------------------------------------------

const tableStatusValidator = v.union(
  v.literal("all"),
  v.literal("am_review"),
  v.literal("admin_review"),
  v.literal("escalated"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("closed"), // chip "Closed": statusLabel Closed OR Rejected as Out of Scope
  v.literal("rejected"), // only Rejected as Out of Scope
);

/**
 * The Figma table. Rows = every request not yet turned into a work order plus every work order
 * (a request with a work order appears only as its WO), including closed / rejected / cancelled.
 * Sorted newest first, paged server-side (page is 1-based, default 15 per page, max 100).
 * `counts` ignore the status chip but respect search / priority / technician filters.
 */
export const table = query({
  args: {
    ...filterArgs,
    status: v.optional(tableStatusValidator),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 15)));
    const emptyCounts = { all: 0, am_review: 0, admin_review: 0, escalated: 0, in_progress: 0, completed: 0, closed: 0, rejected: 0 };
    const empty = { rows: [], counts: emptyCounts, total: 0, page: 1, pageSize, pageCount: 1, capped: false, cap: CAP };
    const org = await currentOrg(ctx);
    if (!org) return empty;
    const { view, items, capped } = await loadItems(ctx, org, true);
    if (!view) return empty;

    const kept = applyFilters(items, args, view);
    const counts = { ...emptyCounts, all: kept.length };
    for (const i of kept) {
      counts[i.statusKey] += 1;
      if (i.statusKey === "rejected") counts.closed += 1;
    }
    const status = args.status ?? "all";
    const matching = kept
      .filter((i) => {
        if (status === "all") return true;
        if (status === "closed") return i.statusKey === "closed" || i.statusKey === "rejected";
        return i.statusKey === status;
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const total = matching.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
    const rows = matching.slice((page - 1) * pageSize, page * pageSize).map((i) => ({
      id: i.id,
      kind: i.kind,
      number: i.number,
      numberRaw: i.numberRaw,
      unitNumber: i.unitNumber,
      propertyName: i.propertyName,
      issue: i.title,
      priorityLevel: i.priorityLevel,
      severityScore: i.severityScore,
      statusKey: i.statusKey,
      statusLabel: i.statusLabel,
      status: i.status, // raw, e.g. "cancelled" reads as Closed
      assignee: i.assignee,
      dueDate: i.dueDate,
      createdAt: i.createdAt,
      covering: i.covering,
    }));
    // capped: some status holds more than `cap` items, so the oldest are not in the total.
    return { rows, counts, total, page, pageSize, pageCount, capped, cap: CAP };
  },
});

/**
 * One asset manager's work orders (all statuses) for the admin "Asset managers" profile tab: the
 * same items and filters as `table`, restricted to work orders on units that AM currently
 * manages, with the AM's and the technician's names. The caller must already have checked that
 * `org` is the admin view and that `amUserId` is on this team.
 */
export async function workOrderRowsForAm(
  ctx: QueryCtx,
  org: OrgContext,
  amUserId: Id<"users">,
  args: { search?: string; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 15)));
  const { view, items, L } = await loadItems(ctx, org, true);
  if (view !== "admin") return { rows: [], total: 0, page: 1, pageSize, pageCount: 1 };

  const matching = applyFilters(items, { search: args.search?.slice(0, 100), assetManagerUserId: amUserId }, "admin")
    .filter((i) => i.kind === "work_order")
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = matching.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
  const assetManagerName = (await L.user(amUserId)) ?? "Unknown";
  const rows = matching.slice((page - 1) * pageSize, page * pageSize).map((i) => ({
    id: i.id,
    kind: i.kind,
    number: i.number,
    numberRaw: i.numberRaw,
    unitNumber: i.unitNumber,
    propertyName: i.propertyName,
    issue: i.title,
    priorityLevel: i.priorityLevel,
    severityScore: i.severityScore,
    statusKey: i.statusKey,
    statusLabel: i.statusLabel,
    status: i.status,
    assignee: i.assignee,
    assetManager: { userId: amUserId, name: assetManagerName },
    technician: i.assignee, // for a work order the assignee IS the technician (null = unassigned)
    dueDate: i.dueDate,
    createdAt: i.createdAt,
  }));
  return { rows, total, page, pageSize, pageCount };
}

// --- Drawer detail ---------------------------------------------------------------------

type MediaItem = {
  id: string;
  kind: "photo" | "video";
  url: string | null;
  source: "tenant" | "staff" | "technician";
  uploadedByUserId: Id<"users"> | null;
  createdAt: number;
  canRemove: boolean;
};
type DocItem = {
  id: string;
  name: string;
  type: "pdf" | "image";
  url: string | null;
  createdAt: number;
  uploadedByUserId: Id<"users"> | null;
  canRemove: boolean;
};

/**
 * Everything the drawer shows, for one request or one work order the viewer may read (else null,
 * same answer for missing and out of scope). Admin and asset-manager views only.
 * Tenant phone is redacted (null) unless the viewer can act on the request or has Pat powers.
 */
export const detail = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org || !boardViewOf(org)) return null;
    const L = makeLookups(ctx);
    const person = async (id: Id<"users"> | null | undefined) =>
      id ? { userId: id, name: (await L.user(id)) ?? "Unknown" } : null;

    if (args.kind === "request") {
      const requestId = ctx.db.normalizeId("maintenanceRequests", args.id);
      if (!requestId) return null;
      const req = await ctx.db.get(requestId);
      const scope = await scopeOf(ctx, org);
      if (!req || !canRead(org, req, scope)) return null;

      const [unit, property, auditRaw, mediaRows, linkedWo] = await Promise.all([
        req.unitId ? ctx.db.get(req.unitId) : null,
        req.propertyId ? ctx.db.get(req.propertyId) : null,
        ctx.db.query("auditEvents").withIndex("by_entity", (q) => q.eq("entity", "request").eq("entityId", req._id)).order("desc").take(100),
        ctx.db.query("maintenanceMedia").withIndex("by_request", (q) => q.eq("requestId", req._id)).take(30),
        ctx.db.query("workOrders").withIndex("by_request", (q) => q.eq("requestId", req._id)).order("desc").first(),
      ]);
      const audit = auditRaw.filter((a) => a.orgId === org.orgId);
      const key = requestStatusKey(req) ?? (linkedWo ? workOrderStatusKey(linkedWo) : "closed");
      const acts = canAct(org, req, scope);
      const pat = canManageMaintenance(org);
      const open = req.status === "new" || req.status === "under_review" || req.status === "more_info_needed" || req.status === "forwarded_to_pat";
      const closedReq = req.status === "closed_out_of_scope" || req.status === "closed_duplicate";
      const media: MediaItem[] = await Promise.all(
        mediaRows.map(async (m) => ({
          id: m._id,
          kind: m.kind,
          url: await ctx.storage.getUrl(m.storageId),
          source: m.uploadedBy,
          uploadedByUserId: m.uploadedByUserId ?? null,
          createdAt: m.createdAt,
          canRemove: canRemoveRequestMedia(org, req, scope, m),
        })),
      );
      return {
        kind: "request" as const,
        id: req._id,
        numberRaw: req.number,
        number: `MR-${req.number}`,
        statusKey: key,
        statusLabel: STATUS_LABEL[key],
        status: req.status,
        title: oneLine(req.title?.trim() || req.description, 200),
        description: req.description,
        propertyId: req.propertyId ?? null,
        propertyName: property?.name ?? null,
        unitId: req.unitId ?? null,
        unitNumber: unit?.unitNumber ?? req.spokenUnit ?? null,
        priorityLevel: req.severity,
        severityScore: req.severityScore ?? null,
        priorityReason: req.severityReason ?? null,
        // Work-order format fields Sarah captured (the drawer also reads them via maintenance.get).
        category: req.issueType,
        firstNoticed: req.firstNoticed ?? null,
        pets: req.pets ?? null,
        preferredAccessTimes: req.preferredAccessTimes ?? null,
        tenantPreferredTime: tenantPreferredTimeText(req.preferredAccessTimes) ?? null,
        answers: req.answers,
        nameMatchesResident: req.nameMatchesResident ?? null,
        conversationId: req.conversationId ?? null,
        inExceptionQueue: req.inExceptionQueue,
        window: null as string | null,
        windowStart: null as number | null,
        windowEnd: null as number | null,
        dueDate: null as number | null,
        technician: null as { userId: Id<"users">; name: string } | null,
        assetManager: await person(req.assignedAssetManagerUserId),
        createdAt: req.createdAt,
        tenant: {
          name: req.callerName ?? null,
          phone: acts || pat ? (req.callbackNumber ?? req.callerNumber ?? null) : null,
        },
        media,
        documents: [] as DocItem[],
        comments: audit
          .filter((a) => a.action === "note_added")
          .map((a) => ({ id: a._id, at: a.at, authorName: a.actorLabel, body: a.note ?? "" })),
        timeline: audit.map((a) => ({ id: a._id, at: a.at, actorName: a.actorLabel, action: a.action, from: a.from ?? null, to: a.to ?? null, note: a.note ?? null })),
        closure: closureOf(req, audit),
        workOrder: linkedWo ? { id: linkedWo._id, number: `WO-${linkedWo.number}`, status: linkedWo.status } : null,
        linkedRequest: null as { id: string; number: string; status: string } | null,
        expensesTab: null,
        billing: null,
        flags: {
          canAct: acts,
          canManage: pat,
          canAddNote: open && (acts || pat),
          canWithdraw: req.status === "forwarded_to_pat" && acts,
          isCovering: !acts && isAssetManager(org) && canSeeUnit(scope, req.unitId),
          canAttach: canAttachMedia(org, req, scope),
          canAttachReceipt: false,
          canRequestInfo: req.status === "forwarded_to_pat" && pat,
          canChangePriority: open && acts,
          canChangeWindow: false,
          canReassign: false,
          canSignOff: false,
          canReopen: pat && (closedReq || (req.status === "work_order_created" && !!linkedWo && (linkedWo.status === "reviewed_closed" || linkedWo.status === "cancelled"))),
          reopenRequestId: pat && closedReq ? req._id : null,
        },
      };
    }

    const workOrderId = ctx.db.normalizeId("workOrders", args.id);
    if (!workOrderId) return null;
    const found = await readableWorkOrder(ctx, org, workOrderId);
    if (!found) return null;
    // The drawer is the admin / asset-manager view of a work order: only when one of those roles
    // reaches it. A technician or accountant reach (multi-role, B31) uses workOrders.get instead.
    if (!(await woReach(ctx, org, found.wo)).full) return null;
    const { wo, unit } = found;
    const scope = await scopeOf(ctx, org);
    const [property, files, time, expenses, notes, auditRaw, request] = await Promise.all([
      ctx.db.get(wo.propertyId),
      ctx.db.query("workOrderFiles").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(40),
      ctx.db.query("workOrderTime").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      ctx.db.query("workOrderExpenses").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      ctx.db.query("workOrderNotes").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      ctx.db.query("auditEvents").withIndex("by_entity", (q) => q.eq("entity", "work_order").eq("entityId", wo._id)).order("desc").take(100),
      wo.requestId ? ctx.db.get(wo.requestId) : null,
    ]);
    const audit = auditRaw.filter((a) => a.orgId === org.orgId);
    const linked = request && request.orgId === org.orgId ? request : null;
    const key = workOrderStatusKey(wo);
    const manage = canManageWo(org, wo, unit);
    const active = wo.status === "created" || wo.status === "assigned" || wo.status === "in_progress";
    const mayContact = canManageMaintenance(org) || (!!linked && canAct(org, linked, scope));

    // Photos and videos (any image/video file except receipts) + the tenant's request media; PDFs and receipts are documents.
    const media: MediaItem[] = [];
    const documents: DocItem[] = [];
    let docN = 0;
    for (const f of files) {
      const meta = await ctx.db.system.get(f.storageId);
      const type = meta?.contentType ?? "";
      const url = await ctx.storage.getUrl(f.storageId);
      const isVideo = f.kind === "completion_video" || type.startsWith("video/");
      if (isVideo || (f.kind !== "receipt" && type.startsWith("image/"))) {
        media.push({
          id: f._id,
          kind: isVideo ? "video" : "photo",
          url,
          source: f.uploadedByUserId === wo.technicianUserId ? "technician" : "staff",
          uploadedByUserId: f.uploadedByUserId,
          createdAt: f.createdAt,
          canRemove: canRemoveWoFile(org, wo, f, false),
        });
      } else {
        docN += 1;
        const pdf = type === "application/pdf";
        documents.push({
          id: f._id,
          name: `${f.kind === "receipt" ? "Receipt" : "Document"} ${docN}${pdf ? ".pdf" : ""}`,
          type: pdf ? "pdf" : "image",
          url,
          createdAt: f.createdAt,
          uploadedByUserId: f.uploadedByUserId,
          canRemove: canRemoveWoFile(org, wo, f, woFileIsDocument(f, type)),
        });
      }
    }
    if (linked) {
      const reqMedia = await ctx.db.query("maintenanceMedia").withIndex("by_request", (q) => q.eq("requestId", linked._id)).take(30);
      for (const m of reqMedia) {
        media.push({
          id: m._id,
          kind: m.kind,
          url: await ctx.storage.getUrl(m.storageId),
          source: m.uploadedBy,
          uploadedByUserId: m.uploadedByUserId ?? null,
          createdAt: m.createdAt,
          canRemove: canRemoveRequestMedia(org, linked, scope, m),
        });
      }
    }
    const commentRows = [];
    for (const n of notes) commentRows.push({ id: n._id as string, at: n.createdAt, authorName: (await L.user(n.authorUserId)) ?? "Unknown", body: n.body });
    commentRows.sort((a, b) => b.at - a.at);

    return {
      kind: "work_order" as const,
      id: wo._id,
      numberRaw: wo.number,
      number: `WO-${wo.number}`,
      statusKey: key,
      statusLabel: STATUS_LABEL[key],
      status: wo.status,
      title: oneLine(wo.title, 200),
      description: wo.scope,
      propertyId: wo.propertyId,
      propertyName: property?.name ?? null,
      unitId: unit._id,
      unitNumber: unit.unitNumber,
      priorityLevel: wo.priority as Severity,
      severityScore: linked?.severityScore ?? null,
      priorityReason: linked?.severityReason ?? null,
      window: wo.window ?? null,
      windowStart: wo.windowStart ?? null,
      windowEnd: wo.windowEnd ?? null,
      // The work order's own copy; a work order older than that field reads its request.
      tenantPreferredTime: tenantPreferredTimeText(wo.tenantPreferredTime ?? linked?.preferredAccessTimes) ?? null,
      dueDate: wo.dueDate ?? null,
      technician: await person(wo.technicianUserId),
      assetManager: await person(unit.assetManagerUserId),
      createdAt: wo.createdAt,
      tenant: linked
        ? { name: linked.callerName ?? null, phone: mayContact ? (linked.callbackNumber ?? linked.callerNumber ?? null) : null }
        : { name: null, phone: null },
      media,
      documents,
      comments: commentRows,
      timeline: audit.map((a) => ({ id: a._id, at: a.at, actorName: a.actorLabel, action: a.action, from: a.from ?? null, to: a.to ?? null, note: a.note ?? null })),
      closure: null,
      workOrder: null as { id: string; number: string; status: string } | null,
      linkedRequest: linked ? { id: linked._id as string, number: `MR-${linked.number}`, status: linked.status } : null,
      expensesTab: await expensesTabFor(ctx, wo, files, time, expenses, notes, org),
      // Owner-statement billing (staff only: the board is admin / asset manager).
      billing: await billingView(ctx, org, wo),
      flags: {
        canAct: manage,
        canManage: manage,
        canAddNote: manage && (active || wo.status === "completed"),
        canWithdraw: false,
        isCovering: !manage && isAssetManager(org) && scope.covering.has(unit._id),
        canAttach: canAttachWoMedia(org, wo),
        canAttachReceipt: canAttachWoMedia(org, wo, { receipt: true }),
        canRequestInfo: manage && (active || wo.status === "completed"),
        canChangePriority: manage && active,
        canChangeWindow: manage && active,
        canReassign: manage && active,
        canSignOff: manage && wo.status === "completed",
        canReopen: manage && wo.status === "reviewed_closed" && !!linked && linked.status === "work_order_created",
        reopenRequestId: manage && wo.status === "reviewed_closed" && linked && linked.status === "work_order_created" ? (linked._id as string) : null,
      },
    };
  },
});

// --- Drawer mutations --------------------------------------------------------------------

/**
 * Adds a comment (cap 1000). Request: maintenance.addNote rules (whoever can act on it, or Pat,
 * while it is open). Work order: workOrders.addNote rules (managers only; asset managers are read-only).
 */
export const addComment = mutation({
  args: { kind: kindValidator, id: v.string(), note: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireOrg(ctx);
    if (!boardViewOf(org)) throw new ConvexError("You don't have access to that.");
    if (args.kind === "request") {
      const id = ctx.db.normalizeId("maintenanceRequests", args.id);
      if (!id) throw new ConvexError("Request not found.");
      await addRequestNote(ctx, id, args.note, MAX_BOARD_NOTE);
    } else {
      const id = ctx.db.normalizeId("workOrders", args.id);
      if (!id) throw new ConvexError("Work order not found.");
      await addWorkOrderNote(ctx, id, args.note, MAX_BOARD_NOTE);
    }
  },
});

/** Short-lived URL to POST an admin-added photo / video to (same permission as attaching). */
export const generateUploadUrl = mutation({
  args: { kind: kindValidator, id: v.string(), receipt: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<string> => {
    const org = await requireOrg(ctx);
    if (!boardViewOf(org)) throw new ConvexError("You don't have access to that.");
    if (args.kind === "request") {
      const id = ctx.db.normalizeId("maintenanceRequests", args.id);
      if (!id) throw new ConvexError("Request not found.");
      await attachableRequest(ctx, id);
    } else {
      const id = ctx.db.normalizeId("workOrders", args.id);
      if (!id) throw new ConvexError("Work order not found.");
      await attachableJob(ctx, id, { receipt: args.receipt === true });
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Records the uploaded file after generateUploadUrl. Request: maintenance.attachMedia checks
 * (photo or video, 10 MB / 50 MB, max 30). Work order: workOrders.attachFile checks (videos stored
 * as completion_video, images and PDFs as "other", max 40 files). A rejected upload is reported
 * in the result, not thrown.
 */
export const attachMedia = mutation({
  args: { kind: kindValidator, id: v.string(), storageId: v.id("_storage"), receipt: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const org = await requireOrg(ctx);
    if (!boardViewOf(org)) throw new ConvexError("You don't have access to that.");
    if (args.kind === "request") {
      const id = ctx.db.normalizeId("maintenanceRequests", args.id);
      if (!id) throw new ConvexError("Request not found.");
      const res = await attachRequestMedia(ctx, id, args.storageId);
      if (!res.ok) return res;
      // Remember who uploaded it so the unit's AM can later remove their own mistake.
      await ctx.db.patch(res.mediaId, { uploadedByUserId: org.user._id });
      return { ok: true, id: res.mediaId };
    }
    const id = ctx.db.normalizeId("workOrders", args.id);
    if (!id) throw new ConvexError("Work order not found.");
    // Authorize before touching storage metadata so an out-of-scope caller learns nothing about the file.
    await attachableJob(ctx, id, { receipt: args.receipt === true });
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) return { ok: false, error: "That upload wasn't found." };
    // A receipt / document (photo or PDF) from the Expenses tab is stored as "receipt"; everything
    // else is a photo or video.
    const fileKind = args.receipt ? "receipt" : (meta.contentType ?? "").startsWith("video/") ? "completion_video" : "other";
    const res = await attachWorkOrderFile(ctx, id, args.storageId, fileKind);
    return res.ok ? { ok: true, id: res.fileId } : res;
  },
});

/**
 * Removes one photo / video / document the viewer is allowed to delete (see canRemoveRequestMedia /
 * canRemoveWoFile). The id must belong to that request or work order (a work order may also remove
 * media of its linked request); anything else is "not found". Deletes the row, and the stored blob
 * only if nothing else references it. Audit row has the media id, actor and source, never a URL.
 */
export const removeMedia = mutation({
  args: { kind: kindValidator, id: v.string(), mediaId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const org = await requireOrg(ctx);
    if (!boardViewOf(org)) throw new ConvexError("You don't have access to that.");
    const notFound = () => new ConvexError("Photo not found.");
    const denied = () => new ConvexError("You can't remove this photo.");

    const removeRequestMedia = async (req: Doc<"maintenanceRequests">, m: Doc<"maintenanceMedia">, scope: AmScope) => {
      if (m.requestId !== req._id || m.orgId !== org.orgId) throw notFound();
      if (!canRemoveRequestMedia(org, req, scope, m)) throw denied();
      await ctx.db.delete(m._id);
      await deleteStorageIfUnreferenced(ctx, m.storageId);
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "request",
        entityId: req._id,
        action: "media_removed",
        actorUserId: org.user._id,
        note: `${m._id} (${m.uploadedBy})`,
      });
    };

    if (args.kind === "request") {
      const id = ctx.db.normalizeId("maintenanceRequests", args.id);
      const mediaId = ctx.db.normalizeId("maintenanceMedia", args.mediaId);
      if (!id || !mediaId) throw notFound();
      const { req } = await attachableRequest(ctx, id);
      const m = await ctx.db.get(mediaId);
      if (!m) throw notFound();
      await removeRequestMedia(req, m, await scopeOf(ctx, org));
      return { ok: true };
    }

    const id = ctx.db.normalizeId("workOrders", args.id);
    if (!id) throw new ConvexError("Work order not found.");
    const found = await readableWorkOrder(ctx, org, id);
    if (!found) throw new ConvexError("Work order not found.");
    const { wo } = found;
    const fileId = ctx.db.normalizeId("workOrderFiles", args.mediaId);
    if (fileId) {
      const f = await ctx.db.get(fileId);
      if (!f || f.workOrderId !== wo._id || f.orgId !== org.orgId) throw notFound();
      const type = (await ctx.db.system.get(f.storageId))?.contentType ?? "";
      if (!canRemoveWoFile(org, wo, f, woFileIsDocument(f, type))) throw denied();
      await removeWoFileRow(ctx, org, wo, f, f.uploadedByUserId === wo.technicianUserId ? "technician" : "staff");
      return { ok: true };
    }
    // Otherwise: a photo of the linked request shown on the work order.
    const mediaId = ctx.db.normalizeId("maintenanceMedia", args.mediaId);
    if (!mediaId || !wo.requestId) throw notFound();
    const m = await ctx.db.get(mediaId);
    const req = await ctx.db.get(wo.requestId);
    if (!m || !req || req.orgId !== org.orgId) throw notFound();
    await removeRequestMedia(req, m, await scopeOf(ctx, org));
    return { ok: true };
  },
});
