import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import * as waha from "./wahaApi";
import { clampSeverity } from "./severity";

// --- Reads ----------------------------------------------------------------

/** Last known session state. WAHA is the source of truth; this is just the cached view. */
export const session = query({
  args: {},
  handler: (ctx) => ctx.db.query("waSession").first(),
});

/** Thread list filter: one status, or everything. */
const threadFilterValidator = v.union(
  v.literal("all"),
  v.literal("bot"),
  v.literal("escalated"),
  v.literal("closed"),
);

/** Rows per page: 25, 50 (default) or 100; anything else means 50. */
function pageSizeOf(raw: number | null | undefined): number {
  return raw === 25 || raw === 100 ? raw : 50;
}

/** A thread with what the inbox row and the chat header show: lead, issue and the latest message. */
async function withDetails(ctx: QueryCtx, t: Doc<"waThreads">) {
  const lead = await ctx.db
    .query("waLeads")
    .withIndex("by_thread", (q) => q.eq("threadId", t._id))
    .first();
  const issue = await ctx.db
    .query("waIssues")
    .withIndex("by_thread", (q) => q.eq("threadId", t._id))
    .first();
  const last = await ctx.db
    .query("waMessages")
    .withIndex("by_thread", (q) => q.eq("threadId", t._id))
    .order("desc")
    .first();
  return {
    ...t,
    lead,
    issue,
    lastMessagePreview: last?.text ?? null,
    lastMessageSender: last?.sender ?? null,
  };
}

/**
 * One page of the inbox, newest activity first, optionally one status. Paged with an opaque cursor
 * (null for the first page); a status filter runs after the indexed read, so a page can come back
 * short while more follow (check isDone).
 */
export const threads = query({
  args: {
    status: v.optional(threadFilterValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const status = args.status && args.status !== "all" ? args.status : null;
    const result = await ctx.db
      .query("waThreads")
      .withIndex("by_last_message")
      .order("desc")
      .filter((q) => (status ? q.eq(q.field("status"), status) : q.eq(true, true)))
      .paginate({ numItems: pageSizeOf(args.pageSize), cursor: args.cursor ?? null });
    return {
      page: await Promise.all(result.page.map((t) => withDetails(ctx, t))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** The open conversation's thread, wherever it falls in the paged list. Null if it is gone. */
export const threadById = query({
  args: { threadId: v.id("waThreads") },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.threadId);
    return t ? withDetails(ctx, t) : null;
  },
});

/**
 * The latest `limit` messages of a thread (oldest first, as a chat reads), and whether earlier
 * ones exist. The page raises `limit` for "Load earlier messages".
 */
export const messages = query({
  args: { threadId: v.id("waThreads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.min(Math.max(Math.floor(args.limit), 1), 1000)
        : 50;
    const rows = await ctx.db
      .query("waMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit + 1);
    return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
  },
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
      console.error("whatsapp.connect: WhatsApp is not configured on this deployment (WAHA env vars missing).");
      throw new ConvexError("WhatsApp isn't set up for this team yet. Ask your administrator to finish the setup.");
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
  handler: async (): Promise<void> => {
    // Texting policy: staff replies are off. Thrown before anything is sent or recorded, so the
    // thread is not taken off the bot by a reply that cannot go out.
    throw new ConvexError("Texting is turned off for now except emergency alerts.");
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
