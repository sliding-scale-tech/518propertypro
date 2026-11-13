import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./audit";
import { requireFinance } from "./financeAccess";
import { businessToday } from "./rosFormat";
import { changeRent as changeRentLib, rentHistory } from "./unitRentLib";

/**
 * Rent changes with an effective month (spec 5.9 "Rent history"). Admin view + accountant only:
 * every function calls requireFinance(ctx) first, then the logic in unitRentLib.ts (which the node
 * tests run against a fake database). Org-scoped; nothing here sends any message. Every argument is a
 * nullable string so a missing or wrong value gets the specific ConvexError message, never the
 * validator's generic failure.
 */

const text = v.optional(v.union(v.string(), v.null()));

/** The unit's rent now, the upcoming change and its history (unit drawer, Change rent dialog). */
export const history = query({
  args: { unitId: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await rentHistory(ctx, org, args, businessToday(Date.now()));
  },
});

/** From `effectiveMonth` the unit's rent is `rent` (typed dollars, parsed on the server). */
export const changeRent = mutation({
  args: { unitId: text, rent: text, effectiveMonth: text, note: text },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await changeRentLib(ctx, org, args, businessToday(Date.now()), { audit: (event) => writeAudit(ctx, event) });
  },
});
