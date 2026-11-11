import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { syncRosterResidents } from "./residents";
import { assertValidAssetManager, upsertRosterUnit } from "./units";
import { availableUnitsFor, findUnitFor } from "./sarahTools";
import {
  assertSameProperty,
  categoryValidator,
  diffSheetRow,
  mapRosterRow,
  rosterRowValidator,
  toSheetRow,
} from "./rosterMapping";
import type { Category, MappedProperty, MappedRow, MappedSourceRow } from "./rosterMapping";

/**
 * Client unit roster importer (backlog B3). Driven by scripts/roster/import_roster.py, which
 * converts one tab of docs/rosters/518-unit-rosters-normalized.xlsx to JSON and calls
 * `importProperties` in batches of whole properties via `npx convex run`.
 *
 * Internal only: nothing here is reachable from a browser. The org and the asset manager are
 * arguments because the CLI has no signed-in user; the asset manager is still validated with the
 * same rule as every other unit write (a member of this team with the asset_manager job role).
 *
 * Idempotent: each roster row is keyed by (org, category, Row ID) in unitSourceRows, which points
 * at the property and unit it produced. A re-run patches only what changed and writes nothing
 * (no audit row either) for a row that is already up to date.
 *
 * Dry run: the same code path runs and then throws a ConvexError carrying the summary, so the
 * whole transaction rolls back. What a dry run reports is exactly what a real run would do. It
 * also carries what the rows would read back as (for the lossless check), what Sarah's
 * check_availability would offer and the answers to any find_unit probes, all as of the
 * not-yet-committed state, so the import can be verified before anything is written.
 */

type Counts = { created: number; updated: number; unchanged: number };
const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });

const CATEGORY_NAME: Record<Category, string> = { gold: "Gold", silver: "Silver", make_up: "Make Up" };

async function sourceRowFor(ctx: QueryCtx | MutationCtx, orgId: string, category: Category, rowId: string) {
  return await ctx.db
    .query("unitSourceRows")
    .withIndex("by_org_category_row", (q) => q.eq("orgId", orgId).eq("category", category).eq("rowId", rowId))
    .unique();
}

/** The building a group of rows belongs to: through provenance first, then by roster name. */
async function resolveProperty(
  ctx: MutationCtx,
  orgId: string,
  category: Category,
  rows: MappedRow[],
  sources: Array<Doc<"unitSourceRows"> | null>,
): Promise<Doc<"properties"> | null> {
  const name = rows[0].property.name;
  const linked = new Set(sources.filter((s) => s !== null).map((s) => s!.propertyId));
  if (linked.size > 1) {
    throw new ConvexError(`Rows of "${name}" were imported into ${linked.size} different properties; fix that by hand first.`);
  }
  if (linked.size === 1) {
    const property = await ctx.db.get([...linked][0]);
    if (!property || property.orgId !== orgId) {
      throw new ConvexError(`The property "${name}" was imported before but no longer exists; it will not be recreated silently.`);
    }
    return property;
  }
  const byName = (
    await ctx.db
      .query("properties")
      .withIndex("by_org_and_category", (q) => q.eq("orgId", orgId).eq("category", category))
      .collect()
  ).filter((p) => p.name === name);
  if (byName.length > 1) throw new ConvexError(`There are ${byName.length} ${CATEGORY_NAME[category]} properties named "${name}".`);
  return byName[0] ?? null;
}

function desiredProperty(p: MappedProperty, existing: Doc<"properties"> | null) {
  const fields: Partial<Doc<"properties">> = {
    name: p.name,
    category: p.category,
    ownership: p.ownership,
    selling: p.selling,
    city: p.city,
    sourceSection: p.sourceSection,
    intendedAssetManagerName: p.intendedAssetManagerName,
  };
  // The roster gives text only. An address someone later picked from Google Places (it has a
  // placeId) is better than the roster's and is never overwritten.
  if (!existing?.address || existing.address.placeId === undefined) {
    fields.address = { formatted: p.addressFormatted };
  }
  // Owners (user decision 2026-11-03) are written only when the sheet states them, so an owner
  // typed on the Property page for a building whose sheet cells are still empty (all of Gold and
  // Silver today) is never wiped by a re-import. ownerEmail stays the first address so existing
  // readers keep working; ownerEmails holds every address, lowercase.
  if (p.ownerName !== undefined) fields.ownerName = p.ownerName;
  if (p.ownerEmails !== undefined) {
    fields.ownerEmails = p.ownerEmails;
    fields.ownerEmail = p.ownerEmails[0];
  }
  return fields;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function upsertProperty(
  ctx: MutationCtx,
  orgId: string,
  amUserId: Id<"users">,
  p: MappedProperty,
  existing: Doc<"properties"> | null,
  note: string,
): Promise<{ property: Doc<"properties">; action: keyof Counts }> {
  const fields = desiredProperty(p, existing);
  if (!existing) {
    const id = await ctx.db.insert("properties", {
      orgId,
      userId: amUserId,
      name: p.name,
      // Legacy per-type leasing summary; units now live in the units table.
      units: [],
      // petsAllowed / moveInWindowDays deliberately left unset: the roster states neither.
      defaultAssetManagerUserId: amUserId,
      ...fields,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, { orgId, entity: "property", entityId: id, action: "property_created", to: p.name, note });
    return { property: (await ctx.db.get(id))!, action: "created" };
  }
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!sameValue(value, existing[key as keyof Doc<"properties">])) {
      patch[key] = value;
      changed.push(key);
    }
  }
  if (changed.length === 0) return { property: existing, action: "unchanged" };
  await ctx.db.patch(existing._id, { ...(patch as Partial<Doc<"properties">>), updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId,
    entity: "property",
    entityId: existing._id,
    action: "property_updated",
    note: `${note}: ${changed.join(", ")}`,
  });
  return { property: (await ctx.db.get(existing._id))!, action: "updated" };
}

async function upsertSourceRow(
  ctx: MutationCtx,
  orgId: string,
  source: MappedSourceRow,
  propertyId: Id<"properties">,
  unitId: Id<"units">,
  existing: Doc<"unitSourceRows"> | null,
): Promise<keyof Counts> {
  const desired = { ...source, propertyId, unitId };
  if (!existing) {
    await ctx.db.insert("unitSourceRows", { orgId, ...desired, updatedAt: Date.now() });
    return "created";
  }
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(desired) as Array<keyof typeof desired>) {
    if (desired[key] !== existing[key]) patch[key] = desired[key];
  }
  // Keys present on the stored row but absent now (a cell that was emptied) are cleared too.
  for (const key of Object.keys(existing)) {
    if (key.startsWith("_") || key === "orgId" || key === "updatedAt") continue;
    if (!(key in desired) || desired[key as keyof typeof desired] === undefined) {
      if (existing[key as keyof Doc<"unitSourceRows">] !== undefined) patch[key] = undefined;
    }
  }
  if (Object.keys(patch).length === 0) return "unchanged";
  await ctx.db.patch(existing._id, { ...(patch as Partial<Doc<"unitSourceRows">>), updatedAt: Date.now() });
  return "updated";
}

type ImportArgs = {
  orgId: string;
  category: Category;
  assetManagerUserId: Id<"users">;
  dryRun: boolean;
};

/** One pass over the batch's property groups. Returns what it created, changed or left alone. */
async function importOnce(ctx: MutationCtx, args: ImportArgs, groups: Map<string, MappedRow[]>) {
  const summary = {
    dryRun: args.dryRun,
    properties: zero(),
    units: zero(),
    unitsChanged: [] as string[],
    sourceRows: zero(),
    residents: { created: 0, updated: 0, deactivated: 0, unchanged: 0 },
    available: [] as string[],
  };
  const resolvedIds = new Set<string>();

  for (const [name, rows] of groups) {
    const prop = assertSameProperty(rows);
    const sources = await Promise.all(rows.map((r) => sourceRowFor(ctx, args.orgId, args.category, r.rowId)));
    const existing = await resolveProperty(ctx, args.orgId, args.category, rows, sources);
    if (existing && resolvedIds.has(existing._id)) {
      throw new ConvexError(`"${name}" resolves to a property another group in this batch also uses.`);
    }
    const note = `Roster import (${CATEGORY_NAME[args.category]})`;
    const { property, action } = await upsertProperty(ctx, args.orgId, args.assetManagerUserId, prop, existing, note);
    resolvedIds.add(property._id);
    summary.properties[action] += 1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const source = sources[i];
      let unit: Doc<"units"> | null = null;
      if (source) {
        unit = await ctx.db.get(source.unitId);
        if (!unit) {
          throw new ConvexError(`${row.rowId}: its unit was deleted after the last import; it will not be recreated silently.`);
        }
      }
      const rowNote = `Roster import ${row.rowId}`;
      const result = await upsertRosterUnit(ctx, {
        orgId: args.orgId,
        propertyId: property._id,
        existing: unit,
        fields: row.unit,
        assetManagerUserId: args.assetManagerUserId,
        note: rowNote,
      });
      summary.units[result.action] += 1;
      if (result.action === "updated") summary.unitsChanged.push(`${row.rowId}: ${result.changed.join(", ")}`);
      if (row.unit.available) summary.available.push(`${name} ${row.unit.unitNumber}`);

      const saved = (await ctx.db.get(result.unitId))!;
      const r = await syncRosterResidents(ctx, {
        orgId: args.orgId,
        unit: saved,
        names: row.tenants,
        leaseEnd: row.unit.leaseEnd,
        note: rowNote,
      });
      summary.residents.created += r.created;
      summary.residents.updated += r.updated;
      summary.residents.deactivated += r.deactivated;
      summary.residents.unchanged += r.unchanged;

      summary.sourceRows[await upsertSourceRow(ctx, args.orgId, row.source, property._id, result.unitId, source)] += 1;
    }
  }
  return summary;
}

export const importProperties = internalMutation({
  args: {
    orgId: v.string(),
    category: categoryValidator,
    assetManagerUserId: v.id("users"),
    rows: v.array(rosterRowValidator),
    dryRun: v.boolean(),
    // Dry run only: spoken address + unit pairs to resolve with Sarah's find_unit logic.
    probes: v.optional(v.array(v.object({ spokenAddress: v.string(), spokenUnit: v.string() }))),
  },
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    if (!orgId || !(await ctx.db.get(orgId))) throw new ConvexError("That team does not exist.");
    if (args.rows.length === 0) throw new ConvexError("No roster rows were sent.");
    // Same rule as every unit write; fails loudly if the person is not an AM on this team.
    await assertValidAssetManager(ctx, args.orgId, args.assetManagerUserId);

    const mapped = args.rows.map((row) => mapRosterRow(row, args.category));
    const seen = new Set<string>();
    for (const m of mapped) {
      if (seen.has(m.rowId)) throw new ConvexError(`${m.rowId} is in the batch twice.`);
      seen.add(m.rowId);
    }
    const groups = new Map<string, MappedRow[]>();
    for (const m of mapped) groups.set(m.property.name, [...(groups.get(m.property.name) ?? []), m]);

    const summary = await importOnce(ctx, args, groups);
    // Building -> the address it is stored with (no owner or resident data).
    const addresses = [...groups.values()].map((rows) => ({
      property: rows[0].property.name,
      formatted: rows[0].property.addressFormatted,
    }));

    if (args.dryRun) {
      // Re-run in the same transaction: an idempotent importer must find nothing left to do.
      const secondPass = await importOnce(ctx, args, groups);
      // Lossless check against the rows as sent (the sheet itself), inside the transaction.
      const diffs: string[] = [];
      for (const row of args.rows) {
        const source = (await sourceRowFor(ctx, args.orgId, args.category, String(row.rowId)))!;
        for (const key of diffSheetRow(row, await sheetRowFor(ctx, source))) diffs.push(`${row.rowId} ${key}`);
      }
      const lossless = { rows: args.rows.length, cells: args.rows.length * Object.keys(args.rows[0]).length, diffs };
      const offered = await availableUnitsFor(ctx, args.orgId);
      const probes = [];
      for (const p of args.probes ?? []) probes.push({ ...p, ...(await findUnitFor(ctx, { orgId: args.orgId, ...p })) });
      // Rolls the whole transaction back; the CLI prints this data.
      throw new ConvexError({ kind: "dry_run", summary, secondPass, lossless, offered: offered.available, probes, addresses });
    }
    return summary;
  },
});

async function sheetRowFor(ctx: QueryCtx, s: Doc<"unitSourceRows">) {
  const unit = await ctx.db.get(s.unitId);
  const property = await ctx.db.get(s.propertyId);
  if (!unit || !property) throw new ConvexError(`${s.rowId}: its unit or property is missing.`);
  const residents = (
    await ctx.db
      .query("residents")
      .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
      .collect()
  )
    .filter((r) => r.source === "roster_import" && r.active)
    .sort((a, b) => a._creationTime - b._creationTime);
  return toSheetRow(property, unit, residents, s);
}

/** The roster rebuilt from the database, in the sheet's columns, for the lossless check. */
export const exportRows = internalQuery({
  args: { orgId: v.string(), category: categoryValidator },
  handler: async (ctx, args) => {
    const sources = await ctx.db
      .query("unitSourceRows")
      .withIndex("by_org_category_row", (q) => q.eq("orgId", args.orgId).eq("category", args.category))
      .collect();
    const out = [];
    for (const s of sources) out.push(await sheetRowFor(ctx, s));
    return out;
  },
});

/** Counts for the import report. Names are never returned. */
export const stats = internalQuery({
  args: { orgId: v.string(), category: categoryValidator },
  handler: async (ctx, args) => {
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const units = await ctx.db
      .query("units")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const residents = await ctx.db
      .query("residents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const sourceRows = await ctx.db
      .query("unitSourceRows")
      .withIndex("by_org_category_row", (q) => q.eq("orgId", args.orgId).eq("category", args.category))
      .collect();
    const phones = await ctx.db
      .query("residentPhones")
      .withIndex("by_org_and_phone", (q) => q.eq("orgId", args.orgId))
      .collect();
    const inCategory = new Set(properties.filter((p) => p.category === args.category).map((p) => p._id));
    const catUnits = units.filter((u) => inCategory.has(u.propertyId));
    const catUnitIds = new Set(catUnits.map((u) => u._id));
    const roster = residents.filter((r) => r.source === "roster_import" && catUnitIds.has(r.unitId));
    const nameOf = new Map(properties.map((p) => [p._id, p.name]));
    const catProperties = properties.filter((p) => inCategory.has(p._id));
    const tally = (values: Array<string | undefined>) => {
      const t: Record<string, number> = {};
      for (const value of values) t[value ?? "-"] = (t[value ?? "-"] ?? 0) + 1;
      return t;
    };
    return {
      propertiesInOrg: properties.length,
      propertiesInCategory: inCategory.size,
      unitsInOrg: units.length,
      unitsInCategory: catUnits.length,
      availableInOrg: units.filter((u) => u.available).length,
      // This roster's available units only (verify compares it with the roster's expected list).
      available: catUnits.filter((u) => u.available).map((u) => `${nameOf.get(u.propertyId)} ${u.unitNumber}`).sort(),
      rosterResidentsActive: roster.filter((r) => r.active).length,
      rosterResidentsInactive: roster.filter((r) => !r.active).length,
      rosterResidentsWithAmpersand: roster.filter((r) => r.active && r.fullName.includes("&")).length,
      rosterResidentsWithPhones: roster.filter((r) => r.phones.length > 0).length,
      residentPhonesForRosterResidents: phones.filter((p) => roster.some((r) => r._id === p.residentId)).length,
      unitSourceRows: sourceRows.length,
      occupancy: tally(catUnits.map((u) => u.occupancy)),
      unitType: tally(catUnits.map((u) => u.unitType)),
      leaseType: tally(catUnits.map((u) => u.leaseType)),
      bedrooms: tally(catUnits.map((u) => u.bedrooms)),
      ownership: tally(catProperties.map((p) => p.ownership)),
      // Owner coverage only, never the names or addresses.
      propertiesWithOwnerName: catProperties.filter((p) => p.ownerName).length,
      ownerEmailsPerProperty: tally(catProperties.map((p) => String(p.ownerEmails?.length ?? (p.ownerEmail ? 1 : 0)))),
      ownerEmailIsFirstOfOwnerEmails: catProperties.filter((p) => p.ownerEmails && p.ownerEmail === p.ownerEmails[0]).length,
      intendedAssetManager: tally(properties.filter((p) => inCategory.has(p._id)).map((p) => p.intendedAssetManagerName)),
      assetManagerUserIds: tally(catUnits.map((u) => u.assetManagerUserId)),
      defaultAssetManagerUserIds: tally(properties.filter((p) => inCategory.has(p._id)).map((p) => p.defaultAssetManagerUserId)),
      petsOrMoveInSet: properties
        .filter((p) => inCategory.has(p._id) && (p.petsAllowed !== undefined || p.moveInWindowDays !== undefined))
        .length,
    };
  },
});

/**
 * One-off cleanup before the first roster import: removes a property only when nothing points
 * at it (no units, no import provenance, no maintenance request or work order). The caller names
 * the property it expects, so a wrong id fails instead of deleting something else. Audit rows
 * that mention the property stay: the audit trail is append-only.
 */
export const removeUnreferencedProperty = internalMutation({
  args: { orgId: v.string(), propertyId: v.id("properties"), expectedName: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== args.orgId) throw new ConvexError("Property not found.");
    if (property.name !== args.expectedName) {
      throw new ConvexError(`That property is "${property.name}", not "${args.expectedName}".`);
    }
    const unit = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .first();
    if (unit) throw new ConvexError("That property still has units.");
    const source = await ctx.db
      .query("unitSourceRows")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .first();
    if (source) throw new ConvexError("That property holds imported roster rows.");
    const requests = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_org_and_created", (q) => q.eq("orgId", args.orgId))
      .collect();
    if (requests.some((r) => r.propertyId === property._id)) throw new ConvexError("That property has maintenance requests.");
    const workOrders = await ctx.db
      .query("workOrders")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", args.orgId))
      .collect();
    if (workOrders.some((w) => w.propertyId === property._id)) throw new ConvexError("That property has work orders.");

    await ctx.db.delete(property._id);
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "property",
      entityId: property._id,
      action: "property_removed",
      from: property.name,
      note: "Demo property removed before the roster import",
    });
    return { removed: property.name };
  },
});
