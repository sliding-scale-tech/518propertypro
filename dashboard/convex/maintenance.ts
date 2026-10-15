import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { canManageMaintenance, currentOrg, requireAdminView, requireOrg, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import { nextNumber } from "./counters";
import { scheduleNotify, staffRecipientIds } from "./notify";
import { findResidentsByPhone } from "./residents";
import { normalizeUnitKey } from "./units";

/**
 * Maintenance requests (F4): the intake record Sarah (or a person) creates. Separate from a
 * work order on purpose: nothing becomes a work order until a human decides it should.
 *
 * Scope rules, all enforced here and never from client-supplied ids:
 *   - admin view (team admin, executive, maintenance lead, simplr_admin) reads everything;
 *   - an asset manager reads and acts only on requests ASSIGNED to them (routing assigns by the
 *     unit's AM, so this is "their units");
 *   - Pat powers (canManageMaintenance) act on everything; an executive alone is read-only.
 * A request outside the caller's scope reads as null / "not found", never "forbidden", so a
 * probing client can't tell it exists.
 */

type Status = Doc<"maintenanceRequests">["status"];
type Severity = Doc<"maintenanceRequests">["severity"];

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
    throw new Error(`A request that is "${from.replace(/_/g, " ")}" can't be moved to "${to.replace(/_/g, " ")}".`);
  }
}

// --- Access helpers ---------------------------------------------------------

function isAssetManager(org: OrgContext): boolean {
  return org.jobRoles.includes("asset_manager");
}

/** Read scope: admin view sees the team's requests, an AM those assigned to them. */
function canRead(org: OrgContext, req: Doc<"maintenanceRequests">): boolean {
  if (req.orgId !== org.orgId) return false;
  if (viewFor(org.isAdmin, org.jobRoles) === "admin") return true;
  return isAssetManager(org) && req.assignedAssetManagerUserId === org.user._id;
}

/** Act scope: Pat powers on everything, an AM on requests assigned to them. */
function canAct(org: OrgContext, req: Doc<"maintenanceRequests">): boolean {
  if (req.orgId !== org.orgId) return false;
  if (canManageMaintenance(org)) return true;
  return isAssetManager(org) && req.assignedAssetManagerUserId === org.user._id;
}

async function actableRequest(
  ctx: MutationCtx,
  requestId: Id<"maintenanceRequests">,
): Promise<{ org: OrgContext; req: Doc<"maintenanceRequests"> }> {
  const org = await requireOrg(ctx);
  const req = await ctx.db.get(requestId);
  if (!req || !canRead(org, req)) throw new Error("Request not found.");
  if (!canAct(org, req)) throw new Error("You don't have access to that.");
  return { org, req };
}

async function patOnlyRequest(ctx: MutationCtx, requestId: Id<"maintenanceRequests">) {
  const org = await requireOrg(ctx);
  const req = await ctx.db.get(requestId);
  if (!req || !canRead(org, req)) throw new Error("Request not found.");
  if (!canManageMaintenance(org)) throw new Error("You don't have access to that.");
  return { org, req };
}

function requireText(raw: string, label: string, max = 1000): string {
  const out = raw.trim();
  if (!out) throw new Error(`${label} is required.`);
  if (out.length > max) throw new Error(`${label} is too long.`);
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

// --- Routing (single source of truth) ----------------------------------------

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
    if (!chosen || chosen.orgId !== req.orgId) throw new Error("Unit not found.");
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
    if (propertyId && spokenKey) {
      const pid = propertyId;
      const found = await ctx.db
        .query("units")
        .withIndex("by_property_and_unit_key", (q) => q.eq("propertyId", pid).eq("unitNumberKey", spokenKey))
        .first();
      if (found && found.orgId === req.orgId) {
        unit = found;
        confidence = "exact";
      }
    }
    if (!unit && req.callerNumber) {
      const matches = await findResidentsByPhone(ctx, req.orgId, req.callerNumber);
      const unitIds = [...new Set(matches.map((m) => m.unitId))];
      if (unitIds.length === 1) {
        const candidate = await ctx.db.get(unitIds[0]);
        const contradicted =
          !candidate ||
          candidate.orgId !== req.orgId ||
          (spokenKey !== "" && spokenKey !== candidate.unitNumberKey) ||
          (req.propertyId !== undefined && req.propertyId !== candidate.propertyId);
        if (candidate && !contradicted) {
          unit = candidate;
          confidence = "caller_id";
        }
      }
    }
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
  if (req.severity === "emergency" || req.severity === "urgent") {
    const ids = [...new Set([...(assigned && assigned !== actor ? [assigned] : []), ...staff])];
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: ids, template: "request_emergency", data });
  } else if (routeReason === "AM unavailable") {
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: staff, template: "am_unavailable", data });
  } else if (inException) {
    await scheduleNotify(ctx, { orgId: req.orgId, userIds: staff, template: "request_exception", data });
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
  },
  handler: async (ctx, args): Promise<Id<"maintenanceRequests">> => {
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

    const fields = {
      conversationId,
      callerName: optText(args.callerName, 120),
      callerNumber: optText(args.callerNumber, 40),
      callbackNumber: optText(args.callbackNumber, 40),
      spokenAddress: optText(args.spokenAddress, 300),
      spokenUnit: optText(args.spokenUnit, 60),
      propertyId,
      issueType: requireText(args.issueType, "Issue type", 40),
      description: requireText(args.description, "Description", MAX_TEXT),
      firstNoticed: optText(args.firstNoticed, 200),
      answers: cleanAnswers(args.answers ?? []),
      pets: optText(args.pets, 300),
      preferredAccessTimes: optText(args.preferredAccessTimes, 300),
      severity: args.severity,
      severityScore: args.severityScore,
      severityReason: optText(args.severityReason, 500),
      mediaRequested: args.mediaRequested ?? false,
    };

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
        await ctx.db.patch(existing._id, {
          ...fields,
          severity: keepSeverity ? existing.severity : fields.severity,
          propertyId: fields.propertyId ?? existing.propertyId,
          updatedAt: Date.now(),
        });
        // Re-route only while nobody has touched it; after that a human owns the routing.
        if (existing.status === "new") {
          await routeRequest(ctx, existing._id, { notify: false });
        }
        return existing._id;
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("maintenanceRequests", {
      orgId: args.orgId,
      number: await nextNumber(ctx, args.orgId, "maintenanceRequest"),
      source: "phone",
      elevenLabsConversationId: elId,
      ...fields,
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
    await routeRequest(ctx, id, { notify: true });
    return id;
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
  },
  handler: async (ctx, args): Promise<Id<"maintenanceRequests">> => {
    const org = await requireOrg(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new Error("Unit not found.");

    const adminView = viewFor(org.isAdmin, org.jobRoles) === "admin";
    const ownAm = isAssetManager(org) && unit.assetManagerUserId === org.user._id;
    if (!adminView && !ownAm) throw new Error("You don't have access to that.");

    let residentId: Id<"residents"> | undefined;
    if (args.residentId) {
      const resident = await ctx.db.get(args.residentId);
      if (!resident || resident.orgId !== org.orgId || resident.unitId !== unit._id) {
        throw new Error("That resident doesn't live in this unit.");
      }
      residentId = resident._id;
    }

    const now = Date.now();
    const id = await ctx.db.insert("maintenanceRequests", {
      orgId: org.orgId,
      number: await nextNumber(ctx, org.orgId, "maintenanceRequest"),
      source: "manual",
      callerName: optText(args.callerName, 120),
      callbackNumber: optText(args.callbackNumber, 40),
      residentId,
      propertyId: unit.propertyId,
      unitId: unit._id,
      matchConfidence: "exact",
      issueType: requireText(args.issueType, "Issue type", 40),
      description: requireText(args.description, "Description", MAX_TEXT),
      firstNoticed: optText(args.firstNoticed, 200),
      answers: [],
      pets: optText(args.pets, 300),
      preferredAccessTimes: optText(args.preferredAccessTimes, 300),
      severity: args.severity,
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
    await routeRequest(ctx, id, { actorUserId: org.user._id, unitId: unit._id, notify: true });
    return id;
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
async function scopedByStatus(
  ctx: QueryCtx,
  org: OrgContext,
  status: Status,
  limit: number,
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
    const rows = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_assigned_am_and_status", (q) =>
        q.eq("assignedAssetManagerUserId", org.user._id).eq("status", status),
      )
      .order("desc")
      .take(limit);
    return rows.filter((r) => r.orgId === org.orgId);
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

    let rows: Doc<"maintenanceRequests">[] = [];
    for (const status of TAB_STATUSES[args.tab]) {
      rows.push(...(await scopedByStatus(ctx, org, status, LIST_CAP)));
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

export const get = query({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const req = await ctx.db.get(args.requestId);
    if (!req || !canRead(org, req)) return null;

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

    return {
      request: req,
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
        duplicateOf && duplicateOf.orgId === org.orgId && canRead(org, duplicateOf)
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
          kind: m.kind,
          uploadedBy: m.uploadedBy,
          createdAt: m.createdAt,
          url: await ctx.storage.getUrl(m.storageId),
        })),
      ),
      workOrder: workOrder
        ? { _id: workOrder._id, number: workOrder.number, status: workOrder.status }
        : null,
      audit: auditRows.filter((a) => a.orgId === org.orgId),
      // What the UI may offer this viewer. The server re-checks every action regardless.
      canAct: canAct(org, req),
      canManage: canManageMaintenance(org),
    };
  },
});

/** Requests that couldn't be routed safely, plus assigned-but-AM-unavailable ones. Admin view. */
export const exceptions = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const rows = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_exception", (q) => q.eq("orgId", org.orgId).eq("inExceptionQueue", true))
      .order("desc")
      .take(LIST_CAP);
    const open = rows
      .filter((r) => OPEN.includes(r.status))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt);
    return await enrich(ctx, open);
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
    const newRows = [
      ...(await scopedByStatus(ctx, org, "new", cap)),
      ...(await scopedByStatus(ctx, org, "under_review", cap)),
    ];
    const waiting = await scopedByStatus(ctx, org, "more_info_needed", cap);
    const forwarded = await scopedByStatus(ctx, org, "forwarded_to_pat", cap);
    const weekAgo = Date.now() - 7 * DAY_MS;
    let closed7d = 0;
    for (const s of CLOSED) {
      closed7d += (await scopedByStatus(ctx, org, s, cap)).filter((r) => r.updatedAt >= weekAgo).length;
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
  args: { requestId: v.id("maintenanceRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    const note = requireText(args.note, "What you need from the tenant", 1000);
    await move(ctx, org, req, "more_info_needed", "info_requested", note, { nextAction: note });
  },
});

export const closeOutOfScope = mutation({
  args: { requestId: v.id("maintenanceRequests"), reason: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    // Once forwarded, closing without a work order is Pat's call (closeNoWorkOrder).
    if (req.status === "forwarded_to_pat") throw new Error("This request is with the maintenance lead.");
    const reason = requireText(args.reason, "A reason", 500);
    await move(ctx, org, req, "closed_out_of_scope", "closed_out_of_scope", reason, { closeReason: reason });
  },
});

export const forwardToPat = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!req.validatedAt) throw new Error("Validate the request before forwarding it.");
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
    if (args.originalId === req._id) throw new Error("A request can't duplicate itself.");
    const original = await ctx.db.get(args.originalId);
    // Unreadable and nonexistent originals look the same.
    if (!original || !canRead(org, original)) throw new Error("Original request not found.");
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
    if (!OPEN.includes(req.status)) throw new Error("This request is closed.");
    await routeRequest(ctx, req._id, { actorUserId: org.user._id, unitId: args.unitId, notify: true });
  },
});

export const overrideSeverity = mutation({
  args: { requestId: v.id("maintenanceRequests"), severity: severityValidator, reason: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await actableRequest(ctx, args.requestId);
    if (!OPEN.includes(req.status)) throw new Error("This request is closed.");
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

    const escalated =
      (args.severity === "emergency" || args.severity === "urgent") &&
      SEVERITY_RANK[args.severity] < SEVERITY_RANK[req.severity];
    if (escalated) {
      const unit = req.unitId ? await ctx.db.get(req.unitId) : null;
      const ids = new Set(await staffExcept(ctx, req.orgId, org.user._id));
      if (req.assignedAssetManagerUserId && req.assignedAssetManagerUserId !== org.user._id) {
        ids.add(req.assignedAssetManagerUserId);
      }
      await scheduleNotify(ctx, {
        orgId: req.orgId,
        userIds: [...ids],
        template: "request_emergency",
        data: {
          number: req.number,
          unit: unit?.unitNumber,
          firstName: firstNameOf(req.callerName),
          severity: args.severity,
          path: `/maintenance/${req._id}`,
        },
      });
    }
  },
});

/** Pat hands a forwarded request back to its AM for more work. */
export const sendBackToAM = mutation({
  args: { requestId: v.id("maintenanceRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const note = requireText(args.note, "A note for the asset manager", 1000);
    await move(ctx, org, req, "under_review", "sent_back_to_am", note, { nextAction: note });
  },
});

/** Pat closes a request that needs no work order. */
export const closeNoWorkOrder = mutation({
  args: { requestId: v.id("maintenanceRequests"), reason: v.string() },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    const reason = requireText(args.reason, "A reason", 500);
    await move(ctx, org, req, "closed_out_of_scope", "closed_no_work_order", reason, { closeReason: reason });
  },
});

/** Exception queue: pick the real unit; routing re-runs and the request lands in the right inbox. */
export const resolveException = mutation({
  args: { requestId: v.id("maintenanceRequests"), unitId: v.id("units") },
  handler: async (ctx, args) => {
    const { org, req } = await patOnlyRequest(ctx, args.requestId);
    if (!req.inExceptionQueue || !OPEN.includes(req.status)) {
      throw new Error("This request isn't in the exception queue.");
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
      throw new Error("This request isn't waiting on an unavailable asset manager.");
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
      throw new Error("Pick an asset manager or maintenance lead on this team.");
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
    if (!req || !canRead(org, req)) return;
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

/** Short-lived URL a staff member POSTs a photo/video to. Same permission as acting on the request. */
export const generateMediaUploadUrl = mutation({
  args: { requestId: v.id("maintenanceRequests") },
  handler: async (ctx, args) => {
    await actableRequest(ctx, args.requestId);
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
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; mediaId: Id<"maintenanceMedia"> } | { ok: false; error: string }> => {
    const { org, req } = await actableRequest(ctx, args.requestId);
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
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: req.orgId,
      entity: "request",
      entityId: req._id,
      action: "media_added",
      actorUserId: org.user._id,
      to: isImage ? "photo" : "video",
    });
    return { ok: true, mediaId };
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
  let open: Doc<"maintenanceRequests">[] = [];
  if (view === "admin" || view === "asset_manager") {
    for (const s of OPEN) open.push(...(await scopedByStatus(ctx, org, s, 500)));
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
    const mine = await ctx.db
      .query("units")
      .withIndex("by_asset_manager", (q) => q.eq("assetManagerUserId", org.user._id))
      .collect();
    for (const unit of mine) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
          .take(100)),
      );
    }
  } else if (view === "technician") {
    for (const s of woStatuses) {
      wos.push(
        ...(await ctx.db
          .query("workOrders")
          .withIndex("by_technician_and_status", (q) => q.eq("technicianUserId", org.user._id).eq("status", s))
          .take(200)),
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
