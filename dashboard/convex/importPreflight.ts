import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Read-only lookups for the guarded production mode of the two importers
 * (scripts/roster/import_roster.py and scripts/owners/import_owners.mjs, docs/PROD-RUNBOOK.md step 5).
 * Internal only; nothing here writes and nothing returns tenant or owner data. They return staff
 * ids and first names only.
 *
 * `check` is what the importers call before any write: which deployment answered (so a `--prod`
 * call that landed on the wrong deployment is caught), whether the team and every asset manager id
 * exist there, and how much roster data is already in the team (so a re-run is visible).
 *
 * `assetManagers` is how the operator finds the ids to pass: every asset manager on every team in
 * this deployment (after the production seed there is exactly one team).
 */

/** The deployment's own name, from its system URL ("https://dependable-crab-872.convex.cloud"). */
function deploymentName(): string | null {
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_SITE_URL ?? "";
  const m = /^https?:\/\/([a-z0-9-]+)\.convex\.(?:cloud|site)/.exec(url);
  return m ? m[1] : null;
}

export const check = internalQuery({
  args: {
    orgId: v.string(),
    // Which asset manager each roster tab will be assigned to: [{ category, userId }].
    assetManagers: v.optional(v.array(v.object({ category: v.string(), userId: v.string() }))),
  },
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    const org = orgId ? await ctx.db.get(orgId) : null;
    const properties = org
      ? await ctx.db
          .query("properties")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      : [];
    const units = org
      ? await ctx.db
          .query("units")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      : [];
    const assetManagers = [];
    for (const a of args.assetManagers ?? []) {
      const userId = ctx.db.normalizeId("users", a.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      const membership = user
        ? await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first()
        : null;
      assetManagers.push({
        category: a.category,
        userExists: !!user,
        inThisTeam: !!membership && membership.orgId === args.orgId,
        isAssetManager: !!membership && (membership.jobRoles ?? []).includes("asset_manager"),
        // A first name only, so the operator can see Gold -> Nina, Silver -> Nikki, Make Up -> Delia.
        firstName: user?.firstName ?? null,
      });
    }
    const byCategory: Record<string, number> = {};
    for (const p of properties) byCategory[p.category ?? "none"] = (byCategory[p.category ?? "none"] ?? 0) + 1;
    return {
      deployment: deploymentName(),
      orgExists: !!org,
      orgName: org?.name ?? null,
      propertiesInOrg: properties.length,
      propertiesByCategory: byCategory,
      unitsInOrg: units.length,
      assetManagers,
    };
  },
});

export const assetManagers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").take(10);
    const out = [];
    for (const org of orgs) {
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      const managers = [];
      for (const m of members) {
        if (!(m.jobRoles ?? []).includes("asset_manager")) continue;
        const user = await ctx.db.get(m.userId);
        managers.push({
          userId: m.userId,
          firstName: user?.firstName ?? null,
          lastName: user?.lastName ?? null,
          email: user?.email ?? null,
          // Make Up (Delia) is also the accountant.
          jobRoles: m.jobRoles ?? [],
        });
      }
      out.push({ orgId: org._id, name: org.name, assetManagers: managers });
    }
    return { deployment: deploymentName(), organizations: out };
  },
});
