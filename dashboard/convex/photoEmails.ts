import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { speakablePhotoEmail } from "./sarahReplies";

/**
 * Where Sarah tells a tenant to email photos/video (send_photo_link). The address is stored per
 * asset manager (memberships.photoEmail) and read from the designated asset manager of the unit the
 * request was matched to. No unit, no asset manager on this team, or no valid address -> null, and
 * Sarah says the asset manager will follow up instead. Never a guess, never a default at call time.
 */
export async function photoEmailForRequest(
  ctx: QueryCtx | MutationCtx,
  req: Pick<Doc<"maintenanceRequests">, "orgId" | "unitId">,
): Promise<string | null> {
  if (!req.unitId) return null;
  const unit = await ctx.db.get(req.unitId);
  if (!unit || unit.orgId !== req.orgId) return null;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", unit.assetManagerUserId))
    .first();
  if (!membership || String(membership.orgId) !== req.orgId) return null;
  return speakablePhotoEmail(membership.photoEmail);
}

/**
 * The client's addresses per roster team (client decision 2026-11): Gold = Nina's team inbox,
 * Silver = Nikki Cermak, Make Up = Delia Gallerie. Used ONLY by seedDefaults below to fill
 * memberships.photoEmail; after that the stored value is the source of truth and admins edit it on
 * the asset manager's profile.
 */
export const DEFAULT_PHOTO_EMAILS = {
  gold: "goldteam@518propertypro.com",
  silver: "ncermak@518propertypro.com",
  make_up: "dgallerie@518propertypro.com",
} as const;

type Category = keyof typeof DEFAULT_PHOTO_EMAILS;
const CATEGORIES = Object.keys(DEFAULT_PHOTO_EMAILS) as Category[];

/**
 * One-off seed. For each roster team (properties.category) it finds the asset manager who holds
 * most of that team's units and sets their photoEmail to the team address above, only where none is
 * set yet (overwrite: true replaces). An asset manager who comes out on top for two teams is left
 * alone and reported, so one person never silently gets another team's inbox.
 *
 *   npx convex run photoEmails:seedDefaults '{"dryRun": true}'
 *   npx convex run photoEmails:seedDefaults '{}'
 *
 * orgId may be left out when there is exactly one team (organization).
 */
export const seedDefaults = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let orgId: Id<"organizations">;
    if (args.orgId) {
      orgId = args.orgId;
    } else {
      const orgs = await ctx.db.query("organizations").take(2);
      if (orgs.length !== 1) throw new ConvexError("Pass orgId: there is not exactly one team to seed.");
      orgId = orgs[0]._id;
    }
    const orgKey = String(orgId);

    // Top asset manager per team, by unit count.
    const top = new Map<Category, { userId: Id<"users">; units: number; ofUnits: number }>();
    for (const category of CATEGORIES) {
      const props = await ctx.db
        .query("properties")
        .withIndex("by_org_and_category", (q) => q.eq("orgId", orgKey).eq("category", category))
        .collect();
      const counts = new Map<Id<"users">, number>();
      let total = 0;
      for (const p of props) {
        const units = await ctx.db
          .query("units")
          .withIndex("by_property", (q) => q.eq("propertyId", p._id))
          .collect();
        for (const u of units) {
          counts.set(u.assetManagerUserId, (counts.get(u.assetManagerUserId) ?? 0) + 1);
          total++;
        }
      }
      let best: { userId: Id<"users">; units: number } | null = null;
      for (const [userId, units] of counts) if (!best || units > best.units) best = { userId, units };
      if (best) top.set(category, { ...best, ofUnits: total });
    }

    const report: Array<{
      team: Category;
      assetManager: string | null;
      units: number;
      ofUnits: number;
      email: string;
      result: "set" | "would_set" | "kept_existing" | "no_units" | "same_person_tops_two_teams" | "not_on_team";
    }> = [];
    for (const category of CATEGORIES) {
      const email = DEFAULT_PHOTO_EMAILS[category];
      const t = top.get(category);
      if (!t) {
        report.push({ team: category, assetManager: null, units: 0, ofUnits: 0, email, result: "no_units" });
        continue;
      }
      const user = await ctx.db.get(t.userId);
      const row = { team: category, assetManager: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Unknown", units: t.units, ofUnits: t.ofUnits, email };
      const clash = CATEGORIES.some((other) => other !== category && top.get(other)?.userId === t.userId);
      if (clash) {
        report.push({ ...row, result: "same_person_tops_two_teams" });
        continue;
      }
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", t.userId))
        .first();
      if (!membership || membership.orgId !== orgId) {
        report.push({ ...row, result: "not_on_team" });
        continue;
      }
      if (membership.photoEmail && !args.overwrite) {
        report.push({ ...row, result: "kept_existing" });
        continue;
      }
      if (args.dryRun) {
        report.push({ ...row, result: "would_set" });
        continue;
      }
      await ctx.db.patch(membership._id, { photoEmail: email });
      await writeAudit(ctx, {
        orgId: orgKey,
        entity: "membership",
        entityId: membership._id,
        action: "am_profile_updated",
        note: `fields: photoEmail (seeded for the ${category} team)`,
      });
      report.push({ ...row, result: "set" });
    }
    return report;
  },
});
