import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { currentOrg, requireOrg } from "./authz";
import type { OrgContext } from "./authz";

async function ownedTask(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  orgId: string,
): Promise<Doc<"tasks">> {
  const task = await ctx.db.get(taskId);
  if (!task || task.orgId !== orgId) throw new Error("Task not found.");
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
    if (!membership || membership.orgId !== org.orgId) throw new Error("Assignee not found.");
  }
  if (links.unitId) {
    const unit = await ctx.db.get(links.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");
  }
  if (links.requestId) {
    const request = await ctx.db.get(links.requestId);
    if (!request || request.orgId !== org.orgId) throw new Error("Request not found.");
  }
  if (links.workOrderId) {
    const wo = await ctx.db.get(links.workOrderId);
    if (!wo || wo.orgId !== org.orgId) throw new Error("Work order not found.");
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
    if (!args.mine) return rows;
    return rows.filter((t) => t.userId === org.user._id || t.assigneeUserId === org.user._id);
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
    await checkLinks(ctx, org, args);
    const title = args.title.trim();
    if (!title) throw new Error("Task title is required.");

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
      assigneeUserId: args.assigneeUserId,
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
      if (attachment && attachment.orgId === orgId && !attachment.taskId) {
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
    const { orgId } = await requireOrg(ctx);
    const task = await ownedTask(ctx, args.taskId, orgId);
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
    const { orgId } = org;
    await ownedTask(ctx, args.taskId, orgId);
    await checkLinks(ctx, org, args);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Task title is required.");
      patch.title = title;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.tags !== undefined) patch.tags = args.tags;
    if (args.clearDueDate) patch.dueDate = undefined;
    else if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    if (args.clearAssignee) patch.assigneeUserId = undefined;
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
    const { orgId, user } = await requireOrg(ctx);
    if (args.taskId) await ownedTask(ctx, args.taskId, orgId);

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
    if (!task || task.orgId !== org.orgId) return [];

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
    const { orgId } = await requireOrg(ctx);
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.orgId !== orgId) throw new Error("Attachment not found.");

    await ctx.storage.delete(attachment.storageId);
    await ctx.db.delete(args.attachmentId);
  },
});
