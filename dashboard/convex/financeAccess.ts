import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireOrg, viewFor, type OrgContext } from "./authz";
import { canUseFinanceView } from "./rosPolicy";

/**
 * Rental Owner Statement (ROS) access gate (spec section 2). The finance pages are for the admin
 * view (team admin flag, executive, maintenance_lead, simplr_admin) and the accountant view.
 * Asset managers, technicians and people with no role are refused.
 */

export const FINANCE_DENIED = "You don't have access to owner statements.";

export function canUseFinance(org: OrgContext): boolean {
  return canUseFinanceView(viewFor(org.isAdmin, org.jobRoles));
}

/** First line of every finance query and mutation. */
export async function requireFinance(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!canUseFinance(org)) throw new ConvexError(FINANCE_DENIED);
  return org;
}

/** Field-level user error: the UI marks `field` red and shows `message` under it and in a toast. */
export function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}
