import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { OrgContext } from "./authz";
import { writeAudit } from "./audit";
import { fieldError, requireFinance } from "./financeAccess";
import { ensureSeeded } from "./ledgerAccounts";
import {
  buildStatement,
  finalizePlan,
  linesFromSnapshot,
  makeSnapshot,
  rentKey,
  resultHash,
  snapshotTooLarge,
  splitWarnings,
  toggledKeys,
  type BuildOverride,
  type LineView,
  type RentSkip,
} from "./rosBuild";
import type { StatementSnapshot } from "./rosCalc";
import {
  COMPANY_NAME,
  MAX_AMOUNT_CENTS,
  businessToday,
  formatAmount,
  formatCurrency,
  formatDate,
  formatMonth,
  isMonth,
  monthEnd,
  monthOf,
  monthStart,
  naturalCompare,
} from "./rosFormat";
import {
  MAX_MEMO,
  MSG,
  RENT_MSG,
  cmpStr,
  createDraftProblem,
  finalizeProblem,
  sortProperties,
  validateRentLineFields,
  type PropertyStatementState,
} from "./rosPolicy";
import { buildView } from "./rosView";

/**
 * Rental Owner Statements (spec 5.4). Admin view + accountant only (requireFinance).
 *
 * Invariants (spec 5.5):
 * - one active (draft or final) statement per property per month: createDraft checks the
 *   ownerStatementProperties rows; Convex mutations are serializable, so two creates can't both pass;
 * - at most one open draft per property, so an unbilled row or WO can only be in one draft;
 * - a WO is billed once: selectWorkOrders skips billed WOs, and finalize re-checks billedStatementId
 *   and the by_source index inside the same mutation;
 * - fee/draw rows use sourceId `${statementId}:${propertyId}` and finalize refuses if one exists;
 * - a final statement is immutable: every draft mutation checks status, `get` serves the snapshot;
 * - finalize runs in ONE mutation, so either everything is written or nothing is.
 *
 * DELIVERY HOOK (Q8): v1 only downloads the PDF (pdfData + recordDownload). Email delivery later is a
 * "use node" action `emailStatement` that renders the same StatementPdf with renderToBuffer, sends via
 * resendApi.ts to owner.emails, sets emailedAt / emailedTo and audits `emailed` (spec 5.7).
 */

export const STATEMENT_NOT_FOUND = "Statement not found.";


const M = {
  ownerMissing: "Select the owner this statement is for.",
  ownerNotFound: "Owner not found.",
  monthMissing: "Select the statement month.",
  monthFuture: "You can't create a statement for a month that hasn't started.",
  propertiesMissing: "Tick at least one property for this statement.",
  propertyNotFound: "Property not found.",
  isFinal: "This statement is final and can't be changed.",
  isDiscarded: "This statement was discarded.",
  alreadyFinal: "This statement is already final.",
  lineNotOnStatement: "That line isn't on this statement.",
  propertyNotOnStatement: "That property isn't on this statement.",
  earlyNegative: "Early payments can't be negative.",
  unpaidNegative: "Unpaid bills can't be negative.",
  reserveNegative: "The property reserve can't be negative.",
  moneyInvalid: "Enter the amount like 500.00.",
  moneyTooBig: "The amount can't be more than $1,000,000.00.",
  generatedAmount: "Enter the amount like 657.32.",
  memoLong: "Keep the memo under 300 characters.",
  kindMissing: "Choose the management fee or the owner draw.",
  stale: "The statement changed while you were reviewing it. Check the new totals and finalize again.",
  entryChanged: "A transaction on this statement changed while you were reviewing it. Refresh and try again.",
  finalizedAlready: "This statement was already finalized.",
  tooLarge: "This statement is too large to save. Split it into fewer properties.",
  finalNoDiscard: "A final statement can't be discarded. Put corrections on next month's statement.",
  reasonLong: "Keep the reason under 300 characters.",
  ownerOff: (name: string): string => `${name} is turned off. Turn the owner on before generating a statement.`,
  woBilled: (n: number): string => `WO-${n} was already billed on another statement. Refresh and check this statement.`,
} as const;

type Ctx = QueryCtx | MutationCtx;

function readId<T extends "owners" | "properties" | "ownerStatements">(
  ctx: Ctx,
  table: T,
  raw: string | null | undefined,
): Id<T> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return ctx.db.normalizeId(table, raw.trim());
}

async function loadStatement(ctx: Ctx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"ownerStatements">> {
  const id = readId(ctx, "ownerStatements", raw);
  const st = id ? await ctx.db.get(id) : null;
  if (!st || st.orgId !== org.orgId) throw fieldError("statementId", STATEMENT_NOT_FOUND);
  return st;
}

/** Draft edits: "Statement not found." / must still be a draft. */
async function loadDraft(ctx: MutationCtx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"ownerStatements">> {
  const st = await loadStatement(ctx, org, raw);
  if (st.status === "final") throw fieldError("statementId", M.isFinal);
  if (st.status === "discarded") throw fieldError("statementId", M.isDiscarded);
  return st;
}

async function statementRows(ctx: Ctx, statementId: Id<"ownerStatements">): Promise<Doc<"ownerStatementProperties">[]> {
  return await ctx.db
    .query("ownerStatementProperties")
    .withIndex("by_statement", (q) => q.eq("statementId", statementId))
    .collect();
}

async function loadSnapshot(ctx: Ctx, st: Doc<"ownerStatements">): Promise<StatementSnapshot> {
  const row = await ctx.db
    .query("ownerStatementSnapshots")
    .withIndex("by_statement", (q) => q.eq("statementId", st._id))
    .first();
  if (!row || row.orgId !== st.orgId) throw new ConvexError("This final statement has no saved copy. Contact support.");
  return JSON.parse(row.json) as StatementSnapshot;
}

function userName(u: Doc<"users"> | null): string | null {
  if (!u) return null;
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || u.email || null;
}

/** The note for line_excluded / line_included: `${sourceLabel} ${date} ${account} ${amount}`. */
function lineNote(l: LineView): string {
  return `${l.sourceLabel} ${formatDate(l.date)} ${l.accountName} ${formatAmount(l.amountCents)}`;
}

/**
 * Money from a draft form: integer cents 0..MAX, else a field error. `negativeMessage` is the
 * spec's exact text for a negative value.
 */
function checkMoney(field: string, n: number, negativeMessage: string): number {
  if (!Number.isSafeInteger(n)) throw fieldError(field, M.moneyInvalid);
  if (n < 0) throw fieldError(field, negativeMessage);
  if (n > MAX_AMOUNT_CENTS) throw fieldError(field, M.moneyTooBig);
  return n;
}

/** PropertyStatementState for createDraftProblem / generateOptions (spec 4.4). */
async function propertyState(
  ctx: Ctx,
  org: OrgContext,
  ownerId: Id<"owners">,
  property: Doc<"properties">,
  ownerName: (id: Id<"owners">) => Promise<string>,
): Promise<PropertyStatementState> {
  const links = (
    await ctx.db
      .query("ownerProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect()
  ).filter((l) => l.orgId === org.orgId);
  const coOwnerNames: string[] = [];
  for (const l of links) coOwnerNames.push(await ownerName(l.ownerId));
  const mine = links.find((l) => l.ownerId === ownerId);
  const rows = async (status: "draft" | "final") =>
    (
      await ctx.db
        .query("ownerStatementProperties")
        .withIndex("by_property_and_status", (q) => q.eq("propertyId", property._id).eq("status", status))
        .collect()
    ).filter((r) => r.orgId === org.orgId);
  const finals = [];
  for (const r of await rows("final")) finals.push({ month: r.month, ownerName: await ownerName(r.ownerId) });
  const openDrafts = [];
  for (const r of await rows("draft")) openDrafts.push({ month: r.month, ownerName: await ownerName(r.ownerId) });
  return {
    id: property._id,
    name: property.name,
    ownerLinkCount: links.length,
    linkedToThisOwner: mine !== undefined,
    coOwnerNames,
    startMonth: mine?.startMonth ?? null,
    finals,
    openDrafts,
  };
}

function ownerNameCache(ctx: Ctx, org: OrgContext): (id: Id<"owners">) => Promise<string> {
  const names = new Map<string, string>();
  return async (id) => {
    const hit = names.get(id);
    if (hit !== undefined) return hit;
    const o = await ctx.db.get(id);
    const n = o && o.orgId === org.orgId ? o.legalName : "Unknown owner";
    names.set(id, n);
    return n;
  };
}

type RentOverride = NonNullable<Doc<"ownerStatements">["rentOverrides"]>[number];

/**
 * Any change to a rent line voids the "I've checked the rent lines" confirmation. (The fingerprint
 * check in rosBuild also catches changes made elsewhere, e.g. a roster edit.) No-op when not set.
 */
async function clearRentCheck(ctx: MutationCtx, org: OrgContext, st: Doc<"ownerStatements">, note: string): Promise<void> {
  if (st.rentCheckedAt === undefined && st.rentCheckedHash === undefined && st.rentCheckedBy === undefined) return;
  await ctx.db.patch(st._id, { rentCheckedAt: undefined, rentCheckedBy: undefined, rentCheckedHash: undefined, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "ros",
    entityId: st._id,
    action: "rent_check_cleared",
    actorUserId: org.user._id,
    from: "checked",
    to: "unchecked",
    note,
  });
}

/**
 * ledger.ts: a Rent Income row of this property was added, edited or voided, so the open draft
 * holding the property needs its rent lines checked again.
 */
export async function clearRentCheckForProperty(
  ctx: MutationCtx,
  org: OrgContext,
  propertyId: Id<"properties">,
  note: string,
): Promise<void> {
  const rows = (
    await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", propertyId).eq("status", "draft"))
      .collect()
  ).filter((r) => r.orgId === org.orgId);
  for (const r of rows) {
    const st = await ctx.db.get(r.statementId);
    if (st && st.orgId === org.orgId && st.status === "draft") await clearRentCheck(ctx, org, st, note);
  }
}

// --- queries -------------------------------------------------------------------------------------

export const list = query({
  args: { month: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const month = typeof args.month === "string" ? args.month.trim() : "";
    if (!isMonth(month)) throw fieldError("month", M.monthMissing);

    const owners = await ctx.db
      .query("owners")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const links = await ctx.db
      .query("ownerProperties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const statements = (
      await ctx.db
        .query("ownerStatements")
        .withIndex("by_org_and_month", (q) => q.eq("orgId", org.orgId).eq("month", month))
        .collect()
    ).filter((s) => s.status !== "discarded");

    const linkCount = new Map<string, number>();
    for (const l of links) linkCount.set(l.propertyId, (linkCount.get(l.propertyId) ?? 0) + 1);
    const propNames = new Map<string, string>();
    const propName = async (id: Id<"properties">): Promise<string> => {
      const hit = propNames.get(id);
      if (hit !== undefined) return hit;
      const p = await ctx.db.get(id);
      const n = p && p.orgId === org.orgId ? p.name : "Deleted property";
      propNames.set(id, n);
      return n;
    };

    const out = [];
    for (const o of owners) {
      const mine = links.filter((l) => l.ownerId === o._id);
      const sts = statements.filter((s) => s.ownerId === o._id);
      if (!((o.active && mine.length > 0) || sts.length > 0)) continue;
      const rows = [];
      for (const s of sts.sort((a, b) => a.createdAt - b.createdAt)) {
        const propertyNames: string[] = [];
        for (const pid of s.propertyIds) propertyNames.push(await propName(pid));
        rows.push({
          statementId: s._id,
          status: s.status,
          propertyNames,
          ...(s.endingCashCents !== undefined ? { endingCashCents: s.endingCashCents } : {}),
          ...(s.availableCents !== undefined ? { availableCents: s.availableCents } : {}),
          updatedAt: s.updatedAt,
        });
      }
      out.push({
        ownerId: o._id,
        legalName: o.legalName,
        active: o.active,
        // Linked properties that are not co-owned (a co-owned one can't go on a statement).
        eligiblePropertyCount: mine.filter((l) => (linkCount.get(l.propertyId) ?? 0) === 1).length,
        statements: rows,
      });
    }
    out.sort((a, b) => naturalCompare(a.legalName, b.legalName) || cmpStr(a.ownerId, b.ownerId));
    return { month, owners: out };
  },
});

export const generateOptions = query({
  args: { ownerId: v.optional(v.union(v.string(), v.null())), month: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    if (typeof args.ownerId !== "string" || args.ownerId.trim() === "") throw fieldError("ownerId", M.ownerMissing);
    const oid = readId(ctx, "owners", args.ownerId);
    const owner = oid ? await ctx.db.get(oid) : null;
    if (!owner || owner.orgId !== org.orgId) throw fieldError("ownerId", M.ownerNotFound);
    const month = typeof args.month === "string" ? args.month.trim() : "";
    if (!isMonth(month)) throw fieldError("month", M.monthMissing);

    const today = businessToday(Date.now());
    const ownerName = ownerNameCache(ctx, org);
    const myLinks = (
      await ctx.db
        .query("ownerProperties")
        .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
        .collect()
    ).filter((l) => l.orgId === org.orgId);
    const props: { id: string; name: string; reason: string | null }[] = [];
    for (const l of myLinks) {
      const p = await ctx.db.get(l.propertyId);
      if (!p || p.orgId !== org.orgId) continue;
      const state = await propertyState(ctx, org, owner._id, p, ownerName);
      props.push({ id: p._id, name: p.name, reason: createDraftProblem(month, today, state, owner.legalName) });
    }
    return {
      owner: { legalName: owner.legalName },
      properties: sortProperties(props).map((p) => ({
        propertyId: p.id as Id<"properties">,
        name: p.name,
        selectable: p.reason === null,
        reason: p.reason,
        defaultTicked: p.reason === null,
      })),
    };
  },
});

export const get = query({
  args: { statementId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadStatement(ctx, org, args.statementId);
    const owner = await ctx.db.get(st.ownerId);
    if (!owner || owner.orgId !== org.orgId) throw new ConvexError("Owner not found.");
    const finalizedBy = st.finalizedBy ? await ctx.db.get(st.finalizedBy) : null;
    const rentCheckedBy = st.rentCheckedBy ? await ctx.db.get(st.rentCheckedBy) : null;
    const statement = {
      _id: st._id,
      status: st.status,
      month: st.month,
      monthLabel: formatMonth(st.month),
      periodStart: st.periodStart,
      periodEnd: st.periodEnd,
      statementDate: st.status === "final" ? (st.statementDate ?? null) : null,
      createdAt: st.createdAt,
      updatedAt: st.updatedAt,
      ...(st.finalizedAt !== undefined ? { finalizedAt: st.finalizedAt } : {}),
      ...(finalizedBy ? { finalizedByName: userName(finalizedBy) ?? "Unknown" } : {}),
    };

    if (st.status === "final") {
      const snapshot = await loadSnapshot(ctx, st);
      const billed = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_statement", (q) => q.eq("statementId", st._id))
        .collect();
      const woNumbers: Record<string, number> = {};
      for (const r of billed) {
        if (r.source !== "work_order" || !r.sourceId) continue;
        const woId = ctx.db.normalizeId("workOrders", r.sourceId);
        const wo = woId ? await ctx.db.get(woId) : null;
        if (wo && wo.orgId === org.orgId) woNumbers[r.sourceId] = wo.number;
      }
      const result = snapshot.result;
      const finalLines = linesFromSnapshot(snapshot, billed, woNumbers);
      const links = await Promise.all(
        result.columns.map(async (c) => {
          const pid = ctx.db.normalizeId("properties", c.propertyId);
          if (!pid) return null;
          const ls = await ctx.db
            .query("ownerProperties")
            .withIndex("by_property", (q) => q.eq("propertyId", pid))
            .collect();
          return ls.find((l) => l.ownerId === st.ownerId && l.orgId === org.orgId) ?? null;
        }),
      );
      const properties = result.columns.map((c, i) => {
        const early = st.adjustments.find((a) => a.propertyId === c.propertyId)?.earlyPaymentsCents ?? 0;
        return {
          propertyId: c.propertyId,
          name: c.name,
          securityDepositsCents: result.summary.depositsAndEarlyPayments.byProperty[i] - early,
          earlyPaymentsCents: early,
          unpaidBillsCents: result.summary.unpaidBills.byProperty[i],
          propertyReserveCents: result.summary.propertyReserve.byProperty[i],
          propertyReserveDefaultCents: links[i]?.propertyReserveCents ?? 0,
          // A final shows the % frozen in its snapshot (fee.bps), whatever the fee is today.
          feeSource: null,
          fee: result.generated[i].fee,
          draw: result.generated[i].draw,
        };
      });
      return {
        statement,
        owner: {
          _id: owner._id,
          legalName: snapshot.header.ownerLegalName,
          payeeName: snapshot.header.payeeName,
        },
        view: buildView(result, { statementDate: snapshot.header.statementDate }),
        result,
        lines: finalLines,
        excludedLines: [] as LineView[],
        properties,
        rent: {
          lineCount: finalLines.filter((l) => l.kind === "rent").length,
          hash: null as string | null,
          checked: st.rentCheckedAt !== undefined,
          checkedAt: st.rentCheckedAt ?? null,
          checkedByName: rentCheckedBy ? (userName(rentCheckedBy) ?? "Unknown") : null,
          skipped: [] as RentSkip[],
        },
        warnings: splitWarnings(result.warnings.filter((w) => !w.blocking)),
        canFinalize: false,
        previewHash: resultHash(result),
      };
    }

    const today = businessToday(Date.now());
    const built = await buildStatement(ctx, st, { statementDate: today });
    const warnings = splitWarnings(built.warnings);
    return {
      statement,
      owner: {
        _id: owner._id,
        legalName: owner.legalName,
        payeeName: built.payeeName,
      },
      view: buildView(built.result, { statementDate: today }),
      result: built.result,
      lines: built.lines,
      excludedLines: built.excludedLines,
      properties: built.properties,
      rent: {
        lineCount: built.rent.lineCount,
        hash: built.rent.hash,
        checked: built.rent.checked,
        checkedAt: built.rent.checked ? (st.rentCheckedAt ?? null) : null,
        checkedByName: built.rent.checked && rentCheckedBy ? (userName(rentCheckedBy) ?? "Unknown") : null,
        skipped: built.rent.skipped,
      },
      warnings,
      // Also false while the month is still open (finalize would refuse with PERIOD_OPEN).
      canFinalize:
        st.status === "draft" && warnings.blocking.length === 0 && finalizeProblem(st.month, today) === null,
      previewHash: resultHash(built.result),
    };
  },
});

export const history = query({
  args: { statementId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadStatement(ctx, org, args.statementId);
    const rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", "ros").eq("entityId", st._id))
      .order("desc")
      .take(200);
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

/** The PDF's data. Final: the stored snapshot. Draft: built live, dated today (DRAFT watermark). */
export const pdfData = query({
  args: { statementId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ draft: boolean; snapshot: StatementSnapshot }> => {
    const org = await requireFinance(ctx);
    const st = await loadStatement(ctx, org, args.statementId);
    if (st.status === "discarded") throw fieldError("statementId", M.isDiscarded);
    if (st.status === "final") return { draft: false, snapshot: await loadSnapshot(ctx, st) };
    const today = businessToday(Date.now());
    const built = await buildStatement(ctx, st, { statementDate: today });
    return { draft: true, snapshot: makeSnapshot(built.owner, built.result, today) };
  },
});

// --- mutations -----------------------------------------------------------------------------------

export const createDraft = mutation({
  args: {
    ownerId: v.optional(v.union(v.string(), v.null())),
    month: v.optional(v.union(v.string(), v.null())),
    propertyIds: v.optional(v.union(v.array(v.string()), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    // 2. fields
    if (typeof args.ownerId !== "string" || args.ownerId.trim() === "") throw fieldError("ownerId", M.ownerMissing);
    const oid = readId(ctx, "owners", args.ownerId);
    const owner = oid ? await ctx.db.get(oid) : null;
    if (!owner || owner.orgId !== org.orgId) throw fieldError("ownerId", M.ownerNotFound);
    if (!owner.active) throw fieldError("ownerId", M.ownerOff(owner.legalName));

    const month = typeof args.month === "string" ? args.month.trim() : "";
    if (!isMonth(month)) throw fieldError("month", M.monthMissing);
    const today = businessToday(Date.now());
    if (month > monthOf(today)) throw fieldError("month", M.monthFuture);

    const rawIds = (args.propertyIds ?? []).map((s) => s.trim()).filter((s) => s !== "");
    if (rawIds.length === 0) throw fieldError("propertyIds", M.propertiesMissing);
    const properties: Doc<"properties">[] = [];
    const seen = new Set<string>();
    for (const raw of rawIds) {
      const pid = readId(ctx, "properties", raw);
      const p = pid ? await ctx.db.get(pid) : null;
      if (!p || p.orgId !== org.orgId) throw fieldError("propertyIds", M.propertyNotFound);
      if (seen.has(p._id)) continue;
      seen.add(p._id);
      properties.push(p);
    }

    // 3. per-property rules (createDraftProblem), first problem wins
    const ownerName = ownerNameCache(ctx, org);
    const sorted = sortProperties(properties.map((p) => ({ id: p._id as string, name: p.name, doc: p })));
    for (const p of sorted) {
      const problem = createDraftProblem(month, today, await propertyState(ctx, org, owner._id, p.doc, ownerName), owner.legalName);
      if (problem) throw fieldError("propertyIds", problem);
    }

    // 4. accounts
    await ensureSeeded(ctx, org);

    // 5-6. the statement and its per-property rows
    const now = Date.now();
    const propertyIds = sorted.map((p) => p.doc._id);
    const statementId = await ctx.db.insert("ownerStatements", {
      orgId: org.orgId,
      ownerId: owner._id,
      month,
      periodStart: monthStart(month),
      periodEnd: monthEnd(month),
      propertyIds,
      status: "draft",
      excludedKeys: [],
      adjustments: propertyIds.map((propertyId) => ({ propertyId, earlyPaymentsCents: 0, unpaidBillsCents: 0 })),
      overrides: [],
      createdBy: org.user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (const propertyId of propertyIds) {
      await ctx.db.insert("ownerStatementProperties", {
        orgId: org.orgId,
        statementId,
        ownerId: owner._id,
        propertyId,
        month,
        status: "draft",
      });
    }

    // 7. audit
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: statementId,
      action: "draft_created",
      actorUserId: org.user._id,
      to: JSON.stringify({ owner: owner.legalName, month, properties: sorted.map((p) => p.name) }),
    });
    return { statementId };
  },
});

async function toggleLine(
  ctx: MutationCtx,
  org: OrgContext,
  args: { statementId?: string | null; key?: string | null },
  exclude: boolean,
): Promise<null> {
  const st = await loadDraft(ctx, org, args.statementId);
  const key = typeof args.key === "string" ? args.key.trim() : "";
  if (!/^(entry|wo|rent):/.test(key)) throw fieldError("key", M.lineNotOnStatement);
  const built = await buildStatement(ctx, st, { statementDate: businessToday(Date.now()) });
  const line = (exclude ? built.lines : built.excludedLines).find((l) => l.key === key);
  if (!line) {
    // A retry of a change that already happened is a no-op, not an error.
    const other = (exclude ? built.excludedLines : built.lines).some((l) => l.key === key);
    if (other) return null;
    throw fieldError("key", M.lineNotOnStatement);
  }
  const keys = toggledKeys(st, key, exclude, line.defaultExcluded === true);
  await ctx.db.patch(st._id, { ...keys, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "ros",
    entityId: st._id,
    action: exclude ? "line_excluded" : "line_included",
    actorUserId: org.user._id,
    from: exclude ? "included" : "excluded",
    to: exclude ? "excluded" : "included",
    note: lineNote(line),
  });
  // Removing / putting back a rent line (roster or a Rent Income row) needs the rent checked again.
  const rentAccountId = built.input.accounts.find((a) => a.systemKey === "rent_income")?.id;
  if (line.kind === "rent" || (rentAccountId !== undefined && line.accountId === rentAccountId)) {
    await clearRentCheck(ctx, org, st, `${exclude ? "Removed" : "Put back"}: ${lineNote(line)}`);
  }
  return null;
}

const lineArgs = { statementId: v.optional(v.union(v.string(), v.null())), key: v.optional(v.union(v.string(), v.null())) };

export const excludeLine = mutation({
  args: lineArgs,
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await toggleLine(ctx, org, args, true);
  },
});

export const includeLine = mutation({
  args: lineArgs,
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    return await toggleLine(ctx, org, args, false);
  },
});

export const setAdjustments = mutation({
  args: {
    statementId: v.optional(v.union(v.string(), v.null())),
    propertyId: v.optional(v.union(v.string(), v.null())),
    /** null = 0. */
    earlyPaymentsCents: v.optional(v.union(v.number(), v.null())),
    /** null = 0. */
    unpaidBillsCents: v.optional(v.union(v.number(), v.null())),
    /** null = back to the owner-link default. */
    propertyReserveCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadDraft(ctx, org, args.statementId);
    const pid = typeof args.propertyId === "string" ? args.propertyId.trim() : "";
    const idx = st.adjustments.findIndex((a) => a.propertyId === pid);
    if (pid === "" || !st.propertyIds.some((p) => p === pid)) throw fieldError("propertyId", M.propertyNotOnStatement);
    type Adjustment = Doc<"ownerStatements">["adjustments"][number];
    const prev: Adjustment =
      idx >= 0 ? st.adjustments[idx] : { propertyId: pid as Id<"properties">, earlyPaymentsCents: 0, unpaidBillsCents: 0 };
    const next: Adjustment = { ...prev };
    // undefined = unchanged; null = back to the default (0 for these two, the owner default for the reserve).
    if (args.earlyPaymentsCents !== undefined) {
      next.earlyPaymentsCents =
        args.earlyPaymentsCents === null ? 0 : checkMoney("earlyPaymentsCents", args.earlyPaymentsCents, M.earlyNegative);
    }
    if (args.unpaidBillsCents !== undefined) {
      next.unpaidBillsCents =
        args.unpaidBillsCents === null ? 0 : checkMoney("unpaidBillsCents", args.unpaidBillsCents, M.unpaidNegative);
    }
    if (args.propertyReserveCents === null) {
      delete next.propertyReserveCents;
    } else if (args.propertyReserveCents !== undefined) {
      next.propertyReserveCents = checkMoney("propertyReserveCents", args.propertyReserveCents, M.reserveNegative);
    }
    const before = JSON.stringify(prev);
    const after = JSON.stringify(next);
    if (before === after) return null;
    const adjustments = idx >= 0 ? st.adjustments.map((a, i) => (i === idx ? next : a)) : [...st.adjustments, next];
    await ctx.db.patch(st._id, { adjustments, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "adjustments_changed",
      actorUserId: org.user._id,
      from: before,
      to: after,
    });
    return null;
  },
});

export const setGenerated = mutation({
  args: {
    statementId: v.optional(v.union(v.string(), v.null())),
    propertyId: v.optional(v.union(v.string(), v.null())),
    kind: v.optional(v.union(v.string(), v.null())),
    /** null = back to computed / suggested. */
    amountCents: v.optional(v.union(v.number(), v.null())),
    /** Fee only. null or "" = the standard memo. */
    memo: v.optional(v.union(v.string(), v.null())),
    excluded: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadDraft(ctx, org, args.statementId);
    const pid = typeof args.propertyId === "string" ? args.propertyId.trim() : "";
    if (pid === "" || !st.propertyIds.some((p) => p === pid)) throw fieldError("propertyId", M.propertyNotOnStatement);
    const kind = args.kind;
    if (kind !== "fee" && kind !== "draw") throw fieldError("kind", M.kindMissing);

    const idx = st.overrides.findIndex((o) => o.propertyId === pid);
    const prev: BuildOverride = idx >= 0 ? st.overrides[idx] : { propertyId: pid };
    const next: BuildOverride = { ...prev };
    const amountKey = kind === "fee" ? "feeAmountCents" : "drawAmountCents";
    const excludedKey = kind === "fee" ? "feeExcluded" : "drawExcluded";

    if (args.amountCents === null) {
      delete next[amountKey];
    } else if (args.amountCents !== undefined) {
      const n = args.amountCents;
      if (!Number.isSafeInteger(n) || n < 0) throw fieldError("amountCents", M.generatedAmount);
      if (n > MAX_AMOUNT_CENTS) throw fieldError("amountCents", M.moneyTooBig);
      next[amountKey] = n;
    }
    if (kind === "fee" && args.memo !== undefined) {
      const memo = typeof args.memo === "string" ? args.memo.trim() : "";
      if (memo.length > MAX_MEMO) throw fieldError("memo", M.memoLong);
      if (memo === "") delete next.feeMemo;
      else next.feeMemo = memo;
    }
    if (args.excluded !== undefined && args.excluded !== null) {
      if (args.excluded) next[excludedKey] = true;
      else delete next[excludedKey];
    }

    const before = JSON.stringify(prev);
    const after = JSON.stringify(next);
    if (before === after) return null;
    const cleaned = { ...next, propertyId: pid as Id<"properties"> };
    const overrides = idx >= 0 ? st.overrides.map((o, i) => (i === idx ? cleaned : o)) : [...st.overrides, cleaned];
    await ctx.db.patch(st._id, { overrides, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "generated_changed",
      actorUserId: org.user._id,
      from: before,
      to: after,
      note: kind,
    });
    return null;
  },
});

/**
 * Edit the prefilled rent line of a unit (roster-rent prefill): amount, date (inside the period),
 * name and memo, stored as an override on the statement. A field left undefined keeps its current
 * value; `reset: true` goes back to the roster values. Clears the rent confirmation.
 */
export const setRentLine = mutation({
  args: {
    statementId: v.optional(v.union(v.string(), v.null())),
    unitId: v.optional(v.union(v.string(), v.null())),
    amountCents: v.optional(v.union(v.number(), v.null())),
    date: v.optional(v.union(v.string(), v.null())),
    counterparty: v.optional(v.union(v.string(), v.null())),
    memo: v.optional(v.union(v.string(), v.null())),
    reset: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadDraft(ctx, org, args.statementId);
    const raw = typeof args.unitId === "string" ? args.unitId.trim() : "";
    const unitId = raw === "" ? null : ctx.db.normalizeId("units", raw);
    if (unitId === null) throw fieldError("unitId", RENT_MSG.lineNotOnStatement);
    const today = businessToday(Date.now());
    const built = await buildStatement(ctx, st, { statementDate: today });
    const key = rentKey(unitId);
    const line = [...built.lines, ...built.excludedLines].find((l) => l.key === key);
    if (!line || line.kind !== "rent" || !line.rentDefault) throw fieldError("unitId", RENT_MSG.lineNotOnStatement);
    const def = line.rentDefault;
    const current = { amountCents: line.amountCents, date: line.storedDate, counterparty: line.counterparty, memo: line.memo };

    let after = def;
    let next: RentOverride | null = null;
    if (args.reset !== true) {
      const c = validateRentLineFields({
        amount: args.amountCents === undefined ? current.amountCents : args.amountCents,
        date: args.date === undefined ? current.date : args.date,
        counterparty: args.counterparty === undefined ? current.counterparty : args.counterparty,
        memo: args.memo === undefined ? current.memo : args.memo,
        month: st.month,
        periodStart: st.periodStart,
        periodEnd: st.periodEnd,
        today,
      });
      if (!c.ok) throw fieldError(c.field, c.message);
      after = c.value;
      // Only what differs from the roster is stored.
      const o: RentOverride = { unitId };
      if (c.value.amountCents !== def.amountCents) o.amountCents = c.value.amountCents;
      if (c.value.date !== def.date) o.date = c.value.date;
      if (c.value.counterparty !== def.counterparty) o.counterparty = c.value.counterparty;
      if (c.value.memo !== def.memo) o.memo = c.value.memo;
      next = Object.keys(o).length > 1 ? o : null;
    }

    const list = st.rentOverrides ?? [];
    const prev = list.find((o) => o.unitId === unitId) ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next)) return null;
    const rentOverrides = [...list.filter((o) => o.unitId !== unitId), ...(next ? [next] : [])];
    await ctx.db.patch(st._id, { rentOverrides, updatedAt: Date.now() });
    const where = `Unit ${line.unit} (${line.propertyName})`;
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: args.reset === true ? "rent_line_reset" : "rent_line_changed",
      actorUserId: org.user._id,
      from: JSON.stringify(current),
      to: JSON.stringify(after),
      note: where,
    });
    await clearRentCheck(ctx, org, st, `Rent line changed: ${where}`);
    return null;
  },
});

/**
 * "I've checked the rent lines against what was actually received" (or untick it). Ticking needs
 * the fingerprint the accountant reviewed (`get().rent.hash`), so a change made meanwhile is never
 * confirmed unseen. Audited.
 */
export const confirmRent = mutation({
  args: {
    statementId: v.optional(v.union(v.string(), v.null())),
    checked: v.optional(v.union(v.boolean(), v.null())),
    expectedRentHash: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadDraft(ctx, org, args.statementId);
    if (args.checked !== true && args.checked !== false) throw fieldError("checked", RENT_MSG.confirmMissing);
    if (args.checked === false) {
      if (st.rentCheckedAt === undefined && st.rentCheckedHash === undefined) return null;
      await ctx.db.patch(st._id, { rentCheckedAt: undefined, rentCheckedBy: undefined, rentCheckedHash: undefined, updatedAt: Date.now() });
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "ros",
        entityId: st._id,
        action: "rent_unchecked",
        actorUserId: org.user._id,
        from: "checked",
        to: "unchecked",
      });
      return null;
    }
    const built = await buildStatement(ctx, st, { statementDate: businessToday(Date.now()) });
    if (built.rent.hash === null) throw new ConvexError(RENT_MSG.noRentLines);
    if (typeof args.expectedRentHash !== "string" || args.expectedRentHash !== built.rent.hash) {
      throw new ConvexError(RENT_MSG.changed);
    }
    if (built.rent.checked) return null;
    const on = built.lines.filter((l) => l.kind === "rent");
    const off = built.excludedLines.filter((l) => l.kind === "rent").length;
    const totalCents = on.reduce((sum, l) => sum + l.amountCents, 0);
    const now = Date.now();
    await ctx.db.patch(st._id, { rentCheckedAt: now, rentCheckedBy: org.user._id, rentCheckedHash: built.rent.hash, updatedAt: now });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "rent_checked",
      actorUserId: org.user._id,
      from: "unchecked",
      to: "checked",
      note: `${on.length} roster rent ${on.length === 1 ? "line" : "lines"} (${formatCurrency(totalCents)}), ${off} removed`,
    });
    return null;
  },
});

export const finalize = mutation({
  args: {
    statementId: v.optional(v.union(v.string(), v.null())),
    expectedEndingCents: v.optional(v.union(v.number(), v.null())),
    expectedAvailableCents: v.optional(v.union(v.number(), v.null())),
    /** Optional extra staleness guard: `get().previewHash` of the statement the user reviewed. */
    expectedHash: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    // 1. a draft of this org
    const st = await loadStatement(ctx, org, args.statementId);
    if (st.status === "final") throw fieldError("statementId", M.alreadyFinal);
    if (st.status === "discarded") throw fieldError("statementId", M.isDiscarded);

    // 2. the period must have ended
    const now = Date.now();
    const today = businessToday(now);
    const open = finalizeProblem(st.month, today);
    if (open) throw new ConvexError(open);

    // 3. build; refuse on blocking warnings
    const built = await buildStatement(ctx, st, { statementDate: today });
    const blocking = built.warnings.filter((w) => w.blocking);
    if (blocking.length > 0) {
      const more = blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : "";
      throw new ConvexError(`Can't finalize yet: ${blocking[0].message}${more}`);
    }

    // 4. staleness guard
    const { result } = built;
    if (
      args.expectedEndingCents !== result.summary.ending.total ||
      args.expectedAvailableCents !== result.summary.available.total ||
      (typeof args.expectedHash === "string" && args.expectedHash !== resultHash(result))
    ) {
      throw new ConvexError(M.stale);
    }

    // Defensive: no other final may hold any of these property-months.
    const rows = await statementRows(ctx, st._id);
    for (const pid of st.propertyIds) {
      const taken = (
        await ctx.db
          .query("ownerStatementProperties")
          .withIndex("by_property_and_month", (q) => q.eq("propertyId", pid).eq("month", st.month))
          .collect()
      ).find((r) => r.status === "final" && r.statementId !== st._id);
      if (taken) {
        const p = await ctx.db.get(pid);
        const o = await ctx.db.get(taken.ownerId);
        throw new ConvexError(MSG.CREATE_EXISTS(p?.name ?? "This property", "final", st.month, o?.legalName ?? "another owner"));
      }
    }

    // Snapshot first (pure), so a too-large statement is refused before anything is written.
    const snapshot = makeSnapshot(built.owner, result, today);
    const json = JSON.stringify(snapshot);
    if (snapshotTooLarge(json)) throw new ConvexError(M.tooLarge);

    const plan = finalizePlan(built, st._id);
    const monthLabel = formatMonth(st.month);

    // 5. work orders: re-check, write the ledger row, mark billed
    for (const r of plan.woRows) {
      const woId = ctx.db.normalizeId("workOrders", r.sourceId);
      const wo = woId ? await ctx.db.get(woId) : null;
      if (!wo || wo.orgId !== org.orgId) throw new ConvexError(M.woBilled(r.woNumber ?? 0));
      const prior = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_source", (q) => q.eq("source", "work_order").eq("sourceId", wo._id))
        .first();
      if (wo.billedStatementId !== undefined || prior !== null) throw new ConvexError(M.woBilled(wo.number));
      const entryId = await ctx.db.insert("ledgerEntries", {
        orgId: org.orgId,
        ownerId: st.ownerId,
        propertyId: wo.propertyId,
        ...(r.unitId !== undefined ? { unitId: wo.unitId } : {}),
        date: r.date,
        postedDate: r.postedDate,
        type: r.type,
        accountId: r.accountId as Id<"ledgerAccounts">,
        counterparty: COMPANY_NAME,
        memo: r.memo,
        amountCents: r.amountCents,
        source: "work_order",
        sourceId: wo._id,
        statementId: st._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(wo._id, {
        billedStatementId: st._id,
        billedLedgerEntryId: entryId,
        billedAt: now,
        rosPending: false,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "work_order",
        entityId: wo._id,
        action: "billed",
        actorUserId: org.user._id,
        to: st._id,
        note: `${monthLabel} statement for ${built.owner.legalName}`,
      });
    }

    // 6. management fee and owner draw rows (deterministic sourceId; never twice)
    for (const r of plan.generatedRows) {
      const prior = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_source", (q) => q.eq("source", r.source).eq("sourceId", r.sourceId))
        .first();
      if (prior) throw new ConvexError(M.finalizedAlready);
      await ctx.db.insert("ledgerEntries", {
        orgId: org.orgId,
        ownerId: st.ownerId,
        propertyId: r.propertyId as Id<"properties">,
        date: r.date,
        postedDate: r.postedDate,
        type: r.type,
        accountId: r.accountId as Id<"ledgerAccounts">,
        counterparty: r.counterparty,
        memo: r.memo,
        amountCents: r.amountCents,
        source: r.source,
        sourceId: r.sourceId,
        statementId: st._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 6b. roster-rent rows: one Rent Income row per included rent line (deterministic sourceId
    //     `${statementId}:${unitId}`; never twice)
    for (const r of plan.rentRows) {
      const prior = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_source", (q) => q.eq("source", "roster_rent").eq("sourceId", r.sourceId))
        .first();
      if (prior) throw new ConvexError(M.finalizedAlready);
      const uid = r.unitId !== undefined ? ctx.db.normalizeId("units", r.unitId) : null;
      const unit = uid ? await ctx.db.get(uid) : null;
      if (!unit || unit.orgId !== org.orgId || unit.propertyId !== r.propertyId) throw new ConvexError(M.entryChanged);
      await ctx.db.insert("ledgerEntries", {
        orgId: org.orgId,
        ownerId: st.ownerId,
        propertyId: unit.propertyId,
        unitId: unit._id,
        date: r.date,
        postedDate: r.postedDate,
        type: r.type,
        accountId: r.accountId as Id<"ledgerAccounts">,
        counterparty: r.counterparty,
        memo: r.memo,
        amountCents: r.amountCents,
        source: "roster_rent",
        sourceId: r.sourceId,
        statementId: st._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 7. manual rows: still unbilled and not voided, then stamp (date kept; postedDate = statement date)
    for (const { entryId: raw, postedDate } of plan.entryPosts) {
      const id = ctx.db.normalizeId("ledgerEntries", raw);
      const e = id ? await ctx.db.get(id) : null;
      if (!e || e.orgId !== org.orgId || e.statementId !== undefined || e.voided === true || e.ownerId !== st.ownerId) {
        throw new ConvexError(M.entryChanged);
      }
      await ctx.db.patch(e._id, { statementId: st._id, postedDate, updatedAt: now });
    }

    // 8. the immutable snapshot
    await ctx.db.insert("ownerStatementSnapshots", {
      orgId: org.orgId,
      statementId: st._id,
      version: 1,
      json,
      createdAt: now,
    });

    // 9. statement, per-property rows, link start months
    await ctx.db.patch(st._id, {
      status: "final",
      statementDate: today,
      endingCashCents: result.summary.ending.total,
      availableCents: result.summary.available.total,
      finalizedAt: now,
      finalizedBy: org.user._id,
      updatedAt: now,
    });
    const colOf = new Map(result.columns.map((c, i) => [c.propertyId, i]));
    for (const r of rows) {
      const i = colOf.get(r.propertyId);
      if (i === undefined) throw new Error(`finalize: statement row for an unknown property ${r.propertyId}`);
      await ctx.db.patch(r._id, { status: "final", endingCashCents: result.summary.ending.byProperty[i] });
    }
    if (rows.length !== st.propertyIds.length) throw new Error("finalize: statement rows don't match its properties");
    for (const link of built.ownerLinks) {
      if (link && link.startMonth === undefined) {
        await ctx.db.patch(link._id as Id<"ownerProperties">, { startMonth: st.month, updatedAt: now });
      }
    }

    // 10. audit
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "finalized",
      actorUserId: org.user._id,
      from: "draft",
      to: JSON.stringify({
        endingCents: result.summary.ending.total,
        availableCents: result.summary.available.total,
        lines: result.detail.additions.length + result.detail.subtractions.length,
        rentLines: plan.rentRows.length,
      }),
    });
    return { statementId: st._id };
  },
});

export const discard = mutation({
  args: { statementId: v.optional(v.union(v.string(), v.null())), reason: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadStatement(ctx, org, args.statementId);
    if (st.status === "final") throw fieldError("statementId", M.finalNoDiscard);
    if (st.status === "discarded") throw fieldError("statementId", M.isDiscarded);
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length > MAX_MEMO) throw fieldError("reason", M.reasonLong);
    const now = Date.now();
    await ctx.db.patch(st._id, { status: "discarded", discardedAt: now, discardedBy: org.user._id, updatedAt: now });
    for (const r of await statementRows(ctx, st._id)) await ctx.db.patch(r._id, { status: "discarded" });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "discarded",
      actorUserId: org.user._id,
      from: "draft",
      to: "discarded",
      ...(reason ? { note: reason } : {}),
    });
    return null;
  },
});

export const recordDownload = mutation({
  args: { statementId: v.optional(v.union(v.string(), v.null())), draft: v.optional(v.union(v.boolean(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const st = await loadStatement(ctx, org, args.statementId);
    if (st.status === "discarded") throw fieldError("statementId", M.isDiscarded);
    // The statement's own status decides the label; the client's `draft` flag is not trusted.
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "ros",
      entityId: st._id,
      action: "pdf_downloaded",
      actorUserId: org.user._id,
      note: st.status === "draft" ? "Draft PDF" : "Final PDF",
    });
    return null;
  },
});
