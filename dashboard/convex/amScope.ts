import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The one definition of "which units does this asset manager (AM) see", used by every AM read
 * path and by the admin dashboard's per-AM counts, so what an admin sees for an AM always equals
 * what that AM sees.
 *
 *   managed  - units whose assetManagerUserId is the AM. Read and act.
 *   covering - units of AMs who are currently out of office and named this person as their
 *              covering AM (memberships.coveringUserId). READ-ONLY: covering never grants any
 *              write, a human still approves a real reassignment (maintenance.approveFallback).
 *
 * Always derived server-side from the session user, never from a client-supplied id.
 */

type Ctx = QueryCtx | MutationCtx;

export type AmScope = {
  managed: Set<Id<"units">>;
  covering: Set<Id<"units">>;
  // The out-of-office AMs this person is covering, for the "covering for X" dashboard block.
  coveringFor: Id<"users">[];
};

export const EMPTY_AM_SCOPE: AmScope = { managed: new Set(), covering: new Set(), coveringFor: [] };

/** Units assigned to `userId` in this team. */
export async function managedUnitIds(
  ctx: Ctx,
  orgId: Id<"organizations"> | string,
  userId: Id<"users">,
): Promise<Id<"units">[]> {
  const rows = await ctx.db
    .query("units")
    .withIndex("by_org_and_asset_manager", (q) => q.eq("orgId", String(orgId)).eq("assetManagerUserId", userId))
    .collect();
  return rows.map((u) => u._id);
}

/** The out-of-office AMs (in this team) whose covering AM is `userId`. */
export async function coveringForUserIds(
  ctx: Ctx,
  orgId: Id<"organizations"> | string,
  userId: Id<"users">,
): Promise<Id<"users">[]> {
  const now = Date.now();
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
  return members
    .filter(
      (m) =>
        m.coveringUserId === userId &&
        m.userId !== userId &&
        m.unavailableUntil !== undefined &&
        m.unavailableUntil > now &&
        (m.jobRoles ?? []).includes("asset_manager"),
    )
    .map((m) => m.userId);
}

/** Units of the AMs who are out of office and have named `userId` to cover them. */
export async function coveringUnitIds(
  ctx: Ctx,
  orgId: Id<"organizations"> | string,
  userId: Id<"users">,
): Promise<Id<"units">[]> {
  const out: Id<"units">[] = [];
  for (const owner of await coveringForUserIds(ctx, orgId, userId)) {
    out.push(...(await managedUnitIds(ctx, orgId, owner)));
  }
  return out;
}

/**
 * The viewer's scope. Empty for anyone who isn't an asset manager (admin paths don't use it:
 * the admin view reads everything). A unit someone both manages and covers counts as managed.
 */
export async function amScope(
  ctx: Ctx,
  viewer: { orgId: Id<"organizations">; user: Doc<"users">; jobRoles: string[] },
): Promise<AmScope> {
  if (!viewer.jobRoles.includes("asset_manager")) return { managed: new Set(), covering: new Set(), coveringFor: [] };
  const managed = new Set(await managedUnitIds(ctx, viewer.orgId, viewer.user._id));
  const coveringFor = await coveringForUserIds(ctx, viewer.orgId, viewer.user._id);
  const covering = new Set<Id<"units">>();
  for (const owner of coveringFor) {
    for (const id of await managedUnitIds(ctx, viewer.orgId, owner)) {
      if (!managed.has(id)) covering.add(id);
    }
  }
  return { managed, covering, coveringFor };
}

/** Read access to a unit: managed or covered. */
export function canSeeUnit(scope: AmScope, unitId: Id<"units"> | undefined): boolean {
  return unitId !== undefined && (scope.managed.has(unitId) || scope.covering.has(unitId));
}
