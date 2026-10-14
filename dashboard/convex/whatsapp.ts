import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import * as waha from "./wahaApi";
import { clampSeverity } from "./severity";

// --- Reads ----------------------------------------------------------------

/** Last known session state. WAHA is the source of truth; this is just the cached view. */
export const session = query({
  args: {},
  handler: (ctx) => ctx.db.query("waSession").first(),
});

export const threads = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("waThreads")
      .withIndex("by_last_message")
      .order("desc")
      .collect();

    return Promise.all(
      rows.map(async (t) => {
        const lead = await ctx.db
          .query("waLeads")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .first();
        const issue = await ctx.db
          .query("waIssues")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .first();
        const msgs = await ctx.db
          .query("waMessages")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect();
        const last = msgs[msgs.length - 1];
        return {
          ...t,
          lead,
          issue,
          lastMessagePreview: last?.text ?? null,
          lastMessageSender: last?.sender ?? null,
        };
      }),
    );
  },
});

export const messages = query({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) =>
    ctx.db
      .query("waMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect(),
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const threadRows = await ctx.db.query("waThreads").collect();
    const issueRows = await ctx.db.query("waIssues").collect();
    const leadRows = await ctx.db.query("waLeads").collect();
    return {
      threads: threadRows.length,
      escalated: threadRows.filter((t) => t.status === "escalated").length,
      openIssues: issueRows.filter((i) => i.status === "open").length,
      qualifiedLeads: leadRows.filter((l) => l.qualifies === true).length,
    };
  },
});

// --- Prompt configuration -------------------------------------------------

/** The editable WhatsApp prompt. Null until someone saves one; the bot falls back to the default. */
export const config = query({
  args: {},
  handler: (ctx) => ctx.db.query("waConfig").first(),
});

export const configInternal = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("waConfig").first(),
});

export const saveConfig = mutation({
  args: { systemPrompt: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("waConfig").first();
    const row = { systemPrompt: args.systemPrompt, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("waConfig", row);
  },
});

// --- Session lifecycle ----------------------------------------------------

export const upsertSession = internalMutation({
  args: {
    status: v.string(),
    phoneNumber: v.optional(v.string()),
    connected: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("waSession").first();
    const row = {
      sessionName: waha.SESSION_NAME,
      status: args.status,
      phoneNumber: args.phoneNumber,
      connectedAt: args.connected ? (existing?.connectedAt ?? Date.now()) : undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("waSession", row);
  },
});

/**
 * Starts (or revives) the WhatsApp session. Safe to call repeatedly — the page calls it
 * whenever the user clicks Connect, including on a session that is already half-alive.
 */
export const connect = action({
  args: {},
  handler: async (ctx): Promise<{ status: string }> => {
    if (!waha.isConfigured()) {
      throw new Error(
        "WhatsApp is not configured. Set WAHA_BASE_URL and WAHA_API_KEY — see infra/waha/README.md.",
      );
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not set on this deployment.");

    await waha.startSession(`${siteUrl}/wa/webhook`);

    const s = await waha.getSession();
    const status = s?.status ?? "UNKNOWN";
    await ctx.runMutation(internal.whatsapp.upsertSession, {
      status,
      connected: status === "WORKING",
    });
    return { status };
  },
});

/**
 * Status plus, when WhatsApp is waiting for a scan, the QR payload. The page polls this
 * while the dialog is open — WAHA rotates the QR every ~20s, so a stale one stops working.
 */
export const statusAndQr = action({
  args: {},
  handler: async (ctx): Promise<{ status: string; qr: string | null; configured: boolean }> => {
    if (!waha.isConfigured()) {
      return { status: "not_configured", qr: null, configured: false };
    }

    const s = await waha.getSession();
    if (!s) {
      await ctx.runMutation(internal.whatsapp.upsertSession, {
        status: "STOPPED",
        connected: false,
      });
      return { status: "STOPPED", qr: null, configured: true };
    }

    const phoneNumber = s.me?.id?.replace(/@.*/, "");
    await ctx.runMutation(internal.whatsapp.upsertSession, {
      status: s.status,
      phoneNumber,
      connected: s.status === "WORKING",
    });

    const qr = s.status === "SCAN_QR_CODE" ? await waha.getQr() : null;
    return { status: s.status, qr, configured: true };
  },
});

/** Stops the session but keeps the WhatsApp login, so reconnecting needs no new scan. */
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    await waha.stopSession();
    await ctx.runMutation(internal.whatsapp.upsertSession, {
      status: "STOPPED",
      connected: false,
    });
  },
});

/** Full logout — the number is unlinked and the next connect needs a fresh QR scan. */
export const unlink = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    await waha.logoutSession();
    await ctx.runMutation(internal.whatsapp.upsertSession, {
      status: "STOPPED",
      connected: false,
    });
  },
});

// --- Inbox actions --------------------------------------------------------

export const markRead = mutation({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) => ctx.db.patch(args.threadId, { unreadCount: 0 }),
});

/** Hands the thread back to the bot after a human is done with it. */
export const resumeBot = mutation({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "bot", escalationReason: undefined }),
});

export const takeOver = mutation({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "escalated", escalationReason: "taken over by staff" }),
});

/**
 * Staff reply. Sending also takes the thread off the bot — two of them answering the same
 * person at once is worse than no reply at all.
 */
export const staffReply = action({
  args: { threadId: v.id("waThreads"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.runQuery(internal.waBot.threadForBot, { threadId: args.threadId });
    if (!thread) throw new Error("Thread not found");

    // Same reasoning as the bot path: record the attempt before deciding whether to raise,
    // so a staff message is never lost just because WAHA was unreachable.
    let delivered = false;
    try {
      delivered = await waha.sendText(thread.chatId, args.text);
    } catch {
      delivered = false;
    }
    await ctx.runMutation(internal.waBot.recordOutbound, {
      threadId: args.threadId,
      sender: "staff",
      text: args.text,
      delivered,
    });
    if (thread.status === "bot") {
      await ctx.runMutation(internal.waBot.markEscalated, {
        threadId: args.threadId,
        reason: "staff replied",
      });
    }
    if (!delivered) {
      throw new Error("WhatsApp did not accept the message — check the WAHA session status.");
    }
  },
});

export const updateIssue = mutation({
  args: {
    issueId: v.id("waIssues"),
    severity: v.optional(v.number()),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.severity !== undefined) {
      const next = clampSeverity(args.severity);
      if (next !== issue.severity) {
        if (issue.originalSeverity === undefined) patch.originalSeverity = issue.severity;
        patch.severity = next;
      }
    }
    await ctx.db.patch(args.issueId, patch);
  },
});

/** Done with this conversation. Closed threads stay readable but drop out of the open list. */
export const closeThread = mutation({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) => ctx.db.patch(args.threadId, { status: "closed" }),
});

/** Reopening hands the thread back to the bot, which is almost always what you want. */
export const reopenThread = mutation({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "bot", escalationReason: undefined }),
});

/**
 * WhatsApp gives us a phone number, not a name. Once you know who it is, renaming makes the
 * inbox readable — the bot's own captured name is used first, but this always wins.
 */
export const renameThread = mutation({
  args: { threadId: v.id("waThreads"), displayName: v.string() },
  handler: async (ctx, args) => {
    const name = args.displayName.trim();
    if (!name) return;
    await ctx.db.patch(args.threadId, { displayName: name });
  },
});
