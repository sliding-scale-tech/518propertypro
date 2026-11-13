import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantOrgId } from "./authz";
import { writeAudit } from "./audit";
import { bedroomsLabel } from "./rosterMapping";
import { scheduleEmergencyAlert, scheduleNotify } from "./notify";
import { findResidentsByPhone } from "./residents";
import {
  buildStatusItems,
  rankByIssue,
  spokenClock,
  spokenDate,
  verifyStatusCaller,
  type DateFormatter,
  type StatusItem,
} from "./workOrderStatus";
import {
  cityOfProperty,
  editDistance,
  naturalCompare,
  saysNoUnit,
  similarUnits,
  spokenUnitKeys,
  STREET_ORDINALS,
  streetWordLoose,
  streetWordSimilar,
} from "./unitMatch";

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
export async function availableUnitsFor(ctx: QueryCtx, orgId: string) {
  const all = await ctx.db
    .query("units")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const byId = new Map(properties.map((p) => [p._id, p]));
  return {
    hasUnits: all.length > 0,
    // More than one building: no single "the property" name or pet policy applies to the call.
    propertyCount: properties.length,
    // Every city the team has a building in, available units or not, derived from the data (never
    // a fixed list): what a caller's "which city or area" answer is matched against.
    cities: [...new Set(properties.map(cityOfProperty).filter((c): c is string => c !== null))].sort(),
    // Unit facts a prospect may hear, nothing about who lives anywhere. leasingFacts is how
    // the unit must be described (e.g. a room in a shared apartment, not "a 4-bedroom").
    available: all
      .filter((u) => u.available)
      .map((u) => {
        const p = byId.get(u.propertyId);
        return {
          community: p?.name ?? null,
          address: p?.address?.formatted ?? null,
          city: p ? cityOfProperty(p) : null,
          // The unit's own label ("2B"), so Sarah can name the unit a caller picks. Null for a house
          // (no label). A label only, nothing about who lived there.
          unitLabel: spokenLabel(u),
          bedrooms: u.bedrooms,
          rentedAs: u.rentedAs ?? null,
          rent: u.rent ?? null,
          availableFrom: u.availableFrom ?? null,
          leasingFacts: u.leasingFacts ?? null,
        };
      }),
  };
}

/** One unit type Sarah may offer, summed over the available units of that type. */
export type OfferedUnitType = {
  community: string | null;
  /** The building's address and city, so Sarah can say where it is (roster import, B3). */
  address: string | null;
  city: string | null;
  bedrooms: string;
  rentMin: number | null;
  rentMax: number | null;
  /** Null when we only have the property's per-type summary, which carries no count. */
  count: number | null;
  availableFrom: string | null;
  /** How the unit must be described (e.g. a room in a shared apartment). Null when none. */
  leasingFacts: string | null;
  /** "room" for one room of a shared apartment, null for a whole unit. */
  rentedAs: "room" | null;
  /** Labels of the AVAILABLE units in this group ("1", "2B"), naturally sorted. Labels only, never who lives anywhere. */
  units: string[];
};

/** At most this many unit labels per building and type in a tool result, to keep results small. */
export const MAX_UNIT_LABELS = 4;

/** availableUnitsFor's rows (available units only). */
type AvailableUnitRow = Awaited<ReturnType<typeof availableUnitsFor>>["available"][number];

/**
 * The available units grouped into what Sarah may offer: one group per building and unit type.
 * Units with their own leasing facts, or rented as a room, are never merged into a plain bedroom
 * group, so the facts always reach Sarah with the right rent. The address is in the key, so two
 * buildings with one community name never share a group (and their unit labels never get mixed up).
 */
export function groupOfferedUnits(rows: readonly AvailableUnitRow[]): OfferedUnitType[] {
  const groups = new Map<string, OfferedUnitType>();
  for (const u of rows) {
    const key = `${u.community ?? ""}|${u.address ?? ""}|${u.bedrooms}|${u.leasingFacts ?? ""}|${u.rentedAs ?? ""}`;
    const g: OfferedUnitType = groups.get(key) ?? {
      community: u.community,
      address: u.address,
      city: u.city,
      bedrooms: u.bedrooms,
      rentMin: null,
      rentMax: null,
      count: 0,
      availableFrom: null,
      leasingFacts: u.leasingFacts,
      rentedAs: u.rentedAs,
      units: [],
    };
    g.count = (g.count ?? 0) + 1;
    if (u.unitLabel && !g.units.includes(u.unitLabel)) g.units.push(u.unitLabel);
    if (u.rent !== null) {
      g.rentMin = g.rentMin === null ? u.rent : Math.min(g.rentMin, u.rent);
      g.rentMax = g.rentMax === null ? u.rent : Math.max(g.rentMax, u.rent);
    }
    // The earliest date any unit of this type frees up, compared as written (ISO dates sort).
    if (u.availableFrom && (!g.availableFrom || u.availableFrom < g.availableFrom)) {
      g.availableFrom = u.availableFrom;
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, units: [...g.units].sort(naturalCompare) }));
}

/**
 * One offered unit type as Sarah gets it (check_availability all_units, log_lead / check_qualification
 * available_units). Building, type, rent and up to MAX_UNIT_LABELS available unit labels, so a unit the
 * caller picks can go to request_tour as spoken_unit. Nothing about residents or owners.
 */
export function offeredUnitForAgent(t: OfferedUnitType) {
  return {
    community: t.community,
    address: t.address,
    city: t.city,
    bedrooms: t.bedrooms,
    rent_min: t.rentMin,
    rent_max: t.rentMax,
    units_available: t.count,
    available_from: t.availableFrom,
    // When present, describe the unit exactly this way (it overrides bedrooms / rent wording).
    leasing_facts: t.leasingFacts ?? (t.rentedAs === "room" ? ROOM_SAY : null),
    rented_as: t.rentedAs,
    ...(t.units.length > 0 ? { units: t.units.slice(0, MAX_UNIT_LABELS) } : {}),
  };
}

export const availableUnits = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => await availableUnitsFor(ctx, args.orgId),
});

/** How many buildings the team has: with more than one, no single building's profile applies. */
export const orgPropertyCount = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<number> =>
    (
      await ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect()
    ).length,
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
    .collect();
  const spoken = spokenAddress ? addressTokens(spokenAddress) : [];
  if (spoken.length === 0) return props.length === 1 ? props[0] : null;

  const number = spoken.find((t) => /^\d+$/.test(t));
  const words = spoken.filter((t) => !/^\d+$/.test(t) && !ADDRESS_NOISE.has(t) && t.length >= 3);
  const hits = props.filter((p) => {
    const hay = new Set(addressTokens(`${p.address?.formatted ?? ""} ${p.name}`));
    const numberOk = number ? hay.has(number) : false;
    const wordOk = words.some((w) => hay.has(w));
    // A bare name ("Museum Apartments") has no number to compare; accept name words alone only then.
    return number ? numberOk && wordOk : wordOk;
  });
  return hits.length === 1 ? hits[0] : null;
}

export const matchPropertyId = internalQuery({
  args: { orgId: v.string(), spokenAddress: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"properties"> | null> =>
    (await matchProperty(ctx, args.orgId, args.spokenAddress))?._id ?? null,
});

/** Never more than this many building addresses in one question. */
const MAX_ADDRESS_OPTIONS = 5;
/** Loose same-number suggestions ("86 Ramsay" -> 86 Remsen Street) offer at most this many. */
const MAX_LOOSE_OPTIONS = 3;

/** "184 Remsen Street, Cohoes, NY" -> "184 Remsen Street": the part a caller says. */
export function streetLine(p: Doc<"properties">): string {
  return (p.address?.formatted ?? p.name).split(",")[0].trim() || p.name;
}

function streetWords(p: Doc<"properties">): string[] {
  return addressTokens(streetLine(p)).filter((t) => !/^\d+$/.test(t) && !ADDRESS_NOISE.has(t));
}

function houseNumbers(p: Doc<"properties">): string[] {
  return addressTokens(streetLine(p)).filter((t) => /^\d+$/.test(t));
}

/** 1 the same number, 0.7 one slip or two swapped digits ("148" / "184"), else 0. */
function numberCloseness(spoken: string, stored: string): number {
  if (spoken === stored) return 1;
  if (editDistance(spoken, stored) <= 1) return 0.7;
  if (spoken.length === stored.length && spoken.length >= 2) {
    const diff = [...spoken].map((c, i) => (c === stored[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length === 2 && diff[1] === diff[0] + 1 && spoken[diff[0]] === stored[diff[1]] && spoken[diff[1]] === stored[diff[0]]) {
      return 0.7;
    }
  }
  return 0;
}

/**
 * The building a spoken address refers to, or, when there is no single exact match, the options
 * Sarah may read back for the caller to choose from. Exact matching is matchProperty, unchanged;
 * everything else here only produces OPTIONS and never decides for the caller.
 *
 *  - matched: exactly one building (matchProperty).
 *  - ambiguous: the street matched several buildings ("Remsen Street"), listed when there are at
 *    most MAX_ADDRESS_OPTIONS, else Sarah asks for the street number.
 *  - suggestions: no exact match, but a street word is a likely mishearing or misspelling
 *    ("Remson") and/or the number is one slip off. Only buildings whose street word is close are
 *    ever suggested; a matching number alone never suggests anything.
 *  - need_street: only a city or a generic word matched, so there is nothing to offer.
 *  - none: nothing close. Never a list.
 */
export type AddressLookup =
  | { status: "matched"; property: Doc<"properties"> }
  | { status: "ambiguous" | "suggestions"; options: string[]; total: number }
  | { status: "need_street" | "none" | "no_address"; options: []; total: number };

export async function lookupAddress(
  ctx: QueryCtx,
  orgId: string,
  spokenAddress: string | undefined,
): Promise<AddressLookup> {
  const exact = await matchProperty(ctx, orgId, spokenAddress);
  if (exact) return { status: "matched", property: exact };
  const spoken = spokenAddress ? addressTokens(spokenAddress) : [];
  // No address at all: never volunteer the team's buildings.
  if (spoken.length === 0) return { status: "no_address", options: [], total: 0 };

  const props = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const number = spoken.find((t) => /^\d+$/.test(t));
  const words = spoken
    .map((t) => STREET_ORDINALS[t] ?? t)
    .filter((t) => !/^\d+$/.test(t) && !ADDRESS_NOISE.has(t) && t.length >= 3);
  if (words.length === 0) return { status: "need_street", options: [], total: 0 };

  const scored = props
    .map((p) => {
      const street = streetWords(p);
      const word = Math.max(0, ...words.flatMap((w) => street.map((t) => streetWordSimilar(w, t))));
      const num = number ? Math.max(0, ...houseNumbers(p).map((h) => numberCloseness(number, h))) : 0;
      return { p, word, num };
    })
    .filter((s) => s.word > 0);

  // The house number is exactly one of ours but the street word was misheard further than
  // streetWordSimilar allows ("86 Ramsay" / "86 Ramsden" for 86 Remsen Street). Only when nothing
  // closer explains it (no building with that number or the exact street): suggest the buildings
  // with that number whose street word is loosely similar (same first letter, see streetWordLoose).
  // Always a suggestion, never a match, and a matching number alone still never suggests anything.
  if (number && !scored.some((s) => s.num === 1 || (s.word === 1 && s.num > 0))) {
    const loose = props
      .filter((p) => houseNumbers(p).includes(number))
      .map((p) => {
        const street = streetWords(p);
        return { p, word: Math.max(0, ...words.flatMap((w) => street.map((t) => streetWordLoose(w, t)))) };
      })
      .filter((s) => s.word > 0)
      .sort((a, b) => b.word - a.word || naturalCompare(streetLine(a.p), streetLine(b.p)));
    if (loose.length > 0) {
      return {
        status: "suggestions",
        options: loose.slice(0, MAX_LOOSE_OPTIONS).map((s) => streetLine(s.p)),
        total: loose.length,
      };
    }
  }

  if (scored.length === 0) {
    // Words matched nothing on any street (a city, or nothing we have): no options.
    return { status: "none", options: [], total: 0 };
  }

  const exactStreet = scored.filter((s) => s.word === 1);
  let pool: typeof scored;
  let status: "ambiguous" | "suggestions";
  if (number) {
    const sameNumber = scored.filter((s) => s.num === 1);
    const closeNumber = scored.filter((s) => s.num > 0);
    pool = sameNumber.length ? sameNumber : closeNumber.length ? closeNumber : exactStreet.length ? exactStreet : scored;
    status = "suggestions";
  } else {
    pool = exactStreet.length ? exactStreet : scored;
    status = exactStreet.length > 1 ? "ambiguous" : "suggestions";
  }
  pool.sort(
    (a, b) =>
      b.word + b.num - (a.word + a.num) ||
      naturalCompare(streetLine(a.p), streetLine(b.p)),
  );
  if (pool.length > MAX_ADDRESS_OPTIONS) {
    // Too many to read out: Sarah asks for the street number instead.
    return { status, options: [], total: pool.length } as AddressLookup;
  }
  return { status, options: pool.map((s) => streetLine(s.p)), total: pool.length };
}

/** A building's units, this team's only. */
async function unitsOf(ctx: QueryCtx, orgId: string, propertyId: Id<"properties">) {
  return (
    await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect()
  ).filter((u) => u.orgId === orgId);
}

/**
 * The one unit a spoken unit identifies inside an already-matched building, or null. This is the
 * single definition of "identified" shared by find_unit, log_task_request and maintenance routing:
 *  - an exact key match on any literal reading of what was said (spokenUnitKeys: "unit to" is "2",
 *    "B as in boy two" is "B2"). Similar-but-different labels never count here.
 *  - a building with exactly one unit: that unit when it has no label (a house, e.g. 9 Lexington
 *    Court) or when the caller gave no unit.
 */
export function exactUnitAmong(units: Doc<"units">[], spokenUnit: string | undefined): Doc<"units"> | null {
  if (units.length === 1 && (units[0].unitNumberKey === "" || saysNoUnit(spokenUnit))) return units[0];
  if (saysNoUnit(spokenUnit)) return null;
  for (const key of spokenUnitKeys(spokenUnit!)) {
    const hit = units.find((u) => u.unitNumberKey === key);
    if (hit) return hit;
  }
  return null;
}

export async function exactUnitInProperty(
  ctx: QueryCtx,
  orgId: string,
  propertyId: Id<"properties">,
  spokenUnit: string | undefined,
): Promise<Doc<"units"> | null> {
  return exactUnitAmong(await unitsOf(ctx, orgId, propertyId), spokenUnit);
}

/** Shown to callers: a unit with no label (a house) has no unit number to read out. */
function spokenLabel(u: Doc<"units">): string | null {
  return u.unitNumberKey ? u.unitNumber : null;
}

/** Units listed in full only for a building this small; bigger ones ask the caller to repeat. */
const LIST_ALL_UNITS_MAX = 4;

/**
 * What find_unit returns. Labels and building addresses only, never anything about residents or
 * whether a unit is occupied.
 */
export type FindUnitResult =
  | {
      matched: true;
      unitLabel: string | null;
      propertyName: string;
      propertyAddress: string;
    }
  | {
      matched: false;
      propertyMatched: true;
      propertyName: string;
      propertyAddress: string;
      unitCount: number;
      needUnit: boolean; // the caller has not given a unit yet
      similar: string[]; // labels close to what they said, best first, at most 4
      allUnits: string[]; // every label, only when nothing is similar and the building has <= 4
    }
  | {
      matched: false;
      propertyMatched: false;
      addressStatus: "ambiguous" | "suggestions" | "need_street" | "none" | "no_address";
      addressOptions: string[]; // street lines ("184 Remsen Street"), at most 5
      addressOptionCount: number; // how many matched, even when too many to list
    };

/** Spoken address + unit -> the stored unit label, or options for the caller to confirm. */
export async function findUnitFor(
  ctx: QueryCtx,
  args: { orgId: string; spokenAddress?: string; spokenUnit?: string },
): Promise<FindUnitResult> {
  const address = await lookupAddress(ctx, args.orgId, args.spokenAddress);
  if (address.status !== "matched") {
    return {
      matched: false,
      propertyMatched: false,
      addressStatus: address.status,
      addressOptions: address.options,
      addressOptionCount: address.total,
    };
  }
  const property = address.property;
  const where = { propertyName: property.name, propertyAddress: streetLine(property) };
  const units = await unitsOf(ctx, args.orgId, property._id);
  const unit = exactUnitAmong(units, args.spokenUnit);
  if (unit) return { matched: true, unitLabel: spokenLabel(unit), ...where };

  const labelled = units
    .filter((u) => u.unitNumberKey)
    .map((u) => ({ label: u.unitNumber, key: u.unitNumberKey }))
    .sort((a, b) => naturalCompare(a.label, b.label));
  const needUnit = saysNoUnit(args.spokenUnit);
  const similar = needUnit ? [] : similarUnits(spokenUnitKeys(args.spokenUnit!), labelled);
  const allUnits =
    !needUnit && similar.length === 0 && labelled.length <= LIST_ALL_UNITS_MAX ? labelled.map((l) => l.label) : [];
  return {
    matched: false,
    propertyMatched: true,
    ...where,
    unitCount: units.length,
    needUnit,
    similar,
    allUnits,
  };
}

export const findUnit = internalQuery({
  args: { orgId: v.string(), spokenAddress: v.optional(v.string()), spokenUnit: v.optional(v.string()) },
  handler: async (ctx, args): Promise<FindUnitResult> => await findUnitFor(ctx, args),
});

/** The identified unit's id and label, for tools that file something against it. */
export const exactUnit = internalQuery({
  args: { orgId: v.string(), propertyId: v.id("properties"), spokenUnit: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ unitId: Id<"units">; unitLabel: string } | null> => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.orgId !== args.orgId) return null;
    const unit = await exactUnitInProperty(ctx, args.orgId, args.propertyId, args.spokenUnit);
    return unit ? { unitId: unit._id, unitLabel: unit.unitNumber } : null;
  },
});

// --- request_tour ------------------------------------------------------------

/**
 * The apartment a tour is for, from the building and unit the caller chose. Same matching as
 * find_unit and get_unit_details (matchProperty, then exactUnitAmong), this team's buildings only,
 * and only an AVAILABLE unit is ever attached, as in the other leasing tools. Never anything about
 * residents. Anything less than an exact match leaves that part out rather than guessing:
 *  - property null: no building matched (or none was given on a multi-building team).
 *  - property set, unit null: the building matched; unitStatus says why no unit is attached.
 */
export type TourApartment = {
  property: { id: Id<"properties">; name: string; address: string; street: string } | null;
  unit: { id: Id<"units">; label: string | null } | null;
  unitStatus: "matched" | "none_given" | "not_available";
};

/**
 * What to try matching a tour's building on, best first. Sarah passes the address exactly as a
 * log_lead / check_availability result gave it ("1635 Van Vranken Avenue, Schenectady, NY"), so the
 * street part before the first comma comes first: the city and state are not what tells buildings
 * apart, and could make two buildings with the same number in one city look alike. Then the whole text.
 */
export function tourBuildingQueries(spoken: string | undefined): string[] {
  const whole = spoken?.trim() ?? "";
  if (!whole) return [];
  const street = whole.split(",")[0].trim();
  return street && street !== whole ? [street, whole] : [whole];
}

/**
 * True when the spoken text names the building itself (a word of its street or its name), not just
 * its city or area. "Schenectady" must never pick a building for a tour, even on a team with only one
 * building there (conv_0001m7acgw57fpwagbr0ydncsybk passed the city as the building).
 */
export function namesBuilding(spoken: string, property: { name: string; address?: { formatted: string } }): boolean {
  const words = addressTokens(spoken).filter((t) => !/^\d+$/.test(t) && !ADDRESS_NOISE.has(t) && t.length >= 3);
  const own = new Set(addressTokens(`${(property.address?.formatted ?? property.name).split(",")[0]} ${property.name}`));
  return words.some((w) => own.has(w));
}

export async function tourApartmentFor(
  ctx: QueryCtx,
  args: { orgId: string; spokenAddress?: string; spokenUnit?: string },
): Promise<TourApartment> {
  let property: Doc<"properties"> | null = null;
  const queries = tourBuildingQueries(args.spokenAddress);
  if (queries.length === 0) {
    // No building said: only a one-building team's own building (matchProperty), as find_unit does.
    property = await matchProperty(ctx, args.orgId, undefined);
  }
  for (const q of queries) {
    const hit = await matchProperty(ctx, args.orgId, q);
    if (hit && namesBuilding(q, hit)) {
      property = hit;
      break;
    }
  }
  if (!property || property.orgId !== args.orgId) {
    return { property: null, unit: null, unitStatus: saysNoUnit(args.spokenUnit) ? "none_given" : "not_available" };
  }
  const where = {
    id: property._id,
    name: property.name,
    address: property.address?.formatted ?? property.name,
    street: streetLine(property),
  };
  const unit = exactUnitAmong(await unitsOf(ctx, args.orgId, property._id), args.spokenUnit);
  if (unit?.available) {
    return { property: where, unit: { id: unit._id, label: spokenLabel(unit) }, unitStatus: "matched" };
  }
  // An unavailable unit is reported the same as an unknown one: nothing about occupancy is said.
  return { property: where, unit: null, unitStatus: saysNoUnit(args.spokenUnit) ? "none_given" : "not_available" };
}

export const tourApartment = internalQuery({
  args: { orgId: v.string(), spokenAddress: v.optional(v.string()), spokenUnit: v.optional(v.string()) },
  handler: async (ctx, args): Promise<TourApartment> => await tourApartmentFor(ctx, args),
});

// --- get_unit_details --------------------------------------------------------

/** How Sarah says a unit rented as one room of a shared apartment (same wording as the knowledge doc). */
export const ROOM_SAY = "a room in a shared apartment";

const LAUNDRY_SAY = {
  none: "no laundry",
  shared_building: "shared laundry in the building",
  hookups: "washer and dryer hookups in the unit",
  provided: "washer and dryer in unit",
} as const;

const HEATING_SAY = { gas: "gas", electric: "electric", both: "both gas and electric" } as const;

/** Never more than this many units in one answer: Sarah answers about the caller's unit, not a catalogue. */
const MAX_DETAIL_UNITS = 8;

/**
 * Who pays for the heat, only when the roster makes it certain: gas heat -> the gas payer, electric
 * heat -> the electric payer, both -> only when the same party pays both. Otherwise null.
 */
function heatPaidBy(u: Doc<"units">): "tenant" | "landlord" | null {
  if (u.heatingFuel === "gas") return u.gasPaidBy ?? null;
  if (u.heatingFuel === "electric") return u.electricPaidBy ?? null;
  if (u.heatingFuel === "both") return u.gasPaidBy && u.gasPaidBy === u.electricPaidBy ? u.gasPaidBy : null;
  return null;
}

/** The facts a prospect may ask about one AVAILABLE unit. Null = not stated; nothing about who lives anywhere. */
function unitDetail(u: Doc<"units">) {
  return {
    unitLabel: spokenLabel(u),
    unitType: u.unitType && u.unitType !== "unknown" ? u.unitType : null,
    bedrooms: u.bedrooms,
    rentedAs: u.rentedAs === "room" ? ROOM_SAY : null,
    bathrooms: u.bathrooms ?? null,
    floor: u.floorRaw ?? (u.floor !== undefined ? String(u.floor) : null),
    laundry: u.laundry && u.laundry !== "unknown" ? LAUNDRY_SAY[u.laundry] : null,
    heatingFuel: u.heatingFuel ? HEATING_SAY[u.heatingFuel] : null,
    gasPaidBy: u.gasPaidBy ?? null,
    electricPaidBy: u.electricPaidBy ?? null,
    heatPaidBy: heatPaidBy(u),
    rent: u.rent ?? null,
    availableFrom: u.availableFrom ?? null,
    leasingFacts: u.leasingFacts ?? null,
  };
}

export type UnitDetailsResult =
  | {
      status: "matched" | "none_available" | "no_unit_match";
      propertyName: string;
      propertyAddress: string;
      total: number;
      units: Array<ReturnType<typeof unitDetail>>;
    }
  | {
      status: "not_matched";
      addressStatus: "ambiguous" | "suggestions" | "need_street" | "none" | "no_address";
      addressOptions: string[];
      addressOptionCount: number;
    };

/**
 * Details of the AVAILABLE units of the building a spoken address or community name refers to,
 * optionally narrowed by bedrooms and/or unit label. Occupied units are never read, and nothing
 * about residents or owners is returned. Building matching is lookupAddress, as in find_unit.
 */
export async function unitDetailsFor(
  ctx: QueryCtx,
  args: { orgId: string; spokenAddress?: string; bedrooms?: string; spokenUnit?: string },
): Promise<UnitDetailsResult> {
  const address = await lookupAddress(ctx, args.orgId, args.spokenAddress);
  if (address.status !== "matched") {
    return {
      status: "not_matched",
      addressStatus: address.status,
      addressOptions: address.options,
      addressOptionCount: address.total,
    };
  }
  const property = address.property;
  const where = { propertyName: property.name, propertyAddress: streetLine(property) };
  const open = (await unitsOf(ctx, args.orgId, property._id)).filter((u) => u.available);
  if (open.length === 0) return { status: "none_available", ...where, total: 0, units: [] };

  let picked = open;
  if (args.bedrooms) {
    const wanted = /^\d$/.test(args.bedrooms) ? bedroomsLabel(Number(args.bedrooms), undefined) : args.bedrooms;
    picked = picked.filter((u) => u.bedrooms === wanted);
  }
  if (args.spokenUnit && !saysNoUnit(args.spokenUnit)) {
    const one = exactUnitAmong(picked, args.spokenUnit);
    picked = one ? [one] : [];
  }
  picked.sort((a, b) => naturalCompare(a.unitNumber, b.unitNumber));
  return {
    status: picked.length > 0 ? "matched" : "no_unit_match",
    ...where,
    total: picked.length,
    units: picked.slice(0, MAX_DETAIL_UNITS).map(unitDetail),
  };
}

export const unitDetails = internalQuery({
  args: {
    orgId: v.string(),
    spokenAddress: v.optional(v.string()),
    bedrooms: v.optional(v.string()),
    spokenUnit: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<UnitDetailsResult> => await unitDetailsFor(ctx, args),
});

// --- check_work_order_status -------------------------------------------------

/**
 * After this many unverified lookups on one call, a later name match on that call no longer counts
 * as verified (so guessing names cannot unlock visit times). The status itself is never withheld.
 */
export const MAX_UNVERIFIED_STATUS_LOOKUPS = 3;
/** Dates are read in the team's zone; every 518 building is in New York, the fallback. */
const STATUS_FALLBACK_TIME_ZONE = "America/New_York";
const UNVERIFIED_ACTION = "work_order_status_unverified";
const VERIFIED_ACTION = "work_order_status_verified";

/** One item as it may be said to the caller. Nothing else about the record leaves here. */
export type StatusItemOut = {
  ref: string;
  summary: string;
  reported: string; // "Tuesday, October 28"
  status: string; // the plain-English sentence (visit day/time only for a verified caller)
  open: boolean;
  visitDate: string | null; // "Tuesday, November 3", only for a verified caller
};

export type WorkOrderStatusResult =
  | { unitIdentified: false }
  | {
      unitIdentified: true;
      /** For staff and logs only: never told to the caller. */
      verification: "caller_id" | "name" | "caller_id_on_request" | "none";
      unitLabel: string | null;
      propertyAddress: string;
      failedClosed: true;
    }
  | {
      unitIdentified: true;
      verification: "caller_id" | "name" | "caller_id_on_request" | "none";
      unitLabel: string | null;
      propertyAddress: string;
      failedClosed: false;
      items: StatusItemOut[];
      total: number;
      likelyRef: string | null;
      selected: StatusItemOut | null;
    };

/**
 * check_work_order_status (user decision 2026-10-31). The unit must be identified EXACTLY
 * (matchProperty + exactUnitAmong, the same rule as find_unit; a suggestion or similar label is
 * refused). That alone is enough to hear the recorded status. Verification
 * (workOrderStatus.verifyStatusCaller: caller ID or a name matching a resident of THAT unit) is a
 * soft signal: it only adds the scheduled visit day, date and time, and is recorded for staff in the
 * audit log, never told to the caller. A mutation, not a query, because every lookup is audited.
 */
export const workOrderStatus = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    spokenAddress: v.optional(v.string()),
    spokenUnit: v.optional(v.string()),
    callerId: v.optional(v.string()),
    callerName: v.optional(v.string()),
    issueDescription: v.optional(v.string()),
    requestRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WorkOrderStatusResult> => {
    const property = await matchProperty(ctx, args.orgId, args.spokenAddress);
    if (!property) return { unitIdentified: false };
    const unit = exactUnitAmong(await unitsOf(ctx, args.orgId, property._id), args.spokenUnit);
    if (!unit) return { unitIdentified: false };
    const where = { unitLabel: spokenLabel(unit), propertyAddress: streetLine(property) };

    const priorUnverified = (
      await ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entity", "conversation").eq("entityId", args.elevenLabsConversationId))
        .take(50)
    ).filter((e) => e.orgId === args.orgId && e.action === UNVERIFIED_ACTION).length;

    const residents = (
      await ctx.db
        .query("residents")
        .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
        .take(50)
    ).filter((r) => r.active && r.orgId === args.orgId);
    const callerIdIsUnitResident = args.callerId
      ? (await findResidentsByPhone(ctx, args.orgId, args.callerId)).some((m) => m.unitId === unit._id)
      : false;
    const requests = (
      await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_unit_and_created", (q) => q.eq("unitId", unit._id))
        .order("desc")
        .take(100)
    ).filter((r) => r.orgId === args.orgId);
    const workOrders = (
      await ctx.db
        .query("workOrders")
        .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
        .take(100)
    ).filter((w) => w.orgId === args.orgId);

    const capped = priorUnverified >= MAX_UNVERIFIED_STATUS_LOOKUPS;
    const verification = capped
      ? ({ verified: false } as const)
      : verifyStatusCaller({
          callerId: args.callerId,
          callerIdIsUnitResident,
          callerName: args.callerName,
          residents: residents.map((r) => ({ id: r._id, fullName: r.fullName })),
          requests: requests.map((r) => ({ id: r._id, callerNumber: r.callerNumber, callbackNumber: r.callbackNumber })),
        });
    const how: "caller_id" | "name" | "caller_id_on_request" | "none" = verification.verified ? verification.how : "none";
    const showVisitFor = (requestId: string | null): boolean =>
      verification.verified &&
      (verification.scope === "unit" || (requestId !== null && verification.requestIds.includes(requestId)));

    // For staff: one row per lookup on the call, with the verification result. No names.
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: verification.verified ? VERIFIED_ACTION : UNVERIFIED_ACTION,
      note: `Work-order status asked for unit ${unit.unitNumber} at ${where.propertyAddress}; ${
        verification.verified
          ? `caller verified by ${how.replace(/_/g, " ")}.`
          : `caller not verified${capped ? " (too many unverified tries on this call)" : ""}: status given without the visit day or time.`
      }`,
    });

    const orgDocId = ctx.db.normalizeId("organizations", args.orgId);
    const org = orgDocId ? await ctx.db.get(orgDocId) : null;
    let day: DateFormatter;
    let clock: DateFormatter;
    try {
      day = spokenDate(org?.timeZone ?? STATUS_FALLBACK_TIME_ZONE);
      clock = spokenClock(org?.timeZone ?? STATUS_FALLBACK_TIME_ZONE);
    } catch {
      day = spokenDate(STATUS_FALLBACK_TIME_ZONE);
      clock = spokenClock(STATUS_FALLBACK_TIME_ZONE);
    }
    const built = buildStatusItems(
      requests.map((r) => ({
        id: r._id,
        number: r.number,
        status: r.status,
        title: r.title,
        issueType: r.issueType,
        description: r.description,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        closeReason: r.closeReason,
      })),
      workOrders.map((w) => ({
        id: w._id,
        number: w.number,
        requestId: w.requestId,
        status: w.status,
        title: w.title,
        dueDate: w.dueDate,
        window: w.window,
        windowStart: w.windowStart,
        windowEnd: w.windowEnd,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        completedAt: w.completedAt,
        closedAt: w.closedAt,
      })),
      Date.now(),
      day,
      showVisitFor,
      clock,
    );
    const base = { unitIdentified: true as const, verification: how, ...where };
    if (!built.ok) {
      console.warn(`[check_work_order_status] unmapped status ${built.statusKey}; routing instead.`);
      return { ...base, failedClosed: true };
    }

    const out = (i: StatusItem): StatusItemOut => ({
      ref: i.ref,
      summary: i.summary,
      reported: day(i.reportedAt),
      status: i.status,
      open: i.open,
      visitDate: i.visitDate ? day(i.visitDate) : null,
    });
    const items = built.items;
    const ref = args.requestRef?.trim().toUpperCase();
    const chosen = items.length === 1 ? items[0] : (items.find((i) => i.ref === ref) ?? null);
    const likelyRef = chosen ? null : rankByIssue(items, args.issueDescription);

    // Audit what was said, on each record's own history, with the verification result.
    const whoNote = verification.verified
      ? `a caller verified by ${how.replace(/_/g, " ")}`
      : "an unverified caller (no visit day or time given)";
    for (const i of chosen ? [chosen] : items) {
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: i.requestId ? "request" : "work_order",
        entityId: (i.requestId ?? i.workOrderId)!,
        action: chosen ? "status_told_on_call" : "status_listed_on_call",
        note: chosen
          ? `Sarah read the recorded status to ${whoNote} (call ${args.elevenLabsConversationId}).`
          : `Sarah listed this request (summary and date only) to ${whoNote} (call ${args.elevenLabsConversationId}).`,
      });
    }
    return {
      ...base,
      failedClosed: false,
      items: items.map(out),
      total: built.total,
      likelyRef,
      selected: chosen ? out(chosen) : null,
    };
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
 * The escalate tool. Texting policy: the only text is an emergency alert to admins, so only a
 * life-safety escalation (a resident issue, reason urgent_tenant_issue) alerts anyone. It is
 * deduped per request and per call, so it never doubles up with the alert log_maintenance_request
 * already raised for the same call.
 *
 * `notified` is true only when admins have actually been alerted (now or earlier); callers and
 * Sarah must never claim staff were told otherwise. `alreadyNotified` keeps its old meaning: this
 * call already produced an emergency or urgent request, which is the record.
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
    const requests = (
      await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_conversation", (q) =>
          q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
        )
        .collect()
    ).filter((r) => r.orgId === args.orgId);
    const covered = requests.some((r) => r.severity === "emergency" || r.severity === "urgent");
    if (!args.residentIssue) return { notified: false, alreadyNotified: covered };

    const req = requests.find((r) => r.severity === "emergency") ?? requests[0];
    const unit = req?.unitId ? await ctx.db.get(req.unitId) : null;
    const alerted = await scheduleEmergencyAlert(ctx, {
      orgId: args.orgId,
      keys: [
        ...(req ? [{ entity: "request" as const, id: req._id }] : []),
        { entity: "conversation" as const, id: args.elevenLabsConversationId },
      ],
      number: req?.number,
      unit: unit?.unitNumber ?? args.unit,
      path: req ? `/maintenance/${req._id}` : "/tenants",
    });
    return { notified: alerted, alreadyNotified: covered };
  },
});

/**
 * Emergency on a call whose team could not be resolved by the HTTP layer (no conversations row
 * and no known agent id yet). This deployment has one team, so alert it rather than say nothing.
 * Deduped per call. Returns true only if admins were alerted.
 */
export const alertEmergencyUnresolvedOrg = internalMutation({
  args: { elevenLabsConversationId: v.string(), unit: v.optional(v.string()) },
  handler: async (ctx, args): Promise<boolean> => {
    const orgId = await tenantOrgId(ctx);
    if (!orgId) return false;
    return await scheduleEmergencyAlert(ctx, {
      orgId,
      keys: [{ entity: "conversation", id: args.elevenLabsConversationId }],
      unit: args.unit,
      path: "/tenants",
    });
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
