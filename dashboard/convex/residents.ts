import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, hasAnyRole, hasRole, requireAdminView } from "./authz";
import type { OrgContext } from "./authz";
import { amScope, canSeeUnit } from "./amScope";
import { requireE164, toE164 } from "./phone";
import { RESIDENT_SORT_DEFAULT, pageOf, residentsView } from "./tenantViews";

/**
 * Residents (F3): the tenant directory behind Sarah's caller-ID match and the Residents page.
 *
 * Read scope: the admin view and accountants see everyone, an asset manager only residents of
 * units they are the AM of, a technician none. Single-record reads answer null (not an error)
 * outside that scope so a probing client can't tell "exists, not yours" from "doesn't exist".
 * Writes are admin view only.
 */

const MAX_PHONES = 5;

// --- Helpers --------------------------------------------------------------

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ConvexError("Enter the resident's name.");
  if (name.length > 120) throw new ConvexError("Name is too long.");
  return name;
}

function cleanEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  if (!email) return undefined;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConvexError("That email address doesn't look right.");
  }
  return email;
}

function cleanLeaseEnd(raw: string | undefined): string | undefined {
  const d = raw?.trim();
  if (!d) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
    throw new ConvexError("Lease end must be a date like 2027-06-30.");
  }
  return d;
}

function cleanPhones(raw: string[]): string[] {
  if (raw.length > MAX_PHONES) throw new ConvexError(`Add at most ${MAX_PHONES} phone numbers per resident.`);
  const out = raw.map((p) => requireE164(p));
  return [...new Set(out)];
}

/** Resident in this team and inside the caller's read scope, or null. */
async function readable(
  ctx: QueryCtx | MutationCtx,
  org: OrgContext,
  id: Id<"residents">,
): Promise<{ resident: Doc<"residents">; unit: Doc<"units"> } | null> {
  const resident = await ctx.db.get(id);
  if (!resident || resident.orgId !== org.orgId) return null;
  const unit = await ctx.db.get(resident.unitId);
  if (!unit) return null;
  // Union of the roles held: admin / accountant read everyone, an AM their managed or covered units.
  if (hasAnyRole(org, "admin", "accountant")) return { resident, unit };
  if (hasRole(org, "asset_manager") && canSeeUnit(await amScope(ctx, org), unit._id)) return { resident, unit };
  return null;
}

async function syncPhones(ctx: MutationCtx, resident: Doc<"residents">, phones: string[]) {
  const existing = await ctx.db
    .query("residentPhones")
    .withIndex("by_resident", (q) => q.eq("residentId", resident._id))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  if (!resident.active) return;
  for (const phone of phones) {
    await ctx.db.insert("residentPhones", { orgId: resident.orgId, residentId: resident._id, phone });
  }
}

async function present(ctx: QueryCtx, rows: Array<{ resident: Doc<"residents">; unit: Doc<"units"> }>) {
  const properties = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.unit.propertyId))) {
    properties.set(id, (await ctx.db.get(id))?.name ?? "Unknown");
  }
  return rows.map(({ resident, unit }) => ({
    ...resident,
    unitNumber: unit.unitNumber,
    propertyId: unit.propertyId,
    propertyName: properties.get(unit.propertyId) ?? "Unknown",
  }));
}

// --- Reads ----------------------------------------------------------------

/**
 * Every resident the caller may read (no cap, so nothing is silently cut), or null when their
 * view has no resident access. The admin view and accountants see the whole team; an asset
 * manager only residents of units they manage or cover (read-only), taken from the session user
 * and never from a client-supplied id.
 */
async function readableResidents(ctx: QueryCtx, org: OrgContext): Promise<Doc<"residents">[] | null> {
  if (hasAnyRole(org, "admin", "accountant")) {
    return await ctx.db
      .query("residents")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
  }
  if (hasRole(org, "asset_manager")) {
    const scope = await amScope(ctx, org);
    const residents: Doc<"residents">[] = [];
    for (const unitId of [...scope.managed, ...scope.covering]) {
      residents.push(
        ...(await ctx.db
          .query("residents")
          .withIndex("by_unit", (q) => q.eq("unitId", unitId))
          .collect()),
      );
    }
    return residents;
  }
  return null;
}

export const list = query({
  args: {
    propertyId: v.optional(v.id("properties")),
    unitId: v.optional(v.id("units")),
    search: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const residents = await readableResidents(ctx, org);
    if (!residents) return [];

    const units = new Map<string, Doc<"units">>();
    const rows: Array<{ resident: Doc<"residents">; unit: Doc<"units"> }> = [];
    const needle = args.search?.trim().toLowerCase();
    const needleDigits = needle?.replace(/\D/g, "");
    for (const resident of residents) {
      if (!args.includeInactive && !resident.active) continue;
      if (args.unitId && resident.unitId !== args.unitId) continue;
      let unit = units.get(resident.unitId);
      if (!unit) {
        const found = await ctx.db.get(resident.unitId);
        if (!found) continue;
        unit = found;
        units.set(resident.unitId, unit);
      }
      if (args.propertyId && unit.propertyId !== args.propertyId) continue;
      if (
        needle &&
        !resident.fullName.toLowerCase().includes(needle) &&
        !unit.unitNumber.toLowerCase().includes(needle) &&
        !(needleDigits && resident.phones.some((p) => p.includes(needleDigits)))
      ) {
        continue;
      }
      rows.push({ resident, unit });
    }
    rows.sort((a, b) => a.resident.fullName.localeCompare(b.resident.fullName));
    return await present(ctx, rows);
  },
});

/**
 * One page of the Residents tab: the same read scope as `list` (checked first, same rules), then
 * search / status / property / team filters and a sort over the WHOLE scoped set, so `total` is
 * the true count and no resident is cut off. Sort defaults to name A-Z; status to active only.
 */
export const listPage = query({
  args: {
    propertyId: v.optional(v.id("properties")),
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"), v.literal("all"))),
    team: v.optional(v.union(v.literal("gold"), v.literal("silver"), v.literal("make_up"))),
    sortKey: v.optional(v.union(v.literal("name"), v.literal("unit"), v.literal("lease"), v.literal("status"))),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    const residents = org ? await readableResidents(ctx, org) : null;
    if (!org || !residents) {
      return { ...pageOf<ResidentPageRow>([], 1, args.pageSize), showPhones: false, showEmail: false };
    }

    const units = new Map<string, Doc<"units"> | null>();
    const properties = new Map<string, Doc<"properties"> | null>();
    const all: ResidentPageRow[] = [];
    for (const resident of residents) {
      let unit = units.get(resident.unitId);
      if (unit === undefined) {
        unit = await ctx.db.get(resident.unitId);
        units.set(resident.unitId, unit);
      }
      if (!unit) continue;
      let property = properties.get(unit.propertyId);
      if (property === undefined) {
        property = await ctx.db.get(unit.propertyId);
        properties.set(unit.propertyId, property);
      }
      all.push({
        ...resident,
        unitNumber: unit.unitNumber,
        propertyId: unit.propertyId,
        propertyName: property?.name ?? "Unknown",
        category: property?.category,
      });
    }

    const filtered = residentsView(all, {
      q: args.search,
      status: args.status,
      propertyId: args.propertyId,
      team: args.team,
      sort: { key: args.sortKey ?? RESIDENT_SORT_DEFAULT.key, dir: args.sortDir ?? RESIDENT_SORT_DEFAULT.dir },
    });
    return {
      ...pageOf(filtered, args.page, args.pageSize),
      // Whether any resident in the filtered list has these details (columns stay steady across pages).
      showPhones: filtered.some((r) => r.phones.length > 0),
      showEmail: filtered.some((r) => !!r.email),
    };
  },
});

type ResidentPageRow = Doc<"residents"> & {
  unitNumber: string;
  propertyId: Id<"properties">;
  propertyName: string;
  category: Doc<"properties">["category"];
};

export const get = query({
  args: { residentId: v.id("residents") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const found = await readable(ctx, org, args.residentId);
    if (!found) return null;
    return (await present(ctx, [found]))[0];
  },
});

/** Active residents whose number matches (E.164-normalised). Shared by matchByPhone and routing. */
export async function findResidentsByPhone(ctx: QueryCtx | MutationCtx, orgId: string, rawPhone: string) {
  const phone = toE164(rawPhone);
  if (!phone) return [];
  const rows = await ctx.db
    .query("residentPhones")
    .withIndex("by_org_and_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
    .take(10);
  const out: Array<{ residentId: Id<"residents">; unitId: Id<"units">; fullName: string }> = [];
  for (const row of rows) {
    const resident = await ctx.db.get(row.residentId);
    if (resident?.active) {
      out.push({ residentId: resident._id, unitId: resident.unitId, fullName: resident.fullName });
    }
  }
  return out;
}

/**
 * Caller ID -> active residents with that number, for the routing step. Server-side only
 * (no signed-in caller), so orgId is trusted here and nowhere a client can reach.
 */
export const matchByPhone = internalQuery({
  args: { orgId: v.string(), phone: v.string() },
  handler: async (ctx, args) => await findResidentsByPhone(ctx, args.orgId, args.phone),
});

/** A unit's label when it belongs to this org, else null. Used to cross-check a caller-ID match. */
export const unitLabelOf = internalQuery({
  args: { orgId: v.string(), unitId: v.id("units") },
  handler: async (ctx, args): Promise<string | null> => {
    const unit = await ctx.db.get(args.unitId);
    return unit && unit.orgId === args.orgId ? unit.unitNumber : null;
  },
});

/** A spoken unit within an already-matched property: its id, label and the building's name. */
export const unitInProperty = internalQuery({
  args: { orgId: v.string(), propertyId: v.id("properties"), unitKey: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== args.orgId) return null;
    const unit = await ctx.db
      .query("units")
      .withIndex("by_property_and_unit_key", (q) =>
        q.eq("propertyId", args.propertyId).eq("unitNumberKey", args.unitKey),
      )
      .first();
    if (!unit || unit.orgId !== args.orgId) return null;
    return { unitId: unit._id, unitLabel: unit.unitNumber, propertyName: property.name };
  },
});

// --- Writes ---------------------------------------------------------------

export const create = mutation({
  args: {
    unitId: v.id("units"),
    fullName: v.string(),
    phones: v.array(v.string()),
    email: v.optional(v.string()),
    leaseEnd: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"residents">> => {
    const org = await requireAdminView(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");

    const phones = cleanPhones(args.phones);
    const id = await ctx.db.insert("residents", {
      orgId: org.orgId,
      unitId: unit._id,
      fullName: cleanName(args.fullName),
      phones,
      email: cleanEmail(args.email),
      leaseEnd: cleanLeaseEnd(args.leaseEnd),
      active: true,
      source: "manual",
      updatedAt: Date.now(),
    });
    const resident = (await ctx.db.get(id))!;
    await syncPhones(ctx, resident, phones);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "resident",
      entityId: id,
      action: "resident_created",
      actorUserId: org.user._id,
      to: unit.unitNumber,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    residentId: v.id("residents"),
    unitId: v.optional(v.id("units")),
    fullName: v.optional(v.string()),
    phones: v.optional(v.array(v.string())),
    email: v.optional(v.string()),
    clearEmail: v.optional(v.boolean()),
    leaseEnd: v.optional(v.string()),
    clearLeaseEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const resident = await ctx.db.get(args.residentId);
    if (!resident || resident.orgId !== org.orgId) throw new ConvexError("Resident not found.");

    // Fields are copied one by one so nothing else the client sends (an orgId, `active`,
    // `source`) can reach the row.
    const patch: Partial<Doc<"residents">> = { updatedAt: Date.now() };
    if (args.unitId !== undefined) {
      const unit = await ctx.db.get(args.unitId);
      if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");
      patch.unitId = unit._id;
    }
    if (args.fullName !== undefined) patch.fullName = cleanName(args.fullName);
    if (args.phones !== undefined) patch.phones = cleanPhones(args.phones);
    if (args.clearEmail) patch.email = undefined;
    else if (args.email !== undefined) patch.email = cleanEmail(args.email);
    if (args.clearLeaseEnd) patch.leaseEnd = undefined;
    else if (args.leaseEnd !== undefined) patch.leaseEnd = cleanLeaseEnd(args.leaseEnd);

    await ctx.db.patch(resident._id, patch);
    if (patch.phones) await syncPhones(ctx, { ...resident, ...patch } as Doc<"residents">, patch.phones);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "resident",
      entityId: resident._id,
      action: "resident_updated",
      actorUserId: org.user._id,
    });
  },
});

/**
 * Roster import (B3): makes the unit's roster residents match the roster's tenant names. Names
 * only, no phones, source "roster_import". Matched by exact name on the unit, so a re-run with
 * the same names writes nothing. A name no longer listed is deactivated (never deleted); a name
 * listed again is reactivated. Residents added by hand (source "manual") are never touched.
 * The caller has already validated the names (rosterMapping.mapRosterRow).
 */
export async function syncRosterResidents(
  ctx: MutationCtx,
  args: { orgId: string; unit: Doc<"units">; names: string[]; leaseEnd: string | undefined; note: string },
): Promise<{ created: number; updated: number; deactivated: number; unchanged: number }> {
  const existing = (
    await ctx.db
      .query("residents")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unit._id))
      .collect()
  ).filter((r) => r.orgId === args.orgId && r.source === "roster_import");
  const counts = { created: 0, updated: 0, deactivated: 0, unchanged: 0 };
  const now = Date.now();

  for (const fullName of args.names) {
    const match = existing.find((r) => r.fullName === fullName);
    if (!match) {
      const id = await ctx.db.insert("residents", {
        orgId: args.orgId,
        unitId: args.unit._id,
        fullName,
        phones: [],
        leaseEnd: args.leaseEnd,
        active: true,
        source: "roster_import",
        updatedAt: now,
      });
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: "resident",
        entityId: id,
        action: "resident_created",
        to: args.unit.unitNumber,
        note: args.note,
      });
      counts.created += 1;
      continue;
    }
    if (match.active && match.leaseEnd === args.leaseEnd) {
      counts.unchanged += 1;
      continue;
    }
    await ctx.db.patch(match._id, { active: true, leaseEnd: args.leaseEnd, updatedAt: now });
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "resident",
      entityId: match._id,
      action: match.active ? "resident_updated" : "resident_reactivated",
      note: args.note,
    });
    counts.updated += 1;
  }

  for (const r of existing) {
    if (!r.active || args.names.includes(r.fullName)) continue;
    await ctx.db.patch(r._id, { active: false, updatedAt: now });
    await syncPhones(ctx, { ...r, active: false }, []);
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "resident",
      entityId: r._id,
      action: "resident_deactivated",
      note: `${args.note}: no longer on the roster`,
    });
    counts.deactivated += 1;
  }
  return counts;
}

/** Moved out / removed. Keeps the row (history points at it) but drops its phones from lookup. */
export const deactivate = mutation({
  args: { residentId: v.id("residents") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const resident = await ctx.db.get(args.residentId);
    if (!resident || resident.orgId !== org.orgId) throw new ConvexError("Resident not found.");
    if (!resident.active) return;

    await ctx.db.patch(resident._id, { active: false, updatedAt: Date.now() });
    await syncPhones(ctx, { ...resident, active: false }, []);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "resident",
      entityId: resident._id,
      action: "resident_deactivated",
      actorUserId: org.user._id,
    });
  },
});
