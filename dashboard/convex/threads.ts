import { ConvexError, v } from "convex/values";
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
import { currentOrg, isAdminView, requireAdminView, requireAdminViewId, tenantOrgId } from "./authz";
import type { QueryCtx } from "./_generated/server";

/**
 * Inbox access: admin view only (team admin, executive, maintenance lead, simplr_admin) and only
 * threads stamped with the caller's own team. Threads with no orgId are hidden from everyone
 * until threads.backfillOrgId has run.
 */
async function adminOrgOrNull(ctx: QueryCtx) {
  const org = await currentOrg(ctx);
  if (!org || !isAdminView(org)) return null;
  return org;
}

// --- Reads ----------------------------------------------------------------

/** Inbox filter: everything, escalated threads, or one channel. */
const threadFilterValidator = v.union(
  v.literal("all"),
  v.literal("escalated"),
  v.literal("sms"),
  v.literal("whatsapp"),
);

/**
 * One page of the team's threads, newest activity first. Paged with an opaque cursor (null for
 * the first page); a filter runs after the indexed read, so a page can come back short while more
 * follow (check isDone). Rows per page: 25, 50 (default) or 100.
 */
export const list = query({
  args: {
    filter: v.optional(threadFilterValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await adminOrgOrNull(ctx);
    if (!org) return { page: [], isDone: true, continueCursor: "" };
    const numItems = args.pageSize === 25 || args.pageSize === 100 ? args.pageSize : 50;
    const filter = args.filter ?? "all";
    return ctx.db
      .query("threads")
      .withIndex("by_org_and_last_message", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .filter((q) =>
        filter === "escalated"
          ? q.eq(q.field("status"), "escalated")
          : filter === "sms" || filter === "whatsapp"
            ? q.eq(q.field("channel"), filter)
            : q.eq(true, true),
      )
      .paginate({ numItems, cursor: args.cursor ?? null });
  },
});

/** The open conversation's thread, wherever it falls in the paged list; null if it is not this team's. */
export const byId = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const org = await adminOrgOrNull(ctx);
    if (!org) return null;
    const thread = await ctx.db.get(args.threadId);
    return thread && thread.orgId === org.orgId ? thread : null;
  },
});

/**
 * The latest `limit` messages of a thread (oldest first, as a chat reads), and whether earlier
 * ones exist. The page raises `limit` for "Load earlier messages".
 */
export const messages = query({
  args: { threadId: v.id("threads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const org = await adminOrgOrNull(ctx);
    if (!org) return { messages: [], hasMore: false };
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== org.orgId) return { messages: [], hasMore: false };
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.min(Math.max(Math.floor(args.limit), 1), 1000)
        : 50;
    const rows = await ctx.db
      .query("smsMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit + 1);
    return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
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
    // Texting policy: bot replies and staff replies are not allowlisted. Nothing is sent and
    // nothing is recorded as sent; the inbound message stays in the inbox.
    if (!twilio.isSmsAllowed(undefined)) {
      console.log(`threads.sendMessage: ${args.sender} reply on ${thread.channel} not sent, texting is off`);
      return;
    }
    const sent =
      thread.channel === "whatsapp"
        ? await twilio.sendWhatsApp(thread.customerPhone, args.text)
        : await twilio.sendSms(thread.customerPhone, args.text);
    // false = dropped (allowlist or the OUTBOUND_ENABLED master switch): never recorded as sent.
    if (!sent) return;
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
 * Staff replying from the dashboard is off while the texting policy only allows emergency alerts
 * (twilioApi.SMS_ALLOWED_TEMPLATES). Throws before anything is written, so a reply that cannot go
 * out never escalates the thread.
 */
export const staffReply = action({
  args: { threadId: v.id("threads"), text: v.string() },
  handler: async (ctx): Promise<void> => {
    await requireAdminViewId(ctx);
    throw new ConvexError("Texting is turned off for now except emergency alerts.");
  },
});

/** Hands a thread back to the bot for future messages. */
export const resumeBot = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== org.orgId) throw new ConvexError("Thread not found.");
    await ctx.db.patch(args.threadId, { status: "bot", escalationReason: undefined });
  },
});
