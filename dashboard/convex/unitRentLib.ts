import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { writeAudit } from "./audit";
import type { OrgContext } from "./authz";
import { formatCurrency, formatMonth, monthOf } from "./rosFormat";
import { unitAt } from "./rentPaymentsPolicy";
import {
  RENT_CHANGE_MSG,
  centsToRosterDollars,
  earliestRentChangeMonth,
  governedMonths,
  latestRentChange,
  latestRentChangeMonth,
  rentHistoryLines,
  rentInEffect,
  upcomingRentChange,
  validateRentChange,
} from "./unitRentPolicy";

/**
 * Rent changes with an effective month (spec 5.9 "Rent history"): the logic behind
 * convex/unitRent.ts, which registers the functions and calls these after requireFinance (admin
 * view + accountant). Kept free of runtime Convex server imports (the audit trail comes in as
 * `deps`), so scripts/probes/ros_rent_history.test.mjs runs every rule against a fake database.
 *
 * This module is the only writer of `unitRentChanges`, and writes `units.rent` (kept equal to the
 * latest change) besides convex/units.ts. Nothing here sends any message.
 */

type Ctx = Pick<QueryCtx | MutationCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
/** The caller (requireFinance's result); only the org and the acting user are read. */
export type RentOrg = Pick<OrgContext, "orgId"> & { user: Pick<OrgContext["user"], "_id"> };
type AuditEvent = Parameters<typeof writeAudit>[1];
export type RentDeps = { audit: (event: AuditEvent) => Promise<void> };
type Raw = string | null | undefined;

/** Field-level user error (same shape as financeAccess.fieldError). */
function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}

function trimmed(raw: Raw): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The unit of this org (or null), from a client string id. */
async function ownUnit(ctx: Ctx, org: RentOrg, raw: Raw): Promise<Doc<"units"> | null> {
  const s = trimmed(raw);
  const id = s === "" ? null : ctx.db.normalizeId("units", s);
  const unit = id ? await ctx.db.get(id) : null;
  return unit && unit.orgId === org.orgId ? unit : null;
}

/** Every rent change of one unit (org-checked), any order. */
export async function rentChangesOf(ctx: Ctx, org: RentOrg, unitId: Id<"units">): Promise<Doc<"unitRentChanges">[]> {
  const rows = await ctx.db
    .query("unitRentChanges")
    .withIndex("by_unit_and_month", (q) => q.eq("unitId", unitId))
    .collect();
  return rows.filter((r) => r.orgId === org.orgId);
}

/** Every rent change of the org, grouped by unit id (one indexed read; the Payments list uses it). */
export async function rentChangesByUnit(ctx: Ctx, org: RentOrg): Promise<Map<string, Doc<"unitRentChanges">[]>> {
  const rows = await ctx.db
    .query("unitRentChanges")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();
  const out = new Map<string, Doc<"unitRentChanges">[]>();
  for (const r of rows) {
    if (r.orgId !== org.orgId) continue;
    const list = out.get(r.unitId);
    if (list) list.push(r);
    else out.set(r.unitId, [r]);
  }
  return out;
}

export type ChangeRentArgs = { unitId?: Raw; rent?: Raw; effectiveMonth?: Raw; note?: Raw };

export type ChangeRentResult = {
  rentCents: number;
  effectiveMonth: string;
  /** The rent in force for effectiveMonth before this change (null = none was set). */
  previousRentCents: number | null;
  /** True when it replaced an earlier change for the same effective month. */
  replaced: boolean;
  /** Months this change covers that are already marked paid at another amount (those payments are NOT changed). */
  paidMonths: Array<{ month: string; amountCents: number }>;
  /** The info lines for paidMonths, exact wording ("October 2026 is already marked paid at $1,200.00; that payment isn't changed."). */
  info: string[];
};

/**
 * unitRent.changeRent: from `effectiveMonth` the unit's rent is `rent` (typed dollars, parsed with
 * parseDollarsToCents). Rules: the unit (org-scoped); the amount (> $0, <= $1,000,000.00, whole
 * cents); the month (real, at most 24 months back and 12 ahead); the note (<= 200). A second change
 * for the same month replaces the first (audited); an amount equal to the rent already in force for
 * that month is refused. Paid months are never changed: the result lists the ones it covers.
 */
export async function changeRent(ctx: WriteCtx, org: RentOrg, args: ChangeRentArgs, today: string, deps: RentDeps): Promise<ChangeRentResult> {
  if (trimmed(args.unitId) === "") throw fieldError("unitId", RENT_CHANGE_MSG.unitMissing);
  const unit = await ownUnit(ctx, org, args.unitId);
  const property = unit ? await ctx.db.get(unit.propertyId) : null;
  if (!unit || !property || property.orgId !== org.orgId) throw fieldError("unitId", RENT_CHANGE_MSG.unitNotFound);

  const f = validateRentChange({ rent: args.rent, effectiveMonth: args.effectiveMonth, note: args.note, today });
  if (!f.ok) throw fieldError(f.field, f.message);
  const { rentCents, effectiveMonth, note } = f.value;

  const changes = await rentChangesOf(ctx, org, unit._id);
  const same = changes.filter((c) => c.effectiveMonth === effectiveMonth);
  const before = rentInEffect(unit, changes, effectiveMonth);
  if (before.cents === rentCents) throw fieldError("rent", RENT_CHANGE_MSG.unchanged(effectiveMonth, rentCents));
  // Replacing the unit's FIRST change with the rent it had before any change would undo it: refuse.
  if (same.length > 0 && same[0].previousRentCents != null && same[0].previousRentCents === rentCents) {
    const earliest = changes.reduce((m, c) => (c.effectiveMonth < m ? c.effectiveMonth : m), effectiveMonth);
    if (earliest === effectiveMonth) throw fieldError("rent", RENT_CHANGE_MSG.sameAsBefore(effectiveMonth, rentCents));
  }

  const now = Date.now();
  // The rent the unit had before this month's change: kept from the row being replaced, so the
  // pre-history base (the first change's previousRentCents) never moves.
  const previousRentCents = same.length > 0 ? (same[0].previousRentCents ?? null) : before.cents;
  // Read before the write: the replaced amount goes into the audit note.
  const replacedCents = same.length > 0 ? same[0].rentCents : null;
  let changeId: Id<"unitRentChanges">;
  if (same.length > 0) {
    changeId = same[0]._id;
    await ctx.db.patch(changeId, { rentCents, note: note ?? undefined, createdBy: org.user._id, createdAt: now });
  } else {
    changeId = await ctx.db.insert("unitRentChanges", {
      orgId: org.orgId,
      unitId: unit._id,
      effectiveMonth,
      rentCents,
      ...(previousRentCents !== null ? { previousRentCents } : {}),
      ...(note !== null ? { note } : {}),
      createdBy: org.user._id,
      createdAt: now,
    });
  }

  // units.rent = the latest change, for Sarah and every other reader of the current rent.
  const after = [...changes.filter((c) => c.effectiveMonth !== effectiveMonth), { _id: changeId, effectiveMonth, rentCents, createdAt: now }];
  const latest = latestRentChange(after);
  if (latest) {
    const dollars = centsToRosterDollars(latest.rentCents);
    if (unit.rent !== dollars) await ctx.db.patch(unit._id, { rent: dollars, updatedAt: now });
  }

  const label = unitAt(unit.unitNumber, property.name);
  await deps.audit({
    orgId: org.orgId,
    entity: "unit",
    entityId: unit._id,
    action: "rent_changed",
    actorUserId: org.user._id,
    from: JSON.stringify({ rentCents: before.cents }),
    to: JSON.stringify({ rentCents, effectiveMonth }),
    note: [
      `${label} · from ${formatMonth(effectiveMonth)}`,
      replacedCents !== null ? `replaced the earlier change for ${formatMonth(effectiveMonth)} (${formatCurrency(replacedCents)})` : null,
      note,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  // Paid months this change covers, at another amount: their payments keep their own amount.
  const range = governedMonths(after, effectiveMonth);
  const paid = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_unit_and_rent_month", (q) => q.eq("unitId", unit._id).gte("rentForMonth", effectiveMonth))
      .collect()
  )
    .filter(
      (e) =>
        e.orgId === org.orgId &&
        e.source === "rent_payment" &&
        e.voided !== true &&
        e.rentForMonth !== undefined &&
        e.rentForMonth >= range.from &&
        (range.until === null || e.rentForMonth < range.until) &&
        e.amountCents !== rentCents,
    )
    .map((e) => ({ month: e.rentForMonth as string, amountCents: e.amountCents }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return {
    rentCents,
    effectiveMonth,
    previousRentCents: before.cents,
    replaced: replacedCents !== null,
    paidMonths: paid,
    info: paid.map((p) => RENT_CHANGE_MSG.alreadyPaid(p.month, p.amountCents)),
  };
}

export type RentHistoryView = {
  unitId: string;
  unitNumber: string;
  propertyName: string;
  /** The rent in force this month (null = none set) and since when (null = the roster rent). */
  current: { cents: number | null; fromMonth: string | null };
  /** The next change after this month, if any. */
  upcoming: { month: string; cents: number } | null;
  hasHistory: boolean;
  /** Newest effective month first. */
  lines: Array<{
    changeId: string;
    effectiveMonth: string;
    fromCents: number | null;
    toCents: number;
    note: string | null;
    byName: string;
    at: number;
  }>;
  /** The raw history and the roster rent (DOLLARS), so the dialog can show the rent for any month (unitRentPolicy.rentForMonth). */
  changes: Array<{ effectiveMonth: string; rentCents: number; previousRentCents: number | null; createdAt: number }>;
  rosterRent: number | null;
  /** The Change rent dialog's month window. */
  earliestMonth: string;
  latestMonth: string;
  currentMonth: string;
};

/** unitRent.history: the unit's rent now, the upcoming change and every change, for the unit drawer and the dialog. */
export async function rentHistory(ctx: Ctx, org: RentOrg, args: { unitId?: Raw }, today: string): Promise<RentHistoryView> {
  if (trimmed(args.unitId) === "") throw fieldError("unitId", RENT_CHANGE_MSG.unitMissing);
  const unit = await ownUnit(ctx, org, args.unitId);
  const property = unit ? await ctx.db.get(unit.propertyId) : null;
  if (!unit || !property || property.orgId !== org.orgId) throw fieldError("unitId", RENT_CHANGE_MSG.unitNotFound);
  const changes = await rentChangesOf(ctx, org, unit._id);
  const month = monthOf(today);
  const now = rentInEffect(unit, changes, month);
  const up = upcomingRentChange(changes, month);
  const names = new Map<string, string>();
  const nameOf = async (id: Id<"users">): Promise<string> => {
    const hit = names.get(id);
    if (hit !== undefined) return hit;
    const u = await ctx.db.get(id);
    const n = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown";
    names.set(id, n);
    return n;
  };
  const lines: RentHistoryView["lines"] = [];
  for (const l of rentHistoryLines(unit, changes)) {
    lines.push({
      changeId: l.change._id,
      effectiveMonth: l.change.effectiveMonth,
      fromCents: l.fromCents,
      toCents: l.toCents,
      note: l.change.note ?? null,
      byName: await nameOf(l.change.createdBy),
      at: l.change.createdAt,
    });
  }
  return {
    unitId: unit._id,
    unitNumber: unit.unitNumber,
    propertyName: property.name,
    current: { cents: now.cents, fromMonth: now.fromMonth },
    upcoming: up ? { month: up.effectiveMonth, cents: up.rentCents } : null,
    hasHistory: now.hasHistory,
    lines,
    changes: changes.map((c) => ({
      effectiveMonth: c.effectiveMonth,
      rentCents: c.rentCents,
      previousRentCents: c.previousRentCents ?? null,
      createdAt: c.createdAt,
    })),
    rosterRent: unit.rent ?? null,
    earliestMonth: earliestRentChangeMonth(today),
    latestMonth: latestRentChangeMonth(today),
    currentMonth: month,
  };
}
