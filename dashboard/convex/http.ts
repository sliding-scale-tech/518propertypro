import { httpRouter, type GenericActionCtx } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { normalizeUnitKey } from "./units";
import { SEVERITY_LEVEL_SCORE, clampSeverity, parseSeverityLevel } from "./severity";
import {
  QUALIFICATION_MODE,
  coerceScreeningAnswers,
  evaluateQualification,
  missingScreeningKeys,
  type ScreeningQuestion,
} from "./qualifyRules";
import * as waha from "./wahaApi";
import { isOtlpPayload, parseOtlp } from "./otlp";
import { isVagueIssue, realPhone, realValue, stripAudioTags } from "./sanitize";
import { WAIT_FOR_CALLER, confirmedPhoneLines, leadLogLines, maintenanceLogLines, photoReplyLines } from "./sarahReplies";
import { toE164 } from "./phone";
import { handleClerkWebhook } from "./clerkWebhook";
import { maskRecipient, outboundEnabled } from "./outbound";
import { handleOAuthCallback as handleGoogleOAuthCallback } from "./googleCalendar";
import type { FunctionReturnType } from "convex/server";
import { bookTour, cancelTourNow, changeTourApartment, findTourTimes, rescheduleTour, type IgnoredTour } from "./tours";
import { TEAM_CONFIRMS_ADDRESS, TOUR_ADDRESS_NOT_CHANGED_SAY, tourApartmentChangedSay, tourBookedSay } from "./tourDisplay";
import { formatLocalDateTime, phoneKey, spokenLabel } from "./tourSchedule";
import { matchCities } from "./unitMatch";
import { groupOfferedUnits, offeredUnitForAgent, type OfferedUnitType } from "./sarahTools";
import {
  CALL_SID_RE,
  NEW_OWNER_LOGGED_SAY,
  OWNER_TRANSFER_DELAY_MS,
  TRANSFER_MECHANISM,
  dialAnswered,
  hangupTwiml,
  ownerTransferFallbackTwiml,
  ownerVoicemailThanksTwiml,
  spokenStaffName,
  transferAssignmentValues,
} from "./ownerRoutingLib";

const http = httpRouter();

/** Constant-time string compare (length leak only). */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * Gate for every /tools/* route: ElevenLabs sends the shared secret in x-simplr-tool-secret
 * (configured per tool in agents.ensureTools). Fails closed when the env var is unset.
 */
function checkToolAuth(request: Request): Response | null {
  const expected = process.env.ELEVENLABS_TOOL_SECRET;
  if (!expected) {
    console.warn("[tools] ELEVENLABS_TOOL_SECRET is not set; rejecting tool request.");
    return new Response("tool endpoint not configured", { status: 503 });
  }
  const provided = request.headers.get("x-simplr-tool-secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

/** httpAction wrapper that enforces checkToolAuth before running the tool handler. */
function toolAction(
  handler: (ctx: GenericActionCtx<DataModel>, request: Request) => Promise<Response>,
) {
  return httpAction(async (ctx, request) => {
    const denied = checkToolAuth(request);
    if (denied) return denied;
    return handler(ctx, request);
  });
}

/**
 * Resolves which team a mid-call tool request belongs to, from the ElevenLabs conversation id
 * every tool call carries. Returns undefined whenever it can't yet be resolved — the public
 * landing-page demo, or a phone call whose Convex conversations row hasn't been created yet
 * (see conversations.orgByElevenLabsId) — and every caller below already falls back to the
 * shared default in that case.
 */
async function resolveOrg(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
): Promise<string | undefined> {
  if (!conversationId) return undefined;
  // Convex queries can't return `undefined` over the wire — a query handler returning it comes
  // back as `null` here, so this normalizes back to `undefined` for the rest of this file.
  const orgId = await ctx.runQuery(internal.conversations.orgByElevenLabsId, {
    elevenLabsConversationId: conversationId,
  });
  return orgId ?? undefined;
}

/**
 * resolveOrg, with the agent's own id as a second route. Booking cannot use resolveOrg's
 * shared-default fallback — that would put a tour in the wrong team's calendars — and a phone
 * call has no conversations row until it ends. But every team has its own ElevenLabs agent,
 * so the agent id identifies the team mid-call on any channel.
 */
async function resolveBookingOrg(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
  agentId: string | undefined,
): Promise<string | undefined> {
  const byConversation = await resolveOrg(ctx, conversationId);
  if (byConversation) return byConversation;
  if (!agentId) return undefined;
  const orgId = await ctx.runQuery(internal.agents.orgByElevenLabsAgentId, { elevenLabsAgentId: agentId });
  return orgId ?? undefined;
}

/** Tool arguments arrive as JSON from the model; a boolean sometimes comes through as a string. */
function isConfirmed(value: unknown): boolean {
  return value === true || value === "true";
}

/** Every form of the caller's number we have — telephony caller ID and the number they said. */
function callerPhoneKeys(...phones: Array<string | undefined>): string[] {
  const keys = phones.map((p) => phoneKey(realPhone(p))).filter((k): k is string => k !== null);
  return [...new Set(keys)];
}

/**
 * callerPhoneKeys, plus the number already captured on this call's lead. A browser call has no
 * caller ID, and the model often leaves caller_phone off a follow-up tool call — a caller who
 * gave their number once (check_qualification records it) is recognized for the rest of the
 * call. Without this, cancel_tour refused a caller's own tours right after find_my_tour found them.
 */
async function conversationPhoneKeys(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
  ...phones: Array<string | undefined>
): Promise<string[]> {
  const lead = conversationId
    ? await ctx.runQuery(internal.qualifications.byElevenLabsId, { elevenLabsConversationId: conversationId })
    : null;
  return callerPhoneKeys(...phones, lead?.callerPhone);
}

type CallerTourRow = FunctionReturnType<typeof internal.tours.upcomingForCaller>[number];

function tourSummary(t: CallerTourRow) {
  return { tour_id: t.id, when: spokenLabel(t.start, t.timeZone), team_member: t.memberFirstName };
}

/**
 * The tour a cancel or reschedule call is about, only if it really belongs to this caller: in
 * their team, still upcoming, and booked on this call or under their phone number.
 */
async function findCallerTour(
  ctx: GenericActionCtx<DataModel>,
  body: { conversation_id?: string; agent_id?: string; tour_id?: unknown; caller_id?: string; caller_phone?: string },
): Promise<{ orgId: string; tour: CallerTourRow } | null> {
  const orgId = await resolveBookingOrg(ctx, body.conversation_id, body.agent_id);
  if (!orgId || typeof body.tour_id !== "string") return null;
  const tours = await ctx.runQuery(internal.tours.upcomingForCaller, {
    orgId,
    elevenLabsConversationId: body.conversation_id,
    phoneKeys: await conversationPhoneKeys(ctx, body.conversation_id, body.caller_id, body.caller_phone),
  });
  const tour = tours.find((t) => t.id === body.tour_id);
  return tour ? { orgId, tour } : null;
}

/**
 * What Sarah is allowed to offer: ONLY units with available = true (PRD section 7). A team with
 * rows in the units table is answered from those; otherwise from the older per-property bedroom
 * summary. A team that has units but none free gets an empty list, never the stale summary.
 */
type LeasingProperty = {
  name: string;
  units: Array<{ bedrooms: string; rentMin: number; rentMax: number; available: boolean }>;
};

async function offeredUnitTypes(
  ctx: GenericActionCtx<DataModel>,
  orgId: string | undefined,
  property: LeasingProperty,
): Promise<OfferedUnitType[]> {
  return (await offeredWithCities(ctx, orgId, property)).offered;
}

/** offeredUnitTypes, plus every city the team has a building in (from the data, never a fixed list). */
async function offeredWithCities(
  ctx: GenericActionCtx<DataModel>,
  orgId: string | undefined,
  property: LeasingProperty,
): Promise<{ offered: OfferedUnitType[]; cities: string[] }> {
  if (orgId) {
    const fromUnits = await ctx.runQuery(internal.sarahTools.availableUnits, { orgId });
    if (fromUnits.hasUnits) {
      return { offered: groupOfferedUnits(fromUnits.available), cities: fromUnits.cities };
    }
  }
  return {
    offered: property.units
      .filter((u) => u.available)
      .map((u) => ({
        community: property.name,
        address: null,
        city: null,
        bedrooms: u.bedrooms,
        rentMin: u.rentMin,
        rentMax: u.rentMax,
        count: null,
        availableFrom: null,
        leasingFacts: null,
        rentedAs: null,
        units: [],
      })),
    cities: [],
  };
}

/**
 * How a caller's city or area narrowed what Sarah may offer:
 *  - not_given / no_preference: nothing narrowed (the behaviour before cities existed).
 *  - matched: only units in the matched city or cities.
 *  - none_available: the city is one of ours but nothing there is open; nothing may be offered.
 *  - unknown_city: we have no building there; nothing may be offered.
 *  - no_city_data: no building has a city stored yet, so nothing can be narrowed.
 */
type CityStatus = "not_given" | "no_preference" | "matched" | "none_available" | "unknown_city" | "no_city_data";

type CityFilter = {
  status: CityStatus;
  requested: string | null;
  /** City labels exactly as stored, best match first. */
  matched: string[];
  /** What may be offered after the filter. */
  offered: OfferedUnitType[];
  /** Cities with at least one open unit, most openings first (city names and counts only). */
  citiesWithAvailability: Array<{ city: string; units_available: number }>;
  say: string | null;
  message: string | null;
};

/** Spoken list: "Albany", "Albany and Troy", "Albany, Schenectady and Troy". */
function sayList(items: string[], last = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

/** An area the caller named that we do not have, safe to read aloud: letters, spaces, hyphens, apostrophes. */
function spokenPlace(s: string): string | null {
  const t = s.replace(/[^A-Za-z' -]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return t || null;
}

/** At most this many other cities in one spoken sentence; the rest stay in cities_with_availability. */
const MAX_CITY_OPTIONS = 3;

const NO_DISTANCE_RULE =
  "Name only cities from cities_with_availability, at most three, most openings first. Never call " +
  "them nearby or close, and never say how far away anything is: there is no distance information. " +
  "If the caller picks one, call check_availability again with that city.";

function applyCity(offered: OfferedUnitType[], cities: string[], spoken: unknown): CityFilter {
  const requested = optString(spoken, 80) ?? null;
  const counts = new Map<string, number>();
  for (const t of offered) if (t.city) counts.set(t.city, (counts.get(t.city) ?? 0) + (t.count ?? 1));
  const withAvailability = [...counts.entries()]
    .map(([city, n]) => ({ city, units_available: n }))
    .sort((a, b) => b.units_available - a.units_available || a.city.localeCompare(b.city));
  const base = { requested, matched: [], offered, citiesWithAvailability: withAvailability, say: null, message: null };

  if (!requested) return { ...base, status: "not_given" };
  if (cities.length === 0) {
    return {
      ...base,
      status: "no_city_data",
      message:
        "No city is stored for these buildings yet, so this result is not narrowed to the caller's area. " +
        "Only say which city a unit is in when its address shows it.",
    };
  }
  const m = matchCities(requested, cities);
  if (m.status === "not_given") return { ...base, status: "not_given" };
  if (m.status === "no_preference") return { ...base, status: "no_preference" };

  const matched = m.status === "matched" ? m.cities : [];
  const wanted = new Set(matched.map((c) => c.toLowerCase()));
  const inArea = offered.filter((t) => t.city !== null && wanted.has(t.city.toLowerCase()));
  if (m.status === "matched" && inArea.length > 0) {
    return { ...base, status: "matched", matched, offered: inArea };
  }

  const others = withAvailability.filter((c) => !wanted.has(c.city.toLowerCase())).map((c) => c.city);
  const options = sayList(others.slice(0, MAX_CITY_OPTIONS));
  if (m.status === "matched") {
    const where = sayList(matched, "or");
    return {
      ...base,
      status: "none_available",
      matched,
      offered: [],
      say: others.length
        ? `I don't have anything open in ${where} right now. We do have openings in ${options}. Would any of those work?`
        : `I don't have anything open in ${where} right now. I can note your interest so the team can follow up.`,
      message: `Nothing is available in ${where} right now, so all_units is empty: do not offer any unit. ${NO_DISTANCE_RULE}`,
    };
  }
  const place = spokenPlace(requested) ?? "that area";
  return {
    ...base,
    status: "unknown_city",
    offered: [],
    say: others.length
      ? `We don't currently have properties in ${place}. We do have openings in ${options}. Would any of those work?`
      : `We don't currently have properties in ${place}. I can note your interest so the team can follow up.`,
    message: `There are no buildings in the area they named, so all_units is empty: do not offer any unit. ${NO_DISTANCE_RULE}`,
  };
}

/** One offered unit type as Sarah gets it in a tool result (sarahTools.offeredUnitForAgent). */
const offeredForAgent = offeredUnitForAgent;

const LEASING_FACTS_RULE =
  "When a unit has leasing_facts, describe it exactly as leasing_facts says. A unit with " +
  "bedrooms 'room' is one room in a shared apartment: never call it an apartment of that size. " +
  "address is where the building is and units names some of its available units: answer 'where is it' " +
  "from these, without another tool call.";

/**
 * The single building's leasing profile, or nulls when it does not apply. A team with several
 * buildings has no one "property" for the call (each offered unit carries its own community and
 * address), and pets / move-in window are only stated when someone actually entered them: the
 * imported rosters give neither, so Sarah must not invent a policy.
 */
async function leasingProfile(
  ctx: GenericActionCtx<DataModel>,
  orgId: string | undefined,
  property: { name: string; petsAllowed?: boolean; moveInWindowDays?: number; address?: { formatted: string } },
) {
  const count = orgId ? await ctx.runQuery(internal.sarahTools.orgPropertyCount, { orgId }) : 1;
  const single = count <= 1;
  const petsAllowed = single ? (property.petsAllowed ?? null) : null;
  const moveInWindowDays = single ? (property.moveInWindowDays ?? null) : null;
  return {
    propertyName: single ? property.name : null,
    propertyAddress: single ? (property.address?.formatted ?? null) : null,
    petsAllowed,
    moveInWindowDays,
    policyNote:
      petsAllowed === null || moveInWindowDays === null
        ? "pets_allowed or move_in_window_days is null: that policy has not been provided. Do not " +
          "state or guess a pet policy or move-in window; say the team will confirm it."
        : null,
  };
}

/** log_tenant_issue's call_type values. Anything else is dropped rather than stored. */
const CALL_TYPES = [
  "rent",
  "portal_login",
  "application",
  "eviction",
  "non_renewal",
  "renewal",
  "work_order_status",
  "vendor_payment",
  "neighbor_dispute",
  "other",
] as const;

/** log_maintenance_request's issue_type values. */
const ISSUE_TYPES = [
  "electrical",
  "water_leak",
  "broken_item",
  "gas",
  "fire",
  "flooding",
  "tenant_responsibility",
  "other",
] as const;

/**
 * The model's `answers` argument (key -> string) as the stored question/answer rows. Tolerates a
 * JSON string, because some tool-call layers stringify nested objects, and caps everything so a
 * runaway call can't write an unbounded record. The key doubles as the question label: the
 * agent names each key after what it asked (for example "breaker_checked").
 */
function parseAnswers(raw: unknown): Array<{ key: string; question: string; value: string }> {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: Array<{ key: string; question: string; value: string }> = [];
  for (const [k, value] of Object.entries(obj as Record<string, unknown>).slice(0, 30)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const key = k.trim().slice(0, 60);
    const text = String(value).trim().slice(0, 500);
    if (!key || !text) continue;
    out.push({ key, question: key.replace(/_/g, " "), value: text });
  }
  return out;
}

/**
 * Optional text argument: a bounded string with control characters turned into spaces and the
 * ends trimmed, or undefined for anything else or a placeholder.
 */
function optString(value: unknown, max = 500): string | undefined {
  return typeof value === "string"
    ? realValue(stripAudioTags(value.slice(0, max).replace(/[\u0000-\u001f\u007f]+/g, " ")))
    : undefined;
}

/** Optional e-mail argument: lower-cased, one address, sane length, or undefined. */
function optEmail(value: unknown): string | undefined {
  const email = optString(value, 200)?.toLowerCase();
  // Conservative on purpose: the address ends up in mailto: links, so no ? & , ; # or % (header/body injection).
  return email && /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email) ? email : undefined;
}

/** Optional number that may arrive as a numeric string. */
function optNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1e9 ? n : undefined;
}

/** Optional boolean that may arrive as "true"/"false". */
function optBool(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

/** Parsed request body; a malformed body reads as an empty one (the tool then reports what is missing). */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pat's leasing questions that are only ever recorded (build plan C8), as stored answer rows. */
function leasingCaptured(body: Record<string, unknown>) {
  const captured: Array<{ key: string; question: string; value: string | number | boolean }> = [];
  const add = (key: string, question: string, value: unknown) => {
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      captured.push({ key, question, value });
    } else if (typeof value === "string") {
      const text = optString(value, 500);
      if (text) captured.push({ key, question, value: text });
    }
  };
  add("capture_third_party_payer", "Will someone else be paying the rent?", optBool(body.third_party_payer) ?? body.third_party_payer);
  add("capture_payer_name", "Third-party payer name", body.payer_name);
  add("capture_payer_phone", "Third-party payer phone", body.payer_phone);
  add("capture_payer_email", "Third-party payer email", body.payer_email);
  add("capture_preferred_communities", "Preferred communities", body.preferred_communities);
  add("capture_avoid_communities", "Communities to avoid", body.avoid_communities);
  add("capture_pet_count", "Number of pets", body.pet_count);
  add("capture_other_info", "Other information", body.other_info);
  return captured;
}

/** Up to three spoken times, "Tuesday at 3pm, Wednesday at 10am or Thursday at 2pm". */
/**
 * What request_tour tells Sarah about the apartment a booked tour is for. `apartment` is undefined
 * when she named none, so nothing is said; otherwise the result says plainly what was recorded, so
 * she never claims a unit the tour is not for. Building and unit labels only, nothing about residents.
 */
function tourApartmentLines(apartment: FunctionReturnType<typeof internal.sarahTools.tourApartment> | null | undefined): {
  apartment: { property_address: string; unit: string | null } | null;
  message?: string;
} {
  if (!apartment) return { apartment: null };
  if (!apartment.property) {
    return {
      apartment: null,
      message:
        "Booked without a specific apartment: that building did not match one of ours exactly. Never say the " +
        "tour is for a particular building or unit; the team will go over it with them.",
    };
  }
  const where = { property_address: apartment.property.street, unit: apartment.unit?.label ?? null };
  if (apartment.unitStatus === "not_available") {
    return {
      apartment: where,
      message:
        `Booked for ${apartment.property.street}, but not for a specific unit: that unit is not one of the ` +
        "available units there. Never say a unit is set for the tour; the team will show them what is available.",
    };
  }
  return { apartment: where };
}

/**
 * On every booked / moved / corrected tour result: Sarah only ever states what the latest tour result
 * says. conv_0001m7acgw57fpwagbr0ydncsybk: she said a different building out loud while the booking and
 * the calendar event stayed at the old one.
 */
const TOUR_FACTS_RULE =
  "Never state a tour address, unit, day or time other than what this result says. If the caller says the " +
  "address or apartment is wrong, read back the listing from your results they mean (never an address that is " +
  "not in your results; if theirs is not, say it isn't showing as available and offer what is), and after their " +
  "yes call reschedule_tour with this tour_id, this slot_start, caller_confirmed true and that listing's address " +
  "as spoken_building (and spoken_unit). If that is not possible, say the team will confirm the address with them.";

/**
 * The apartment for a tour from what Sarah passed (sarahTools.tourApartment, this team's buildings and
 * available units only), shaped for bookTour / changeTourApartment. Undefined without a matched building.
 */
function tourApartmentInput(
  apartment: FunctionReturnType<typeof internal.sarahTools.tourApartment> | null | undefined,
) {
  if (!apartment?.property) return undefined;
  return {
    propertyId: apartment.property.id,
    propertyName: apartment.property.name,
    propertyAddress: apartment.property.address,
    unitId: apartment.unit?.id,
    unitLabel: apartment.unit?.label ?? undefined,
  };
}

/** changeTourApartment, where any failure means "not changed" (the team then confirms the address). */
async function tryChangeTourApartment(
  ctx: GenericActionCtx<DataModel>,
  orgId: string,
  tourId: Id<"tours">,
  input: NonNullable<ReturnType<typeof tourApartmentInput>>,
): Promise<{ status: "changed" | "failed" }> {
  try {
    return await changeTourApartment(ctx, orgId, tourId, input);
  } catch (err) {
    console.error(`[reschedule-tour] could not change the apartment of ${tourId}:`, err);
    return { status: "failed" };
  }
}

function sayTimes(times: Array<{ label: string }>): string {
  const labels = times.slice(0, 3).map((t) => t.label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * Which unit a resident-type call is about: the spoken property + unit, else the telephony caller
 * ID (never a number or e-mail the caller says; that lookup was removed on purpose).
 */
async function resolveCallUnit(
  ctx: GenericActionCtx<DataModel>,
  orgId: string,
  input: {
    spokenAddress?: string;
    spokenUnit?: string;
    callerId?: string;
  },
): Promise<{ unitId: Id<"units">; unitLabel: string } | null> {
  const spokenKey = input.spokenUnit ? normalizeUnitKey(input.spokenUnit) : "";
  const propertyId = await ctx.runQuery(internal.sarahTools.matchPropertyId, {
    orgId,
    spokenAddress: input.spokenAddress,
  });
  if (propertyId) {
    // Same rule as find_unit: an exact reading of the unit, or the only unit of a house.
    const found = await ctx.runQuery(internal.sarahTools.exactUnit, { orgId, propertyId, spokenUnit: input.spokenUnit });
    if (found) return found;
  }
  if (input.callerId) {
    // Caller ID must point at exactly one unit and must not contradict a unit the caller named.
    const matches = await ctx.runQuery(internal.residents.matchByPhone, { orgId, phone: input.callerId });
    const unitIds = [...new Set(matches.map((m) => m.unitId))];
    if (unitIds.length === 1) {
      const found = await ctx.runQuery(internal.residents.unitLabelOf, { orgId, unitId: unitIds[0] });
      if (found && (!spokenKey || normalizeUnitKey(found) === spokenKey)) {
        return { unitId: unitIds[0], unitLabel: found };
      }
    }
  }
  return null;
}

// Clerk → Convex user sync. Endpoint configured in the Clerk dashboard as
// https://<deployment>.convex.site/auth
http.route({
  path: "/auth",
  method: "POST",
  handler: httpAction(handleClerkWebhook),
});

// Google Calendar OAuth redirect. Registered on the Google OAuth client as an Authorized
// redirect URI: https://<deployment>.convex.site/google/oauth/callback
http.route({
  path: "/google/oauth/callback",
  method: "GET",
  handler: httpAction(handleGoogleOAuthCallback),
});

// --- Server tools (webhooks the ElevenLabs agent calls mid-conversation) --

/**
 * A lightweight, no-capture lookup so the agent can answer a standalone question like
 * "what's the rent for a 2BR?" at any point in the call, without first needing all five
 * qualification fields. check_qualification (below) is the one that captures a lead and
 * makes the qualify/disqualify decision — this tool never does either.
 */
http.route({
  path: "/tools/check-availability",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const bedrooms = typeof body.bedrooms === "string" ? body.bedrooms : undefined;
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined;
    const agentId = typeof body.agent_id === "string" ? body.agent_id : undefined;

    const orgId = await resolveBookingOrg(ctx, conversationId, agentId);
    const property = await ctx.runQuery(internal.properties.currentInternal, { orgId });
    // Only units that are open right now. An unavailable type is simply absent, so there is
    // nothing in the result for Sarah to offer by mistake.
    const all = await offeredWithCities(ctx, orgId, property);
    // The caller's city or area, matched against the cities in the team's own data. With none
    // given (or "anywhere") nothing is narrowed, exactly as before.
    const area = applyCity(all.offered, all.cities, body.city);
    const offered = area.offered;
    const requested = bedrooms ? offered.filter((t) => t.bedrooms === bedrooms) : [];
    // currentInternal can return the coded default, which has no address field at all.
    const profile = await leasingProfile(ctx, orgId, property as typeof property & { address?: { formatted: string } });
    const inArea = area.status === "matched" ? ` in ${sayList(area.matched, "or")}` : "";

    return Response.json({
      property_name: profile.propertyName,
      property_address: profile.propertyAddress,
      pets_allowed: profile.petsAllowed,
      move_in_window_days: profile.moveInWindowDays,
      ...(profile.policyNote ? { policy_note: profile.policyNote } : {}),
      leasing_facts_rule: LEASING_FACTS_RULE,
      requested_unit: requested.length > 0 ? { ...offeredForAgent(requested[0]), available: true } : null,
      city_requested: area.requested,
      city_status: area.status,
      city_matched: area.matched.length ? sayList(area.matched, "or") : null,
      matched_cities: area.matched,
      cities_with_availability: area.citiesWithAvailability,
      ...(area.say ? { say: area.say } : {}),
      ...(area.message
        ? { message: area.message }
        : bedrooms && requested.length === 0
          ? {
              message:
                `Nothing of that type is available${inArea} right now. Do not offer it. Offer the closest ` +
                "type in all_units, or offer to note their interest.",
            }
          : {}),
      all_units: offered.map((t) => ({ ...offeredForAgent(t), available: true })),
    });
  }),
});

/**
 * get_unit_details: what a prospect may ask about an AVAILABLE unit (bathrooms, floor, laundry,
 * heat and who pays for it). Only units with available = true are ever read, and nothing about
 * residents or owners is returned. The building is matched like find_unit's; a null field means the
 * roster does not say, and Sarah must not guess it.
 */
http.route({
  path: "/tools/get-unit-details",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const spokenAddress = optString(body.spoken_building, 300);
    const bedrooms = optString(body.bedrooms, 20)?.toLowerCase();
    const spokenUnit = optString(body.spoken_unit, 60);
    const askProperty = {
      status: "ask_property",
      units: [] as unknown[],
      say: "Which building is it, the street address or the name?",
      message: "No building yet. Ask the say line and wait, then call get_unit_details again with what they say.",
    };
    const orgId = await resolveBookingOrg(
      ctx,
      typeof body.conversation_id === "string" ? body.conversation_id : undefined,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    if (!orgId || !spokenAddress) return Response.json(askProperty);
    const r = await ctx.runQuery(internal.sarahTools.unitDetails, { orgId, spokenAddress, bedrooms, spokenUnit });

    if (r.status === "not_matched") {
      if (r.addressOptions.length > 0) {
        return Response.json({
          status: "needs_property_confirmation",
          candidates: r.addressOptions,
          units: [],
          say: r.addressOptions.length === 1 ? `Did you mean ${r.addressOptions[0]}?` : `Is that ${sayOptions(r.addressOptions)}?`,
          message:
            "No exact building match. Ask the say line as one question and let the caller choose; never pick for " +
            "them. When they confirm one, call get_unit_details again with exactly that address.",
        });
      }
      return Response.json({
        ...askProperty,
        say:
          r.addressOptionCount > 0 || r.addressStatus === "need_street"
            ? "We have several buildings like that. What's the street number?"
            : "I couldn't find that building. Could you say the street address again?",
        message:
          "No building matched and nothing is close enough to offer. If you sent a city or area rather than a " +
          "building (conv_0001m7acgw57fpwagbr0ydncsybk), do not say the say line and do not call again: answer from " +
          "the address and units in the available_units or check_availability results you already have. Otherwise " +
          "ask the say line once, then call get_unit_details again. If it still does not match, say the team will " +
          "follow up. Never read a list of buildings.",
      });
    }

    const base = { property_name: r.propertyName, property_address: r.propertyAddress };
    if (r.status !== "matched") {
      return Response.json({
        status: r.status,
        ...base,
        units: [],
        message:
          r.status === "none_available"
            ? "Nothing is available in this building right now. Say so, do not give any unit details, and offer to note their interest or check other buildings with check_availability."
            : "No available unit in this building fits that bedroom count or unit. Say so, do not give any unit details, and offer check_availability or to note their interest.",
      });
    }
    return Response.json({
      status: "matched",
      ...base,
      units_found: r.total,
      units: r.units.map((u) => ({
        unit_label: u.unitLabel,
        unit_type: u.unitType,
        bedrooms: u.bedrooms,
        rented_as: u.rentedAs,
        bathrooms: u.bathrooms,
        floor: u.floor,
        laundry: u.laundry,
        heating_fuel: u.heatingFuel,
        gas_paid_by: u.gasPaidBy,
        electric_paid_by: u.electricPaidBy,
        // Only when certain from the roster; null otherwise.
        heat_paid_by: u.heatPaidBy,
        rent: u.rent,
        available_from: u.availableFrom,
        leasing_facts: u.leasingFacts,
      })),
      message:
        "Answer only what the caller asked, from these fields. For any field that is null, say you don't have " +
        "that detail and the team will follow up: never guess or infer it. " + LEASING_FACTS_RULE +
        (r.total > r.units.length ? " More units match than are listed: ask which unit or bedroom count they mean." : ""),
    });
  }),
});

/**
 * The agent has gathered the five qualification fields; apply the property's actual rules
 * and tell it whether to offer a tour. Deterministic on purpose — this is the fair-housing
 * boundary (PRD §8): the model never decides qualification, this code does.
 */
http.route({
  path: "/tools/check-qualification",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      bedrooms,
      move_in_date: moveInDate,
      budget,
      pets_wanted: petsWanted,
      pet_type: petType,
      caller_name: callerName,
      caller_phone: callerPhone,
      screening_answers: screeningAnswersRaw,
    } = body;

    if (!conversationId) {
      return Response.json({ error: "missing conversation_id" }, { status: 400 });
    }

    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);
    const property = await ctx.runQuery(internal.properties.currentInternal, { orgId });

    const questions: ScreeningQuestion[] = await ctx.runQuery(
      internal.screening.activeForOrg,
      { orgId },
    );
    const screeningAnswers = coerceScreeningAnswers(questions, screeningAnswersRaw);

    // A question that decides qualification but has no usable answer is not a "no" — it is a
    // question that still needs asking. Deciding here would let a caller qualify purely
    // because the agent skipped something, so send the agent back rather than ruling.
    const missing = missingScreeningKeys(questions, screeningAnswers);
    if (missing.length > 0) {
      const stillNeeded = questions
        .filter((q) => missing.includes(q.key))
        .map((q) => q.question);
      return Response.json({
        qualifies: null,
        needs_more_info: true,
        still_needed: stillNeeded,
        message:
          "Do not state a qualification result yet. Ask the caller the questions in " +
          "still_needed, then call this tool again with those answers included.",
      });
    }

    // Pat's leasing questions that are only ever recorded (build plan C8). Stored beside the
    // property's own screening answers, which is what the lead view already renders.
    const captured = leasingCaptured(body);

    if (QUALIFICATION_MODE === "capture_only") {
      // Everything is recorded and staff decide. Nothing computed from the rules is stored or
      // returned: no qualifies flag, no reason, no near-miss. The agent has no rejection to
      // relay, and a lead is never auto-marked as turned away (PRD section 17).
      await ctx.runMutation(internal.qualifications.upsertByConversationId, {
        elevenLabsConversationId: conversationId,
        bedrooms,
        moveInDate,
        budget: typeof budget === "number" ? budget : undefined,
        petsWanted: typeof petsWanted === "boolean" ? petsWanted : undefined,
        petType,
        callerName,
        callerPhone,
        screeningAnswers: [
          ...screeningAnswers.map((a) => ({
            key: a.key,
            question: questions.find((q) => q.key === a.key)?.question ?? a.key,
            value: a.value,
          })),
          ...captured,
        ],
      });

      // Link the lead and send the "new lead" text if due (leads.routeLead; it never assigns: a lead
      // goes to a building's asset manager once a building is picked). Never allowed to fail the tool.
      if (orgId) {
        try {
          await ctx.runMutation(internal.leads.routeLead, { orgId, elevenLabsConversationId: conversationId });
        } catch (err) {
          console.error("[check-qualification] could not route lead:", err);
        }
      }

      const offered = await offeredUnitTypes(ctx, orgId, property);
      const matching = typeof bedrooms === "string" ? offered.filter((t) => t.bedrooms === bedrooms) : [];
      return Response.json({
        recorded: true,
        say:
          matching.length > 0 || typeof bedrooms !== "string"
            ? "Thanks, I've got that noted. Would you like to set up a tour?"
            : "Thanks, I've noted what you're looking for. I don't see that size open right now, but I can note your interest or look at other sizes.",
        property_name: (await leasingProfile(ctx, orgId, property)).propertyName,
        requested_type_available: matching.length > 0,
        leasing_facts_rule: LEASING_FACTS_RULE,
        available_units: offered.map(offeredForAgent),
        message:
          "Their answers are recorded and the team will review them. Never tell the caller they do " +
          "or do not qualify, and never give a reason they might not. " +
          (matching.length > 0
            ? "Something of the type they asked for is available, so offer a tour."
            : "Nothing of the type they asked for is available right now. Say so, offer the closest " +
              "type in available_units or to note their interest, and offer a tour if they want one."),
      });
    }

    // Shared with the WhatsApp bot on purpose — see convex/qualifyRules.ts. Two copies of
    // this decision would let the same person be told "yes" on one channel and "no" on the
    // other.
    const { qualifies, disqualifyReason, nearMiss, nearMissBudgetTarget } = evaluateQualification(
      property,
      {
        bedrooms,
        budget: typeof budget === "number" ? budget : undefined,
        petsWanted: typeof petsWanted === "boolean" ? petsWanted : undefined,
      },
      questions,
      screeningAnswers,
    );

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      bedrooms,
      moveInDate,
      budget: typeof budget === "number" ? budget : undefined,
      petsWanted: typeof petsWanted === "boolean" ? petsWanted : undefined,
      petType,
      callerName,
      callerPhone,
      qualifies,
      disqualifyReason,
      nearMiss,
      // Every answer, criteria or not — the capture-only ones exist precisely so the manager
      // can read them on the lead.
      screeningAnswers: screeningAnswers.map((a) => ({
        key: a.key,
        question: questions.find((q) => q.key === a.key)?.question ?? a.key,
        value: a.value,
      })),
    });

    return Response.json({
      qualifies,
      reason: disqualifyReason ?? null,
      // Only meaningful alongside qualifies: false. Never changes the decision, only how you
      // talk about it — see the TONE FOR DISQUALIFICATIONS block in your instructions.
      near_miss: qualifies === false ? (nearMiss ?? false) : false,
      // Set only for a near miss on budget specifically. The exact real minimum for that unit —
      // ask if they can go up to this number before anything else, never a different figure.
      near_miss_budget_target: qualifies === false && nearMiss ? (nearMissBudgetTarget ?? null) : null,
      property_name: (await leasingProfile(ctx, orgId, property)).propertyName,
      available_units: (await offeredUnitTypes(ctx, orgId, property)).map(offeredForAgent),
      leasing_facts_rule: LEASING_FACTS_RULE,
    });
  }),
});

/**
 * Real open tour times, for the agent to offer. Read-only: nothing is held or booked until
 * request_tour, so a time offered here can still be gone by then — request_tour handles that.
 */
http.route({
  path: "/tools/find-tour-times",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const conversationId: string | undefined = body.conversation_id;
    const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;

    // No day yet means the caller has not been asked. Return no times at all, so there is
    // nothing to read out — only the instruction to ask.
    if (!date) {
      return Response.json({
        needs_date: true,
        times: [],
        say: "What day and time would work best for you?",
        message:
          "Do not suggest any days or times. Ask the caller what day and time would suit them, " +
          "then call find_tour_times again with that date, and time if they gave one.",
      });
    }

    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);

    // Moving an existing tour: it must not block the times around it.
    let ignoreTour: IgnoredTour | undefined;
    let tourPropertyId: Id<"properties"> | undefined;
    if (orgId && typeof body.tour_id === "string" && body.tour_id) {
      const tour = await ctx.runQuery(internal.tours.byIdString, { tourId: body.tour_id });
      if (tour && tour.orgId === orgId && tour.status === "booked") {
        ignoreTour = { id: tour._id, assignedUserId: tour.assignedUserId, start: tour.start, end: tour.end };
        tourPropertyId = tour.propertyId;
      }
    }

    // The building the caller chose, matched exactly as request_tour does (this team's buildings only):
    // the times come from that building's team's tour list, so a time offered here can be booked there.
    // No building: today's pool. Moving a tour with no building named: the tour's own building.
    const spokenBuilding = optString(body.spoken_building, 300);
    const spokenUnit = optString(body.spoken_unit, 60);
    const chosen =
      orgId && (spokenBuilding || spokenUnit)
        ? await ctx.runQuery(internal.sarahTools.tourApartment, { orgId, spokenAddress: spokenBuilding, spokenUnit })
        : null;

    // The caller picked a building for a new tour: the lead goes to its asset manager now (B41), even if
    // no tour is booked in the end. Moving an existing tour routes in reschedule_tour instead.
    if (orgId && typeof conversationId === "string" && conversationId && chosen?.property && !ignoreTour) {
      try {
        await ctx.runMutation(internal.leads.routeLeadToBuilding, {
          orgId,
          elevenLabsConversationId: conversationId,
          propertyId: chosen.property.id,
        });
      } catch (err) {
        console.error("[find-tour-times] could not route the lead to the building:", err);
      }
    }

    const result = await findTourTimes(
      ctx,
      orgId,
      date,
      typeof body.time === "string" ? body.time : undefined,
      ignoreTour,
      chosen?.property?.id ?? tourPropertyId,
    );

    if (!result.available) {
      // Nobody on that team can be booked (or booking is not set up): today's fallback, unchanged.
      return Response.json({
        booking_available: false,
        say: "I can't see the calendar right now. What day and time would you like? I'll pass it to the team and they'll confirm.",
        message:
          "Booking isn't available right now. Ask for their preferred day and time and call " +
          "request_tour with it as preferred_slot; the team will confirm with them.",
      });
    }

    if (conversationId) {
      await ctx.runMutation(internal.tours.recordTimeCheck, {
        elevenLabsConversationId: conversationId,
        starts: result.times.map((t) => t.start),
      });
    }

    const requested = result.requested;

    // "Taken" by their own tour is a different conversation from "taken" by someone else.
    let ownTour: CallerTourRow | undefined;
    if (requested && !requested.open && orgId) {
      const mine = await ctx.runQuery(internal.tours.upcomingForCaller, {
        orgId,
        elevenLabsConversationId: conversationId,
        phoneKeys: await conversationPhoneKeys(ctx, conversationId),
      });
      ownTour = mine.find((t) => t.id !== ignoreTour?.id && formatLocalDateTime(t.start, t.timeZone) === requested.start);
    }

    const why: Record<string, string> = {
      passed: "That time has already passed.",
      too_soon: "Tours need at least two hours' notice, so that time is too soon.",
      outside_hours: "That time is outside the team's tour hours.",
      taken: "That time is already taken.",
    };
    const offer =
      result.times.length === 0
        ? "Nothing else is open in the next week, so offer to have the team call them back."
        : result.sameDay
          ? "Offer the times listed, which are on the day they asked for."
          : "Nothing is open on the day they asked for, so say that, then offer the times listed and say which day each is on.";

    const say = requested?.open
      ? `${requested.label} is open. Shall I book that for you?`
      : requested && ownTour
        ? `You already have a tour booked at ${requested.label}. Would you like to keep it or pick another time?`
        : result.times.length === 0
          ? "I don't see anything open in the next week. Would you like the team to call you back to set one up?"
          : `${requested ? `${why[requested.reason]} ` : ""}${requested ? "I can do" : "I have"} ${sayTimes(result.times)}. Which works for you?`;

    return Response.json({
      booking_available: true,
      say,
      time_zone: result.timeZone,
      requested_time: requested
        ? { start: requested.start, label: requested.label, available: requested.open, reason: requested.reason }
        : null,
      callers_own_tour: ownTour ? tourSummary(ownTour) : null,
      same_day: result.sameDay,
      times: result.times,
      message: requested?.open
        ? "The exact time they asked for is open. Read it back and get a yes, then book requested_time.start."
        : requested
          ? ownTour
            ? "The caller already has their own tour booked at exactly that time (callers_own_tour). Tell them " +
              "that, and ask whether they want to keep it or pick a different time."
            : `${why[requested.reason]} Tell them that. ${offer}`
          : offer,
    });
  }),
});

/**
 * Books a tour for a qualified caller: slot_start (a time find_tour_times offered) goes straight
 * into the calendar of whoever on the team is free and has the fewest tours that week.
 *
 * preferred_slot without slot_start is the fallback for a team that has not set booking up —
 * the time is captured on the lead for someone to confirm, exactly as before booking existed.
 * No SMS in either case: confirmation texts are still switched off.
 */
http.route({
  path: "/tools/request-tour",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      agent_id: agentId,
      slot_start: slotStart,
      preferred_slot: preferredSlot,
      caller_name: callerName,
      caller_phone: rawCallerPhone,
      caller_id: callerId,
    } = body;
    // Stored and matched as E.164 like every other phone; what the caller said is kept as given
    // only when it is not a valid number, so nothing they said is lost.
    const callerPhone = typeof rawCallerPhone === "string" ? (toE164(rawCallerPhone) ?? rawCallerPhone) : rawCallerPhone;

    if (!conversationId || (!slotStart && !preferredSlot) || !callerPhone) {
      return Response.json(
        { error: "missing conversation_id, caller_phone, or one of slot_start / preferred_slot" },
        { status: 400 },
      );
    }

    if (slotStart) {
      // Both checks run before anything touches a calendar. The model on a call does not get to
      // book a time the caller never heard read back, or one from an older list than the latest.
      if (!isConfirmed(body.caller_confirmed)) {
        return Response.json({
          booked: false,
          reason:
            "Not booked yet. Read the exact day and time back to the caller, wait for a clear yes, " +
            "then call request_tour again with caller_confirmed set to true.",
        });
      }
      const offered = await ctx.runQuery(internal.tours.lastTimeCheck, {
        elevenLabsConversationId: conversationId,
      });
      if (!offered || !offered.includes(slotStart)) {
        return Response.json({
          booked: false,
          reason:
            "Not booked. That time is not in your latest find_tour_times result. Call find_tour_times " +
            "with the day and time the caller wants, then book one of the times it returns.",
        });
      }

      const orgId = await resolveBookingOrg(ctx, conversationId, agentId);

      // A caller may have more than one tour, but never without knowing about the ones they already
      // have: the first attempt stops here so the agent has to mention them. Most people who hear
      // "you already have one on Tuesday" decide to move or cancel it; the rest say yes, book
      // this one as well, and the agent calls again with also_book.
      if (orgId && !isConfirmed(body.also_book)) {
        const existing = await ctx.runQuery(internal.tours.upcomingForCaller, {
          orgId,
          elevenLabsConversationId: conversationId,
          phoneKeys: await conversationPhoneKeys(ctx, conversationId, callerId, callerPhone),
        });
        if (existing.length > 0) {
          return Response.json({
            booked: false,
            existing_tours: existing.slice(0, 3).map(tourSummary),
            reason:
              "Not booked yet. This caller already has the upcoming tours in existing_tours. Tell them when " +
              "they are, then ask whether they want to book this new tour as well. If yes, call request_tour " +
              "again with also_book set to true. If they would rather move or cancel an existing tour, use " +
              "reschedule_tour or cancel_tour instead.",
          });
        }
      }

      // The apartment the caller chose, matched on this team's own buildings and AVAILABLE units
      // only. Anything that does not match exactly is left off and the tour is still booked.
      const spokenBuilding = optString(body.spoken_building, 300);
      const spokenUnit = optString(body.spoken_unit, 60);
      const apartment =
        orgId && (spokenBuilding || spokenUnit)
          ? await ctx.runQuery(internal.sarahTools.tourApartment, { orgId, spokenAddress: spokenBuilding, spokenUnit })
          : null;

      const result = await bookTour(ctx, orgId, {
        slotStart,
        callerName,
        callerPhone,
        elevenLabsConversationId: conversationId,
        apartment: tourApartmentInput(apartment),
      });

      if (result.status === "booked") {
        await ctx.runMutation(internal.qualifications.upsertByConversationId, {
          elevenLabsConversationId: conversationId,
          callerName,
          callerPhone,
          tourSlot: `${result.label} with ${result.memberFirstName}`,
          tourConfirmed: true,
        });
        // The lead goes to the chosen building's asset manager (never to the tour host); the host, the
        // lead's owner and the admins are told about the tour.
        if (orgId) {
          try {
            await ctx.runMutation(internal.leads.leadTourBooked, {
              orgId,
              elevenLabsConversationId: conversationId,
              userId: result.memberUserId,
              propertyId: apartment?.property?.id,
              callerName: optString(callerName, 120),
              callerPhone: optString(callerPhone, 40),
              when: result.label,
              notify: true,
            });
          } catch (err) {
            console.error("[request-tour] booked, but could not assign the lead:", err);
          }
        }
        const lines = tourApartmentLines(spokenBuilding || spokenUnit ? apartment : undefined);
        // Only the building the caller chose, never the team's first one: with none matched there is
        // no property_name / property_address at all and the say line leaves the address to the team.
        const chosen = apartment?.property ?? null;
        return Response.json({
          booked: true,
          tour_id: result.tourId,
          slot_start: slotStart,
          when: result.label,
          team_member: result.memberFirstName,
          ...(chosen ? { property_name: chosen.name, property_address: chosen.address } : {}),
          apartment: lines.apartment,
          say: tourBookedSay({
            when: result.label,
            memberFirstName: result.memberFirstName,
            address: chosen?.address,
            unitLabel: apartment?.unit?.label,
          }),
          message: [
            lines.message ??
              (chosen
                ? null
                : "Booked with no specific apartment. Say the say line: the team will confirm the address. Never name a building or address for this tour yourself."),
            TOUR_FACTS_RULE,
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
      if (result.status === "taken") {
        await ctx.runMutation(internal.tours.recordTimeCheck, {
          elevenLabsConversationId: conversationId,
          starts: result.otherTimes.map((t) => t.start),
        });
        return Response.json({
          booked: false,
          reason: "That time is no longer open.",
          other_times: result.otherTimes,
          say:
            result.otherTimes.length > 0
              ? `Sorry, that time just got taken. I can do ${sayTimes(result.otherTimes)}. Which works?`
              : "Sorry, that time just got taken, and I don't see anything else close by. Would you like the team to call you back?",
        });
      }
      if (result.status === "invalid") {
        return Response.json({ booked: false, reason: result.reason });
      }
      // "unavailable": booking is not set up for this team. Capture it instead, if the agent
      // gave us a spoken time to capture.
      if (!preferredSlot) {
        return Response.json({
          booked: false,
          booking_available: false,
          message: "Ask for their preferred day and time and call request_tour again with preferred_slot.",
        });
      }
    }

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      callerName,
      callerPhone,
      tourSlot: preferredSlot,
      tourConfirmed: true,
    });

    // A preferred time for a building the caller picked: the lead goes to that building's asset manager.
    const captureBuilding = optString(body.spoken_building, 300);
    if (captureBuilding) {
      try {
        const captureOrgId = await resolveBookingOrg(ctx, conversationId, agentId);
        const picked = captureOrgId
          ? await ctx.runQuery(internal.sarahTools.tourApartment, {
              orgId: captureOrgId,
              spokenAddress: captureBuilding,
              spokenUnit: optString(body.spoken_unit, 60),
            })
          : null;
        if (captureOrgId && picked?.property) {
          await ctx.runMutation(internal.leads.routeLeadToBuilding, {
            orgId: captureOrgId,
            elevenLabsConversationId: conversationId,
            propertyId: picked.property.id,
          });
        }
      } catch (err) {
        console.error("[request-tour] preferred time noted, but could not route the lead:", err);
      }
    }

    // Disabled: tour confirmation SMS to the customer — turned off per request. The tour is
    // still captured above and visible in the dashboard; only the outbound text is skipped.
    // Re-enable by uncommenting this block (and the property lookup it needs).
    // const property = await ctx.runQuery(internal.properties.currentInternal, {});
    const smsSent = false;
    try {
      // await ctx.runAction(internal.notifications.sendTourConfirmation, {
      //   to: callerPhone,
      //   propertyName: property.name,
      //   slot: preferredSlot,
      // });
    } catch {
      // The tour is still captured even if the SMS fails to send — the agent should not
      // tell the caller the request failed over a texting problem.
    }

    return Response.json({
      booked: false,
      captured: true,
      sms_sent: smsSent,
      say: "I've noted your preferred time and the team will confirm it with you.",
      message: "Their preferred time is noted. Tell them the team will confirm the tour with them.",
    });
  }),
});

/**
 * The caller's upcoming tours: booked earlier on this call, or on another call under the same
 * phone number (caller ID, or the number they give). What cancel_tour and reschedule_tour act on.
 */
http.route({
  path: "/tools/find-my-tour",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const orgId = await resolveBookingOrg(ctx, body.conversation_id, body.agent_id);
    if (!orgId) {
      return Response.json({
        found: false,
        tours: [],
        message: "Bookings can't be looked up on this call. Offer to have the team call them back.",
      });
    }

    const keys = await conversationPhoneKeys(ctx, body.conversation_id, body.caller_id, body.caller_phone);
    const tours = await ctx.runQuery(internal.tours.upcomingForCaller, {
      orgId,
      elevenLabsConversationId: body.conversation_id,
      phoneKeys: keys,
    });

    if (tours.length === 0) {
      return Response.json({
        found: false,
        tours: [],
        message: body.caller_phone
          ? "No upcoming tour under that number. Ask once whether they booked with a different number; " +
            "if not, say you can't find a booking and offer to have the team call them back."
          : "No booking found on this call. Ask for the phone number they booked with, then call " +
            "find_my_tour again with it as caller_phone.",
      });
    }

    return Response.json({
      found: true,
      tours: tours.slice(0, 3).map(tourSummary),
      message:
        tours.length === 1
          ? "Read this tour's day and time back and confirm it is the one they mean."
          : "Read these back and ask which one they mean.",
    });
  }),
});

/** Cancels the caller's own upcoming tour: its Google event goes, and the tour is marked cancelled. */
http.route({
  path: "/tools/cancel-tour",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    if (!body.conversation_id || !body.tour_id) {
      return Response.json({ error: "missing conversation_id or tour_id" }, { status: 400 });
    }
    if (!isConfirmed(body.caller_confirmed)) {
      return Response.json({
        cancelled: false,
        reason:
          "Not cancelled yet. Read the tour's day and time back, confirm they want it cancelled, then " +
          "call cancel_tour again with caller_confirmed set to true.",
      });
    }

    const target = await findCallerTour(ctx, body);
    if (!target) {
      return Response.json({
        cancelled: false,
        reason: "No upcoming tour with that tour_id belongs to this caller. Call find_my_tour and use a tour_id it returns.",
      });
    }

    const when = spokenLabel(target.tour.start, target.tour.timeZone);
    try {
      await cancelTourNow(ctx, target.tour.id);
    } catch (err) {
      console.error(`[cancel-tour] could not cancel ${target.tour.id}:`, err);
      return Response.json({
        cancelled: false,
        reason: "It could not be cancelled right now. Apologize and offer to have the team call them back.",
      });
    }

    // The lead the tour was booked on should no longer read as a booked tour.
    if (target.tour.elevenLabsConversationId) {
      await ctx.runMutation(internal.qualifications.upsertByConversationId, {
        elevenLabsConversationId: target.tour.elevenLabsConversationId,
        tourSlot: `${when} with ${target.tour.memberFirstName} (cancelled)`,
        tourConfirmed: false,
      });
    }

    return Response.json({ cancelled: true, when });
  }),
});

/**
 * Moves the caller's own upcoming tour to a new time. The same guards as booking: the caller
 * heard the new time read back and said yes, and it came from the latest find_tour_times result.
 */
http.route({
  path: "/tools/reschedule-tour",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const { conversation_id: conversationId, tour_id: tourId, slot_start: slotStart } = body;
    // A building or unit means the caller is correcting which apartment the tour is for.
    const spokenBuilding = optString(body.spoken_building, 300);
    const spokenUnit = optString(body.spoken_unit, 60);
    const correcting = Boolean(spokenBuilding || spokenUnit);
    if (!conversationId || !tourId || (!slotStart && !correcting)) {
      return Response.json({ error: "missing conversation_id, tour_id or slot_start" }, { status: 400 });
    }
    if (!isConfirmed(body.caller_confirmed)) {
      return Response.json({
        rescheduled: false,
        reason: correcting
          ? "Not changed yet. Read the building back to the caller, wait for a clear yes, then call " +
            "reschedule_tour again with caller_confirmed set to true."
          : "Not moved yet. Read the new day and time back to the caller, wait for a clear yes, then call " +
            "reschedule_tour again with caller_confirmed set to true.",
      });
    }

    // Same day and time (or none sent) with a building: only the apartment changes. The tour must be
    // this caller's (findCallerTour), the building one of this team's (tourApartment), and the change
    // reaches the booking and its calendar event, or nothing changes and the team confirms the address.
    if (correcting) {
      const target = await findCallerTour(ctx, body);
      if (!target) {
        return Response.json({
          rescheduled: false,
          reason: "No upcoming tour with that tour_id belongs to this caller. Call find_my_tour and use a tour_id it returns.",
        });
      }
      const currentSlot = formatLocalDateTime(target.tour.start, target.tour.timeZone);
      if (!slotStart || slotStart === currentSlot) {
        const when = spokenLabel(target.tour.start, target.tour.timeZone);
        const apartment = await ctx.runQuery(internal.sarahTools.tourApartment, {
          orgId: target.orgId,
          spokenAddress: spokenBuilding,
          spokenUnit,
        });
        const input = tourApartmentInput(apartment);
        const changed = input ? await tryChangeTourApartment(ctx, target.orgId, target.tour.id, input) : null;
        if (!input || changed?.status !== "changed") {
          return Response.json({
            rescheduled: false,
            apartment_changed: false,
            when,
            say: TOUR_ADDRESS_NOT_CHANGED_SAY,
            message:
              (input
                ? "The apartment could not be changed right now. "
                : "That building did not match one of ours exactly, so the tour was not changed. ") +
              "Say the say line. Never name a building or address for this tour yourself.",
          });
        }
        // The caller switched buildings: the lead follows to the new building's asset manager (B41).
        try {
          await ctx.runMutation(internal.leads.routeLeadToBuilding, {
            orgId: target.orgId,
            elevenLabsConversationId: target.tour.elevenLabsConversationId ?? conversationId,
            propertyId: input.propertyId,
          });
        } catch (err) {
          console.error("[reschedule-tour] apartment changed, but could not route the lead:", err);
        }
        const lines = tourApartmentLines(apartment);
        return Response.json({
          rescheduled: false,
          apartment_changed: true,
          tour_id: target.tour.id,
          slot_start: currentSlot,
          when,
          property_name: input.propertyName,
          property_address: input.propertyAddress,
          apartment: lines.apartment,
          say: tourApartmentChangedSay({ when, address: input.propertyAddress, unitLabel: input.unitLabel }),
          message: [lines.message, TOUR_FACTS_RULE].filter(Boolean).join(" "),
        });
      }
    }

    const offered = await ctx.runQuery(internal.tours.lastTimeCheck, { elevenLabsConversationId: conversationId });
    if (!offered || !offered.includes(slotStart)) {
      return Response.json({
        rescheduled: false,
        reason:
          "Not moved. That time is not in your latest find_tour_times result. Call find_tour_times with " +
          "the day and time they want and this tour_id, then use a time it returns.",
      });
    }

    const target = await findCallerTour(ctx, body);
    if (!target) {
      return Response.json({
        rescheduled: false,
        reason: "No upcoming tour with that tour_id belongs to this caller. Call find_my_tour and use a tour_id it returns.",
      });
    }

    const previousTime = spokenLabel(target.tour.start, target.tour.timeZone);
    // A corrected building is matched first: its team's tour list gives the moved tour (else the tour's own).
    const correctedApartment = correcting
      ? await ctx.runQuery(internal.sarahTools.tourApartment, {
          orgId: target.orgId,
          spokenAddress: spokenBuilding,
          spokenUnit,
        })
      : null;
    const result = await rescheduleTour(ctx, target.orgId, {
      tour: target.tour,
      slotStart,
      propertyId: correctedApartment?.property?.id,
    });
    // A new time AND a corrected building: the time moves first, then the apartment (same rules as above).
    let corrected: { input: NonNullable<ReturnType<typeof tourApartmentInput>>; unitMessage?: string } | null = null;
    if (result.status === "booked" && correcting && correctedApartment) {
      const apartment = correctedApartment;
      const input = tourApartmentInput(apartment);
      if (input && (await tryChangeTourApartment(ctx, target.orgId, target.tour.id, input)).status === "changed") {
        corrected = { input, unitMessage: tourApartmentLines(apartment).message };
      }
    }

    if (result.status === "booked") {
      if (target.tour.elevenLabsConversationId) {
        await ctx.runMutation(internal.qualifications.upsertByConversationId, {
          elevenLabsConversationId: target.tour.elevenLabsConversationId,
          tourSlot: `${result.label} with ${result.memberFirstName}`,
          tourConfirmed: true,
        });
      }
      // The lead goes to the tour building's asset manager (the corrected one, else the tour's own); a
      // tour that moved to a different person is texted to them, the lead's owner and the admins.
      const leadConversationId = target.tour.elevenLabsConversationId ?? conversationId;
      try {
        await ctx.runMutation(internal.leads.leadTourBooked, {
          orgId: target.orgId,
          elevenLabsConversationId: leadConversationId,
          userId: result.memberUserId,
          propertyId: corrected?.input.propertyId ?? target.tour.propertyId ?? undefined,
          callerName: target.tour.callerName,
          callerPhone: target.tour.callerPhone,
          when: result.label,
          notify: result.memberUserId !== target.tour.assignedUserId,
        });
      } catch (err) {
        console.error("[reschedule-tour] moved, but could not assign the lead:", err);
      }
      // The address only when the tour is for a chosen building (its own, or the one just corrected).
      const address = corrected?.input.propertyAddress ?? result.propertyAddress;
      return Response.json({
        rescheduled: true,
        tour_id: result.tourId,
        slot_start: slotStart,
        previous_time: previousTime,
        when: result.label,
        team_member: result.memberFirstName,
        ...(address ? { property_address: address } : {}),
        ...(correcting ? { apartment_changed: corrected !== null } : {}),
        say: corrected
          ? `Done. I've moved your tour to ${result.label} with ${result.memberFirstName}, at ${corrected.input.propertyAddress}.`
          : correcting
            ? `Done. I've moved your tour to ${result.label} with ${result.memberFirstName}. ${TEAM_CONFIRMS_ADDRESS}`
            : `Done. I've moved your tour to ${result.label} with ${result.memberFirstName}.`,
        message: [corrected?.unitMessage, TOUR_FACTS_RULE].filter(Boolean).join(" "),
      });
    }
    if (result.status === "taken") {
      await ctx.runMutation(internal.tours.recordTimeCheck, {
        elevenLabsConversationId: conversationId,
        starts: result.otherTimes.map((t) => t.start),
      });
      return Response.json({ rescheduled: false, reason: "That time is no longer open.", other_times: result.otherTimes });
    }
    return Response.json({ rescheduled: false, reason: result.reason });
  }),
});

/**
 * Hands the call to a human: texts the team's staff through the notification service and marks
 * the call so it's unmissable in the dashboard.
 */
http.route({
  path: "/tools/escalate",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      reason,
      summary,
      caller_name: callerName,
      caller_phone: callerPhone,
      living_area: livingArea,
    } = body;

    if (!conversationId || !reason) {
      return Response.json({ error: "missing conversation_id or reason" }, { status: 400 });
    }

    const fullSummary = [
      summary ?? "",
      callerName ? `Name: ${callerName}.` : "",
      callerPhone ? `Phone: ${callerPhone}.` : "",
      livingArea ? `Area: ${livingArea}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Escalation alerts go out through the notification service (convex/notify.ts) to the
    // team's staff, replacing the old direct-SMS block that was switched off. Each send is
    // logged there, and a failure to enqueue or deliver can't fail the call: the dashboard marks
    // the call as escalated below either way. SMS bodies carry a first name and unit only.
    const isResidentIssue = reason === "urgent_tenant_issue";
    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);
    let notified = false;
    let alreadyCovered = false;
    if (orgId) {
      try {
        const result = await ctx.runMutation(internal.sarahTools.notifyEscalation, {
          orgId,
          elevenLabsConversationId: conversationId,
          callerName: optString(callerName, 120),
          unit: optString(livingArea, 60),
          residentIssue: isResidentIssue,
        });
        notified = result.notified;
        alreadyCovered = result.alreadyNotified;
      } catch (err) {
        console.error("[escalate] could not notify staff:", err);
      }
    } else if (isResidentIssue) {
      // Team not resolved yet: a life-safety escalation still alerts this deployment's admins.
      try {
        notified = await ctx.runMutation(internal.sarahTools.alertEmergencyUnresolvedOrg, {
          elevenLabsConversationId: conversationId,
          unit: optString(livingArea, 60),
        });
      } catch (err) {
        console.error("[escalate] could not alert admins:", err);
      }
    }

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      callerName,
      callerPhone,
    });
    await ctx.runMutation(internal.conversations.markEscalation, {
      elevenLabsConversationId: conversationId,
      reason,
      summary: fullSummary,
      escalatedTo: orgId ? "staff" : "unassigned", // the hand-off is in the dashboard; `notified` is only about texts
    });

    // A resident emergency (fire, gas leak, break-in) is escalated straight away rather than
    // going through log_tenant_issue first — that's by design, so the agent doesn't stop to ask
    // triage questions while someone's building is on fire. But without a tenantIssues row this
    // call has nothing to make isResidentCall recognise it as a resident call, so it fell into
    // the Leads list instead of the Tenants page. Logging it here, at max severity, is what puts
    // it on the right page.
    // Not when log_maintenance_request already filed this call as an emergency or urgent request:
    // that request is the record, and a second Tenants-page row would duplicate it.
    if (isResidentIssue && !alreadyCovered) {
      await ctx.runMutation(internal.tenants.logIssue, {
        elevenLabsConversationId: conversationId,
        callerName,
        unit: livingArea,
        callerNumber: realPhone(callerPhone),
        callbackNumber: realPhone(callerPhone),
        reason: summary ?? "Escalated as an urgent tenant issue.",
        category: "emergency",
        severity: 10,
        severityReason: "Escalated directly to a human as an urgent tenant issue.",
        // A fallback, not an overwrite: if Sarah already logged this call the row she wrote is
        // more specific than anything reconstructable here, so it wins.
        onlyIfAbsent: true,
      });
    }

    return Response.json({
      escalated: true,
      staff_notified: notified,
      team_alerted: notified,
      message: WAIT_FOR_CALLER,
    });
  }),
});

// --- Owner call menu (Sarah Configuration section 13) ------------------------
//
// These tools are attached to the agent only while the owner call menu is live (agents.ts), and they
// read the PUBLISHED config. Verification (property + email on file) and availability are decided
// here, never by the model. check_staff_availability gives a transfer number only to a call with a
// verified owner, and that number is what the transfer tool dials (a dynamic variable assigned from
// its transfer_number). Every response carries transfer_number, "none" unless available, so a
// refusal also clears the destination. No text is sent to anyone.

/**
 * verify_owner: is this caller an owner of the property they named? No address (or only a keypad
 * digit) -> ask_property, nothing counted. Address only -> the property to confirm (or options). Address + email -> verified / not_verified / no_match_take_message. Never
 * returns or hints at a stored email, and never says which part failed.
 */
http.route({
  path: "/tools/verify-owner",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const address = optString(body.spoken_property_address, 200) ?? "";
    const email = optString(body.email, 200);
    const callerName = optString(body.caller_name, 80);
    const takeMessage = {
      verified: false,
      status: "no_match_take_message",
      say: "I'm sorry, I can't put you through right now, but I can take a message and have them call you back.",
      message:
        "Say the say line. Then take a message: their name, the best callback number (read it back), and what it is " +
        "about, one question each, skipping what they already said. Then call take_staff_message. Do not transfer.",
    };
    const orgId = await resolveBookingOrg(ctx, conversationId, typeof body.agent_id === "string" ? body.agent_id : undefined);
    if (!orgId) return Response.json(takeMessage);
    let r: FunctionReturnType<typeof internal.ownerRouting.verifyOwner>;
    try {
      r = await ctx.runMutation(internal.ownerRouting.verifyOwner, {
        orgId,
        elevenLabsConversationId: conversationId,
        spokenAddress: address,
        email,
        callerName,
      });
    } catch (err) {
      console.error("[verify-owner] failed:", err);
      return Response.json(takeMessage);
    }
    if (r.status === "ask_property") {
      return Response.json({
        verified: false,
        status: "ask_property",
        say: r.say,
        message:
          "No property yet; nothing was checked or counted. Ask the say line and wait. Call verify_owner again only " +
          "with the address the caller says. Do not read the phone menu yet.",
      });
    }
    if (r.status === "verified") {
      return Response.json({
        verified: true,
        status: "verified",
        say: r.say,
        message:
          "Verified. If they already named who they want, confirm it or call check_staff_availability with them. " +
          "Otherwise say the say line, then the phone menu word for word, and wait. Do not read any of this out.",
      });
    }
    if (r.status === "needs_property_confirmation") {
      return Response.json({
        verified: false,
        status: "needs_property_confirmation",
        candidates: r.candidates,
        say: r.say,
        message: r.candidates.length
          ? "Ask the say line as one question and wait. When they confirm an address, use it as spoken_property_address " +
            "from now on. If you have no email yet, ask for the email address on file next."
          : "Ask the say line and wait for their answer, then call verify_owner again with it. After two tries without " +
            "a property, say you can take a message instead and take one with take_staff_message.",
      });
    }
    if (r.status === "not_verified") {
      return Response.json({
        verified: false,
        status: "not_verified",
        attempts_left: r.attemptsLeft,
        say: r.say,
        message:
          "Say the say line. Read the email back in spoken form, let them correct it, then call verify_owner again " +
          "with the same address and that email. Never say which part did not match and never hint at any email on file.",
      });
    }
    return Response.json({ ...takeMessage, say: r.say });
  }),
});

/** Every refusal resets the transfer destination variables (see ownerRoutingLib.transferAssignmentValues). */
const NO_TRANSFER = (() => {
  const t = transferAssignmentValues(null);
  return { transfer_number: t.number, transfer_digits: t.digits };
})();

/**
 * check_staff_availability: can the person a VERIFIED existing owner asked for (a name, a role or a
 * keypad key) be put through right now? verify_first until verify_owner verified this call. Returns
 * a real transfer_number only when they can.
 */
http.route({
  path: "/tools/check-staff-availability",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const takeMessage =
      "Say the say line. Then take a message: their name, the best callback number (read it back), and what " +
      "it is about, one question each, skipping what they already said. Then call take_staff_message.";
    const person = optString(body.person, 120);
    if (!person) {
      return Response.json({
        ...NO_TRANSFER,
        available: false,
        status: "not_found",
        say: "Who would you like to reach?",
        message: "person is required: who the owner asked for (a name, a role or the key they pressed). Ask, then call this again.",
      });
    }
    const orgId = await resolveBookingOrg(ctx, conversationId, typeof body.agent_id === "string" ? body.agent_id : undefined);
    if (!orgId) {
      return Response.json({
        ...NO_TRANSFER,
        available: false,
        status: "menu_off",
        say: "I can take a message and pass it on to the team.",
        message: takeMessage,
      });
    }
    let r: FunctionReturnType<typeof internal.ownerRouting.checkStaffAvailability>;
    try {
      r = await ctx.runMutation(internal.ownerRouting.checkStaffAvailability, {
        orgId,
        elevenLabsConversationId: conversationId,
        person,
      });
    } catch (err) {
      console.error("[check-staff-availability] failed:", err);
      return Response.json({
        ...NO_TRANSFER,
        available: false,
        status: "error",
        say: "I can't put you through right now, but I can take a message and pass it on.",
        message: takeMessage,
      });
    }
    if (r.status === "verify_first") {
      return Response.json({
        ...NO_TRANSFER,
        available: false,
        status: "verify_first",
        say: "",
        message:
          "Not cleared yet. Do not transfer and do not read the menu. Remember who they asked for. An existing owner: " +
          "ask which property they own, then their email on file, and call verify_owner; call this again only after it " +
          "returns verified. A new owner (wants us to manage a property): call route_owner_prospect first. Someone whose " +
          "verify_owner did not verify them: take a message with take_staff_message.",
      });
    }
    if (r.status === "available" && r.transferNumber && !outboundEnabled()) {
      // Go-live master switch (outbound.ts): no staff phone is rung while OUTBOUND_ENABLED is off, so
      // Sarah takes a message instead of promising a transfer that ownerTransfer.dial would refuse.
      console.log(`[outbound] call to ${maskRecipient(r.transferNumber)} skipped (owner transfer to ${r.label ?? "staff"}): OUTBOUND_ENABLED is off on this deployment`);
      return Response.json({
        ...NO_TRANSFER,
        available: false,
        status: "not_connecting",
        person: r.label,
        say: "I can't put you through right now, but I can take a message and pass it on.",
        message: takeMessage,
      });
    }
    if (r.status === "available" && r.transferNumber) {
      // On the conversation too, so the call list shows who the owner was put through to.
      await ctx.runMutation(internal.conversations.markEscalation, {
        elevenLabsConversationId: conversationId,
        reason: "owner_transfer",
        summary: `${r.newOwner ? "New owner (wants us to manage a property)" : "Existing owner"} asked for ${r.label}; Sarah put the call through to their phone (the result is on the call's audit trail).`,
        escalatedTo: r.label ?? "staff",
      });
      if (TRANSFER_MECHANISM === "twilio_dial") {
        // The number stays on the server: transfer_owner_call re-checks and dials it itself.
        return Response.json({
          available: true,
          status: "available",
          person: r.label,
          say: "",
          message:
            `Now call transfer_owner_call with person "${person}". Say nothing before it; then say its say line.`,
        });
      }
      return Response.json({
        available: true,
        status: "available",
        person: r.label,
        transfer_number: r.transferNumber,
        transfer_digits: r.transferDigits,
        say: r.say,
        message:
          "Now call transfer_to_number with transfer_number exactly as given, client_message set to the say line, " +
          "and a one-sentence agent_message. Say nothing else, and never say the number.",
      });
    }
    return Response.json({
      ...NO_TRANSFER,
      available: false,
      status: r.status,
      person: r.label,
      say: r.say,
      message:
        r.status === "not_found"
          ? "Nobody matched. Say the say line and wait for their answer, then call this again with who they chose."
          : takeMessage,
    });
  }),
});

/**
 * transfer_owner_call (ownerRoutingLib.TRANSFER_MECHANISM "twilio_dial"): puts a verified owner
 * through to the person check_staff_availability returned available for. The gate is decided again
 * here (beginOwnerTransfer), once per call. The Twilio redirect runs a few seconds later
 * (ownerTransfer.dial) so Sarah finishes her line first. Anything that stops it leaves the caller with
 * Sarah, told to take a message.
 */
http.route({
  path: "/tools/transfer-owner-call",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const takeMessage = {
      status: "not_connecting",
      say: "I'm sorry, I can't put you through right now, but I can take a message and have them call you back.",
      message:
        "Say the say line. Then take a message: their name, the best callback number (read it back), and what it is " +
        "about, one question each, skipping what they already said. Then call take_staff_message. Do not end the call.",
    };
    const person = optString(body.person, 120);
    const callSid = typeof body.call_sid === "string" ? body.call_sid.trim() : "";
    if (!person) {
      return Response.json({
        status: "not_connecting",
        say: "Who would you like to reach?",
        message: "person is required: the same person you passed to check_staff_availability. Ask, then call check_staff_availability again.",
      });
    }
    // Only a real Twilio phone call can be handed over (not the web widget or a test chat).
    if (!CALL_SID_RE.test(callSid)) return Response.json(takeMessage);
    const orgId = await resolveBookingOrg(ctx, conversationId, typeof body.agent_id === "string" ? body.agent_id : undefined);
    if (!orgId) return Response.json(takeMessage);
    let r: FunctionReturnType<typeof internal.ownerRouting.beginOwnerTransfer>;
    try {
      r = await ctx.runMutation(internal.ownerRouting.beginOwnerTransfer, { orgId, elevenLabsConversationId: conversationId, person });
    } catch (err) {
      console.error("[transfer-owner-call] failed:", err);
      return Response.json(takeMessage);
    }
    if (!r.ok) {
      if (r.reason === "already") {
        return Response.json({
          status: "already_connecting",
          say: "",
          message:
            "The transfer was already started. If the caller is still talking to you, it did not go through: say sorry, " +
            "then take a message with take_staff_message. Do not call transfer_owner_call again.",
        });
      }
      if (r.reason === "verify_first") {
        return Response.json({
          status: "verify_first",
          say: "",
          message:
            "Not cleared yet. Do not transfer. An existing owner: ask which property they own, then their email on file, " +
            "and call verify_owner. A new owner (wants us to manage a property): call route_owner_prospect first.",
        });
      }
      return Response.json({ ...takeMessage, say: r.say || takeMessage.say });
    }
    try {
      await ctx.scheduler.runAfter(OWNER_TRANSFER_DELAY_MS, internal.ownerTransfer.dial, {
        orgId,
        elevenLabsConversationId: conversationId,
        callSid,
        label: r.label,
        number: r.number,
        digits: r.digits,
      });
    } catch (err) {
      console.error("[transfer-owner-call] could not schedule the dial:", err);
      return Response.json(takeMessage);
    }
    return Response.json({
      status: "connecting",
      person: r.label,
      say: `I'll put you through to ${spokenStaffName(r.label)} now. Please hold.`,
      message:
        "Say the say line, then say nothing more: the call is being handed over. If the caller speaks to you again, " +
        "the transfer did not go through: say sorry, then take a message with take_staff_message. Never end the call yourself.",
    });
  }),
});

/**
 * take_staff_message: a message for a staff member the owner could not be put through to (after
 * hours, no number yet). Saved on the team's callback list, assigned to that person's team member when
 * the directory names one, and on the audit trail. Upserts per person per call.
 */
http.route({
  path: "/tools/take-staff-message",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const person = optString(body.person, 120);
    const message = optString(body.message, 2000);
    if (!person || !message) {
      return Response.json({
        logged: false,
        error: !person
          ? "person is required: who the message is for, as the owner said it."
          : "message is required: one or two plain sentences on what it is about.",
      });
    }
    const orgId = await resolveBookingOrg(ctx, conversationId, typeof body.agent_id === "string" ? body.agent_id : undefined);
    const notSaved = {
      logged: false,
      say: "I'm sorry, I couldn't save your message just now. Please try calling back a little later.",
      message: "Nothing was saved. Say the say line, and do not say the message was passed on.",
    };
    if (!orgId) return Response.json(notSaved);
    try {
      const r = await ctx.runMutation(internal.ownerRouting.takeStaffMessage, {
        orgId,
        elevenLabsConversationId: conversationId,
        person,
        callerName: optString(body.caller_name, 120),
        callerNumber: realPhone(optString(body.caller_id, 40)),
        callbackNumber: realPhone(optString(body.callback_phone, 40)),
        message,
      });
      const who = r.label ? r.label.replace(/\([^)]*\)/g, "").trim() : "the team";
      return Response.json({
        logged: true,
        say: `Thanks, I'll pass your message on to ${who}.`,
        message: `Say the say line once. ${WAIT_FOR_CALLER}`,
      });
    } catch (err) {
      console.error("[take-staff-message] failed:", err);
      return Response.json(notSaved);
    }
  }),
});

// --- Resident triage ------------------------------------------------------

/**
 * Records that a resident called, why, and how bad it is. Nothing is verified and nothing is
 * matched against a roster — the name and unit are stored exactly as the caller gave them.
 *
 * Unlike check_qualification, the severity here is the model's judgment rather than a
 * deterministic rule — triage has to weigh what the caller describes. clampSeverity is the
 * guard on that trust, and staff can override the score on the Tenants page with the
 * original preserved.
 *
 * Deliberately sends no SMS: the product decision is to store and surface, and the existing
 * escalation alert stays commented out rather than gaining a second notification path here.
 */
http.route({
  path: "/tools/log-tenant-issue",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      caller_id: callerId,
      severity,
      call_type: callTypeRaw,
    } = body;
    // Bounded, control-character-free copies of the free-text fields the model sends.
    const callerName = optString(body.caller_name, 120);
    const unit = optString(body.unit, 60);
    const callerPhone = optString(body.caller_phone, 40);
    const reason = optString(body.reason, 2000);
    const category = optString(body.category, 40);
    const severityReason = optString(body.severity_reason, 500);

    if (!conversationId || !reason) {
      return Response.json({ error: "missing conversation_id or reason" }, { status: 400 });
    }

    // Only a known type is stored; an invented one is dropped, not guessed at.
    const callType =
      typeof callTypeRaw === "string" && (CALL_TYPES as readonly string[]).includes(callTypeRaw.trim().toLowerCase())
        ? callTypeRaw.trim().toLowerCase()
        : undefined;

    // Kept apart rather than collapsed into one field. The telephony number is always
    // correct; a spoken one is what they actually want to be called back on but goes through
    // ASR, so digits get misheard. On a browser call there is no telephony leg at all, and
    // the spoken number is the only number we will ever have.
    const telephony = realPhone(callerId);
    const spoken = realPhone(callerPhone);

    const clamped = clampSeverity(severity);

    await ctx.runMutation(internal.tenants.logIssue, {
      elevenLabsConversationId: conversationId,
      callerName,
      unit,
      callerNumber: telephony ?? spoken,
      callbackNumber: spoken,
      reason,
      category,
      severity: clamped,
      severityReason,
      callType,
    });

    await ctx.runMutation(internal.conversations.markTenantIssue, {
      elevenLabsConversationId: conversationId,
      reason,
      severity: clamped,
      callerNumber: telephony ?? spoken,
    });

    return Response.json({ logged: true, severity: clamped, message: WAIT_FOR_CALLER });
  }),
});

/**
 * Who is calling, from caller ID, so Sarah can CONFIRM rather than assume: "Am I speaking with
 * Sam, in unit 4B?". Returns a first name and a unit label and nothing else. If they say no,
 * the match is dropped and nothing further about the matched resident is ever said.
 *
 * Caller ID is not authentication, which is why this returns so little: a spoofed number can
 * learn a first name and a unit label at most, and the agent's instructions say to treat the
 * match as a question to the caller, not a fact.
 */
http.route({
  path: "/tools/lookup-caller",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const orgId = await resolveBookingOrg(ctx, body.conversation_id, body.agent_id);
    const phone = realPhone(typeof body.caller_id === "string" ? body.caller_id : undefined);
    // No question in the say line: it used to ask for the name, which made Sarah re-ask a name the
    // caller had already given in their first sentence (2026-11-02).
    const noMatch = {
      matched: false,
      message:
        "No match. Do not guess. Ask only for what the caller has not already said in this call: their " +
        "name, then the property name or address, then the unit number. Once you have the address and " +
        "unit, call find_unit (right away if they already said them). If that does not match either, " +
        "take a callback phone or e-mail only to record it and use log_unmatched_caller. " +
        WAIT_FOR_CALLER,
    };
    if (!orgId || !phone) return Response.json(noMatch);
    const found = await ctx.runQuery(internal.sarahTools.lookupCaller, { orgId, phone });
    if (!found.matched) return Response.json(noMatch);
    return Response.json({
      matched: true,
      first_name: found.firstName ?? null,
      unit_label: found.unitLabel ?? null,
      confirm_required: true,
      say: found.firstName
        ? `Am I speaking with ${found.firstName}${found.unitLabel ? ` in unit ${found.unitLabel}` : ""}?`
        : `Is this about unit ${found.unitLabel ?? "on file"}?`,
      message:
        "Possible match from caller ID. Confirm it by asking, for example: Am I speaking with " +
        "first_name in unit unit_label? If they say no, ignore this and ask their name and " +
        `unit. Never say anything else about this resident. ${WAIT_FOR_CALLER}`,
    });
  }),
});

/** "86, 182, 184 or 188 Remsen Street" when they share a street, else "A, B or C". */
function sayOptions(options: string[], joiner: "or" | "and" = "or"): string {
  const or = (xs: string[]) =>
    xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${joiner} ${xs[xs.length - 1]}`;
  const parts = options.map((o) => o.match(/^(\d[\d-]*)\s+(.+)$/));
  const street = parts[0]?.[2];
  if (options.length > 1 && street && parts.every((m) => m && m[2] === street)) {
    return `${or(parts.map((m) => m![1]))} ${street}`;
  }
  return or(options);
}

/**
 * Spoken address + unit -> the stored unit label, or OPTIONS for the caller to confirm. Never
 * anything about who lives anywhere or whether a unit is occupied: only unit labels and building
 * street addresses, so reading them out cannot leak a neighbour's details.
 *
 * Only `matched: true` identifies a unit. Every other answer is a question for the caller:
 * Sarah reads the options, the caller picks one, and she calls find_unit again with exactly what
 * they confirmed. If none fits, the call takes the unmatched path (exception queue), never a guess.
 */
http.route({
  path: "/tools/find-unit",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const spokenUnit = optString(body.spoken_unit, 60);
    const spokenAddress = optString(body.spoken_address, 300);
    const UNMATCHED =
      "If the caller says none of these, is unsure, or it still does not match after one more try, " +
      "ask for a callback phone number (and e-mail if they offer) only to record it, then call " +
      "log_unmatched_caller and end the call politely. Never pick an option for the caller, never " +
      "route on a guess, and do not look them up any other way.";
    const CONFIRM =
      "Read these options as one question and let the caller choose. Never choose for them. When they " +
      "confirm one, call find_unit again with exactly that address and unit; only matched true " +
      "identifies the unit. Never say whether a unit is occupied or who lives anywhere. ";
    const noMatch = {
      matched: false,
      property_matched: false,
      address_options: [] as string[],
      say: "I couldn't find that address. Could you tell me the street address of your building again?",
      message: "No match. Do not guess and do not read out any list. Re-check the address with the caller once. " + UNMATCHED,
    };
    const orgId = await resolveBookingOrg(
      ctx,
      typeof body.conversation_id === "string" ? body.conversation_id : undefined,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    if (!orgId) return Response.json(noMatch);
    const found = await ctx.runQuery(internal.sarahTools.findUnit, { orgId, spokenAddress, spokenUnit });

    if (found.matched) {
      return Response.json({
        matched: true,
        unit_label: found.unitLabel,
        property_name: found.propertyName,
        property_address: found.propertyAddress,
        confirm_required: true,
        say: found.unitLabel
          ? `Thanks, I have unit ${found.unitLabel} at ${found.propertyAddress}. Is that right?`
          : `Thanks, I have ${found.propertyAddress}. Is that right?`,
        message:
          "Unit found. Ask the say line once, then stop: the unit counts only after the caller says yes. " +
          "From now on pass unit_label as spoken_unit and " +
          "property_address as spoken_address to the logging tools (for a house with no unit label, " +
          "leave spoken_unit out). Never say anything about who lives there; you are told nothing " +
          `about residents here. ${WAIT_FOR_CALLER}`,
      });
    }

    if (found.propertyMatched) {
      const at = found.propertyAddress;
      const base = {
        matched: false,
        property_matched: true,
        property_address: at,
        unit_count: found.unitCount,
        similar_units: found.similar,
        all_units: found.allUnits,
      };
      if (found.needUnit) {
        return Response.json({
          ...base,
          say: "And what's your unit or apartment number?",
          message: "The building matched but no unit was given. Ask for the unit number, then call find_unit again. Do not read out a list of units.",
        });
      }
      if (found.similar.length > 0) {
        const one = found.similar.length === 1;
        return Response.json({
          ...base,
          say: one
            ? `I don't see that unit at ${at}. Did you mean unit ${found.similar[0]}?`
            : `I don't see that unit at ${at}. Is it unit ${sayOptions(found.similar)}?`,
          message: "The building matched; the unit did not. These labels are close to what the caller said. " + CONFIRM + UNMATCHED,
        });
      }
      if (found.allUnits.length > 0) {
        return Response.json({
          ...base,
          say: `I don't see that unit at ${at}. The units I have there are ${sayOptions(found.allUnits, "and")}. Is it one of those?`,
          message: "The building matched; nothing is close to the unit they said, and this building is small, so all its unit labels are listed. " + CONFIRM + UNMATCHED,
        });
      }
      return Response.json({
        ...base,
        say: `I don't see that unit at ${at}. Could you say the unit number again, spell it, or tell me which floor you're on?`,
        message:
          "The building matched; nothing is close to the unit they said. Do NOT read out a list of units. " +
          "Ask them to repeat or spell the unit, or say the floor, then call find_unit again once. " + UNMATCHED,
      });
    }

    const options = found.addressOptions;
    if (options.length > 0) {
      const one = options.length === 1;
      return Response.json({
        matched: false,
        property_matched: false,
        address_options: options,
        say:
          found.addressStatus === "ambiguous"
            ? `Is that ${sayOptions(options)}?`
            : one
              ? `Did you mean ${options[0]}?`
              : `Did you mean ${sayOptions(options)}?`,
        message:
          (found.addressStatus === "ambiguous"
            ? "Several of our buildings match what they said. "
            : "No exact match; these building addresses are close to what they said. ") + CONFIRM + UNMATCHED,
      });
    }
    if (found.addressOptionCount > 0) {
      return Response.json({
        ...noMatch,
        say: "We have several buildings on that street. What's the building number?",
        message: "Too many buildings match to read out. Do not read a list. Ask for the street number, then call find_unit again. " + UNMATCHED,
      });
    }
    if (found.addressStatus === "no_address") {
      return Response.json({
        ...noMatch,
        say: "What's the street address of your building?",
        message: "No address was given. Ask for the street address, then call find_unit again. Never offer a list of buildings.",
      });
    }
    return Response.json(noMatch);
  }),
});

/**
 * The recorded status of a resident's maintenance request or work order (Sarah Configuration
 * section 10). User decision 2026-10-31: an EXACT address + unit match (the find_unit rule; a
 * suggestion or similar label is refused) is enough to hear the status. Verification (caller ID of a
 * resident of the unit or the number on the request, or a name matching a resident of the unit) is a
 * soft signal: it only adds the scheduled visit day, date and time. The answer never says whether
 * the caller was verified or whether a name matched; the result is recorded for staff in the audit
 * log. Several items: summaries first, Sarah asks which one, then calls again with request_ref.
 */
/** A real lookup failure only: the team could not be resolved, the lookup threw, or a status is unmapped. */
const STATUS_ERROR_SAY =
  "I can't see the live status of a work order from this call. I'll pass your question to the right team member. They will get back to you.";
const STATUS_ERROR_MESSAGE =
  "The lookup failed. Do not guess or say whether there is any request. Say the say line, then log it with " +
  "log_tenant_issue, call_type work_order_status, with the address, the unit, the issue and when they first " +
  "reported it in the reason.";

http.route({
  path: "/tools/check-work-order-status",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const fallback = { lookup_error: true, say: STATUS_ERROR_SAY, message: STATUS_ERROR_MESSAGE };

    const orgId = await resolveBookingOrg(
      ctx,
      conversationId,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    if (!orgId) return Response.json(fallback);
    const spokenAddress = optString(body.spoken_address, 300);
    const spokenUnit = optString(body.spoken_unit, 60);
    if (!spokenAddress) {
      return Response.json({
        unit_identified: false,
        say: "What's the street address of your building?",
        message: "Ask for the address (and then the unit if you do not have it), confirm the unit with find_unit, then call check_work_order_status again.",
      });
    }

    let found: FunctionReturnType<typeof internal.sarahTools.workOrderStatus>;
    try {
      found = await ctx.runMutation(internal.sarahTools.workOrderStatus, {
        orgId,
        elevenLabsConversationId: conversationId,
        spokenAddress,
        spokenUnit,
        callerId: realPhone(optString(body.caller_id, 40)),
        callerName: optString(body.caller_name, 120),
        issueDescription: optString(body.issue_description, 500),
        requestRef: optString(body.request_ref, 20),
      });
    } catch (err) {
      console.error("[check-work-order-status] failed:", err);
      return Response.json(fallback);
    }

    if (!found.unitIdentified) {
      return Response.json({
        unit_identified: false,
        say: "Let me check the address and unit first.",
        message:
          "The unit is not identified exactly, so nothing can be looked up. Call find_unit with what they said, " +
          "read back what it returns and let them confirm, then call check_work_order_status again with exactly " +
          "the property_address and unit_label of a find_unit result that had matched true. A suggestion or a " +
          "similar unit is not enough. If the unit still cannot be identified, say you'll pass their question to " +
          "the right team member, and log it with log_tenant_issue, call_type work_order_status.",
      });
    }
    if (found.failedClosed) return Response.json({ ...fallback, unit_identified: true });

    const READ_ONLY =
      "Say only what this result gives you: the summary, the date it was reported and the status sentence. Never " +
      "add a day, date, time, reason, cause, name or promise that is not in it, never read out ref, and never " +
      "mention identity checks or whether a name matched. Then log the call with log_tenant_issue, call_type " +
      "work_order_status (that only records the question; never say a request was logged).";
    if (found.items.length === 0) {
      return Response.json({
        unit_identified: true,
        request_count: 0,
        say: "I don't see an open request for your unit. Would you like me to log one now?",
        message:
          "Nothing is on record for this unit in the last 30 days. If they want to report it, run the maintenance " +
          "request flow and call log_maintenance_request. Otherwise log the call with log_tenant_issue, call_type " +
          "work_order_status.",
      });
    }
    if (found.selected) {
      const s = found.selected;
      return Response.json({
        unit_identified: true,
        request_count: found.items.length,
        request: { summary: s.summary, reported: s.reported, status: s.status },
        say: `I see the request about ${s.summary}, reported on ${s.reported}. ${s.status}`,
        message: READ_ONLY,
      });
    }
    const choices = found.items.map((i) => ({ ref: i.ref, summary: i.summary, reported: i.reported }));
    const likely = found.likelyRef ? choices.find((c) => c.ref === found.likelyRef) : undefined;
    const list = choices.map((c) => `${c.summary}, from ${c.reported}`);
    const listSay =
      list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
    return Response.json({
      unit_identified: true,
      request_count: found.total,
      choices,
      likely_ref: likely?.ref ?? null,
      say: likely
        ? `Is this about the ${likely.summary} you reported on ${likely.reported}?`
        : `I see a few requests for your unit. Is it ${listSay}?`,
      message:
        "Several requests are on record for this unit; no status is given yet. Ask which one they mean as ONE " +
        "question (the say line), using what they told you about the issue and when they first reported it. When " +
        "they pick one, call check_work_order_status again with the same details and request_ref set to that " +
        "choice's ref, and describe only that one. If likely_ref is set the say line checks that one first; if " +
        "they say no, ask about the others the same way. Never read out ref, and never describe any other request.",
    });
  }),
});

/**
 * Takes a resident's maintenance request (build plan F4). The model supplies the issue and its
 * severity LEVEL; routing to an asset manager, the exception queue and staff alerts are all done
 * by maintenance.createFromCall, not decided here.
 *
 * Safe to call repeatedly in one call: createFromCall upserts by the ElevenLabs conversation id,
 * so a second call with fuller details updates the same request. That is what lets an
 * emergency be logged immediately with almost nothing known and completed afterwards.
 *
 * Nothing here verifies who is calling. The name, address and unit are stored as given and
 * matched to a unit server-side; a request that can't be matched lands in the exception queue
 * for a person.
 */
http.route({
  path: "/tools/log-maintenance-request",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const conversationId: unknown = body.conversation_id;
    if (typeof conversationId !== "string" || !conversationId) {
      return Response.json({ error: "missing conversation_id" }, { status: 400 });
    }

    const issueType = typeof body.issue_type === "string" ? body.issue_type.trim().toLowerCase() : "";
    if (!(ISSUE_TYPES as readonly string[]).includes(issueType)) {
      return Response.json(
        { logged: false, error: `issue_type must be one of: ${ISSUE_TYPES.join(", ")}.` },
        { status: 400 },
      );
    }
    const requestedSeverity = parseSeverityLevel(body.severity);
    if (!requestedSeverity) {
      return Response.json(
        { logged: false, error: "severity must be one of: emergency, urgent, routine, informational." },
        { status: 400 },
      );
    }
    // Tenant-responsibility items (bulbs, blinds, trash to the curb) are never a repair; the
    // policy is that they are logged as informational, whatever level the model picked.
    const severity = issueType === "tenant_responsibility" ? "informational" : requestedSeverity;

    const callerName = optString(body.caller_name, 120);
    const spokenUnit = optString(body.spoken_unit, 60);
    const spokenAddress = optString(body.spoken_address, 300);
    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);

    let description = optString(body.description, 4000);
    // A life-safety emergency is logged at once with whatever is known (LIFE-SAFETY step 2).
    const lifeSafety = severity === "emergency" || ["fire", "flooding", "gas"].includes(issueType);
    if (!description && lifeSafety) {
      return Response.json(
        { logged: false, error: "description is required: one or two plain sentences on what is wrong." },
        { status: 400 },
      );
    }
    // A find_unit match is not the caller's yes: conv_9001m6dzykqte399btbs28d2z4ss logged and routed a
    // request on a unit the caller never confirmed. An update to a request already on file still
    // goes through. An agent published before this argument existed sends nothing, so is not blocked.
    if (!lifeSafety && (body.unit_confirmed === false || body.unit_confirmed === "false")) {
      const onFile = orgId
        ? await ctx.runQuery(internal.maintenance.callRequestDescription, {
            orgId,
            elevenLabsConversationId: conversationId,
          })
        : null;
      if (!onFile) {
        return Response.json({
          logged: false,
          request_created: false,
          needs: "unit_confirmation",
          message:
            "Nothing was logged and nothing was sent: the caller has not confirmed the unit. Ask find_unit's " +
            "say line if you have not, then wait for their yes and call this again with unit_confirmed true. " +
            `Never say this was logged or sent. ${WAIT_FOR_CALLER}`,
        });
      }
    }
    // Anything else needs the actual problem first. "Maintenance complaint." was logged and sent to
    // an asset manager before the caller said what was wrong (2026-11-02): nothing is created or
    // routed for a description like that, and Sarah is told to ask instead. A later update call
    // with a vague description keeps the one already on the request.
    if (!lifeSafety && isVagueIssue(description, [callerName, spokenAddress, spokenUnit])) {
      const onFile = orgId
        ? await ctx.runQuery(internal.maintenance.callRequestDescription, {
            orgId,
            elevenLabsConversationId: conversationId,
          })
        : null;
      if (!onFile) {
        return Response.json({
          logged: false,
          request_created: false,
          needs: "issue_description",
          // No question here: the message decides what comes next (identify the unit, or ask what is wrong).
          say: "Sure, I can help with that.",
          message:
            "Nothing was logged and nothing was sent: the description does not say what is wrong. If the unit " +
            "is not identified yet (STEP 1), do that first. Then ask \"What's going on?\" and call " +
            "log_maintenance_request again with what they say in description. Never say this was logged or sent.",
        });
      }
      description = onFile;
    }
    if (!description) {
      return Response.json(
        { logged: false, error: "description is required: one or two plain sentences on what is wrong." },
        { status: 400 },
      );
    }
    const callerNumber = realPhone(typeof body.caller_id === "string" ? body.caller_id : undefined);
    const callbackNumber = realPhone(typeof body.callback_phone === "string" ? body.callback_phone : undefined);
    // The confirmed contact number (stored as smsConfirmPhone for the planned confirmation text;
    // nothing is texted yet). Stored only when it normalises to E.164 AND the caller said yes to
    // Sarah's read-back. Anything else is answered with what to do next, never a failed request.
    const confirmedRaw = realValue(optString(body.confirmed_phone, 40));
    const confirmedYes = body.confirmed_phone_yes === true || body.confirmed_phone_yes === "true";
    const confirmedE164 = confirmedRaw ? toE164(confirmedRaw) : null;
    const smsConfirmPhone = confirmedE164 && confirmedYes ? confirmedE164 : undefined;
    // Permission to text that number about this request (A2P 10DLC consent). Fails closed: true only
    // when Sarah sent a literal true, and only alongside a confirmed number; with a confirmed number
    // anything else is recorded as an explicit false. Without one nothing is recorded.
    const smsConsent = smsConfirmPhone ? body.sms_consent === true || body.sms_consent === "true" : undefined;
    const severityReason = optString(body.severity_reason, 500);
    const severityScore =
      body.severity_score === undefined || body.severity_score === null || body.severity_score === ""
        ? undefined
        : clampSeverity(body.severity_score);
    const summaryLine = `${severity} maintenance request (${issueType.replace(/_/g, " ")}): ${description}`;

    let saved: FunctionReturnType<typeof internal.maintenance.createFromCall> | null = null;
    let emergencyAlerted = false;

    try {
      if (!orgId) {
        // The team can't be told yet (no conversations row, no agent id). Losing a request is
        // worse than filing it in the older place: the resident-call record is backfilled with
        // its team once the post-call webhook resolves the agent, and staff still see it.
        await ctx.runMutation(internal.tenants.logIssue, {
          elevenLabsConversationId: conversationId,
          callerName,
          unit: spokenUnit,
          callerNumber: callerNumber ?? callbackNumber,
          callbackNumber,
          reason: description,
          category: issueType,
          severity: SEVERITY_LEVEL_SCORE[severity],
          severityReason,
        });
        // Admins must still hear about an emergency when the team could not be resolved yet.
        if (severity === "emergency") {
          emergencyAlerted = await ctx.runMutation(internal.sarahTools.alertEmergencyUnresolvedOrg, {
            elevenLabsConversationId: conversationId,
            unit: spokenUnit,
          });
        }
      } else {
        const propertyId = await ctx.runQuery(internal.sarahTools.matchPropertyId, {
          orgId,
          spokenAddress,
        });
        saved = await ctx.runMutation(internal.maintenance.createFromCall, {
          orgId,
          elevenLabsConversationId: conversationId,
          callerName,
          callerNumber,
          callbackNumber,
          callerEmail: optEmail(body.caller_email),
          spokenAddress,
          spokenUnit,
          propertyId: propertyId ?? undefined,
          title: optString(body.title, 120),
          issueType,
          description,
          firstNoticed: optString(body.first_noticed, 200),
          answers: parseAnswers(body.answers),
          pets: optString(body.pets, 300),
          preferredAccessTimes: optString(body.preferred_access_times, 300),
          severity,
          // The model's own 1-10 score when it gave one (clamped); else the level's representative score.
          severityScore: severityScore ?? SEVERITY_LEVEL_SCORE[severity],
          severityReason,
          smsConfirmPhone,
          smsConsent,
        });
        emergencyAlerted = saved.emergencyAlerted;
      }

      // Classifies the call as a resident/maintenance call so it stays out of the Leads list.
      await ctx.runMutation(internal.conversations.markTenantIssue, {
        elevenLabsConversationId: conversationId,
        reason: description,
        severity: SEVERITY_LEVEL_SCORE[severity],
        callerNumber: callerNumber ?? callbackNumber,
        summary: summaryLine,
      });
    } catch (err) {
      console.error("[log-maintenance-request] failed:", err);
      return Response.json(
        {
          logged: false,
          error: "It could not be saved. Call this tool once more; if it fails again, escalate.",
        },
        { status: 500 },
      );
    }

    // Only a life-safety result is spoken now. Routine and urgent results carry closing_line for the
    // close of the call, so Sarah never announces the log mid-intake (see sarahReplies.ts).
    const confirmedPhone = (stored: boolean) =>
      confirmedPhoneLines({ given: !!confirmedRaw, valid: !!confirmedE164, confirmed: confirmedYes, stored });
    if (!saved) {
      return Response.json({
        logged: true,
        severity,
        team_alerted: emergencyAlerted,
        ...maintenanceLogLines({ severity, emergencyAlerted, saved: null }),
        ...confirmedPhone(false),
      });
    }
    const closedOutOfScope = saved.status === "closed_out_of_scope";
    return Response.json({
      logged: true,
      severity,
      request_number: saved.number,
      status: saved.status,
      closed_out_of_scope: closedOutOfScope,
      unit_label: saved.unitLabel,
      routed_to_asset_manager: saved.routedToAm,
      team_alerted: emergencyAlerted,
      ...maintenanceLogLines({
        severity,
        emergencyAlerted,
        saved: { routedToAm: saved.routedToAm, closedOutOfScope },
      }),
      ...confirmedPhone(!!smsConfirmPhone),
    });
  }),
});

/**
 * A caller who is not in the resident directory: Sarah could not match them to a unit by caller ID,
 * address + unit, or phone / e-mail. Creates a callback contact for the "unmatched caller" asset
 * manager (admin-chosen, least-loaded, see leads.ts) and texts them and the admins. It never
 * creates a maintenance request. Upserts by call, so Sarah can log early and add details.
 */
http.route({
  path: "/tools/log-unmatched-caller",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const issueSummary = optString(body.issue_summary, 2000);
    if (!issueSummary) {
      return Response.json(
        { logged: false, error: "issue_summary is required: one or two plain sentences on what they need." },
        { status: 400 },
      );
    }
    const callerName = optString(body.caller_name, 120);
    const callerNumber = realPhone(optString(body.caller_id, 40));
    const callbackNumber = realPhone(optString(body.callback_phone, 40));
    const callerEmail = optEmail(body.caller_email);
    const reason = optString(body.reason, 300) ?? "No unit or resident match";

    const orgId = await resolveBookingOrg(
      ctx,
      conversationId,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    let assignedTo: string | null = null;
    // Optional: "emergency" when the issue is life-safety. Anything else is ignored.
    const isEmergency = typeof body.severity === "string" && body.severity.trim().toLowerCase() === "emergency";
    let emergencyAlerted = false;
    try {
      if (orgId) {
        const result = await ctx.runMutation(internal.leads.logUnmatchedCaller, {
          orgId,
          elevenLabsConversationId: conversationId,
          callerName,
          callerNumber,
          callbackNumber,
          callerEmail,
          reason,
          issueSummary,
          emergency: isEmergency,
          spokenUnit: optString(body.spoken_unit, 60),
        });
        assignedTo = result.assignedFirstName;
        emergencyAlerted = result.emergencyAlerted;
      } else {
        // The team can't be resolved yet: keep it in the older resident-call record rather than
        // lose the caller; it is backfilled with its team once the post-call webhook runs.
        await ctx.runMutation(internal.tenants.logIssue, {
          elevenLabsConversationId: conversationId,
          callerName,
          callerNumber: callerNumber ?? callbackNumber,
          callbackNumber,
          reason: `Unmatched caller: ${issueSummary}`,
          category: "unmatched_caller",
          severity: 3,
        });
        if (isEmergency) {
          emergencyAlerted = await ctx.runMutation(internal.sarahTools.alertEmergencyUnresolvedOrg, {
            elevenLabsConversationId: conversationId,
            unit: optString(body.spoken_unit, 60),
          });
        }
      }
      // Keeps the call out of the Leads list; it is a resident-type call with no request.
      await ctx.runMutation(internal.conversations.markTenantIssue, {
        elevenLabsConversationId: conversationId,
        reason: issueSummary,
        severity: 3,
        callerNumber: callerNumber ?? callbackNumber,
        summary: `Unmatched caller (${reason}): ${issueSummary}`,
      });
    } catch (err) {
      console.error("[log-unmatched-caller] failed:", err);
      return Response.json(
        { logged: false, error: "It could not be saved. Call this tool once more; if it fails again, escalate." },
        { status: 500 },
      );
    }
    return Response.json({
      logged: true,
      assigned_to: assignedTo,
      request_created: false,
      team_alerted: emergencyAlerted,
      say: emergencyAlerted
        ? "I wasn't able to match you to a unit, but I've alerted the team right away and an asset manager will call you back."
        : "I wasn't able to match you to a unit, so I've passed your details to one of our asset managers. They'll call you back.",
      message: `Say the say line once. ${WAIT_FOR_CALLER}`,
    });
  }),
});

/**
 * A matched resident's question or non-repair need (no technician required). Files it as a
 * maintenance request in work-order format (issue type "other", category "Question") that goes
 * to the unit's asset manager through the same path as log_maintenance_request. The route name is
 * kept so an agent that has not been re-published still works. Needs a matched unit - by address
 * + unit or by caller ID - otherwise it answers matched: false and Sarah uses log_unmatched_caller.
 * Upserts by call.
 */
http.route({
  path: "/tools/log-task-request",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    const summary = optString(body.summary, 4000);
    if (!summary) {
      return Response.json(
        { logged: false, error: "summary is required: one or two plain sentences on what they asked." },
        { status: 400 },
      );
    }
    const orgId = await resolveBookingOrg(
      ctx,
      conversationId,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    const unmatched = {
      logged: false,
      matched: false,
      say: "I'm not finding your unit on our system. Let me take your details so one of our asset managers can call you back.",
      message: "No unit match, so nothing was filed. Call log_unmatched_caller with their details.",
    };
    if (!orgId) return Response.json(unmatched);

    const callbackPhone = realPhone(optString(body.callback_phone, 40));
    const callerId = realPhone(optString(body.caller_id, 40));
    const spokenAddress = optString(body.spoken_address, 300);
    const spokenUnit = optString(body.spoken_unit, 60);
    const unit = await resolveCallUnit(ctx, orgId, { spokenAddress, spokenUnit, callerId });
    if (!unit) return Response.json(unmatched);

    const callerName = optString(body.caller_name, 120);
    const priorityRaw = typeof body.priority === "string" ? body.priority.trim().toLowerCase() : "";
    // "high" priority questions are routine (reviewed first); the rest are informational.
    const severity = priorityRaw === "high" || priorityRaw === "medium" ? "routine" : "informational";
    let result: FunctionReturnType<typeof internal.maintenance.createFromCall> | null = null;
    try {
      const propertyId = await ctx.runQuery(internal.sarahTools.matchPropertyId, { orgId, spokenAddress });
      result = await ctx.runMutation(internal.maintenance.createFromCall, {
        orgId,
        elevenLabsConversationId: conversationId,
        callerName,
        callerNumber: callerId,
        callbackNumber: callbackPhone,
        spokenAddress,
        spokenUnit: spokenUnit ?? unit.unitLabel,
        propertyId: propertyId ?? undefined,
        title: optString(body.title, 120) ?? "Resident question",
        issueType: "other",
        description: summary,
        severity,
        severityScore: severity === "routine" ? 4 : 2,
        severityReason: "Resident question or non-repair request; no technician needed unless the AM decides otherwise.",
        isQuestion: true,
      });
      await ctx.runMutation(internal.conversations.markTenantIssue, {
        elevenLabsConversationId: conversationId,
        reason: summary,
        severity: severity === "routine" ? 4 : 2,
        callerNumber: callerId ?? callbackPhone,
        summary: `Resident question (unit ${unit.unitLabel}): ${summary}`,
      });
    } catch (err) {
      console.error("[log-task-request] failed:", err);
      return Response.json(
        { logged: false, error: "It could not be saved. Call this tool once more; if it fails again, escalate." },
        { status: 500 },
      );
    }
    if (!result) return Response.json(unmatched);
    return Response.json({
      logged: true,
      matched: true,
      request_number: result.number,
      unit_label: result.unitLabel ?? unit.unitLabel,
      assigned_to: result.amFirstName,
      say: "I've passed that to the asset manager for your building and they'll follow up with you.",
      message: `Say the say line once. ${WAIT_FOR_CALLER}`,
    });
  }),
});

/**
 * The caller agreed to send photos. Sarah texts NOBODY: this records a "photo request from the
 * call" on the maintenance request this call created and tells the unit's asset manager, who
 * decides what to do (the AM can send the upload link from the dashboard). The route and tool name
 * are kept so the registered ElevenLabs tool does not have to be re-created.
 * No per-call cap: a repeat call only updates the note and does not notify twice.
 * The result's say line dictates where to email the photos (photo_email: the unit's asset manager's
 * memberships.photoEmail) or, when that is not known, says the asset manager will follow up.
 */
http.route({
  path: "/tools/send-photo-link",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });
    // No address unless the request this call logged resolved to a unit whose asset manager has a
    // photo email (photoReplyLines falls back to PHOTO_SAY). The address is never logged here.
    const fallback = photoReplyLines(null);
    const orgId = await resolveBookingOrg(
      ctx,
      conversationId,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    if (!orgId) return Response.json({ recorded: false, ...fallback });
    try {
      const result = await ctx.runMutation(internal.maintenance.photoRequestFromCall, {
        orgId,
        elevenLabsConversationId: conversationId,
        note: optString(body.note, 500),
        callerNumber: realPhone(optString(body.caller_id, 40)),
        callbackNumber: realPhone(optString(body.callback_phone, 40)),
        callerEmail: optEmail(body.caller_email),
      });
      if (!result.recorded) {
        return Response.json({
          recorded: false,
          ...fallback,
          message: "No open maintenance request exists for this call yet. Call log_maintenance_request first, then this again.",
        });
      }
      return Response.json({
        recorded: true,
        request_number: result.number,
        ...photoReplyLines(result.photoEmail),
      });
    } catch (err) {
      console.error("[send-photo-link] failed:", err);
      return Response.json({ recorded: false, ...fallback });
    }
  }),
});

/**
 * New leasing lead. Capture-and-flag: everything the caller says is stored (answers merge, so a
 * later call only adds), the lead is classified for staff, and it stays unassigned (for an admin)
 * until the caller picks a building: spoken_building, an address from Sarah's own listing results,
 * sends it to that building's asset manager (leads.captureLead, B41). The caller is never told
 * anything about qualifying; flags stay on the lead. Sarah calls it twice in a normal leasing call:
 * once as soon as the area is known (the lead exists if the call drops, and she gets
 * available_units), then ONE final log with everything before a tour or the close. Logging after
 * every answer made 7 slow tool turns, nearly each with a filler (conv_0001m7acgw57fpwagbr0ydncsybk).
 */
http.route({
  path: "/tools/log-lead",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await readBody(request);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.slice(0, 200) : "";
    if (!conversationId) return Response.json({ error: "missing conversation_id" }, { status: 400 });

    const orgId = await resolveBookingOrg(
      ctx,
      conversationId,
      typeof body.agent_id === "string" ? body.agent_id : undefined,
    );
    if (!orgId) {
      return Response.json({
        logged: false,
        say: "Thanks, let me make a note of that.",
        message: "The team could not be resolved for this call; the lead was not saved. Continue the call and try once more.",
      });
    }

    const callerName = optString(body.caller_name, 120);
    // The number they said wins; caller ID is the fallback.
    const callerPhone = realPhone(optString(body.caller_phone, 40)) ?? realPhone(optString(body.caller_id, 40));
    const bedrooms = optString(body.bedrooms, 20)?.toLowerCase();
    const moveInDate = optString(body.move_in_date, 80);
    const budget = optNumber(body.budget);
    const petsWanted = optBool(body.pets_wanted);

    // The city or area they want to rent in, in their words. preferred_communities is the older
    // argument for the same answer. A follow-up call that leaves it out keeps the stored one, so
    // what is offered stays in their area for the whole call.
    const saidArea = optString(body.preferred_area, 200) ?? optString(body.preferred_communities, 200);
    const storedLead = saidArea
      ? null
      : await ctx.runQuery(internal.qualifications.byElevenLabsId, { elevenLabsConversationId: conversationId });
    const preferredArea = saidArea ?? storedLead?.preferredArea;

    // Staff-facing flags only; none of this is ever returned to Sarah.
    const property = await ctx.runQuery(internal.properties.currentInternal, { orgId });
    const all = await offeredWithCities(ctx, orgId, property);
    const area = applyCity(all.offered, all.cities, preferredArea);
    // What Sarah may offer: narrowed to their city when one matched (the same rule as check_availability).
    const offered = area.offered;
    const matching = bedrooms ? offered.filter((t) => t.bedrooms === bedrooms) : [];
    // The flags keep their team-wide meaning; the area ones are separate.
    const matchingAnywhere = bedrooms ? all.offered.filter((t) => t.bedrooms === bedrooms) : [];
    const flags: string[] = [];
    if (bedrooms && matchingAnywhere.length === 0) flags.push("no_available_match");
    if (area.status === "none_available") flags.push("no_availability_in_area");
    if (area.status === "unknown_city") flags.push("area_not_served");
    const floors = matchingAnywhere.map((t) => t.rentMin).filter((n): n is number => n !== null);
    if (budget !== undefined && floors.length > 0 && budget < Math.min(...floors)) flags.push("budget_below_range");
    // Only an explicit "no pets" flags; an unset policy (imported buildings) is not a "no".
    if (petsWanted === true && property.petsAllowed === false) flags.push("pets_not_allowed");
    if (optBool(body.third_party_payer) === true) flags.push("third_party_payer");
    if (optString(body.avoid_communities, 500)) flags.push("avoid_communities");
    const ready = Boolean(bedrooms && moveInDate && budget !== undefined && callerName && callerPhone);

    // The listing the caller picked, if any (an address from her own results): matched exactly like a
    // tour's building (this team's buildings only, a city never counts), it routes the lead to that
    // building's asset manager. No match: the lead is saved as usual and simply not routed.
    const spokenBuilding = optString(body.spoken_building, 300);
    let pickedPropertyId: Id<"properties"> | undefined;
    if (spokenBuilding) {
      try {
        const picked = await ctx.runQuery(internal.sarahTools.tourApartment, {
          orgId,
          spokenAddress: spokenBuilding,
          spokenUnit: optString(body.spoken_unit, 60),
        });
        pickedPropertyId = picked.property?.id;
      } catch (err) {
        console.error("[log-lead] could not match the building:", err);
      }
    }

    let assignedTo: string | null = null;
    try {
      const result = await ctx.runMutation(internal.leads.captureLead, {
        orgId,
        propertyId: pickedPropertyId,
        elevenLabsConversationId: conversationId,
        callerName,
        callerPhone,
        callerEmail: optEmail(body.caller_email),
        bedrooms,
        moveInDate,
        budget,
        petsWanted,
        petType: optString(body.pet_type, 100),
        ...(saidArea
          ? {
              preferredArea: saidArea,
              // City names from the team's own data, for staff; empty for "anywhere" or an area we do not have.
              preferredCities: area.matched,
            }
          : {}),
        leadClass: ready ? "ready" : "partial",
        leadFlags: flags,
        screeningAnswers: leasingCaptured(body),
      });
      assignedTo = result.assignedFirstName;
    } catch (err) {
      console.error("[log-lead] failed:", err);
      return Response.json(
        { logged: false, error: "It could not be saved. Call this tool once more." },
        { status: 500 },
      );
    }

    const typeAvailable = bedrooms ? matching.length > 0 : null;
    return Response.json({
      logged: true,
      assigned_to: assignedTo,
      requested_type_available: typeAvailable,
      available_units: offered.map(offeredForAgent),
      leasing_facts_rule: LEASING_FACTS_RULE,
      area_status: area.status,
      area_matched: area.matched.length ? sayList(area.matched, "or") : null,
      cities_with_availability: area.citiesWithAvailability,
      // The first log (area known) gets no "would you like a tour?": the flow is not done yet. Only the
      // final log (final_log true, or every core answer in) offers one. See sarahReplies.leadLogLines.
      ...leadLogLines({
        final: optBool(body.final_log) === true || ready,
        typeAvailable,
        areaSay: area.say,
        areaMessage: area.message,
      }),
    });
  }),
});

/**
 * An owner who wants 518 to manage their property is not a renter. Stored on the call's
 * qualifications row and texted to the executives (Alex). The SMS carries a first name only;
 * the property details stay behind the login.
 */
http.route({
  path: "/tools/owner-prospect",
  method: "POST",
  handler: toolAction(async (ctx, request) => {
    const body = await request.json();
    const conversationId: unknown = body.conversation_id;
    if (typeof conversationId !== "string" || !conversationId) {
      return Response.json({ error: "missing conversation_id" }, { status: 400 });
    }
    const name = optString(body.name, 120);
    // The spoken number wins; caller ID is the fallback when they say to use the one they called from.
    const phone =
      realPhone(typeof body.phone === "string" ? body.phone : undefined) ??
      realPhone(typeof body.caller_id === "string" ? body.caller_id : undefined);
    if (!name || !phone) {
      return Response.json({
        recorded: false,
        message: "Ask for their name and the best number to reach them on, then call this again.",
      });
    }

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      callerName: name,
      callerPhone: phone,
      ownerProspect: {
        name,
        phone,
        email: optString(body.email, 200),
        propertyAddress: optString(body.property_address, 300),
        propertyDetails: optString(body.property_details, 1000),
        notes: optString(body.notes, 1000),
      },
    });

    let notified = false;
    let menuLive = false;
    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);
    if (orgId) {
      try {
        notified = await ctx.runMutation(internal.sarahTools.notifyOwnerProspect, { orgId, name });
      } catch (err) {
        console.error("[owner-prospect] could not notify:", err);
      }
      // B46: clears this call for the owner phone menu (no email check for a new owner).
      try {
        menuLive = (await ctx.runMutation(internal.ownerRouting.recordNewOwner, { orgId, elevenLabsConversationId: conversationId, name })).menuLive;
      } catch (err) {
        console.error("[owner-prospect] could not record the new owner for the menu:", err);
      }
    }
    if (menuLive) {
      return Response.json({
        recorded: true,
        staff_notified: notified,
        menu_live: true,
        say: NEW_OWNER_LOGGED_SAY,
        message:
          "Say the say line, then in the same turn: if they already asked for someone on the OWNER CALL ROUTING " +
          "keypad list, say you'll put them through to that person and call check_staff_availability; otherwise " +
          "read the NEW OWNERS phone menu word for word and wait. Never say a key number. Never call verify_owner " +
          "or ask for an email for them. Do not discuss fees or terms.",
      });
    }
    return Response.json({
      recorded: true,
      staff_notified: notified,
      menu_live: false,
      say: "Thank you. I've passed this on to Alex, who will call you back.",
      message: "Say the say line. Do not read any phone menu or offer to put them through. Do not discuss fees or terms.",
    });
  }),
});

// --- WhatsApp (WAHA) ------------------------------------------------------

/**
 * Inbound WhatsApp messages from self-hosted WAHA.
 *
 * WAHA is configured to send our own WAHA_API_KEY back as X-Api-Key (see wahaApi.startSession).
 * Without that check anyone who knows this deployment's URL could inject fake WhatsApp
 * messages into the inbox, and the bot would answer them.
 *
 * The payload is parsed defensively: WAHA's engines (GOWS/WEBJS/NOWEB) do not agree on
 * shape, so an unrecognised body is logged in full rather than dropped silently. See
 * infra/waha/README.md.
 */
http.route({
  path: "/wa/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.WAHA_API_KEY;
    if (!expected || request.headers.get("x-api-key") !== expected) {
      return new Response("unauthorized", { status: 401 });
    }

    const raw = await request.text();

    let payload: {
      event?: string;
      session?: string;
      payload?: { from?: string; body?: string; fromMe?: boolean };
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error("[wa webhook] invalid JSON:", raw.slice(0, 500));
      return new Response("bad request", { status: 400 });
    }

    // Our own outgoing messages echo back through the webhook. Without this the bot
    // replies to itself, forever.
    if (payload.event !== "message" || payload.payload?.fromMe) {
      return new Response(null, { status: 200 });
    }

    const from = payload.payload?.from;
    const text = payload.payload?.body;
    if (!from || !text) {
      console.error(
        `[wa webhook] unrecognized payload shape: ${JSON.stringify(payload).slice(0, 1000)}`,
      );
      return new Response(null, { status: 200 });
    }

    // WhatsApp is moving to LID identifiers, so `from` can be "123@lid" rather than a phone
    // number. Resolve it when we can. When we cannot, keep the FULL JID as the chat id — a
    // bare LID with "@c.us" appended is undeliverable, so replies would vanish silently.
    let chatId = from.replace(/@.*/, "");
    let displayName = `+${chatId}`;
    if (from.endsWith("@lid")) {
      const resolved = await waha.resolveLid(from);
      if (resolved) {
        chatId = resolved;
        displayName = `+${resolved}`;
      } else {
        chatId = from;
        displayName = from;
      }
    }

    await ctx.runMutation(internal.waBot.ingestInbound, { chatId, displayName, text });

    return new Response(null, { status: 200 });
  }),
});

// --- Inbound SMS / WhatsApp (Twilio "A message comes in" webhooks) --------

/**
 * Validates X-Twilio-Signature: base64(HMAC-SHA1(TWILIO_AUTH_TOKEN, fullUrl + sorted params as
 * key+value)). Fails closed: 503 when the token or public site URL is unset, 403 on a bad or
 * missing signature. Returns null when valid. Must run before any write.
 */
async function verifyTwilioSignature(
  request: Request,
  form: URLSearchParams,
): Promise<Response | null> {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!token || !siteUrl) return new Response("Twilio webhook not configured", { status: 503 });
  const header = request.headers.get("X-Twilio-Signature");
  if (!header) return new Response("Forbidden", { status: 403 });

  const incoming = new URL(request.url);
  const fullUrl = siteUrl.replace(/\/+$/, "") + incoming.pathname + incoming.search;
  const keys = Array.from(new Set(Array.from(form.keys()))).sort();
  let data = fullUrl;
  for (const key of keys) for (const value of form.getAll(key)) data += key + value;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let expected: string;
  try {
    expected = btoa(String.fromCharCode(...mac));
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  if (!timingSafeEqual(expected, header)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

// --- Owner transfer: Twilio <Dial> and voicemail callbacks ------------------------------------
//
// ownerTransfer.dial points the live call's <Dial action> here. Both routes check X-Twilio-Signature
// and ALWAYS answer with TwiML that keeps the caller on the line (or ends it politely): a thrown error
// here would make Twilio say "an application error has occurred" and hang up on the owner.

function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/** The staff phone answered (call over: hang up) or not (busy / no answer / failed: offer voicemail). */
http.route({
  path: "/twilio/owner-transfer-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const form = new URLSearchParams(await request.text());
    const denied = await verifyTwilioSignature(request, form);
    if (denied) return denied;
    const conv = (new URL(request.url).searchParams.get("c") ?? "").slice(0, 200);
    const status = (form.get("DialCallStatus") ?? "").slice(0, 40);
    const siteUrl = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
    let label: string | null = null;
    try {
      const tc = conv ? await ctx.runQuery(internal.ownerRouting.transferContext, { elevenLabsConversationId: conv }) : null;
      label = tc?.label ?? null;
      if (tc && dialAnswered(status)) {
        await ctx.runMutation(internal.ownerRouting.logOwnerTransfer, {
          orgId: tc.orgId,
          elevenLabsConversationId: conv,
          action: "owner_transfer_connected",
          to: tc.label,
          note: `${tc.label} picked up (talked ${Number(form.get("DialCallDuration") ?? 0) || 0} s).`,
        });
      } else if (tc) {
        await ctx.runMutation(internal.ownerRouting.logOwnerTransfer, {
          orgId: tc.orgId,
          elevenLabsConversationId: conv,
          action: "owner_transfer_failed",
          to: tc.label,
          note: `${tc.label} did not pick up (Twilio: ${status || "unknown"}). The caller stayed on the line and was offered voicemail.`,
        });
        await ctx.runMutation(internal.ownerRouting.takeStaffMessage, {
          orgId: tc.orgId,
          elevenLabsConversationId: conv,
          person: tc.label,
          callerNumber: realPhone(form.get("From") ?? undefined),
          message: `${tc.newOwner ? "A new owner (wants us to manage their property)" : "A verified owner"} was put through to ${tc.label}, but the call was not answered (${status || "unknown"}). Please call them back.`,
        });
      }
    } catch (err) {
      console.error("[owner-transfer-result] failed:", err);
    }
    if (dialAnswered(status)) return twimlResponse(hangupTwiml());
    return twimlResponse(
      ownerTransferFallbackTwiml({ label, voicemailUrl: `${siteUrl}/twilio/owner-voicemail?c=${encodeURIComponent(conv)}` }),
    );
  }),
});

/** The caller left a voicemail after a transfer nobody picked up: it goes on that person's callback row. */
http.route({
  path: "/twilio/owner-voicemail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const form = new URLSearchParams(await request.text());
    const denied = await verifyTwilioSignature(request, form);
    if (denied) return denied;
    const conv = (new URL(request.url).searchParams.get("c") ?? "").slice(0, 200);
    const recordingUrl = form.get("RecordingUrl") ?? "";
    const seconds = Number(form.get("RecordingDuration") ?? 0) || 0;
    let label: string | null = null;
    try {
      const tc = conv ? await ctx.runQuery(internal.ownerRouting.transferContext, { elevenLabsConversationId: conv }) : null;
      label = tc?.label ?? null;
      if (tc && /^https:\/\/api\.twilio\.com\//.test(recordingUrl)) {
        await ctx.runMutation(internal.ownerRouting.takeStaffMessage, {
          orgId: tc.orgId,
          elevenLabsConversationId: conv,
          person: tc.label,
          callerNumber: realPhone(form.get("From") ?? undefined),
          message:
            `${tc.newOwner ? "A new owner (wants us to manage their property)" : "A verified owner"} was put through to ${tc.label}, but the call was not answered. They left a ${seconds}-second ` +
            `voicemail: ${recordingUrl.slice(0, 300)}.mp3 (Twilio recording, sign in to Twilio to play it). Please call them back.`,
        });
        await ctx.runMutation(internal.ownerRouting.logOwnerTransfer, {
          orgId: tc.orgId,
          elevenLabsConversationId: conv,
          action: "owner_voicemail_left",
          to: tc.label,
          note: `The owner left a ${seconds}-second voicemail for ${tc.label}. It is on their callback list.`,
        });
      }
    } catch (err) {
      console.error("[owner-voicemail] failed:", err);
    }
    return twimlResponse(ownerVoicemailThanksTwiml(label));
  }),
});

/**
 * Twilio POSTs form-encoded fields, not JSON. Returns empty TwiML so Twilio doesn't also send
 * its own auto-reply — every outbound message goes through our own Twilio REST API call
 * instead, so the bot and staff replies are the only things that ever get texted back.
 * Shared by both the SMS number's webhook and the WhatsApp Sandbox's webhook.
 */
async function handleInboundMessage(
  ctx: GenericActionCtx<DataModel>,
  request: Request,
  channel: "sms" | "whatsapp",
): Promise<Response> {
  const rawBody = await request.text();
  const form = new URLSearchParams(rawBody);
  const denied = await verifyTwilioSignature(request, form);
  if (denied) return denied;
  const from = form.get("From")?.replace(/^whatsapp:/, "");
  const body = form.get("Body");
  const sid = form.get("MessageSid") ?? undefined;

  if (from && body) {
    await ctx.runMutation(internal.threads.ingestInbound, {
      channel,
      customerPhone: from,
      text: body,
      twilioSid: sid,
    });
  }

  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

http.route({
  path: "/webhooks/twilio/sms",
  method: "POST",
  handler: httpAction((ctx, request) => handleInboundMessage(ctx, request, "sms")),
});

http.route({
  path: "/webhooks/twilio/whatsapp",
  method: "POST",
  handler: httpAction((ctx, request) => handleInboundMessage(ctx, request, "whatsapp")),
});

// --- Post-call webhook -----------------------------------------------------

/**
 * Fires when ElevenLabs finishes processing a call — the only path phone calls have into the
 * dashboard, since there is no browser to stream a live transcript from. Also reconciles
 * browser calls (already logged live) by conversation id rather than duplicating them.
 *
 * HMAC verification against ELEVENLABS_POST_CALL_WEBHOOK_SECRET — exact header name to be
 * confirmed against a real fired webhook once configured in the ElevenLabs dashboard.
 */
http.route({
  path: "/webhooks/elevenlabs/post-call",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.ELEVENLABS_POST_CALL_WEBHOOK_SECRET;
    const signature = request.headers.get("ElevenLabs-Signature");
    if (!secret) {
      console.warn("[post-call] ELEVENLABS_POST_CALL_WEBHOOK_SECRET is not set; rejecting.");
      return new Response("not configured", { status: 503 });
    }
    if (!signature) return new Response("missing signature", { status: 401 });
    const rawBody = await request.text();

    // Verify BEFORE any write. (debugWebhookLogs is no longer written to.)
    const valid = await verifyHmacSignature(rawBody, signature, secret);
    if (!valid) return new Response("invalid signature", { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    await ctx.runMutation(internal.conversations.ingestFromWebhook, { payload });

    // Business-line forwarding "last call seen". We cannot tell a forwarded call from a direct
    // call to Sarah's number, so this only records that a phone call arrived. Best effort: it
    // must never fail the webhook. Only the last 4 digits of the caller are kept (orgSettings).
    try {
      const otlp = isOtlpPayload(payload) ? parseOtlp(payload) : null;
      type CallShape = {
        metadata?: { phone_call?: { external_number?: string }; caller_id?: string; start_time_unix_secs?: number };
        conversation_initiation_client_data?: { caller_id?: string };
      };
      const d = ((payload as { data?: CallShape } | null)?.data ?? payload) as CallShape | null;
      const callerNumber: string | undefined =
        otlp?.callerNumber ??
        d?.metadata?.phone_call?.external_number ??
        d?.metadata?.caller_id ??
        d?.conversation_initiation_client_data?.caller_id;
      const startSec: number | undefined = d?.metadata?.start_time_unix_secs;
      const startedAtMs = otlp?.startedAt ?? (typeof startSec === "number" ? startSec * 1000 : Date.now());
      if (otlp?.callerNumber || d?.metadata?.phone_call || callerNumber) {
        await ctx.runMutation(internal.orgSettings.forwardingRecordCall, {
          startedAtMs,
          callerNumber: typeof callerNumber === "string" ? callerNumber : undefined,
        });
      }
    } catch {
      console.warn("[post-call] forwarding last-seen update failed");
    }

    return new Response("ok", { status: 200 });
  }),
});

async function verifyHmacSignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  // ElevenLabs' documented format is "t=<timestamp>,v0=<hex hmac-sha256 of `${timestamp}.${body}`>".
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts.t;
  const providedSig = parts.v0;
  if (!timestamp || !providedSig) return false;

  // Replay protection: reject timestamps more than 5 minutes off.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const computedHex = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedHex, providedSig);
}

export default http;
