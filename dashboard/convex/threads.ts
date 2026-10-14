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

// --- Reads ----------------------------------------------------------------

export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query("threads").order("desc").collect(),
});

export const messages = query({
  args: { threadId: v.id("threads") },
  handler: (ctx, args) =>
    ctx.db
      .query("smsMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect(),
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
    let threadId;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(threadId, { lastMessageAt: now });
    } else {
      threadId = await ctx.db.insert("threads", {
        channel: args.channel,
        customerPhone: args.customerPhone,
        status: "bot",
        lastMessageAt: now,
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
    await ctx.runMutation(internal.threads.markEscalated, {
      threadId: args.threadId,
      reason: "Staff replied directly.",
    });
    await ctx.runAction(internal.threads.sendMessage, {
      threadId: args.threadId,
      sender: "staff",
      text: args.text,
    });
  },
});

/** Hands a thread back to the bot for future messages. */
export const resumeBot = mutation({
  args: { threadId: v.id("threads") },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "bot", escalationReason: undefined }),
});
