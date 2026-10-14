import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { currentOrg, requireOrg } from "./authz";

async function ownedTask(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  orgId: string,
): Promise<Doc<"tasks">> {
  const task = await ctx.db.get(taskId);
  if (!task || task.orgId !== orgId) throw new Error("Task not found.");
  return task;
}

function displayName(user: Doc<"users">): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "Someone";
}

/** The signed-in team's tasks. Empty (not an error) when signed out. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    return ctx.db
      .query("tasks")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .collect();
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
  },
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
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
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    await ownedTask(ctx, args.taskId, orgId);

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
