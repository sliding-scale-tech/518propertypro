import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { scheduleNotify, staffRecipientIds } from "./notify";
import { findResidentsByPhone } from "./residents";
import { normalizeUnitKey } from "./units";

/**
 * Data access for Sarah's newer server tools (convex/http.ts). Everything here is internal: the
 * org is resolved by the HTTP layer from the call's own conversation or agent id and is trusted
 * from there on, never taken from anything the model or caller said.
 *
 * What these return is deliberately narrow, because the answers are read aloud to whoever is on
 * the phone. A caller-ID match yields a first name and a unit label and nothing else; a spoken
 * address yields a unit label and nothing else.
 */

// --- check_availability ------------------------------------------------------

/**
 * The team's units that are open to offer. `hasUnits` is true whenever the team has ANY rows in
 * the units table, even if none is currently available: a team that maintains units must not
 * fall back to the old per-property bedroom summary, which could still say "available" for a
 * type the units table says is full. Only available = true rows are returned, so an unavailable
 * unit can never be offered (PRD section 7).
 */
export const availableUnits = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("units")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(2000);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(50);
    const nameOf = new Map(properties.map((p) => [p._id, p.name]));
    return {
      hasUnits: all.length > 0,
      available: all
        .filter((u) => u.available)
        .map((u) => ({
          community: nameOf.get(u.propertyId) ?? null,
          bedrooms: u.bedrooms,
          rent: u.rent ?? null,
          availableFrom: u.availableFrom ?? null,
        })),
    };
  },
});

// --- find_unit ---------------------------------------------------------------

/** Words that differ between how a caller says an address and how it is stored. */
const ADDRESS_NOISE = new Set([
  "street", "st", "avenue", "ave", "road", "rd", "drive", "dr", "lane", "ln", "court", "ct",
  "boulevard", "blvd", "way", "place", "pl", "the", "of", "and", "apartments", "apartment",
  "apts", "apt", "building", "bldg", "unit", "ny", "new", "york", "usa",
]);

function addressTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * The team's property a spoken address refers to, or null when it is missing or ambiguous.
 *
 * A single-building team never needs the address: that building is the answer. With several, the
 * spoken street number AND at least one distinctive street word must both appear in a building's
 * stored address or name, and exactly one building may match. Ambiguity is "no match" on
 * purpose: a request attached to the wrong building is routed to the wrong asset manager.
 */
async function matchProperty(
  ctx: QueryCtx,
  orgId: string,
  spokenAddress: string | undefined,
): Promise<Doc<"properties"> | null> {
  const props = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(50);
  const spoken = spokenAddress ? addressTokens(spokenAddress) : [];
  if (spoken.length === 0) return props.length === 1 ? props[0] : null;

  const number = spoken.find((t) => /^\d+$/.test(t));
  const words = spoken.filter((t) => !/^\d+$/.test(t) && !ADDRESS_NOISE.has(t) && t.length >= 3);
  const hits = props.filter((p) => {
    const hay = new Set(addressTokens(`${p.address?.formatted ?? ""} ${p.name}`));
    const numberOk = number ? hay.has(number) : false;
    const wordOk = words.some((w) => hay.has(w));
    // A bare name ("Maple Court") has no number to compare; accept name words alone only then.
    return number ? numberOk && wordOk : wordOk;
  });
  return hits.length === 1 ? hits[0] : null;
}

export const matchPropertyId = internalQuery({
  args: { orgId: v.string(), spokenAddress: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"properties"> | null> =>
    (await matchProperty(ctx, args.orgId, args.spokenAddress))?._id ?? null,
});

/**
 * Spoken address + unit -> the stored unit label. Returns nothing about who lives there.
 */
export const findUnit = internalQuery({
  args: { orgId: v.string(), spokenAddress: v.optional(v.string()), spokenUnit: v.string() },
  handler: async (ctx, args): Promise<{ matched: boolean; unitLabel?: string }> => {
    const key = normalizeUnitKey(args.spokenUnit);
    if (!key) return { matched: false };
    const property = await matchProperty(ctx, args.orgId, args.spokenAddress);
    if (!property) return { matched: false };
    const unit = await ctx.db
      .query("units")
      .withIndex("by_property_and_unit_key", (q) =>
        q.eq("propertyId", property._id).eq("unitNumberKey", key),
      )
      .first();
    if (!unit || unit.orgId !== args.orgId) return { matched: false };
    return { matched: true, unitLabel: unit.unitNumber };
  },
});

// --- lookup_caller -----------------------------------------------------------

/**
 * Caller ID -> first name + unit label, for CONFIRMING ("Am I speaking with Sam at 4B?"), never
 * for assuming. Nothing else about the resident leaves this function: no surname, phone, lease
 * or balance. A number shared by people in different units is treated as no match rather than a
 * guess.
 */
export const lookupCaller = internalQuery({
  args: { orgId: v.string(), phone: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ matched: boolean; firstName?: string; unitLabel?: string }> => {
    const matches = await findResidentsByPhone(ctx, args.orgId, args.phone);
    if (matches.length === 0) return { matched: false };
    const unitIds = [...new Set(matches.map((m) => m.unitId))];
    if (unitIds.length !== 1) return { matched: false };
    const unit = await ctx.db.get(unitIds[0]);
    if (!unit || unit.orgId !== args.orgId) return { matched: false };
    // Roommates sharing a number: confirm the unit but do not guess which of them is calling.
    const first = matches.length === 1 ? matches[0].fullName.trim().split(/\s+/)[0] : undefined;
    return { matched: true, firstName: first || undefined, unitLabel: unit.unitNumber };
  },
});

// --- notifications -----------------------------------------------------------

/**
 * Re-enables the escalation alert that used to be a commented-out SMS in /tools/escalate, now
 * through the notification service so every send is logged and a Twilio failure can't fail the
 * call.
 *
 * Skipped when this call already produced an emergency or urgent maintenance request: that
 * request's own routing texted the same staff, and a second text for the same call is noise at
 * the worst possible moment. `alreadyNotified` tells the caller so.
 */
export const notifyEscalation = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    residentIssue: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ notified: boolean; alreadyNotified: boolean }> => {
    const requests = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_conversation", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .collect();
    const covered = requests.some(
      (r) => r.orgId === args.orgId && (r.severity === "emergency" || r.severity === "urgent"),
    );
    if (covered) return { notified: true, alreadyNotified: true };

    const userIds = await staffRecipientIds(ctx, args.orgId);
    if (userIds.length === 0) return { notified: false, alreadyNotified: false };
    await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds,
      template: "request_emergency",
      data: {
        firstName: args.callerName?.trim().split(/\s+/)[0],
        unit: args.unit,
        severity: "escalated",
        path: args.residentIssue ? "/tenants" : "/leads",
      },
    });
    return { notified: true, alreadyNotified: false };
  },
});

/** Texts the executives (Alex) that an owner prospect is waiting. First name only in the SMS. */
export const notifyOwnerProspect = internalMutation({
  args: { orgId: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as Id<"organizations">))
      .collect();
    const userIds = members.filter((m) => (m.jobRoles ?? []).includes("executive")).map((m) => m.userId);
    if (userIds.length === 0) return false;
    await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds,
      template: "owner_prospect",
      data: { firstName: args.name.trim().split(/\s+/)[0], path: "/leads" },
    });
    return true;
  },
});
