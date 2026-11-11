import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { OrgContext } from "./authz";
import { writeAudit } from "./audit";
import { fieldError, requireFinance } from "./financeAccess";
import { effectivePayee } from "./rosCalc";
import { readDefaultFeeBps } from "./feeSettingsLib";
import { MAX_AMOUNT_CENTS, formatBps, isMonth, naturalCompare, normalizeNameKey } from "./rosFormat";
import {
  FEE_MSG,
  MSG,
  cmpStr,
  effectiveFee,
  feeRangeLabel,
  linkSettingProblem,
  lockedThroughMonth,
  readFeeInput,
  validateOwnerFields,
  type OwnerFields,
} from "./rosPolicy";
import {
  FLAG_LABEL,
  LINK_ALL_LIMIT,
  NEEDS_REASON_TEXT,
  compareIdentity,
  identityOf,
  identitySignature,
  linkAllCounts,
  mergeProblem,
  mergedEmails,
  ownerMergedMessage,
  ownerPairKey,
  planLinkAll,
  propertyDismissProblem,
  propertyOwnerKey,
  type BulkPropertyInput,
  type BulkRow,
  type Candidate,
  type IdentityFlag,
  type LinkSettings,
  type MergeSide,
} from "./ownerIdentity";
import {
  applyLinkDecision,
  decideForProperty,
  linksOfPropertyRaw,
  loadIdentityData,
  propertyHasOpenDraft,
  type IdentityData,
} from "./ownerLinking";
import { ownerEmailsOf } from "./ownerVerifyLib";

/**
 * Rental owners, owner-property links and their statement settings (spec 5.2). Admin view +
 * accountant only (requireFinance). Every expected failure is a ConvexError with the exact message.
 */

export const OWNER_NOT_FOUND = "Owner not found.";

type Ctx = QueryCtx | MutationCtx;

const nameMsg = {
  linkNotFound: "That property isn't linked to this owner.",
  propertyMissing: "Select the property to link.",
  propertyNotFound: "Property not found.",
  openingBalanceInvalid: "Enter the opening balance like 1,250.00 (use a minus sign if it's negative).",
  startMonthInvalid: "Pick the first statement month.",
  reserveInvalid: "Enter the property reserve like 500.00.",
  reserveNegative: "The property reserve can't be negative.",
  reserveTooBig: "The property reserve can't be more than $1,000,000.00.",
  unitNotFound: "Unit not found.",
  depositInvalid: "Enter the deposit like 800.00.",
  depositNegative: "The deposit can't be negative.",
  depositTooBig: "The deposit can't be more than $1,000,000.00.",
  openDraft: "Discard or finalize the open draft for this owner first.",
} as const;

function readId<T extends "owners" | "properties" | "ownerProperties" | "units">(
  ctx: Ctx,
  table: T,
  raw: string | null | undefined,
): Id<T> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return ctx.db.normalizeId(table, raw.trim());
}

async function loadOwner(ctx: Ctx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"owners">> {
  const id = readId(ctx, "owners", raw);
  const owner = id ? await ctx.db.get(id) : null;
  if (!owner || owner.orgId !== org.orgId) throw fieldError("ownerId", OWNER_NOT_FOUND);
  return owner;
}

/** Refuses a write to an owner that was merged into another one (it has no links any more). */
async function refuseMerged(ctx: Ctx, owner: Doc<"owners">): Promise<void> {
  if (owner.mergedIntoOwnerId === undefined) return;
  const into = await ctx.db.get(owner.mergedIntoOwnerId);
  throw fieldError("ownerId", ownerMergedMessage(owner.legalName, into ? into.legalName : "another owner"));
}

async function loadLink(ctx: Ctx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"ownerProperties">> {
  const id = readId(ctx, "ownerProperties", raw);
  const link = id ? await ctx.db.get(id) : null;
  if (!link || link.orgId !== org.orgId) throw fieldError("linkId", nameMsg.linkNotFound);
  return link;
}

async function propertyName(ctx: Ctx, org: OrgContext, id: Id<"properties">): Promise<string> {
  const p = await ctx.db.get(id);
  return p && p.orgId === org.orgId ? p.name : "Unknown property";
}

async function linksOfProperty(ctx: Ctx, org: OrgContext, propertyId: Id<"properties">): Promise<Doc<"ownerProperties">[]> {
  return (
    await ctx.db
      .query("ownerProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect()
  ).filter((l) => l.orgId === org.orgId);
}

async function statementRowsOfProperty(
  ctx: Ctx,
  org: OrgContext,
  propertyId: Id<"properties">,
  status: "draft" | "final",
): Promise<Doc<"ownerStatementProperties">[]> {
  return (
    await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", propertyId).eq("status", status))
      .collect()
  ).filter((r) => r.orgId === org.orgId);
}

function contactName(o: { contactFirstName?: string; contactLastName?: string }): string {
  return `${o.contactFirstName?.trim() ?? ""} ${o.contactLastName?.trim() ?? ""}`.trim();
}

/** Missing = undefined, so an owner doc and a validated value compare the same way. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function ownerNameTaken(
  ctx: MutationCtx,
  orgId: string,
  legalName: string | null | undefined,
  exceptId?: Id<"owners">,
): Promise<boolean> {
  const key = normalizeNameKey(typeof legalName === "string" ? legalName : "");
  if (key === "") return false;
  const rows = await ctx.db
    .query("owners")
    .withIndex("by_org_and_name_key", (q) => q.eq("orgId", orgId).eq("nameKey", key))
    .collect();
  // A merged owner is gone for good (owners.merge): its name is free again.
  return rows.some((r) => r._id !== exceptId && r.mergedIntoOwnerId === undefined);
}

const ownerFieldArgs = {
  legalName: v.optional(v.union(v.string(), v.null())),
  contactFirstName: v.optional(v.union(v.string(), v.null())),
  contactLastName: v.optional(v.union(v.string(), v.null())),
  emails: v.optional(v.union(v.array(v.string()), v.string(), v.null())),
  payeeName: v.optional(v.union(v.string(), v.null())),
};

/** The owner columns a validated value maps to (null -> cleared). */
function ownerColumns(value: OwnerFields): Partial<Record<keyof OwnerFields, unknown>> {
  const out: Partial<Record<keyof OwnerFields, unknown>> = {};
  for (const k of Object.keys(value) as (keyof OwnerFields)[]) out[k] = value[k] ?? undefined;
  return out;
}

// --- queries -------------------------------------------------------------------------------------

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const owners = (
      await ctx.db
        .query("owners")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect()
    ).filter((o) => args.includeInactive === true || o.active);
    const links = await ctx.db
      .query("ownerProperties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const linkCount = new Map<string, number>();
    for (const l of links) linkCount.set(l.propertyId, (linkCount.get(l.propertyId) ?? 0) + 1);
    const defaultFeeBps = await readDefaultFeeBps(ctx, org.orgId);
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"properties">): Promise<string> => {
      const hit = names.get(id);
      if (hit !== undefined) return hit;
      const n = await propertyName(ctx, org, id);
      names.set(id, n);
      return n;
    };

    const rows = [];
    for (const o of owners) {
      const mine = links.filter((l) => l.ownerId === o._id);
      const coOwnedPropertyNames: string[] = [];
      for (const l of mine) if ((linkCount.get(l.propertyId) ?? 0) >= 2) coOwnedPropertyNames.push(await nameOf(l.propertyId));
      coOwnedPropertyNames.sort(naturalCompare);
      const payeeName = effectivePayee(o);
      const problems: string[] = [];
      if (payeeName === null) problems.push("Owner draw payee not set");
      rows.push({
        _id: o._id,
        legalName: o.legalName,
        contactName: contactName(o),
        emails: o.emails,
        /** The range of this owner's property fees ("5.00%" / "5.00–6.00%"); null = no properties. */
        feeRange: feeRangeLabel(mine.map((l) => effectiveFee(l.managementFeeBps, defaultFeeBps).bps)),
        payeeName,
        active: o.active,
        propertyCount: mine.length,
        coOwnedPropertyNames,
        problems,
      });
    }
    rows.sort((a, b) => naturalCompare(a.legalName, b.legalName) || cmpStr(a._id, b._id));
    return rows;
  },
});

export const get = query({
  args: { ownerId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const owner = await loadOwner(ctx, org, args.ownerId);
    const myLinks = await ctx.db
      .query("ownerProperties")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const defaultFeeBps = await readDefaultFeeBps(ctx, org.orgId);

    const links = [];
    for (const l of myLinks.filter((x) => x.orgId === org.orgId)) {
      const name = await propertyName(ctx, org, l.propertyId);
      const all = await linksOfProperty(ctx, org, l.propertyId);
      const coOwnerNames: string[] = [];
      if (all.length >= 2) {
        for (const x of all) {
          const o = await ctx.db.get(x.ownerId);
          coOwnerNames.push(o && o.orgId === org.orgId ? o.legalName : "Unknown owner");
        }
      }
      const finals = await statementRowsOfProperty(ctx, org, l.propertyId, "final");
      const drafts = await statementRowsOfProperty(ctx, org, l.propertyId, "draft");
      const myDraft = drafts.filter((d) => d.ownerId === owner._id).sort((a, b) => cmpStr(a.month, b.month))[0];
      const units = (
        await ctx.db
          .query("units")
          .withIndex("by_property", (q) => q.eq("propertyId", l.propertyId))
          .collect()
      )
        .filter((u) => u.orgId === org.orgId)
        .sort((a, b) => naturalCompare(a.unitNumber, b.unitNumber) || cmpStr(a._id, b._id))
        .map((u) => ({
          unitId: u._id,
          unitLabel: u.unitNumber,
          securityDepositHeldCents: u.securityDepositHeldCents ?? null,
        }));
      links.push({
        linkId: l._id,
        propertyId: l.propertyId,
        propertyName: name,
        coOwnerNames,
        coOwnedMessage: all.length >= 2 ? MSG.CO_OWNED(name, coOwnerNames) : null,
        openingBalanceCents: l.openingBalanceCents ?? null,
        startMonth: l.startMonth ?? null,
        propertyReserveCents: l.propertyReserveCents ?? 0,
        /** The property's own fee (bps); null = it uses the default. */
        ownFeeBps: l.managementFeeBps ?? null,
        /** The fee its statements use now (own fee ?? org default). */
        effectiveFeeBps: effectiveFee(l.managementFeeBps, defaultFeeBps).bps,
        lockedThroughMonth: lockedThroughMonth(finals.map((f) => f.month)),
        // This owner's finals only: they are what lock the opening balance and first month.
        hasFinal: finals.some((f) => f.ownerId === owner._id),
        openDraftMonth: myDraft?.month ?? null,
        units,
      });
    }
    links.sort((a, b) => naturalCompare(a.propertyName, b.propertyName) || cmpStr(a.propertyId, b.propertyId));

    return {
      _id: owner._id,
      legalName: owner.legalName,
      contactFirstName: owner.contactFirstName ?? null,
      contactLastName: owner.contactLastName ?? null,
      contactName: contactName(owner),
      emails: owner.emails,
      /** The org default fee (bps), what a property without its own fee uses. */
      defaultFeeBps,
      /** The stored payee (form input); null = derived from the contact. */
      payeeName: owner.payeeName ?? null,
      /** What prints when payeeName is blank (the form's placeholder). */
      derivedPayeeName: effectivePayee({ contactFirstName: owner.contactFirstName, contactLastName: owner.contactLastName }),
      /** What prints on the owner draw line. */
      effectivePayeeName: effectivePayee(owner),
      active: owner.active,
      source: owner.source,
      createdAt: owner.createdAt,
      updatedAt: owner.updatedAt,
      links,
    };
  },
});

export const propertyOptions = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const links = await ctx.db
      .query("ownerProperties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const owners = await ctx.db
      .query("owners")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const ownerName = new Map(owners.map((o) => [o._id as string, o.legalName]));
    return properties
      .map((p) => ({
        propertyId: p._id,
        name: p.name,
        ownerNames: links
          .filter((l) => l.propertyId === p._id)
          .map((l) => ownerName.get(l.ownerId) ?? "Unknown owner")
          .sort(naturalCompare),
      }))
      .sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a.propertyId, b.propertyId));
  },
});

// --- owner mutations -----------------------------------------------------------------------------

export const create = mutation({
  args: ownerFieldArgs,
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const checked = validateOwnerFields({
      mode: "create",
      legalName: args.legalName,
      contactFirstName: args.contactFirstName,
      contactLastName: args.contactLastName,
      emails: args.emails,
      payeeName: args.payeeName,
      nameTaken: await ownerNameTaken(ctx, org.orgId, args.legalName),
    });
    if (!checked.ok) throw fieldError(checked.field, checked.message);
    const f = checked.value;
    const now = Date.now();
    const ownerId = await ctx.db.insert("owners", {
      orgId: org.orgId,
      legalName: f.legalName as string,
      nameKey: f.nameKey as string,
      ...(f.contactFirstName ? { contactFirstName: f.contactFirstName } : {}),
      ...(f.contactLastName ? { contactLastName: f.contactLastName } : {}),
      emails: f.emails ?? [],
      ...(f.payeeName ? { payeeName: f.payeeName } : {}),
      active: true,
      source: "manual",
      createdBy: org.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: ownerId,
      action: "owner_created",
      actorUserId: org.user._id,
      to: JSON.stringify({
        legalName: f.legalName,
        contactFirstName: f.contactFirstName ?? null,
        contactLastName: f.contactLastName ?? null,
        emails: f.emails ?? [],
        payeeName: f.payeeName ?? null,
      }),
    });
    return { ownerId };
  },
});

export const update = mutation({
  args: { ownerId: v.optional(v.union(v.string(), v.null())), ...ownerFieldArgs },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const owner = await loadOwner(ctx, org, args.ownerId);
    await refuseMerged(ctx, owner);
    const checked = validateOwnerFields({
      mode: "update",
      legalName: args.legalName,
      contactFirstName: args.contactFirstName,
      contactLastName: args.contactLastName,
      emails: args.emails,
      payeeName: args.payeeName,
      nameTaken: args.legalName === undefined ? false : await ownerNameTaken(ctx, org.orgId, args.legalName, owner._id),
    });
    if (!checked.ok) throw fieldError(checked.field, checked.message);
    const cols = ownerColumns(checked.value);
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    const patch: Record<string, unknown> = {};
    for (const [k, next] of Object.entries(cols)) {
      const prev = (owner as unknown as Record<string, unknown>)[k];
      if (same(prev, next)) continue;
      patch[k] = next;
      if (k !== "nameKey") {
        from[k] = prev ?? null;
        to[k] = next ?? null;
      }
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(owner._id, { ...(patch as Partial<Doc<"owners">>), updatedAt: Date.now() });
    if (Object.keys(to).length > 0) {
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "owner",
        entityId: owner._id,
        action: "owner_updated",
        actorUserId: org.user._id,
        from: JSON.stringify(from),
        to: JSON.stringify(to),
      });
    }
    return null;
  },
});

export const setActive = mutation({
  args: { ownerId: v.optional(v.union(v.string(), v.null())), active: v.optional(v.union(v.boolean(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const owner = await loadOwner(ctx, org, args.ownerId);
    await refuseMerged(ctx, owner);
    if (typeof args.active !== "boolean") throw fieldError("active", "Choose whether the owner is active.");
    if (owner.active === args.active) return null;
    if (!args.active) {
      const draft = await ctx.db
        .query("ownerStatements")
        .withIndex("by_owner_and_month", (q) => q.eq("ownerId", owner._id))
        .filter((q) => q.eq(q.field("status"), "draft"))
        .first();
      if (draft) throw fieldError("active", nameMsg.openDraft);
    }
    await ctx.db.patch(owner._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: owner._id,
      action: args.active ? "owner_activated" : "owner_deactivated",
      actorUserId: org.user._id,
      from: owner.active ? "active" : "inactive",
      to: args.active ? "active" : "inactive",
    });
    return null;
  },
});

// --- links ---------------------------------------------------------------------------------------

export const linkProperty = mutation({
  args: {
    ownerId: v.optional(v.union(v.string(), v.null())),
    propertyId: v.optional(v.union(v.string(), v.null())),
    confirmCoOwned: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const owner = await loadOwner(ctx, org, args.ownerId);
    await refuseMerged(ctx, owner);
    if (typeof args.propertyId !== "string" || args.propertyId.trim() === "") {
      throw fieldError("propertyId", nameMsg.propertyMissing);
    }
    const pid = readId(ctx, "properties", args.propertyId);
    const property = pid ? await ctx.db.get(pid) : null;
    if (!property || property.orgId !== org.orgId) throw fieldError("propertyId", nameMsg.propertyNotFound);

    const links = await linksOfProperty(ctx, org, property._id);
    if (links.some((l) => l.ownerId === owner._id)) {
      throw fieldError("propertyId", `${property.name} is already linked to this owner.`);
    }
    // Checked before the co-owned confirmation, so the user isn't asked to confirm a link that
    // would then be refused anyway.
    const drafts = await statementRowsOfProperty(ctx, org, property._id, "draft");
    if (drafts.length > 0) {
      throw fieldError("propertyId", `${property.name} has an open draft statement. Finalize or discard it first.`);
    }
    const coOwned = links.length > 0;
    if (coOwned && args.confirmCoOwned !== true) {
      const others: string[] = [];
      for (const l of links) {
        const o = await ctx.db.get(l.ownerId);
        others.push(o && o.orgId === org.orgId ? o.legalName : "Unknown owner");
      }
      throw fieldError(
        "propertyId",
        `${property.name} already belongs to ${others.join(", ")}. Linking it here makes it co-owned and pauses its statements. Confirm to continue.`,
      );
    }
    const now = Date.now();
    const linkId = await ctx.db.insert("ownerProperties", {
      orgId: org.orgId,
      ownerId: owner._id,
      propertyId: property._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: owner._id,
      action: "owner_property_linked",
      actorUserId: org.user._id,
      to: property.name,
      ...(coOwned ? { note: "co-owned" } : {}),
    });
    return { linkId, coOwned };
  },
});

export const unlinkProperty = mutation({
  args: { linkId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const link = await loadLink(ctx, org, args.linkId);
    const name = await propertyName(ctx, org, link.propertyId);

    const drafts = await statementRowsOfProperty(ctx, org, link.propertyId, "draft");
    if (drafts.some((d) => d.ownerId === link.ownerId)) {
      throw fieldError("linkId", `${name} has an open draft statement for this owner. Finalize or discard it first.`);
    }
    const unbilled = (
      await ctx.db
        .query("ledgerEntries")
        .withIndex("by_property_statement_date", (q) => q.eq("propertyId", link.propertyId).eq("statementId", undefined))
        .collect()
    ).filter((e) => e.orgId === org.orgId && e.ownerId === link.ownerId && e.voided !== true);
    if (unbilled.length > 0) {
      throw fieldError(
        "linkId",
        `${name} has ${unbilled.length} transactions for this owner that aren't on a final statement yet. Put them on a statement or void them first.`,
      );
    }
    await ctx.db.delete(link._id);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: link.ownerId,
      action: "owner_property_unlinked",
      actorUserId: org.user._id,
      from: name,
      note: JSON.stringify({
        openingBalanceCents: link.openingBalanceCents ?? null,
        startMonth: link.startMonth ?? null,
        propertyReserveCents: link.propertyReserveCents ?? null,
        managementFeeBps: link.managementFeeBps ?? null,
      }),
    });
    return null;
  },
});

/**
 * A property's own management fee. `bps` null = use the org default ("Use default"). Allowed at any
 * time: finals are frozen snapshots, and an open draft recalculates (its Finalize dialog refuses a
 * statement reviewed at the old fee, via previewHash). Audited from/to.
 */
export const setPropertyFee = mutation({
  args: {
    linkId: v.optional(v.union(v.string(), v.null())),
    bps: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const link = await loadLink(ctx, org, args.linkId);
    const read = readFeeInput(args.bps);
    if (!read.ok) throw fieldError("managementFeeBps", read.message);
    const next = read.bps ?? undefined;
    if (next === link.managementFeeBps) throw fieldError("managementFeeBps", FEE_MSG.propertyUnchanged);
    const name = await propertyName(ctx, org, link.propertyId);
    const defaultFeeBps = await readDefaultFeeBps(ctx, org.orgId);
    const label = (bps: number | undefined): string => {
      const f = effectiveFee(bps, defaultFeeBps);
      return `${formatBps(f.bps)}% (${f.own ? "own" : "default"})`;
    };
    await ctx.db.patch(link._id, { managementFeeBps: next, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: link.ownerId,
      action: "owner_property_fee_changed",
      actorUserId: org.user._id,
      from: label(link.managementFeeBps),
      to: label(next),
      note: name,
    });
    return { effectiveFeeBps: effectiveFee(next, defaultFeeBps).bps, own: next !== undefined };
  },
});

export const updateLinkSettings = mutation({
  args: {
    linkId: v.optional(v.union(v.string(), v.null())),
    openingBalanceCents: v.optional(v.union(v.number(), v.null())),
    startMonth: v.optional(v.union(v.string(), v.null())),
    propertyReserveCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const link = await loadLink(ctx, org, args.linkId);
    const name = await propertyName(ctx, org, link.propertyId);
    // Only this owner's finals lock its settings (after a sale the new owner's link is still open).
    const ownerFinals = (await statementRowsOfProperty(ctx, org, link.propertyId, "final")).filter(
      (r) => r.ownerId === link.ownerId,
    ).length;
    const openDrafts = (await statementRowsOfProperty(ctx, org, link.propertyId, "draft")).length;

    const patch: { openingBalanceCents?: number; startMonth?: string; propertyReserveCents?: number } = {};
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    const change = (k: keyof typeof patch, prev: number | string | undefined, next: number | string | undefined): void => {
      if (prev === next) return;
      (patch as Record<string, unknown>)[k] = next;
      from[k] = prev ?? null;
      to[k] = next ?? null;
    };

    if (args.openingBalanceCents !== undefined) {
      const n = args.openingBalanceCents;
      if (n !== null && (!Number.isSafeInteger(n) || Math.abs(n) > MAX_AMOUNT_CENTS)) {
        throw fieldError("openingBalanceCents", nameMsg.openingBalanceInvalid);
      }
      const next = n ?? undefined;
      if (next !== link.openingBalanceCents) {
        const locked = linkSettingProblem("openingBalanceCents", name, ownerFinals, openDrafts);
        if (locked) throw fieldError("openingBalanceCents", locked);
      }
      change("openingBalanceCents", link.openingBalanceCents, next);
    }

    if (args.startMonth !== undefined) {
      const s = typeof args.startMonth === "string" ? args.startMonth.trim() : "";
      if (s !== "" && !isMonth(s)) throw fieldError("startMonth", nameMsg.startMonthInvalid);
      const next = s === "" ? undefined : s;
      if (next !== link.startMonth) {
        const locked = linkSettingProblem("startMonth", name, ownerFinals, openDrafts);
        if (locked) throw fieldError("startMonth", locked);
      }
      change("startMonth", link.startMonth, next);
    }

    if (args.propertyReserveCents !== undefined) {
      const n = args.propertyReserveCents;
      if (n !== null) {
        if (!Number.isSafeInteger(n)) throw fieldError("propertyReserveCents", nameMsg.reserveInvalid);
        if (n < 0) throw fieldError("propertyReserveCents", nameMsg.reserveNegative);
        if (n > MAX_AMOUNT_CENTS) throw fieldError("propertyReserveCents", nameMsg.reserveTooBig);
      }
      change("propertyReserveCents", link.propertyReserveCents, n ?? undefined);
    }

    if (Object.keys(to).length === 0) return null;
    await ctx.db.patch(link._id, { ...patch, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: link.ownerId,
      action: "owner_property_settings_changed",
      actorUserId: org.user._id,
      from: JSON.stringify(from),
      to: JSON.stringify(to),
      note: name,
    });
    return null;
  },
});

export const setUnitDeposit = mutation({
  args: {
    unitId: v.optional(v.union(v.string(), v.null())),
    amountCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const uid = readId(ctx, "units", args.unitId);
    const unit = uid ? await ctx.db.get(uid) : null;
    if (!unit || unit.orgId !== org.orgId) throw fieldError("unitId", nameMsg.unitNotFound);
    const n = args.amountCents;
    if (n === undefined) throw fieldError("amountCents", nameMsg.depositInvalid);
    if (n !== null) {
      if (!Number.isSafeInteger(n)) throw fieldError("amountCents", nameMsg.depositInvalid);
      if (n < 0) throw fieldError("amountCents", nameMsg.depositNegative);
      if (n > MAX_AMOUNT_CENTS) throw fieldError("amountCents", nameMsg.depositTooBig);
    }
    const next = n ?? undefined;
    if (next === unit.securityDepositHeldCents) return null;
    await ctx.db.patch(unit._id, { securityDepositHeldCents: next, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "unit",
      entityId: unit._id,
      action: "security_deposit_set",
      actorUserId: org.user._id,
      from: unit.securityDepositHeldCents === undefined ? "not set" : String(unit.securityDepositHeldCents),
      to: next === undefined ? "not set" : String(next),
    });
    return null;
  },
});

// --- owner identity: "Needs an owner", merge, "Not the same owner" -------------------------------
//
// Owners are identified by name AND email (ownerIdentity.ts, user decision 2026-11-11). Look-alikes
// are kept separate and flagged; the accountant decides here. Nothing below sends anything.

export const IDENTITY_MSG = {
  propertyMissing: "Select the property.",
  propertyNotFound: "Property not found.",
  ownerMissing: "Select the owner.",
  otherOwnerMissing: "Select the other owner.",
  kindInvalid: "Choose what you are marking as not the same owner.",
  sameOwnerTwice: "Pick two different owners.",
  alreadyLinked: (property: string, owners: string): string => `${property} is already linked to ${owners}. Unlink it there first.`,
  openDraft: (property: string): string => `${property} has an open draft statement. Finalize or discard it first.`,
  nameTakenNoEmail: (name: string): string =>
    `An owner named “${name}” already exists. Link the property to that owner, or add an email that tells the two apart.`,
  nameAndEmailTaken: (name: string): string =>
    `“${name}” with that email is already an owner. Link the property to that owner instead.`,
} as const;

const q = (s: string): string => `“${s}”`;

type CandidateRow = {
  ownerId: Id<"owners">;
  legalName: string;
  emails: string[];
  active: boolean;
  flag: IdentityFlag | null;
  flagText: string;
};

function candidateRows(cands: Candidate[], docs: Map<string, Doc<"owners">>): CandidateRow[] {
  const out: CandidateRow[] = [];
  for (const c of cands) {
    const o = docs.get(c.ownerId);
    if (!o) continue;
    out.push({
      ownerId: o._id,
      legalName: o.legalName,
      emails: o.emails,
      active: o.active,
      flag: c.flag,
      flagText: c.flag === null ? "Same name and email" : FLAG_LABEL[c.flag],
    });
  }
  return out.sort((a, b) => naturalCompare(a.legalName, b.legalName) || cmpStr(a.ownerId, b.ownerId));
}

/**
 * The Owners page's "Needs an owner" list: every property with no owner link, every property whose
 * page names a different owner than the one its statements are linked to, and every pair of owners
 * that may be the same. Each row has the reason and the owner name / emails from the property page
 * (finance users only, so emails are shown in full).
 */
type BulkState = {
  properties: Map<string, Doc<"properties">>;
  links: Doc<"ownerProperties">[];
  linkedTo: Map<string, string[]>;
  /** One row per property that is not simply "linked", in display order (property name). */
  rows: BulkRow[];
};

/**
 * Every property's owner decision plus what "Link all exact matches" would do with it
 * (ownerIdentity.planLinkAll), from the database. Shared by the Needs-an-owner list and the bulk
 * mutation, so the button does exactly what the list shows.
 */
async function bulkState(ctx: Ctx, orgId: string, data: IdentityData): Promise<BulkState> {
  const docs = (
    await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a._id, b._id));
  const links = await ctx.db
    .query("ownerProperties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const linkedTo = new Map<string, string[]>();
  for (const l of links) linkedTo.set(l.propertyId, [...(linkedTo.get(l.propertyId) ?? []), l.ownerId]);
  const input: BulkPropertyInput[] = [];
  for (const p of docs) {
    const linked = linkedTo.get(p._id) ?? [];
    input.push({
      id: p._id,
      name: p.name,
      ownerName: (p.ownerName ?? "").trim(),
      ownerEmails: ownerEmailsOf(p),
      linkedOwnerIds: linked,
      hasOpenDraft: linked.length === 0 ? await propertyHasOpenDraft(ctx, orgId, p._id) : false,
    });
  }
  return {
    properties: new Map(docs.map((p) => [p._id as string, p])),
    links,
    linkedTo,
    rows: planLinkAll({ properties: input, owners: data.owners, dismissed: data.dismissals }),
  };
}

export const needsOwner = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    const data = await loadIdentityData(ctx, org.orgId);
    const state = await bulkState(ctx, org.orgId, data);
    const { links, linkedTo } = state;
    const ownerName = (id: string): string => data.ownerDocs.get(id)?.legalName ?? "Unknown owner";
    const nameOfProperty = (id: string): string => state.properties.get(id)?.name ?? "another property";

    const rows = [];
    for (const r of state.rows) {
      const p = state.properties.get(r.propertyId);
      if (!p) continue;
      const decision = r.decision;
      const linked = linkedTo.get(p._id) ?? [];
      const rosterEmails = ownerEmailsOf(p);
      const rosterName = (p.ownerName ?? "").trim();
      let reason: string;
      let reasonText: string;
      let message: string | null = null;
      let candidates: CandidateRow[] = [];
      let readyOwnerId: Id<"owners"> | null = null;
      if (decision.kind === "mismatch") {
        reason = "mismatch";
        reasonText = `The property page says ${q(rosterName)}; its statements are linked to ${decision.linkedOwnerIds.map((id) => q(ownerName(id))).join(" and ")}.`;
        candidates = candidateRows(decision.candidates, data.ownerDocs);
      } else if (decision.kind === "link") {
        reason = "link";
        readyOwnerId = decision.ownerId as Id<"owners">;
        reasonText = `Matches ${q(ownerName(decision.ownerId))} by name and email.`;
        candidates = candidateRows([{ ownerId: decision.ownerId, flag: null, sharedEmails: [] }], data.ownerDocs);
      } else if (decision.kind === "create") {
        reason = "create";
        reasonText = NEEDS_REASON_TEXT.create;
      } else if (decision.kind === "needs") {
        reason = decision.reason;
        reasonText = NEEDS_REASON_TEXT[decision.reason];
        message = decision.message ?? null;
        candidates = candidateRows(decision.candidates, data.ownerDocs);
      } else continue;
      const action = r.action;
      rows.push({
        propertyId: p._id,
        propertyName: p.name,
        category: p.category ?? null,
        rosterName: rosterName === "" ? null : rosterName,
        rosterEmails,
        kind: decision.kind,
        reason,
        reasonText,
        message,
        candidates,
        readyOwnerId,
        linkedOwners: linked.map((id) => ({ ownerId: id as Id<"owners">, legalName: ownerName(id) })),
        /** Left out of "Link all exact matches"; `doubt` says why. */
        doubtful: r.doubt !== null,
        doubt: r.doubt,
        /** What "Link all exact matches" does with it (null when doubtful). */
        bulk:
          action === null
            ? null
            : action.kind === "link_new"
              ? { kind: action.kind, withPropertyName: nameOfProperty(action.fromPropertyId) }
              : { kind: action.kind, withPropertyName: null },
      });
    }
    // Already in property-name order (bulkState).

    // Owners that may be the same owner (active, not merged, not marked "Not the same owner").
    const propertyCount = new Map<string, number>();
    for (const l of links) propertyCount.set(l.ownerId, (propertyCount.get(l.ownerId) ?? 0) + 1);
    const active = data.owners
      .filter((o) => o.active && o.mergedIntoOwnerId === undefined)
      .sort((a, b) => naturalCompare(a.legalName, b.legalName) || cmpStr(a.id, b.id));
    const side = (o: (typeof active)[number]) => ({
      ownerId: o.id as Id<"owners">,
      legalName: o.legalName,
      emails: o.emails,
      propertyCount: propertyCount.get(o.id) ?? 0,
    });
    const ownerPairs = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const v = compareIdentity(identityOf(a.legalName, a.emails), identityOf(b.legalName, b.emails));
        if (!v.same && v.flag === null) continue;
        if (data.dismissals.ownerPairs.has(ownerPairKey(a.id, b.id))) continue;
        ownerPairs.push({
          key: ownerPairKey(a.id, b.id),
          a: side(a),
          b: side(b),
          flag: v.flag ?? ("same_owner" as const),
          flagText: v.flag === null ? "Same name and email: these look like one owner" : FLAG_LABEL[v.flag],
          sharedEmails: v.sharedEmails,
        });
      }
    }
    return { properties: rows, ownerPairs, bulk: linkAllCounts(state.rows) };
  },
});

// --- merge ---------------------------------------------------------------------------------------

async function statementStateOf(ctx: Ctx, ownerId: Id<"owners">): Promise<{ hasFinal: boolean; hasOpenDraft: boolean }> {
  const rows = await ctx.db
    .query("ownerStatements")
    .withIndex("by_owner_and_month", (q) => q.eq("ownerId", ownerId))
    .collect();
  return { hasFinal: rows.some((r) => r.status === "final"), hasOpenDraft: rows.some((r) => r.status === "draft") };
}

async function ledgerRowsOf(ctx: Ctx, ownerId: Id<"owners">): Promise<number> {
  const rows = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_owner_and_date", (q) => q.eq("ownerId", ownerId))
    .collect();
  return rows.filter((r) => r.voided !== true).length;
}

const settingsOf = (l: Doc<"ownerProperties">): LinkSettings => ({
  openingBalanceCents: l.openingBalanceCents,
  startMonth: l.startMonth,
  propertyReserveCents: l.propertyReserveCents,
  managementFeeBps: l.managementFeeBps,
});

type MergeState = {
  problem: { field: "keepOwnerId" | "mergeOwnerId"; message: string } | null;
  keep: Doc<"owners"> | null;
  merge: Doc<"owners"> | null;
  keepLinks: Doc<"ownerProperties">[];
  mergeLinks: Doc<"ownerProperties">[];
  /** Properties that move from `merge` to `keep`. */
  moves: string[];
  /** Properties linked to both (the merged owner's link is removed). */
  shared: string[];
  emailsAfter: string[];
};

/** Everything a merge would do and why it can't, without writing. Never throws for user input. */
async function mergeState(ctx: Ctx, org: OrgContext, keepRaw: string | null | undefined, mergeRaw: string | null | undefined): Promise<MergeState> {
  const empty: MergeState = { problem: null, keep: null, merge: null, keepLinks: [], mergeLinks: [], moves: [], shared: [], emailsAfter: [] };
  const load = async (raw: string | null | undefined): Promise<Doc<"owners"> | null | "not_found"> => {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const id = readId(ctx, "owners", raw);
    const o = id ? await ctx.db.get(id) : null;
    return o && o.orgId === org.orgId ? o : "not_found";
  };
  const keep = await load(keepRaw);
  const merge = await load(mergeRaw);
  if (keep === "not_found") return { ...empty, problem: { field: "keepOwnerId", message: OWNER_NOT_FOUND } };
  if (merge === "not_found") return { ...empty, problem: { field: "mergeOwnerId", message: OWNER_NOT_FOUND } };
  const linksOf = async (o: Doc<"owners"> | null): Promise<Doc<"ownerProperties">[]> =>
    o
      ? (
          await ctx.db
            .query("ownerProperties")
            .withIndex("by_owner", (q) => q.eq("ownerId", o._id))
            .collect()
        ).filter((l) => l.orgId === org.orgId)
      : [];
  const keepLinks = await linksOf(keep);
  const mergeLinks = await linksOf(merge);
  const sideOf = async (o: Doc<"owners"> | null): Promise<MergeSide | null> => {
    if (!o) return null;
    const s = await statementStateOf(ctx, o._id);
    const side: MergeSide = {
      id: o._id,
      legalName: o.legalName,
      emails: o.emails,
      active: o.active,
      hasFinal: s.hasFinal,
      hasOpenDraft: s.hasOpenDraft,
      ledgerRows: await ledgerRowsOf(ctx, o._id),
    };
    // The owner-level fee is deprecated (the fee is per property link, compared in sharedLinks).
    if (o.payeeName !== undefined) side.payeeName = o.payeeName;
    if (o.mergedIntoOwnerId !== undefined) side.mergedIntoOwnerId = o.mergedIntoOwnerId;
    return side;
  };
  const moves: string[] = [];
  const shared: string[] = [];
  const sharedLinks: Array<{ propertyName: string; keep: LinkSettings; merge: LinkSettings }> = [];
  for (const l of mergeLinks) {
    const name = await propertyName(ctx, org, l.propertyId);
    const both = keepLinks.find((k) => k.propertyId === l.propertyId);
    if (both) {
      shared.push(name);
      sharedLinks.push({ propertyName: name, keep: settingsOf(both), merge: settingsOf(l) });
    } else moves.push(name);
  }
  moves.sort(naturalCompare);
  shared.sort(naturalCompare);
  return {
    problem: mergeProblem(await sideOf(keep), await sideOf(merge), sharedLinks),
    keep,
    merge,
    keepLinks,
    mergeLinks,
    moves,
    shared,
    emailsAfter: keep && merge ? mergedEmails(keep.emails, merge.emails) : [],
  };
}

/** What "Merge owners" would do (the dialog's confirmation), or why it can't. */
export const mergePreview = query({
  args: {
    keepOwnerId: v.optional(v.union(v.string(), v.null())),
    mergeOwnerId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const s = await mergeState(ctx, org, args.keepOwnerId, args.mergeOwnerId);
    const brief = (o: Doc<"owners"> | null) =>
      o
        ? {
            ownerId: o._id,
            legalName: o.legalName,
            emails: o.emails,
            payeeName: effectivePayee(o),
          }
        : null;
    return {
      problem: s.problem,
      keep: brief(s.keep),
      merge: brief(s.merge),
      moves: s.moves,
      shared: s.shared,
      emailsAfter: s.emailsAfter,
    };
  },
});

/**
 * Merge owner `mergeOwnerId` into `keepOwnerId`: its property links move to the kept owner (a
 * property linked to both keeps the kept owner's link), the emails are unioned, the kept owner's
 * fee and payee stay, and the merged owner is turned off and marked merged. Refused while either
 * owner has a final statement or an open draft, while the merged owner has ledger rows, or when
 * the fee / payee / shared link settings differ (mergeProblem).
 */
export const merge = mutation({
  args: {
    keepOwnerId: v.optional(v.union(v.string(), v.null())),
    mergeOwnerId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    const s = await mergeState(ctx, org, args.keepOwnerId, args.mergeOwnerId);
    if (s.problem) throw fieldError(s.problem.field, s.problem.message);
    const keep = s.keep as Doc<"owners">;
    const gone = s.merge as Doc<"owners">;
    const now = Date.now();
    for (const l of s.mergeLinks) {
      const name = await propertyName(ctx, org, l.propertyId);
      const both = s.keepLinks.some((k) => k.propertyId === l.propertyId);
      if (both) await ctx.db.delete(l._id);
      else {
        await ctx.db.patch(l._id, { ownerId: keep._id, updatedAt: now });
        await writeAudit(ctx, {
          orgId: org.orgId,
          entity: "owner",
          entityId: keep._id,
          action: "owner_property_linked",
          actorUserId: org.user._id,
          to: name,
          note: `merged from ${gone.legalName}`,
        });
      }
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "owner",
        entityId: gone._id,
        action: "owner_property_unlinked",
        actorUserId: org.user._id,
        from: name,
        note: `merged into ${keep.legalName}`,
      });
    }
    const emailsAdded = s.emailsAfter.length - keep.emails.length;
    await ctx.db.patch(keep._id, { ...(emailsAdded > 0 ? { emails: s.emailsAfter } : {}), updatedAt: now });
    await ctx.db.patch(gone._id, { active: false, mergedIntoOwnerId: keep._id, mergedAt: now, updatedAt: now });
    // Counts only: owner emails never go into these audit rows.
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: keep._id,
      action: "owner_merged",
      actorUserId: org.user._id,
      from: gone.legalName,
      to: keep.legalName,
      note: JSON.stringify({ mergedOwnerId: gone._id, propertiesMoved: s.moves.length, alreadyLinked: s.shared.length, emailsAdded }),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: gone._id,
      action: "owner_merged_into",
      actorUserId: org.user._id,
      from: gone.legalName,
      to: keep.legalName,
      note: JSON.stringify({ keptOwnerId: keep._id, deactivated: true }),
    });
    return { propertiesMoved: s.moves.length, alreadyLinked: s.shared.length };
  },
});

// --- "Not the same owner" ------------------------------------------------------------------------

/**
 * Marks an identity flag as reviewed and wrong, so it is not raised again:
 *   kind "owner_pair":     two owners are different people;
 *   kind "property_owner": the owner the property page names is not this owner (remembered with
 *                          the page's current owner name + emails: editing them asks again).
 * Idempotent.
 */
export const dismissIdentityFlag = mutation({
  args: {
    kind: v.optional(v.union(v.string(), v.null())),
    ownerId: v.optional(v.union(v.string(), v.null())),
    otherOwnerId: v.optional(v.union(v.string(), v.null())),
    propertyId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    if (args.kind !== "owner_pair" && args.kind !== "property_owner") throw fieldError("kind", IDENTITY_MSG.kindInvalid);
    if (typeof args.ownerId !== "string" || args.ownerId.trim() === "") throw fieldError("ownerId", IDENTITY_MSG.ownerMissing);
    const owner = await loadOwner(ctx, org, args.ownerId);
    const now = Date.now();

    let key: string;
    let row: { otherOwnerId?: Id<"owners">; propertyId?: Id<"properties"> };
    let label: string;
    if (args.kind === "owner_pair") {
      if (typeof args.otherOwnerId !== "string" || args.otherOwnerId.trim() === "") {
        throw fieldError("otherOwnerId", IDENTITY_MSG.otherOwnerMissing);
      }
      const other = await loadOwner(ctx, org, args.otherOwnerId).catch(() => {
        throw fieldError("otherOwnerId", OWNER_NOT_FOUND);
      });
      if (other._id === owner._id) throw fieldError("otherOwnerId", IDENTITY_MSG.sameOwnerTwice);
      key = ownerPairKey(owner._id, other._id);
      row = { otherOwnerId: other._id };
      label = other.legalName;
    } else {
      if (typeof args.propertyId !== "string" || args.propertyId.trim() === "") {
        throw fieldError("propertyId", IDENTITY_MSG.propertyMissing);
      }
      const pid = readId(ctx, "properties", args.propertyId);
      const property = pid ? await ctx.db.get(pid) : null;
      if (!property || property.orgId !== org.orgId) throw fieldError("propertyId", IDENTITY_MSG.propertyNotFound);
      const refused = propertyDismissProblem({
        propertyLinked: (await linksOfPropertyRaw(ctx, org.orgId, property._id)).length > 0,
        property: { ownerName: property.ownerName, ownerEmails: ownerEmailsOf(property) },
        owner,
      });
      if (refused) throw fieldError("ownerId", refused);
      const signature = identitySignature(identityOf(property.ownerName, ownerEmailsOf(property)));
      key = propertyOwnerKey(property._id, owner._id, signature);
      row = { propertyId: property._id };
      label = property.name;
    }
    const existing = await ctx.db
      .query("ownerIdentityDismissals")
      .withIndex("by_org_and_key", (q) => q.eq("orgId", org.orgId).eq("key", key))
      .first();
    if (existing) return null;
    await ctx.db.insert("ownerIdentityDismissals", {
      orgId: org.orgId,
      kind: args.kind,
      key,
      ownerId: owner._id,
      ...row,
      createdBy: org.user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: owner._id,
      action: "owner_identity_dismissed",
      actorUserId: org.user._id,
      to: label,
      note: args.kind === "owner_pair" ? "Not the same owner" : "Not the owner named on this property page",
    });
    return null;
  },
});

// --- create an owner from a property --------------------------------------------------------------

/**
 * "Create owner" on the Needs-an-owner list: a new owner from the property page's owner name and
 * emails (both editable), linked to that property. The new owner's properties use the default
 * management fee unless a property has its own. A second owner with the same name is allowed only when
 * it has an email none of the same-name owners has (the identity rule keeps them apart).
 */
export const createForProperty = mutation({
  args: {
    propertyId: v.optional(v.union(v.string(), v.null())),
    legalName: v.optional(v.union(v.string(), v.null())),
    emails: v.optional(v.union(v.array(v.string()), v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const org = await requireFinance(ctx);
    if (typeof args.propertyId !== "string" || args.propertyId.trim() === "") {
      throw fieldError("propertyId", IDENTITY_MSG.propertyMissing);
    }
    const pid = readId(ctx, "properties", args.propertyId);
    const property = pid ? await ctx.db.get(pid) : null;
    if (!property || property.orgId !== org.orgId) throw fieldError("propertyId", IDENTITY_MSG.propertyNotFound);

    const checked = validateOwnerFields({ mode: "update", legalName: args.legalName ?? "", emails: args.emails ?? [] });
    if (!checked.ok) throw fieldError(checked.field, checked.message);
    const legalName = checked.value.legalName as string;
    const nameKey = checked.value.nameKey as string;
    const emails = checked.value.emails ?? [];

    const links = await linksOfPropertyRaw(ctx, org.orgId, property._id);
    if (links.length > 0) {
      const names: string[] = [];
      for (const l of links) {
        const o = await ctx.db.get(l.ownerId);
        names.push(o && o.orgId === org.orgId ? o.legalName : "Unknown owner");
      }
      throw fieldError("propertyId", IDENTITY_MSG.alreadyLinked(property.name, names.join(", ")));
    }
    if (await propertyHasOpenDraft(ctx, org.orgId, property._id)) {
      throw fieldError("propertyId", IDENTITY_MSG.openDraft(property.name));
    }
    const sameName = (
      await ctx.db
        .query("owners")
        .withIndex("by_org_and_name_key", (q) => q.eq("orgId", org.orgId).eq("nameKey", nameKey))
        .collect()
    ).filter((o) => o.mergedIntoOwnerId === undefined);
    if (sameName.length > 0) {
      if (emails.length === 0 || sameName.some((o) => o.emails.length === 0)) {
        throw fieldError("legalName", IDENTITY_MSG.nameTakenNoEmail(legalName));
      }
      if (sameName.some((o) => o.emails.some((e) => emails.includes(e)))) {
        throw fieldError("emails", IDENTITY_MSG.nameAndEmailTaken(legalName));
      }
    }

    const now = Date.now();
    const ownerId = await ctx.db.insert("owners", {
      orgId: org.orgId,
      legalName,
      nameKey,
      emails,
      active: true,
      source: "manual",
      createdFromPropertyId: property._id,
      createdBy: org.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: ownerId,
      action: "owner_created",
      actorUserId: org.user._id,
      to: JSON.stringify({ legalName, emails: emails.length }),
      note: `from Needs an owner: ${property.name}`,
    });
    await ctx.db.insert("ownerProperties", { orgId: org.orgId, ownerId, propertyId: property._id, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "owner",
      entityId: ownerId,
      action: "owner_property_linked",
      actorUserId: org.user._id,
      to: property.name,
      note: "from Needs an owner",
    });
    return { ownerId };
  },
});

// --- "Link all exact matches" ----------------------------------------------------------------------

/**
 * The Needs-an-owner bulk action: links every property that is "Ready to link" (one exact,
 * unflagged, active owner) and creates + links every "New owner" (name + valid email, nobody alike,
 * nothing else on the list alike), exactly as the automatic link (ownerLinking) would. Decides
 * everything again here from the database (never from the list the browser shows), skips anything
 * doubtful, and re-checks each property just before writing it: a property whose decision changed
 * is skipped. At most LINK_ALL_LIMIT properties per call; `remaining` says how many are left for
 * the next click. Idempotent: a linked property is never touched again. Every link and every new
 * owner is audited. Never sends anything to anyone.
 */
export const linkAllExact = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireFinance(ctx);
    const data = await loadIdentityData(ctx, org.orgId);
    const state = await bulkState(ctx, org.orgId, data);
    const safe = state.rows.filter((r) => r.action !== null);
    const batch = safe.slice(0, LINK_ALL_LIMIT);
    const created = new Map<string, Id<"owners">>();
    const out = { linked: 0, created: 0, linkedToNew: 0, skipped: 0, remaining: safe.length - batch.length };
    const opts = { source: "manual" as const, actorUserId: org.user._id, data, via: "Link all exact matches" };

    for (const r of batch) {
      const action = r.action;
      const property = await ctx.db.get(r.propertyId as Id<"properties">);
      if (!action || !property || property.orgId !== org.orgId) {
        out.skipped++;
        continue;
      }
      // The same decision again, against what this call has already written.
      const live = await decideForProperty(ctx, property, data);
      const ok =
        action.kind === "create"
          ? live.kind === "create"
          : live.kind === "link" &&
            live.ownerId === (action.kind === "link" ? action.ownerId : created.get(action.fromPropertyId));
      if (!ok || (live.kind !== "link" && live.kind !== "create")) {
        out.skipped++;
        continue;
      }
      const ownerId = await applyLinkDecision(ctx, property, live, opts);
      if (action.kind === "create") {
        created.set(property._id, ownerId);
        out.created++;
      } else if (action.kind === "link") out.linked++;
      else out.linkedToNew++;
    }
    return out;
  },
});
