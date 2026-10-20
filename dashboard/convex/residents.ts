import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, requireAdminView, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { amScope, canSeeUnit } from "./amScope";
import { requireE164, toE164 } from "./phone";

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
  if (!name) throw new Error("Enter the resident's name.");
  if (name.length > 120) throw new Error("Name is too long.");
  return name;
}

function cleanEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  if (!email) return undefined;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("That email address doesn't look right.");
  }
  return email;
}

function cleanLeaseEnd(raw: string | undefined): string | undefined {
  const d = raw?.trim();
  if (!d) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
    throw new Error("Lease end must be a date like 2027-06-30.");
  }
  return d;
}

function cleanPhones(raw: string[]): string[] {
  if (raw.length > MAX_PHONES) throw new Error(`At most ${MAX_PHONES} phone numbers.`);
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
  const view = viewFor(org.isAdmin, org.jobRoles);
  if (view === "admin" || view === "accountant") return { resident, unit };
  if (view === "asset_manager" && canSeeUnit(await amScope(ctx, org), unit._id)) return { resident, unit };
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
    const view = viewFor(org.isAdmin, org.jobRoles);

    let residents: Doc<"residents">[];
    if (view === "admin" || view === "accountant") {
      residents = await ctx.db
        .query("residents")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .take(2000);
    } else if (view === "asset_manager") {
      // Scope comes from the units this user manages, never from a client-supplied id.
      // Managed units plus the ones they cover while a colleague is out (read-only).
      const scope = await amScope(ctx, org);
      residents = [];
      for (const unitId of [...scope.managed, ...scope.covering]) {
        residents.push(
          ...(await ctx.db
            .query("residents")
            .withIndex("by_unit", (q) => q.eq("unitId", unitId))
            .collect()),
        );
      }
    } else {
      return [];
    }

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
    if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");

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
    if (!resident || resident.orgId !== org.orgId) throw new Error("Resident not found.");

    // Fields are copied one by one so nothing else the client sends (an orgId, `active`,
    // `source`) can reach the row.
    const patch: Partial<Doc<"residents">> = { updatedAt: Date.now() };
    if (args.unitId !== undefined) {
      const unit = await ctx.db.get(args.unitId);
      if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");
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

/** Moved out / removed. Keeps the row (history points at it) but drops its phones from lookup. */
export const deactivate = mutation({
  args: { residentId: v.id("residents") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const resident = await ctx.db.get(args.residentId);
    if (!resident || resident.orgId !== org.orgId) throw new Error("Resident not found.");
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
