import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});

/**
 * The action-context equivalent of authz.currentUser: actions have ctx.auth but not ctx.db,
 * so resolving "which user is this" from a Clerk id has to go through a query. Used by every
 * per-user action (mintToken, saveAgent, docs.remove, ...).
 */
export const byClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique(),
});

export const upsertFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    lastSignInAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const now = Date.now();
    const patch = {
      ...(args.email !== undefined ? { email: args.email } : {}),
      ...(args.firstName !== undefined ? { firstName: args.firstName } : {}),
      ...(args.lastName !== undefined ? { lastName: args.lastName } : {}),
      ...(args.imageUrl !== undefined ? { imageUrl: args.imageUrl } : {}),
      ...(args.lastSignInAt !== undefined ? { lastSignInAt: args.lastSignInAt } : {}),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: args.imageUrl,
      lastSignInAt: args.lastSignInAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeByClerkId = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!existing) return;

    // Delete their membership too. Leaving it behind points a team at a user row that no
    // longer exists, which reads as "this team has a member" everywhere while being
    // unreachable by anyone — and it silently blocks re-inviting the same person, since
    // membership is what "already belongs to another team" checks.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", existing._id))
      .collect();
    for (const membership of memberships) await ctx.db.delete(membership._id);

    await ctx.db.delete(existing._id);
  },
});
