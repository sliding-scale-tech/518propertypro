import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { clampSeverity } from "./severity";
import { realValue, realPhone } from "./sanitize";
import { currentOrg } from "./authz";

// --- Reads ----------------------------------------------------------------

/**
 * Every logged resident call for the signed-in user, worst first.
 *
 * The severity-first sort lives here rather than in the page so no caller can get it wrong —
 * an urgent issue sinking below a routine one is the one failure mode that actually matters.
 */
export const issues = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const rows = await ctx.db
      .query("tenantIssues")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();

    // Join the call itself so the row can expand into a transcript the same way the Leads
    // page does. conversationId only exists once the post-call webhook has landed, so
    // everything from the conversation is optional here.
    const withCall = await Promise.all(
      rows.map(async (issue) => {
        const conv = issue.conversationId ? await ctx.db.get(issue.conversationId) : null;
        const messageCount = conv
          ? (
              await ctx.db
                .query("messages")
                .withIndex("by_conversation", (q) => q.eq("conversationId", conv._id))
                .collect()
            ).length
          : 0;
        return {
          ...issue,
          channel: conv?.channel ?? null,
          durationSec: conv?.durationSec ?? null,
          startedAt: conv?.startedAt ?? null,
          callSummary: conv?.summary ?? null,
          messageCount,
        };
      }),
    );

    return withCall.sort((a, b) => b.severity - a.severity || b.createdAt - a.createdAt);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return { openIssues: 0, highSeverityOpen: 0, resolvedIssues: 0 };
    const rows = await ctx.db
      .query("tenantIssues")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const open = rows.filter((r) => r.status === "open");

    return {
      openIssues: open.length,
      highSeverityOpen: open.filter((r) => r.severity >= 7).length,
      resolvedIssues: rows.length - open.length,
    };
  },
});

export const issueByElevenLabsId = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first(),
});

// --- Writes ---------------------------------------------------------------

/**
 * Upsert by conversation id so a second log_tenant_issue call in the same conversation
 * corrects the first rather than creating a duplicate row.
 *
 * Nothing here verifies that the caller is a resident, and nothing links them to a previous
 * call. The name and unit are stored exactly as the caller gave them.
 */
export const logIssue = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    reason: v.string(),
    category: v.optional(v.string()),
    severity: v.number(),
    severityReason: v.optional(v.string()),
    // Set by the escalate handler's safety net, which only needs a row to EXIST so the call is
    // classified as a resident call. Without this it reused the normal upsert and overwrote a
    // row Sarah had already written from log_tenant_issue -- replacing her reason, her unit and
    // her severity with the escalation's coarser values, so every escalated 8 or 9 was rewritten
    // to a 10 with boilerplate text.
    onlyIfAbsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { elevenLabsConversationId, severity, onlyIfAbsent, ...fields } = args;
    const now = Date.now();

    const existing = await ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", elevenLabsConversationId),
      )
      .first();

    const cleaned = {
      ...fields,
      callerName: realValue(fields.callerName),
      unit: realValue(fields.unit),
      callerNumber: realPhone(fields.callerNumber),
      callbackNumber: realPhone(fields.callbackNumber),
    };

    const patch: Record<string, unknown> = {
      severity: clampSeverity(severity),
      updatedAt: now,
    };
    for (const [key, value] of Object.entries(cleaned)) {
      if (value !== undefined) patch[key] = value;
    }

    // Resolves the owner from the call's own conversations row, exactly like the qualification
    // side of the same tool call — reliable for a browser call (that row exists from the
    // start), not yet for a phone call's first mid-call tool invocation. linkConversation below
    // backfills the phone-call case once the post-call webhook resolves the real agent.
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", elevenLabsConversationId),
      )
      .first();

    if (existing && onlyIfAbsent) return existing._id;

    if (existing) {
      // Was created before conv existed (a phone call's first mid-call tool invocation) and
      // never got backfilled because the post-call webhook never ran — a second log_tenant_issue
      // call in the same conversation, or a browser call where conv now exists, catches it here
      // instead of leaving the transcript stuck behind linkConversation forever.
      if (conv && !existing.conversationId) patch.conversationId = conv._id;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("tenantIssues", {
      userId: conv?.userId,
      orgId: conv?.orgId,
      conversationId: conv?._id,
      elevenLabsConversationId,
      reason: args.reason,
      severity: clampSeverity(severity),
      status: "open",
      createdAt: now,
      updatedAt: now,
      ...patch,
    });
  },
});

/**
 * Called by the post-call webhook. Links the Convex conversation, backfills the telephony
 * number (the only way a browser call — or a call where the agent never got a number out
 * loud — ends up with a usable callback number on the record), and backfills the owning team
 * for a phone call that wasn't yet resolvable when logIssue first ran.
 */
export const linkConversation = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    conversationId: v.id("conversations"),
    callerNumber: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();
    if (!issue) return;

    const patch: Record<string, unknown> = {
      conversationId: args.conversationId,
      updatedAt: Date.now(),
    };
    if (args.callerNumber && !issue.callerNumber) patch.callerNumber = args.callerNumber;
    if (args.userId && !issue.userId) patch.userId = args.userId;
    if (args.orgId && !issue.orgId) patch.orgId = args.orgId;

    await ctx.db.patch(issue._id, patch);
  },
});

export const updateIssue = mutation({
  args: {
    issueId: v.id("tenantIssues"),
    severity: v.optional(v.number()),
    reason: v.optional(v.string()),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    const issue = await ctx.db.get(args.issueId);
    if (!issue || !org || issue.orgId !== org.orgId) return;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.reason !== undefined) patch.reason = args.reason;
    if (args.status !== undefined) patch.status = args.status;
    if (args.callerName !== undefined) patch.callerName = args.callerName;
    if (args.unit !== undefined) patch.unit = args.unit;

    if (args.severity !== undefined) {
      const next = clampSeverity(args.severity);
      if (next !== issue.severity) {
        // Keep the agent's original judgment the first time a human disagrees with it, so the
        // rubric can be audited against what staff actually thought.
        if (issue.originalSeverity === undefined) patch.originalSeverity = issue.severity;
        patch.severity = next;
      }
    }

    await ctx.db.patch(args.issueId, patch);
  },
});

export const removeIssue = mutation({
  args: { issueId: v.id("tenantIssues") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    const issue = await ctx.db.get(args.issueId);
    if (!issue || !org || issue.orgId !== org.orgId) return;
    await ctx.db.delete(args.issueId);
  },
});
