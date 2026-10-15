import type { QueryCtx } from "./_generated/server";
import { DEFAULT_TOUR_RULES } from "./tourSchedule";
import type { TourRules } from "./tourSchedule";
import { normalizeConfig } from "./sarahConfigLib";
import type { SarahConfig } from "./sarahConfigLib";

/**
 * Reads of the PUBLISHED Sarah configuration, in a module of their own so the booking code and
 * the notification service can use them without importing sarahConfig.ts (which imports the
 * agent module). Only published values are ever used on a live path; a draft changes nothing
 * until someone publishes it.
 */
export async function publishedConfig(ctx: QueryCtx, orgId: string): Promise<SarahConfig | null> {
  const row = await ctx.db
    .query("sarahConfig")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  return row?.published ? normalizeConfig(row.published) : null;
}

/** Tour numbers from the published config, or the code defaults. Never throws. */
export async function tourRulesFor(ctx: QueryCtx, orgId: string): Promise<TourRules> {
  try {
    const c = await publishedConfig(ctx, orgId);
    if (!c) return DEFAULT_TOUR_RULES;
    const l = c.leasing;
    return {
      tourMinutes: l.tourMinutes,
      bufferMinutes: l.bufferMinutes,
      slotStepMinutes: l.slotStepMinutes,
      minLeadMinutes: l.minLeadMinutes,
    };
  } catch {
    return DEFAULT_TOUR_RULES;
  }
}
