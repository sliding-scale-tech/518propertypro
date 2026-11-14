import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import type { ActionCtx, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { JOB_ROLES } from "./jobRoles";
import type { AppRole, JobRole } from "./jobRoles";
import { primaryView, rolesFor } from "./roleSet";
import { PASSWORD_CHANGE_REQUIRED, passwordChangeRequired } from "./passwordGate";
import { INVITE_REQUIRED } from "./inviteGate";

export type Caller = { user: Doc<"users"> | null; membership: Doc<"memberships"> | null };

/**
 * The one lookup behind every helper below: who is asking, and their membership.
 *
 * null = not signed in. user null = signed in, but the Clerk webhook has not created their row yet.
 * Applies the forced password change (passwordGate.ts) before anything else: a person still on
 * their temporary password gets nothing from any data function until they set a new one. Seeded
 * people are always members, so they meet this gate first and the invite gate never.
 * Exported for team.accessGate only; data functions use the helpers below.
 */
export async function resolveCaller(ctx: QueryCtx | MutationCtx): Promise<Caller | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  assertPasswordSet(user, identity);
  if (!user) return { user: null, membership: null };
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  return { user, membership };
}

/**
 * Every dashboard tab (Leads, Tenants, Knowledge, Property, Agent) is scoped by this one
 * lookup, so there is exactly one place that decides "who is asking."
 *
 * Returns null rather than throwing on missing auth or a not-yet-synced Clerk user — every
 * caller in a query context wants to degrade to an empty/default view, not crash the page.
 * Mutations that truly require a signed-in actor (saving an agent, starting a call from the
 * dashboard) check the result themselves and throw with a clearer message.
 *
 * Two exceptions to "return null rather than throw", both deliberate refusals:
 *   - PASSWORD_CHANGE_REQUIRED for a person still on a temporary password (passwordGate.ts);
 *   - INVITE_REQUIRED for a signed-in account with no team membership (inviteGate.ts). Dashboard
 *     access is invite-only, and every org/role helper below goes through here, so this one check
 *     covers every data function.
 * The few functions an uninvited person may call (their own pending invite, joining it, the
 * access gate) use currentUserWithoutTeam instead.
 */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const caller = await resolveCaller(ctx);
  if (!caller?.user) return null;
  if (!caller.membership) throw new ConvexError(INVITE_REQUIRED);
  return caller.user;
}

/**
 * The signed-in person whether or not they belong to a team, still behind the password gate.
 * ONLY for the invite paths (team.myPendingInvite, team.acceptPendingInvite, team.accessGate):
 * nothing reached through this may return team data.
 */
export async function currentUserWithoutTeam(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  return (await resolveCaller(ctx))?.user ?? null;
}

/** Throws PASSWORD_CHANGE_REQUIRED while the person must still replace their temporary password. */
export function assertPasswordSet(user: { mustChangePassword?: boolean | null } | null | undefined, identity: unknown): void {
  if (passwordChangeRequired(user, identity)) throw new ConvexError(PASSWORD_CHANGE_REQUIRED);
}

/**
 * For a mutation that has no sensible unauthenticated fallback (saving a property, starting a
 * doc save) — throws instead of returning null so the write can't silently no-op.
 */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError("Sign in to continue.");
  return user;
}

/**
 * Actions have ctx.auth but not ctx.db, so this goes through authz.orgForClerkId instead.
 *
 * Throws rather than returning null: an action reaching this point (mintToken, saveAgent,
 * docs.remove/save) is always the "own agent" path — the public landing-page demo, the one
 * path in this codebase that legitimately has no signed-in user, branches around this helper
 * entirely rather than calling it. See agents.mintToken for that branch.
 */
export async function requireUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue.");
  const resolved = await ctx.runQuery(internal.authz.orgForClerkId, { clerkId: identity.subject });
  assertPasswordSet(resolved, identity);
  if (!resolved) throw new ConvexError("Your account is still being set up. Try again in a moment.");
  // Invite-only (inviteGate.ts): an account with no team gets nothing from an action either.
  if (resolved.noTeam) throw new ConvexError(INVITE_REQUIRED);
  return resolved.userId;
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
  // Job roles (what they do), distinct from `role` (team administration). [] for rows that
  // predate job roles — see team.backfillJobRoles.
  jobRoles: JobRole[];
  user: Doc<"users">;
};

export { JOB_ROLES };
export type { JobRole };
export type { AppRole } from "./jobRoles";

// --- Role set (B31 multi-role members) --------------------------------------------------
//
// Permissions are the UNION of the roles a person holds: Admin (exclusive), or any mix of
// asset_manager, technician and accountant. Every capability check asks the role set
// (hasRole / hasAnyRole / isAdminView), never "the one view": viewFor below is only the UI's
// default landing view. The pure rules live in roleSet.ts (shared with the client and tests).

export { rolesFor, hasRole, hasAnyRole } from "./roleSet";

/** The role set of an org context (or any { isAdmin, jobRoles }). */
export function rolesOf(org: { isAdmin: boolean; jobRoles?: ReadonlyArray<string> | null }): ReadonlySet<AppRole> {
  return rolesFor(org.isAdmin, org.jobRoles);
}

/**
 * THE one authorization rule: an Admin is anyone whose view is "admin" (team admin flag, or the
 * executive / maintenance_lead / simplr_admin job role). There is no "team admin" tier above that.
 * Every admin-type guard in the app (requireOrgAdmin, requireAdminView, requireAdminViewId,
 * canManageMaintenance, hasJobRole, requireJobRole) reduces to this. An Admin by membership flag
 * with empty jobRoles still passes (viewFor checks isAdmin first).
 */
export function isAdminView(org: { jobRoles?: ReadonlyArray<string> | null; isAdmin: boolean }): boolean {
  return rolesFor(org.isAdmin, org.jobRoles).has("admin");
}

/**
 * True if the person holds any of `roles`. Every Admin satisfies every check (the roles asked for
 * are admin-flavoured job roles, and Admin has full power); non-Admin views must hold one of them.
 */
export function hasJobRole(
  org: { jobRoles: JobRole[]; isAdmin: boolean },
  ...roles: JobRole[]
): boolean {
  if (isAdminView(org)) return true;
  return roles.some((r) => org.jobRoles.includes(r));
}

/** Server-side gate on job role, the query/mutation counterpart of requireOrgAdmin. */
export async function requireJobRole(
  ctx: QueryCtx | MutationCtx,
  ...roles: JobRole[]
): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!hasJobRole(org, ...roles)) throw new ConvexError("You don't have access to that.");
  return org;
}

/** Which of the app's views a person lands in. One app, four views, decided by role. */
export type AppView = "admin" | "asset_manager" | "technician" | "accountant" | "none";

/**
 * Pure: the person's DEFAULT view, for the UI only (home redirect, default screen). The team admin
 * flag and the three admin-flavoured job roles give "admin"; otherwise the first of asset_manager,
 * technician, accountant they hold; otherwise none. A multi-role person holds more than this one
 * view, so no permission may be decided from it: use rolesOf / hasRole / hasAnyRole.
 */
export function viewFor(isAdmin: boolean, jobRoles: ReadonlyArray<string>): AppView {
  return primaryView(rolesFor(isAdmin, jobRoles));
}

/** Server-side gate on the admin view, the query/mutation counterpart of requireOrgAdmin. */
export async function requireAdminView(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!isAdminView(org)) throw new ConvexError("Only admins can do this.");
  return org;
}

/**
 * Maintenance management (forward, close without a work order, create work orders for any unit,
 * close them out). Every Admin has it; nobody else does.
 */
export function canManageMaintenance(org: { jobRoles: JobRole[]; isAdmin: boolean }): boolean {
  return isAdminView(org);
}

/** Action-context equivalent of requireAdminView. */
export async function requireAdminViewId(ctx: ActionCtx): Promise<Awaited<ReturnType<typeof requireOrgId>>> {
  const org = await requireOrgId(ctx);
  if (!isAdminView(org)) throw new ConvexError("Only admins can do this.");
  return org;
}

/**
 * Null rather than throwing, for the same reason currentUser is: a dashboard query wants to
 * render an empty state, not crash — signed out, or signed in before the Clerk webhook has
 * created their user row. A signed-in account with no membership is refused with
 * INVITE_REQUIRED (invite-only access, inviteGate.ts), the same way currentUser refuses it.
 */
export async function currentOrg(ctx: QueryCtx | MutationCtx): Promise<OrgContext | null> {
  const caller = await resolveCaller(ctx);
  if (!caller?.user) return null;
  const { user, membership } = caller;
  // Signed in with no team: refused, not an empty view (inviteGate.ts).
  if (!membership) throw new ConvexError(INVITE_REQUIRED);

  return {
    orgId: membership.orgId,
    role: membership.role,
    isAdmin: membership.role === "admin",
    jobRoles: membership.jobRoles ?? [],
    user,
  };
}

export async function requireOrg(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await currentOrg(ctx);
  if (!org) throw new ConvexError("No team found for this account. Try signing in again.");
  return org;
}

/**
 * Guards the things only an Admin may do — inviting, removing members, renaming the team.
 * Same rule as requireAdminView (any Admin). Checked server-side and not merely hidden in the
 * sidebar: a hidden tab is a courtesy, this is the actual boundary.
 */
export async function requireOrgAdmin(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!isAdminView(org)) throw new ConvexError("Only admins can do this.");
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
  jobRoles: JobRole[];
  userId: Id<"users">;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue.");

  const resolved = await ctx.runQuery(internal.authz.orgForClerkId, {
    clerkId: identity.subject,
  });
  assertPasswordSet(resolved, identity);
  if (!resolved) throw new ConvexError("No team found for this account. Try signing in again.");
  if (resolved.noTeam) throw new ConvexError(INVITE_REQUIRED);

  return {
    orgId: resolved.orgId,
    role: resolved.role,
    isAdmin: resolved.role === "admin",
    jobRoles: resolved.jobRoles,
    userId: resolved.userId,
  };
}

/**
 * Backing query for requireOrgId and requireUserId — an action cannot touch ctx.db directly.
 * null = no user row yet. noTeam = a user with no membership, refused with INVITE_REQUIRED.
 */
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
    if (!membership) {
      return { noTeam: true as const, userId: user._id, mustChangePassword: user.mustChangePassword === true };
    }

    return {
      noTeam: false as const,
      orgId: membership.orgId,
      role: membership.role,
      jobRoles: membership.jobRoles ?? [],
      userId: user._id,
      // Checked by requireOrgId (passwordGate.ts) together with the caller's token.
      mustChangePassword: user.mustChangePassword === true,
    };
  },
});
