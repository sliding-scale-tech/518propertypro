import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { canManageMaintenance, currentOrg, requireOrg, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { nextNumber } from "./counters";
import { markWorkOrderCreated } from "./maintenance";
import { scheduleNotify, staffRecipientIds } from "./notify";

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
const MAX_CHECKLIST = 40;
const MAX_FILES_PER_WO = 40;
const FILE_MAX_BYTES = 15 * 1024 * 1024;
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
    throw new Error(`A work order that is "${from.replace(/_/g, " ")}" can't be moved to "${to.replace(/_/g, " ")}".`);
  }
}

// --- Checklist templates --------------------------------------------------------

const DEFAULT_CHECKLISTS: Record<string, string[]> = {
  electrical: [
    "Power off at the breaker before starting",
    "Diagnose and repair the fault",
    "Test circuit and outlets after repair",
    "Restore power and confirm with the tenant",
  ],
  water_leak: [
    "Locate the source and shut off water if needed",
    "Repair or replace the failing part",
    "Check for hidden moisture or damage",
    "Test for leaks under pressure",
    "Clean up the area",
  ],
  broken_item: [
    "Inspect the item and confirm the fault",
    "Repair or replace the item",
    "Test that it works",
    "Clean up the area",
  ],
  gas: [
    "Confirm the gas supply is shut off",
    "Check for leaks with approved equipment",
    "Repair, or escalate to the utility",
    "Re-test after repair before restoring gas",
  ],
  fire: [
    "Confirm the scene is safe and the fire is out",
    "Document damage with photos",
    "Make the unit safe (power, water, access)",
    "Report remaining work to the maintenance lead",
  ],
  flooding: [
    "Stop the water source",
    "Extract standing water",
    "Document damage with photos",
    "Set drying equipment if needed",
    "Report remaining work to the maintenance lead",
  ],
  tenant_responsibility: [
    "Confirm the cause with the tenant",
    "Document the finding with photos",
    "Report back to the maintenance lead",
  ],
  other: ["Inspect and diagnose", "Complete the repair", "Test the result", "Clean up the area"],
};

function defaultItems(issueType: string): string[] {
  return DEFAULT_CHECKLISTS[issueType] ?? DEFAULT_CHECKLISTS.other;
}

/** Checklist to prefill the create form: the team's saved template, else the built-in default. */
export const checklistFor = query({
  args: { issueType: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return [];
    const saved = await ctx.db
      .query("checklistTemplates")
      .withIndex("by_org_and_issue_type", (q) => q.eq("orgId", org.orgId).eq("issueType", args.issueType))
      .first();
    return saved?.items ?? defaultItems(args.issueType);
  },
});

export const saveChecklistTemplate = mutation({
  args: { issueType: v.string(), items: v.array(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canManageMaintenance(org)) throw new Error("You don't have access to that.");
    const issueType = requireText(args.issueType, "Issue type", 40);
    const items = args.items.map((i) => i.trim()).filter(Boolean);
    if (items.length > MAX_CHECKLIST || items.some((i) => i.length > 200)) {
      throw new Error("Checklists can have at most 40 items of 200 characters.");
    }
    const existing = await ctx.db
      .query("checklistTemplates")
      .withIndex("by_org_and_issue_type", (q) => q.eq("orgId", org.orgId).eq("issueType", issueType))
      .first();
    if (existing) await ctx.db.patch(existing._id, { items });
    else await ctx.db.insert("checklistTemplates", { orgId: org.orgId, issueType, items });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "config",
      entityId: issueType,
      action: "checklist_template_saved",
      actorUserId: org.user._id,
    });
  },
});

/** Writes the built-in defaults for any issue type the team hasn't customised. Idempotent. */
export const seedChecklistTemplates = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<number> => {
    let added = 0;
    for (const [issueType, items] of Object.entries(DEFAULT_CHECKLISTS)) {
      const existing = await ctx.db
        .query("checklistTemplates")
        .withIndex("by_org_and_issue_type", (q) => q.eq("orgId", args.orgId).eq("issueType", issueType))
        .first();
      if (!existing) {
        await ctx.db.insert("checklistTemplates", { orgId: args.orgId, issueType, items });
        added += 1;
      }
    }
    return added;
  },
});

// --- Helpers ---------------------------------------------------------------------

function requireText(raw: string, label: string, max: number): string {
  const out = raw.trim();
  if (!out) throw new Error(`${label} is required.`);
  if (out.length > max) throw new Error(`${label} is too long.`);
  return out;
}

function optText(raw: string | undefined, max: number): string | undefined {
  const out = raw?.trim();
  if (!out) return undefined;
  if (out.length > max) throw new Error("That text is too long.");
  return out;
}

function buildChecklist(items: Array<{ label: string; required: boolean }>): Doc<"workOrders">["checklist"] {
  if (items.length > MAX_CHECKLIST) throw new Error(`At most ${MAX_CHECKLIST} checklist items.`);
  return items.map((item, i) => ({
    id: `c${i + 1}`,
    label: requireText(item.label, "Checklist item", 200),
    required: item.required,
    done: false,
  }));
}

/** A technician must be on THIS team and hold the technician role (no admin fallback). */
async function assertTechnician(ctx: QueryCtx | MutationCtx, orgId: string, userId: Id<"users">) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.orgId !== orgId || !(membership.jobRoles ?? []).includes("technician")) {
    throw new Error("That person is not a technician on this team.");
  }
}

/**
 * Read scope. Returns the work order plus its unit when `org` may see it, else null.
 * Accountants see only finished work; technicians only their own jobs.
 */
async function readable(
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
  if (view === "asset_manager" && unit.assetManagerUserId === org.user._id) return { wo, unit };
  if (view === "technician" && wo.technicianUserId === org.user._id) return { wo, unit };
  if (view === "accountant" && (wo.status === "completed" || wo.status === "reviewed_closed")) return { wo, unit };
  return null;
}

/**
 * May this person change the work order's scope/assignment/cancel it? Pat powers always; an AM
 * only the manual work orders they created on units they manage.
 */
function canManageWo(org: OrgContext, wo: Doc<"workOrders">, unit: Doc<"units">): boolean {
  if (canManageMaintenance(org)) return true;
  return (
    org.jobRoles.includes("asset_manager") &&
    unit.assetManagerUserId === org.user._id &&
    !wo.requestId &&
    wo.createdBy === org.user._id
  );
}

async function managedWo(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const found = await readable(ctx, org, id);
  if (!found) throw new Error("Work order not found.");
  if (!canManageWo(org, found.wo, found.unit)) throw new Error("You don't have access to that.");
  return { org, ...found };
}

/** The technician's own work order, or "not found" (same answer for missing and not theirs). */
async function ownJob(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const wo = await ctx.db.get(id);
  if (!wo || wo.orgId !== org.orgId || wo.technicianUserId !== org.user._id) {
    throw new Error("Work order not found.");
  }
  return { org, wo };
}

/** Tech or manager may add work to a job: techs only while it is in progress. */
async function workableJob(ctx: MutationCtx, id: Id<"workOrders">) {
  const org = await requireOrg(ctx);
  const found = await readable(ctx, org, id);
  if (!found) throw new Error("Work order not found.");
  const isTech = found.wo.technicianUserId === org.user._id && viewFor(org.isAdmin, org.jobRoles) === "technician";
  const manager = canManageWo(org, found.wo, found.unit);
  if (!isTech && !manager) throw new Error("You don't have access to that.");
  if (isTech && !manager && found.wo.status !== "in_progress") {
    throw new Error("Start the job before adding to it.");
  }
  if (!ACTIVE.includes(found.wo.status) && found.wo.status !== "completed") {
    throw new Error("This work order is closed.");
  }
  return { org, ...found };
}

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
    checklist: v.array(v.object({ label: v.string(), required: v.boolean() })),
    technicianUserId: v.optional(v.id("users")),
    accessNotes: v.optional(v.string()),
    requiredOnSubmit: requiredOnSubmitValidator,
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"workOrders">> => {
    const org = await requireOrg(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");

    let request: Doc<"maintenanceRequests"> | null = null;
    if (args.requestId) {
      // Turning a request into a work order is Pat's decision; an AM can only forward it.
      if (!canManageMaintenance(org)) throw new Error("You don't have access to that.");
      request = await ctx.db.get(args.requestId);
      if (!request || request.orgId !== org.orgId) throw new Error("Request not found.");
      if (request.unitId !== unit._id) throw new Error("Resolve the request's unit first.");
      const existing = await ctx.db
        .query("workOrders")
        .withIndex("by_request", (q) => q.eq("requestId", request!._id))
        .collect();
      if (existing.some((w) => w.status !== "cancelled")) {
        throw new Error("This request already has a work order.");
      }
    } else {
      const adminView = viewFor(org.isAdmin, org.jobRoles) === "admin";
      const ownAm = org.jobRoles.includes("asset_manager") && unit.assetManagerUserId === org.user._id;
      if (!adminView && !ownAm) throw new Error("You don't have access to that.");
    }

    if (args.technicianUserId) await assertTechnician(ctx, org.orgId, args.technicianUserId);
    if (args.dueDate !== undefined && !(args.dueDate > 0)) throw new Error("Pick a valid due date.");

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
      checklist: buildChecklist(args.checklist),
      technicianUserId: args.technicianUserId,
      accessNotes: optText(args.accessNotes, 1000),
      requiredOnSubmit: args.requiredOnSubmit,
      status: args.technicianUserId ? "assigned" : "created",
      dueDate: args.dueDate,
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
      const mine = await ctx.db
        .query("units")
        .withIndex("by_asset_manager", (q) => q.eq("assetManagerUserId", org.user._id))
        .collect();
      for (const unit of mine) {
        rows.push(
          ...(await ctx.db
            .query("workOrders")
            .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
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
      out.push({
        ...w,
        unitNumber: units.get(w.unitId),
        propertyName: properties.get(w.propertyId),
        technicianName,
        requestNumber: request?.number,
        checklistDone: w.checklist.filter((c) => c.done).length,
        checklistTotal: w.checklist.length,
        isOverdue: ACTIVE.includes(w.status) && w.dueDate !== undefined && w.dueDate < Date.now(),
      });
    }
    return out;
  },
});

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
      workOrder: wo,
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
        fileRows.map(async (f) => ({
          _id: f._id,
          kind: f.kind,
          createdAt: f.createdAt,
          uploadedByUserId: f.uploadedByUserId,
          url: await ctx.storage.getUrl(f.storageId),
        })),
      ),
      time,
      expenses,
      notes,
      totals: {
        hours: time.reduce((sum, t) => sum + t.hours, 0),
        expenseCents: expenses.reduce((sum, e) => sum + e.amountCents, 0),
      },
      audit,
      viewerCan: {
        manage: canManageWo(org, wo, unit),
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
  args: { workOrderId: v.id("workOrders"), technicianUserId: v.id("users") },
  handler: async (ctx, args) => {
    const { org, wo, unit } = await managedWo(ctx, args.workOrderId);
    if (!ACTIVE.includes(wo.status)) throw new Error("This work order can no longer be reassigned.");
    await assertTechnician(ctx, org.orgId, args.technicianUserId);
    if (wo.technicianUserId === args.technicianUserId) return;

    const to: Status = wo.status === "created" ? "assigned" : wo.status;
    if (to !== wo.status) assertWorkOrderTransition(wo.status, to);
    await ctx.db.patch(wo._id, { technicianUserId: args.technicianUserId, status: to, updatedAt: Date.now() });
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
    checklist: v.optional(v.array(v.object({ label: v.string(), required: v.boolean() }))),
    requiredOnSubmit: v.optional(requiredOnSubmitValidator),
  },
  handler: async (ctx, args) => {
    const { org, wo, unit } = await managedWo(ctx, args.workOrderId);
    if (!ACTIVE.includes(wo.status)) throw new Error("This work order is no longer editable.");

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
      if (!(args.dueDate > 0)) throw new Error("Pick a valid due date.");
      patch.dueDate = args.dueDate;
      changed.push("due date");
    }
    if (args.requiredOnSubmit) {
      patch.requiredOnSubmit = args.requiredOnSubmit;
      changed.push("submit requirements");
    }
    if (args.checklist) {
      // Items keep their done state when the label is unchanged, so editing the list
      // mid-job doesn't wipe the technician's progress.
      const doneByLabel = new Map(wo.checklist.map((c) => [c.label, c]));
      patch.checklist = buildChecklist(args.checklist).map((item) => {
        const prev = doneByLabel.get(item.label);
        return prev?.done ? { ...item, done: true, doneAt: prev.doneAt, doneBy: prev.doneBy } : item;
      });
      changed.push("checklist");
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
    if (!canManageMaintenance(org)) throw new Error("You don't have access to that.");
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) throw new Error("Work order not found.");
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
    if (!canManageMaintenance(org)) throw new Error("You don't have access to that.");
    const found = await readable(ctx, org, args.workOrderId);
    if (!found) throw new Error("Work order not found.");
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

export const toggleChecklistItem = mutation({
  args: { workOrderId: v.id("workOrders"), itemId: v.string(), done: v.boolean() },
  handler: async (ctx, args) => {
    const { org, wo } = await ownJob(ctx, args.workOrderId);
    if (wo.status !== "in_progress") throw new Error("Start the job before ticking items off.");
    const item = wo.checklist.find((c) => c.id === args.itemId);
    if (!item) throw new Error("Checklist item not found.");
    if (item.done === args.done) return;

    const now = Date.now();
    await ctx.db.patch(wo._id, {
      checklist: wo.checklist.map((c) =>
        c.id === args.itemId
          ? args.done
            ? { ...c, done: true, doneAt: now, doneBy: org.user._id }
            : { id: c.id, label: c.label, required: c.required, done: false }
          : c,
      ),
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: args.done ? "checklist_checked" : "checklist_unchecked",
      actorUserId: org.user._id,
      note: item.label,
    });
  },
});

export const addTime = mutation({
  args: { workOrderId: v.id("workOrders"), date: v.string(), hours: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, wo } = await workableJob(ctx, args.workOrderId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date))) {
      throw new Error("Date must look like 2026-11-03.");
    }
    if (!Number.isFinite(args.hours) || args.hours <= 0 || args.hours > 24) {
      throw new Error("Hours must be between 0 and 24.");
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
      throw new Error("Amount must be a whole number of cents.");
    }
    if (args.quantity !== undefined && !(Number.isFinite(args.quantity) && args.quantity > 0)) {
      throw new Error("Quantity must be more than zero.");
    }
    if (args.receiptFileId) {
      const file = await ctx.db.get(args.receiptFileId);
      if (!file || file.workOrderId !== wo._id) throw new Error("Receipt not found.");
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
  handler: async (ctx, args) => {
    const { org, wo } = await workableJob(ctx, args.workOrderId);
    await ctx.db.insert("workOrderNotes", {
      orgId: org.orgId,
      workOrderId: wo._id,
      authorUserId: org.user._id,
      body: requireText(args.body, "Note", 2000),
      createdAt: Date.now(),
    });
  },
});

export const generateUploadUrl = mutation({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, args) => {
    await workableJob(ctx, args.workOrderId);
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
    kind: v.union(v.literal("completion_photo"), v.literal("receipt"), v.literal("other")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; fileId: Id<"workOrderFiles"> } | { ok: false; error: string }> => {
    const { org, wo } = await workableJob(ctx, args.workOrderId);
    const reject = async (error: string) => {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, error };
    };
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) return { ok: false, error: "That upload wasn't found." };
    const type = meta.contentType ?? "";
    const isImage = type.startsWith("image/") && type !== "image/svg+xml"; // SVG can carry script
    const isPdf = type === "application/pdf";
    if (!(isImage || (isPdf && args.kind !== "completion_photo"))) {
      return await reject(
        args.kind === "completion_photo" ? "Completion files must be photos." : "Attach a photo or a PDF.",
      );
    }
    if (meta.size > FILE_MAX_BYTES) return await reject("Files can be at most 15 MB.");

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
  },
});

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
    const openRequired = wo.checklist.filter((c) => c.required && !c.done);
    if (openRequired.length) {
      missing.push(`${openRequired.length} required checklist item${openRequired.length === 1 ? "" : "s"}`);
    }
    if (wo.requiredOnSubmit.photos && !files.some((f) => f.kind === "completion_photo")) {
      missing.push("a completion photo");
    }
    if (wo.requiredOnSubmit.hours && time.length === 0) missing.push("hours worked");
    if (wo.requiredOnSubmit.receipts && !files.some((f) => f.kind === "receipt")) missing.push("a receipt");
    // Only the technician's own notes count; Pat's "sent back" note must not satisfy this.
    if (wo.requiredOnSubmit.notes && !notes.some((n) => n.authorUserId === org.user._id)) {
      missing.push("a note");
    }
    if (missing.length) throw new Error(`Can't submit yet. Missing: ${missing.join(", ")}.`);

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

