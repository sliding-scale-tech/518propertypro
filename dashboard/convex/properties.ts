import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentOrg, requireOrg } from "./authz";
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
