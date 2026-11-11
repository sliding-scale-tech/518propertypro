import type { MutationCtx } from "./_generated/server";
import { normalizeNameKey } from "./rosFormat";
import type { RowType } from "./rosPolicy";
import type { AccountSystemKey } from "./rosValidators";

/**
 * Default ledger accounts for owner statements (spec 3.4). A system account (any systemKey) can't
 * be renamed, deleted or turned off; Repairs is protected because it is the default account when a
 * work order is closed (ASSUMPTION A28).
 */
export type AccountSeed = { name: string; kind: RowType; systemKey?: AccountSystemKey; feeBase: boolean };

export const DEFAULT_ACCOUNTS: readonly AccountSeed[] = [
  { name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true },
  { name: "Dump Fees", kind: "expense", feeBase: false },
  { name: "Landscaping", kind: "expense", feeBase: false },
  { name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false },
  { name: "Pest Control", kind: "expense", feeBase: false },
  { name: "Predicate Notice", kind: "expense", feeBase: false },
  { name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false },
  { name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false },
  { name: "Owner Contribution", kind: "owner_contribution", systemKey: "owner_contribution", feeBase: false },
];

/** The system keys the statement engine needs to produce the fee and draw rows. */
export const REQUIRED_SYSTEM_KEYS: readonly AccountSystemKey[] = ["management_fees", "owner_draw"];

/** Every system key of the defaults (Rent Income, Management Fees, Repairs, Owner Draw, Owner Contribution). */
export const SYSTEM_KEYS: readonly AccountSystemKey[] = DEFAULT_ACCOUNTS.flatMap((a) => (a.systemKey ? [a.systemKey] : []));

/**
 * The org isn't set up yet: a system account is missing. System accounts can't be deleted or
 * renamed, so after setup this stays false, whatever the accountant does to the other defaults.
 */
export function needsAccountSetup(accounts: readonly { systemKey?: string }[]): boolean {
  const have = new Set(accounts.map((a) => a.systemKey).filter(Boolean));
  return SYSTEM_KEYS.some((k) => !have.has(k));
}

/**
 * Seeds the defaults only when needsAccountSetup (the one rule every caller uses). Calling
 * ensureDefaultAccounts on every mutation would bring back a non-system default the accountant
 * deleted or renamed (e.g. Pest Control). Returns the inserted names ([] = nothing to do).
 */
export async function seedIfNeeded(ctx: MutationCtx, orgId: string): Promise<string[]> {
  const existing = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  if (!needsAccountSetup(existing)) return [];
  return await ensureDefaultAccounts(ctx, orgId);
}

/**
 * Idempotent: inserts each seed whose nameKey is missing in the org and never changes rows that
 * already exist. Returns the names it inserted ([] when nothing was missing), so the caller can
 * write the `accounts_seeded` audit only when something was inserted.
 */
export async function ensureDefaultAccounts(ctx: MutationCtx, orgId: string): Promise<string[]> {
  const inserted: string[] = [];
  const now = Date.now();
  for (const seed of DEFAULT_ACCOUNTS) {
    const nameKey = normalizeNameKey(seed.name);
    const existing = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_org_and_name_key", (q) => q.eq("orgId", orgId).eq("nameKey", nameKey))
      .first();
    if (existing) continue;
    await ctx.db.insert("ledgerAccounts", {
      orgId,
      name: seed.name,
      nameKey,
      kind: seed.kind,
      ...(seed.systemKey ? { systemKey: seed.systemKey } : {}),
      feeBase: seed.feeBase,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    inserted.push(seed.name);
  }
  return inserted;
}
