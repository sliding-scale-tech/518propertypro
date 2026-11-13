import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import type { OrgContext } from "./authz";
import { requireFinance } from "./financeAccess";
import { ensureSeeded } from "./ledgerAccounts";
import { listPayments, markMany, markOne, undoOne, updateOne, type PaymentDeps } from "./rentPaymentsLib";
import { businessToday } from "./rosFormat";

/**
 * Rent payments: the Payments page (/payments), spec 5.9. Admin view + accountant
 * only: every function calls requireFinance(ctx) first, then the logic in rentPaymentsLib.ts (which
 * the node tests run against a fake database). Org-scoped; nothing here sends any message.
 */

const RENT_ACCOUNT_MISSING = "The Rent Income account is missing. Open Accounts once to create it.";

/** The audit trail and the Rent Income system account (seeded on first use, like createDraft). */
function deps(ctx: MutationCtx, org: OrgContext): PaymentDeps {
  return {
    audit: (event) => writeAudit(ctx, event),
    rentAccount: async (): Promise<Doc<"ledgerAccounts">> => {
      await ensureSeeded(ctx, org);
      const acc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_org_and_system_key", (q) => q.eq("orgId", org.orgId).eq("systemKey", "rent_income"))
        .first();
      if (!acc) throw new ConvexError(RENT_ACCOUNT_MISSING);
      return acc;
    },
  };
}

const text = v.optional(v.union(v.string(), v.null()));

export const list = query({
  args: { month: text, category: text, ownerId: text, propertyId: text, status: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await listPayments(ctx, org, args, businessToday(Date.now()));
  },
});

/** Mark one unit's rent received. The amount is always the unit's rent for that month (rent history, else roster rent); the client never sends one. */
export const markReceived = mutation({
  args: { unitId: text, month: text, receivedDate: text, method: text, note: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await markOne(ctx, org, args, businessToday(Date.now()), deps(ctx, org));
  },
});

/** "Mark selected received": all or nothing, at most MAX_BULK_MARK units. */
export const markManyReceived = mutation({
  args: { unitIds: v.optional(v.union(v.array(v.string()), v.null())), month: text, receivedDate: text, method: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await markMany(ctx, org, args, businessToday(Date.now()), deps(ctx, org));
  },
});

export const updatePayment = mutation({
  args: { entryId: text, receivedDate: text, method: text, note: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await updateOne(ctx, org, args, businessToday(Date.now()), deps(ctx, org));
  },
});

/** Undo = void with a reason. */
export const undoPayment = mutation({
  args: { entryId: text, reason: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await undoOne(ctx, org, args, deps(ctx, org));
  },
});
