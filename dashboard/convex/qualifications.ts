import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { currentOrg } from "./authz";

// --- Reads ----------------------------------------------------------------

/**
 * This table has no orgId column of its own — access is controlled through the parent
 * conversation instead, the same way conversations.transcript does it. A conversation with no
 * team (the public landing-page demo, or a phone call not yet reconciled) stays readable by
 * anyone who already has its id.
 */
export const forConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    if (conv.orgId) {
      const org = await currentOrg(ctx);
      if (!org || org.orgId !== conv.orgId) return null;
    }
    const rows = await ctx.db.query("qualifications").collect();
    return rows.find((r) => r.conversationId === args.conversationId) ?? null;
  },
});

export const byElevenLabsId = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("qualifications")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first(),
});

// --- Writes ---------------------------------------------------------------

/**
 * Find-or-create keyed by the ElevenLabs conversation id. Every server tool call during a
 * phone call lands here before any Convex `conversations` row necessarily exists.
 */
export const upsertByConversationId = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    bedrooms: v.optional(v.string()),
    moveInDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    petsWanted: v.optional(v.boolean()),
    petType: v.optional(v.string()),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    qualifies: v.optional(v.boolean()),
    disqualifyReason: v.optional(v.string()),
    nearMiss: v.optional(v.boolean()),
    tourSlot: v.optional(v.string()),
    tourConfirmed: v.optional(v.boolean()),
    screeningAnswers: v.optional(
      v.array(
        v.object({
          key: v.string(),
          question: v.string(),
          value: v.union(v.string(), v.number(), v.boolean()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { elevenLabsConversationId, ...fields } = args;
    const existing = await ctx.db
      .query("qualifications")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", elevenLabsConversationId),
      )
      .first();

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    // qualifies, disqualifyReason and nearMiss travel together: whenever a call recomputes the
    // decision, the other two must reflect exactly that decision, never a stale rejection left
    // over from an earlier check_qualification call in the same conversation. Without this, a
    // caller disqualified once, who then raises their budget and now qualifies, would keep
    // showing the old reason and a "near miss" badge on the Leads page — genuinely wrong once
    // they qualify. `ctx.db.patch` clears a field when the key is present with value undefined,
    // which is exactly what re-adding them here (even as undefined) achieves; the loop above
    // would otherwise drop them for being undefined and leave the previous values untouched.
    if ("qualifies" in fields) {
      patch.disqualifyReason = fields.disqualifyReason;
      patch.nearMiss = fields.nearMiss;
    }

    // Link to the call's own conversations row the moment it's available, rather than waiting
    // on the post-call webhook's linkConversation — reliable for a browser call (that row
    // exists from the start), and a safety net for a phone call whose row appeared since a
    // previous check_qualification/request_tour call on the same conversation.
    const needsConversationId = !existing || !existing.conversationId;
    const conv = needsConversationId
      ? await ctx.db
          .query("conversations")
          .withIndex("by_elevenlabs_conversation_id", (q) =>
            q.eq("elevenLabsConversationId", elevenLabsConversationId),
          )
          .first()
      : null;
    if (conv && needsConversationId) patch.conversationId = conv._id;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("qualifications", {
      elevenLabsConversationId,
      tourConfirmed: false,
      updatedAt: Date.now(),
      ...patch,
    });
  },
});

export const linkConversation = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("qualifications")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { conversationId: args.conversationId });
  },
});
