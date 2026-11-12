import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { writeAudit } from "./audit";
import type { OrgContext } from "./authz";
import { formatMonth, monthEnd, monthOf, monthStart, naturalCompare } from "./rosFormat";
import { MSG, cmpStr } from "./rosPolicy";
import {
  MAX_BULK_MARK,
  MAX_UNDO_REASON,
  PAYMENT_METHOD_LABELS,
  RENT_PAYMENT_MEMO,
  RENT_PAY_MSG,
  earliestReceivedDate,
  latestRentMonth,
  paymentLock,
  paymentStatus,
  receivedDateLockProblem,
  rentMarkability,
  markRentMonthProblem,
  rentMonthProblem,
  rentMonthStartProblem,
  rentRecordsFor,
  teamLabel,
  teamRank,
  unitAt,
  validatePaymentFields,
  type PaymentMethod,
  type PaymentStatus,
  type RentRecord,
} from "./rentPaymentsPolicy";

/**
 * Rent payments (the Payments page, /payments), spec 5.9: the logic behind
 * convex/rentPayments.ts, which registers the functions and calls these after requireFinance.
 * Kept free of runtime Convex server imports (audit and the Rent Income account come in as `deps`),
 * so scripts/probes/ros_rent.test.mjs runs every rule against a fake database.
 *
 * A payment is a `ledgerEntries` row: source "rent_payment", the Rent Income system account, type
 * income, the unit, counterparty = the unit's active tenant(s) when marked, memo "Payment", amount =
 * the unit's roster rent in cents (never sent by the client), `date` = the day it was RECEIVED (cash
 * basis: it lands on that month's statement) and `rentForMonth` = the month the rent is for.
 * At most one non-voided rent_payment per unit per rentForMonth, checked inside the mutation (Convex
 * mutations are serializable, so two concurrent marks can't both pass).
 *
 * A payment can be changed or undone (= voided, with a reason) until it is billed on a final
 * statement or its received date is in a month that is final for the property. Rows go onto
 * statements like any unbilled ledger row (rosBuild), are stamped with statementId at finalize and
 * are then immutable. Nothing here sends any message.
 */

type Ctx = Pick<QueryCtx | MutationCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
/** The caller (requireFinance's result); only the org and the acting user are read. */
export type PayOrg = Pick<OrgContext, "orgId"> & { user: Pick<OrgContext["user"], "_id"> };
type AuditEvent = Parameters<typeof writeAudit>[1];

/** What a write needs from the server: the audit trail and the (seeded) Rent Income account. */
export type PaymentDeps = {
  audit: (event: AuditEvent) => Promise<void>;
  rentAccount: () => Promise<Doc<"ledgerAccounts">>;
};

/** Field-level user error (same shape as financeAccess.fieldError). */
function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}

type Raw = string | null | undefined;

/** The units read in one go (after the team / owner / property filter); ~600 today. Above this the list says it is incomplete. */
const MAX_LIST_UNITS = 3000;

const TEAMS = new Set(["gold", "silver", "make_up"]);
const STATUSES = new Set<PaymentStatus>(["paid", "unpaid", "not_markable"]);

const LIST_MSG = {
  teamUnknown: "Select a team.",
  ownerNotFound: "Owner not found.",
  propertyNotFound: "Property not found.",
  statusUnknown: "Select a status.",
} as const;

function trimmed(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function readId<T extends "owners" | "properties" | "units" | "ledgerEntries">(
  ctx: Ctx,
  table: T,
  raw: string | null | undefined,
): Id<T> | null {
  const s = trimmed(raw);
  return s === "" ? null : ctx.db.normalizeId(table, s);
}

async function inOrg<T extends "owners" | "properties" | "units" | "ledgerEntries">(
  ctx: Ctx,
  org: PayOrg,
  table: T,
  raw: string | null | undefined,
): Promise<Doc<T> | null> {
  const id = readId(ctx, table, raw);
  const doc = id ? await ctx.db.get(id) : null;
  return doc && (doc as { orgId?: string }).orgId === org.orgId ? (doc as Doc<T>) : null;
}

async function rentAccountIds(ctx: Ctx, org: PayOrg): Promise<Set<string>> {
  const rows = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_org_and_system_key", (q) => q.eq("orgId", org.orgId).eq("systemKey", "rent_income"))
    .collect();
  return new Set(rows.map((a) => a._id as string));
}

/** Per-call caches: the latest final month and the owner links of a property. */
function propertyCache(ctx: Ctx, org: PayOrg) {
  const locked = new Map<string, string | null>();
  const links = new Map<string, Doc<"ownerProperties">[]>();
  return {
    async lockedThrough(propertyId: Id<"properties">): Promise<string | null> {
      if (locked.has(propertyId)) return locked.get(propertyId) ?? null;
      // The index is ["propertyId", "status", "month"]: newest final month first, one row read.
      const latest = await ctx.db
        .query("ownerStatementProperties")
        .withIndex("by_property_and_status", (q) => q.eq("propertyId", propertyId).eq("status", "final"))
        .order("desc")
        .first();
      const m = latest && latest.orgId === org.orgId ? latest.month : null;
      locked.set(propertyId, m);
      return m;
    },
    async links(propertyId: Id<"properties">): Promise<Doc<"ownerProperties">[]> {
      const hit = links.get(propertyId);
      if (hit) return hit;
      const rows = (
        await ctx.db
          .query("ownerProperties")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect()
      ).filter((l) => l.orgId === org.orgId);
      links.set(propertyId, rows);
      return rows;
    },
  };
}

async function activeTenants(ctx: Ctx, org: PayOrg, unitId: Id<"units">): Promise<string[]> {
  const rows = await ctx.db
    .query("residents")
    .withIndex("by_unit", (q) => q.eq("unitId", unitId))
    .collect();
  return rows.filter((r) => r.orgId === org.orgId && r.active).map((r) => r.fullName);
}

/** null = the property has exactly one owner; else the message (no owner / co-owned). */
async function ownerProblem(ctx: Ctx, org: PayOrg, property: Doc<"properties">, links: Doc<"ownerProperties">[]): Promise<string | null> {
  if (links.length === 0) return RENT_PAY_MSG.noOwner(property.name);
  if (links.length >= 2) {
    const names: string[] = [];
    for (const l of links) {
      const o = await ctx.db.get(l.ownerId);
      names.push(o && o.orgId === org.orgId ? o.legalName : "Unknown owner");
    }
    return MSG.CO_OWNED(property.name, names);
  }
  return null;
}

export type PaymentView = {
  entryId: string;
  /** "payment" = marked on this page; "ledger" = a Rent Income row entered by hand in the ledger (read-only here). */
  kind: "payment" | "ledger";
  amountCents: number;
  receivedDate: string;
  method: PaymentMethod | null;
  methodLabel: string | null;
  note: string | null;
  counterparty: string;
  locked: boolean;
  lockedReason: string | null;
  statementId: string | null;
};

export type ListArgs = { month?: Raw; category?: Raw; ownerId?: Raw; propertyId?: Raw; status?: Raw };

/** rentPayments.list: one row per unit of the org for a rent month, with its status and payment. */
export async function listPayments(ctx: Ctx, org: PayOrg, args: ListArgs, today: string) {
  const monthProblem = rentMonthProblem(args.month, today);
  if (monthProblem) throw fieldError("month", monthProblem);
  const month = trimmed(args.month);

  const category = trimmed(args.category);
  if (category !== "" && !TEAMS.has(category)) throw fieldError("category", LIST_MSG.teamUnknown);
  const status = trimmed(args.status);
  if (status !== "" && !STATUSES.has(status as PaymentStatus)) throw fieldError("status", LIST_MSG.statusUnknown);
  const ownerFilter = trimmed(args.ownerId) === "" ? null : await inOrg(ctx, org, "owners", args.ownerId);
  if (trimmed(args.ownerId) !== "" && !ownerFilter) throw fieldError("ownerId", LIST_MSG.ownerNotFound);
  const propertyFilter = trimmed(args.propertyId) === "" ? null : await inOrg(ctx, org, "properties", args.propertyId);
  if (trimmed(args.propertyId) !== "" && !propertyFilter) throw fieldError("propertyId", LIST_MSG.propertyNotFound);

  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();
  const propById = new Map(properties.map((p) => [p._id as string, p]));
  const allLinks = await ctx.db
    .query("ownerProperties")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();
  const linksByProp = new Map<string, Doc<"ownerProperties">[]>();
  for (const l of allLinks) linksByProp.set(l.propertyId, [...(linksByProp.get(l.propertyId) ?? []), l]);
  const owners = await ctx.db
    .query("owners")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();
  const ownerById = new Map(owners.map((o) => [o._id as string, o]));

  /** The single owner of a property (null = no owner / co-owned). */
  const soleOwnerOf = (propertyId: string): string | null => {
    const links = linksByProp.get(propertyId) ?? [];
    return links.length === 1 ? links[0].ownerId : null;
  };
  // Units are read in one go, at most MAX_LIST_UNITS. With a team, owner or property filter only
  // the matching properties' units are read (by_property), so the cap applies AFTER the filter and
  // filtering really does show every unit of the team / owner / property.
  const scoped = category !== "" || ownerFilter !== null || propertyFilter !== null;
  let unitsRaw: Doc<"units">[];
  if (!scoped) {
    unitsRaw = await ctx.db
      .query("units")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .take(MAX_LIST_UNITS + 1);
  } else {
    unitsRaw = [];
    const inScope = properties
      .filter(
        (p) =>
          (category === "" || p.category === category) &&
          (!ownerFilter || soleOwnerOf(p._id) === ownerFilter._id) &&
          (!propertyFilter || p._id === propertyFilter._id),
      )
      .sort((a, b) => teamRank(a.category) - teamRank(b.category) || naturalCompare(a.name, b.name) || cmpStr(a._id, b._id));
    for (const p of inScope) {
      const us = await ctx.db
        .query("units")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id))
        .take(MAX_LIST_UNITS + 1 - unitsRaw.length);
      unitsRaw.push(...us.filter((u) => u.orgId === org.orgId));
      if (unitsRaw.length > MAX_LIST_UNITS) break;
    }
  }
  const truncated = unitsRaw.length > MAX_LIST_UNITS;
  const units = unitsRaw.slice(0, MAX_LIST_UNITS);
  // Marking is closed for months more than 24 months ago (they can still be viewed).
  const monthClosed = markRentMonthProblem(month, today);

  const tenantsOf = new Map<string, string[]>();
  const residents = await ctx.db
    .query("residents")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();
  for (const r of residents) {
    if (!r.active) continue;
    tenantsOf.set(r.unitId, [...(tenantsOf.get(r.unitId) ?? []), r.fullName]);
  }

  // What is recorded for the month: rent payments FOR the month, and Rent Income rows entered any
  // other way (by hand in the ledger before this page existed) DATED in the month.
  const rentIds = await rentAccountIds(ctx, org);
  const payments = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_org_and_rent_month", (q) => q.eq("orgId", org.orgId).eq("rentForMonth", month))
      .collect()
  ).filter((e) => e.source === "rent_payment" && e.voided !== true);
  const dated = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_org_and_date", (q) => q.eq("orgId", org.orgId).gte("date", monthStart(month)).lte("date", monthEnd(month)))
      .collect()
  ).filter((e) => e.source !== "rent_payment" && e.voided !== true && e.unitId !== undefined && rentIds.has(e.accountId));
  const recordsByUnit = new Map<string, RentRecord[]>();
  for (const e of [...payments, ...dated]) {
    if (e.unitId === undefined) continue;
    recordsByUnit.set(e.unitId, [...(recordsByUnit.get(e.unitId) ?? []), e]);
  }
  const docById = new Map<string, Doc<"ledgerEntries">>([...payments, ...dated].map((e) => [e._id as string, e]));

  const cache = propertyCache(ctx, org);
  const statementMonth = new Map<string, string | null>();
  const monthOfStatement = async (id: Id<"ownerStatements">): Promise<string | null> => {
    if (statementMonth.has(id)) return statementMonth.get(id) ?? null;
    const st = await ctx.db.get(id);
    const m = st && st.orgId === org.orgId ? st.month : null;
    statementMonth.set(id, m);
    return m;
  };

  type Row = {
    unitId: string;
    propertyId: string;
    propertyName: string;
    unit: string;
    category: string | null;
    teamLabel: string;
    ownerId: string | null;
    ownerName: string | null;
    /** Set = no owner / co-owned: rent can't be marked until that is fixed. */
    ownerProblem: string | null;
    tenants: string[];
    /** The roster rent in integer cents; null when missing or not a clean dollar amount. */
    rentCents: number | null;
    status: PaymentStatus;
    /** Why the row is greyed out (status not_markable). */
    reason: string | null;
    payment: PaymentView | null;
    /** "Mark received" is offered. */
    canMark: boolean;
    /** The property's formatted address (search matches it), or null. */
    propertyAddress: string | null;
  };

  const rows: Row[] = [];
  for (const u of units) {
    const p = propById.get(u.propertyId);
    if (!p) continue;
    const links = linksByProp.get(p._id) ?? [];
    const owner = links.length === 1 ? (ownerById.get(links[0].ownerId) ?? null) : null;
    let problem: string | null = null;
    if (links.length === 0) problem = RENT_PAY_MSG.noOwner(p.name);
    else if (links.length >= 2) {
      problem = MSG.CO_OWNED(
        p.name,
        links.map((l) => ownerById.get(l.ownerId)?.legalName ?? "Unknown owner"),
      );
    }
    const tenants = [...new Set((tenantsOf.get(u._id) ?? []).map((n) => n.trim()).filter((n) => n !== ""))].sort(naturalCompare);
    const mark = rentMarkability(u, tenants);
    const rec = rentRecordsFor(u._id, month, recordsByUnit.get(u._id) ?? [], rentIds);
    // A month before the owner's first statement month: rent isn't expected (it was in Buildium).
    const startMonth = links.length === 1 ? (links[0].startMonth ?? null) : null;
    const beforeStart = startMonth !== null && month < startMonth;
    const st = paymentStatus(mark.markable && !beforeStart, rec);

    let payment: PaymentView | null = null;
    if (rec.payment !== null) {
      const e = docById.get(rec.payment._id)!;
      const lock = paymentLock(
        { statementId: e.statementId ?? null, date: e.date },
        {
          name: p.name,
          lockedThrough: await cache.lockedThrough(p._id),
          statementMonth: e.statementId ? await monthOfStatement(e.statementId) : null,
        },
      );
      payment = {
        entryId: e._id,
        kind: "payment",
        amountCents: e.amountCents,
        receivedDate: e.date,
        method: e.paymentMethod ?? null,
        methodLabel: e.paymentMethod ? PAYMENT_METHOD_LABELS[e.paymentMethod] : null,
        note: e.paymentNote ?? null,
        counterparty: e.counterparty,
        locked: lock.locked,
        lockedReason: lock.reason,
        statementId: e.statementId ?? null,
      };
    } else if (rec.ledger.length > 0) {
      const first = [...rec.ledger].sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a._id, b._id))[0];
      const e = docById.get(first._id)!;
      payment = {
        entryId: e._id,
        kind: "ledger",
        amountCents: rec.ledger.reduce((sum, r) => sum + r.amountCents, 0),
        receivedDate: e.date,
        method: null,
        methodLabel: null,
        note: rec.ledger.length > 1 ? `${rec.ledger.length} Rent Income rows in the ledger` : null,
        counterparty: e.counterparty,
        locked: true,
        lockedReason: RENT_PAY_MSG.lockedLegacy,
        statementId: e.statementId ?? null,
      };
    }

    rows.push({
      unitId: u._id,
      propertyId: p._id,
      propertyName: p.name,
      unit: u.unitNumber,
      category: p.category ?? null,
      teamLabel: teamLabel(p.category),
      ownerId: owner?._id ?? null,
      ownerName: owner?.legalName ?? null,
      ownerProblem: problem,
      tenants,
      rentCents: mark.markable ? mark.amountCents : null,
      status: st,
      reason:
        st !== "not_markable"
          ? null
          : !mark.markable
            ? mark.reason
            : beforeStart && startMonth !== null
              ? RENT_PAY_MSG.beforeStartReason(startMonth)
              : null,
      payment,
      canMark: st === "unpaid" && problem === null && monthClosed === null,
      propertyAddress: p.address?.formatted ?? null,
    });
  }

  // Filter choices: every property of the org, and every owner with a property of their own (a
  // co-owned property belongs to no single owner). Not from the rows, which a filter narrows.
  const ownerChoices = new Map<string, string>();
  const propertyChoices = new Map<string, { propertyId: string; name: string; category: string | null; teamLabel: string }>();
  for (const p of properties) {
    const ownerId = soleOwnerOf(p._id);
    const owner = ownerId ? ownerById.get(ownerId) : undefined;
    if (owner) ownerChoices.set(owner._id, owner.legalName);
    propertyChoices.set(p._id, { propertyId: p._id, name: p.name, category: p.category ?? null, teamLabel: teamLabel(p.category) });
  }

  const filtered = rows.filter(
    (r) =>
      (category === "" || r.category === category) &&
      (!ownerFilter || r.ownerId === ownerFilter._id) &&
      (!propertyFilter || r.propertyId === propertyFilter._id),
  );
  const summary = { paid: 0, unpaid: 0, notMarkable: 0, total: filtered.length, receivedCents: 0, unpaidCents: 0 };
  for (const r of filtered) {
    if (r.status === "paid") {
      summary.paid += 1;
      summary.receivedCents += r.payment?.amountCents ?? 0;
    } else if (r.status === "unpaid") {
      summary.unpaid += 1;
      summary.unpaidCents += r.rentCents ?? 0;
    } else summary.notMarkable += 1;
  }
  const shown = filtered
    .filter((r) => status === "" || r.status === status)
    .sort(
      (a, b) =>
        teamRank(a.category) - teamRank(b.category) ||
        naturalCompare(a.propertyName, b.propertyName) ||
        cmpStr(a.propertyId, b.propertyId) ||
        naturalCompare(a.unit, b.unit) ||
        cmpStr(a.unitId, b.unitId),
    );

  return {
    month,
    monthLabel: formatMonth(month),
    today,
    /** The received-date window for this rent month (the dialogs use it). */
    earliestReceivedDate: earliestReceivedDate(month),
    latestRentMonth: latestRentMonth(today),
    rows: shown,
    summary,
    filters: {
      owners: [...ownerChoices.entries()]
        .map(([ownerId, name]) => ({ ownerId, name }))
        .sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a.ownerId, b.ownerId)),
      properties: [...propertyChoices.values()].sort(
        (a, b) => teamRank(a.category) - teamRank(b.category) || naturalCompare(a.name, b.name) || cmpStr(a.propertyId, b.propertyId),
      ),
    },
    truncated,
    /** The cap on units read (the truncation note names it). */
    maxUnits: MAX_LIST_UNITS,
    /** Set = rent can't be marked for this month (more than 24 months ago); the rows are view-only. */
    monthClosed,
  };
}

// --- marking -------------------------------------------------------------------------------------

type MarkPlan = {
  unit: Doc<"units">;
  property: Doc<"properties">;
  ownerId: Id<"owners">;
  amountCents: number;
  counterparty: string;
  label: string;
};

type MarkResult = { ok: true; plan: MarkPlan } | { ok: false; field: string; message: string };

/**
 * Every per-unit rule for marking one unit's rent for `month` as received on `receivedDate` (both
 * already valid): the unit, its owner, markable, not already recorded, the property's date locks.
 */
async function planMark(
  ctx: WriteCtx,
  org: PayOrg,
  cache: ReturnType<typeof propertyCache>,
  rentIds: Set<string>,
  unitRaw: string | null | undefined,
  month: string,
  receivedDate: string,
): Promise<MarkResult> {
  if (trimmed(unitRaw) === "") return { ok: false, field: "unitId", message: RENT_PAY_MSG.unitMissing };
  const unit = await inOrg(ctx, org, "units", unitRaw);
  const property = unit ? await ctx.db.get(unit.propertyId) : null;
  if (!unit || !property || property.orgId !== org.orgId) return { ok: false, field: "unitId", message: RENT_PAY_MSG.unitNotFound };
  const label = unitAt(unit.unitNumber, property.name);

  const links = await cache.links(property._id);
  const problem = await ownerProblem(ctx, org, property, links);
  if (problem) return { ok: false, field: "unitId", message: problem };
  const link = links[0];

  const mark = rentMarkability(unit, await activeTenants(ctx, org, unit._id));
  if (!mark.markable) return { ok: false, field: "unitId", message: RENT_PAY_MSG.notMarkable(label, mark.sentence) };

  // No rent for a month before the owner's first statement month (those months were in Buildium).
  const beforeStart = rentMonthStartProblem(month, { name: property.name, startMonth: link.startMonth });
  if (beforeStart) return { ok: false, field: "month", message: beforeStart };

  // One payment per unit per rent month; and never on top of rent entered by hand for that month.
  const existing = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_unit_and_rent_month", (q) => q.eq("unitId", unit._id).eq("rentForMonth", month))
      .collect()
  ).find((e) => e.orgId === org.orgId && e.source === "rent_payment" && e.voided !== true);
  if (existing) return { ok: false, field: "unitId", message: RENT_PAY_MSG.alreadyPaid(label, month) };
  const byHand = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_unit_and_date", (q) => q.eq("unitId", unit._id).gte("date", monthStart(month)).lte("date", monthEnd(month)))
      .collect()
  ).find((e) => e.orgId === org.orgId && e.source !== "rent_payment" && e.voided !== true && rentIds.has(e.accountId));
  if (byHand) return { ok: false, field: "unitId", message: RENT_PAY_MSG.alreadyInLedger(label, month) };
  // ...and never a second Rent Income row DATED in the received month: a row entered by hand is
  // matched to the month it is dated in, so both would count for that month's statement.
  const sameMonth = await rentDatedInMonth(ctx, org, rentIds, unit._id, monthOf(receivedDate), null);
  if (sameMonth) return { ok: false, field: "unitId", message: RENT_PAY_MSG.alreadyDatedInMonth(label, monthOf(receivedDate), sameMonth) };

  const lock = receivedDateLockProblem(receivedDate, {
    name: property.name,
    lockedThrough: await cache.lockedThrough(property._id),
    startMonth: link.startMonth ?? null,
  });
  if (lock) return { ok: false, field: "receivedDate", message: lock };

  return { ok: true, plan: { unit, property, ownerId: link.ownerId, amountCents: mark.amountCents, counterparty: mark.counterparty, label } };
}

/**
 * A non-voided Rent Income row of the unit (entered in the ledger, or a rent payment for any rent
 * month) dated in `month`, other than `exceptId`; null = none. `rentForMonth` null = entered in
 * the ledger.
 */
async function rentDatedInMonth(
  ctx: Ctx,
  org: PayOrg,
  rentIds: Set<string>,
  unitId: Id<"units">,
  month: string,
  exceptId: string | null,
): Promise<{ rentForMonth: string | null } | null> {
  const rows = (
    await ctx.db
      .query("ledgerEntries")
      .withIndex("by_unit_and_date", (q) => q.eq("unitId", unitId).gte("date", monthStart(month)).lte("date", monthEnd(month)))
      .collect()
  ).filter(
    (e) =>
      e.orgId === org.orgId &&
      e.voided !== true &&
      e._id !== exceptId &&
      (e.source === "rent_payment" || rentIds.has(e.accountId)),
  );
  if (rows.length === 0) return null;
  const first = [...rows].sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a._id, b._id))[0];
  return { rentForMonth: first.source === "rent_payment" ? (first.rentForMonth ?? null) : null };
}

async function insertPayment(
  ctx: WriteCtx,
  org: PayOrg,
  deps: PaymentDeps,
  account: Doc<"ledgerAccounts">,
  plan: MarkPlan,
  f: { month: string; receivedDate: string; method: PaymentMethod; note: string | null },
  now: number,
): Promise<Id<"ledgerEntries">> {
  const entryId = await ctx.db.insert("ledgerEntries", {
    orgId: org.orgId,
    ownerId: plan.ownerId,
    propertyId: plan.property._id,
    unitId: plan.unit._id,
    date: f.receivedDate,
    type: account.kind,
    accountId: account._id,
    counterparty: plan.counterparty,
    memo: RENT_PAYMENT_MEMO,
    amountCents: plan.amountCents,
    source: "rent_payment",
    rentForMonth: f.month,
    paymentMethod: f.method,
    ...(f.note !== null ? { paymentNote: f.note } : {}),
    createdBy: org.user._id,
    createdAt: now,
    updatedAt: now,
  });
  await deps.audit({
    orgId: org.orgId,
    entity: "ledger_entry",
    entityId: entryId,
    action: "rent_marked_received",
    actorUserId: org.user._id,
    to: JSON.stringify({
      rentForMonth: f.month,
      receivedDate: f.receivedDate,
      property: plan.property.name,
      unit: plan.unit.unitNumber,
      counterparty: plan.counterparty,
      method: f.method,
      note: f.note,
      amountCents: plan.amountCents,
    }),
  });
  return entryId;
}

export type MarkArgs = { unitId?: Raw; month?: Raw; receivedDate?: Raw; method?: Raw; note?: Raw };

/** rentPayments.markReceived: one unit's rent for a month, received on a date, for the roster rent. */
export async function markOne(ctx: WriteCtx, org: PayOrg, args: MarkArgs, today: string, deps: PaymentDeps) {
  const f = validatePaymentFields({ month: args.month, receivedDate: args.receivedDate, method: args.method, note: args.note, today });
  if (!f.ok) throw fieldError(f.field, f.message);
  const cache = propertyCache(ctx, org);
  const r = await planMark(ctx, org, cache, await rentAccountIds(ctx, org), args.unitId, f.value.month, f.value.receivedDate);
  if (!r.ok) throw fieldError(r.field, r.message);
  const account = await deps.rentAccount();
  const entryId = await insertPayment(ctx, org, deps, account, r.plan, f.value, Date.now());
  return { entryId, amountCents: r.plan.amountCents };
}

export type MarkManyArgs = { unitIds?: string[] | null; month?: Raw; receivedDate?: Raw; method?: Raw };

/**
 * rentPayments.markManyReceived: the same rules for every unit, ALL OR NOTHING. If any unit fails,
 * nothing is written and the error lists every failing unit (data.problems).
 */
export async function markMany(ctx: WriteCtx, org: PayOrg, args: MarkManyArgs, today: string, deps: PaymentDeps) {
  const f = validatePaymentFields({ month: args.month, receivedDate: args.receivedDate, method: args.method, note: null, today });
  if (!f.ok) throw fieldError(f.field, f.message);
  const ids = [...new Set((args.unitIds ?? []).map((s) => trimmed(s)).filter((s) => s !== ""))];
  if (ids.length === 0) throw fieldError("unitIds", RENT_PAY_MSG.noneSelected);
  if (ids.length > MAX_BULK_MARK) throw fieldError("unitIds", RENT_PAY_MSG.tooMany);

  const cache = propertyCache(ctx, org);
  const rentIds = await rentAccountIds(ctx, org);
  const plans: MarkPlan[] = [];
  const problems: { unitId: string; message: string }[] = [];
  for (const id of ids) {
    const r = await planMark(ctx, org, cache, rentIds, id, f.value.month, f.value.receivedDate);
    if (r.ok) plans.push(r.plan);
    else problems.push({ unitId: id, message: r.message });
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 3).map((p) => p.message).join(" ");
    const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : "";
    throw new ConvexError({ message: RENT_PAY_MSG.bulkFailed(problems.length, `${shown}${more}`), field: "unitIds", problems });
  }

  const account = await deps.rentAccount();
  const now = Date.now();
  let totalCents = 0;
  for (const plan of plans) {
    await insertPayment(ctx, org, deps, account, plan, { ...f.value, note: null }, now);
    totalCents += plan.amountCents;
  }
  return { count: plans.length, totalCents };
}

// --- changing a payment --------------------------------------------------------------------------

/** A rent_payment row of this org that may still change (else the specific message). */
async function loadChangeable(
  ctx: WriteCtx,
  org: PayOrg,
  raw: string | null | undefined,
): Promise<{ entry: Doc<"ledgerEntries">; property: Doc<"properties">; month: string; cache: ReturnType<typeof propertyCache> }> {
  const entry = await inOrg(ctx, org, "ledgerEntries", raw);
  if (!entry) throw fieldError("entryId", RENT_PAY_MSG.entryNotFound);
  if (entry.source !== "rent_payment" || entry.rentForMonth === undefined) throw fieldError("entryId", RENT_PAY_MSG.notAPayment);
  if (entry.voided === true) throw fieldError("entryId", RENT_PAY_MSG.voided);
  const property = await ctx.db.get(entry.propertyId);
  if (!property || property.orgId !== org.orgId) throw fieldError("entryId", RENT_PAY_MSG.entryNotFound);
  const cache = propertyCache(ctx, org);
  const lock = paymentLock(
    { statementId: entry.statementId ?? null, date: entry.date },
    { name: property.name, lockedThrough: await cache.lockedThrough(property._id) },
  );
  if (lock.locked) throw fieldError("entryId", lock.message ?? RENT_PAY_MSG.billed);
  return { entry, property, month: entry.rentForMonth, cache };
}

export type UpdateArgs = { entryId?: Raw; receivedDate?: Raw; method?: Raw; note?: Raw };

/** rentPayments.updatePayment: change the received date, method or note (never the amount or month). */
export async function updateOne(ctx: WriteCtx, org: PayOrg, args: UpdateArgs, today: string, deps: PaymentDeps): Promise<null> {
  const { entry, property, month, cache } = await loadChangeable(ctx, org, args.entryId);
  // A field left undefined keeps its value; note null / "" clears it.
  const f = validatePaymentFields({
    month,
    receivedDate: args.receivedDate === undefined ? entry.date : args.receivedDate,
    method: args.method === undefined ? (entry.paymentMethod ?? null) : args.method,
    note: args.note === undefined ? (entry.paymentNote ?? null) : args.note,
    today,
  });
  if (!f.ok) throw fieldError(f.field, f.message);
  const next = f.value;

  if (next.receivedDate !== entry.date) {
    const links = await cache.links(property._id);
    const problem = await ownerProblem(ctx, org, property, links);
    if (problem) throw fieldError("receivedDate", problem);
    if (links[0].ownerId !== entry.ownerId) throw fieldError("receivedDate", RENT_PAY_MSG.ownerChanged(property.name));
    const lock = receivedDateLockProblem(next.receivedDate, {
      name: property.name,
      lockedThrough: await cache.lockedThrough(property._id),
      startMonth: links[0].startMonth ?? null,
    });
    if (lock) throw fieldError("receivedDate", lock);
    // Moving it into a month that already has other rent dated in it: the same double-count guard as marking.
    const newMonth = monthOf(next.receivedDate);
    if (newMonth !== monthOf(entry.date) && entry.unitId !== undefined) {
      const other = await rentDatedInMonth(ctx, org, await rentAccountIds(ctx, org), entry.unitId, newMonth, entry._id);
      if (other) {
        const unit = await ctx.db.get(entry.unitId);
        throw fieldError("receivedDate", RENT_PAY_MSG.alreadyDatedInMonth(unitLabelOf(unit, property), newMonth, other));
      }
    }
  }

  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  if (next.receivedDate !== entry.date) {
    from.receivedDate = entry.date;
    to.receivedDate = next.receivedDate;
  }
  if (next.method !== entry.paymentMethod) {
    from.method = entry.paymentMethod ?? null;
    to.method = next.method;
  }
  if (next.note !== (entry.paymentNote ?? null)) {
    from.note = entry.paymentNote ?? null;
    to.note = next.note;
  }
  if (Object.keys(to).length === 0) return null;
  await ctx.db.patch(entry._id, {
    date: next.receivedDate,
    paymentMethod: next.method,
    paymentNote: next.note ?? undefined,
    updatedAt: Date.now(),
  });
  await deps.audit({
    orgId: org.orgId,
    entity: "ledger_entry",
    entityId: entry._id,
    action: "rent_payment_updated",
    actorUserId: org.user._id,
    from: JSON.stringify(from),
    to: JSON.stringify(to),
    note: `${unitLabelOf(entry.unitId ? await ctx.db.get(entry.unitId) : null, property)} · ${formatMonth(month)} rent`,
  });
  return null;
}

export type UndoArgs = { entryId?: Raw; reason?: Raw };

/** rentPayments.undoPayment: void the payment row with a reason (kept in the ledger history). */
export async function undoOne(ctx: WriteCtx, org: PayOrg, args: UndoArgs, deps: PaymentDeps): Promise<null> {
  const { entry, property, month } = await loadChangeable(ctx, org, args.entryId);
  const reason = trimmed(args.reason);
  if (reason === "") throw fieldError("reason", RENT_PAY_MSG.undoReasonMissing);
  if (reason.length > MAX_UNDO_REASON) throw fieldError("reason", RENT_PAY_MSG.undoReasonLong);
  const now = Date.now();
  await ctx.db.patch(entry._id, { voided: true, voidedAt: now, voidedBy: org.user._id, voidReason: reason, updatedAt: now });
  await deps.audit({
    orgId: org.orgId,
    entity: "ledger_entry",
    entityId: entry._id,
    action: "rent_payment_undone",
    actorUserId: org.user._id,
    from: "received",
    to: "undone",
    note: `${unitLabelOf(entry.unitId ? await ctx.db.get(entry.unitId) : null, property)} · ${formatMonth(month)} rent · ${reason}`,
  });
  return null;
}

function unitLabelOf(unit: Doc<"units"> | null, property: Doc<"properties">): string {
  return unit ? unitAt(unit.unitNumber, property.name) : property.name;
}
