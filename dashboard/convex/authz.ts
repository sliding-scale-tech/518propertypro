import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import type { ActionCtx, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Every dashboard tab (Leads, Tenants, Knowledge, Property, Agent) is scoped by this one
 * lookup, so there is exactly one place that decides "who is asking."
 *
 * Returns null rather than throwing on missing auth or a not-yet-synced Clerk user — every
 * caller in a query context wants to degrade to an empty/default view, not crash the page.
 * Mutations that truly require a signed-in actor (saving an agent, starting a call from the
 * dashboard) check the result themselves and throw with a clearer message.
 */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

/**
 * For a mutation that has no sensible unauthenticated fallback (saving a property, starting a
 * doc save) — throws instead of returning null so the write can't silently no-op.
 */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new Error("Not signed in.");
  return user;
}

/**
 * Actions have ctx.auth but not ctx.db, so this goes through users.byClerkId instead.
 *
 * Throws rather than returning null: an action reaching this point (mintToken, saveAgent,
 * docs.remove/save) is always the "own agent" path — the public landing-page demo, the one
 * path in this codebase that legitimately has no signed-in user, branches around this helper
 * entirely rather than calling it. See agents.mintToken for that branch.
 */
export async function requireUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in.");
  const user = await ctx.runQuery(internal.users.byClerkId, { clerkId: identity.subject });
  if (!user) throw new Error("User record not found — try again in a moment.");
  return user._id;
}

// --- Organizations --------------------------------------------------------

/**
 * The team a request belongs to, plus that person's role in it.
 *
 * Resolved from the `memberships` table, not from the auth token. Clerk still owns identity —
 * sign-in, OAuth, sessions, the user webhook — but teams are this database's own concern.
 * That swap removed four moving parts Clerk Organizations needed to express one-of-one: an
 * "active organization" carried on the session, a choose-organization task, org claims packed
 * into the token, and ticket redemption on invite links.
 *
 * A person belongs to at most one team, so there is nothing to disambiguate here and no
 * concept of "which org is selected".
 */
export type OrgContext = {
  orgId: Id<"organizations">;
  role: "admin" | "member";
  isAdmin: boolean;
  user: Doc<"users">;
};

/**
 * Null rather than throwing, for the same reason currentUser is: a dashboard query wants to
 * render an empty state, not crash. A signed-in user can legitimately have no team for a
 * moment — between the Clerk webhook creating their user row and their team being created.
 */
export async function currentOrg(ctx: QueryCtx | MutationCtx): Promise<OrgContext | null> {
  const user = await currentUser(ctx);
  if (!user) return null;

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  if (!membership) return null;

  return {
    orgId: membership.orgId,
    role: membership.role,
    isAdmin: membership.role === "admin",
    user,
  };
}

export async function requireOrg(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await currentOrg(ctx);
  if (!org) throw new Error("No team found for this account. Try signing in again.");
  return org;
}

/**
 * Guards the things only an admin may do — inviting, removing members, renaming the team.
 * Checked server-side and not merely hidden in the sidebar: a hidden tab is a courtesy, this
 * is the actual boundary.
 */
export async function requireOrgAdmin(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!org.isAdmin) throw new Error("Only a team admin can do that.");
  return org;
}

/**
 * The single team this deployment serves. Single-tenant: every account joins this one org.
 *
 * Chosen as the org that owns the oldest agent — the row the landing demo, unresolved-call
 * fallbacks and the bootstrap template already treat as "the" agent — so all of those stay
 * pointed at the same team. Falls back to the oldest org on a fresh install, in the gap between
 * the first sign-up creating the org and agents.ensure creating its agent.
 */
export async function tenantOrgId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"organizations"> | null> {
  const agent = await ctx.db.query("agents").first();
  const fromAgent = agent ? ctx.db.normalizeId("organizations", agent.orgId) : null;
  if (fromAgent && (await ctx.db.get(fromAgent))) return fromAgent;
  const oldest = await ctx.db.query("organizations").order("asc").first();
  return oldest?._id ?? null;
}

/** Action-context equivalent of requireOrg — actions have ctx.auth but no ctx.db. */
export async function requireOrgId(ctx: ActionCtx): Promise<{
  orgId: Id<"organizations">;
  role: "admin" | "member";
  isAdmin: boolean;
  userId: Id<"users">;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in.");

  const resolved = await ctx.runQuery(internal.authz.orgForClerkId, {
    clerkId: identity.subject,
  });
  if (!resolved) throw new Error("No team found for this account. Try signing in again.");

  return {
    orgId: resolved.orgId,
    role: resolved.role,
    isAdmin: resolved.role === "admin",
    userId: resolved.userId,
  };
}

/** Backing query for requireOrgId — an action cannot touch ctx.db directly. */
export const orgForClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!membership) return null;

    return { orgId: membership.orgId, role: membership.role, userId: user._id };
  },
});
