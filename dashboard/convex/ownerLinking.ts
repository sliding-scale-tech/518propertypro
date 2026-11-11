import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { decidePropertyLink, type Dismissals, type IdOwner, type LinkDecision } from "./ownerIdentity";
import { ownerEmailsOf } from "./ownerVerifyLib";
import { normalizeNameKey } from "./rosFormat";

/**
 * Automatic owner link for a property (ROS owner identity, user decision 2026-11-11). Called by
 * every writer of a property's owner name / emails (properties.updateProfile and the roster
 * import's upsertProperty) after the property is saved. The decision itself is the pure
 * ownerIdentity.decidePropertyLink; this file only reads what it needs and carries it out:
 *
 *   - exact name + email match to exactly one active owner, nothing in doubt -> link it;
 *   - nobody matches or looks alike, and the property has a name and an email -> new owner
 *     (new owner's properties use the default management fee) + link;
 *   - anything else (flagged, ambiguous, no email, no name, open draft, already linked to
 *     someone else) -> nothing is written; the property shows on the Owners page's
 *     "Needs an owner" list (owners.needsOwner).
 *
 * An existing link is NEVER moved or added to. Never sends anything to anyone.
 *
 * Batches (the roster import, owners.linkAllExact) load the owners and "Not the same owner"
 * decisions once (loadIdentityData) and pass them in as `data`; an owner created along the way is
 * added to it, so the next property of the same owner links to it instead of creating another.
 *
 * Safe on the property save path: every expected condition is a returned decision, not a throw.
 * The reads and the decision are guarded, so a bug there skips the link (the property then simply
 * shows on the list) instead of failing the property save.
 */

type Ctx = QueryCtx | MutationCtx;

export type IdentityData = {
  owners: IdOwner[];
  ownerDocs: Map<string, Doc<"owners">>;
  dismissals: Dismissals;
};

export function toIdOwner(o: Doc<"owners">): IdOwner {
  const out: IdOwner = { id: o._id, legalName: o.legalName, emails: o.emails, active: o.active };
  if (o.mergedIntoOwnerId !== undefined) out.mergedIntoOwnerId = o.mergedIntoOwnerId;
  return out;
}

/** Every owner of the org and every "Not the same owner" decision. */
export async function loadIdentityData(ctx: Ctx, orgId: string): Promise<IdentityData> {
  const docs = await ctx.db
    .query("owners")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const rows = await ctx.db
    .query("ownerIdentityDismissals")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return {
    owners: docs.map(toIdOwner),
    ownerDocs: new Map(docs.map((o) => [o._id as string, o])),
    dismissals: {
      ownerPairs: new Set(rows.filter((r) => r.kind === "owner_pair").map((r) => r.key)),
      propertyOwner: new Set(rows.filter((r) => r.kind === "property_owner").map((r) => r.key)),
    },
  };
}

export async function linksOfPropertyRaw(ctx: Ctx, orgId: string, propertyId: Id<"properties">): Promise<Doc<"ownerProperties">[]> {
  return (
    await ctx.db
      .query("ownerProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect()
  ).filter((l) => l.orgId === orgId);
}

export async function propertyHasOpenDraft(ctx: Ctx, orgId: string, propertyId: Id<"properties">): Promise<boolean> {
  const draft = await ctx.db
    .query("ownerStatementProperties")
    .withIndex("by_property_and_status", (q) => q.eq("propertyId", propertyId).eq("status", "draft"))
    .first();
  return draft !== null && draft.orgId === orgId;
}

/** The decision for one property, from the database. */
export async function decideForProperty(ctx: Ctx, property: Doc<"properties">, data?: IdentityData): Promise<LinkDecision> {
  const d = data ?? (await loadIdentityData(ctx, property.orgId));
  const links = await linksOfPropertyRaw(ctx, property.orgId, property._id);
  return decidePropertyLink({
    property: { id: property._id, ownerName: property.ownerName, ownerEmails: ownerEmailsOf(property) },
    owners: d.owners,
    linkedOwnerIds: links.map((l) => l.ownerId),
    hasOpenDraft: await propertyHasOpenDraft(ctx, property.orgId, property._id),
    dismissed: d.dismissals,
  });
}

/** True when the owner name or the owner emails differ between two versions of a property. */
export function ownerIdentityChanged(
  before: { ownerName?: string; ownerEmail?: string; ownerEmails?: string[] } | null,
  after: { ownerName?: string; ownerEmail?: string; ownerEmails?: string[] },
): boolean {
  const key = (p: { ownerName?: string; ownerEmail?: string; ownerEmails?: string[] } | null): string =>
    p === null ? "" : `${normalizeNameKey(p.ownerName ?? "")}|${ownerEmailsOf(p).join(",")}`;
  return key(before) !== key(after);
}

export type LinkOutcome = LinkDecision["kind"] | "error";

export type LinkOpts = {
  source: "manual" | "sheet_import";
  actorUserId?: Id<"users">;
  /**
   * Owners + "Not the same owner" decisions loaded once for a whole batch (the roster import, the
   * bulk link). An owner created here is added to it, so the next property in the batch matches
   * it instead of creating a second one. Omitted = loaded for this one property.
   */
  data?: IdentityData;
  /** Appended to the audit notes, e.g. "Link all exact matches". */
  via?: string;
};

/** Adds an owner written in this transaction to a preloaded batch context. */
function remember(data: IdentityData | undefined, owner: Doc<"owners"> | null): void {
  if (!data || !owner) return;
  data.owners.push(toIdOwner(owner));
  data.ownerDocs.set(owner._id, owner);
}

/**
 * Carries out a "link" or "create" decision for a property: links the owner, or creates the
 * owner (its properties use the default management fee) and links it, each with an audit row. Returns the owner id.
 */
export async function applyLinkDecision(
  ctx: MutationCtx,
  property: Doc<"properties">,
  decision: Extract<LinkDecision, { kind: "link" | "create" }>,
  opts: LinkOpts,
): Promise<Id<"owners">> {
  const orgId = property.orgId;
  const now = Date.now();
  const via = opts.via ? ` (${opts.via})` : "";
  let ownerId: Id<"owners">;
  let note: string;
  if (decision.kind === "link") {
    ownerId = decision.ownerId as Id<"owners">;
    note = `auto-linked: name + email match${via}`;
  } else {
    ownerId = await ctx.db.insert("owners", {
      orgId,
      legalName: decision.legalName,
      nameKey: normalizeNameKey(decision.legalName),
      emails: decision.emails,
      active: true,
      source: opts.source,
      createdFromPropertyId: property._id,
      ...(opts.actorUserId ? { createdBy: opts.actorUserId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    remember(opts.data, await ctx.db.get(ownerId));
    await writeAudit(ctx, {
      orgId,
      entity: "owner",
      entityId: ownerId,
      action: "owner_created",
      ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}),
      // Counts only: owner emails never go into the audit trail.
      to: JSON.stringify({ legalName: decision.legalName, emails: decision.emails.length }),
      note: `auto-created from ${property.name}: no owner had this name or email${via}`,
    });
    note = `auto-linked: new owner from the property's owner name + email${via}`;
  }
  await ctx.db.insert("ownerProperties", { orgId, ownerId, propertyId: property._id, createdAt: now, updatedAt: now });
  await writeAudit(ctx, {
    orgId,
    entity: "owner",
    entityId: ownerId,
    action: "owner_property_linked",
    ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}),
    to: property.name,
    note,
  });
  return ownerId;
}

/**
 * Links (or creates and links) the owner of a property when the identity rule is certain; does
 * nothing otherwise. `source` is the owners.source a newly created owner gets: "sheet_import"
 * from the roster import, "manual" from the Property page.
 */
export async function linkOwnerForProperty(ctx: MutationCtx, propertyId: Id<"properties">, opts: LinkOpts): Promise<LinkOutcome> {
  let property: Doc<"properties"> | null;
  let decision: LinkDecision;
  try {
    property = await ctx.db.get(propertyId);
    if (!property) return "error";
    decision = await decideForProperty(ctx, property, opts.data);
  } catch (e) {
    // Never fail the property save over the owner link: the property shows on "Needs an owner".
    console.error("linkOwnerForProperty: skipped", e instanceof Error ? e.message : "unknown error");
    return "error";
  }
  if (decision.kind !== "link" && decision.kind !== "create") return decision.kind;
  await applyLinkDecision(ctx, property, decision, opts);
  return decision.kind;
}

/** Owner-link outcomes of a batch, for an import summary. */
export type LinkTally = { linked: number; created: number; alreadyLinked: number; needsReview: number; errors: number };

export function emptyLinkTally(): LinkTally {
  return { linked: 0, created: 0, alreadyLinked: 0, needsReview: 0, errors: 0 };
}

export function tallyLink(t: LinkTally, outcome: LinkOutcome): void {
  if (outcome === "link") t.linked++;
  else if (outcome === "create") t.created++;
  else if (outcome === "linked") t.alreadyLinked++;
  else if (outcome === "error") t.errors++;
  else t.needsReview++;
}
