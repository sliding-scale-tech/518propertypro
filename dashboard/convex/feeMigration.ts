import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./audit";
import { formatBps } from "./rosFormat";
import { orgDefaultFeeBps } from "./rosPolicy";

/**
 * One-off, idempotent: the management fee moved from the owner (owners.managementFeeBps,
 * deprecated) to the property link (ownerProperties.managementFeeBps, own fee) with an org default
 * (financeSettings.rosDefaultFeeBps, 5.00% when never set). An owner whose old fee differs from
 * its org's default gets that fee copied onto each of its links that has no own fee yet, so its
 * statements keep the same %. An owner at the default (e.g. 500 = 5.00%) needs nothing.
 *
 * Never overwrites a link that already has its own fee (listed under `conflicts` when it differs).
 * Writes nothing with dryRun (the default); the report says what a real run would do.
 * Internal: only the CLI / dashboard can run it. Sends nothing.
 *
 *   npx convex run feeMigration:copyOwnerFeesToLinks '{"dryRun": true}'
 *   npx convex run feeMigration:copyOwnerFeesToLinks '{"dryRun": false}'
 */
export const copyOwnerFeesToLinks = internalMutation({
  args: { dryRun: v.optional(v.boolean()), orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const owners = args.orgId
      ? await ctx.db
          .query("owners")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId as string))
          .collect()
      : await ctx.db.query("owners").collect();
    const defaults = new Map<string, number>();
    const defaultOf = async (orgId: string): Promise<number> => {
      const hit = defaults.get(orgId);
      if (hit !== undefined) return hit;
      const row = await ctx.db
        .query("financeSettings")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
      const d = orgDefaultFeeBps(row?.rosDefaultFeeBps);
      defaults.set(orgId, d);
      return d;
    };

    const report = {
      dryRun,
      ownersWithOldFee: 0,
      ownersAtDefault: 0,
      linksCopied: [] as string[],
      linksAlreadySame: 0,
      conflicts: [] as string[],
    };
    const now = Date.now();
    for (const o of owners) {
      if (o.managementFeeBps === undefined) continue;
      report.ownersWithOldFee++;
      const fee = o.managementFeeBps;
      const def = await defaultOf(o.orgId);
      if (!Number.isSafeInteger(fee) || fee < 0 || fee > 10000) {
        report.conflicts.push(`${o.legalName}: old fee ${String(fee)} is not a valid fee, nothing copied`);
        continue;
      }
      if (fee === def) {
        report.ownersAtDefault++;
        continue;
      }
      const links = (
        await ctx.db
          .query("ownerProperties")
          .withIndex("by_owner", (q) => q.eq("ownerId", o._id))
          .collect()
      ).filter((l) => l.orgId === o.orgId);
      for (const l of links) {
        const p = await ctx.db.get(l.propertyId);
        const name = p && p.orgId === o.orgId ? p.name : "Unknown property";
        if (l.managementFeeBps !== undefined) {
          if (l.managementFeeBps === fee) report.linksAlreadySame++;
          else report.conflicts.push(`${o.legalName} / ${name}: own fee ${formatBps(l.managementFeeBps)}% kept (old owner fee ${formatBps(fee)}%)`);
          continue;
        }
        report.linksCopied.push(`${o.legalName} / ${name}: ${formatBps(fee)}%`);
        if (dryRun) continue;
        await ctx.db.patch(l._id, { managementFeeBps: fee, updatedAt: now });
        await writeAudit(ctx, {
          orgId: o.orgId,
          entity: "owner",
          entityId: o._id,
          action: "owner_property_fee_changed",
          from: `${formatBps(def)}% (default)`,
          to: `${formatBps(fee)}% (own)`,
          note: `${name}: copied from the owner's old fee (feeMigration.copyOwnerFeesToLinks)`,
        });
      }
    }
    return report;
  },
});
