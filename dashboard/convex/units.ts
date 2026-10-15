import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { hasJobRole, requireJobRole, requireOrg, requireOrgAdmin } from "./authz";
import type { OrgContext } from "./authz";

/**
 * Units: the ONLY module that writes the `units` table.
 *
 * The hard rule is that every unit has exactly one designated asset manager. It is held in two
 * places that must stay together: `assetManagerUserId` is a required column (so an insert
 * without one is rejected by the schema), and every path that sets it goes through
 * assertValidAssetManager (so it can't point at someone who isn't an AM on this team). There is
 * deliberately no mutation that clears it — reassigning is the only way it changes.
 */

const MAX_BULK = 500;
const MAX_TEXT = 2000;

// --- Helpers --------------------------------------------------------------

/**
 * What a caller says ("apartment 4-B", "Unit #4b", "#4 B") and what is stored ("4B") should
 * compare equal, so matching and duplicate detection both run on this key instead of the
 * display string. Pure and exported so the voice tools can normalize the same way.
 */
export function normalizeUnitKey(s: string): string {
  let key = s.toLowerCase().trim();
  // Strip leading label words repeatedly so "apt #4b" and "unit apt 4b" both reach "4b".
  for (;;) {
    const next = key.replace(/^(?:unit|apartment|apt|suite|#)[\s.:#-]*/, "");
    if (next === key) break;
    key = next;
  }
  return key.replace(/[^a-z0-9]+/g, "");
}

/**
 * The rule's enforcement point. The target must be a member of THIS team and hold the
 * asset_manager job role; a user id from the client is never trusted on its own, and another
 * team's user (or a plain member) cannot be made an AM.
 */
async function assertValidAssetManager(
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
    throw new Error("That person is not an asset manager on this team.");
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
  if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");
  return unit;
}

function cleanText(value: string, label: string, max = MAX_TEXT): string {
  const out = value.trim();
  if (out.length > max) throw new Error(`${label} is too long.`);
  return out;
}

function requireUnitNumber(raw: string): { unitNumber: string; unitNumberKey: string } {
  const unitNumber = cleanText(raw, "Unit number", 40);
  const unitNumberKey = normalizeUnitKey(unitNumber);
  if (!unitNumber || !unitNumberKey) throw new Error("Enter a unit number.");
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
  if (dup && dup._id !== exceptId) throw new Error("That unit already exists on this property.");
}

// --- Reads ----------------------------------------------------------------

/**
 * Units are visible to everyone on the team except a pure technician, who only needs the jobs
 * assigned to them. A member with no job role yet (not backfilled) is not locked out.
 */
function canViewUnits(org: OrgContext): boolean {
  return org.isAdmin || org.jobRoles.length === 0 || org.jobRoles.some((r) => r !== "technician");
}

async function withManagers(ctx: QueryCtx, org: OrgContext, units: Doc<"units">[]) {
  const names = new Map<string, string>();
  for (const id of new Set(units.map((u) => u.assetManagerUserId))) {
    const user = await ctx.db.get(id);
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    names.set(id, name || user?.email || "Unknown");
  }
  return units.map((u) => ({
    ...u,
    assetManagerName: names.get(u.assetManagerUserId) ?? "Unknown",
    // An AM sees every unit (to know the building) but this flag marks the ones they act on.
    isMine: u.assetManagerUserId === org.user._id,
  }));
}

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canViewUnits(org)) throw new Error("You don't have access to that.");
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) return [];
    const units = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return await withManagers(ctx, org, units);
  },
});

export const list = query({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!canViewUnits(org)) throw new Error("You don't have access to that.");
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
    return await withManagers(
      ctx,
      org,
      units.filter((u) => u.orgId === org.orgId),
    );
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
    assetManagerUserId: v.id("users"),
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
    const org = await requireJobRole(ctx, "executive", "maintenance_lead");

    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) throw new Error("Property not found.");

    const { unitNumber, unitNumberKey } = requireUnitNumber(args.unitNumber);
    await assertNoDuplicate(ctx, args.propertyId, unitNumberKey);
    await assertValidAssetManager(ctx, org.orgId, args.assetManagerUserId);

    const bedrooms = cleanText(args.bedrooms, "Bedrooms", 20);
    if (!bedrooms) throw new Error("Enter the number of bedrooms.");

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
      assetManagerUserId: args.assetManagerUserId,
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
    rent: v.optional(v.number()),
    availableFrom: v.optional(v.string()),
    leasingFacts: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await requireJobRole(ctx, "executive", "maintenance_lead");
    const unit = await ownUnit(ctx, org, args.unitId);

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
      if (!bedrooms) throw new Error("Enter the number of bedrooms.");
      patch.bedrooms = bedrooms;
    }
    if (args.floor !== undefined) patch.floor = args.floor;
    if (args.isTopFloor !== undefined) patch.isTopFloor = args.isTopFloor;
    if (args.bathrooms !== undefined) patch.bathrooms = args.bathrooms;
    if (args.parking !== undefined) patch.parking = cleanText(args.parking, "Parking", 200);
    if (args.rent !== undefined) patch.rent = args.rent;
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

    const manager = hasJobRole(org, "executive", "maintenance_lead");
    const ownAm = org.jobRoles.includes("asset_manager") && unit.assetManagerUserId === org.user._id;
    if (!manager && !ownAm) throw new Error("You don't have access to that.");

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
    const org = await requireJobRole(ctx, "executive", "maintenance_lead");
    const unit = await ownUnit(ctx, org, args.unitId);
    await assertValidAssetManager(ctx, org.orgId, args.assetManagerUserId);
    await reassign(ctx, org, unit, args.assetManagerUserId);
  },
});

export const bulkAssignAssetManager = mutation({
  args: { unitIds: v.array(v.id("units")), assetManagerUserId: v.id("users") },
  handler: async (ctx, args): Promise<{ changed: number }> => {
    const org = await requireJobRole(ctx, "executive", "maintenance_lead");
    if (args.unitIds.length > MAX_BULK) throw new Error(`Pick at most ${MAX_BULK} units at a time.`);
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

/** Shared by the single and bulk paths so the audit trail is identical. Returns false on no-op. */
async function reassign(
  ctx: MutationCtx,
  org: OrgContext,
  unit: Doc<"units">,
  to: Id<"users">,
): Promise<boolean> {
  if (unit.assetManagerUserId === to) return false;
  await ctx.db.patch(unit._id, { assetManagerUserId: to, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "unit",
    entityId: unit._id,
    action: "am_changed",
    actorUserId: org.user._id,
    from: unit.assetManagerUserId,
    to,
  });
  return true;
}

export const remove = mutation({
  args: { unitId: v.id("units") },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const unit = await ownUnit(ctx, org, args.unitId);
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

/**
 * Org-purge only: deletes every unit of a team that is being torn down (called from
 * team.deleteOrgRows). Not a registered function and not reachable from a client; it exists
 * because `remove` above is per-unit, audited and admin-gated, which is wrong for a purge that
 * is also deleting the audit trail itself. Normal code must never call this.
 */
export async function purgeOrgUnits(ctx: MutationCtx, orgId: string): Promise<number> {
  const units = await ctx.db
    .query("units")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const unit of units) await ctx.db.delete(unit._id);
  return units.length;
}
