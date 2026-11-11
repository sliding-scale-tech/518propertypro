import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, viewFor } from "./authz";
import { scheduleEmergencyAlert, scheduleNotify, staffRecipientIds } from "./notify";
import { ensureLeadConversation } from "./conversations";
import { upsertArgs, upsertQualification } from "./qualifications";
import { weekBounds } from "./tourSchedule";
import { STAFF_MESSAGE_PREFIX } from "./ownerRoutingLib";

/**
 * Sarah's routing of people to people (lead -> asset manager, unmatched caller -> asset manager,
 * resident question -> request for the unit's asset manager).
 *
 * Everything callable from Sarah's tools is internal: the org comes from the call's own
 * conversation / agent id (http.ts) and is trusted from there on, never from what the caller said.
 *
 * LEAD ASSIGNMENT RULE (one definition, here):
 *   eligible   = membership.leadAssignee && asset_manager job role && not out of office
 *                && taking tours (tourAvailability.availableForTours, default true)
 *                && a connected, still-valid Google calendar.
 *   chosen     = fewest booked tours this week (Mon-Sun, team time zone), then least recently
 *                assigned a lead (memberships.lastLeadAssignedAt), then earliest to join.
 *   fallback   = if nobody is eligible, the same ordering over lead assignees who are merely not
 *                out of office (so a lead is not orphaned by a calendar problem). Nobody at all:
 *                the lead stays unassigned and only staff are texted.
 * Booking a tour re-assigns the lead to whoever the tour is booked with (assignOnTour).
 */

type Member = {
  userId: Id<"users">;
  firstName: string;
  joinedAt: number;
  lastAssignedAt: number;
};

function isAssetManager(m: Doc<"memberships">): boolean {
  return (m.jobRoles ?? []).includes("asset_manager");
}

function isOutOfOffice(m: Doc<"memberships">, now: number): boolean {
  return m.unavailableUntil !== undefined && m.unavailableUntil > now;
}

async function firstNameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const u = await ctx.db.get(userId);
  return u?.firstName || u?.email?.split("@")[0] || "a team member";
}

async function orgMembers(ctx: QueryCtx, orgId: string): Promise<Doc<"memberships">[]> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
}

/** Booked tours per person in the current team-local week. */
async function toursThisWeek(ctx: QueryCtx, orgId: string, userIds: Id<"users">[]): Promise<Map<Id<"users">, number>> {
  const organization = await ctx.db.get(orgId as Id<"organizations">);
  const week = weekBounds(Date.now(), organization?.timeZone ?? "UTC");
  const out = new Map<Id<"users">, number>();
  for (const userId of userIds) {
    const rows = await ctx.db
      .query("tours")
      .withIndex("by_assignee_and_start", (q) =>
        q.eq("assignedUserId", userId).gte("start", week.start).lt("start", week.end),
      )
      .collect();
    out.set(userId, rows.filter((t) => t.status === "booked" && t.orgId === orgId).length);
  }
  return out;
}

async function calendarOk(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const connection = await ctx.db
    .query("googleCalendarConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return Boolean(connection && !connection.invalidAt);
}

async function takingTours(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const hours = await ctx.db
    .query("tourAvailability")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return hours?.availableForTours ?? true;
}

/** Lead assignees who are asset managers and in the office; `strict` also needs tours + calendar. */
async function leadCandidates(ctx: QueryCtx, orgId: string, strict: boolean): Promise<Member[]> {
  const now = Date.now();
  const out: Member[] = [];
  for (const m of await orgMembers(ctx, orgId)) {
    if (!m.leadAssignee || !isAssetManager(m) || isOutOfOffice(m, now)) continue;
    if (strict && (!(await takingTours(ctx, m.userId)) || !(await calendarOk(ctx, m.userId)))) continue;
    out.push({
      userId: m.userId,
      firstName: await firstNameOf(ctx, m.userId),
      joinedAt: m.createdAt,
      lastAssignedAt: m.lastLeadAssignedAt ?? 0,
    });
  }
  return out;
}

/** The assignee for a new lead (see the rule at the top of this file), or null. */
async function pickLeadAssignee(
  ctx: QueryCtx,
  orgId: string,
): Promise<{ member: Member; reason: string } | null> {
  for (const strict of [true, false]) {
    const pool = await leadCandidates(ctx, orgId, strict);
    if (pool.length === 0) continue;
    const counts = await toursThisWeek(ctx, orgId, pool.map((p) => p.userId));
    pool.sort(
      (a, b) =>
        (counts.get(a.userId) ?? 0) - (counts.get(b.userId) ?? 0) ||
        a.lastAssignedAt - b.lastAssignedAt ||
        a.joinedAt - b.joinedAt,
    );
    const top = pool[0];
    return {
      member: top,
      reason: `${strict ? "fewest tours this week" : "fallback (no calendar-ready lead assignee)"}: ${counts.get(top.userId) ?? 0} tours`,
    };
  }
  return null;
}

async function membershipOf(ctx: QueryCtx, orgId: string, userId: Id<"users">): Promise<Doc<"memberships"> | null> {
  const m = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return m && m.orgId === orgId ? m : null;
}

function dedupe(ids: Id<"users">[]): Id<"users">[] {
  return [...new Set(ids)];
}

/** Letters, digits, space, apostrophe, dash; first token. For staff texts only. */
function firstName(full: string | undefined): string | undefined {
  return full?.trim().split(/\s+/)[0] || undefined;
}

// --- Leasing leads -----------------------------------------------------------------

/**
 * log_lead: capture (merged into the call's qualifications row), classify (flags are staff-facing
 * only), assign an asset manager once, and tell them + the admins once contact info exists.
 */
export const captureLead = internalMutation({
  args: { orgId: v.string(), ...upsertArgs },
  handler: async (
    ctx,
    { orgId, ...args },
  ): Promise<{ qualificationId: Id<"qualifications">; assignedFirstName: string | null }> => {
    // The row the Leads page lists must exist before the qualification links to it (see
    // ensureLeadConversation); never allowed to block capturing the lead.
    await ensureLeadConversation(ctx, orgId, args.elevenLabsConversationId);
    const qualificationId = await upsertQualification(ctx, args);
    const assigned = await ensureAssigned(ctx, orgId, qualificationId, args.elevenLabsConversationId);
    return { qualificationId, assignedFirstName: assigned };
  },
});

/** Routes an existing qualification (check_qualification's capture path) without changing its fields. */
export const routeLead = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<{ assignedFirstName: string | null }> => {
    const q = await ctx.db
      .query("qualifications")
      .withIndex("by_elevenlabs_conversation_id", (x) =>
        x.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();
    if (!q) return { assignedFirstName: null };
    const convId = await ensureLeadConversation(ctx, args.orgId, args.elevenLabsConversationId);
    if (convId && !q.conversationId) await ctx.db.patch(q._id, { conversationId: convId });
    return { assignedFirstName: await ensureAssigned(ctx, args.orgId, q._id, args.elevenLabsConversationId) };
  },
});

/** Assigns if not yet (or the previous assignee is no longer valid), then notifies once. */
async function ensureAssigned(
  ctx: MutationCtx,
  orgId: string,
  qualificationId: Id<"qualifications">,
  elId: string,
  notify = true,
): Promise<string | null> {
  const q = await ctx.db.get(qualificationId);
  if (!q) return null;
  const now = Date.now();

  let assigneeId = q.assignedUserId;
  if (assigneeId) {
    // Keep a valid assignment; replace one whose owner left, lost the role or went out of office.
    const m = await membershipOf(ctx, orgId, assigneeId);
    if (!m || !isAssetManager(m) || isOutOfOffice(m, now)) assigneeId = undefined;
  }
  if (!assigneeId) {
    const picked = await pickLeadAssignee(ctx, orgId);
    if (picked) {
      assigneeId = picked.member.userId;
      await ctx.db.patch(qualificationId, {
        assignedUserId: assigneeId,
        assignedAt: now,
        assignmentReason: picked.reason,
        updatedAt: now,
      });
      const m = await membershipOf(ctx, orgId, assigneeId);
      if (m) await ctx.db.patch(m._id, { lastLeadAssignedAt: now });
      await writeAudit(ctx, {
        orgId,
        entity: "conversation",
        entityId: elId,
        action: "lead_assigned",
        to: String(assigneeId),
        note: picked.reason,
      });
    }
  }

  const fresh = (await ctx.db.get(qualificationId)) ?? q;
  const assigneeName = assigneeId ? await firstNameOf(ctx, assigneeId) : null;
  // Text staff once, as soon as there is somebody to call. A lead logged before the caller gave a
  // name or number waits; the next log_lead call that adds one sends it.
  if (notify && !fresh.leadNotifiedAt && (fresh.callerName || fresh.callerPhone)) {
    const staff = await staffRecipientIds(ctx, orgId);
    await scheduleNotify(ctx, {
      orgId,
      userIds: dedupe([...(assigneeId ? [assigneeId] : []), ...staff]),
      template: "lead_assigned",
      data: {
        firstName: firstName(fresh.callerName),
        phone: fresh.callerPhone,
        assignee: assigneeName ?? undefined,
        path: "/leads",
      },
    });
    await ctx.db.patch(qualificationId, { leadNotifiedAt: now });
  }
  return assigneeName;
}

const BACKFILL_MAX_LEADS = 200;
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BACKFILL_SCAN_LIMIT = 600;

/**
 * Assigns this team's currently unassigned leads (last 30 days) with the normal rule. Never texts
 * anyone (notify off; leadNotifiedAt stays unset). Skips rows that already have an assignee, so
 * running it twice cannot double-assign. At most BACKFILL_MAX_LEADS per run. Writes one summary
 * audit row. orgId must come from a trusted caller (session or internal).
 */
export async function backfillUnassignedLeadsForOrg(
  ctx: MutationCtx,
  orgId: string,
  actorUserId?: Id<"users">,
): Promise<{ assigned: number; scanned: number }> {
  const since = Date.now() - BACKFILL_WINDOW_MS;
  const convs = await ctx.db
    .query("conversations")
    .withIndex("by_org_and_started", (q) => q.eq("orgId", orgId).gte("startedAt", since))
    .order("desc")
    .take(BACKFILL_SCAN_LIMIT);
  let assigned = 0;
  let scanned = 0;
  for (const c of convs) {
    if (assigned >= BACKFILL_MAX_LEADS) break;
    if (!c.elevenLabsConversationId) continue;
    const elId = c.elevenLabsConversationId;
    const q = await ctx.db
      .query("qualifications")
      .withIndex("by_elevenlabs_conversation_id", (x) => x.eq("elevenLabsConversationId", elId))
      .first();
    if (!q || q.assignedUserId) continue;
    scanned += 1;
    const name = await ensureAssigned(ctx, orgId, q._id, elId, false);
    if (name !== null) assigned += 1;
  }
  await writeAudit(ctx, {
    orgId,
    entity: "config",
    entityId: "lead_backfill",
    action: "leads_backfill_assigned",
    actorUserId,
    note: `Assigned ${assigned} of ${scanned} unassigned lead(s) from the last 30 days (max ${BACKFILL_MAX_LEADS} per run). No texts sent.`,
  });
  return { assigned, scanned };
}

/** Trigger later with:  npx convex run leads:backfillUnassignedLeads '{"orgId":"<org id>"}' */
export const backfillUnassignedLeads = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => await backfillUnassignedLeadsForOrg(ctx, args.orgId),
});

/**
 * A tour was booked (or moved to another person): the lead belongs to whoever the tour is with.
 * Texts that person and the admins "tour booked" (first name + phone + time only).
 */
export const assignOnTour = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    userId: v.id("users"),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    when: v.string(),
    notify: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const m = await membershipOf(ctx, args.orgId, args.userId);
    if (!m || !isAssetManager(m)) return;
    const now = Date.now();

    await ensureLeadConversation(ctx, args.orgId, args.elevenLabsConversationId);
    const qualificationId = await upsertQualification(ctx, {
      elevenLabsConversationId: args.elevenLabsConversationId,
      callerName: args.callerName,
      callerPhone: args.callerPhone,
    });
    const q = await ctx.db.get(qualificationId);
    if (!q) return;

    const changed = q.assignedUserId !== args.userId;
    if (changed) {
      await ctx.db.patch(qualificationId, {
        assignedUserId: args.userId,
        assignedAt: now,
        assignmentReason: "tour booked with this asset manager",
        updatedAt: now,
      });
      await ctx.db.patch(m._id, { lastLeadAssignedAt: now });
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: "conversation",
        entityId: args.elevenLabsConversationId,
        action: "lead_assigned",
        from: q.assignedUserId ? String(q.assignedUserId) : undefined,
        to: String(args.userId),
        note: "tour booked",
      });
    }
    if (!args.notify) return;

    const staff = await staffRecipientIds(ctx, args.orgId);
    await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds: dedupe([args.userId, ...staff]),
      template: "tour_booked",
      data: {
        firstName: firstName(q.callerName ?? args.callerName),
        phone: q.callerPhone ?? args.callerPhone,
        when: args.when,
        assignee: await firstNameOf(ctx, args.userId),
        path: "/leads",
      },
    });
    await ctx.db.patch(qualificationId, { leadNotifiedAt: q.leadNotifiedAt ?? now });
  },
});

// --- Unmatched callers ---------------------------------------------------------------

/**
 * The asset manager for a caller we could not match: unmatchedAssignee AMs first (least open
 * callbacks, then least recently assigned), else lead assignees, else the maintenance lead.
 */
async function pickUnmatchedAssignee(ctx: QueryCtx, orgId: string): Promise<Id<"users"> | null> {
  const now = Date.now();
  const members = await orgMembers(ctx, orgId);
  const tiers: Doc<"memberships">[][] = [
    members.filter((m) => m.unmatchedAssignee && isAssetManager(m) && !isOutOfOffice(m, now)),
    members.filter((m) => m.leadAssignee && isAssetManager(m) && !isOutOfOffice(m, now)),
    members.filter((m) => (m.jobRoles ?? []).includes("maintenance_lead") && !isOutOfOffice(m, now)),
  ];
  for (const tier of tiers) {
    if (tier.length === 0) continue;
    const load = new Map<Id<"users">, number>();
    for (const m of tier) {
      const open = await ctx.db
        .query("callbackContacts")
        .withIndex("by_assignee_and_status", (q) => q.eq("assignedUserId", m.userId).eq("status", "open"))
        .take(200);
      load.set(m.userId, open.length);
    }
    tier.sort(
      (a, b) =>
        (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0) ||
        (a.lastUnmatchedAssignedAt ?? 0) - (b.lastUnmatchedAssignedAt ?? 0) ||
        a.createdAt - b.createdAt,
    );
    return tier[0].userId;
  }
  return null;
}

/**
 * log_unmatched_caller: a callback contact for a caller who is not in the resident directory.
 * Upserts by call. NO maintenance request is created. First creation texts the assigned asset
 * manager and the admins.
 */
export const logUnmatchedCaller = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    callerName: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    callerEmail: v.optional(v.string()),
    reason: v.string(),
    issueSummary: v.string(),
    // Sarah flagged this unmatched caller's issue as an emergency (fire, gas, flooding, break-in).
    emergency: v.optional(v.boolean()),
    spokenUnit: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ assignedFirstName: string | null; created: boolean; emergencyAlerted: boolean }> => {
    // An unmatched caller has no request, so the alert is keyed on the call. Deduped per call.
    const alertEmergency = async (): Promise<boolean> =>
      args.emergency
        ? await scheduleEmergencyAlert(ctx, {
            orgId: args.orgId,
            keys: [{ entity: "conversation", id: args.elevenLabsConversationId }],
            unit: args.spokenUnit,
            path: "/tenants",
          })
        : false;
    const now = Date.now();
    const existing = (
      await ctx.db
        .query("callbackContacts")
        .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
        .collect()
    ).find((r) => r.orgId === args.orgId && !r.reason.startsWith(STAFF_MESSAGE_PREFIX)); // a staff message (owner call menu) is its own row

    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();

    const fields = {
      callerName: args.callerName?.slice(0, 120),
      callerNumber: args.callerNumber?.slice(0, 40),
      callbackNumber: args.callbackNumber?.slice(0, 40),
      callerEmail: args.callerEmail?.slice(0, 200),
      reason: args.reason.slice(0, 300),
      issueSummary: args.issueSummary.slice(0, 2000),
    };

    if (existing) {
      // Fill gaps and take the newer summary; never blank a field the caller already gave.
      const patch: Record<string, unknown> = { updatedAt: now, reason: fields.reason, issueSummary: fields.issueSummary };
      for (const k of ["callerName", "callerNumber", "callbackNumber", "callerEmail"] as const) {
        if (fields[k]) patch[k] = fields[k];
      }
      if (!existing.conversationId && conv) patch.conversationId = conv._id;
      await ctx.db.patch(existing._id, patch);
      const owner = existing.assignedUserId ? await firstNameOf(ctx, existing.assignedUserId) : null;
      return { assignedFirstName: owner, created: false, emergencyAlerted: await alertEmergency() };
    }

    const assigneeId = await pickUnmatchedAssignee(ctx, args.orgId);
    const id = await ctx.db.insert("callbackContacts", {
      orgId: args.orgId,
      elevenLabsConversationId: args.elevenLabsConversationId,
      conversationId: conv?._id,
      ...fields,
      assignedUserId: assigneeId ?? undefined,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    if (assigneeId) {
      const m = await membershipOf(ctx, args.orgId, assigneeId);
      if (m) await ctx.db.patch(m._id, { lastUnmatchedAssignedAt: now });
    }
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: "unmatched_caller_logged",
      to: assigneeId ? String(assigneeId) : "unassigned",
      note: `callback ${id}: ${fields.reason}`,
    });
    const staff = await staffRecipientIds(ctx, args.orgId);
    await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds: dedupe([...(assigneeId ? [assigneeId] : []), ...staff]),
      template: "unmatched_caller",
      data: {
        firstName: firstName(fields.callerName),
        phone: fields.callbackNumber ?? fields.callerNumber,
        path: "/tenants",
      },
    });
    return {
      assignedFirstName: assigneeId ? await firstNameOf(ctx, assigneeId) : null,
      created: true,
      emergencyAlerted: await alertEmergency(),
    };
  },
});

/** Callback contacts: the admin view sees the team's, an asset manager only theirs. Newest first. */
export const callbacks = query({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("called_back"), v.literal("closed"))) },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return [];
    const rows = await ctx.db
      .query("callbackContacts")
      .withIndex("by_org_and_created", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .take(300);
    const visible = rows.filter(
      (r) =>
        (view === "admin" || r.assignedUserId === org.user._id) && (!args.status || r.status === args.status),
    );
    return await Promise.all(
      visible.map(async (r) => {
        const assignee = r.assignedUserId ? await ctx.db.get(r.assignedUserId) : null;
        return {
          id: r._id,
          callerName: r.callerName ?? null,
          callbackNumber: r.callbackNumber ?? r.callerNumber ?? null,
          callerEmail: r.callerEmail ?? null,
          reason: r.reason,
          issueSummary: r.issueSummary,
          status: r.status,
          assignedUserId: r.assignedUserId ?? null,
          assignedName: assignee ? [assignee.firstName, assignee.lastName].filter(Boolean).join(" ") || null : null,
          assignedToMe: r.assignedUserId === org.user._id,
          conversationId: r.conversationId ?? null,
          createdAt: r.createdAt,
        };
      }),
    );
  },
});

/** Marks a callback done. Its assignee or the admin view only; anyone else sees "not found". */
export const setCallbackStatus = mutation({
  args: { id: v.id("callbackContacts"), status: v.union(v.literal("open"), v.literal("called_back"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) throw new ConvexError("No team found for this account. Try signing in again.");
    const row = await ctx.db.get(args.id);
    const admin = viewFor(org.isAdmin, org.jobRoles) === "admin";
    if (!row || row.orgId !== org.orgId || (!admin && row.assignedUserId !== org.user._id)) {
      throw new ConvexError("Callback not found.");
    }
    await ctx.db.patch(row._id, { status: args.status, updatedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "conversation",
      entityId: row.elevenLabsConversationId ?? String(row._id),
      action: "callback_status",
      actorUserId: org.user._id,
      from: row.status,
      to: args.status,
    });
  },
});

