import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import * as twilio from "./twilioApi";
import { currentOrg, requireAdminView, requireAdminViewId, tenantOrgId, viewFor } from "./authz";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Inbox access: admin view only (team admin, executive, maintenance lead, simplr_admin) and only
 * threads stamped with the caller's own team. Threads with no orgId are hidden from everyone
 * until threads.backfillOrgId has run.
 */
async function adminOrgOrNull(ctx: QueryCtx) {
  const org = await currentOrg(ctx);
  if (!org || viewFor(org.isAdmin, org.jobRoles) !== "admin") return null;
  return org;
}

const MAX_REPLY_CHARS = 1600;

// --- Reads ----------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const org = await adminOrgOrNull(ctx);
    if (!org) return [];
    return ctx.db
      .query("threads")
      .withIndex("by_org_and_last_message", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .take(500);
  },
});

export const messages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const org = await adminOrgOrNull(ctx);
    if (!org) return [];
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== org.orgId) return [];
    return ctx.db
      .query("smsMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

/** For staffReply: the thread only if it belongs to this team. */
export const getForOrg = internalQuery({
  args: { threadId: v.id("threads"), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    return thread && thread.orgId === args.orgId ? thread : null;
  },
});

/** One-off: stamps threads created before orgId existed with this deployment's single team. */
export const backfillOrgId = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const orgId = await tenantOrgId(ctx);
    if (!orgId) return 0;
    const rows = await ctx.db.query("threads").collect();
    let n = 0;
    for (const t of rows) {
      if (!t.orgId) {
        await ctx.db.patch(t._id, { orgId });
        n++;
      }
    }
    return n;
  },
});

export const getInternal = internalQuery({
  args: { threadId: v.id("threads") },
  handler: (ctx, args) => ctx.db.get(args.threadId),
});

export const recentMessages = internalQuery({
  args: { threadId: v.id("threads"), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("smsMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(args.limit);
    return rows.reverse().map((r) => ({ sender: r.sender, text: r.text }));
  },
});

// --- Writes ---------------------------------------------------------------

/**
 * Find-or-create the thread for an inbound number, record the message, and trigger a bot
 * reply if the thread isn't currently escalated to a human.
 */
export const ingestInbound = internalMutation({
  args: {
    channel: v.union(v.literal("sms"), v.literal("whatsapp")),
    customerPhone: v.string(),
    text: v.string(),
    twilioSid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (args.twilioSid) {
      const dup = await ctx.db
        .query("smsMessages")
        .filter((q) => q.eq(q.field("twilioSid"), args.twilioSid))
        .first();
      if (dup) return; // Twilio occasionally retries webhook delivery.
    }

    let thread = await ctx.db
      .query("threads")
      .withIndex("by_channel_and_phone", (q) =>
        q.eq("channel", args.channel).eq("customerPhone", args.customerPhone),
      )
      .first();

    const now = Date.now();
    // Single-tenant deployment: inbound SMS/WhatsApp has no per-team routing (one Twilio
    // number), so threads belong to the deployment's one team.
    const orgId = (await tenantOrgId(ctx)) ?? undefined;
    let threadId;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(threadId, { lastMessageAt: now, ...(thread.orgId ? {} : { orgId }) });
    } else {
      threadId = await ctx.db.insert("threads", {
        channel: args.channel,
        customerPhone: args.customerPhone,
        status: "bot",
        lastMessageAt: now,
        orgId,
      });
      thread = await ctx.db.get(threadId);
    }

    await ctx.db.insert("smsMessages", {
      threadId,
      sender: "customer",
      text: args.text,
      at: now,
      twilioSid: args.twilioSid,
    });

    if (thread?.status === "bot") {
      await ctx.scheduler.runAfter(0, internal.smsBot.respond, { threadId });
    }
  },
});

/** Sends an SMS and records it — used by both the bot and staff replies. */
export const sendMessage = internalAction({
  args: {
    threadId: v.id("threads"),
    sender: v.union(v.literal("bot"), v.literal("staff")),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.runQuery(internal.threads.getInternal, { threadId: args.threadId });
    if (!thread) return;
    if (thread.channel === "whatsapp") {
      await twilio.sendWhatsApp(thread.customerPhone, args.text);
    } else {
      await twilio.sendSms(thread.customerPhone, args.text);
    }
    await ctx.runMutation(internal.threads.recordOutbound, {
      threadId: args.threadId,
      sender: args.sender,
      text: args.text,
    });
  },
});

export const recordOutbound = internalMutation({
  args: {
    threadId: v.id("threads"),
    sender: v.union(v.literal("bot"), v.literal("staff")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("smsMessages", {
      threadId: args.threadId,
      sender: args.sender,
      text: args.text,
      at: Date.now(),
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });
  },
});

/** Marks a thread escalated and alerts staff by SMS with the reason and callback number. */
export const escalate = internalAction({
  args: { threadId: v.id("threads"), reason: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.runQuery(internal.threads.getInternal, { threadId: args.threadId });
    if (!thread) return;

    await ctx.runMutation(internal.threads.markEscalated, {
      threadId: args.threadId,
      reason: args.reason,
    });

    // Disabled: SMS alert to staff on escalation — turned off per request. The thread is still
    // marked escalated above and visible in /messages; only the outbound text is skipped.
    // Re-enable by uncommenting this block.
    // const staffNumber = await ctx.runQuery(internal.orgSettings.staffPhoneNumberInternal, {});
    // if (staffNumber) {
    //   const channelLabel = thread.channel === "whatsapp" ? "WhatsApp" : "Text";
    //   await twilio
    //     .sendSms(
    //       staffNumber,
    //       `${channelLabel} escalation: ${args.reason}. Reply to ${thread.customerPhone} ` +
    //         `(${thread.channel}) from the dashboard.`,
    //     )
    //     .catch(() => {
    //       // The thread is still visibly escalated in the dashboard even if the SMS ping fails.
    //     });
    // }
  },
});

export const markEscalated = internalMutation({
  args: { threadId: v.id("threads"), reason: v.string() },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "escalated", escalationReason: args.reason }),
});

/**
 * Staff replying from the dashboard always escalates the thread (per product decision): the
 * bot and a human must never both be texting the same thread at once.
 */
export const staffReply = action({
  args: { threadId: v.id("threads"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminViewId(ctx);
    const text = args.text.trim();
    if (!text || text.length > MAX_REPLY_CHARS) throw new Error("Message is empty or too long.");
    const thread: Id<"threads"> | null = (
      await ctx.runQuery(internal.threads.getForOrg, { threadId: args.threadId, orgId: org.orgId })
    )?._id ?? null;
    if (!thread) throw new Error("Thread not found.");
    await ctx.runMutation(internal.threads.markEscalated, {
      threadId: args.threadId,
      reason: "Staff replied directly.",
    });
    await ctx.runAction(internal.threads.sendMessage, {
      threadId: args.threadId,
      sender: "staff",
      text,
    });
  },
});

/** Hands a thread back to the bot for future messages. */
export const resumeBot = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== org.orgId) throw new Error("Thread not found.");
    await ctx.db.patch(args.threadId, { status: "bot", escalationReason: undefined });
  },
});
