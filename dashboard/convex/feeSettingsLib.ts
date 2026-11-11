/**
 * The management fee settings logic (user decision 2026-11-11), as plain functions on `ctx.db` so
 * scripts/probes/ros_fee.test.mjs can run them on a fake database. feeSettings.ts registers the
 * Convex functions (after requireFinance) and passes writeAudit in.
 *
 * Runtime imports are convex/values and the pure ROS modules only; Convex types are `import type`.
 */

import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AuditEntity } from "./audit";
import { formatBps } from "./rosFormat";
import { orgDefaultFeeBps, setDefaultFeeProblem, type FeeCounts } from "./rosPolicy";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

export type AuditWriter = (
  ctx: MutationCtx,
  event: {
    orgId: string;
    entity: AuditEntity;
    entityId: string;
    action: string;
    actorUserId?: Id<"users">;
    from?: string;
    to?: string;
    note?: string;
  },
) => Promise<void>;

/** The org's stored settings row, or null before the first change. */
export async function settingsRow(ctx: ReadCtx, orgId: string) {
  return await ctx.db
    .query("financeSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

/** The org default fee in basis points (500 = 5.00% when never changed). */
export async function readDefaultFeeBps(ctx: ReadCtx, orgId: string): Promise<number> {
  return orgDefaultFeeBps((await settingsRow(ctx, orgId))?.rosDefaultFeeBps);
}

/**
 * The counts the "Change fee for all properties" alert shows: every property of the org, and the
 * owner-property links that have their own fee. `usingDefaultCount` = properties with no own fee.
 */
export async function loadFeeCounts(ctx: ReadCtx, orgId: string) {
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const links = await ctx.db
    .query("ownerProperties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const ownLinks = links.filter((l) => l.managementFeeBps !== undefined);
  const propertiesWithOwnFee = new Set(ownLinks.map((l) => l.propertyId as string)).size;
  const counts: FeeCounts = { totalProperties: properties.length, ownFeeCount: ownLinks.length };
  return { counts, ownLinks, usingDefaultCount: Math.max(0, properties.length - propertiesWithOwnFee) };
}

export type SetDefaultFeeArgs = {
  bps?: number | null;
  alsoResetOverrides?: boolean | null;
  expectedCounts?: { totalProperties: number; ownFeeCount: number; currentBps: number } | null;
};

/**
 * Sets the org default fee; with `alsoResetOverrides` also clears every link's own fee (one audit
 * row per link). Refuses (ConvexError { message, field }) when the fee is missing / out of range /
 * unchanged, or when the counts or the current default differ from `expectedCounts`. Nothing is
 * written on a refusal.
 */
export async function applyDefaultFee(
  ctx: WriteCtx,
  org: { orgId: string; userId: Id<"users"> },
  args: SetDefaultFeeArgs,
  audit: AuditWriter,
): Promise<{ defaultBps: number; reset: number }> {
  const row = await settingsRow(ctx, org.orgId);
  const currentBps = orgDefaultFeeBps(row?.rosDefaultFeeBps);
  const { counts, ownLinks } = await loadFeeCounts(ctx, org.orgId);
  const alsoReset = args.alsoResetOverrides === true;
  const problem = setDefaultFeeProblem({
    bps: args.bps,
    alsoResetOverrides: alsoReset,
    currentBps,
    actual: counts,
    expected: args.expectedCounts,
  });
  if (problem) throw new ConvexError({ message: problem.message, field: problem.field });
  const bps = args.bps as number;
  const now = Date.now();
  const mctx = ctx as MutationCtx;

  if (bps !== currentBps || row?.rosDefaultFeeBps === undefined) {
    if (row) await ctx.db.patch(row._id, { rosDefaultFeeBps: bps, updatedBy: org.userId, updatedAt: now });
    else await ctx.db.insert("financeSettings", { orgId: org.orgId, rosDefaultFeeBps: bps, updatedBy: org.userId, updatedAt: now });
  }
  if (bps !== currentBps) {
    await audit(mctx, {
      orgId: org.orgId,
      entity: "config",
      entityId: "ros_default_fee",
      action: "ros_default_fee_changed",
      actorUserId: org.userId,
      from: `${formatBps(currentBps)}%`,
      to: `${formatBps(bps)}%`,
      note: JSON.stringify({ ...counts, alsoResetOverrides: alsoReset }),
    });
  }

  let reset = 0;
  if (alsoReset) {
    const names = new Map<string, string>();
    for (const l of ownLinks) {
      let name = names.get(l.propertyId);
      if (name === undefined) {
        const p = await ctx.db.get(l.propertyId);
        name = p && p.orgId === org.orgId ? p.name : "Unknown property";
        names.set(l.propertyId, name);
      }
      const from = `${formatBps(l.managementFeeBps as number)}% (own)`;
      await ctx.db.patch(l._id, { managementFeeBps: undefined, updatedAt: now });
      await audit(mctx, {
        orgId: org.orgId,
        entity: "owner",
        entityId: l.ownerId,
        action: "owner_property_fee_changed",
        actorUserId: org.userId,
        from,
        to: `${formatBps(bps)}% (default)`,
        note: `${name}: reset by "Change fee for all properties"`,
      });
      reset++;
    }
  }
  return { defaultBps: bps, reset };
}
