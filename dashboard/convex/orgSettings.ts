import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

// --- Reads ----------------------------------------------------------------

export const current = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("orgSettings").first();
    return { staffPhoneNumber: row?.staffPhoneNumber ?? process.env.STAFF_PHONE_NUMBER ?? "" };
  },
});

/** Resolves the staff phone number: dashboard-saved value wins, env var is the fallback. */
export const staffPhoneNumberInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | undefined> => {
    const row = await ctx.db.query("orgSettings").first();
    return row?.staffPhoneNumber || process.env.STAFF_PHONE_NUMBER || undefined;
  },
});

// --- Writes ---------------------------------------------------------------

export const save = mutation({
  args: { staffPhoneNumber: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("orgSettings").first();
    if (existing) await ctx.db.patch(existing._id, { staffPhoneNumber: args.staffPhoneNumber });
    else await ctx.db.insert("orgSettings", { staffPhoneNumber: args.staffPhoneNumber });
  },
});
