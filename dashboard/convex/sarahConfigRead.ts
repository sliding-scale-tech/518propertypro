import type { QueryCtx } from "./_generated/server";
import { DEFAULT_TOUR_RULES } from "./tourSchedule";
import type { TourRules } from "./tourSchedule";
import { normalizeConfig, tenantMessagesOf } from "./sarahConfigLib";
import type { SarahConfig, TenantMessageKey } from "./sarahConfigLib";

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

/**
 * The wording of a tenant-facing message, but ONLY when it is approved in the PUBLISHED config
 * (and non-empty). Null otherwise, and on any failure: a tenant text is never sent on a draft,
 * an unapproved wording or a read error. Callers treat null as "do not notify".
 */
export async function tenantMessage(ctx: QueryCtx, orgId: string, key: TenantMessageKey): Promise<string | null> {
  try {
    const c = await publishedConfig(ctx, orgId);
    if (!c) return null;
    const m = tenantMessagesOf(c)[key];
    if (!m.approved || !m.approvedBy) return null;
    const wording = m.wording.trim();
    return wording || null;
  } catch {
    return null;
  }
}
