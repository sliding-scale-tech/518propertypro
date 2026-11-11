import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import type { OrgContext } from "./authz";
import { canUseFinance, fieldError, requireFinance } from "./financeAccess";
import { needsAccountSetup, seedIfNeeded } from "./ledgerAccountSeed";
import { formatMonth, naturalCompare } from "./rosFormat";
import { rosPendingOf, validateBillingFields, type BillingFields } from "./rosPolicy";

/**
 * Work-order billing for the Rental Owner Statement (docs/specs/ros-build-spec.md 5.6).
 *
 * The office sets the billing fields when it closes a work order (workOrders.reviewClose, which
 * uses the helpers below), and finance (admin view or accountant) may change them afterwards with
 * updateBilling until the work order is billed on a final statement. A billed work order never
 * changes: corrections go on a later statement.
 *
 * Every exported query / mutation calls requireFinance(ctx) first (spec 2, checked by a source scan).
 * Cost (costCents) is internal: it is never returned by a finance query here.
 */

export const WO_NOT_FOUND = "Work order not found.";

export function notClosedMessage(n: number): string {
  return `Only closed work orders can be billed. Close WO-${n} first.`;
}

export function billedMessage(n: number, monthLabel: string, legalName: string): string {
  return `WO-${n} was billed on the ${monthLabel} statement for ${legalName} and can't be changed. Add a correction on a later statement instead.`;
}

/** Loose billing input, as the close form and updateBilling send it (money in integer cents). */
export type BillingInput = {
  workCompletedDescription?: string | null;
  billAmountCents?: number | null;
  costCents?: number | null;
  rosAccountId?: string | null;
  billPropertyLevel?: boolean | null;
  noOwnerCharge?: boolean | null;
};

/**
 * Seeds the default ledger accounts only while the org isn't set up (a system account is missing;
 * the same rule as ledgerAccounts.ensureSeeded), and audits it when something was inserted. So a
 * default the accountant deleted or renamed never comes back when a work order is closed.
 */
export async function seedAccounts(ctx: MutationCtx, org: OrgContext): Promise<void> {
  const inserted = await seedIfNeeded(ctx, org.orgId);
  if (inserted.length === 0) return;
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "ledger_account",
    entityId: org.orgId,
    action: "accounts_seeded",
    actorUserId: org.user._id,
    note: inserted.join(", "),
  });
}

/** The account for a typed id, only when it belongs to this org (else null = not chosen). */
async function accountInOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  raw: string | null | undefined,
): Promise<Doc<"ledgerAccounts"> | null> {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const id = ctx.db.normalizeId("ledgerAccounts", s);
  if (!id) return null;
  const account = await ctx.db.get(id);
  return account && account.orgId === orgId ? account : null;
}

/**
 * Validates the billing fields with the shared rosPolicy rules (the client form runs the same
 * function, so the messages match). Throws a field-level ConvexError on the first bad field.
 * `account` is null when "No charge to owner" is on (the account is not used then).
 */
export async function checkBillingFields(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  input: BillingInput,
): Promise<{ value: BillingFields; account: Doc<"ledgerAccounts"> | null }> {
  const account = await accountInOrg(ctx, orgId, input.rosAccountId);
  const res = validateBillingFields({
    workCompletedDescription: input.workCompletedDescription,
    noOwnerCharge: input.noOwnerCharge,
    billAmount: input.billAmountCents,
    cost: input.costCents,
    rosAccountId: input.rosAccountId,
    billPropertyLevel: input.billPropertyLevel,
    account: account ? { name: account.name, active: account.active, kind: account.kind } : null,
  });
  if (!res.ok) throw fieldError(res.field, res.message);
  return { value: res.value, account: res.value.noOwnerCharge ? null : account };
}

/**
 * The work-order fields for validated billing on a closed, unbilled work order (reviewClose and
 * updateBilling). "No charge to owner" clears the bill and account. Includes rosPending.
 */
export function billingPatch(value: BillingFields, account: Doc<"ledgerAccounts"> | null) {
  return {
    rosPending: !value.noOwnerCharge,
    workCompletedDescription: value.workCompletedDescription,
    billAmountCents: value.noOwnerCharge ? undefined : (value.billAmountCents ?? undefined),
    costCents: value.costCents ?? undefined,
    rosAccountId: value.noOwnerCharge ? undefined : (account?._id ?? undefined),
    billPropertyLevel: value.billPropertyLevel,
    noOwnerCharge: value.noOwnerCharge,
  };
}

/**
 * The read-only Billing block for staff screens (board drawer and the work-order page). Never
 * call this for a technician: it carries the bill amount and the internal cost.
 */
export async function billingView(ctx: QueryCtx, org: OrgContext, wo: Doc<"workOrders">) {
  const account = wo.rosAccountId ? await ctx.db.get(wo.rosAccountId) : null;
  let billedLabel: string | null = null;
  if (wo.billedStatementId) {
    const statement = await ctx.db.get(wo.billedStatementId);
    billedLabel =
      statement && statement.orgId === org.orgId ? `Billed on ${formatMonth(statement.month)} statement` : "Billed";
  }
  return {
    workCompletedDescription: wo.workCompletedDescription ?? null,
    billAmountCents: wo.billAmountCents ?? null,
    costCents: wo.costCents ?? null,
    rosAccountId: (wo.rosAccountId ?? null) as Id<"ledgerAccounts"> | null,
    rosAccountName: account && account.orgId === org.orgId ? account.name : null,
    billPropertyLevel: wo.billPropertyLevel ?? false,
    noOwnerCharge: wo.noOwnerCharge ?? false,
    billedStatementId: (wo.billedStatementId ?? null) as Id<"ownerStatements"> | null,
    billedLabel,
    /** Finance may edit billing on a closed work order until it is billed. */
    canEdit: canUseFinance(org) && wo.status === "reviewed_closed" && !wo.billedStatementId,
  };
}

/** For the audit row: the billing fields as stored (null = not set). */
function storedBilling(wo: Doc<"workOrders">) {
  return {
    workCompletedDescription: wo.workCompletedDescription ?? null,
    billAmountCents: wo.billAmountCents ?? null,
    costCents: wo.costCents ?? null,
    rosAccountId: (wo.rosAccountId ?? null) as string | null,
    billPropertyLevel: wo.billPropertyLevel ?? false,
    noOwnerCharge: wo.noOwnerCharge ?? false,
  };
}

/** The account list for the close / edit-billing form: active expense accounts, Repairs preselected. */
export const accountsForClose = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    const rows = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .take(500);
    const accounts = rows
      .filter((a) => a.active && a.kind === "expense")
      .sort((a, b) => naturalCompare(a.name, b.name) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
      .map((a) => ({ _id: a._id, name: a.name }));
    const repairs = rows.find((a) => a.systemKey === "repairs");
    return {
      accounts,
      defaultAccountId: repairs && repairs.active && repairs.kind === "expense" ? repairs._id : null,
      /** The default accounts have not been created yet: the form calls ensureAccounts once. */
      needsSetup: needsAccountSetup(rows),
    };
  },
});

/** Creates the default accounts when they are missing (idempotent), so the close form has a list. */
export const ensureAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    await seedAccounts(ctx, org);
    return null;
  },
});

/**
 * Finance edits the billing of a closed work order that is not billed yet. Omitted fields keep
 * their stored value; `null` clears bill or cost. The merged result is validated as a whole.
 */
export const updateBilling = mutation({
  args: {
    workOrderId: v.optional(v.string()),
    workCompletedDescription: v.optional(v.string()),
    billAmountCents: v.optional(v.union(v.number(), v.null())),
    costCents: v.optional(v.union(v.number(), v.null())),
    rosAccountId: v.optional(v.string()),
    billPropertyLevel: v.optional(v.boolean()),
    noOwnerCharge: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const id = args.workOrderId ? ctx.db.normalizeId("workOrders", args.workOrderId.trim()) : null;
    const wo = id ? await ctx.db.get(id) : null;
    if (!wo || wo.orgId !== org.orgId) throw new ConvexError(WO_NOT_FOUND);
    if (wo.status !== "reviewed_closed") throw new ConvexError(notClosedMessage(wo.number));
    if (wo.billedStatementId) {
      const statement = await ctx.db.get(wo.billedStatementId);
      const owner = statement && statement.orgId === org.orgId ? await ctx.db.get(statement.ownerId) : null;
      throw new ConvexError(
        statement && owner
          ? billedMessage(wo.number, formatMonth(statement.month), owner.legalName)
          : `WO-${wo.number} was billed on a final owner statement and can't be changed. Add a correction on a later statement instead.`,
      );
    }

    const { value, account } = await checkBillingFields(ctx, org.orgId, {
      workCompletedDescription:
        args.workCompletedDescription !== undefined ? args.workCompletedDescription : wo.workCompletedDescription,
      billAmountCents: args.billAmountCents !== undefined ? args.billAmountCents : wo.billAmountCents,
      costCents: args.costCents !== undefined ? args.costCents : wo.costCents,
      rosAccountId: args.rosAccountId !== undefined ? args.rosAccountId : wo.rosAccountId,
      billPropertyLevel: args.billPropertyLevel ?? wo.billPropertyLevel ?? false,
      noOwnerCharge: args.noOwnerCharge ?? wo.noOwnerCharge ?? false,
    });

    const before = storedBilling(wo);
    const next = billingPatch(value, account);
    const after = {
      workCompletedDescription: next.workCompletedDescription,
      billAmountCents: next.billAmountCents ?? null,
      costCents: next.costCents ?? null,
      rosAccountId: (next.rosAccountId ?? null) as string | null,
      billPropertyLevel: next.billPropertyLevel,
      noOwnerCharge: next.noOwnerCharge,
    };
    const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => before[k] !== after[k]);
    if (changed.length === 0) return null;

    const patch: Partial<Doc<"workOrders">> = { updatedAt: Date.now() };
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    for (const k of changed) {
      // undefined removes the field (bill / cost / account cleared).
      (patch as Record<string, unknown>)[k] = next[k];
      from[k] = before[k];
      to[k] = after[k];
    }
    // Closed and unbilled (checked above): pending for the ROS unless "No charge to owner".
    patch.rosPending = !next.noOwnerCharge;
    await ctx.db.patch(wo._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "work_order",
      entityId: wo._id,
      action: "billing_updated",
      actorUserId: org.user._id,
      from: JSON.stringify(from),
      to: JSON.stringify(to),
    });
    return null;
  },
});

/**
 * ONE-TIME BACKFILL of workOrders.rosPending (idempotent; safe to run again). Work orders closed
 * before the field existed have it undefined; until this runs the ROS build reads those through a
 * fallback (rosBuild.loadBuildData), so nothing is missed. Sets rosPending = rosPendingOf(wo) on every
 * work order whose stored value differs, one page at a time. Run from the dashboard/ folder:
 *   npx convex run workOrderBilling:backfillRosPending '{}'
 * and repeat with the returned `continueCursor` as `cursor` until `isDone` is true.
 */
export const backfillRosPending = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string; scanned: number; updated: number }> => {
    const size = Math.min(Math.max(Math.floor(args.batchSize ?? 200), 1), 500);
    const page = await ctx.db.query("workOrders").paginate({ numItems: size, cursor: args.cursor ?? null });
    let updated = 0;
    for (const wo of page.page) {
      const pending = rosPendingOf(wo);
      if (wo.rosPending === pending) continue;
      await ctx.db.patch(wo._id, { rosPending: pending });
      updated++;
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, scanned: page.page.length, updated };
  },
});
