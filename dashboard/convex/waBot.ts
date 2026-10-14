import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import * as gemini from "./geminiApi";
import * as waha from "./wahaApi";
import { clampSeverity, SEVERITY_RUBRIC } from "./severity";
import { WA_DEFAULT_PROMPT } from "./waPrompt";
import { evaluateQualification, hasAllQualificationFields } from "./qualifyRules";
import { realValue, realPhone } from "./sanitize";

/**
 * How long to wait after a customer message before answering. People send WhatsApp messages
 * in bursts of three or four lines; replying to each one produces a bot that talks over the
 * person. Staleness is re-checked after generation so a reply is dropped if a newer message
 * arrived while the model was thinking.
 */
const DEBOUNCE_MS = 2500;

/** Enough turns for context without paying for the whole history on every message. */
const HISTORY_LIMIT = 24;


// --- Reads ----------------------------------------------------------------

export const threadForBot = internalQuery({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) => ctx.db.get(args.threadId),
});

export const recentMessages = internalQuery({
  args: { threadId: v.id("waThreads") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("waMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return rows.slice(-HISTORY_LIMIT).map((m) => ({ sender: m.sender, text: m.text }));
  },
});

export const leadForThread = internalQuery({
  args: { threadId: v.id("waThreads") },
  handler: (ctx, args) =>
    ctx.db
      .query("waLeads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first(),
});

// --- Writes ---------------------------------------------------------------

/**
 * Inbound message from the webhook. Creates the thread on first contact and schedules a
 * debounced reply.
 */
export const ingestInbound = internalMutation({
  args: {
    chatId: v.string(),
    displayName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let thread = await ctx.db
      .query("waThreads")
      .withIndex("by_chat_id", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) {
      const id = await ctx.db.insert("waThreads", {
        chatId: args.chatId,
        displayName: args.displayName,
        status: "bot",
        unreadCount: 0,
        lastMessageAt: now,
        createdAt: now,
      });
      thread = (await ctx.db.get(id))!;
    }

    const messageId = await ctx.db.insert("waMessages", {
      threadId: thread._id,
      sender: "customer",
      text: args.text,
      at: now,
    });

    await ctx.db.patch(thread._id, {
      lastMessageAt: now,
      unreadCount: thread.unreadCount + 1,
    });

    // A thread a human has taken over stays quiet until they hand it back.
    if (thread.status === "bot") {
      await ctx.scheduler.runAfter(DEBOUNCE_MS, internal.waBot.generateReply, {
        threadId: thread._id,
        triggeringMessageId: messageId,
      });
    }
  },
});

export const recordOutbound = internalMutation({
  args: {
    threadId: v.id("waThreads"),
    sender: v.union(v.literal("bot"), v.literal("staff")),
    text: v.string(),
    delivered: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("waMessages", {
      threadId: args.threadId,
      sender: args.sender,
      text: args.text,
      at: now,
      deliveryStatus: args.delivered ? "sent" : "failed",
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now });
  },
});

export const markEscalated = internalMutation({
  args: { threadId: v.id("waThreads"), reason: v.optional(v.string()) },
  handler: (ctx, args) =>
    ctx.db.patch(args.threadId, { status: "escalated", escalationReason: args.reason }),
});

/** Merge-only-defined upsert, so a later message never blanks an earlier fact. */
export const upsertLead = internalMutation({
  args: {
    threadId: v.id("waThreads"),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    bedrooms: v.optional(v.string()),
    moveInDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    petsWanted: v.optional(v.boolean()),
    petType: v.optional(v.string()),
    tourSlot: v.optional(v.string()),
    qualifies: v.optional(v.boolean()),
    disqualifyReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { threadId, ...fields } = args;
    const existing = await ctx.db
      .query("waLeads")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .first();

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("waLeads", { threadId, updatedAt: Date.now(), ...patch });
  },
});

export const upsertIssue = internalMutation({
  args: {
    threadId: v.id("waThreads"),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    reason: v.string(),
    category: v.optional(v.string()),
    severity: v.number(),
    severityReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { threadId, severity, ...fields } = args;
    const now = Date.now();

    const existing = await ctx.db
      .query("waIssues")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .first();

    const patch: Record<string, unknown> = {
      severity: clampSeverity(severity),
      updatedAt: now,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("waIssues", {
      threadId,
      reason: args.reason,
      severity: clampSeverity(severity),
      status: "open",
      createdAt: now,
      updatedAt: now,
      ...patch,
    });
  },
});

// --- The reply pipeline ---------------------------------------------------

async function buildSystemContext(ctx: ActionCtx): Promise<string> {
  const property = await ctx.runQuery(internal.properties.currentInternal, {});
  const docs = await ctx.runQuery(internal.docs.syncedTextInternal, {});

  const units = property.units
    .map(
      (u) =>
        `${u.bedrooms}: $${u.rentMin}-$${u.rentMax}/mo, ${u.available ? "available" : "not available"}`,
    )
    .join("\n");

  const propertyBlock = [
    property.name,
    `Pets allowed: ${property.petsAllowed ? "yes" : "no"}`,
    `Move-in window: within ${property.moveInWindowDays} days`,
    "Units:",
    units,
  ].join("\n");

  const rubric = SEVERITY_RUBRIC.map((r) => `${r.band} ${r.label} — ${r.detail}`).join("\n");

  // The live prompt is whatever Settings holds; the code constant is only the starting point.
  // Same arrangement as the voice agent, where the database row wins over LEASING_PROMPT.
  const config = await ctx.runQuery(internal.whatsapp.configInternal, {});
  const template = config?.systemPrompt?.trim() || WA_DEFAULT_PROMPT;

  return template.replace(/\{\{PROPERTY_NAME\}\}/g, property.name)
    .replace("{{SEVERITY_RUBRIC}}", rubric)
    .replace("{{PROPERTY}}", propertyBlock)
    .replace(
      "{{DOCS}}",
      docs.length > 0
        ? docs.map((d) => `${d.title}: ${d.body}`).join("\n\n")
        : "(no documents yet)",
    );
}

export const generateReply = internalAction({
  args: {
    threadId: v.id("waThreads"),
    triggeringMessageId: v.id("waMessages"),
  },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.runQuery(internal.waBot.threadForBot, { threadId: args.threadId });
    if (!thread || thread.status !== "bot") return;

    const history = await ctx.runQuery(internal.waBot.recentMessages, {
      threadId: args.threadId,
    });
    if (history.length === 0) return;

    const systemContext = await buildSystemContext(ctx);

    await waha.startTyping(thread.chatId);

    let turn: gemini.WaTurn;
    try {
      turn = await gemini.generateWaTurn(systemContext, history);
    } catch (err) {
      await waha.stopTyping(thread.chatId);
      // A provider hiccup should not silently swallow the conversation, but it also should
      // not escalate a thread that is otherwise fine — the next message will retry.
      console.error("[wa] Gemini failed:", err instanceof Error ? err.message : err);
      return;
    }

    await waha.stopTyping(thread.chatId);

    // Someone messaged again while the model was thinking: that newer message will schedule
    // its own reply with fuller context, so this one is stale. Dropping it is what stops the
    // bot answering the same burst twice.
    const latest = await ctx.runQuery(internal.waBot.recentMessages, {
      threadId: args.threadId,
    });
    if (latest.length !== history.length) return;

    // --- Persist whatever the turn revealed -------------------------------

    const lead = turn.lead ?? {};
    const hasLeadFacts = Object.values(lead).some((x) => x !== undefined);

    if (turn.audience === "prospect" && hasLeadFacts) {
      await ctx.runMutation(internal.waBot.upsertLead, {
        threadId: args.threadId,
        callerName: realValue(lead.callerName),
        callerPhone: realPhone(lead.callerPhone),
        bedrooms: realValue(lead.bedrooms),
        moveInDate: realValue(lead.moveInDate),
        budget: lead.budget,
        petsWanted: lead.petsWanted,
        petType: realValue(lead.petType),
        tourSlot: realValue(lead.tourSlot),
      });

      // Qualification is decided here, in code, never by the model — the same rules the
      // voice agent applies. Only run it once all five fields are actually known.
      const stored = await ctx.runQuery(internal.waBot.leadForThread, {
        threadId: args.threadId,
      });
      if (stored && hasAllQualificationFields(stored)) {
        const property = await ctx.runQuery(internal.properties.currentInternal, {});
        const result = evaluateQualification(property, {
          bedrooms: stored.bedrooms,
          budget: stored.budget,
          petsWanted: stored.petsWanted,
        });
        await ctx.runMutation(internal.waBot.upsertLead, {
          threadId: args.threadId,
          qualifies: result.qualifies,
          disqualifyReason: result.disqualifyReason,
        });
      }
    }

    const issue = turn.issue ?? {};
    const issueReason = realValue(issue.reason);
    if (turn.audience === "resident" && issueReason) {
      await ctx.runMutation(internal.waBot.upsertIssue, {
        threadId: args.threadId,
        callerName: realValue(issue.callerName),
        unit: realValue(issue.unit),
        callbackNumber: realPhone(issue.callbackNumber),
        reason: issueReason,
        category: realValue(issue.category),
        severity: clampSeverity(issue.severity),
        severityReason: realValue(issue.severityReason),
      });
    }

    // --- Reply ------------------------------------------------------------

    const text = turn.reply.trim();
    if (text) {
      // Record even when sending throws — WAHA being down or unconfigured must not silently
      // swallow the reply. A row marked "failed" tells staff what the bot meant to say and
      // that the customer never got it; no row at all tells them nothing.
      let delivered = false;
      try {
        delivered = await waha.sendText(thread.chatId, text);
      } catch (err) {
        console.error("[wa] send failed:", err instanceof Error ? err.message : err);
      }
      await ctx.runMutation(internal.waBot.recordOutbound, {
        threadId: args.threadId,
        sender: "bot",
        text,
        delivered,
      });
    }

    if (turn.escalate) {
      await ctx.runMutation(internal.waBot.markEscalated, {
        threadId: args.threadId,
        reason: turn.escalationReason,
      });
    }
  },
});
