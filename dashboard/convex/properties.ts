import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { currentOrg, requireAdminView, requireOrg, viewFor } from "./authz";
import { requireE164 } from "./phone";
import { propertyAddressValidator } from "./placesApi";

const DEFAULT_PROPERTY = {
  name: "Maple Court Apartments",
  units: [
    { bedrooms: "studio", rentMin: 1400, rentMax: 1400, available: true },
    { bedrooms: "1br", rentMin: 1650, rentMax: 1650, available: true },
    { bedrooms: "2br", rentMin: 2100, rentMax: 2100, available: true },
  ],
  petsAllowed: false,
  moveInWindowDays: 60,
};

// --- Reads ----------------------------------------------------------------

/**
 * The signed-in team's property. Before they have one — a brief window before their
 * first call or Settings save triggers agents.ensure to actually clone it — this previews the
 * same template every new user gets seeded from, so what's on screen doesn't jump the moment
 * a real row lands.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return { _id: undefined, ...DEFAULT_PROPERTY, updatedAt: 0 };
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .first();
    if (existing) return existing;

    // Same template resolution as agents.templateOrgId — inlined rather than called, since a
    // query can't ctx.runQuery another Convex function the way an action can.
    const templateOrgId = (await ctx.db.query("agents").first())?.orgId;
    const template = templateOrgId
      ? await ctx.db
          .query("properties")
          .withIndex("by_org", (q) => q.eq("orgId", templateOrgId))
          .first()
      : null;
    return template ?? { _id: undefined, ...DEFAULT_PROPERTY, updatedAt: 0 };
  },
});

/**
 * `orgId` undefined resolves the fallback — see agents.currentInternal for why: a phone call's
 * tool webhook that can't yet tell which team placed the call, or the public landing-page demo,
 * both need *some* property to answer from.
 */
export const currentInternal = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const existing = orgId
      ? await ctx.db
          .query("properties")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .first()
      : await ctx.db.query("properties").first();
    if (existing) return existing;
    return { ...DEFAULT_PROPERTY, updatedAt: Date.now() };
  },
});

/**
 * Seeds a brand-new team's property as a copy of the template's — see agents.templateOrgId.
 * A no-op if this team already has one (never clobbers real work) or if there's no template to
 * copy (a from-scratch install with no property ever saved, in which case check_availability
 * reading currentInternal with no match still falls back to DEFAULT_PROPERTY).
 */
export const cloneForOrg = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
    templateOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    const templateOrgId = args.templateOrgId;
    if (existing || !templateOrgId) return;

    const template = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", templateOrgId))
      .first();
    if (!template) return;

    await ctx.db.insert("properties", {
      orgId: args.orgId,
      userId: args.userId,
      name: template.name,
      units: template.units,
      petsAllowed: template.petsAllowed,
      moveInWindowDays: template.moveInWindowDays,
      updatedAt: Date.now(),
    });

    // The auto-generated property doc regenerates from whatever property row exists, so this
    // gives the new team their own copy of it rather than cloning the template's verbatim
    // (which would still be correct today since the content is identical, but would drift
    // stale the moment either property is edited).
    await ctx.scheduler.runAfter(0, internal.docs.syncPropertyDoc, {
      orgId: args.orgId,
      userId: args.userId,
    });
  },
});

// --- Writes ---------------------------------------------------------------

export const save = mutation({
  args: {
    name: v.string(),
    units: v.array(
      v.object({
        bedrooms: v.string(),
        rentMin: v.number(),
        rentMax: v.number(),
        available: v.boolean(),
      }),
    ),
    petsAllowed: v.boolean(),
    moveInWindowDays: v.number(),
    address: v.optional(propertyAddressValidator),
  },
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    // `address` spelled out even when undefined: a patch only removes a field whose key is
    // present, so leaving it to the spread would make clearing an address silently do nothing.
    const row = { ...args, address: args.address, orgId, userId: user._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("properties", row);

    await ctx.scheduler.runAfter(0, internal.docs.syncPropertyDoc, { orgId, userId: user._id });
  },
});

// --- Multi-property (admin view) -------------------------------------------
//
// `current`, `currentInternal` and `save` above still treat the oldest row as "the" property
// (what Sarah's tools and the legacy Property page read). The functions below manage the rest.

/** Every building on the team with its unit count. Not for technicians (they only see jobs). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    if (viewFor(org.isAdmin, org.jobRoles) === "technician") return [];
    const rows = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const out = [];
    for (const p of rows) {
      const units = await ctx.db
        .query("units")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id))
        .collect();
      out.push({
        _id: p._id,
        name: p.name,
        address: p.address,
        isPilot: p.isPilot ?? false,
        utilityGasPhone: p.utilityGasPhone,
        petsAllowed: p.petsAllowed,
        unitCount: units.length,
        updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error("Enter a property name.");
  if (name.length > 120) throw new Error("Property name is too long.");
  return name;
}

export const create = mutation({
  args: {
    name: v.string(),
    address: v.optional(propertyAddressValidator),
    isPilot: v.optional(v.boolean()),
    utilityGasPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"properties">> => {
    const org = await requireAdminView(ctx);
    const id = await ctx.db.insert("properties", {
      orgId: org.orgId,
      userId: org.user._id,
      name: cleanName(args.name),
      // Legacy leasing fields are required by the schema; a new building starts neutral.
      units: [],
      petsAllowed: false,
      moveInWindowDays: 60,
      address: args.address,
      isPilot: args.isPilot ?? false,
      utilityGasPhone: args.utilityGasPhone ? requireE164(args.utilityGasPhone, "Gas phone") : undefined,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "property",
      entityId: id,
      action: "property_created",
      actorUserId: org.user._id,
      to: args.name.trim(),
    });
    return id;
  },
});

/** Name, address and the pilot/gas-phone profile only. Leasing fields stay with `save`. */
export const updateProfile = mutation({
  args: {
    propertyId: v.id("properties"),
    name: v.optional(v.string()),
    address: v.optional(propertyAddressValidator),
    isPilot: v.optional(v.boolean()),
    utilityGasPhone: v.optional(v.string()),
    clearGasPhone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) throw new Error("Property not found.");

    const patch: Partial<Doc<"properties">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = cleanName(args.name);
    if (args.address !== undefined) patch.address = args.address;
    if (args.isPilot !== undefined) patch.isPilot = args.isPilot;
    if (args.clearGasPhone) patch.utilityGasPhone = undefined;
    else if (args.utilityGasPhone !== undefined) {
      patch.utilityGasPhone = requireE164(args.utilityGasPhone, "Gas phone");
    }
    await ctx.db.patch(property._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "property",
      entityId: property._id,
      action: "property_profile_updated",
      actorUserId: org.user._id,
    });
  },
});
