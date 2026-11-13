import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { isAdminView, requireAdminView, requireOrg, requireOrgAdmin, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { amScope } from "./amScope";
import { scheduleNotify } from "./notify";
import type { MappedUnitFields } from "./rosterMapping";
import { unitKey } from "./unitMatch";
import { businessToday, monthOf } from "./rosFormat";
import { bathroomsProblem, floorProblem, rosterRentProblem } from "./unitFieldsPolicy";
import { RENT_CHANGE_MSG, rentInEffect, upcomingRentChange } from "./unitRentPolicy";

/**
 * Units: the ONLY module that writes the `units` table.
 *
 * The hard rule is that every unit has exactly one designated asset manager. It is held in two
 * places that must stay together: `assetManagerUserId` is a required column (so an insert
 * without one is rejected by the schema), and every path that sets it goes through
 * assertValidAssetManager (so it can't point at someone who isn't an AM on this team). There is
 * deliberately no mutation that clears it — reassigning is the only way it changes.
 *
 * One exception, `rent`: once a unit has rent history it is written by unitRentLib.changeRent
 * (kept equal to the latest rent change). `update` refuses a rent edit; rent changes go through
 * unitRent.changeRent so the history (and the rent for each month) is kept.
 */

const MAX_BULK = 500;
const OPEN_REQUEST_STATUSES: Array<Doc<"maintenanceRequests">["status"]> = [
  "new",
  "under_review",
  "more_info_needed",
  "forwarded_to_pat",
];
const MAX_TEXT = 2000;

// --- Helpers --------------------------------------------------------------

/**
 * What a caller says ("apartment 4-B", "Unit #4b", "#4 B") and what is stored ("4B") should
 * compare equal, so matching and duplicate detection both run on this key instead of the
 * display string. Pure and exported so the voice tools can normalize the same way.
 */
export function normalizeUnitKey(s: string): string {
  // One implementation, in the pure matcher Sarah's find_unit also uses, so the two never drift.
  return unitKey(s);
}

/**
 * The rule's enforcement point. The target must be a member of THIS team and hold the
 * asset_manager job role; a user id from the client is never trusted on its own, and another
 * team's user (or a plain member) cannot be made an AM.
 */
export async function assertValidAssetManager(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  userId: Id<"users">,
): Promise<void> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (
    !membership ||
    membership.orgId !== orgId ||
    !(membership.jobRoles ?? []).includes("asset_manager")
  ) {
    throw new ConvexError("That person is not an asset manager on this team.");
  }
}

/** How many units this person is the asset manager for. Used by the team.ts removal guards. */
export async function countOwnedBy(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const owned = await ctx.db
    .query("units")
    .withIndex("by_asset_manager", (q) => q.eq("assetManagerUserId", userId))
    .collect();
  return owned.length;
}

/** Unit in this team, or the same "not found" whether it is missing or someone else's. */
async function ownUnit(ctx: QueryCtx | MutationCtx, org: OrgContext, unitId: Id<"units">) {
  const unit = await ctx.db.get(unitId);
  if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");
  return unit;
}

/** Field-level user error: the form marks `field` red and shows `message` under it and in a toast. */
function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}

/** The numeric unit fields (shared rules with the forms, unitFieldsPolicy.ts). */
function checkNumbers(args: { floor?: number; bathrooms?: number; rent?: number }): void {
  if (args.floor !== undefined) {
    const p = floorProblem(args.floor);
    if (p) throw fieldError("floor", p);
  }
  if (args.bathrooms !== undefined) {
    const p = bathroomsProblem(args.bathrooms);
    if (p) throw fieldError("bathrooms", p);
  }
  if (args.rent !== undefined) {
    const p = rosterRentProblem(args.rent);
    if (p) throw fieldError("rent", p);
  }
}

function cleanText(value: string, label: string, max = MAX_TEXT): string {
  const out = value.trim();
  if (out.length > max) throw new ConvexError(`${label} is too long.`);
  return out;
}

function requireUnitNumber(raw: string): { unitNumber: string; unitNumberKey: string } {
  const unitNumber = cleanText(raw, "Unit number", 40);
  const unitNumberKey = normalizeUnitKey(unitNumber);
  if (!unitNumber || !unitNumberKey) throw new ConvexError("Enter a unit number.");
  return { unitNumber, unitNumberKey };
}

async function assertNoDuplicate(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
  unitNumberKey: string,
  exceptId?: Id<"units">,
): Promise<void> {
  const dup = await ctx.db
    .query("units")
    .withIndex("by_property_and_unit_key", (q) =>
      q.eq("propertyId", propertyId).eq("unitNumberKey", unitNumberKey),
    )
    .first();
  if (dup && dup._id !== exceptId) throw new ConvexError("That unit already exists on this property.");
}

// --- Reads ----------------------------------------------------------------

/**
 * Units are visible to everyone on the team except a pure technician, who only needs the jobs
 * assigned to them. A member with no job role yet (not backfilled) is not locked out.
 */
function canViewUnits(org: OrgContext): boolean {
  const view = viewFor(org.isAdmin, org.jobRoles);
  return view !== "technician" && view !== "none";
}

async function withManagers(
  ctx: QueryCtx,
  org: OrgContext,
  units: Doc<"units">[],
  coveringIds: Set<Id<"units">>,
) {
  const names = new Map<string, string>();
  for (const id of new Set(units.map((u) => u.assetManagerUserId))) {
    const user = await ctx.db.get(id);
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    names.set(id, name || user?.email || "Unknown");
  }
  return units.map((u) => ({
    ...u,
    assetManagerName: names.get(u.assetManagerUserId) ?? "Unknown",
    // True for the units this person is the AM of (the ones they act on).
    isMine: u.assetManagerUserId === org.user._id,
    // True for an AM's read-only units: owned by a colleague who is out of office and named
    // this person to cover. Always false outside the AM view.
    covering: coveringIds.has(u._id),
  }));
}

/**
 * An asset manager sees only the units they manage plus the ones they cover (amScope); every
 * other role keeps the team-wide list. Returns the units to show and the covered ids.
 */
async function scopeForViewer(ctx: QueryCtx, org: OrgContext, units: Doc<"units">[]) {
  if (viewFor(org.isAdmin, org.jobRoles) !== "asset_manager") {
    return { units, coveringIds: new Set<Id<"units">>() };
  }
  const scope = await amScope(ctx, org);
  return {
    units: units.filter((u) => scope.managed.has(u._id) || scope.covering.has(u._id)),
    coveringIds: scope.covering,
  };
}

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canViewUnits(org)) throw new ConvexError("You don't have access to that.");
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) return [];
    const units = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const scoped = await scopeForViewer(ctx, org, units.filter((u) => u.orgId === org.orgId));
    return await withManagers(ctx, org, scoped.units, scoped.coveringIds);
  },
});

export const list = query({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canViewUnits(org)) throw new ConvexError("You don't have access to that.");
    const propertyId = args.propertyId;
    const units = propertyId
      ? await ctx.db
          .query("units")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect()
      : await ctx.db
          .query("units")
          .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
          .collect();
    // The by_property index isn't org-scoped, so filter: a client-supplied property id from
    // another team must come back empty.
    const scoped = await scopeForViewer(ctx, org, units.filter((u) => u.orgId === org.orgId));
    return await withManagers(ctx, org, scoped.units, scoped.coveringIds);
  },
});

/**
 * The rent each unit of a property has THIS month (its rent history, else the roster rent) and its
 * next change, for the property page's Rent/month column and unit drawer. Same access and scope as
 * listByProperty (an asset manager gets only the units they manage or cover). Money only, no names.
 */
export const rentSummary = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canViewUnits(org)) throw new ConvexError("You don't have access to that.");
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) return [];
    const units = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const scoped = await scopeForViewer(ctx, org, units.filter((u) => u.orgId === org.orgId));
    const month = monthOf(businessToday(Date.now()));
    const out = [];
    for (const u of scoped.units) {
      const changes = (
        await ctx.db
          .query("unitRentChanges")
          .withIndex("by_unit_and_month", (q) => q.eq("unitId", u._id))
          .collect()
      ).filter((c) => c.orgId === org.orgId);
      const now = rentInEffect(u, changes, month);
      const next = upcomingRentChange(changes, month);
      out.push({
        unitId: u._id,
        month,
        cents: now.cents,
        fromMonth: now.fromMonth,
        hasHistory: now.hasHistory,
        upcoming: next ? { month: next.effectiveMonth, cents: next.rentCents } : null,
      });
    }
    return out;
  },
});

/** For routing and notifications, which run server-side with no signed-in caller. */
export const forAssetManager = internalQuery({
  args: { assetManagerUserId: v.id("users") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("units")
      .withIndex("by_asset_manager", (q) => q.eq("assetManagerUserId", args.assetManagerUserId))
      .collect(),
});

// --- Writes ---------------------------------------------------------------

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    unitNumber: v.string(),
    // Omit to use the property's default asset manager; required when it has none.
    assetManagerUserId: v.optional(v.id("users")),
    floor: v.optional(v.number()),
    isTopFloor: v.optional(v.boolean()),
    bedrooms: v.string(),
    bathrooms: v.optional(v.number()),
    parking: v.optional(v.string()),
    rent: v.optional(v.number()),
    available: v.optional(v.boolean()),
    availableFrom: v.optional(v.string()),
    leasingFacts: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"units">> => {
    const org = await requireAdminView(ctx);

    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) throw new ConvexError("Property not found.");

    const { unitNumber, unitNumberKey } = requireUnitNumber(args.unitNumber);
    await assertNoDuplicate(ctx, args.propertyId, unitNumberKey);
    const assetManagerUserId = args.assetManagerUserId ?? property.defaultAssetManagerUserId;
    if (!assetManagerUserId) throw new ConvexError("Pick an asset manager for this unit.");
    await assertValidAssetManager(ctx, org.orgId, assetManagerUserId);

    const bedrooms = cleanText(args.bedrooms, "Bedrooms", 20);
    if (!bedrooms) throw new ConvexError("Enter the number of bedrooms.");
    checkNumbers(args);

    const now = Date.now();
    const id = await ctx.db.insert("units", {
      orgId: org.orgId,
      propertyId: args.propertyId,
      unitNumber,
      unitNumberKey,
      floor: args.floor,
      isTopFloor: args.isTopFloor,
      bedrooms,
      bathrooms: args.bathrooms,
      parking: args.parking === undefined ? undefined : cleanText(args.parking, "Parking", 200),
      rent: args.rent,
      available: args.available ?? false,
      availableFrom: args.availableFrom,
      leasingFacts:
        args.leasingFacts === undefined ? undefined : cleanText(args.leasingFacts, "Leasing facts"),
      assetManagerUserId,
      // An AM is guaranteed above, so intake can be live from the first minute.
      maintenanceIntakeActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "unit",
      entityId: id,
      action: "unit_created",
      actorUserId: org.user._id,
      to: unitNumber,
    });
    return id;
  },
});

/** Edits everything except the asset manager, which only assignAssetManager may change. */
export const update = mutation({
  args: {
    unitId: v.id("units"),
    unitNumber: v.optional(v.string()),
    floor: v.optional(v.number()),
    isTopFloor: v.optional(v.boolean()),
    bedrooms: v.optional(v.string()),
    bathrooms: v.optional(v.number()),
    parking: v.optional(v.string()),
    // Kept so an old client gets the specific message below, not a validator failure.
    rent: v.optional(v.number()),
    availableFrom: v.optional(v.string()),
    leasingFacts: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const unit = await ownUnit(ctx, org, args.unitId);
    // Rent has a history now (an effective month per change): it changes only through Change rent.
    if (args.rent !== undefined) throw fieldError("rent", RENT_CHANGE_MSG.useChangeRent);
    // Only a value the user CHANGED is checked: an old stored value (a roster 1.25 baths) must not
    // block saving the other fields.
    checkNumbers({
      floor: args.floor !== unit.floor ? args.floor : undefined,
      bathrooms: args.bathrooms !== unit.bathrooms ? args.bathrooms : undefined,
    });

    // Fields are copied one by one rather than spreading args, so nothing the client adds
    // (an assetManagerUserId, an orgId) can reach the row.
    const patch: Partial<Doc<"units">> = { updatedAt: Date.now() };
    if (args.unitNumber !== undefined) {
      const { unitNumber, unitNumberKey } = requireUnitNumber(args.unitNumber);
      await assertNoDuplicate(ctx, unit.propertyId, unitNumberKey, unit._id);
      patch.unitNumber = unitNumber;
      patch.unitNumberKey = unitNumberKey;
    }
    if (args.bedrooms !== undefined) {
      const bedrooms = cleanText(args.bedrooms, "Bedrooms", 20);
      if (!bedrooms) throw new ConvexError("Enter the number of bedrooms.");
      patch.bedrooms = bedrooms;
    }
    if (args.floor !== undefined) {
      patch.floor = args.floor;
      // A roster text label ("Basement") describes the old number; a new number replaces it.
      if (args.floor !== unit.floor && unit.floorRaw !== undefined) patch.floorRaw = undefined;
    }
    if (args.isTopFloor !== undefined) patch.isTopFloor = args.isTopFloor;
    if (args.bathrooms !== undefined) patch.bathrooms = args.bathrooms;
    if (args.parking !== undefined) patch.parking = cleanText(args.parking, "Parking", 200);
    if (args.availableFrom !== undefined) patch.availableFrom = args.availableFrom;
    if (args.leasingFacts !== undefined) {
      patch.leasingFacts = cleanText(args.leasingFacts, "Leasing facts");
    }
    await ctx.db.patch(unit._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "unit",
      entityId: unit._id,
      action: "unit_updated",
      actorUserId: org.user._id,
    });
  },
});

/** Managers can flip any unit; an asset manager only the ones they are the AM of. */
export const setAvailability = mutation({
  args: {
    unitId: v.id("units"),
    available: v.boolean(),
    availableFrom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const unit = await ownUnit(ctx, org, args.unitId);

    const manager = isAdminView(org);
    const ownAm = org.jobRoles.includes("asset_manager") && unit.assetManagerUserId === org.user._id;
    if (!manager && !ownAm) throw new ConvexError("You don't have access to that.");

    await ctx.db.patch(unit._id, {
      available: args.available,
      availableFrom: args.available ? args.availableFrom : undefined,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "unit",
      entityId: unit._id,
      action: "availability_set",
      actorUserId: org.user._id,
      from: String(unit.available),
      to: String(args.available),
    });
  },
});

export const assignAssetManager = mutation({
  args: { unitId: v.id("units"), assetManagerUserId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const unit = await ownUnit(ctx, org, args.unitId);
    await assertValidAssetManager(ctx, org.orgId, args.assetManagerUserId);
    await reassign(ctx, org, unit, args.assetManagerUserId);
  },
});

export const bulkAssignAssetManager = mutation({
  args: { unitIds: v.array(v.id("units")), assetManagerUserId: v.id("users") },
  handler: async (ctx, args): Promise<{ changed: number }> => {
    const org = await requireAdminView(ctx);
    if (args.unitIds.length > MAX_BULK) throw new ConvexError(`Pick at most ${MAX_BULK} units at a time.`);
    await assertValidAssetManager(ctx, org.orgId, args.assetManagerUserId);

    // Resolve every unit before writing any, so one bad id fails the whole batch cleanly
    // (a mutation is transactional, but this also gives one clear error).
    const units: Doc<"units">[] = [];
    for (const id of new Set(args.unitIds)) units.push(await ownUnit(ctx, org, id));

    let changed = 0;
    for (const unit of units) {
      if (await reassign(ctx, org, unit, args.assetManagerUserId)) changed += 1;
    }
    return { changed };
  },
});

/**
 * Sets a property's default asset manager and, per `applyTo`, moves its units to them through
 * the same reassign() as every other AM change (so each move is audited and the hard rule
 * stays in this module). "Without an override" means the unit's AM equals the property's
 * PREVIOUS default (units store their AM, so an override is simply a different one); a property
 * that had no default yet has no overrides to protect, so all its units count.
 */
export async function applyDefaultAssetManager(
  ctx: MutationCtx,
  org: OrgContext,
  property: Doc<"properties">,
  userId: Id<"users">,
  applyTo: "units_without_override" | "all",
): Promise<{ changed: number; total: number }> {
  await assertValidAssetManager(ctx, org.orgId, userId);
  const units = (
    await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect()
  ).filter((u) => u.orgId === org.orgId);

  const previous = property.defaultAssetManagerUserId;
  let changed = 0;
  for (const unit of units) {
    const inherits = previous === undefined || unit.assetManagerUserId === previous;
    if (applyTo === "all" || inherits) {
      if (await reassign(ctx, org, unit, userId)) changed += 1;
    }
  }
  await ctx.db.patch(property._id, { defaultAssetManagerUserId: userId, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "property",
    entityId: property._id,
    action: "default_am_set",
    actorUserId: org.user._id,
    from: previous,
    to: userId,
    note: `${applyTo === "all" ? "All units" : "Units without an override"}: ${changed} of ${units.length} changed`,
  });
  return { changed, total: units.length };
}

/** Shared by the single and bulk paths so the audit trail is identical. Returns false on no-op. */
async function reassign(
  ctx: MutationCtx,
  org: OrgContext,
  unit: Doc<"units">,
  to: Id<"users">,
): Promise<boolean> {
  return (await reassignDetailed(ctx, org, unit, to)) !== null;
}

/**
 * The single reassign implementation. Returns null on a no-op, otherwise the open requests that
 * moved with the unit (for the admin "Assignment Updated" summary). `reason` is validated by the
 * caller and goes into the unit's audit note.
 */
async function reassignDetailed(
  ctx: MutationCtx,
  org: OrgContext,
  unit: Doc<"units">,
  to: Id<"users">,
  reason?: string,
): Promise<{ requestsMoved: Array<{ requestId: Id<"maintenanceRequests">; number: number }> } | null> {
  if (unit.assetManagerUserId === to) return null;
  await ctx.db.patch(unit._id, { assetManagerUserId: to, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "unit",
    entityId: unit._id,
    action: "am_changed",
    actorUserId: org.user._id,
    from: unit.assetManagerUserId,
    to,
    note: reason ? `Reason: ${reason}` : undefined,
  });

  // Open requests follow the unit: the new AM must see (and be able to act on) them, and the
  // old AM must stop seeing them. Each moved request gets its own audit row.
  // Walk every request on the unit (no take cap) so none is left with the old AM.
  const open: Doc<"maintenanceRequests">[] = [];
  for await (const r of ctx.db
    .query("maintenanceRequests")
    .withIndex("by_unit_and_created", (q) => q.eq("unitId", unit._id))
    .order("desc")) {
    if (r.orgId === org.orgId && OPEN_REQUEST_STATUSES.includes(r.status)) open.push(r);
  }
  for (const r of open) {
    await ctx.db.patch(r._id, { assignedAssetManagerUserId: to, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "request",
      entityId: r._id,
      action: "reassigned_with_unit",
      actorUserId: org.user._id,
      from: r.assignedAssetManagerUserId,
      to,
      note: `Unit ${unit.unitNumber} reassigned`,
    });
  }
  if (open.length > 0 && to !== org.user._id) {
    await scheduleNotify(ctx, {
      orgId: org.orgId,
      userIds: [to],
      template: "request_reassigned",
      data: {
        unit: unit.unitNumber,
        number: open.length === 1 ? open[0].number : undefined,
        path: open.length === 1 ? `/maintenance/${open[0]._id}` : "/maintenance",
      },
    });
  }
  return { requestsMoved: open.map((r) => ({ requestId: r._id, number: r.number })) };
}

/**
 * Admin "Asset managers" flow: move one unit to another asset manager, with a reason. Goes
 * through the same reassign as every other AM change, so the hard rule, audit trail and
 * open-request repointing stay in this module. Rejects a no-op.
 */
export async function reassignUnitWithReason(
  ctx: MutationCtx,
  org: OrgContext,
  unitId: Id<"units">,
  to: Id<"users">,
  reason: string | undefined,
): Promise<{
  previousManagerUserId: Id<"users">;
  unit: Doc<"units">;
  requestsMoved: Array<{ requestId: Id<"maintenanceRequests">; number: number }>;
}> {
  const unit = await ownUnit(ctx, org, unitId);
  await assertValidAssetManager(ctx, org.orgId, to);
  const moved = await reassignDetailed(ctx, org, unit, to, reason);
  if (!moved) throw new ConvexError("That unit already belongs to this asset manager.");
  return { previousManagerUserId: unit.assetManagerUserId, unit, requestsMoved: moved.requestsMoved };
}

export const remove = mutation({
  args: { unitId: v.id("units") },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const unit = await ownUnit(ctx, org, args.unitId);
    // Its rent history goes with it (payments keep their own amounts in the ledger).
    for (const c of await ctx.db
      .query("unitRentChanges")
      .withIndex("by_unit_and_month", (q) => q.eq("unitId", unit._id))
      .collect()) {
      if (c.orgId === org.orgId) await ctx.db.delete(c._id);
    }
    await ctx.db.delete(unit._id);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "unit",
      entityId: unit._id,
      action: "unit_removed",
      actorUserId: org.user._id,
      from: unit.unitNumber,
    });
  },
});

// --- Roster import (B3) ------------------------------------------------------

/** The unit columns the client roster owns; convex/rosterImport.ts maps them (rosterMapping.ts). */
const ROSTER_FIELDS = [
  "unitNumber",
  "unitNumberKey",
  "unitType",
  "floor",
  "floorRaw",
  "bedrooms",
  "bedroomsCount",
  "bathrooms",
  "rentedAs",
  "occupancy",
  "leaseType",
  "leaseEnd",
  "rent",
  "rentPaidTo",
  "heatingFuel",
  "gasPaidBy",
  "electricPaidBy",
  "laundry",
  "available",
] as const satisfies ReadonlyArray<keyof MappedUnitFields & keyof Doc<"units">>;

/**
 * Creates or updates one unit from a roster row, inside the import mutation. Lives here so the
 * units table keeps a single writer and the asset-manager rule is enforced the same way.
 *
 * - Create: the AM is validated (assertValidAssetManager) and the unit is checked for a duplicate
 *   key on its property, exactly like `create`.
 * - Update: only the roster's own columns are compared and patched ("-" removes the field);
 *   the asset manager is never changed, so units already moved to their real AM (e.g. Nikki,
 *   later, through the bulk-apply path) stay with them on a re-import. leasingFacts is written
 *   only for room rentals, so text staff typed on other units is kept.
 * - No change: no write and no audit row, which is what makes a re-run a no-op.
 */
export async function upsertRosterUnit(
  ctx: MutationCtx,
  args: {
    orgId: string;
    propertyId: Id<"properties">;
    existing: Doc<"units"> | null;
    fields: MappedUnitFields;
    assetManagerUserId: Id<"users">;
    note: string;
  },
): Promise<{
  unitId: Id<"units">;
  action: "created" | "updated" | "unchanged";
  changed: string[];
  /** True when the roster's rent differed but was NOT applied because the unit has rent history. */
  rentKeptForHistory: boolean;
}> {
  const { fields } = args;
  if (!args.existing) {
    await assertNoDuplicate(ctx, args.propertyId, fields.unitNumberKey);
    await assertValidAssetManager(ctx, args.orgId, args.assetManagerUserId);
    const now = Date.now();
    const doc: Omit<Doc<"units">, "_id" | "_creationTime"> = {
      orgId: args.orgId,
      propertyId: args.propertyId,
      unitNumber: fields.unitNumber,
      unitNumberKey: fields.unitNumberKey,
      bedrooms: fields.bedrooms,
      available: fields.available,
      assetManagerUserId: args.assetManagerUserId,
      maintenanceIntakeActive: true,
      createdAt: now,
      updatedAt: now,
    };
    // Only stated values are written; an absent key is the "-" of the sheet.
    const optional = doc as Record<string, unknown>;
    for (const key of ROSTER_FIELDS) {
      if (fields[key] !== undefined) optional[key] = fields[key];
    }
    if (fields.leasingFacts !== undefined) doc.leasingFacts = fields.leasingFacts;
    const id = await ctx.db.insert("units", doc);
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "unit",
      entityId: id,
      action: "unit_created",
      to: fields.unitNumber,
      note: args.note,
    });
    return { unitId: id, action: "created", changed: [], rentKeptForHistory: false };
  }

  const unit = args.existing;
  if (unit.orgId !== args.orgId) throw new ConvexError("Unit not found.");
  if (unit.propertyId !== args.propertyId) {
    throw new ConvexError(
      `${args.note}: unit "${unit.unitNumber}" is on another property; the import will not move it. Move it by hand first.`,
    );
  }
  if (fields.unitNumberKey !== unit.unitNumberKey) {
    await assertNoDuplicate(ctx, args.propertyId, fields.unitNumberKey, unit._id);
  }
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  // A unit with rent history keeps its rent: the history (changed with Change rent) is the source
  // of the rent for each month, and a re-imported roster rent would silently disagree with it.
  const hasRentHistory =
    (await ctx.db
      .query("unitRentChanges")
      .withIndex("by_unit_and_month", (q) => q.eq("unitId", unit._id))
      .first()) !== null;
  let rentKeptForHistory = false;
  for (const key of ROSTER_FIELDS) {
    if (key === "rent" && hasRentHistory) {
      if (fields.rent !== unit.rent) rentKeptForHistory = true;
      continue;
    }
    if (fields[key] !== unit[key]) {
      patch[key] = fields[key];
      changed.push(key);
    }
  }
  if (fields.leasingFacts !== undefined && fields.leasingFacts !== unit.leasingFacts) {
    patch.leasingFacts = fields.leasingFacts;
    changed.push("leasingFacts");
  }
  if (changed.length === 0) return { unitId: unit._id, action: "unchanged", changed, rentKeptForHistory };
  if (patch.available === false) patch.availableFrom = undefined;
  await ctx.db.patch(unit._id, { ...(patch as Partial<Doc<"units">>), updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: args.orgId,
    entity: "unit",
    entityId: unit._id,
    action: "unit_updated",
    note: `${args.note}: ${changed.join(", ")}`,
  });
  return { unitId: unit._id, action: "updated", changed, rentKeptForHistory };
}

/**
 * Org-purge only: deletes every unit of a team that is being torn down (called from
 * team.deleteOrgRows). Not a registered function and not reachable from a client; it exists
 * because `remove` above is per-unit, audited and admin-gated, which is wrong for a purge that
 * is also deleting the audit trail itself. Normal code must never call this.
 */
export async function purgeOrgUnits(ctx: MutationCtx, orgId: string): Promise<number> {
  for (const c of await ctx.db
    .query("unitRentChanges")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(c._id);
  }
  const units = await ctx.db
    .query("units")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const unit of units) await ctx.db.delete(unit._id);
  return units.length;
}
