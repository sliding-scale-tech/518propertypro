import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { OrgContext } from "./authz";
import { writeAudit } from "./audit";
import { fieldError, requireFinance } from "./financeAccess";
import { needsAccountSetup, seedIfNeeded } from "./ledgerAccountSeed";
import { naturalCompare, normalizeNameKey } from "./rosFormat";
import { ACCOUNT_MSG, KIND_LABELS, cmpStr, validateAccountFields } from "./rosPolicy";

/**
 * Rental Owner Statement (ROS) chart of accounts (spec 5.1). Admin view + accountant only
 * (requireFinance). Every expected failure is a ConvexError with the exact spec message.
 */

export const ACCOUNT_NOT_FOUND = "Account not found.";
const USED_CAP = 1000;

/** True when any system account (Rent Income, Management Fees, Repairs, Owner Draw, Owner Contribution) is missing. */
function needsSetupOf(accounts: Doc<"ledgerAccounts">[]): boolean {
  return needsAccountSetup(accounts);
}

/**
 * Seeds the default accounts when the org isn't set up yet (a system account is missing), and
 * writes the `accounts_seeded` audit when something was inserted.
 *
 * Gated on "a system account is missing" rather than calling ensureDefaultAccounts on every
 * mutation: ensureDefaultAccounts inserts every seed whose name is missing, so an unconditional
 * call would bring back a non-system default the accountant deleted or renamed (e.g. Pest Control).
 */
export async function ensureSeeded(ctx: MutationCtx, org: OrgContext): Promise<void> {
  const inserted = await seedIfNeeded(ctx, org.orgId);
  if (inserted.length > 0) {
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: org.orgId,
      action: "accounts_seeded",
      actorUserId: org.user._id,
      note: inserted.join(", "),
    });
  }
}

/** Ledger rows + work orders that use the account, counted up to USED_CAP + 1. */
async function usageCount(ctx: QueryCtx | MutationCtx, accountId: Id<"ledgerAccounts">): Promise<number> {
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(USED_CAP + 1);
  if (entries.length > USED_CAP) return USED_CAP + 1;
  const wos = await ctx.db
    .query("workOrders")
    .withIndex("by_ros_account", (q) => q.eq("rosAccountId", accountId))
    .take(USED_CAP + 1 - entries.length);
  return entries.length + wos.length;
}

function usedLabel(n: number): string {
  return n > USED_CAP ? `${USED_CAP}+` : String(n);
}

async function loadAccount(
  ctx: QueryCtx | MutationCtx,
  org: OrgContext,
  raw: string | null | undefined,
): Promise<Doc<"ledgerAccounts">> {
  const id = typeof raw === "string" && raw.trim() !== "" ? ctx.db.normalizeId("ledgerAccounts", raw.trim()) : null;
  const acc = id ? await ctx.db.get(id) : null;
  if (!acc || acc.orgId !== org.orgId) throw fieldError("accountId", ACCOUNT_NOT_FOUND);
  return acc;
}

async function nameTaken(
  ctx: MutationCtx,
  orgId: string,
  name: string | null | undefined,
  exceptId?: Id<"ledgerAccounts">,
): Promise<boolean> {
  const key = normalizeNameKey(typeof name === "string" ? name : "");
  if (key === "") return false;
  const rows = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_org_and_name_key", (q) => q.eq("orgId", orgId).eq("nameKey", key))
    .collect();
  return rows.some((r) => r._id !== exceptId);
}

// --- queries -------------------------------------------------------------------------------------

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const all = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const shown = all.filter((a) => args.includeInactive === true || a.active);
    shown.sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a._id, b._id));
    const accounts = [];
    for (const a of shown) {
      const used = await usageCount(ctx, a._id);
      accounts.push({
        _id: a._id,
        name: a.name,
        kind: a.kind,
        kindLabel: KIND_LABELS[a.kind],
        ...(a.systemKey ? { systemKey: a.systemKey } : {}),
        feeBase: a.feeBase,
        active: a.active,
        usedCount: Math.min(used, USED_CAP),
        usedLabel: usedLabel(used),
      });
    }
    return { needsSetup: needsSetupOf(all), accounts };
  },
});

// --- mutations -----------------------------------------------------------------------------------

export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    return null;
  },
});

export const create = mutation({
  args: { name: v.optional(v.union(v.string(), v.null())), kind: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    const checked = validateAccountFields({
      mode: "create",
      name: args.name,
      kind: args.kind,
      nameTaken: await nameTaken(ctx, org.orgId, args.name),
    });
    if (!checked.ok) throw fieldError(checked.field, checked.message);
    const { name, nameKey, kind } = checked.value;
    if (!kind) throw fieldError("kind", ACCOUNT_MSG.kindMissing);
    const now = Date.now();
    const accountId = await ctx.db.insert("ledgerAccounts", {
      orgId: org.orgId,
      name,
      nameKey,
      kind,
      feeBase: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: accountId,
      action: "account_created",
      actorUserId: org.user._id,
      to: JSON.stringify({ name, kind }),
    });
    return { accountId };
  },
});

export const rename = mutation({
  args: { accountId: v.optional(v.union(v.string(), v.null())), name: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    const acc = await loadAccount(ctx, org, args.accountId);
    if (acc.systemKey) throw fieldError("name", `${acc.name} is a system account and can't be renamed.`);
    const checked = validateAccountFields({
      mode: "rename",
      name: args.name,
      nameTaken: await nameTaken(ctx, org.orgId, args.name, acc._id),
    });
    if (!checked.ok) throw fieldError(checked.field, checked.message);
    const { name, nameKey } = checked.value;
    if (name === acc.name) return null;
    await ctx.db.patch(acc._id, { name, nameKey, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: acc._id,
      action: "account_renamed",
      actorUserId: org.user._id,
      from: acc.name,
      to: name,
    });
    return null;
  },
});

export const setActive = mutation({
  args: { accountId: v.optional(v.union(v.string(), v.null())), active: v.optional(v.union(v.boolean(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    const acc = await loadAccount(ctx, org, args.accountId);
    if (typeof args.active !== "boolean") throw fieldError("active", "Choose whether the account is on or off.");
    if (!args.active && acc.systemKey) {
      throw fieldError("active", `${acc.name} is a system account and can't be turned off.`);
    }
    if (acc.active === args.active) return null;
    await ctx.db.patch(acc._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: acc._id,
      action: args.active ? "account_activated" : "account_deactivated",
      actorUserId: org.user._id,
      from: acc.active ? "on" : "off",
      to: args.active ? "on" : "off",
    });
    return null;
  },
});

export const setFeeBase = mutation({
  args: { accountId: v.optional(v.union(v.string(), v.null())), feeBase: v.optional(v.union(v.boolean(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    const acc = await loadAccount(ctx, org, args.accountId);
    if (typeof args.feeBase !== "boolean") {
      throw fieldError("feeBase", "Choose whether the account counts toward the management fee.");
    }
    if (args.feeBase && acc.kind !== "income") {
      throw fieldError("feeBase", "Only income accounts can count toward the management fee.");
    }
    if (acc.feeBase === args.feeBase) return null;
    await ctx.db.patch(acc._id, { feeBase: args.feeBase, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: acc._id,
      action: "account_fee_base_changed",
      actorUserId: org.user._id,
      from: String(acc.feeBase),
      to: String(args.feeBase),
      note: acc.name,
    });
    return null;
  },
});

export const remove = mutation({
  args: { accountId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    await ensureSeeded(ctx, org);
    const acc = await loadAccount(ctx, org, args.accountId);
    if (acc.systemKey) throw fieldError("accountId", `${acc.name} is a system account and can't be deleted.`);
    const used = await usageCount(ctx, acc._id);
    if (used > 0) {
      throw fieldError(
        "accountId",
        `${acc.name} is used by ${usedLabel(used)} transactions or work orders. Turn it off instead of deleting it.`,
      );
    }
    await ctx.db.delete(acc._id);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_account",
      entityId: acc._id,
      action: "account_deleted",
      actorUserId: org.user._id,
      from: acc.name,
    });
    return null;
  },
});
