import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { canManageMaintenance, currentOrg, requireOrg, viewFor } from "./authz";
import { amScope, canSeeUnit } from "./amScope";
import type { OrgContext } from "./authz";
import { nextNumber } from "./counters";
import { checkStorageUsable, markWorkOrderCreated } from "./maintenance";
import { scheduleNotify, staffRecipientIds } from "./notify";
import { resolveTimeZone, tenantPreferredTimeText, windowLabel, windowProblem } from "./workOrderWindow";

/**
 * Work orders (F5): the formal job a technician performs. Created by Pat (from a validated
 * request or manually), by an admin-view user manually, or by an asset manager manually for a
 * unit they own. An AM can never turn a request into a work order; forwarding to Pat is the
 * only AM path (PRD 6.3/6.4).
 *
 * Scope, always derived server-side:
 *   admin view      every work order on the team (Pat powers to change them)
 *   asset manager   work orders on units they manage; may edit only manual ones they created
 *   technician      only work orders where technicianUserId is them, and only their own work
 *   accountant      completed / closed ones, read only
 * Single-record reads outside scope return null so existence isn't leaked.
 * Money is integer cents. Every state change writes an audit row in the same mutation.
 */

type Status = Doc<"workOrders">["status"];
type Priority = Doc<"workOrders">["priority"];

const priorityValidator = v.union(v.literal("emergency"), v.literal("urgent"), v.literal("routine"));
const requiredOnSubmitValidator = v.object({
  photos: v.boolean(),
  hours: v.boolean(),
  receipts: v.boolean(),
  notes: v.boolean(),
});

const PRIORITY_RANK: Record<Priority, number> = { emergency: 0, urgent: 1, routine: 2 };
const LIST_CAP = 300;
const MAX_FILES_PER_WO = 40;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "video/3gpp",
  "video/3gpp2",
  "video/x-m4v",
]);
const MAX_EXPENSE_CENTS = 100_000_000; // $1,000,000: a typo guard, not a business rule
const ALL_STATUSES: Status[] = ["created", "assigned", "in_progress", "completed", "reviewed_closed", "cancelled"];
const ACTIVE: Status[] = ["created", "assigned", "in_progress"];

// --- Lifecycle ----------------------------------------------------------------

/**
 * The ONLY definition of legal work-order status moves. Reassigning a technician is not a
 * status move (assigned stays assigned), so it isn't listed.
 */
const TRANSITIONS: Record<Status, Status[]> = {
  created: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["reviewed_closed", "in_progress"], // in_progress = Pat sends it back
  reviewed_closed: [],
  cancelled: [],
};

export function assertWorkOrderTransition(from: Status, to: Status): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConvexError(`A work order that is "${from.replace(/_/g, " ")}" can't be moved to "${to.replace(/_/g, " ")}".`);
  }
}

/** Issue type -> words a technician's free-text skill is likely to contain. */
const SKILL_KEYWORDS: Record<string, string[]> = {
  electrical: ["electric", "wiring", "outlet", "lighting"],
  water_leak: ["plumb", "leak", "water", "pipe", "hvac"],
  broken_item: ["appliance", "handyman", "general", "carpentry", "repair", "locksmith"],
  gas: ["gas", "plumb", "hvac", "heating"],
  fire: ["restoration", "general"],
  flooding: ["plumb", "water", "restoration"],
  tenant_responsibility: [],
  other: ["general", "handyman"],
};

/**
 * Who to preselect when Pat creates a work order: the technician whose skill text matches the
 * issue type (fewest active jobs wins ties), else simply the least-loaded technician. Pat can
 * always pick someone else; this only fills the dropdown.
 */
export const suggestTechnician = query({
  args: { issueType: v.string() },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org || !canManageMaintenance(org)) return null;

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const keywords = SKILL_KEYWORDS[args.issueType] ?? [];
    const candidates = [];
    for (const m of memberships) {
      if (!(m.jobRoles ?? []).includes("technician")) continue;
      const user = await ctx.db.get(m.userId);
      let active = 0;
      for (const s of ACTIVE) {
        active += (
          await ctx.db
            .query("workOrders")
            .withIndex("by_technician_and_status", (q) => q.eq("technicianUserId", m.userId).eq("status", s))
            .take(100)
        ).length;
      }
      const skill = m.skill?.toLowerCase() ?? "";
      candidates.push({
        userId: m.userId,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Unknown",
        skill: m.skill ?? null,
        activeJobs: active,
        matchesSkill: keywords.length > 0 && keywords.some((k) => skill.includes(k)),
        unavailable: m.unavailableUntil !== undefined && m.unavailableUntil > Date.now(),
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort(
      (a, b) =>
        Number(a.unavailable) - Number(b.unavailable) ||
        Number(b.matchesSkill) - Number(a.matchesSkill) ||
        a.activeJobs - b.activeJobs ||
        a.name.localeCompare(b.name),
    );
    const best = candidates[0];
    return {
      userId: best.userId,
      name: best.name,
      skill: best.skill,
      activeJobs: best.activeJobs,
      reason: best.matchesSkill ? ("skill" as const) : ("least_loaded" as const),
    };
  },
});

// --- Helpers ---------------------------------------------------------------------

function requireText(raw: string, label: string, max: number): string {
  const out = raw.trim();
  if (!out) throw new ConvexError(`${label} is required.`);
  if (out.length > max) throw new ConvexError(`${label} is too long (at most ${max} characters).`);
  return out;
}

function optText(raw: string | undefined, max: number): string | undefined {
  const out = raw?.trim();
  if (!out) return undefined;
  if (out.length > max) throw new ConvexError(`That text is too long (at most ${max} characters).`);
  return out;
}

type WindowFields = Pick<Doc<"workOrders">, "window" | "windowStart" | "windowEnd">;
const NO_WINDOW: WindowFields = { window: undefined, windowStart: undefined, windowEnd: undefined };

/**
 * The stored window for a picked start/end: validated here (never trust the client), labelled in
 * the team's time zone (the browser's zone only when the team hasn't set one).
 */
async function windowFields(
  ctx: MutationCtx,
  org: OrgContext,
  start: number | undefined,
  end: number | undefined,
  fallbackTimeZone: string | undefined,
): Promise<WindowFields | null> {
  if (start === undefined && end === undefined) return null;
  if (start === undefined || end === undefined) throw new ConvexError("Pick both a start and an end time.");
  const now = Date.now();
  const problem = windowProblem(start, end, now);
  if (problem) throw new ConvexError(problem);
  const timeZone = resolveTimeZone((await ctx.db.get(org.orgId))?.timeZone, fallbackTimeZone);
  return { window: windowLabel(start, end, timeZone, now), windowStart: start, windowEnd: end };
}

/** A technician must be on THIS team and hold the technician role (no admin fallback). */
async function assertTechnician(ctx: QueryCtx | MutationCtx, orgId: string, userId: Id<"users">) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.orgId !== orgId || !(membership.jobRoles ?? []).includes("technician")) {
    throw new ConvexError("That person is not a technician on this team.");
  }
}

/**
 * Read scope. Returns the work order plus its unit when `org` may see it, else null.
 * Accountants see only finished work; technicians only their own jobs.
 */
export async function readable(
  ctx: QueryCtx | MutationCtx,
  org: OrgContext,
  id: Id<"workOrders">,
): Promise<{ wo: Doc<"workOrders">; unit: Doc<"units"> } | null> {
  const wo = await ctx.db.get(id);
  if (!wo || wo.orgId !== org.orgId) return null;
  const unit = await ctx.db.get(wo.unitId);
  if (!unit) return null;
  const view = viewFor(org.isAdmin, org.jobRoles);
  if (view === "admin") return { wo, unit };
  // Managed units, plus units covered while a colleague is out of office (read-only: canManageWo
  // stays managed-only).
  if (view === "asset_manager" && canSeeUnit(await amScope(ctx, org), unit._id)) return { wo, unit };
  if (view === "technician" && wo.technicianUserId === org.user._id) return { wo, unit };
  if (view === "accountant" && (wo.status === "completed" || wo.status === "reviewed_closed")) return { wo, unit };
  return null;
}

/** Accountants read finished work for the books; when the tenant wanted a visit isn't part of that. */
function visibleWo(wo: Doc<"workOrders">, view: ReturnType<typeof viewFor>): Doc<"workOrders"> {
  return view === "accountant" ? { ...wo, tenantPreferredTime: undefined } : wo;
}

/**
 * May this person change the work order's scope/assignment/cancel it? Pat powers always; an AM
 * only the manual work orders they created on units they manage.
 */
export function canManageWo(org: OrgContext, wo: Doc<"workOrders">, unit: Doc<"units">): boolean {
  // Asset managers are read-only on work orders: they raise requests for Pat instead.
  void wo;
  void unit;
  return canManageMaintenance(org);
}

async function managedWo(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const found = await readable(ctx, org, id);
  if (!found) throw new ConvexError("Work order not found.");
  if (!canManageWo(org, found.wo, found.unit)) throw new ConvexError("You don't have access to that.");
  return { org, ...found };
}

/** The technician's own work order, or "not found" (same answer for missing and not theirs). */
async function ownJob(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const wo = await ctx.db.get(id);
  if (!wo || wo.orgId !== org.orgId || wo.technicianUserId !== org.user._id) {
    throw new ConvexError("Work order not found.");
  }
  return { org, wo };
}

/** Tech or manager may add work to a job: techs only while it is in progress. */
export async function workableJob(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const found = await readable(ctx, org, id);
  if (!found) throw new ConvexError("Work order not found.");
  const isTech = found.wo.technicianUserId === org.user._id && viewFor(org.isAdmin, org.jobRoles) === "technician";
  const manager = canManageWo(org, found.wo, found.unit);
  if (!isTech && !manager) throw new ConvexError("You don't have access to that.");
  if (isTech && !manager && found.wo.status !== "in_progress") {
    throw new ConvexError("Start the job before adding to it.");
  }
  if (!ACTIVE.includes(found.wo.status) && found.wo.status !== "completed") {
    throw new ConvexError("This work order is closed.");
  }
  return { org, ...found };
}

/**
 * May this person add photos / videos to the work order? Any admin-view user (team admin,
 * executive, maintenance lead, Simplr admin) in ANY status. Receipts only while it is active or
 * completed (closed financial records stay untouched). Technicians keep their own-job flow
 * (workableJob); AMs, covering or not, stay read-only.
 */
export function canAttachWoMedia(org: OrgContext, wo: Doc<"workOrders">, opts?: { receipt?: boolean }): boolean {
  if (wo.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) !== "admin") return false;
  if (opts?.receipt) return ACTIVE.includes(wo.status) || wo.status === "completed";
  return true;
}

/** Like workableJob, but admin-view users may add photos / videos in every status. */
export async function attachableJob(ctx: MutationCtx, id: Id<"workOrders">, opts?: { receipt?: boolean }) {
  const org = await requireOrg(ctx);
  const found = await readable(ctx, org, id);
  if (!found) throw new ConvexError("Work order not found.");
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") {
    if (!canAttachWoMedia(org, found.wo, opts)) throw new ConvexError("This work order is closed.");
    return { org, ...found };
  }
  return await workableJob(ctx, id);
}

/** Closed = no longer active or awaiting sign-off (reviewed_closed / cancelled). */
function woClosed(wo: Doc<"workOrders">): boolean {
  return !ACTIVE.includes(wo.status) && wo.status !== "completed";
}

/** Receipts and other non-photo/video documents (expense records). */
export function woFileIsDocument(f: Doc<"workOrderFiles">, contentType: string): boolean {
  if (f.kind === "receipt") return true;
  if (f.kind === "completion_photo" || f.kind === "completion_video") return false;
  return !(contentType.startsWith("image/") || contentType.startsWith("video/"));
}

/**
 * May this person delete this work-order file? Single rule behind `canRemove` flags and the remove
 * mutations. Admin view: any photo/video in any status, receipts / expense documents until the job
 * is closed. Technician: only their own non-receipt upload on their own job while in progress.
 * Asset managers (covering or not) and accountants: never.
 */
export function canRemoveWoFile(
  org: OrgContext,
  wo: Doc<"workOrders">,
  f: Doc<"workOrderFiles">,
  isDocument: boolean,
): boolean {
  if (f.orgId !== org.orgId || wo.orgId !== org.orgId || f.workOrderId !== wo._id) return false;
  const view = viewFor(org.isAdmin, org.jobRoles);
  if (view === "admin") return !(isDocument && woClosed(wo));
  if (view === "technician") {
    return (
      wo.technicianUserId === org.user._id &&
      wo.status === "in_progress" &&
      f.uploadedByUserId === org.user._id &&
      f.kind !== "receipt"
    );
  }
  return false;
}

/** Deletes the blob only when no media / file row still points at it. */
export async function deleteStorageIfUnreferenced(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  const [a, b] = await Promise.all([
    ctx.db.query("workOrderFiles").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first(),
    ctx.db.query("maintenanceMedia").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first(),
  ]);
  if (!a && !b) await ctx.storage.delete(storageId);
}

/** Deletes one work-order file row (+ blob if unreferenced), unlinks it from expenses, writes the audit row. */
export async function removeWoFileRow(
  ctx: MutationCtx,
  org: OrgContext,
  wo: Doc<"workOrders">,
  f: Doc<"workOrderFiles">,
  source: "staff" | "technician",
): Promise<void> {
  const linked = await ctx.db.query("workOrderExpenses").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200);
  for (const e of linked) if (e.receiptFileId === f._id) await ctx.db.patch(e._id, { receiptFileId: undefined });
  await ctx.db.delete(f._id);
  await deleteStorageIfUnreferenced(ctx, f.storageId);
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "work_order",
    entityId: wo._id,
    action: "media_removed",
    actorUserId: org.user._id,
    note: `${f._id} (${source})`,
  });
}

/** A technician removes a photo / video they uploaded themselves, while the job is in progress. */
export const removeOwnFile = mutation({
  args: { workOrderId: v.id("workOrders"), fileId: v.id("workOrderFiles") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const org = await requireOrg(ctx);
    const found = await readable(ctx, org, args.workOrderId);
    const f = await ctx.db.get(args.fileId);
    if (!found || !f || f.workOrderId !== found.wo._id || f.orgId !== org.orgId) throw new ConvexError("File not found.");
    if (viewFor(org.isAdmin, org.jobRoles) !== "technician") throw new ConvexError("You don't have access to that.");
    if (!canRemoveWoFile(org, found.wo, f, false)) throw new ConvexError("You can only remove your own photos while the job is in progress.");
    await removeWoFileRow(ctx, org, found.wo, f, "technician");
    return { ok: true };
  },
});

async function notifyTech(
  ctx: MutationCtx,
  wo: Doc<"workOrders">,
  unit: Doc<"units"> | null,
  technicianUserId: Id<"users"> | undefined,
  template: "wo_assigned" | "wo_changed" | "wo_sent_back",
  actor: Id<"users">,
) {
  if (!technicianUserId || technicianUserId === actor) return;
  await scheduleNotify(ctx, {
    orgId: wo.orgId,
    userIds: [technicianUserId],
    template,
    data: { number: wo.number, unit: unit?.unitNumber, path: `/tech/jobs/${wo._id}` },
  });
}

// --- Create ------------------------------------------------------------------------

export const create = mutation({
  args: {
    requestId: v.optional(v.id("maintenanceRequests")),
    unitId: v.id("units"),
    title: v.string(),
    scope: v.string(),
    priority: priorityValidator,
    technicianUserId: v.optional(v.id("users")),
    accessNotes: v.optional(v.string()),
    requiredOnSubmit: requiredOnSubmitValidator,
    dueDate: v.optional(v.number()),
    windowStart: v.optional(v.number()), // appointment window, epoch ms; both or neither
    windowEnd: v.optional(v.number()),
    fallbackTimeZone: v.optional(v.string()), // the browser's zone, used only if the team has none
  },
  handler: async (ctx, args): Promise<Id<"workOrders">> => {
    const org = await requireOrg(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");

    let request: Doc<"maintenanceRequests"> | null = null;
    if (args.requestId) {
      // Turning a request into a work order is Pat's decision; an AM can only forward it.
      if (!canManageMaintenance(org)) throw new ConvexError("You don't have access to that.");
      request = await ctx.db.get(args.requestId);
      if (!request || request.orgId !== org.orgId) throw new ConvexError("Request not found.");
      if (request.unitId !== unit._id) throw new ConvexError("The unit you picked doesn't match this request's unit. Set the request's unit first.");
      const existing = await ctx.db
        .query("workOrders")
        .withIndex("by_request", (q) => q.eq("requestId", request!._id))
        .collect();
      // A reopened request may get a new work order once every earlier one is closed or cancelled.
      if (existing.some((w) => w.status !== "cancelled" && w.status !== "reviewed_closed")) {
        throw new ConvexError("This request already has a work order.");
      }
    } else {
      const adminView = viewFor(org.isAdmin, org.jobRoles) === "admin";
      if (!adminView && !canManageMaintenance(org)) {
        if (org.jobRoles.includes("asset_manager")) {
          throw new ConvexError("Asset managers create a request for Pat to review instead.");
        }
        throw new ConvexError("You don't have access to that.");
      }
    }

    if (args.technicianUserId) await assertTechnician(ctx, org.orgId, args.technicianUserId);
    if (args.dueDate !== undefined && !(args.dueDate > 0)) throw new ConvexError("Pick a valid due date.");
    const window = await windowFields(ctx, org, args.windowStart, args.windowEnd, args.fallbackTimeZone);

    const now = Date.now();
    const number = await nextNumber(ctx, org.orgId, "workOrder");
    const id = await ctx.db.insert("workOrders", {
      orgId: org.orgId,
      number,
      requestId: request?._id,
      unitId: unit._id,
      propertyId: unit.propertyId,
      title: requireText(args.title, "Title", 200),
      scope: requireText(args.scope, "Scope", 4000),
      priority: args.priority,
      checklist: [], // deprecated: checklist feature removed; column kept for existing data
      technicianUserId: args.technicianUserId,
      accessNotes: optText(args.accessNotes, 1000),
      requiredOnSubmit: args.requiredOnSubmit,
      status: args.technicianUserId ? "assigned" : "created",
      dueDate: args.dueDate,
      ...(window ?? {}),
      // Copied from the request, never taken from the client. The scheduled window above stays
      // whatever staff picked; this is only what the tenant asked for.
      tenantPreferredTime: tenantPreferredTimeText(request?.preferredAccessTimes),
      createdBy: org.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: id,
      action: "wo_created",
      actorUserId: org.user._id,
      to: args.technicianUserId ? "assigned" : "created",
      note: request ? `From MR-${request.number}` : "Manual",
    });
    if (request) await markWorkOrderCreated(ctx, org, request, number);

    if (args.technicianUserId) {
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "work_order",
        entityId: id,
        action: "assigned",
        actorUserId: org.user._id,
        to: args.technicianUserId,
      });
      const wo = (await ctx.db.get(id))!;
      await notifyTech(ctx, wo, unit, args.technicianUserId, "wo_assigned", org.user._id);
    }
    return id;
  },
});

/**
 * "Action required" for the technician: Pat's latest "Sent back:" / "Info requested:" note, while
 * the job is still active and the technician has done nothing since (no later note by them, and
 * not marked complete again). Derived from existing notes and fields; nothing is stored.
 */
type ActionRequired = { kind: "sent_back" | "info_requested"; note: string; at: number; byName?: string };
const ACTION_PREFIXES = [
  { prefix: "Sent back:", kind: "sent_back" },
  { prefix: "Info requested:", kind: "info_requested" },
] as const;

async function actionRequiredFor(
  ctx: QueryCtx,
  wo: Doc<"workOrders">,
  notes: Doc<"workOrderNotes">[],
): Promise<ActionRequired | null> {
  if (!ACTIVE.includes(wo.status) || !wo.technicianUserId) return null;
  let latest: { kind: ActionRequired["kind"]; note: string; row: Doc<"workOrderNotes"> } | null = null;
  for (const n of notes) {
    // Only the manager's notes count; the technician cannot raise this on their own job.
    if (n.authorUserId === wo.technicianUserId) continue;
    const hit = ACTION_PREFIXES.find((p) => n.body.startsWith(p.prefix));
    if (!hit) continue;
    if (!latest || n.createdAt > latest.row.createdAt) {
      latest = { kind: hit.kind, note: n.body.slice(hit.prefix.length).trim(), row: n };
    }
  }
  if (!latest) return null;
  const at = latest.row.createdAt;
  if (notes.some((n) => n.authorUserId === wo.technicianUserId && n.createdAt > at)) return null;
  if (wo.completedAt !== undefined && wo.completedAt > at) return null;
  const author = await ctx.db.get(latest.row.authorUserId);
  const byName = author ? [author.firstName, author.lastName].filter(Boolean).join(" ").trim() || undefined : undefined;
  return { kind: latest.kind, note: latest.note, at, byName };
}

// --- Reads ------------------------------------------------------------------------

export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("created"),
        v.literal("assigned"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("reviewed_closed"),
        v.literal("cancelled"),
      ),
    ),
    technicianUserId: v.optional(v.id("users")),
    propertyId: v.optional(v.id("properties")),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const view = viewFor(org.isAdmin, org.jobRoles);
    const statuses = args.status ? [args.status] : ALL_STATUSES;

    let rows: Doc<"workOrders">[] = [];
    if (view === "admin" || view === "accountant") {
      // Accountants are limited to finished work regardless of the status asked for.
      const allowed = view === "accountant" ? statuses.filter((s) => s === "completed" || s === "reviewed_closed") : statuses;
      for (const s of allowed) {
        rows.push(
          ...(await ctx.db
            .query("workOrders")
            .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
            .order("desc")
            .take(LIST_CAP)),
        );
      }
    } else if (view === "asset_manager") {
      const scope = await amScope(ctx, org);
      for (const unitId of [...scope.managed, ...scope.covering]) {
        rows.push(
          ...(await ctx.db
            .query("workOrders")
            .withIndex("by_unit", (q) => q.eq("unitId", unitId))
            .order("desc")
            .take(100)),
        );
      }
    } else if (view === "technician") {
      // The id is the session's, never args.technicianUserId.
      for (const s of statuses) {
        rows.push(
          ...(await ctx.db
            .query("workOrders")
            .withIndex("by_technician_and_status", (q) =>
              q.eq("technicianUserId", org.user._id).eq("status", s),
            )
            .order("desc")
            .take(LIST_CAP)),
        );
      }
    } else {
      return [];
    }

    rows = rows.filter((w) => {
      if (w.orgId !== org.orgId) return false;
      if (!statuses.includes(w.status)) return false;
      if (args.propertyId && w.propertyId !== args.propertyId) return false;
      if (args.priority && w.priority !== args.priority) return false;
      if (view !== "technician" && args.technicianUserId && w.technicianUserId !== args.technicianUserId) {
        return false;
      }
      return true;
    });
    rows.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) ||
        b.createdAt - a.createdAt,
    );
    rows = rows.slice(0, LIST_CAP);

    const units = new Map<string, string>();
    const properties = new Map<string, string>();
    const users = new Map<string, string>();
    const out = [];
    for (const w of rows) {
      if (!units.has(w.unitId)) units.set(w.unitId, (await ctx.db.get(w.unitId))?.unitNumber ?? "?");
      if (!properties.has(w.propertyId)) {
        properties.set(w.propertyId, (await ctx.db.get(w.propertyId))?.name ?? "Unknown");
      }
      let technicianName: string | undefined;
      if (w.technicianUserId) {
        if (!users.has(w.technicianUserId)) {
          const u = await ctx.db.get(w.technicianUserId);
          users.set(
            w.technicianUserId,
            [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown",
          );
        }
        technicianName = users.get(w.technicianUserId);
      }
      const request = w.requestId && view !== "technician" ? await ctx.db.get(w.requestId) : null;
      const actionRequired =
        view === "technician" && ACTIVE.includes(w.status)
          ? await actionRequiredFor(
              ctx,
              w,
              await ctx.db
                .query("workOrderNotes")
                .withIndex("by_work_order", (q) => q.eq("workOrderId", w._id))
                .order("desc")
                .take(50),
            )
          : null;
      out.push({
        ...visibleWo(w, view),
        unitNumber: units.get(w.unitId),
        propertyName: properties.get(w.propertyId),
        technicianName,
        requestNumber: request?.number,
        isOverdue: ACTIVE.includes(w.status) && w.dueDate !== undefined && w.dueDate < Date.now(),
        actionRequired,
      });
    }
    return out;
  },
});

/**
 * Expenses tab data: hours and materials only. Labor dollars are never computed (a labor rate
 * and owner-report formulas are not confirmed), so there is deliberately no labor amount here.
 */
export async function expensesTabFor(
  ctx: QueryCtx,
  wo: Doc<"workOrders">,
  files: Doc<"workOrderFiles">[],
  time: Doc<"workOrderTime">[],
  expenses: Doc<"workOrderExpenses">[],
  notes: Doc<"workOrderNotes">[],
  org?: OrgContext,
) {
  const names = new Map<string, string>();
  const nameOf = async (id: Id<"users">) => {
    if (!names.has(id)) {
      const u = await ctx.db.get(id);
      names.set(id, [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown");
    }
    return names.get(id)!;
  };
  const fileById = new Map(files.map((f) => [f._id as string, f]));
  const documents = [];
  let n = 0;
  for (const f of files) {
    if (f.kind !== "receipt" && f.kind !== "other") continue;
    n += 1;
    const meta = await ctx.db.system.get(f.storageId);
    const contentType = meta?.contentType ?? "";
    const isPdf = contentType === "application/pdf";
    documents.push({
      _id: f._id,
      name: `${f.kind === "receipt" ? "Receipt" : "Document"} ${n}${isPdf ? ".pdf" : ""}`,
      type: isPdf ? ("pdf" as const) : ("image" as const),
      url: await ctx.storage.getUrl(f.storageId),
      createdAt: f.createdAt,
      uploadedByUserId: f.uploadedByUserId,
      canRemove: !!org && canRemoveWoFile(org, wo, f, woFileIsDocument(f, contentType)),
    });
  }
  const photos = [];
  for (const f of files) {
    if (f.kind !== "completion_photo" && f.kind !== "completion_video") continue;
    photos.push({
      _id: f._id,
      kind: f.kind === "completion_video" ? ("video" as const) : ("photo" as const),
      url: await ctx.storage.getUrl(f.storageId),
      createdAt: f.createdAt,
      uploadedByUserId: f.uploadedByUserId,
      canRemove: !!org && canRemoveWoFile(org, wo, f, false),
    });
  }
  // The technician's own latest note (Pat's "Sent back" / "Info requested" notes are excluded).
  const techNote =
    notes
      .filter((x) => x.authorUserId === wo.technicianUserId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.body ?? null;
  return {
    hoursSubmitted: time.reduce((sum, t) => sum + t.hours, 0),
    materialsTotal: expenses.filter((e) => e.kind === "material").reduce((sum, e) => sum + e.amountCents, 0), // cents
    otherExpensesTotal: expenses.filter((e) => e.kind !== "material").reduce((sum, e) => sum + e.amountCents, 0), // cents
    expenses: await Promise.all(
      expenses.map(async (e) => ({
        _id: e._id,
        kind: e.kind,
        description: e.description,
        amount: e.amountCents, // cents
        submittedBy: await nameOf(e.technicianUserId),
        hasReceipt: !!(e.receiptFileId && fileById.has(e.receiptFileId)),
        createdAt: e.createdAt,
      })),
    ),
    technicianExpenseNote: techNote,
    documents,
    photos,
    laborNote:
      "Labor amount calculated: Hours are recorded separately. A labor rate and owner-report formulas must be confirmed before financial totals are finalized.",
  };
}

export const get = query({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) return null;
    const { wo, unit } = found;
    const view = viewFor(org.isAdmin, org.jobRoles);

    const [property, fileRows, time, expenses, notes, technician, request] = await Promise.all([
      ctx.db.get(wo.propertyId),
      ctx.db.query("workOrderFiles").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(MAX_FILES_PER_WO),
      ctx.db.query("workOrderTime").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      ctx.db.query("workOrderExpenses").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      ctx.db.query("workOrderNotes").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
      wo.technicianUserId ? ctx.db.get(wo.technicianUserId) : null,
      wo.requestId && view !== "technician" && view !== "accountant" ? ctx.db.get(wo.requestId) : null,
    ]);
    // Technicians get the job, not the tenant file or the internal history.
    const audit =
      view === "admin" || view === "asset_manager"
        ? (
            await ctx.db
              .query("auditEvents")
              .withIndex("by_entity", (q) => q.eq("entity", "work_order").eq("entityId", wo._id))
              .order("desc")
              .take(100)
          ).filter((a) => a.orgId === org.orgId)
        : [];

    return {
      workOrder: visibleWo(wo, view),
      unit: { _id: unit._id, unitNumber: unit.unitNumber, floor: unit.floor },
      property: property ? { _id: property._id, name: property.name, address: property.address } : null,
      technicianName: technician
        ? [technician.firstName, technician.lastName].filter(Boolean).join(" ").trim() || technician.email
        : undefined,
      request:
        request && request.orgId === org.orgId
          ? { _id: request._id, number: request.number, status: request.status, issueType: request.issueType }
          : null,
      files: await Promise.all(
        fileRows.map(async (f) => {
          // Content type matters only for an admin on a closed job (documents are then locked).
          const type = f.kind === "other" && woClosed(wo) ? ((await ctx.db.system.get(f.storageId))?.contentType ?? "") : "image/";
          return {
            _id: f._id,
            kind: f.kind,
            createdAt: f.createdAt,
            uploadedByUserId: f.uploadedByUserId,
            url: await ctx.storage.getUrl(f.storageId),
            canRemove: canRemoveWoFile(org, wo, f, woFileIsDocument(f, type)),
          };
        }),
      ),
      time,
      expenses,
      notes,
      actionRequired: view === "technician" ? await actionRequiredFor(ctx, wo, notes) : null,
      expensesTab: view === "technician" ? null : await expensesTabFor(ctx, wo, fileRows, time, expenses, notes, org),
      totals: {
        hours: time.reduce((sum, t) => sum + t.hours, 0),
        expenseCents: expenses.reduce((sum, e) => sum + e.amountCents, 0),
      },
      audit,
      viewerCan: {
        manage: canManageWo(org, wo, unit),
        attach: canAttachWoMedia(org, wo),
        review: canManageMaintenance(org) && wo.status === "completed",
        work:
          wo.technicianUserId === org.user._id &&
          view === "technician" &&
          (wo.status === "assigned" || wo.status === "in_progress"),
      },
    };
  },
});

// --- Management (Pat powers, or the AM who owns a manual WO) --------------------------

export const assign = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    technicianUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { org, wo, unit } = await managedWo(ctx, args.workOrderId);
    if (!ACTIVE.includes(wo.status)) throw new ConvexError("This work order can no longer be reassigned.");
    await assertTechnician(ctx, org.orgId, args.technicianUserId);
    // The appointment window is changed through editScope.
    if (wo.technicianUserId === args.technicianUserId) return;

    const to: Status = wo.status === "created" ? "assigned" : wo.status;
    if (to !== wo.status) assertWorkOrderTransition(wo.status, to);
    await ctx.db.patch(wo._id, {
      technicianUserId: args.technicianUserId,
      status: to,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: wo.technicianUserId ? "reassigned" : "assigned",
      actorUserId: org.user._id,
      from: wo.technicianUserId,
      to: args.technicianUserId,
    });
    await notifyTech(ctx, wo, unit, args.technicianUserId, "wo_assigned", org.user._id);
    // The previous technician learns the job is no longer theirs.
    await notifyTech(ctx, wo, unit, wo.technicianUserId, "wo_changed", org.user._id);
  },
});

export const editScope = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    title: v.optional(v.string()),
    scope: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    accessNotes: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    clearDueDate: v.optional(v.boolean()),
    windowStart: v.optional(v.number()), // appointment window, epoch ms; both or neither
    windowEnd: v.optional(v.number()),
    clearWindow: v.optional(v.boolean()),
    fallbackTimeZone: v.optional(v.string()), // the browser's zone, used only if the team has none
    requiredOnSubmit: v.optional(requiredOnSubmitValidator),
  },
  handler: async (ctx, args) => {
    const { org, wo, unit } = await managedWo(ctx, args.workOrderId);
    if (!ACTIVE.includes(wo.status)) throw new ConvexError("This work order is no longer editable.");

    const patch: Partial<Doc<"workOrders">> = { updatedAt: Date.now() };
    const changed: string[] = [];
    if (args.title !== undefined) {
      patch.title = requireText(args.title, "Title", 200);
      changed.push("title");
    }
    if (args.scope !== undefined) {
      patch.scope = requireText(args.scope, "Scope", 4000);
      changed.push("scope");
    }
    if (args.priority !== undefined && args.priority !== wo.priority) {
      patch.priority = args.priority;
      changed.push("priority");
    }
    if (args.accessNotes !== undefined) {
      patch.accessNotes = optText(args.accessNotes, 1000);
      changed.push("access notes");
    }
    if (args.clearDueDate) {
      patch.dueDate = undefined;
      changed.push("due date");
    } else if (args.dueDate !== undefined) {
      if (!(args.dueDate > 0)) throw new ConvexError("Pick a valid due date.");
      patch.dueDate = args.dueDate;
      changed.push("due date");
    }
    if (args.clearWindow) {
      if (args.windowStart !== undefined || args.windowEnd !== undefined) {
        throw new ConvexError("Either clear the time window or pick one, not both.");
      }
      if (wo.window !== undefined || wo.windowStart !== undefined) {
        Object.assign(patch, NO_WINDOW);
        changed.push("window");
      }
    } else if (
      // Re-sending the window already stored is not a change (and skips the past-window check).
      args.windowStart !== wo.windowStart ||
      args.windowEnd !== wo.windowEnd
    ) {
      const window = await windowFields(ctx, org, args.windowStart, args.windowEnd, args.fallbackTimeZone);
      if (window) {
        Object.assign(patch, window);
        changed.push("window");
      }
    }
    if (args.requiredOnSubmit) {
      patch.requiredOnSubmit = args.requiredOnSubmit;
      changed.push("submit requirements");
    }
    if (changed.length === 0) return;

    await ctx.db.patch(wo._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "scope_edited",
      actorUserId: org.user._id,
      note: changed.join(", "),
    });
    await notifyTech(ctx, wo, unit, wo.technicianUserId, "wo_changed", org.user._id);
  },
});

export const cancel = mutation({
  args: { workOrderId: v.id("workOrders"), reason: v.string() },
  handler: async (ctx, args) => {
    const { org, wo, unit } = await managedWo(ctx, args.workOrderId);
    const reason = requireText(args.reason, "A reason", 500);
    assertWorkOrderTransition(wo.status, "cancelled");
    await ctx.db.patch(wo._id, { status: "cancelled", cancelReason: reason, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "cancelled",
      actorUserId: org.user._id,
      from: wo.status,
      to: "cancelled",
      note: reason,
    });
    await notifyTech(ctx, wo, unit, wo.technicianUserId, "wo_changed", org.user._id);
  },
});

/** Pat reviews a submitted job and closes it out. */
export const reviewClose = mutation({
  args: { workOrderId: v.id("workOrders"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canManageMaintenance(org)) throw new ConvexError("You don't have access to that.");
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) throw new ConvexError("Work order not found.");
    assertWorkOrderTransition(found.wo.status, "reviewed_closed");
    const now = Date.now();
    await ctx.db.patch(found.wo._id, { status: "reviewed_closed", closedAt: now, updatedAt: now });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: found.wo._id,
      action: "closed",
      actorUserId: org.user._id,
      from: found.wo.status,
      to: "reviewed_closed",
      note: optText(args.note, 1000),
    });
  },
});

/** Pat sends a submitted job back to the technician with what is missing. */
export const sendBack = mutation({
  args: { workOrderId: v.id("workOrders"), note: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canManageMaintenance(org)) throw new ConvexError("You don't have access to that.");
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) throw new ConvexError("Work order not found.");
    const { wo, unit } = found;
    const note = requireText(args.note, "A note for the technician", 1000);
    assertWorkOrderTransition(wo.status, "in_progress");

    const now = Date.now();
    await ctx.db.patch(wo._id, { status: "in_progress", completedAt: undefined, updatedAt: now });
    // The note lands in the job's notes so the technician sees why, not just that it came back.
    await ctx.db.insert("workOrderNotes", {
      orgId: org.orgId,
      workOrderId: wo._id,
      authorUserId: org.user._id,
      body: `Sent back: ${note}`,
      createdAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "sent_back",
      actorUserId: org.user._id,
      from: wo.status,
      to: "in_progress",
      note,
    });
    await notifyTech(ctx, wo, unit, wo.technicianUserId, "wo_sent_back", org.user._id);
  },
});

/**
 * Pat asks the technician for more information while the job is still in progress (sendBack only
 * works on a completed job). Records a note the technician sees on the job and notifies in-app;
 * the status does not change. Texts stay off (wo_changed is not an SMS-allowed template).
 */
export const requestInfo = mutation({
  args: { workOrderId: v.id("workOrders"), note: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canManageMaintenance(org)) throw new ConvexError("You don't have access to that.");
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) throw new ConvexError("Work order not found.");
    const { wo, unit } = found;
    if (!ACTIVE.includes(wo.status)) throw new ConvexError("This work order isn't in progress.");
    const note = requireText(args.note, "A note for the technician", 1000);
    const now = Date.now();
    await ctx.db.patch(wo._id, { updatedAt: now });
    await ctx.db.insert("workOrderNotes", {
      orgId: org.orgId,
      workOrderId: wo._id,
      authorUserId: org.user._id,
      body: `Info requested: ${note}`,
      createdAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "info_requested",
      actorUserId: org.user._id,
      note,
    });
    await notifyTech(ctx, wo, unit, wo.technicianUserId, "wo_changed", org.user._id);
  },
});

// --- Technician --------------------------------------------------------------------

export const start = mutation({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, args) => {
    const { org, wo } = await ownJob(ctx, args.workOrderId);
    assertWorkOrderTransition(wo.status, "in_progress");
    await ctx.db.patch(wo._id, { status: "in_progress", updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "started",
      actorUserId: org.user._id,
      from: wo.status,
      to: "in_progress",
    });
  },
});

export const addTime = mutation({
  args: { workOrderId: v.id("workOrders"), date: v.string(), hours: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, wo } = await workableJob(ctx, args.workOrderId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date))) {
      throw new ConvexError("Date must look like 2026-11-03.");
    }
    if (!Number.isFinite(args.hours) || args.hours <= 0 || args.hours > 24) {
      throw new ConvexError("Hours must be between 0 and 24.");
    }
    await ctx.db.insert("workOrderTime", {
      orgId: org.orgId,
      workOrderId: wo._id,
      technicianUserId: wo.technicianUserId ?? org.user._id,
      date: args.date,
      hours: args.hours,
      note: optText(args.note, 500),
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "time_added",
      actorUserId: org.user._id,
      to: String(args.hours),
    });
  },
});

export const addExpense = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    kind: v.union(v.literal("material"), v.literal("expense")),
    description: v.string(),
    amountCents: v.number(),
    quantity: v.optional(v.number()),
    receiptFileId: v.optional(v.id("workOrderFiles")),
    reimbursable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org, wo } = await workableJob(ctx, args.workOrderId);
    // Integer cents only: a float here would corrupt every later statement total.
    if (!Number.isSafeInteger(args.amountCents) || args.amountCents < 0 || args.amountCents > MAX_EXPENSE_CENTS) {
      throw new ConvexError("Amount must be a whole number of cents.");
    }
    if (args.quantity !== undefined && !(Number.isFinite(args.quantity) && args.quantity > 0)) {
      throw new ConvexError("Quantity must be more than zero.");
    }
    if (args.receiptFileId) {
      const file = await ctx.db.get(args.receiptFileId);
      if (!file || file.workOrderId !== wo._id) throw new ConvexError("Receipt not found.");
    }
    await ctx.db.insert("workOrderExpenses", {
      orgId: org.orgId,
      workOrderId: wo._id,
      technicianUserId: wo.technicianUserId ?? org.user._id,
      kind: args.kind,
      description: requireText(args.description, "Description", 300),
      amountCents: args.amountCents,
      quantity: args.quantity,
      receiptFileId: args.receiptFileId,
      reimbursable: args.reimbursable,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "expense_added",
      actorUserId: org.user._id,
      to: String(args.amountCents),
    });
  },
});

export const addNote = mutation({
  args: { workOrderId: v.id("workOrders"), body: v.string() },
  handler: async (ctx, args) => addWorkOrderNote(ctx, args.workOrderId, args.body),
});

/** Shared by workOrders.addNote and board.addComment (which caps the note at 1000). */
export async function addWorkOrderNote(
  ctx: MutationCtx,
  workOrderId: Id<"workOrders">,
  body: string,
  max = 2000,
): Promise<void> {
  const { org, wo } = await workableJob(ctx, workOrderId);
  await ctx.db.insert("workOrderNotes", {
    orgId: org.orgId,
    workOrderId: wo._id,
    authorUserId: org.user._id,
    body: requireText(body, "Note", max),
    createdAt: Date.now(),
  });
}

export const generateUploadUrl = mutation({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, args) => {
    await attachableJob(ctx, args.workOrderId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Records an uploaded file after checking what actually landed in storage. A rejected upload is
 * deleted and reported in the result rather than thrown (a throw would roll the delete back).
 */
export const attachFile = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    storageId: v.id("_storage"),
    kind: v.union(
      v.literal("completion_photo"),
      v.literal("completion_video"),
      v.literal("receipt"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, args) => attachWorkOrderFile(ctx, args.workOrderId, args.storageId, args.kind),
});

type WoFileKind = Doc<"workOrderFiles">["kind"];

/** Shared by workOrders.attachFile and board.attachMedia. */
export async function attachWorkOrderFile(
  ctx: MutationCtx,
  workOrderId: Id<"workOrders">,
  storageId: Id<"_storage">,
  fileKind: WoFileKind,
): Promise<{ ok: true; fileId: Id<"workOrderFiles"> } | { ok: false; error: string }> {
  const args = { workOrderId, storageId, kind: fileKind };
  {
    const { org, wo } = await attachableJob(ctx, args.workOrderId, { receipt: args.kind === "receipt" });
    const closedWo = !ACTIVE.includes(wo.status) && wo.status !== "completed";
    // Claimed or not freshly uploaded: refuse WITHOUT deleting (it may be someone else's file).
    const usable = await checkStorageUsable(ctx, org.orgId, args.storageId);
    if (usable) return { ok: false, error: usable };
    const reject = async (error: string) => {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, error };
    };
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) return { ok: false, error: "That upload wasn't found." };
    const type = meta.contentType ?? "";
    const isImage = type.startsWith("image/") && type !== "image/svg+xml"; // SVG can carry script
    const isVideo = VIDEO_TYPES.has(type);
    const isPdf = type === "application/pdf";
    if (args.kind === "completion_photo" && !isImage) return await reject("Photos must be image files.");
    if (args.kind === "completion_video" && !isVideo) {
      return await reject("Videos must be mp4, webm, or mov.");
    }
    if ((args.kind === "receipt" || args.kind === "other") && !(isImage || isPdf)) {
      return await reject("Attach a photo or a PDF.");
    }
    if (closedWo && !isImage && !isVideo) return await reject("Only photos and videos can be added to a closed work order.");
    const limit = isVideo ? VIDEO_MAX_BYTES : PHOTO_MAX_BYTES;
    if (meta.size > limit) {
      return await reject(isVideo ? "Videos can be at most 50 MB." : "Photos can be at most 15 MB.");
    }

    const already = await ctx.db
      .query("workOrderFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (already) return { ok: false, error: "That file is already attached." };
    const count = (
      await ctx.db
        .query("workOrderFiles")
        .withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id))
        .take(MAX_FILES_PER_WO)
    ).length;
    if (count >= MAX_FILES_PER_WO) return await reject("This work order has the maximum number of files.");

    const fileId = await ctx.db.insert("workOrderFiles", {
      orgId: org.orgId,
      workOrderId: wo._id,
      unitId: wo.unitId,
      storageId: args.storageId,
      kind: args.kind,
      uploadedByUserId: org.user._id,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "file_added",
      actorUserId: org.user._id,
      to: args.kind,
    });
    return { ok: true, fileId };
  }
}

/** Technician submits the job. Refuses, listing everything missing, until requirements are met. */
export const submitCompleted = mutation({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, args) => {
    const { org, wo } = await ownJob(ctx, args.workOrderId);
    assertWorkOrderTransition(wo.status, "completed");

    const [files, time, notes] = await Promise.all([
      ctx.db.query("workOrderFiles").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(MAX_FILES_PER_WO),
      ctx.db.query("workOrderTime").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(1),
      ctx.db.query("workOrderNotes").withIndex("by_work_order", (q) => q.eq("workOrderId", wo._id)).take(200),
    ]);
    const missing: string[] = [];
    if (
      wo.requiredOnSubmit.photos &&
      !files.some((f) => f.kind === "completion_photo" || f.kind === "completion_video")
    ) {
      missing.push("a completion photo or video");
    }
    if (wo.requiredOnSubmit.hours && time.length === 0) missing.push("hours worked");
    if (wo.requiredOnSubmit.receipts && !files.some((f) => f.kind === "receipt")) missing.push("a receipt");
    // Only the technician's own notes count; Pat's "sent back" note must not satisfy this.
    if (wo.requiredOnSubmit.notes && !notes.some((n) => n.authorUserId === org.user._id)) {
      missing.push("a note");
    }
    if (missing.length) throw new ConvexError(`Can't submit yet. Missing: ${missing.join(", ")}.`);

    const now = Date.now();
    await ctx.db.patch(wo._id, { status: "completed", completedAt: now, updatedAt: now });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "submitted",
      actorUserId: org.user._id,
      from: wo.status,
      to: "completed",
    });

    const unit = await ctx.db.get(wo.unitId);
    await scheduleNotify(ctx, {
      orgId: org.orgId,
      userIds: (await staffRecipientIds(ctx, org.orgId)).filter((id) => id !== org.user._id),
      template: "wo_submitted",
      data: { number: wo.number, unit: unit?.unitNumber, path: `/work-orders/${wo._id}` },
    });
  },
});

