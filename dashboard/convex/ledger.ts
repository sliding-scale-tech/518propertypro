import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { OrgContext } from "./authz";
import { writeAudit } from "./audit";
import { fieldError, requireFinance } from "./financeAccess";
import { entrySourceLabel, statementLabel } from "./rosBuild";
import { displayName, effectivePayee } from "./rosCalc";
import { PROPERTY_LEVEL, businessToday, isMonth, monthEnd, monthStart, naturalCompare } from "./rosFormat";
import {
  ENTRY_MSG,
  KIND_LABELS,
  MAX_MEMO,
  MSG,
  cmpStr,
  entryChangeDateProblem,
  ledgerRowInMonth,
  lockedThroughMonth,
  validateEntryFields,
} from "./rosPolicy";

/**
 * The owner ledger: manual transactions (spec 5.3). Admin view + accountant only (requireFinance).
 *
 * Locking: a row with statementId is on a FINAL statement and never changes. Add refuses a date in a
 * month that is final for the property (entryDateProblem); edit applies that rule only when the date
 * is being changed, so an UNBILLED row dated in a locked month (it is carried forward onto the next
 * draft) can still have its other fields corrected, and it can always be voided.
 * At finalize every billed row gets `postedDate` (the date on the statement); `date` stays the
 * original. The list shows and filters by the posted date when there is one.
 *
 * Rent (2026-11-12): rows on the Rent Income system account can't be added or edited here ("Record
 * rent on the Payments page.", rosPolicy.validateEntryFields); rent is marked received on the
 * Payments page (rentPayments.ts, source "rent_payment"). Rent Income rows entered by hand before
 * that stay valid, go on statements as before and can still be deleted (voided) here.
 */

export const ENTRY_NOT_FOUND = "Transaction not found.";

type Ctx = QueryCtx | MutationCtx;

function readId<T extends "owners" | "properties" | "units" | "ledgerAccounts" | "ledgerEntries">(
  ctx: Ctx,
  table: T,
  raw: string | null | undefined,
): Id<T> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return ctx.db.normalizeId(table, raw.trim());
}

async function inOrg<T extends "owners" | "properties" | "units" | "ledgerAccounts" | "ledgerEntries">(
  ctx: Ctx,
  org: OrgContext,
  table: T,
  raw: string | null | undefined,
): Promise<Doc<T> | null> {
  const id = readId(ctx, table, raw);
  const doc = id ? await ctx.db.get(id) : null;
  return doc && (doc as { orgId?: string }).orgId === org.orgId ? (doc as Doc<T>) : null;
}

async function linksOf(ctx: Ctx, org: OrgContext, propertyId: Id<"properties">): Promise<Doc<"ownerProperties">[]> {
  return (
    await ctx.db
      .query("ownerProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect()
  ).filter((l) => l.orgId === org.orgId);
}

async function ownerNamesOf(ctx: Ctx, org: OrgContext, links: Doc<"ownerProperties">[]): Promise<string[]> {
  const names: string[] = [];
  for (const l of links) {
    const o = await ctx.db.get(l.ownerId);
    names.push(o && o.orgId === org.orgId ? o.legalName : "Unknown owner");
  }
  return names;
}

/** The latest final month for the property (any owner), or null. */
async function lockedThrough(ctx: Ctx, org: OrgContext, propertyId: Id<"properties">): Promise<string | null> {
  const finals = (
    await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", propertyId).eq("status", "final"))
      .collect()
  ).filter((r) => r.orgId === org.orgId);
  return lockedThroughMonth(finals.map((f) => f.month));
}

/** null = OK; else the no-owner / co-owned message (5.3 rule 2, 5.8 CO_OWNED). */
function ownershipProblem(propertyName: string, links: Doc<"ownerProperties">[], ownerNames: string[]): string | null {
  if (links.length === 0) return `Link ${propertyName} to its owner before recording transactions.`;
  if (links.length >= 2) return MSG.CO_OWNED(propertyName, ownerNames);
  return null;
}

async function unitLabel(ctx: Ctx, unitId: Id<"units"> | undefined): Promise<string | null> {
  if (!unitId) return null;
  const u = await ctx.db.get(unitId);
  return u ? u.unitNumber : null;
}

const entryArgs = {
  unitId: v.optional(v.union(v.string(), v.null())),
  date: v.optional(v.union(v.string(), v.null())),
  accountId: v.optional(v.union(v.string(), v.null())),
  counterparty: v.optional(v.union(v.string(), v.null())),
  memo: v.optional(v.union(v.string(), v.null())),
  amountCents: v.optional(v.union(v.number(), v.null())),
};

/**
 * Shared add/update checks, in spec order: field validation, property ownership, date lock.
 * Returns the cleaned fields plus what the row is written with.
 */
async function checkEntry(
  ctx: MutationCtx,
  org: OrgContext,
  raw: {
    propertyId: string | null | undefined;
    unitId: string | null | undefined;
    date: string | null | undefined;
    accountId: string | null | undefined;
    counterparty: string | null | undefined;
    memo: string | null | undefined;
    amountCents: number | null | undefined;
  },
  /** Edit: the row's current date. The date rule only runs when the date is being changed. */
  currentDate?: string,
) {
  const today = businessToday(Date.now());
  const property = await inOrg(ctx, org, "properties", raw.propertyId);
  const unit = await inOrg(ctx, org, "units", raw.unitId);
  const account = await inOrg(ctx, org, "ledgerAccounts", raw.accountId);
  const unitBlank = raw.unitId === undefined || raw.unitId === null || raw.unitId.trim() === "";
  const checked = validateEntryFields({
    propertyId: raw.propertyId,
    unitId: raw.unitId,
    date: raw.date,
    accountId: raw.accountId,
    counterparty: raw.counterparty,
    memo: raw.memo,
    amount: raw.amountCents,
    today,
    property,
    account,
    unitInProperty: !unitBlank && unit !== null && property !== null && unit.propertyId === property._id,
  });
  if (!checked.ok) throw fieldError(checked.field, checked.message);
  // validateEntryFields only passes when these resolved.
  const prop = property as Doc<"properties">;
  const acc = account as Doc<"ledgerAccounts">;

  const links = await linksOf(ctx, org, prop._id);
  const problem = ownershipProblem(prop.name, links, await ownerNamesOf(ctx, org, links));
  if (problem) throw fieldError("propertyId", problem);
  const link = links[0];

  const dateProblem = entryChangeDateProblem(checked.value.date, currentDate, today, {
    name: prop.name,
    lockedThrough: await lockedThrough(ctx, org, prop._id),
    startMonth: link.startMonth ?? null,
  });
  if (dateProblem) throw fieldError("date", dateProblem);

  return {
    value: checked.value,
    property: prop,
    account: acc,
    unit: checked.value.unitId === null ? null : (unit as Doc<"units">),
    link,
  };
}

/** The Rent Income system account: rent is recorded on the Payments page (convex/rentPayments.ts), not here. */
function isRentAccount(a: Doc<"ledgerAccounts"> | null): boolean {
  return a !== null && a.systemKey === "rent_income";
}

function loadForChange(entry: Doc<"ledgerEntries">): void {
  if (entry.statementId !== undefined) throw fieldError("entryId", ENTRY_MSG.billed);
  if (entry.source !== "manual") throw fieldError("entryId", ENTRY_MSG.notManual);
  if (entry.voided === true) throw fieldError("entryId", ENTRY_MSG.voided);
}

// --- queries -------------------------------------------------------------------------------------

export const formOptions = query({
  args: { propertyId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const props = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const allLinks = await ctx.db
      .query("ownerProperties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const owners = await ctx.db
      .query("owners")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const ownerById = new Map(owners.map((o) => [o._id as string, o]));

    const properties = props
      .map((p) => {
        const links = allLinks.filter((l) => l.propertyId === p._id);
        const names = links.map((l) => ownerById.get(l.ownerId)?.legalName ?? "Unknown owner");
        const single = links.length === 1 ? (ownerById.get(links[0].ownerId) ?? null) : null;
        return {
          propertyId: p._id,
          name: p.name,
          ownerLegalName: single ? single.legalName : null,
          /** The owner's effective payee, the form's default Name for owner draws/contributions. */
          ownerPayeeName: single ? effectivePayee(single) : null,
          blockedReason: ownershipProblem(p.name, links, names),
        };
      })
      .sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a.propertyId, b.propertyId));

    let units: { unitId: Id<"units">; label: string; tenants: string[] }[] = [];
    const property = await inOrg(ctx, org, "properties", args.propertyId);
    if (property) {
      const rows = (
        await ctx.db
          .query("units")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect()
      ).filter((u) => u.orgId === org.orgId);
      rows.sort((a, b) => naturalCompare(a.unitNumber, b.unitNumber) || cmpStr(a._id, b._id));
      units = [];
      for (const u of rows) {
        const residents = await ctx.db
          .query("residents")
          .withIndex("by_unit", (q) => q.eq("unitId", u._id))
          .collect();
        units.push({
          unitId: u._id,
          label: u.unitNumber,
          tenants: residents
            .filter((r) => r.orgId === org.orgId && r.active)
            .map((r) => r.fullName)
            .sort(naturalCompare),
        });
      }
    }

    const accounts = (
      await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect()
    )
      .filter((a) => a.active)
      .sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a._id, b._id))
      .map((a) => ({
        _id: a._id,
        name: a.name,
        kind: a.kind,
        kindLabel: KIND_LABELS[a.kind],
        ...(a.systemKey ? { systemKey: a.systemKey } : {}),
      }));

    return { properties, units, accounts };
  },
});

export const list = query({
  args: {
    ownerId: v.optional(v.union(v.string(), v.null())),
    propertyId: v.optional(v.union(v.string(), v.null())),
    month: v.optional(v.union(v.string(), v.null())),
    includeVoided: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const hasOwner = typeof args.ownerId === "string" && args.ownerId.trim() !== "";
    const hasProperty = typeof args.propertyId === "string" && args.propertyId.trim() !== "";
    const hasMonth = typeof args.month === "string" && args.month.trim() !== "";
    const owner = hasOwner ? await inOrg(ctx, org, "owners", args.ownerId) : null;
    if (hasOwner && !owner) throw fieldError("ownerId", "Owner not found.");
    const property = hasProperty ? await inOrg(ctx, org, "properties", args.propertyId) : null;
    if (hasProperty && !property) throw fieldError("propertyId", "Property not found.");
    const month = hasMonth ? (args.month as string).trim() : null;
    if (month !== null && !isMonth(month)) throw fieldError("month", "Select a month.");
    const from = month ? monthStart(month) : null;
    const to = month ? monthEnd(month) : null;

    const base = owner
      ? ctx.db.query("ledgerEntries").withIndex("by_owner_and_date", (q) => {
          const b = q.eq("ownerId", owner._id);
          return from && to ? b.gte("date", from).lte("date", to) : b;
        })
      : ctx.db.query("ledgerEntries").withIndex("by_org_and_date", (q) => {
          const b = q.eq("orgId", org.orgId);
          return from && to ? b.gte("date", from).lte("date", to) : b;
        });
    const page = await base
      .order("desc")
      .filter((q) => {
        const conds = [q.eq(q.field("orgId"), org.orgId)];
        if (property) conds.push(q.eq(q.field("propertyId"), property._id));
        if (args.includeVoided !== true) conds.push(q.neq(q.field("voided"), true));
        // A billed row is in the month it was POSTED in: a row dated here but carried onto a later
        // statement shows under that later month.
        if (from && to) {
          conds.push(
            q.or(
              q.eq(q.field("postedDate"), undefined),
              q.and(q.gte(q.field("postedDate"), from), q.lte(q.field("postedDate"), to)),
            ),
          );
        }
        return q.and(...conds);
      })
      .paginate({ numItems: 50, cursor: args.cursor ?? null });

    // Rows dated before the month but posted in it (carried forward onto this month's statement).
    // They post on the month's first day, so they come last: added to the final page.
    const carriedIn: Doc<"ledgerEntries">[] = [];
    if (from && to && page.isDone) {
      const posted = owner
        ? ctx.db
            .query("ledgerEntries")
            .withIndex("by_owner_and_posted", (q) => q.eq("ownerId", owner._id).gte("postedDate", from).lte("postedDate", to))
        : ctx.db
            .query("ledgerEntries")
            .withIndex("by_org_and_posted", (q) => q.eq("orgId", org.orgId).gte("postedDate", from).lte("postedDate", to));
      const rows = await posted.collect();
      for (const e of rows) {
        if (e.orgId !== org.orgId || e.date >= from || !ledgerRowInMonth(e, from, to)) continue;
        if (property && e.propertyId !== property._id) continue;
        if (args.includeVoided !== true && e.voided === true) continue;
        carriedIn.push(e);
      }
      carriedIn.sort((a, b) => cmpStr(b.date, a.date) || b._creationTime - a._creationTime);
    }

    const cache = new Map<string, unknown>();
    const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
      if (cache.has(key)) return cache.get(key) as T;
      const val = await load();
      cache.set(key, val);
      return val;
    };

    const rows = [];
    for (const e of [...page.page, ...carriedIn]) {
      const prop = await cached(`p:${e.propertyId}`, () => ctx.db.get(e.propertyId));
      const acc = await cached(`a:${e.accountId}`, () => ctx.db.get(e.accountId));
      const label = e.unitId ? await cached(`u:${e.unitId}`, () => unitLabel(ctx, e.unitId)) : null;
      const st = e.statementId ? await cached(`s:${e.statementId}`, () => ctx.db.get(e.statementId!)) : null;
      let sourceLabel = entrySourceLabel(e.source);
      if (e.source === "work_order" && e.sourceId) {
        const woId = ctx.db.normalizeId("workOrders", e.sourceId);
        const wo = woId ? await ctx.db.get(woId) : null;
        if (wo && wo.orgId === org.orgId) sourceLabel = `WO-${wo.number}`;
      }
      rows.push({
        _id: e._id,
        /** The original date (the edit form uses it). */
        date: e.date,
        /** Set on a billed row whose statement date differs from `date` (carried forward); else null. */
        postedDate: e.postedDate !== undefined && e.postedDate !== e.date ? e.postedDate : null,
        propertyId: e.propertyId,
        propertyName: prop?.name ?? "",
        unitId: e.unitId ?? null,
        unit: label ?? PROPERTY_LEVEL,
        accountId: e.accountId,
        accountName: acc?.name ?? "",
        type: e.type,
        name: displayName(label, e.counterparty),
        counterparty: e.counterparty,
        memo: e.memo,
        amountCents: e.amountCents,
        source: e.source,
        sourceLabel,
        statementId: e.statementId ?? null,
        statementLabel: st ? statementLabel(st.month) : null,
        voided: e.voided === true,
        voidReason: e.voidReason ?? null,
        /** Unbilled manual row: Delete (void) allowed; Edit too unless it is on Rent Income. */
        editable: e.statementId === undefined && e.source === "manual" && e.voided !== true,
        /** On the Rent Income account: rent is recorded and changed on the Payments page. */
        onRentAccount: isRentAccount(acc),
        /** A rent payment from the Payments page: the month the rent is for. */
        rentForMonth: e.source === "rent_payment" ? (e.rentForMonth ?? null) : null,
      });
    }
    return { page: rows, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const history = query({
  args: { entryId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const entry = await inOrg(ctx, org, "ledgerEntries", args.entryId);
    if (!entry) throw fieldError("entryId", ENTRY_NOT_FOUND);
    const rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", "ledger_entry").eq("entityId", entry._id))
      .order("desc")
      .take(100);
    return rows
      .filter((r) => r.orgId === org.orgId)
      .map((r) => ({
        _id: r._id,
        action: r.action,
        actorLabel: r.actorLabel,
        from: r.from ?? null,
        to: r.to ?? null,
        note: r.note ?? null,
        at: r.at,
      }));
  },
});

// --- mutations -----------------------------------------------------------------------------------

export const add = mutation({
  args: { propertyId: v.optional(v.union(v.string(), v.null())), ...entryArgs },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const c = await checkEntry(ctx, org, {
      propertyId: args.propertyId,
      unitId: args.unitId,
      date: args.date,
      accountId: args.accountId,
      counterparty: args.counterparty,
      memo: args.memo,
      amountCents: args.amountCents,
    });
    const now = Date.now();
    const entryId = await ctx.db.insert("ledgerEntries", {
      orgId: org.orgId,
      ownerId: c.link.ownerId,
      propertyId: c.property._id,
      ...(c.unit ? { unitId: c.unit._id } : {}),
      date: c.value.date,
      type: c.account.kind,
      accountId: c.account._id,
      counterparty: c.value.counterparty,
      memo: c.value.memo,
      amountCents: c.value.amountCents,
      source: "manual",
      createdBy: org.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_entry",
      entityId: entryId,
      action: "entry_created",
      actorUserId: org.user._id,
      to: JSON.stringify({
        date: c.value.date,
        property: c.property.name,
        unit: c.unit ? c.unit.unitNumber : PROPERTY_LEVEL,
        account: c.account.name,
        counterparty: c.value.counterparty,
        memo: c.value.memo,
        amountCents: c.value.amountCents,
      }),
    });
    return { entryId };
  },
});

export const update = mutation({
  args: { entryId: v.optional(v.union(v.string(), v.null())), propertyId: v.optional(v.union(v.string(), v.null())), ...entryArgs },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const entry = await inOrg(ctx, org, "ledgerEntries", args.entryId);
    if (!entry) throw fieldError("entryId", ENTRY_NOT_FOUND);
    loadForChange(entry);
    if (typeof args.propertyId === "string" && args.propertyId.trim() !== "" && args.propertyId.trim() !== entry.propertyId) {
      throw fieldError("propertyId", ENTRY_MSG.propertyChange);
    }

    // Fields left undefined keep their value; unitId null / "" means Property level.
    const c = await checkEntry(
      ctx,
      org,
      {
        propertyId: entry.propertyId,
        unitId: args.unitId === undefined ? (entry.unitId ?? null) : args.unitId,
        date: args.date === undefined ? entry.date : args.date,
        accountId: args.accountId === undefined ? entry.accountId : args.accountId,
        counterparty: args.counterparty === undefined ? entry.counterparty : args.counterparty,
        memo: args.memo === undefined ? entry.memo : args.memo,
        amountCents: args.amountCents === undefined ? entry.amountCents : args.amountCents,
      },
      entry.date,
    );
    if (c.link.ownerId !== entry.ownerId) {
      // Unlinking is refused while the owner has unbilled rows, so this only happens if the data
      // was changed outside the app; refuse rather than move money between owners.
      throw fieldError("propertyId", `Link ${c.property.name} to its owner before recording transactions.`);
    }

    const next = {
      unitId: c.unit ? c.unit._id : undefined,
      date: c.value.date,
      type: c.account.kind,
      accountId: c.account._id,
      counterparty: c.value.counterparty,
      memo: c.value.memo,
      amountCents: c.value.amountCents,
    };
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    if (next.unitId !== entry.unitId) {
      from.unit = (await unitLabel(ctx, entry.unitId)) ?? PROPERTY_LEVEL;
      to.unit = c.unit ? c.unit.unitNumber : PROPERTY_LEVEL;
    }
    if (next.date !== entry.date) {
      from.date = entry.date;
      to.date = next.date;
    }
    if (next.accountId !== entry.accountId) {
      const old = await ctx.db.get(entry.accountId);
      from.account = old?.name ?? "";
      to.account = c.account.name;
    }
    if (next.counterparty !== entry.counterparty) {
      from.counterparty = entry.counterparty;
      to.counterparty = next.counterparty;
    }
    if (next.memo !== entry.memo) {
      from.memo = entry.memo;
      to.memo = next.memo;
    }
    if (next.amountCents !== entry.amountCents) {
      from.amountCents = entry.amountCents;
      to.amountCents = next.amountCents;
    }
    if (Object.keys(to).length === 0) return null;

    await ctx.db.patch(entry._id, { ...next, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_entry",
      entityId: entry._id,
      action: "entry_updated",
      actorUserId: org.user._id,
      from: JSON.stringify(from),
      to: JSON.stringify(to),
    });
    return null;
  },
});

export const voidEntry = mutation({
  args: { entryId: v.optional(v.union(v.string(), v.null())), reason: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const entry = await inOrg(ctx, org, "ledgerEntries", args.entryId);
    if (!entry) throw fieldError("entryId", ENTRY_NOT_FOUND);
    loadForChange(entry);
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason === "") throw fieldError("reason", ENTRY_MSG.voidReasonMissing);
    if (reason.length > MAX_MEMO) throw fieldError("reason", ENTRY_MSG.voidReasonLong);

    // Any UNBILLED manual row can be voided, whatever its date: one dated in a month that is
    // already final was never on that statement (it carries forward), so voiding it changes no
    // final statement.

    const now = Date.now();
    await ctx.db.patch(entry._id, {
      voided: true,
      voidedAt: now,
      voidedBy: org.user._id,
      voidReason: reason,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ledger_entry",
      entityId: entry._id,
      action: "entry_voided",
      actorUserId: org.user._id,
      from: "active",
      to: "voided",
      note: reason,
    });
    return null;
  },
});
