import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { currentUser } from "./authz";
import { passwordChangeRequired } from "./passwordGate";

export const current = query({
  args: {},
  // Through authz.currentUser, so it refuses a person who must still change their password.
  handler: async (ctx) => await currentUser(ctx),
});

/**
 * The ONE function a person on a temporary password may call (passwordGate.ts): whether the signed-in
 * caller must still set a new password. Says nothing else, about them or anyone. Used by the app
 * chrome to send them to /change-password and by that page to know when the change has landed.
 * null = not signed in.
 */
export const passwordGate = query({
  args: {},
  handler: async (ctx): Promise<{ mustChangePassword: boolean } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    return { mustChangePassword: passwordChangeRequired(user, identity) };
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
    // Clerk publicMetadata.mustChangePassword when the webhook payload states it (passwordGate.ts).
    mustChangePassword: v.optional(v.boolean()),
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
      ...(args.mustChangePassword !== undefined ? { mustChangePassword: args.mustChangePassword } : {}),
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
      ...(args.mustChangePassword !== undefined ? { mustChangePassword: args.mustChangePassword } : {}),
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
