import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { compactReport, planImport } from "./ownersImportLib";
import type { DbLink, DbOwner, DbProperty, ImportPlan, ImportReport } from "./ownersImportLib";

/**
 * Owners import (ROS WP4, spec 8.3) from the client's unit rosters. Driven by
 * scripts/owners/import_owners.mjs via `npx convex run`; it sends only the org and the mode.
 *
 * Source of truth: each property's ownerName / ownerEmails, written by the roster import
 * (convex/rosterImport.ts). Owners are identified by name + email (ownerIdentity.ts) across Gold,
 * Silver and Make Up; look-alikes are kept separate and flagged, never merged. A property that
 * already has an owner link is never given another. No address matching. Planning is in
 * ownersImportLib.ts (pure, tested).
 *
 * Internal only: nothing here is reachable from a browser. The org is an argument because the CLI
 * has no signed-in user; every audit row is written by "System".
 *
 * Idempotent: owners are matched by the identity rule. A re-run only fills empty fields (never
 * overwrites), only adds missing links, never removes anything, and never adds a link to a
 * property on an open statement draft. Payee names and contact names are never written, and links
 * get no fee (the property then uses the org default fee, feeSettings.ts).
 *
 * Dry run: the same code runs, then a second pass proves there is nothing left to do, then a
 * ConvexError carrying the report rolls the whole transaction back. Emails in the report are masked.
 */

type Loaded = {
  properties: DbProperty[];
  owners: DbOwner[];
  links: DbLink[];
  draftPropertyIds: string[];
  dismissedOwnerPairs: string[];
  dismissedPropertyOwner: string[];
};

async function load(ctx: MutationCtx, orgId: string): Promise<Loaded> {
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const owners = await ctx.db
    .query("owners")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const links = await ctx.db
    .query("ownerProperties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const dismissals = await ctx.db
    .query("ownerIdentityDismissals")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const draftPropertyIds: string[] = [];
  for (const p of properties) {
    const draft = await ctx.db
      .query("ownerStatementProperties")
      .withIndex("by_property_and_status", (q) => q.eq("propertyId", p._id).eq("status", "draft"))
      .first();
    if (draft) draftPropertyIds.push(p._id);
  }
  return {
    properties: properties.map((p: Doc<"properties">) => {
      const out: DbProperty = { id: p._id, name: p.name };
      if (p.category !== undefined) out.category = p.category;
      if (p.ownership !== undefined) out.ownership = p.ownership;
      if (p.ownerName !== undefined) out.ownerName = p.ownerName;
      if (p.ownerEmails && p.ownerEmails.length > 0) out.ownerEmails = p.ownerEmails;
      else if (p.ownerEmail) out.ownerEmails = [p.ownerEmail];
      return out;
    }),
    owners: owners.map((o: Doc<"owners">) => {
      const out: DbOwner = { id: o._id, legalName: o.legalName, nameKey: o.nameKey, emails: o.emails, active: o.active };
      if (o.importKey !== undefined) out.importKey = o.importKey;
      if (o.mergedIntoOwnerId !== undefined) out.mergedIntoOwnerId = o.mergedIntoOwnerId;
      if (o.contactFirstName !== undefined) out.contactFirstName = o.contactFirstName;
      if (o.contactLastName !== undefined) out.contactLastName = o.contactLastName;
      return out;
    }),
    links: links.map((l: Doc<"ownerProperties">) => ({ ownerId: l.ownerId, propertyId: l.propertyId })),
    draftPropertyIds,
    dismissedOwnerPairs: dismissals.filter((d) => d.kind === "owner_pair").map((d) => d.key),
    dismissedPropertyOwner: dismissals.filter((d) => d.kind === "property_owner").map((d) => d.key),
  };
}

/** Carries out a plan. Returns nothing: the plan's report already says what was done. */
async function apply(ctx: MutationCtx, orgId: string, plan: ImportPlan): Promise<void> {
  const now = Date.now();
  const idByKey = new Map<string, Id<"owners">>();
  for (const op of plan.ownerOps) {
    if (op.kind === "create") {
      const f = op.fields;
      const id = await ctx.db.insert("owners", {
        orgId,
        legalName: f.legalName,
        nameKey: f.nameKey,
        emails: f.emails,
        active: true,
        source: "sheet_import",
        importKey: op.importKey,
        createdAt: now,
        updatedAt: now,
      });
      idByKey.set(op.importKey, id);
      await writeAudit(ctx, {
        orgId,
        entity: "owner",
        entityId: id,
        action: "owner_imported",
        to: JSON.stringify({ legalName: f.legalName, contactFirstName: null, contactLastName: null, emails: f.emails.length }),
        note: "Unit roster import",
      });
    } else {
      const id = op.ownerId as Id<"owners">;
      idByKey.set(op.importKey, id);
      if (op.kind === "patch") await ctx.db.patch(id, { ...op.patch, updatedAt: now });
    }
  }
  for (const link of plan.linkOps) {
    const ownerId = idByKey.get(link.importKey);
    if (!ownerId) throw new ConvexError(`Internal: no owner for "${link.importKey}".`);
    const propertyId = link.propertyId as Id<"properties">;
    // Belt and braces: the plan never adds a link to a property that already has one (to anyone).
    const existing = await ctx.db
      .query("ownerProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .first();
    if (existing) continue;
    await ctx.db.insert("ownerProperties", { orgId, ownerId, propertyId, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      orgId,
      entity: "owner",
      entityId: ownerId,
      action: "owner_property_linked",
      to: link.propertyName,
      note: "Unit roster import: name + email match",
    });
  }
}

async function runOnce(ctx: MutationCtx, orgId: string): Promise<ImportReport> {
  const plan = planImport(await load(ctx, orgId));
  await apply(ctx, orgId, plan);
  return plan.report;
}

export const importOwners = internalMutation({
  args: { orgId: v.string(), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    if (!orgId || !(await ctx.db.get(orgId))) throw new ConvexError("That team does not exist.");

    const report = await runOnce(ctx, args.orgId);
    if (args.dryRun) {
      // Re-run in the same transaction: an idempotent importer must find nothing left to do.
      const second = await runOnce(ctx, args.orgId);
      const secondPass = { owners: second.owners, links: second.links };
      // Rolls the whole transaction back; the CLI prints this data. Compact, because Convex cuts
      // error data at about 16 KB (compactReport keeps it under 12 KB).
      throw new ConvexError({ kind: "dry_run", dryRun: true, report: compactReport(report), secondPass });
    }
    if (report.invalid.length > 0) {
      // Rolls back: an owner the roster can't express correctly must be fixed first, not skipped.
      const names = report.invalid.map((i) => `${i.owner}: ${i.message}`).join("; ");
      throw new ConvexError(`Fix these roster owners first (nothing was written): ${names}`);
    }
    return report;
  },
});
