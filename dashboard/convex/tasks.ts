import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { currentOrg, requireOrg, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { amScope, canSeeUnit, EMPTY_AM_SCOPE } from "./amScope";
import type { AmScope } from "./amScope";
import { checkStorageUsable } from "./maintenance";

/**
 * Task access, enforced server-side:
 *   read  - admin view: the whole team. Everyone else: tasks they created or are assigned to.
 *           An asset manager (AM) also reads tasks linked (unit / request / work order) to a unit
 *           they manage or cover.
 *   write - admin view; the creator or assignee; an AM on tasks linked to a unit they MANAGE
 *           (covering is read-only).
 * A task outside the caller's access reads as "not found".
 */
type TaskCtx = QueryCtx | MutationCtx;

async function scopeOf(ctx: TaskCtx, org: OrgContext): Promise<AmScope> {
  return viewFor(org.isAdmin, org.jobRoles) === "asset_manager" ? await amScope(ctx, org) : EMPTY_AM_SCOPE;
}

/** The unit a task is tied to: its own link, else its request's or work order's unit. */
async function linkedUnitId(
  ctx: TaskCtx,
  links: { unitId?: Id<"units">; requestId?: Id<"maintenanceRequests">; workOrderId?: Id<"workOrders"> },
): Promise<Id<"units"> | undefined> {
  if (links.unitId) return links.unitId;
  if (links.requestId) {
    const r = await ctx.db.get(links.requestId);
    if (r?.unitId) return r.unitId;
  }
  if (links.workOrderId) {
    const w = await ctx.db.get(links.workOrderId);
    if (w?.unitId) return w.unitId;
  }
  return undefined;
}

function isOwnTask(org: OrgContext, task: Doc<"tasks">): boolean {
  return task.userId === org.user._id || task.assigneeUserId === org.user._id;
}

async function canReadTask(ctx: TaskCtx, org: OrgContext, scope: AmScope, task: Doc<"tasks">): Promise<boolean> {
  if (task.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  if (isOwnTask(org, task)) return true;
  return canSeeUnit(scope, await linkedUnitId(ctx, task));
}

async function canWriteTask(ctx: TaskCtx, org: OrgContext, scope: AmScope, task: Doc<"tasks">): Promise<boolean> {
  if (task.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  if (isOwnTask(org, task)) return true;
  const unitId = await linkedUnitId(ctx, task);
  return unitId !== undefined && scope.managed.has(unitId);
}

async function ownedTask(ctx: MutationCtx, taskId: Id<"tasks">, org: OrgContext): Promise<Doc<"tasks">> {
  const task = await ctx.db.get(taskId);
  if (!task || !(await canWriteTask(ctx, org, await scopeOf(ctx, org), task))) throw new ConvexError("Task not found.");
  return task;
}

/**
 * Validates the optional record links a task can carry. Ids come from the client, so each one
 * is checked to belong to this team (and the assignee to be a member of it) before it is stored.
 */
async function checkLinks(
  ctx: MutationCtx,
  org: OrgContext,
  links: {
    assigneeUserId?: Id<"users">;
    unitId?: Id<"units">;
    requestId?: Id<"maintenanceRequests">;
    workOrderId?: Id<"workOrders">;
  },
): Promise<void> {
  if (links.assigneeUserId) {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", links.assigneeUserId!))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Assignee not found.");
  }
  // Admin view may link anything in the team; everyone else only records in their own scope.
  const admin = viewFor(org.isAdmin, org.jobRoles) === "admin";
  const scope = admin ? EMPTY_AM_SCOPE : await scopeOf(ctx, org);
  if (links.unitId) {
    const unit = await ctx.db.get(links.unitId);
    if (!unit || unit.orgId !== org.orgId || (!admin && !canSeeUnit(scope, unit._id))) {
      throw new ConvexError("Unit not found.");
    }
  }
  if (links.requestId) {
    const request = await ctx.db.get(links.requestId);
    if (
      !request ||
      request.orgId !== org.orgId ||
      (!admin && request.assignedAssetManagerUserId !== org.user._id && !canSeeUnit(scope, request.unitId))
    ) {
      throw new ConvexError("Request not found.");
    }
  }
  if (links.workOrderId) {
    const wo = await ctx.db.get(links.workOrderId);
    if (
      !wo ||
      wo.orgId !== org.orgId ||
      (!admin && wo.technicianUserId !== org.user._id && !canSeeUnit(scope, wo.unitId))
    ) {
      throw new ConvexError("Work order not found.");
    }
  }
}

function isAdminView(org: OrgContext): boolean {
  return viewFor(org.isAdmin, org.jobRoles) === "admin";
}

/**
 * Assignment rule: only the admin view may assign to anyone (membership checked in checkLinks).
 * Everyone else may only leave it empty or name themself.
 */
function checkAssigneeRule(org: OrgContext, assigneeUserId: Id<"users"> | undefined): void {
  if (isAdminView(org)) return;
  if (assigneeUserId !== undefined && assigneeUserId !== org.user._id) {
    throw new ConvexError("You can only assign tasks to yourself.");
  }
}

function displayName(user: Doc<"users">): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "Someone";
}

/**
 * The signed-in team's tasks. Empty (not an error) when signed out. `mine` narrows it to tasks
 * the caller created or is assigned to.
 */
export const list = query({
  args: { mine: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .collect();
    if (args.mine) return rows.filter((t) => isOwnTask(org, t));
    if (viewFor(org.isAdmin, org.jobRoles) === "admin") return rows;
    const scope = await scopeOf(ctx, org);
    const out: Doc<"tasks">[] = [];
    for (const t of rows) {
      if (await canReadTask(ctx, org, scope, t)) out.push(t);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("in_progress"), v.literal("completed")),
    ),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    category: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    // Files uploaded through the Create task modal's Attach files button before the task
    // existed — see taskAttachments in schema.ts. Linked to the new row right after insert.
    attachmentIds: v.optional(v.array(v.id("taskAttachments"))),
    assigneeUserId: v.optional(v.id("users")),
    unitId: v.optional(v.id("units")),
    requestId: v.optional(v.id("maintenanceRequests")),
    workOrderId: v.optional(v.id("workOrders")),
  },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const { orgId, user } = org;
    checkAssigneeRule(org, args.assigneeUserId);
    await checkLinks(ctx, org, args);
    const title = args.title.trim();
    if (!title) throw new ConvexError("Task title is required.");

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      orgId,
      userId: user._id,
      title,
      description: args.description?.trim() || undefined,
      status: args.status ?? "todo",
      priority: args.priority,
      category: args.category?.trim() || undefined,
      dueDate: args.dueDate,
      tags: args.tags?.length ? args.tags : undefined,
      // Non-admin tasks are always self-assigned (checkAssigneeRule rejected anyone else).
      assigneeUserId: isAdminView(org) ? args.assigneeUserId : user._id,
      unitId: args.unitId,
      requestId: args.requestId,
      workOrderId: args.workOrderId,
      createdAt: now,
      updatedAt: now,
    });

    for (const attachmentId of args.attachmentIds ?? []) {
      const attachment = await ctx.db.get(attachmentId);
      // Only link an attachment this same org uploaded and that isn't already claimed by
      // another task — guards against a stale or tampered id from the client.
      if (
        attachment &&
        attachment.orgId === orgId &&
        !attachment.taskId &&
        attachment.uploadedByUserId === user._id
      ) {
        await ctx.db.patch(attachmentId, { taskId });
      }
    }

    return taskId;
  },
});

/** Toggles a task between its current status and "completed" — the list view's checkbox. The
 * detail panel instead uses `update` below to set any of the three statuses directly. */
export const toggleComplete = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const task = await ownedTask(ctx, args.taskId, org);
    await ctx.db.patch(args.taskId, {
      status: task.status === "completed" ? "todo" : "completed",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Patches whichever fields the detail panel edited. Every field is optional so a single edit
 * (e.g. just the priority dropdown) doesn't require resending the whole task; `clearDueDate`
 * exists separately from `dueDate` because "not provided" and "clear this field" are different
 * requests and v.optional can't tell them apart on its own.
 */
export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("in_progress"), v.literal("completed")),
    ),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    dueDate: v.optional(v.number()),
    clearDueDate: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    assigneeUserId: v.optional(v.id("users")),
    clearAssignee: v.optional(v.boolean()),
    unitId: v.optional(v.id("units")),
    requestId: v.optional(v.id("maintenanceRequests")),
    workOrderId: v.optional(v.id("workOrders")),
    // Same reason as clearDueDate: "not provided" and "remove the links" are different requests.
    clearLinks: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    await ownedTask(ctx, args.taskId, org);
    checkAssigneeRule(org, args.assigneeUserId);
    await checkLinks(ctx, org, args);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new ConvexError("Task title is required.");
      patch.title = title;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.tags !== undefined) patch.tags = args.tags;
    if (args.clearDueDate) patch.dueDate = undefined;
    else if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    // Non-admins can't unassign either: that would reassign away from themselves.
    if (args.clearAssignee) {
      if (!isAdminView(org)) throw new ConvexError("Only an admin can change who a task is assigned to.");
      patch.assigneeUserId = undefined;
    }
    else if (args.assigneeUserId !== undefined) patch.assigneeUserId = args.assigneeUserId;
    if (args.clearLinks) {
      patch.unitId = undefined;
      patch.requestId = undefined;
      patch.workOrderId = undefined;
    } else {
      if (args.unitId !== undefined) patch.unitId = args.unitId;
      if (args.requestId !== undefined) patch.requestId = args.requestId;
      if (args.workOrderId !== undefined) patch.workOrderId = args.workOrderId;
    }

    await ctx.db.patch(args.taskId, patch);
  },
});

// --- Attachments -------------------------------------------------------------

/** Short-lived URL the client POSTs a file to. Shared by the Create task modal (no task yet —
 * see `attach` below) and the detail panel (task already exists). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Records an uploaded file against a task, or against no task yet when called from the Create
 * task modal — `create` above links it once the task is inserted. Either way the row is scoped
 * to this org immediately, so an abandoned pre-task upload is still attributable and cleanable.
 */
export const attach = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const { orgId, user } = org;
    if (args.taskId) await ownedTask(ctx, args.taskId, org);
    // Must be a fresh, unclaimed upload; never delete or adopt a file another record owns.
    const unusable = await checkStorageUsable(ctx, orgId, args.storageId);
    if (unusable) throw new ConvexError(unusable);

    return ctx.db.insert("taskAttachments", {
      taskId: args.taskId,
      orgId,
      storageId: args.storageId,
      fileName: args.fileName,
      uploadedByUserId: user._id,
      uploadedByName: displayName(user),
      createdAt: Date.now(),
    });
  },
});

/** A task's attached files, each with a fresh download URL. Scoped through the task's own org,
 * the same ownership check as `ownedTask` above but read-only. Also used for a not-yet-created
 * task's pending uploads (see NewTaskModal), where `taskId` is absent on the attachment rows
 * instead of pointing at a real task. */
export const attachments = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const task = await ctx.db.get(args.taskId);
    if (!task || !(await canReadTask(ctx, org, await scopeOf(ctx, org), task))) return [];

    const rows = await ctx.db
      .query("taskAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    return Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        fileName: row.fileName,
        uploadedByName: row.uploadedByName,
        createdAt: row.createdAt,
        url: await ctx.storage.getUrl(row.storageId),
      })),
    );
  },
});

export const removeAttachment = mutation({
  args: { attachmentId: v.id("taskAttachments") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.orgId !== org.orgId) throw new ConvexError("Attachment not found.");
    // Uploader, or anyone who may write the parent task.
    if (attachment.uploadedByUserId !== org.user._id) {
      const task = attachment.taskId ? await ctx.db.get(attachment.taskId) : null;
      if (!task || !(await canWriteTask(ctx, org, await scopeOf(ctx, org), task))) {
        throw new ConvexError("Attachment not found.");
      }
    }

    // Only delete the blob when no media / work-order file also points at it.
    const sharedElsewhere =
      (await ctx.db.query("maintenanceMedia").withIndex("by_storage", (q) => q.eq("storageId", attachment.storageId)).first()) ||
      (await ctx.db.query("workOrderFiles").withIndex("by_storage", (q) => q.eq("storageId", attachment.storageId)).first());
    if (!sharedElsewhere) await ctx.storage.delete(attachment.storageId);
    await ctx.db.delete(args.attachmentId);
  },
});
