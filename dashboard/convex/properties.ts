import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { currentOrg, requireAdminView, viewFor } from "./authz";
import { requireE164 } from "./phone";
import { propertyAddressValidator } from "./placesApi";
import { amScope } from "./amScope";
import { applyDefaultAssetManager } from "./units";
import { cleanOwnerEmails, MAX_OWNER_EMAILS, ownerEmailProblems, ownerEmailsOf } from "./ownerVerifyLib";
import { linkOwnerForProperty, ownerIdentityChanged } from "./ownerLinking";

const DEFAULT_PROPERTY = {
  name: "518 Property Pro",
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
    const { orgId, user } = await requireAdminView(ctx);
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
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view === "technician") return [];
    // An asset manager sees only buildings holding a unit they manage or cover.
    const scope = view === "asset_manager" ? await amScope(ctx, org) : null;
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
      const yourUnits = scope
        ? units.filter((u) => scope.managed.has(u._id) || scope.covering.has(u._id)).length
        : units.length;
      if (scope && yourUnits === 0) continue;
      out.push({
        _id: p._id,
        name: p.name,
        address: p.address,
        isPilot: p.isPilot ?? false,
        utilityGasPhone: p.utilityGasPhone,
        petsAllowed: p.petsAllowed,
        defaultAssetManagerUserId: p.defaultAssetManagerUserId,
        // Owner contact details and override counts are admin-only.
        ownerName: scope ? undefined : p.ownerName,
        ownerEmail: scope ? undefined : p.ownerEmail,
        ownerEmails: scope ? undefined : ownerEmailsOf(p),
        unitCount: units.length,
        // Units in this building the viewer manages or covers (all of them outside the AM view).
        yourUnits,
        // Units whose AM differs from the default (overrides); 0 when there is no default.
        overrideCount: scope
          ? 0
          : p.defaultAssetManagerUserId
          ? units.filter((u) => u.assetManagerUserId !== p.defaultAssetManagerUserId).length
          : 0,
        updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ConvexError("Enter a property name.");
  if (name.length > 120) throw new ConvexError("Property name is too long.");
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
      // Legacy per-type summary (required by the schema). Pets and move-in window stay unset
      // until someone enters them, so no policy is stated for the building by default.
      units: [],
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
    ownerName: v.optional(v.string()), // "" clears it
    ownerEmail: v.optional(v.string()), // "" clears it
    // Every owner email, in order (the first is also stored as ownerEmail). [] clears them all.
    // Owners are verified against these before Sarah puts them through to staff (B36).
    ownerEmails: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) throw new ConvexError("Property not found.");

    const patch: Partial<Doc<"properties">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = cleanName(args.name);
    if (args.address !== undefined) patch.address = args.address;
    if (args.isPilot !== undefined) patch.isPilot = args.isPilot;
    if (args.clearGasPhone) patch.utilityGasPhone = undefined;
    else if (args.utilityGasPhone !== undefined) {
      patch.utilityGasPhone = requireE164(args.utilityGasPhone, "Gas phone");
    }
    if (args.ownerName !== undefined) {
      const name = args.ownerName.trim();
      if (name.length > 120) throw new ConvexError("Owner name is too long.");
      patch.ownerName = name === "" ? undefined : name;
    }
    if (args.ownerEmail !== undefined) {
      const email = args.ownerEmail.trim();
      if (email.length > 200 || (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        throw new ConvexError("Enter a valid owner email.");
      }
      patch.ownerEmail = email === "" ? undefined : email;
      // Keep ownerEmails (every owner address, lowercase; the roster can give two) in step with
      // the one address this form edits: a changed address replaces the first and keeps the
      // others; clearing it clears them all. An unchanged address leaves the list alone.
      const lower = email.toLowerCase();
      const current = property.ownerEmails ?? (property.ownerEmail ? [property.ownerEmail.toLowerCase()] : []);
      if (lower !== (current[0] ?? "")) {
        patch.ownerEmails = lower === "" ? undefined : [lower, ...current.slice(1).filter((e) => e !== lower)];
      }
    }
    if (args.ownerEmails !== undefined) {
      if (args.ownerEmails.length > 20) throw new ConvexError(`A property can have at most ${MAX_OWNER_EMAILS} owner emails.`);
      const problem = ownerEmailProblems(args.ownerEmails)[0];
      if (problem) throw new ConvexError(problem.message);
      const list = cleanOwnerEmails(args.ownerEmails);
      patch.ownerEmails = list.length ? list : undefined;
      patch.ownerEmail = list[0];
    }
    const before = ownerEmailsOf(property);
    await ctx.db.patch(property._id, patch);
    const after = ownerEmailsOf({ ...property, ...patch });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "property",
      entityId: property._id,
      action: "property_profile_updated",
      actorUserId: org.user._id,
      // Counts only: owner emails never go into the audit trail.
      note:
        after.length !== before.length || after.some((e, i) => e !== before[i])
          ? `Owner emails changed (${before.length} before, ${after.length} now).`
          : undefined,
    });
    // Owner identity (ownerLinking.ts): a changed owner name / email links the owner only when
    // name + email make it certain. Never moves an existing link and never throws for an expected
    // case; anything uncertain shows on the Owners page's "Needs an owner" list.
    if (ownerIdentityChanged(property, { ...property, ...patch })) {
      await linkOwnerForProperty(ctx, property._id, { source: "manual", actorUserId: org.user._id });
    }
  },
});

/**
 * Pat/executive picks the property's default asset manager and chooses how far it spreads.
 * The unit writes themselves are done by units.applyDefaultAssetManager (the only module that
 * writes the units table), so each change is audited and the AM is validated there.
 */
export const setDefaultAssetManager = mutation({
  args: {
    propertyId: v.id("properties"),
    userId: v.id("users"),
    applyTo: v.union(v.literal("units_without_override"), v.literal("all")),
  },
  handler: async (ctx, args): Promise<{ changed: number; total: number }> => {
    const org = await requireAdminView(ctx);
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== org.orgId) throw new ConvexError("Property not found.");
    return await applyDefaultAssetManager(ctx, org, property, args.userId, args.applyTo);
  },
});
