import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./audit";
import { requireFinance } from "./financeAccess";
import { orgDefaultFeeBps } from "./rosPolicy";
import { applyDefaultFee, loadFeeCounts, settingsRow } from "./feeSettingsLib";

/**
 * The management fee settings (user decision 2026-11-11): one org-wide default (5.00% until
 * changed) and an optional own fee per property, on the owner-property link
 * (ownerProperties.managementFeeBps, set with owners.setPropertyFee). Admin view + accountant only.
 * The logic is in feeSettingsLib.ts (tested on a fake database).
 *
 * A fee change only moves drafts: open drafts are rebuilt on every read, so they recalculate, and
 * the Finalize dialog's previewHash (which covers each property's fee %) refuses a finalize that
 * was reviewed at the old fee. Final statements are frozen snapshots and never change.
 */

/** The default fee and how many properties use it / have their own fee. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    const row = await settingsRow(ctx, org.orgId);
    const { counts, usingDefaultCount } = await loadFeeCounts(ctx, org.orgId);
    return {
      defaultBps: orgDefaultFeeBps(row?.rosDefaultFeeBps),
      /** False until someone changes it (the 5.00% is then the built-in default). */
      changedBefore: row?.rosDefaultFeeBps !== undefined,
      totalProperties: counts.totalProperties,
      ownFeeCount: counts.ownFeeCount,
      usingDefaultCount,
    };
  },
});

/**
 * "Change fee for all properties": sets the org default to `bps`. With `alsoResetOverrides`, every
 * property's own fee is cleared too (so they all use the new default), one audit row per link.
 * `expectedCounts` is what the confirmation showed; if the counts or the current default changed
 * since, nothing is written and the person is asked to confirm again.
 */
export const setDefaultFee = mutation({
  args: {
    bps: v.optional(v.union(v.number(), v.null())),
    alsoResetOverrides: v.optional(v.union(v.boolean(), v.null())),
    expectedCounts: v.optional(
      v.union(
        v.object({ totalProperties: v.number(), ownFeeCount: v.number(), currentBps: v.number() }),
        v.null(),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await applyDefaultFee(ctx, { orgId: org.orgId, userId: org.user._id }, args, writeAudit);
  },
});
