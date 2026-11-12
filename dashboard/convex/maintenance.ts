import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { canManageMaintenance, currentOrg, requireAdminView, requireOrg, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { amScope, canSeeUnit, EMPTY_AM_SCOPE } from "./amScope";
import type { AmScope } from "./amScope";
import { nextNumber } from "./counters";
import { photoEmailForRequest } from "./photoEmails";
import { scheduleEmergencyAlert, scheduleNotify, staffRecipientIds } from "./notify";
import { toE164 } from "./phone";
import { isSmsAllowed } from "./twilioApi";
import { createPublicLink, peekPublicLink } from "./publicLinks";
import { sha256 } from "./team";
import { findResidentsByPhone } from "./residents";
import { sortExceptionRows } from "./exceptionOrder";
import { clampSeverity } from "./severity";
import { tenantMessage } from "./sarahConfigRead";
import { normalizeUnitKey } from "./units";
import { exactUnitInProperty } from "./sarahTools";
// Import cycle with workOrders.ts (it imports from here): safe, forTechnician is only called inside handlers.
import { forTechnician } from "./workOrders";

/**
 * Maintenance requests (F4): the intake record Sarah (or a person) creates. Separate from a
 * work order on purpose: nothing becomes a work order until a human decides it should.
 *
 * Scope rules, all enforced here and never from client-supplied ids:
 *   - admin view (team admin, executive, maintenance lead, simplr_admin) reads everything;
 *   - an asset manager reads requests on the units they manage or cover (amScope.ts) plus any
 *     assigned to them, and ACTS only on their managed units (covering is read-only);
 *   - every Admin (canManageMaintenance === admin view) acts on everything.
 * A request outside the caller's scope reads as null / "not found", never "forbidden", so a
 * probing client can't tell it exists.
 */

type Status = Doc<"maintenanceRequests">["status"];
type Severity = Doc<"maintenanceRequests">["severity"];

// Texting policy (twilioApi.ts): tenant texts are not on the allowlist, so these are false for now.
const TENANT_TEXTS_ENABLED = isSmsAllowed("tenant_message");
const TEXTING_OFF_REASON = "Texting is turned off for now";

const MAX_TEXT = 4000;
const DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000;
const STUCK_NEW_MS = 4 * 60 * 60 * 1000; // untouched "new" this long counts as stuck
const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_MEDIA_PER_REQUEST = 30;
const LIST_CAP = 200;

export const severityValidator = v.union(
  v.literal("emergency"),
  v.literal("urgent"),
  v.literal("routine"),
  v.literal("informational"),
);

const SEVERITY_RANK: Record<Severity, number> = {
  emergency: 0,
  urgent: 1,
  routine: 2,
  informational: 3,
};

// --- Lifecycle --------------------------------------------------------------

const OPEN: Status[] = ["new", "under_review", "more_info_needed", "forwarded_to_pat"];
const CLOSED: Status[] = ["work_order_created", "closed_out_of_scope", "closed_duplicate"];

/**
 * The ONLY definition of which status moves are legal (F5: one server function per record).
 * Role checks live in each mutation; this answers "can this record go there at all".
 * work_order_created is reachable from any open status because Pat may act on an emergency
 * before it was forwarded.
 */
const TRANSITIONS: Record<Status, Status[]> = {
  new: ["under_review", "more_info_needed", "closed_out_of_scope", "closed_duplicate", "work_order_created"],
  under_review: [
    "under_review",
    "more_info_needed",
    "forwarded_to_pat",
    "closed_out_of_scope",
    "closed_duplicate",
    "work_order_created",
  ],
  more_info_needed: ["under_review", "closed_out_of_scope", "closed_duplicate", "work_order_created"],
  forwarded_to_pat: ["under_review", "closed_out_of_scope", "closed_duplicate", "work_order_created"],
  work_order_created: [],
  closed_out_of_scope: [],
  closed_duplicate: [],
};

export function assertRequestTransition(from: Status, to: Status): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConvexError(`A request that is "${from.replace(/_/g, " ")}" can't be moved to "${to.replace(/_/g, " ")}".`);
  }
}

// --- Access helpers ---------------------------------------------------------

export function isAssetManager(org: OrgContext): boolean {
  return org.jobRoles.includes("asset_manager");
}

/** The viewer's unit scope: loaded only for an asset manager, empty for everyone else. */
export async function scopeOf(ctx: QueryCtx, org: OrgContext): Promise<AmScope> {
  return viewFor(org.isAdmin, org.jobRoles) === "asset_manager" ? await amScope(ctx, org) : EMPTY_AM_SCOPE;
}

/**
 * Read scope: admin view sees the team's requests, an AM those on units they manage or cover,
 * plus any assigned to them (a person-level fallback Pat approved).
 */
export function canRead(org: OrgContext, req: Doc<"maintenanceRequests">, scope: AmScope): boolean {
  if (req.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  if (!isAssetManager(org)) return false;
  return req.assignedAssetManagerUserId === org.user._id || canSeeUnit(scope, req.unitId);
}

/** Act scope: Pat powers on everything, an AM on managed units only. Covering is read-only. */
export function canAct(org: OrgContext, req: Doc<"maintenanceRequests">, scope: AmScope): boolean {
  if (req.orgId !== org.orgId) return false;
  if (canManageMaintenance(org)) return true;
  if (!isAssetManager(org)) return false;
  return req.assignedAssetManagerUserId === org.user._id || (req.unitId !== undefined && scope.managed.has(req.unitId));
}

/**
 * May this person add photos / videos to the request? Any admin-view user (team admin, executive,
 * maintenance lead, Simplr admin) in ANY status, plus whoever can act on it (the unit's own AM).
 * Covering AMs stay read-only. This is the single rule behind board.detail's `canAttach` flag and
 * the upload / attach mutations.
 */
export function canAttachMedia(org: OrgContext, req: Doc<"maintenanceRequests">, scope: AmScope): boolean {
  if (req.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  return canAct(org, req, scope);
}

/**
 * May this person delete this request photo / video? Must be able to attach to the request. The
 * admin view: any media, any status. The unit's own AM: only media they uploaded themselves
 * (never tenant-uploaded; older rows with no recorded uploader are admin-only). Covering AMs and
 * everyone else: never. Single rule behind board.removeMedia and the `canRemove` flags.
 */
export function canRemoveRequestMedia(
  org: OrgContext,
  req: Doc<"maintenanceRequests">,
  scope: AmScope,
  m: Doc<"maintenanceMedia">,
): boolean {
  if (m.orgId !== org.orgId || m.requestId !== req._id) return false;
  if (!canAttachMedia(org, req, scope)) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  return m.uploadedBy === "staff" && m.uploadedByUserId === org.user._id && canAct(org, req, scope);
}

/** Like actableRequest, but with the (wider) attach-media permission. */
export async function attachableRequest(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
): Promise<{ org: OrgContext; req: Doc<"maintenanceRequests"> }> {
  const org = await requireOrg(ctx);
  const req = await ctx.db.get(requestId);
  const scope = await scopeOf(ctx, org);
  if (!req || !canRead(org, req, scope)) throw new ConvexError("Request not found.");
  if (!canAttachMedia(org, req, scope)) throw new ConvexError("You don't have access to that.");
  return { org, req };
}

export async function actableRequest(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
): Promise<{ org: OrgContext; req: Doc<"maintenanceRequests"> }> {
  const org = await requireOrg(ctx);
  const req = await ctx.db.get(requestId);
  const scope = await scopeOf(ctx, org);
  if (!req || !canRead(org, req, scope)) throw new ConvexError("Request not found.");
  if (!canAct(org, req, scope)) throw new ConvexError("You don't have access to that.");
  return { org, req };
}

async function patOnlyRequest(ctx: MutationCtx, requestId: Id<"maintenanceRequests">) {
  const org = await requireOrg(ctx);
  const req = await ctx.db.get(requestId);
  if (!req || !canRead(org, req, await scopeOf(ctx, org))) throw new ConvexError("Request not found.");
  if (!canManageMaintenance(org)) throw new ConvexError("You don't have access to that.");
  return { org, req };
}

function requireText(raw: string, label: string, max = 1000): string {
  const out = raw.trim();
  if (!out) throw new ConvexError(`${label} is required.`);
  if (out.length > max) throw new ConvexError(`${label} is too long (at most ${max} characters).`);
  return out;
}

function optText(raw: string | undefined, max = MAX_TEXT): string | undefined {
  const out = raw?.trim();
  if (!out) return undefined;
  return out.slice(0, max);
}

function firstNameOf(full: string | undefined): string | undefined {
  return full?.trim().split(/\s+/)[0] || undefined;
}

/** Everyone who is the "Pat" tier or a team admin, minus the person who just acted. */
async function staffExcept(ctx: QueryCtx, orgId: string, exclude?: Id<"users">) {
  return (await staffRecipientIds(ctx, orgId)).filter((id) => id !== exclude);
}

/**
 * The asset manager(s) to tell about a request: the unit's AM (falling back to the assignee),
 * plus their covering AM when the owner is currently out of office. `exclude` is the actor.
 */
async function amRecipients(ctx: QueryCtx, req: Doc<"maintenanceRequests">, exclude?: Id<"users">) {
  const ids = new Set<Id<"users">>();
  const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
  const owner = unit?.assetManagerUserId ?? req.assignedAssetManagerUserId;
  if (req.assignedAssetManagerUserId) ids.add(req.assignedAssetManagerUserId);
  if (owner) {
    ids.add(owner);
    const m = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", owner))
      .first();
    if (
      m &&
      m.orgId === req.orgId &&
      m.coveringUserId &&
      m.unavailableUntil !== undefined &&
      m.unavailableUntil > Date.now()
    ) {
      ids.add(m.coveringUserId);
    }
  }
  if (exclude) ids.delete(exclude);
  return [...ids];
}

// --- Routing (single source of truth) ----------------------------------------

function nameTokens(raw: string | undefined): string[] {
  return (raw ?? "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 2 && t !== "jr" && t !== "sr");
}

/**
 * Case-insensitive first/last name token overlap between the spoken name and the unit's active
 * residents. "unknown" when there is no spoken name or no resident on file. The result is shown
 * to the asset manager only and is never said to the caller.
 */
async function compareNameToUnit(
  ctx: QueryCtx,
  unitId: Id<"units">,
  callerName: string | undefined,
): Promise<"true" | "false" | "unknown"> {
  const spoken = nameTokens(callerName);
  if (spoken.length === 0) return "unknown";
  const residents = (
    await ctx.db
      .query("residents")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .take(20)
  ).filter((r) => r.active);
  if (residents.length === 0) return "unknown";
  const known = new Set(residents.flatMap((r) => nameTokens(r.fullName)));
  return spoken.some((t) => known.has(t)) ? "true" : "false";
}

type RouteOptions = {
  actorUserId?: Id<"users">; // absent = Sarah/system
  unitId?: Id<"units">; // a human-chosen unit (fix unit / resolve exception / manual)
  notify: boolean;
};

/**
 * Plan F4 routing, steps 1-6:
 *  1. exact unit match (property + unitNumberKey); else caller ID -> residentPhones -> unit,
 *     but only when the spoken unit/property doesn't contradict it; else none.
 *  2. none -> exception queue, never guess.
 *  3. no AM, or maintenance intake off for the unit -> exception queue.
 *  4. AM unavailable -> stays assigned to them (no silent reassign), flagged, Pat + admins told.
 *  5. otherwise assigned to the unit's AM.
 *  6. audit row for the decision.
 * Then the duplicate check (flag only, never auto-merge) and the notifications.
 */
async function routeRequest(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
  opts: RouteOptions,
): Promise<void> {
  const req = await ctx.db.get(requestId);
  if (!req) return;
  const now = Date.now();

  // --- 1. Which unit? ---
  let unit: Doc<"units"> | null = null;
  let confidence: Doc<"maintenanceRequests">["matchConfidence"] = "none";

  if (opts.unitId) {
    const chosen = await ctx.db.get(opts.unitId);
    if (!chosen || chosen.orgId !== req.orgId) throw new ConvexError("Unit not found.");
    unit = chosen;
    confidence = "exact"; // a person picked it
  } else {
    let propertyId = req.propertyId;
    if (!propertyId) {
      // Only when the team has exactly one building is the property unambiguous. With several,
      // a spoken address must have been matched by the caller of createFromCall.
      const props = await ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", req.orgId))
        .take(2);
      if (props.length === 1) propertyId = props[0]._id;
    }
    const spokenKey = req.spokenUnit ? normalizeUnitKey(req.spokenUnit) : "";
    if (propertyId) {
      // Same rule as Sarah's find_unit: an exact reading of the spoken unit, or the only unit of a
      // single-unit building (a house). A merely similar label never matches here.
      const found = await exactUnitInProperty(ctx, req.orgId, propertyId, req.spokenUnit);
      if (found) {
        unit = found;
        confidence = "exact";
      }
    }
    // A resident-directory match by phone / e-mail is used only when it points at ONE unit and
    // does not contradict what the caller said about the unit or building.
    const fromMatches = async (matches: Array<{ unitId: Id<"units"> }>): Promise<Doc<"units"> | null> => {
      const unitIds = [...new Set(matches.map((m) => m.unitId))];
      if (unitIds.length !== 1) return null;
      const candidate = await ctx.db.get(unitIds[0]);
      const contradicted =
        !candidate ||
        candidate.orgId !== req.orgId ||
        (spokenKey !== "" && spokenKey !== candidate.unitNumberKey) ||
        (req.propertyId !== undefined && req.propertyId !== candidate.propertyId);
      return candidate && !contradicted ? candidate : null;
    };
    if (!unit && req.callerNumber) {
      const candidate = await fromMatches(await findResidentsByPhone(ctx, req.orgId, req.callerNumber));
      if (candidate) {
        unit = candidate;
        confidence = "caller_id";
      }
    }
    // No lookup by a phone number or e-mail the caller SAYS: only the telephony caller ID above
    // and the spoken property + unit may match a unit. Anything else goes to the exception queue.
  }

  // Link the resident when the caller's number singles one out within the resolved unit.
  let residentId = req.residentId;
  if (unit && req.callerNumber) {
    const inUnit = (await findResidentsByPhone(ctx, req.orgId, req.callerNumber)).filter(
      (m) => m.unitId === unit!._id,
    );
    if (inUnit.length === 1) residentId = inUnit[0].residentId;
  }
  if (residentId && unit) {
    const resident = await ctx.db.get(residentId);
    if (!resident || resident.unitId !== unit._id) residentId = undefined; // stale after a unit fix
  }
  if (!unit) residentId = undefined;

  // Does the name the caller gave match someone who lives in this unit? For the AM's eyes only.
  const nameMatchesResident = unit ? await compareNameToUnit(ctx, unit._id, req.callerName) : undefined;

  // --- 2-5. Where does it go? ---
  let routeReason: string;
  let inException = false;
  let assigned: Id<"users"> | undefined;

  if (!unit) {
    routeReason = "no unit match";
    inException = true;
  } else if (!unit.maintenanceIntakeActive) {
    routeReason = "unit not active for maintenance intake";
    inException = true;
  } else {
    const am = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", unit!.assetManagerUserId))
      .first();
    if (!am || am.orgId !== req.orgId || !(am.jobRoles ?? []).includes("asset_manager")) {
      routeReason = "unit has no asset manager";
      inException = true;
    } else if (am.unavailableUntil !== undefined && am.unavailableUntil > now) {
      // Stays with the unit's AM. Reassigning silently would hide the request from the person
      // accountable for it; a human approves any fallback (approveFallback).
      assigned = am.userId;
      routeReason = "AM unavailable";
      inException = true;
    } else {
      assigned = am.userId;
      routeReason = "unit AM";
    }
  }

  await ctx.db.patch(req._id, {
    propertyId: unit?.propertyId ?? req.propertyId,
    unitId: unit?._id,
    residentId,
    nameMatchesResident,
    matchConfidence: confidence,
    assignedAssetManagerUserId: assigned,
    routeReason,
    inExceptionQueue: inException,
    updatedAt: now,
  });

  // --- 6. Audit ---
  await writeAudit(ctx, {
    orgId: req.orgId,
    entity: "request",
    entityId: req._id,
    action: "routed",
    actorUserId: opts.actorUserId,
    from: req.routeReason,
    to: routeReason,
    note: unit ? `Unit ${unit.unitNumber} (${confidence.replace("_", " ")})` : "No unit matched",
  });

  // --- Duplicate check: same unit + issue type, open, within 72 h. Flag, never merge. ---
  if (unit && !req.possibleDuplicateOf) {
    const recent = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_unit_and_created", (q) =>
        q.eq("unitId", unit!._id).gte("createdAt", now - DUPLICATE_WINDOW_MS),
      )
      .order("desc")
      .take(30);
    const original = recent.find(
      (r) =>
        r._id !== req._id &&
        r.createdAt <= req.createdAt &&
        r.issueType === req.issueType &&
        OPEN.includes(r.status),
    );
    if (original) {
      await ctx.db.patch(req._id, { possibleDuplicateOf: original._id });
      await writeAudit(ctx, {
        orgId: req.orgId,
        entity: "request",
        entityId: req._id,
        action: "possible_duplicate",
        actorUserId: opts.actorUserId,
        note: `Possible duplicate of MR-${original.number}`,
      });
    }
  }

  if (opts.notify) {
    await notifyForRouting(ctx, { ...req, severity: req.severity }, unit, assigned, routeReason, inException, opts.actorUserId);
  }
}

/**
 * Texts the admins if this request is an emergency right now. Safe to call from every path that
 * creates or updates a request: it re-reads the saved severity and is deduped per request and per
 * phone call, so routing re-runs and webhook re-sends never text twice. Returns true when admins
 * have been alerted (now or earlier).
 */
async function alertIfEmergency(ctx: MutationCtx, requestId: Id<"maintenanceRequests">): Promise<boolean> {
  const req = await ctx.db.get(requestId);
  if (!req || req.severity !== "emergency") return false;
  const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
  return await scheduleEmergencyAlert(ctx, {
    orgId: req.orgId,
    keys: [
      { entity: "request", id: req._id },
      ...(req.elevenLabsConversationId ? [{ entity: "conversation" as const, id: req.elevenLabsConversationId }] : []),
    ],
    number: req.number,
    unit: unit?.unitNumber,
    path: `/maintenance/${req._id}`,
  });
}

/** Plan section 9: urgent -> AM + Pat + admins; AM unavailable / exception -> Pat + admins. */
async function notifyForRouting(
  ctx: MutationCtx,
  req: Doc<"maintenanceRequests">,
  unit: Doc<"units"> | null,
  assigned: Id<"users"> | undefined,
  routeReason: string,
  inException: boolean,
  actor: Id<"users"> | undefined,
): Promise<void> {
  const staff = await staffExcept(ctx, req.orgId, actor);
  const data = {
    number: req.number,
    unit: unit?.unitNumber,
    firstName: firstNameOf(req.callerName),
    severity: req.severity,
    path: `/maintenance/${req._id}`,
  };
  if (req.severity === "emergency") {
    // The only routing event that texts anyone: admins, once per request/call (see scheduleEmergencyAlert).
    await alertIfEmergency(ctx, req._id);
  } else if (req.severity === "urgent") {
    // Urgent no longer texts; the request is already in the AM's and Pat's in-app queues.
  } else if (routeReason === "AM unavailable") {
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: staff, template: "am_unavailable", data });
  } else if (inException) {
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: staff, template: "request_exception", data });
  } else if (assigned && assigned !== actor) {
    // A routine request that landed cleanly: tell the unit's asset manager (and their cover while
    // they are out) that a ready-made draft is waiting for review.
    const fresh = await ctx.db.get(req._id);
    const ids = fresh ? await amRecipients(ctx, fresh, actor) : [assigned];
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: ids, template: "request_new", data });
  }
}

// --- Creation ---------------------------------------------------------------

const answersValidator = v.array(v.object({ key: v.string(), question: v.string(), value: v.string() }));

function cleanAnswers(answers: Array<{ key: string; question: string; value: string }>) {
  return answers.slice(0, 50).map((a) => ({
    key: a.key.slice(0, 80),
    question: a.question.slice(0, 300),
    value: a.value.slice(0, 1000),
  }));
}

/**
 * The description already on the request Sarah logged in this call, or null when there is none.
 * Lets log_maintenance_request keep that description when a later update call sends a vague one
 * ("maintenance issue") instead of refusing the update or overwriting what the caller said.
 */
export const callRequestDescription = internalQuery({
  args: { orgId: v.string(), elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const rows = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
      .collect();
    return rows.find((r) => r.orgId === args.orgId)?.description ?? null;
  },
});

/**
 * Called by Sarah's maintenance tool (wired later) and by the post-call webhook. Upserts on
 * the ElevenLabs conversation id so a tool call followed by the webhook is one request, not
 * two. Internal: orgId is trusted because no client can reach it.
 */
export const createFromCall = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    callerName: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    spokenAddress: v.optional(v.string()),
    spokenUnit: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    issueType: v.string(),
    description: v.string(),
    firstNoticed: v.optional(v.string()),
    answers: v.optional(answersValidator),
    pets: v.optional(v.string()),
    preferredAccessTimes: v.optional(v.string()),
    severity: severityValidator,
    severityScore: v.optional(v.number()),
    severityReason: v.optional(v.string()),
    mediaRequested: v.optional(v.boolean()),
    photosPending: v.optional(v.boolean()),
    title: v.optional(v.string()),
    callerEmail: v.optional(v.string()),
    // A resident's question / non-repair need (Sarah's log_task_request). Filed as a request in the
    // same work-order format, marked with a "Question" kind answer so the AM can tell it apart.
    isQuestion: v.optional(v.boolean()),
    // The number Sarah read back and the caller confirmed (log_maintenance_request confirmed_phone).
    // Validated again here; one that is not a real phone number is ignored, never stored.
    smsConfirmPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CreatedFromCall> => {
    let propertyId = args.propertyId;
    if (propertyId) {
      const property = await ctx.db.get(propertyId);
      if (!property || property.orgId !== args.orgId) propertyId = undefined;
    }
    let conversationId = args.conversationId;
    if (!conversationId && args.elevenLabsConversationId) {
      const elId = args.elevenLabsConversationId;
      conversationId = (
        await ctx.db
          .query("conversations")
          .withIndex("by_elevenlabs_conversation_id", (q) => q.eq("elevenLabsConversationId", elId))
          .first()
      )?._id;
    }

    const issueType = requireText(args.issueType, "Issue type", 40);
    const description = requireText(args.description, "Description", MAX_TEXT);
    const smsConfirmPhone = args.smsConfirmPhone ? (toE164(args.smsConfirmPhone) ?? undefined) : undefined;
    const fields = {
      conversationId,
      callerName: optText(args.callerName, 120),
      callerNumber: optText(args.callerNumber, 40),
      callbackNumber: optText(args.callbackNumber, 40),
      callerEmail: optText(args.callerEmail, 200)?.toLowerCase(),
      spokenAddress: optText(args.spokenAddress, 300),
      spokenUnit: optText(args.spokenUnit, 60),
      propertyId,
      title: optText(args.title, 120) ?? autoTitle(issueType, description),
      issueType,
      description,
      firstNoticed: optText(args.firstNoticed, 200),
      answers: cleanAnswers([
        ...(args.isQuestion ? [{ key: "request_kind", question: "Category", value: "Question" }] : []),
        ...(args.answers ?? []),
      ]),
      pets: optText(args.pets, 300),
      preferredAccessTimes: optText(args.preferredAccessTimes, 300),
      severity: args.severity,
      severityScore: args.severityScore,
      severityReason: optText(args.severityReason, 500),
      mediaRequested: args.mediaRequested,
      photosPending: args.photosPending,
      smsConfirmPhone,
    };
    const outOfScope = issueType === "tenant_responsibility";

    const elId = args.elevenLabsConversationId;
    if (elId) {
      const existing = (
        await ctx.db
          .query("maintenanceRequests")
          .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", elId))
          .collect()
      ).find((r) => r.orgId === args.orgId);
      if (existing) {
        // A person's severity override must survive the webhook re-sending Sarah's original.
        const keepSeverity = existing.originalSeverity !== undefined;
        // Only what this call actually supplied is applied: a later, fuller call adds to the
        // request and never blanks what an earlier one captured. Answers merge by key.
        const patch: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(fields)) if (val !== undefined) patch[k] = val;
        const merged = new Map(existing.answers.map((a) => [a.key, a]));
        for (const a of fields.answers) merged.set(a.key, a);
        patch.answers = [...merged.values()].slice(0, 50);
        // A human-edited title survives; Sarah's auto title only fills an empty one.
        if (existing.title && args.title === undefined) delete patch.title;
        await ctx.db.patch(existing._id, {
          ...patch,
          severity: keepSeverity ? existing.severity : fields.severity,
          propertyId: fields.propertyId ?? existing.propertyId,
          updatedAt: Date.now(),
        });
        // Re-route only while nobody has touched it; after that a human owns the routing.
        if (existing.status === "new") {
          await routeRequest(ctx, existing._id, { notify: false });
          if (outOfScope) await closeTenantResponsibility(ctx, existing._id, fields.severityReason);
          // Logged early with nothing to route on, and the unit has just been matched: the
          // asset manager has not been told yet, so do it now.
          const after = await ctx.db.get(existing._id);
          if (
            after &&
            !outOfScope &&
            after.assignedAssetManagerUserId &&
            !after.inExceptionQueue &&
            (existing.inExceptionQueue || !existing.assignedAssetManagerUserId)
          ) {
            const unit = after.unitId ? await ctx.db.get(after.unitId) : null;
            await notifyForRouting(ctx, after, unit, after.assignedAssetManagerUserId, after.routeReason ?? "", false, undefined);
          }
        }
        // Severity may have just been raised to emergency (or the first alert never went out).
        const alerted = await alertIfEmergency(ctx, existing._id);
        return await createdSummary(ctx, existing._id, false, alerted);
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("maintenanceRequests", {
      orgId: args.orgId,
      number: await nextNumber(ctx, args.orgId, "maintenanceRequest"),
      source: "phone",
      elevenLabsConversationId: elId,
      ...fields,
      mediaRequested: fields.mediaRequested ?? false,
      matchConfidence: "none",
      inExceptionQueue: false,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "request",
      entityId: id,
      action: "created",
      to: "new",
      note: "Taken by Sarah",
    });
    if (outOfScope) {
      // Tenant-responsibility items (bulbs, blinds, trash to the curb) need no approval: route so
      // the unit and AM are on the record, then close as out of scope with the reason.
      await routeRequest(ctx, id, { notify: false });
      await closeTenantResponsibility(ctx, id, fields.severityReason);
    } else {
      await routeRequest(ctx, id, { notify: true });
    }
    // Covers every route above, including the exception queue and tenant-responsibility items.
    const alerted = await alertIfEmergency(ctx, id);
    return await createdSummary(ctx, id, true, alerted);
  },
});

export type CreatedFromCall = {
  requestId: Id<"maintenanceRequests">;
  number: number;
  created: boolean;
  status: Status;
  unitLabel: string | null;
  /** Reached a named asset manager's queue (not the exception queue). */
  routedToAm: boolean;
  amFirstName: string | null;
  /** Admins have been texted about this emergency (now or earlier). False for anything else. */
  emergencyAlerted: boolean;
};

async function createdSummary(
  ctx: MutationCtx,
  id: Id<"maintenanceRequests">,
  created: boolean,
  emergencyAlerted: boolean,
): Promise<CreatedFromCall> {
  const req = await ctx.db.get(id);
  if (!req) throw new ConvexError("Request not found.");
  const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
  const am = req.assignedAssetManagerUserId ? await ctx.db.get(req.assignedAssetManagerUserId) : null;
  return {
    requestId: id,
    number: req.number,
    created,
    status: req.status,
    unitLabel: unit?.unitNumber ?? null,
    routedToAm: Boolean(req.assignedAssetManagerUserId) && !req.inExceptionQueue,
    amFirstName: am?.firstName ?? null,
    emergencyAlerted,
  };
}

const TENANT_RESPONSIBILITY_REASON =
  "Tenant responsibility per company policy (light bulbs, window blinds, trash to the curb). Logged by Sarah.";

/** Closes a still-new request as out of scope, with an audit row; no asset-manager approval needed. */
async function closeTenantResponsibility(
  ctx: MutationCtx,
  id: Id<"maintenanceRequests">,
  reason: string | undefined,
): Promise<void> {
  const req = await ctx.db.get(id);
  if (!req || req.status !== "new") return;
  assertRequestTransition(req.status, "closed_out_of_scope");
  const closeReason = (reason ? `${TENANT_RESPONSIBILITY_REASON} ${reason}` : TENANT_RESPONSIBILITY_REASON).slice(0, 500);
  await ctx.db.patch(id, { status: "closed_out_of_scope", closeReason, updatedAt: Date.now() });
  await writeAudit(ctx, {
    orgId: req.orgId,
    entity: "request",
    entityId: id,
    action: "closed_out_of_scope",
    from: req.status,
    to: "closed_out_of_scope",
    note: "Closed by Sarah: tenant responsibility",
  });
}

const ISSUE_LABELS: Record<string, string> = {
  electrical: "Electrical",
  water_leak: "Water leak",
  broken_item: "Broken item",
  gas: "Gas",
  fire: "Fire",
  flooding: "Flooding",
  tenant_responsibility: "Tenant responsibility",
  other: "Maintenance",
};

/** "Water leak: kitchen ceiling dripping" - the work-order title shown on the draft. */
function autoTitle(issueType: string, description: string): string {
  const label = ISSUE_LABELS[issueType] ?? "Maintenance";
  const first = description.split(/[.\n]/)[0].trim().slice(0, 70);
  return first ? `${label}: ${first}` : label;
}

/**
 * send_photo_link (route and tool name kept to avoid re-registering the tool): Sarah texts NOBODY.
 * When a caller agrees to send photos this only records a "photo request from the call" on the
 * request and tells the unit's asset manager (and cover while out) so THEY decide what to do.
 * The AM-initiated "Ask tenant for photos" text (requestInfo) is unchanged.
 *
 * The SMS is fixed wording with no free text; what the caller said stays behind the login.
 * Only the first call for a request notifies, so repeated calls cannot spam the AM.
 */
export const photoRequestFromCall = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    note: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    callerEmail: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ recorded: true; number: number; photoEmail: string | null } | { recorded: false }> => {
    const req = (
      await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
        .collect()
    ).find((r) => r.orgId === args.orgId);
    if (!req || !OPEN.includes(req.status)) return { recorded: false };

    const first = req.photosRequestedByCaller !== true;
    const patch: Partial<Doc<"maintenanceRequests">> = {
      photosRequestedByCaller: true,
      photosRequestedAt: first ? Date.now() : req.photosRequestedAt,
      updatedAt: Date.now(),
    };
    const note = optText(args.note, 500);
    if (note) patch.photosRequestNote = note;
    const callerNumber = optText(args.callerNumber, 40);
    const callbackNumber = optText(args.callbackNumber, 40);
    const callerEmail = optText(args.callerEmail, 200)?.toLowerCase();
    if (callerNumber && !req.callerNumber) patch.callerNumber = callerNumber;
    if (callbackNumber) patch.callbackNumber = callbackNumber;
    if (callerEmail) patch.callerEmail = callerEmail;
    await ctx.db.patch(req._id, patch);

    if (first) {
      const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
      let ids = await amRecipients(ctx, req);
      if (ids.length === 0) ids = await staffExcept(ctx, req.orgId);
      await scheduleNotify(ctx, {
        orgId: req.orgId,
        userIds: ids,
        template: "photo_request",
        data: { number: req.number, unit: unit?.unitNumber, path: `/maintenance/${req._id}` },
      });
      await writeAudit(ctx, {
        orgId: req.orgId,
        entity: "request",
        entityId: req._id,
        action: "photo_request_from_call",
        note: "Caller agreed to send photos; asset manager told",
      });
    }
    // Where Sarah tells them to email the photos: the unit's asset manager's address, or none.
    return { recorded: true, number: req.number, photoEmail: await photoEmailForRequest(ctx, req) };
  },
});

/** A request typed in by staff (a call that never went through Sarah, a walk-in, an email). */
export const createManual = mutation({
  args: {
    unitId: v.id("units"),
    issueType: v.string(),
    description: v.string(),
    severity: severityValidator,
    callerName: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    residentId: v.optional(v.id("residents")),
    firstNoticed: v.optional(v.string()),
    pets: v.optional(v.string()),
    preferredAccessTimes: v.optional(v.string()),
    // Skip the asset-manager review: validate and forward to the maintenance lead in the same
    // call. Admin view (executive / admin / Pat) may choose; an asset manager CANNOT skip it:
    // for them the server forces it true, whatever the client sent.
    autoForward: v.optional(v.boolean()),
    // Optional 1-10 score alongside the named level; clamped server-side.
    severityScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ requestId: Id<"maintenanceRequests">; number: number }> => {
    const org = await requireOrg(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");

    // WHO MAY CREATE (decided by the owner):
    //  - Admin view (team admin, Executive/Alex, Pat, simplr_admin) may create a manual request for
    //    any unit and forward it; this is deliberate, not an accident of the admin view.
    //  - An asset manager may create ONLY for units they MANAGE. Covering a colleague's units is
    //    read-only, so this checks the unit's own AM and never amScope.covering.
    // WHERE IT GOES: an AM's request ALWAYS lands in Pat's review (forwarded_to_pat, "Waiting on
    // Pat"); it never reaches a technician or becomes a work order from here.
    const adminView = viewFor(org.isAdmin, org.jobRoles) === "admin";
    const ownAm = isAssetManager(org) && unit.assetManagerUserId === org.user._id;
    if (!adminView && !ownAm) throw new ConvexError("You don't have access to that.");

    let residentId: Id<"residents"> | undefined;
    if (args.residentId) {
      const resident = await ctx.db.get(args.residentId);
      if (!resident || resident.orgId !== org.orgId || resident.unitId !== unit._id) {
        throw new ConvexError("That resident doesn't live in this unit.");
      }
      residentId = resident._id;
    }

    const now = Date.now();
    const number = await nextNumber(ctx, org.orgId, "maintenanceRequest");
    const id = await ctx.db.insert("maintenanceRequests", {
      orgId: org.orgId,
      number,
      source: "manual",
      callerName: optText(args.callerName, 120),
      callbackNumber: optText(args.callbackNumber, 40),
      residentId,
      propertyId: unit.propertyId,
      unitId: unit._id,
      matchConfidence: "exact",
      issueType: requireText(args.issueType, "Issue type", 40),
      description: requireText(args.description, "Description", MAX_TEXT),
      title: autoTitle(args.issueType.trim(), args.description.trim()),
      firstNoticed: optText(args.firstNoticed, 200),
      answers: [],
      pets: optText(args.pets, 300),
      preferredAccessTimes: optText(args.preferredAccessTimes, 300),
      severity: args.severity,
      severityScore: args.severityScore === undefined ? undefined : clampSeverity(args.severityScore),
      mediaRequested: false,
      inExceptionQueue: false,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "request",
      entityId: id,
      action: "created",
      actorUserId: org.user._id,
      to: "new",
      note: "Entered manually",
    });
    // Forced for an asset manager (who is not also in the admin view). Pat powers default to
    // forwarding too, unless the form explicitly asks to leave it as a draft.
    const forward = !adminView ? true : canManageMaintenance(org) ? args.autoForward !== false : args.autoForward === true;
    // When forwarding, only Pat's "forwarded" notification goes out; the unit's AM is not told
    // "ready for your review" about a request that already left their queue. Emergencies and
    // urgents still raise their own alert.
    await routeRequest(ctx, id, { actorUserId: org.user._id, unitId: unit._id, notify: !forward || args.severity === "emergency" || args.severity === "urgent" });
    if (forward) {
      const fresh = await ctx.db.get(id);
      if (fresh) await validateAndForward(ctx, org, fresh, undefined);
    }
    return { requestId: id, number };
  },
});

// --- Reads --------------------------------------------------------------------

const TAB_STATUSES = {
  new: ["new", "under_review"],
  waiting: ["more_info_needed"],
  forwarded: ["forwarded_to_pat"],
  closed: CLOSED,
  all: [...OPEN, ...CLOSED],
} as const satisfies Record<string, readonly Status[]>;

const tabValidator = v.union(
  v.literal("new"),
  v.literal("waiting"),
  v.literal("forwarded"),
  v.literal("closed"),
  v.literal("all"),
);

/** Requests with a status inside the caller's scope, newest first. Empty for other roles. */
export async function scopedByStatus(
  ctx: QueryCtx,
  org: OrgContext,
  status: Status,
  limit: number,
  scope?: AmScope,
): Promise<Doc<"maintenanceRequests">[]> {
  const view = viewFor(org.isAdmin, org.jobRoles);
  if (view === "admin") {
    return await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", status))
      .order("desc")
      .take(limit);
  }
  if (view === "asset_manager") {
    // Requests are assigned to their unit's AM, so the viewer's own queue plus the queues of
    // the out-of-office colleagues they cover, narrowed to the units amScope allows.
    const sc = scope ?? (await amScope(ctx, org));
    const rows: Doc<"maintenanceRequests">[] = [];
    for (const owner of [org.user._id, ...sc.coveringFor]) {
      rows.push(
        ...(await ctx.db
          .query("maintenanceRequests")
          .withIndex("by_assigned_am_and_status", (q) =>
            q.eq("assignedAssetManagerUserId", owner).eq("status", status),
          )
          .order("desc")
          .take(limit)),
      );
    }
    return rows
      .filter((r) => r.orgId === org.orgId && (r.assignedAssetManagerUserId === org.user._id || canSeeUnit(sc, r.unitId)))
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, limit);
  }
  return [];
}

async function enrich(ctx: QueryCtx, reqs: Doc<"maintenanceRequests">[]) {
  const units = new Map<string, Doc<"units"> | null>();
  const properties = new Map<string, string>();
  const users = new Map<string, string>();
  const name = async (id: Id<"users"> | undefined) => {
    if (!id) return undefined;
    if (!users.has(id)) {
      const u = await ctx.db.get(id);
      users.set(id, [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown");
    }
    return users.get(id);
  };
  const out = [];
  for (const r of reqs) {
    let unit: Doc<"units"> | null = null;
    if (r.unitId) {
      if (!units.has(r.unitId)) units.set(r.unitId, await ctx.db.get(r.unitId));
      unit = units.get(r.unitId) ?? null;
    }
    let propertyName: string | undefined;
    if (r.propertyId) {
      if (!properties.has(r.propertyId)) {
        properties.set(r.propertyId, (await ctx.db.get(r.propertyId))?.name ?? "Unknown");
      }
      propertyName = properties.get(r.propertyId);
    }
    const media = await ctx.db
      .query("maintenanceMedia")
      .withIndex("by_request", (q) => q.eq("requestId", r._id))
      .take(MAX_MEDIA_PER_REQUEST);
    out.push({
      ...r,
      unitNumber: unit?.unitNumber,
      propertyName,
      assignedAssetManagerName: await name(r.assignedAssetManagerUserId),
      mediaCount: media.length,
      isUnread: r.firstViewedAt === undefined && OPEN.includes(r.status),
    });
  }
  return out;
}

/**
 * The inbox. Admin view sees the whole team (optionally narrowed by assetManagerUserId); an
 * asset manager only requests assigned to them, and a client-supplied assetManagerUserId is
 * ignored for them. Sort: severity first, then oldest first (an untouched emergency must never
 * sink); the closed tab is newest first.
 */
export const list = query({
  args: {
    tab: tabValidator,
    severity: v.optional(severityValidator),
    propertyId: v.optional(v.id("properties")),
    unitId: v.optional(v.id("units")),
    assetManagerUserId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return [];

    const scope = await scopeOf(ctx, org);
    let rows: Doc<"maintenanceRequests">[] = [];
    for (const status of TAB_STATUSES[args.tab]) {
      rows.push(...(await scopedByStatus(ctx, org, status, LIST_CAP, scope)));
    }
    rows = rows.filter((r) => {
      if (args.severity && r.severity !== args.severity) return false;
      if (args.propertyId && r.propertyId !== args.propertyId) return false;
      if (args.unitId && r.unitId !== args.unitId) return false;
      if (view === "admin" && args.assetManagerUserId && r.assignedAssetManagerUserId !== args.assetManagerUserId) {
        return false;
      }
      return true;
    });

    if (args.tab === "closed") rows.sort((a, b) => b.createdAt - a.createdAt);
    else rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt);

    const enriched = await enrich(ctx, rows.slice(0, LIST_CAP));
    const needle = args.search?.trim().toLowerCase();
    if (!needle) return enriched;
    return enriched.filter((r) =>
      [
        `mr-${r.number}`,
        String(r.number),
        r.description,
        r.callerName,
        r.callerNumber,
        r.spokenUnit,
        r.unitNumber,
        r.propertyName,
        r.issueType,
      ].some((f) => f?.toLowerCase().includes(needle)),
    );
  },
});

/** Who rejected a request, when and why, for the rejected state of the drawer. Null while it is not rejected. */
export function closureOf(req: Doc<"maintenanceRequests">, audit: Doc<"auditEvents">[]) {
  if (req.status !== "closed_out_of_scope" && req.status !== "closed_duplicate") return null;
  const row = audit.find(
    (a) =>
      a.to === req.status &&
      (a.action === "closed_out_of_scope" || a.action === "closed_no_work_order" || a.action === "marked_duplicate"),
  );
  return {
    reason: req.closeReason ?? null,
    explanation: req.closeExplanation ?? null,
    byName: row?.actorLabel ?? null,
    at: row?.at ?? req.updatedAt,
  };
}

export const get = query({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const req = await ctx.db.get(args.requestId);
    const scope = await scopeOf(ctx, org);
    if (!req || !canRead(org, req, scope)) return null;

    const [unit, property, resident, conversation, duplicateOf, auditRows, mediaRows, workOrder] =
      await Promise.all([
        req.unitId ? ctx.db.get(req.unitId) : null,
        req.propertyId ? ctx.db.get(req.propertyId) : null,
        req.residentId ? ctx.db.get(req.residentId) : null,
        req.conversationId ? ctx.db.get(req.conversationId) : null,
        req.possibleDuplicateOf ? ctx.db.get(req.possibleDuplicateOf) : null,
        ctx.db
          .query("auditEvents")
          .withIndex("by_entity", (q) => q.eq("entity", "request").eq("entityId", req._id))
          .order("desc")
          .take(100),
        ctx.db
          .query("maintenanceMedia")
          .withIndex("by_request", (q) => q.eq("requestId", req._id))
          .take(MAX_MEDIA_PER_REQUEST),
        ctx.db
          .query("workOrders")
          .withIndex("by_request", (q) => q.eq("requestId", req._id))
          .first(),
      ]);
    const am = req.assignedAssetManagerUserId ? await ctx.db.get(req.assignedAssetManagerUserId) : null;
    const closure = closureOf(req, auditRows.filter((a) => a.orgId === org.orgId));

    // Contact details go only to people who can act on the request (a covering AM reads without them).
    const mayContact = canAct(org, req, scope) || canManageMaintenance(org);
    const visibleReq = mayContact
      ? req
      : {
          ...req,
          callbackNumber: undefined,
          callerNumber: undefined,
          callerEmail: undefined,
          // The caller's own words may contain a number or address, so they follow the same rule.
          photosRequestNote: undefined,
        };

    return {
      request: visibleReq,
      closure,
      unit,
      property,
      resident,
      assignedAssetManagerName: am
        ? [am.firstName, am.lastName].filter(Boolean).join(" ").trim() || am.email || "Unknown"
        : undefined,
      conversation: conversation
        ? {
            _id: conversation._id,
            summary: conversation.summary,
            intent: conversation.intent,
            outcome: conversation.outcome,
            channel: conversation.channel,
            startedAt: conversation.startedAt,
            durationSec: conversation.durationSec,
          }
        : null,
      possibleDuplicateOf:
        duplicateOf && duplicateOf.orgId === org.orgId && canRead(org, duplicateOf, scope)
          ? {
              _id: duplicateOf._id,
              number: duplicateOf.number,
              status: duplicateOf.status,
              createdAt: duplicateOf.createdAt,
            }
          : null,
      media: await Promise.all(
        mediaRows.map(async (m) => ({
          _id: m._id,
          id: m._id as string,
          kind: m.kind,
          uploadedBy: m.uploadedBy,
          source: m.uploadedBy,
          uploadedByUserId: m.uploadedByUserId ?? null,
          createdAt: m.createdAt,
          canRemove: canRemoveRequestMedia(org, req, scope, m),
          url: await ctx.storage.getUrl(m.storageId),
        })),
      ),
      workOrder: workOrder
        ? { _id: workOrder._id, number: workOrder.number, status: workOrder.status }
        : null,
      audit: auditRows.filter((a) => a.orgId === org.orgId),
      // What the UI may offer this viewer. The server re-checks every action regardless.
      canAct: canAct(org, req, scope),
      canManage: canManageMaintenance(org),
      // Adding photos / videos: any admin-view user in any status, or whoever can act on it.
      canAttach: canAttachMedia(org, req, scope),
      // The AM (or Pat) pulling a forwarded request back for more work.
      canWithdraw: req.status === "forwarded_to_pat" && canAct(org, req, scope),
      // Leaving a timeline note: whoever can act, or Pat, while the request is open.
      canAddNote: OPEN.includes(req.status) && (canAct(org, req, scope) || canManageMaintenance(org)),
      // Read-only because the unit's AM is out of office and named this viewer to cover.
      isCovering: !canAct(org, req, scope) && isAssetManager(org) && canSeeUnit(scope, req.unitId),
      // Whether each tenant text is approved in the published Sarah config (buttons disable on false).
      tenantMessages: {
        photoRequest: (await tenantMessage(ctx, org.orgId, "photoRequest")) !== null,
        outOfScope: (await tenantMessage(ctx, org.orgId, "outOfScope")) !== null,
      },
    };
  },
});

/** Most exception rows read at once; when the queue is longer the page says so (`capped`). */
const EXCEPTIONS_READ_CAP = 1000;

/**
 * Requests that couldn't be routed safely, plus assigned-but-AM-unavailable ones. Admin view.
 * Paged on the server (page is 1-based, default 25 per page, max 100). Rows are ordered by routing
 * reason group (groups with an emergency first, so every emergency is on page 1 before any
 * non-emergency; each group stays contiguous), then severity, then oldest.
 * `reasonCounts` covers the whole queue, not just the page.
 */
export const exceptions = query({
  args: { page: v.optional(v.number()), pageSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 25)));
    const read = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_exception", (q) => q.eq("orgId", org.orgId).eq("inExceptionQueue", true))
      .order("desc")
      .take(EXCEPTIONS_READ_CAP + 1);
    const capped = read.length > EXCEPTIONS_READ_CAP;
    const reasonOf = (r: Doc<"maintenanceRequests">) => r.routeReason ?? "other";
    const open = sortExceptionRows(
      read.slice(0, EXCEPTIONS_READ_CAP).filter((r) => OPEN.includes(r.status)),
      (r) => ({ reason: reasonOf(r), severityRank: SEVERITY_RANK[r.severity], createdAt: r.createdAt }),
    );
    const reasonCounts: Record<string, number> = {};
    for (const r of open) reasonCounts[reasonOf(r)] = (reasonCounts[reasonOf(r)] ?? 0) + 1;
    const total = open.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
    const rows = await enrich(ctx, open.slice((page - 1) * pageSize, page * pageSize));
    return { rows, total, page, pageSize, pageCount, reasonCounts, capped, cap: EXCEPTIONS_READ_CAP };
  },
});

/** Pat's queue: everything forwarded, plus open emergencies/urgents pinned above it. */
export const validatedQueue = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const byStatus = async (status: Status) =>
      await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", status))
        .order("desc")
        .take(LIST_CAP);

    const forwarded = await byStatus("forwarded_to_pat");
    const earlier = [
      ...(await byStatus("new")),
      ...(await byStatus("under_review")),
      ...(await byStatus("more_info_needed")),
    ].filter((r) => r.severity === "emergency" || r.severity === "urgent");
    earlier.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt);

    const forwardedRows = await enrich(ctx, forwarded);
    const withForwardInfo = [];
    for (const r of forwardedRows) {
      const events = await ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entity", "request").eq("entityId", r._id))
        .order("desc")
        .take(30);
      const ev = events.find((e) => e.action === "forwarded" && e.orgId === org.orgId);
      withForwardInfo.push({
        ...r,
        forwardedAt: ev?.at,
        forwardedByName: ev?.actorLabel,
        forwardedNote: ev?.note,
      });
    }
    withForwardInfo.sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.forwardedAt ?? 0) - (b.forwardedAt ?? 0),
    );
    return { emergencies: await enrich(ctx, earlier), forwarded: withForwardInfo };
  },
});

/** Inbox counters and sidebar badge, scoped like `list`. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const zero = { new: 0, waiting: 0, forwarded: 0, closed7d: 0, exceptions: 0, emergencies: 0, unread: 0 };
    const org = await currentOrg(ctx);
    if (!org) return zero;
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return zero;

    const cap = 500;
    const scope = await scopeOf(ctx, org);
    const newRows = [
      ...(await scopedByStatus(ctx, org, "new", cap, scope)),
      ...(await scopedByStatus(ctx, org, "under_review", cap, scope)),
    ];
    const waiting = await scopedByStatus(ctx, org, "more_info_needed", cap, scope);
    const forwarded = await scopedByStatus(ctx, org, "forwarded_to_pat", cap, scope);
    const weekAgo = Date.now() - 7 * DAY_MS;
    let closed7d = 0;
    for (const s of CLOSED) {
      closed7d += (await scopedByStatus(ctx, org, s, cap, scope)).filter((r) => r.updatedAt >= weekAgo).length;
    }
    const open = [...newRows, ...waiting, ...forwarded];
    return {
      new: newRows.length,
      waiting: waiting.length,
      forwarded: forwarded.length,
      closed7d,
      exceptions: view === "admin" ? open.filter((r) => r.inExceptionQueue).length : 0,
      emergencies: open.filter((r) => r.severity === "emergency").length,
      unread: open.filter((r) => r.firstViewedAt === undefined).length,
    };
  },
});

// --- Review actions ------------------------------------------------------------

async function move(
  ctx: MutationCtx,
  org: OrgContext,
  req: Doc<"maintenanceRequests">,
  to: Status,
  action: string,
  note: string | undefined,
  patch: Partial<Doc<"maintenanceRequests">> = {},
): Promise<void> {
  assertRequestTransition(req.status, to);
  await ctx.db.patch(req._id, { status: to, updatedAt: Date.now(), ...patch });
  await writeAudit(ctx, {
    orgId: req.orgId,
    entity: "request",
    entityId: req._id,
    action,
    actorUserId: org.user._id,
    from: req.status,
    to,
    note,
  });
}

/**
 * Validate then forward in one transaction: two status moves, two audit rows, and the same
 * "forwarded" notification forwardToPat sends. The caller has already checked access.
 */
async function validateAndForward(
  ctx: MutationCtx,
  org: OrgContext,
  req: Doc<"maintenanceRequests">,
  note: string | undefined,
): Promise<void> {
  await move(ctx, org, req, "under_review", "validated", note, {
    validatedAt: Date.now(),
    validatedBy: org.user._id,
  });
  const validated = await ctx.db.get(req._id);
  if (!validated) return;
  await move(ctx, org, validated, "forwarded_to_pat", "forwarded", note, { nextAction: note });

  const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
  await scheduleNotify(ctx, {
    orgId: req.orgId,
    userIds: await staffExcept(ctx, req.orgId, org.user._id),
    template: "request_forwarded",
    data: {
      number: req.number,
      unit: unit?.unitNumber,
      firstName: firstNameOf(req.callerName),
      severity: req.severity,
      path: `/maintenance/${req._id}`,
    },
  });
}

/** The number to text the tenant on: the one they asked to be reached on, else caller ID. */
function tenantPhone(req: Doc<"maintenanceRequests">): string | null {
  for (const raw of [req.callbackNumber, req.callerNumber]) {
    const e164 = raw ? toE164(raw) : null;
    if (e164) return e164;
  }
  return null;
}

/**
 * Texts the tenant the approved out-of-scope wording. Never sends unless that wording is
 * approved in the published Sarah config; the reason says why not, for the UI to relay.
 */
async function notifyTenantOutOfScope(
  ctx: MutationCtx,
  req: Doc<"maintenanceRequests">,
): Promise<{ notified: boolean; reason?: string }> {
  // Texting policy: tenants are not texted for now. The close itself already happened.
  if (!TENANT_TEXTS_ENABLED) return { notified: false, reason: TEXTING_OFF_REASON };
  const wording = await tenantMessage(ctx, req.orgId, "outOfScope");
  if (!wording) return { notified: false, reason: "Reason recorded. Tenant not notified (wording not approved)." };
  const phone = tenantPhone(req);
  if (!phone) return { notified: false, reason: "Reason recorded. Tenant not notified (no phone number on the request)." };
  await scheduleNotify(ctx, {
    orgId: req.orgId,
    phones: [phone],
    template: "tenant_message",
    data: { text: wording },
  });
  await writeAudit(ctx, {
    orgId: req.orgId,
    entity: "request",
    entityId: req._id,
    action: "tenant_notified",
    note: "Out-of-scope notice texted",
  });
  return { notified: true };
}

/**
 * One click for "Approve & send to Pat" (PRD 6.3): the asset manager validates AND forwards.
 * Same access as validate + forwardToPat (the unit's AM, or Pat powers), and only while the
 * request is still with the asset manager.
 */
export const approveAndForward = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (req.status !== "new" && req.status !== "under_review" && req.status !== "more_info_needed") {
      throw new ConvexError("This request isn't waiting on the asset manager.");
    }
    await validateAndForward(ctx, org, req, optText(args.note, 1000));
  },
});

/** Marks the request validated (stays under review); only a validated request can be forwarded. */
export const validate = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    await move(ctx, org, req, "under_review", "validated", optText(args.note, 1000), {
      validatedAt: Date.now(),
      validatedBy: org.user._id,
    });
  },
});

export const requestInfo = mutation({
  args: {
    requestId: v.id("maintenanceRequests"),
    note: v.string(),
    // Also text the tenant a link to upload photos/video (public /m/[token] page).
    sendPhotoLink: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ texted: boolean; reason?: string }> => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    const note = requireText(args.note, "What you need from the tenant", 1000);
    await move(ctx, org, req, "more_info_needed", "info_requested", note, { nextAction: note });
    if (!args.sendPhotoLink) return { texted: false };
    // Texting policy: no photo-link text to tenants for now; the note is still recorded above.
    if (!TENANT_TEXTS_ENABLED) return { texted: false, reason: TEXTING_OFF_REASON };

    // The text goes out only on Pat-approved wording and only to a number on the request.
    const wording = await tenantMessage(ctx, req.orgId, "photoRequest");
    if (!wording) return { texted: false, reason: "Photo request wording is not approved yet." };
    const phone = tenantPhone(req);
    if (!phone) return { texted: false, reason: "There is no phone number on this request." };

    const { token } = await createPublicLink(ctx, {
      orgId: req.orgId,
      purpose: "maintenance_media",
      targetId: req._id,
    });
    await ctx.db.patch(req._id, { mediaRequested: true });
    await scheduleNotify(ctx, {
      orgId: req.orgId,
      phones: [phone],
      template: "tenant_message",
      data: { text: wording, path: `/m/${token}` },
    });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "photo_link_sent",
      actorUserId: org.user._id,
    });
    return { texted: true };
  },
});

/** Rejection needs a reason (preset or "Other") AND a written explanation of at least 5 characters. */
function closeParts(rawReason: string, rawExplanation: string | undefined) {
  const reason = requireText(rawReason, "A reason", 500);
  const explanation = requireText(rawExplanation ?? "", "An explanation", 1000);
  if (explanation.length < 5) throw new ConvexError("Add a short explanation (at least 5 characters).");
  return { reason, explanation };
}

export const closeOutOfScope = mutation({
  args: {
    requestId: v.id("maintenanceRequests"),
    reason: v.string(),
    // Required (min 5 chars). Optional in the validator only so older callers still type-check;
    // closeParts() throws when it is missing.
    explanation: v.optional(v.string()),
    // Text the tenant the approved out-of-scope wording. Skipped (and reported) if it is unapproved.
    notifyTenant: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ notified: boolean; reason?: string }> => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    // Once forwarded, closing without a work order is Pat's call (closeNoWorkOrder).
    if (req.status === "forwarded_to_pat") throw new ConvexError("This request is with the maintenance lead.");
    const { reason, explanation } = closeParts(args.reason, args.explanation);
    await move(ctx, org, req, "closed_out_of_scope", "closed_out_of_scope", `${reason}: ${explanation}`, {
      closeReason: reason,
      closeExplanation: explanation,
    });
    return args.notifyTenant ? await notifyTenantOutOfScope(ctx, req) : { notified: false };
  },
});

export const forwardToPat = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!req.validatedAt) throw new ConvexError("Validate the request before forwarding it.");
    const note = optText(args.note, 1000);
    await move(ctx, org, req, "forwarded_to_pat", "forwarded", note, { nextAction: note });

    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    await scheduleNotify(ctx, {
      orgId: req.orgId,
      userIds: await staffExcept(ctx, req.orgId, org.user._id),
      template: "request_forwarded",
      data: {
        number: req.number,
        unit: unit?.unitNumber,
        firstName: firstNameOf(req.callerName),
        severity: req.severity,
        path: `/maintenance/${req._id}`,
      },
    });
  },
});

export const markDuplicate = mutation({
  args: { requestId: v.id("maintenanceRequests"), originalId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (args.originalId === req._id) throw new ConvexError("A request can't duplicate itself.");
    const original = await ctx.db.get(args.originalId);
    // Unreadable and nonexistent originals look the same.
    if (!original || !canRead(org, original, await scopeOf(ctx, org))) throw new ConvexError("Original request not found.");
    await move(ctx, org, req, "closed_duplicate", "marked_duplicate", `Duplicate of MR-${original.number}`, {
      closeReason: `Duplicate of MR-${original.number}`,
      possibleDuplicateOf: original._id,
    });
  },
});

export const notDuplicate = mutation({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!req.possibleDuplicateOf) return;
    await ctx.db.patch(req._id, { possibleDuplicateOf: undefined, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "not_duplicate",
      actorUserId: org.user._id,
    });
  },
});

/** Wrong unit matched: pick the right one and re-run routing (the AM may change). */
export const fixUnit = mutation({
  args: { requestId: v.id("maintenanceRequests"), unitId: v.id("units") },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!OPEN.includes(req.status)) throw new ConvexError("This request is closed.");
    // Non-Pat callers (asset managers) may only re-point to a unit they MANAGE.
    if (!canManageMaintenance(org)) {
      const target = await ctx.db.get(args.unitId);
      if (!target || target.orgId !== org.orgId || target.assetManagerUserId !== org.user._id) {
        throw new ConvexError("You don't have access to that.");
      }
    }
    await routeRequest(ctx, req._id, { actorUserId: org.user._id, unitId: args.unitId, notify: true });
  },
});

export const overrideSeverity = mutation({
  args: { requestId: v.id("maintenanceRequests"), severity: severityValidator, reason: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!OPEN.includes(req.status)) throw new ConvexError("This request is closed.");
    const reason = requireText(args.reason, "A reason", 500);
    if (args.severity === req.severity) return;

    await ctx.db.patch(req._id, {
      severity: args.severity,
      originalSeverity: req.originalSeverity ?? req.severity,
      severityReason: reason,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "severity_overridden",
      actorUserId: org.user._id,
      from: req.severity,
      to: args.severity,
      note: reason,
    });

    // Only a move up to emergency texts anyone (admins, once per request). Urgent does not text.
    if (args.severity === "emergency") await alertIfEmergency(ctx, req._id);
  },
});

/**
 * Edit the work-order draft Sarah wrote before it is approved: title, category, description,
 * severity score and the structured answers. Open requests only, and only by someone who can act
 * on it (the unit's AM or Pat powers). Answers can change value but never gain or lose a question.
 */
export const editDraft = mutation({
  args: {
    requestId: v.id("maintenanceRequests"),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    description: v.optional(v.string()),
    severityScore: v.optional(v.number()),
    pets: v.optional(v.string()),
    firstNoticed: v.optional(v.string()),
    preferredAccessTimes: v.optional(v.string()),
    answers: v.optional(v.array(v.object({ key: v.string(), value: v.string() }))),
  },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!OPEN.includes(req.status)) throw new ConvexError("This request is closed.");

    const patch: Partial<Doc<"maintenanceRequests">> = {};
    const changed: string[] = [];
    if (args.title !== undefined) {
      const title = requireText(args.title, "Title", 120);
      if (title !== req.title) {
        patch.title = title;
        changed.push("title");
      }
    }
    if (args.category !== undefined) {
      const category = args.category.trim();
      if (!Object.prototype.hasOwnProperty.call(ISSUE_LABELS, category)) throw new ConvexError("Pick a valid category.");
      if (category !== req.issueType) {
        patch.issueType = category;
        changed.push("category");
      }
    }
    if (args.description !== undefined) {
      const description = requireText(args.description, "Description", MAX_TEXT);
      if (description !== req.description) {
        patch.description = description;
        changed.push("description");
      }
    }
    if (args.severityScore !== undefined) {
      const score = clampSeverity(args.severityScore);
      if (score !== req.severityScore) {
        patch.severityScore = score;
        changed.push("severity score");
      }
    }
    const pets = args.pets === undefined ? undefined : optText(args.pets, 300);
    if (args.pets !== undefined && pets !== req.pets) {
      patch.pets = pets;
      changed.push("pets");
    }
    const firstNoticed = args.firstNoticed === undefined ? undefined : optText(args.firstNoticed, 200);
    if (args.firstNoticed !== undefined && firstNoticed !== req.firstNoticed) {
      patch.firstNoticed = firstNoticed;
      changed.push("first noticed");
    }
    const access = args.preferredAccessTimes === undefined ? undefined : optText(args.preferredAccessTimes, 300);
    if (args.preferredAccessTimes !== undefined && access !== req.preferredAccessTimes) {
      patch.preferredAccessTimes = access;
      changed.push("preferred access times");
    }
    if (args.answers !== undefined) {
      if (args.answers.length > 40) throw new ConvexError("Too many answers were sent (at most 40).");
      const edits = new Map(args.answers.map((a) => [a.key, a.value.trim().slice(0, 500)]));
      let touched = false;
      const next = req.answers.map((a) => {
        const value = edits.get(a.key);
        if (value === undefined || value === a.value) return a;
        touched = true;
        return { ...a, value };
      });
      if (touched) {
        patch.answers = next;
        changed.push("answers");
      }
    }
    if (changed.length === 0) return { changed: [] as string[] };

    await ctx.db.patch(req._id, { ...patch, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "draft_edited",
      actorUserId: org.user._id,
      note: `Edited ${changed.join(", ")}`,
    });
    return { changed };
  },
});

/** Pat hands a forwarded request back to its AM for more work. */
export const sendBackToAM = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const note = requireText(args.note, "A note for the asset manager", 1000);
    await move(ctx, org, req, "under_review", "sent_back_to_am", note, { nextAction: note });

    // Tell the unit's AM, and the covering AM if the owner is out. The note itself stays behind
    // the login (it is on the request timeline); the text only says it came back.
    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    await scheduleNotify(ctx, {
      orgId: req.orgId,
      userIds: await amRecipients(ctx, req, org.user._id),
      template: "request_sent_back",
      data: {
        number: req.number,
        unit: unit?.unitNumber,
        severity: req.severity,
        path: `/maintenance/${req._id}`,
      },
    });
  },
});

/**
 * The AM (or Pat) pulls a forwarded request back to under_review, e.g. a detail was missing.
 * Only someone who can act on the request; covering AMs cannot. The maintenance lead(s) are told.
 */
export const withdrawFromPat = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (req.status !== "forwarded_to_pat") throw new ConvexError("This request isn't with the maintenance lead.");
    const note = optText(args.note, 1000);
    await move(ctx, org, req, "under_review", "withdrawn_from_pat", note, { nextAction: note });

    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    await scheduleNotify(ctx, {
      orgId: req.orgId,
      userIds: await staffExcept(ctx, req.orgId, org.user._id),
      template: "request_withdrawn",
      data: {
        number: req.number,
        unit: unit?.unitNumber,
        firstName: firstNameOf(req.callerName),
        severity: req.severity,
        path: `/maintenance/${req._id}`,
      },
    });
  },
});

const MAX_NOTE = 2000;

/**
 * A free-text note on the request timeline (the audit rows the drawer already renders, action
 * "note_added"). Allowed for whoever can act (the unit's AM) and for Pat. A forwarded request
 * pings the other side: an AM's note tells Pat, Pat's note tells the AM (and covering AM).
 */
export const addNote = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.string() },
  handler: async (ctx, args) => addRequestNote(ctx, args.requestId, args.note),
});

/** Shared by maintenance.addNote and board.addComment (which caps the note at 1000). */
export async function addRequestNote(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
  rawNote: string,
  max = MAX_NOTE,
): Promise<void> {
  const args = { requestId, note: rawNote };
  {
    const org = await requireOrg(ctx);
    const req = await ctx.db.get(args.requestId);
    const scope = await scopeOf(ctx, org);
    if (!req || !canRead(org, req, scope)) throw new ConvexError("Request not found.");
    const isPat = canManageMaintenance(org);
    if (!isPat && !canAct(org, req, scope)) throw new ConvexError("You don't have access to that.");
    if (!OPEN.includes(req.status)) throw new ConvexError("This request is closed.");
    const note = requireText(args.note, "A note", max);

    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "note_added",
      actorUserId: org.user._id,
      note,
    });
    await ctx.db.patch(req._id, { updatedAt: Date.now() });

    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    const data = {
      number: req.number,
      unit: unit?.unitNumber,
      severity: req.severity,
      path: `/maintenance/${req._id}`,
    };
    if (isPat) {
      await scheduleNotify(ctx, {
        orgId: req.orgId,
        userIds: await amRecipients(ctx, req, org.user._id),
        template: "request_note",
        data,
      });
    } else if (req.status === "forwarded_to_pat") {
      await scheduleNotify(ctx, {
        orgId: req.orgId,
        userIds: await staffExcept(ctx, req.orgId, org.user._id),
        template: "request_note",
        data,
      });
    }
  }
}

/** Pat closes a request that needs no work order. */
export const closeNoWorkOrder = mutation({
  args: {
    requestId: v.id("maintenanceRequests"),
    reason: v.string(),
    explanation: v.optional(v.string()), // required (min 5 chars); see closeOutOfScope
    notifyTenant: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ notified: boolean; reason?: string }> => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const { reason, explanation } = closeParts(args.reason, args.explanation);
    await move(ctx, org, req, "closed_out_of_scope", "closed_no_work_order", `${reason}: ${explanation}`, {
      closeReason: reason,
      closeExplanation: explanation,
    });
    return args.notifyTenant ? await notifyTenantOutOfScope(ctx, req) : { notified: false };
  },
});

/**
 * Admin (Pat powers) reopens a closed item and sends it back to the asset manager: a rejected
 * request (closed_out_of_scope / closed_duplicate), or the request behind a closed work order
 * (work_order_created whose work orders are all closed or cancelled). It lands in under_review
 * with validation cleared, so the asset manager must validate and forward again. Audited; the
 * AM is told in-app (texting is off except emergencies).
 */
export const reopen = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const note = requireText(args.note, "A note for the asset manager", 1000);
    if (req.status === "work_order_created") {
      const wos = await ctx.db
        .query("workOrders")
        .withIndex("by_request", (q) => q.eq("requestId", req._id))
        .collect();
      if (wos.some((w) => w.status !== "reviewed_closed" && w.status !== "cancelled")) {
        throw new ConvexError("This request still has an open work order.");
      }
    } else if (req.status !== "closed_out_of_scope" && req.status !== "closed_duplicate") {
      throw new ConvexError("Only a closed request can be reopened.");
    }
    await ctx.db.patch(req._id, {
      status: "under_review",
      validatedAt: undefined,
      validatedBy: undefined,
      nextAction: note,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "reopened",
      actorUserId: org.user._id,
      from: req.status,
      to: "under_review",
      note,
    });
    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    await scheduleNotify(ctx, {
      orgId: req.orgId,
      userIds: await amRecipients(ctx, req, org.user._id),
      template: "request_sent_back",
      data: { number: req.number, unit: unit?.unitNumber, severity: req.severity, path: `/maintenance/${req._id}` },
    });
  },
});

/** Exception queue: pick the real unit; routing re-runs and the request lands in the right inbox. */
export const resolveException = mutation({
  args: { requestId: v.id("maintenanceRequests"), unitId: v.id("units") },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    if (!req.inExceptionQueue || !OPEN.includes(req.status)) {
      throw new ConvexError("This request isn't in the exception queue.");
    }
    await routeRequest(ctx, req._id, { actorUserId: org.user._id, unitId: args.unitId, notify: true });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "exception_resolved",
      actorUserId: org.user._id,
    });
  },
});

/**
 * Approves a named person to handle ONE request while its asset manager is unavailable.
 * Never automatic (PRD section 5): a human decides, and the audit note says why.
 */
export const approveFallback = mutation({
  args: { requestId: v.id("maintenanceRequests"), userId: v.id("users"), note: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const note = requireText(args.note, "A note", 500);
    if (!req.inExceptionQueue || req.routeReason !== "AM unavailable" || !OPEN.includes(req.status)) {
      throw new ConvexError("This request isn't waiting on an unavailable asset manager.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const roles = membership?.jobRoles ?? [];
    if (
      !membership ||
      membership.orgId !== org.orgId ||
      !(roles.includes("asset_manager") || roles.includes("maintenance_lead"))
    ) {
      throw new ConvexError("Pick an asset manager or maintenance lead on this team.");
    }
    await ctx.db.patch(req._id, {
      assignedAssetManagerUserId: args.userId,
      inExceptionQueue: false,
      routeReason: "fallback approved",
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "fallback_approved",
      actorUserId: org.user._id,
      from: req.assignedAssetManagerUserId,
      to: args.userId,
      note,
    });
  },
});

/** Unread indicator: only the assigned AM opening it counts as "viewed". */
export const markViewed = mutation({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const req = await ctx.db.get(args.requestId);
    if (!req || !canRead(org, req, await scopeOf(ctx, org))) return;
    if (req.assignedAssetManagerUserId === org.user._id && req.firstViewedAt === undefined) {
      await ctx.db.patch(req._id, { firstViewedAt: Date.now() });
    }
  },
});

// --- Called by workOrders.create -------------------------------------------------

/** Moves a request to work_order_created. Role checks are the caller's; this is the transition. */
export async function markWorkOrderCreated(
  ctx: MutationCtx,
  org: OrgContext,
  req: Doc<"maintenanceRequests">,
  workOrderNumber: number,
): Promise<void> {
  await move(ctx, org, req, "work_order_created", "wo_created", `WO-${workOrderNumber}`);
}

// --- Staff media ------------------------------------------------------------------

const FRESH_UPLOAD_MS = 60 * 60 * 1000;

/**
 * Guard for every "attach an uploaded file" path. Returns an error string when the storage id is
 * already claimed by any table (media, work-order files, task attachments) or was not uploaded in
 * the last hour, else null. Callers must NOT delete the file when this returns an error: it may
 * belong to someone else. (Convex has no per-uploader record, so freshness + unclaimed is the
 * strongest check available without a schema change.)
 */
export async function checkStorageUsable(
  ctx: QueryCtx,
  orgId: string,
  storageId: Id<"_storage">,
): Promise<string | null> {
  const claimed =
    (await ctx.db.query("maintenanceMedia").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first()) ||
    (await ctx.db.query("workOrderFiles").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first()) ||
    (await ctx.db.query("taskAttachments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find(
      (a) => a.storageId === storageId,
    );
  if (claimed) return "That file is already attached.";
  const sys = await ctx.db.system.get(storageId);
  if (!sys) return "That upload wasn't found.";
  if (Date.now() - sys._creationTime > FRESH_UPLOAD_MS) return "That upload has expired. Upload it again.";
  return null;
}

/** Short-lived URL a staff member POSTs a photo/video to. Same permission as acting on the request. */
export const generateMediaUploadUrl = mutation({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    await attachableRequest(ctx, args.requestId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Records an uploaded file against a request after checking what actually landed in storage
 * (the client chose the content type and size; storage metadata is the truth). A rejected
 * upload is deleted and reported in the result instead of thrown, because a thrown error would
 * roll the delete back and leave the file orphaned.
 */
export const attachMedia = mutation({
  args: { requestId: v.id("maintenanceRequests"), storageId: v.id("_storage") },
  handler: async (ctx, args) => attachRequestMedia(ctx, args.requestId, args.storageId),
});

/** Shared by maintenance.attachMedia and board.attachMedia. */
export async function attachRequestMedia(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
  storageIdArg: Id<"_storage">,
): Promise<{ ok: true; mediaId: Id<"maintenanceMedia"> } | { ok: false; error: string }> {
  const args = { requestId, storageId: storageIdArg };
  {
    const { org, req } = await attachableRequest(ctx, args.requestId);
    // Claimed or not freshly uploaded: refuse WITHOUT deleting (it may be someone else's file).
    const usable = await checkStorageUsable(ctx, req.orgId, args.storageId);
    if (usable) return { ok: false, error: usable };
    const reject = async (error: string) => {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, error };
    };

    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) return { ok: false, error: "That upload wasn't found." };
    const type = meta.contentType ?? "";
    const isImage = type.startsWith("image/") && type !== "image/svg+xml"; // SVG can carry script
    const isVideo = type.startsWith("video/");
    if (!isImage && !isVideo) return await reject("Only photos and videos can be attached.");
    if (meta.size > (isImage ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES)) {
      return await reject(isImage ? "Photos can be at most 10 MB." : "Videos can be at most 50 MB.");
    }
    const already = await ctx.db
      .query("maintenanceMedia")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (already) return { ok: false, error: "That file is already attached." };
    const count = (
      await ctx.db
        .query("maintenanceMedia")
        .withIndex("by_request", (q) => q.eq("requestId", req._id))
        .take(MAX_MEDIA_PER_REQUEST)
    ).length;
    if (count >= MAX_MEDIA_PER_REQUEST) return await reject("This request has the maximum number of files.");

    const mediaId = await ctx.db.insert("maintenanceMedia", {
      orgId: req.orgId,
      requestId: req._id,
      storageId: args.storageId,
      kind: isImage ? "photo" : "video",
      uploadedBy: "staff",
      uploadedByUserId: org.user._id,
      createdAt: Date.now(),
    });
    if (req.photosPending) await ctx.db.patch(req._id, { photosPending: false });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "media_added",
      actorUserId: org.user._id,
      to: isImage ? "photo" : "video",
    });
    return { ok: true, mediaId };
  }
}

// --- Tenant photo upload (public, token-gated) --------------------------------------
//
// The no-login page a tenant reaches from the text message. No auth: the link token IS the
// credential, scoped to one request. Nothing about the request beyond the unit label is
// returned, and every failure reads the same ("expired") so a guessed token learns nothing.

/** Is this link still good, and which unit is it for? Read-only; spends nothing. */
export const publicLinkInfo = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ valid: false } | { valid: true; unitLabel: string | null; remaining: number }> => {
    const link = await peekPublicLink(ctx, args.token, "maintenance_media");
    if (!link) return { valid: false };
    const id = ctx.db.normalizeId("maintenanceRequests", link.targetId);
    const req = id ? await ctx.db.get(id) : null;
    if (!req || req.orgId !== link.orgId || !OPEN.includes(req.status)) return { valid: false };
    const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
    return { valid: true, unitLabel: unit?.unitNumber ?? null, remaining: link.maxUses - link.useCount };
  },
});

/** Like peekPublicLink but tolerates a link whose last use was spent minting this very upload. */
async function peekPublicLinkAllowSpent(ctx: QueryCtx, token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const tokenHash = await sha256(trimmed);
  const link = await ctx.db
    .query("publicLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!link || link.purpose !== "maintenance_media" || link.expiresAt <= Date.now()) return null;
  return link;
}

/** Short-lived storage URL for one tenant upload. Does not spend a link use; publicAttach does. */
export const publicUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; url: string } | { ok: false }> => {
    const link = await peekPublicLink(ctx, args.token, "maintenance_media");
    if (!link) return { ok: false };
    const id = ctx.db.normalizeId("maintenanceRequests", link.targetId);
    const req = id ? await ctx.db.get(id) : null;
    if (!req || req.orgId !== link.orgId || !OPEN.includes(req.status)) return { ok: false };
    // Minting spends one link use (publicAttach no longer spends a second), so a link can mint at
    // most `maxUses` upload URLs: no unbounded storage-slot minting from a leaked token.
    const useCount = link.useCount + 1;
    await ctx.db.patch(link._id, { useCount, usedAt: useCount >= link.maxUses ? Date.now() : link.usedAt });
    return { ok: true, url: await ctx.storage.generateUploadUrl() };
  },
});

/**
 * Records a tenant upload against the link's request, with the same content-type and size checks
 * as attachMedia. Spends one link use. A bad token never deletes anything (the storage id is
 * client-supplied, so it must not be a way to delete other people's files); a good token with a
 * rejected file deletes only a file nothing else has claimed.
 */
export const publicAttach = mutation({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    // The use was already spent when the upload URL was minted (publicUploadUrl), and an
    // exhausted link is still allowed to finish attaching the file it just uploaded.
    const link = await peekPublicLinkAllowSpent(ctx, args.token);
    if (!link) return { ok: false, error: "This link has expired." };
    const id = ctx.db.normalizeId("maintenanceRequests", link.targetId);
    const req = id ? await ctx.db.get(id) : null;
    if (!req || req.orgId !== link.orgId || !OPEN.includes(req.status)) {
      return { ok: false, error: "This link has expired." };
    }

    const unusable = await checkStorageUsable(ctx, req.orgId, args.storageId);
    if (unusable) return { ok: false, error: unusable };

    const reject = async (error: string) => {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, error };
    };
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) return { ok: false, error: "That upload wasn't found." };
    const type = meta.contentType ?? "";
    const isImage = type.startsWith("image/") && type !== "image/svg+xml"; // SVG can carry script
    const isVideo = type.startsWith("video/");
    if (!isImage && !isVideo) return await reject("Only photos and videos can be sent.");
    if (meta.size > (isImage ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES)) {
      return await reject(isImage ? "Photos can be at most 10 MB." : "Videos can be at most 50 MB.");
    }
    const existing = await ctx.db
      .query("maintenanceMedia")
      .withIndex("by_request", (q) => q.eq("requestId", req._id))
      .take(MAX_MEDIA_PER_REQUEST);
    if (existing.length >= MAX_MEDIA_PER_REQUEST) return await reject("This request has the maximum number of files.");

    const now = Date.now();
    await ctx.db.insert("maintenanceMedia", {
      orgId: req.orgId,
      requestId: req._id,
      storageId: args.storageId,
      kind: isImage ? "photo" : "video",
      uploadedBy: "tenant",
      createdAt: now,
    });
    if (req.photosPending) await ctx.db.patch(req._id, { photosPending: false });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "media_added",
      to: isImage ? "photo" : "video",
      note: "Uploaded by the tenant",
    });

    // One text per burst of uploads, not one per photo.
    const recentTenantUpload = existing.some((m) => m.uploadedBy === "tenant" && m.createdAt > now - 15 * 60 * 1000);
    if (!recentTenantUpload) {
      const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
      await scheduleNotify(ctx, {
        orgId: req.orgId,
        userIds: req.assignedAssetManagerUserId ? [req.assignedAssetManagerUserId] : await staffExcept(ctx, req.orgId),
        template: "request_media",
        data: {
          number: req.number,
          unit: unit?.unitNumber,
          firstName: firstNameOf(req.callerName),
          path: `/maintenance/${req._id}`,
        },
      });
    }
    return { ok: true };
  },
});

// --- Dashboard ----------------------------------------------------------------------

/**
 * The maintenance block of dashboard.overview, scoped by view: admin sees the team, an AM their
 * own requests and the work orders on their units, a technician their own jobs, an accountant
 * only completed work. Everyone else gets zeros.
 */
export async function maintenanceOverview(ctx: QueryCtx, org: OrgContext) {
  const view = viewFor(org.isAdmin, org.jobRoles);
  const now = Date.now();
  const weekAgo = now - 7 * DAY_MS;

  const empty = {
    openRequests: 0,
    emergencies24h: 0,
    woInProgress: 0,
    completedThisWeek: 0,
    awaitingReview: 0,
    exceptions: 0,
    stuckNew: 0,
    overdue: 0,
    recent: [] as Awaited<ReturnType<typeof enrich>>,
  };

  // Requests
  const scope = await scopeOf(ctx, org);
  let open: Doc<"maintenanceRequests">[] = [];
  if (view === "admin" || view === "asset_manager") {
    for (const s of OPEN) open.push(...(await scopedByStatus(ctx, org, s, 500, scope)));
  }
  open = open.sort((a, b) => b.createdAt - a.createdAt);

  // Work orders in scope
  let wos: Doc<"workOrders">[] = [];
  const woStatuses: Array<Doc<"workOrders">["status"]> = [
    "created",
    "assigned",
    "in_progress",
    "completed",
    "reviewed_closed",
  ];
  if (view === "admin") {
    for (const s of woStatuses) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
          .order("desc")
          .take(500)),
      );
    }
  } else if (view === "asset_manager") {
    for (const unitId of [...scope.managed, ...scope.covering]) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_unit", (q) => q.eq("unitId", unitId))
          .take(100)),
      );
    }
  } else if (view === "technician") {
    for (const s of woStatuses) {
      wos.push(
        ...(
          await ctx.db
            .query("workOrders")
            .withIndex("by_technician_and_status", (q) => q.eq("technicianUserId", org.user._id).eq("status", s))
            .take(200)
        ).map(forTechnician), // never bill / cost / billed keys for a technician
      );
    }
  } else if (view === "accountant") {
    for (const s of ["completed", "reviewed_closed"] as const) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
          .order("desc")
          .take(500)),
      );
    }
  }
  wos = wos.filter((w) => w.orgId === org.orgId);

  if (view === "none") return empty;

  const activeWo = (w: Doc<"workOrders">) => ["created", "assigned", "in_progress"].includes(w.status);
  return {
    openRequests: open.length,
    emergencies24h: open.filter((r) => r.severity === "emergency" && r.createdAt >= now - DAY_MS).length,
    woInProgress: wos.filter((w) => w.status === "in_progress").length,
    completedThisWeek: wos.filter(
      (w) => (w.status === "completed" || w.status === "reviewed_closed") && (w.completedAt ?? 0) >= weekAgo,
    ).length,
    awaitingReview: wos.filter((w) => w.status === "completed").length,
    exceptions: view === "admin" ? open.filter((r) => r.inExceptionQueue).length : 0,
    stuckNew: open.filter((r) => r.status === "new" && r.createdAt < now - STUCK_NEW_MS).length,
    overdue: wos.filter((w) => activeWo(w) && w.dueDate !== undefined && w.dueDate < now).length,
    recent: await enrich(ctx, open.slice(0, 5)),
  };
}
