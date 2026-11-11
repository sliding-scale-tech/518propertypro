import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { ObjectType } from "convex/values";
import { canReadConversation } from "./conversations";

// --- Reads ----------------------------------------------------------------

/**
 * This table has no orgId column of its own — access is controlled through the parent
 * conversation instead, the same way conversations.transcript does it. A conversation with no
 * team (the public landing-page demo, or a phone call not yet reconciled) stays readable by
 * anyone who already has its id (demo only; see canReadConversation).
 */
export const forConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    if (!(await canReadConversation(ctx, conv))) return null;
    const elId = conv.elevenLabsConversationId;
    if (elId) {
      const byEl = await ctx.db
        .query("qualifications")
        .withIndex("by_elevenlabs_conversation_id", (x) => x.eq("elevenLabsConversationId", elId))
        .first();
      if (byEl) return byEl;
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
export const upsertArgs = {
    elevenLabsConversationId: v.string(),
    bedrooms: v.optional(v.string()),
    moveInDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    petsWanted: v.optional(v.boolean()),
    petType: v.optional(v.string()),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    preferredArea: v.optional(v.string()),
    preferredCities: v.optional(v.array(v.string())),
    qualifies: v.optional(v.boolean()),
    disqualifyReason: v.optional(v.string()),
    nearMiss: v.optional(v.boolean()),
    tourSlot: v.optional(v.string()),
    tourConfirmed: v.optional(v.boolean()),
    callerEmail: v.optional(v.string()),
    leadClass: v.optional(v.string()),
    leadFlags: v.optional(v.array(v.string())),
    ownerProspect: v.optional(
      v.object({
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        propertyAddress: v.optional(v.string()),
        propertyDetails: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
    screeningAnswers: v.optional(
      v.array(
        v.object({
          key: v.string(),
          question: v.string(),
          value: v.union(v.string(), v.number(), v.boolean()),
        }),
      ),
    ),
};

/**
 * The shared upsert. Screening answers are MERGED by key (a later call with a subset must not
 * erase earlier answers), so Sarah can log a lead early and add to it as the call goes on.
 */
export async function upsertQualification(
  ctx: MutationCtx,
  args: ObjectType<typeof upsertArgs>,
) {
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
    if (fields.leadFlags) {
      // Flags are sticky: a later partial call must not erase what an earlier one found.
      patch.leadFlags = [...new Set([...(existing?.leadFlags ?? []), ...fields.leadFlags])];
    }
    if (fields.screeningAnswers) {
      const merged = new Map((existing?.screeningAnswers ?? []).map((a) => [a.key, a]));
      for (const a of fields.screeningAnswers) merged.set(a.key, a);
      patch.screeningAnswers = [...merged.values()];
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
}

export const upsertByConversationId = internalMutation({
  args: upsertArgs,
  handler: (ctx, args) => upsertQualification(ctx, args),
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
