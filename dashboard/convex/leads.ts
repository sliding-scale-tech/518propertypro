import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, hasAnyRole, isAdminView, requireAdminView } from "./authz";
import type { OrgContext } from "./authz";
import { callbacksView, countByStatus, pageOf } from "./tenantViews";
import { scheduleEmergencyAlert, scheduleNotify, staffRecipientIds } from "./notify";
import { ensureLeadConversation } from "./conversations";
import { upsertArgs, upsertQualification } from "./qualifications";
import { STAFF_MESSAGE_PREFIX } from "./ownerRoutingLib";
import { appRolesOf } from "./roleSet";
import { buildingAssetManager, decideBuildingRoute, effectiveAssignedBy, leadTextRecipients } from "./leadRoutingLib";

/**
 * Sarah's routing of people to people (lead -> asset manager, unmatched caller -> asset manager,
 * resident question -> request for the unit's asset manager).
 *
 * Everything callable from Sarah's tools is internal: the org comes from the call's own
 * conversation / agent id (http.ts) and is trusted from there on, never from what the caller said.
 *
 * LEAD ASSIGNMENT RULE (B41; the pure decisions are in leadRoutingLib.ts):
 *   - A new lead is UNASSIGNED. It waits on the admin Leads page ("Unassigned") until the caller
 *     picks a building or an admin assigns it by hand (assignLead).
 *   - The caller picks a building (spoken_building, from Sarah's own listing results, on
 *     request_tour / reschedule_tour / find_tour_times / log_lead): the lead goes to that building's
 *     asset manager (most units there), assignedBy "auto_building".
 *   - A manual assignment (or one made before B41) is never changed by Sarah. A lead assigned by
 *     building follows the caller to another building.
 *   - Booking a tour does NOT hand the lead to whoever gives the tour; the tour host is texted about
 *     the tour, and the lead stays with its owner.
 *   - The "new lead" text goes once to the admins (plus the owner, if there is one yet) when the lead
 *     has a name or number; a later owner by building gets the same text on their own.
 */

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

function fullNameOf(u: Doc<"users"> | null): string {
  if (!u) return "Team member";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Team member";
}

async function orgMembers(ctx: QueryCtx, orgId: string): Promise<Doc<"memberships">[]> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
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

/** The building's street line, for the assignment reason staff see. */
function streetOf(property: Doc<"properties">): string {
  return (property.address?.formatted ?? property.name).split(",")[0].trim() || property.name;
}

/**
 * The caller picked this building: hand the lead to its asset manager, unless an admin assigned it
 * by hand (leadRoutingLib.decideBuildingRoute). The building must be this team's. Never texts; the
 * caller decides that (notifyLead, or the tour text).
 */
async function routeToBuilding(
  ctx: MutationCtx,
  orgId: string,
  qualificationId: Id<"qualifications">,
  propertyId: Id<"properties">,
  elId: string,
): Promise<void> {
  const property = await ctx.db.get(propertyId);
  if (!property || property.orgId !== orgId) return;
  const q = await ctx.db.get(qualificationId);
  if (!q) return;

  const units = (
    await ctx.db
      .query("units")
      .withIndex("by_property", (x) => x.eq("propertyId", propertyId))
      .collect()
  ).filter((u) => u.orgId === orgId);
  const memberIds = new Set((await orgMembers(ctx, orgId)).map((m) => String(m.userId)));
  const amId = buildingAssetManager(
    units.map((u) => String(u.assetManagerUserId)),
    memberIds,
  );
  const decision = decideBuildingRoute(
    { assignedUserId: q.assignedUserId, assignedBy: q.assignedBy, assignedPropertyId: q.assignedPropertyId },
    { propertyId: String(propertyId), assetManagerUserId: amId },
  );
  if (decision.action === "keep") return;

  const userId = decision.userId as Id<"users">;
  const now = Date.now();
  await ctx.db.patch(qualificationId, {
    assignedUserId: userId,
    assignedBy: "auto_building",
    assignedPropertyId: propertyId,
    assignedAt: decision.ownerChanged ? now : (q.assignedAt ?? now),
    assignmentReason: `asset manager of ${streetOf(property)}`,
    updatedAt: now,
  });
  if (decision.ownerChanged) {
    const m = await membershipOf(ctx, orgId, userId);
    if (m) await ctx.db.patch(m._id, { lastLeadAssignedAt: now });
    await writeAudit(ctx, {
      orgId,
      entity: "conversation",
      entityId: elId,
      action: "lead_assigned",
      from: q.assignedUserId ? String(q.assignedUserId) : undefined,
      to: String(userId),
      note: `building picked: ${streetOf(property)}`,
    });
  }
}

/**
 * The "new lead" text (leadRoutingLib.leadTextRecipients): once the lead has a name or number, the
 * admins and the owner if there is one; later, a new owner by building on their own. Never anyone else.
 */
async function notifyLead(ctx: MutationCtx, orgId: string, qualificationId: Id<"qualifications">): Promise<void> {
  const q = await ctx.db.get(qualificationId);
  if (!q) return;
  const plan = leadTextRecipients({
    hasContact: Boolean(q.callerName || q.callerPhone),
    notified: q.leadNotifiedAt !== undefined,
    notifiedUserId: q.leadNotifiedUserId,
    assignedUserId: q.assignedUserId,
    assignedBy: effectiveAssignedBy(q),
  });
  if (!plan) return;
  const assigneeId = (plan.assignee as Id<"users"> | null) ?? null;
  const staff = plan.kind === "first" ? await staffRecipientIds(ctx, orgId) : [];
  await scheduleNotify(ctx, {
    orgId,
    userIds: dedupe([...(assigneeId ? [assigneeId] : []), ...staff]),
    template: "lead_assigned",
    data: {
      firstName: firstName(q.callerName),
      phone: q.callerPhone,
      assignee: assigneeId ? await firstNameOf(ctx, assigneeId) : undefined,
      path: "/leads",
    },
  });
  await ctx.db.patch(qualificationId, {
    leadNotifiedAt: q.leadNotifiedAt ?? Date.now(),
    ...(assigneeId ? { leadNotifiedUserId: assigneeId } : {}),
  });
}

async function assigneeFirstName(ctx: QueryCtx, qualificationId: Id<"qualifications">): Promise<string | null> {
  const q = await ctx.db.get(qualificationId);
  return q?.assignedUserId ? await firstNameOf(ctx, q.assignedUserId) : null;
}

/**
 * log_lead: capture (merged into the call's qualifications row) and classify (flags are staff-facing
 * only). The lead stays unassigned unless the caller picked a building (`propertyId`, matched from
 * spoken_building on this team's buildings), which routes it to that building's asset manager. Then
 * the admins (and the owner, if any) are texted once contact info exists.
 */
export const captureLead = internalMutation({
  args: { orgId: v.string(), propertyId: v.optional(v.id("properties")), ...upsertArgs },
  handler: async (
    ctx,
    { orgId, propertyId, ...args },
  ): Promise<{ qualificationId: Id<"qualifications">; assignedFirstName: string | null }> => {
    // The row the Leads page lists must exist before the qualification links to it (see
    // ensureLeadConversation); never allowed to block capturing the lead.
    await ensureLeadConversation(ctx, orgId, args.elevenLabsConversationId);
    const qualificationId = await upsertQualification(ctx, args);
    if (propertyId) await routeToBuilding(ctx, orgId, qualificationId, propertyId, args.elevenLabsConversationId);
    await notifyLead(ctx, orgId, qualificationId);
    return { qualificationId, assignedFirstName: await assigneeFirstName(ctx, qualificationId) };
  },
});

/** check_qualification's capture path: links the row and sends the "new lead" text if due. Never assigns. */
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
    await notifyLead(ctx, args.orgId, q._id);
    return { assignedFirstName: await assigneeFirstName(ctx, q._id) };
  },
});

/**
 * find_tour_times with a building the caller picked: the lead goes to that building's asset manager
 * now, even if no tour is booked in the end. Same rules as captureLead.
 */
export const routeLeadToBuilding = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string(), propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<void> => {
    await ensureLeadConversation(ctx, args.orgId, args.elevenLabsConversationId);
    const qualificationId = await upsertQualification(ctx, { elevenLabsConversationId: args.elevenLabsConversationId });
    await routeToBuilding(ctx, args.orgId, qualificationId, args.propertyId, args.elevenLabsConversationId);
    await notifyLead(ctx, args.orgId, qualificationId);
  },
});

/**
 * A tour was booked (or moved): the lead goes to the asset manager of the tour's building
 * (`propertyId`, if one was chosen) under the usual rules; it is NOT handed to whoever gives the tour.
 * With `notify`, the tour host, the lead's owner and the admins get "tour booked" (first name + phone +
 * time only), which also counts as the "new lead" text. Without it, only a due "new lead" text goes.
 */
export const leadTourBooked = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    userId: v.id("users"),
    propertyId: v.optional(v.id("properties")),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    when: v.string(),
    notify: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Anyone on a team's tour list may host (tourStaffLib), so only team membership is checked here.
    const host = await membershipOf(ctx, args.orgId, args.userId);
    if (!host) return;

    await ensureLeadConversation(ctx, args.orgId, args.elevenLabsConversationId);
    const qualificationId = await upsertQualification(ctx, {
      elevenLabsConversationId: args.elevenLabsConversationId,
      callerName: args.callerName,
      callerPhone: args.callerPhone,
    });
    if (args.propertyId) {
      await routeToBuilding(ctx, args.orgId, qualificationId, args.propertyId, args.elevenLabsConversationId);
    }
    if (!args.notify) {
      await notifyLead(ctx, args.orgId, qualificationId);
      return;
    }

    const q = await ctx.db.get(qualificationId);
    if (!q) return;
    const staff = await staffRecipientIds(ctx, args.orgId);
    const owner = q.assignedUserId ?? null;
    await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds: dedupe([args.userId, ...(owner ? [owner] : []), ...staff]),
      template: "tour_booked",
      data: {
        firstName: firstName(q.callerName ?? args.callerName),
        phone: q.callerPhone ?? args.callerPhone,
        when: args.when,
        assignee: await firstNameOf(ctx, args.userId),
        path: "/leads",
      },
    });
    await ctx.db.patch(qualificationId, {
      leadNotifiedAt: q.leadNotifiedAt ?? Date.now(),
      ...(owner ? { leadNotifiedUserId: owner } : {}),
    });
  },
});

// --- Manual assignment (Leads page, admins only) --------------------------------------

/** Who an admin may assign a lead to: this team's asset managers and admins, by name. */
export const assignableMembers = query({
  args: {},
  handler: async (ctx): Promise<Array<{ userId: Id<"users">; name: string }>> => {
    const org = await currentOrg(ctx);
    if (!org || !isAdminView(org)) return [];
    const out: Array<{ userId: Id<"users">; name: string }> = [];
    for (const m of await orgMembers(ctx, org.orgId)) {
      const roles = appRolesOf(m.role, m.jobRoles);
      if (!roles.includes("asset_manager") && !roles.includes("admin")) continue;
      out.push({ userId: m.userId, name: fullNameOf(await ctx.db.get(m.userId)) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * An admin assigns a lead by hand (assignedBy "manual": Sarah never changes it), or sets it back to
 * unassigned (`userId` empty), after which picking a building routes it again. Admin view only,
 * checked here; the lead must be one of this team's calls. assignedPropertyId is never touched: a
 * hand-assigned lead keeps the building it was routed to, so a bulk asset-manager change
 * (bulkReassign) still finds it; decideBuildingRoute keeps a manual lead with Sarah regardless.
 */
export const assignLead = mutation({
  args: { conversationId: v.optional(v.string()), userId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ assigneeName: string | null }> => {
    const org = await requireAdminView(ctx);
    const convId = args.conversationId ? ctx.db.normalizeId("conversations", args.conversationId) : null;
    const conv = convId ? await ctx.db.get(convId) : null;
    if (!conv || conv.orgId !== org.orgId) throw new ConvexError("That lead was not found. Refresh the page and try again.");

    const rawUser = typeof args.userId === "string" ? args.userId.trim() : "";
    let userId: Id<"users"> | null = null;
    if (rawUser && rawUser !== "unassigned") {
      userId = ctx.db.normalizeId("users", rawUser);
      const m = userId ? await membershipOf(ctx, org.orgId, userId) : null;
      if (!userId || !m) throw new ConvexError("Choose someone on this team to assign the lead to.");
      const roles = appRolesOf(m.role, m.jobRoles);
      if (!roles.includes("asset_manager") && !roles.includes("admin")) {
        throw new ConvexError("Only an asset manager or an admin can be assigned a lead.");
      }
    }

    const elId = conv.elevenLabsConversationId;
    let q = elId
      ? await ctx.db
          .query("qualifications")
          .withIndex("by_elevenlabs_conversation_id", (x) => x.eq("elevenLabsConversationId", elId))
          .first()
      : null;
    if (!q && elId) {
      const id = await upsertQualification(ctx, { elevenLabsConversationId: elId });
      q = await ctx.db.get(id);
    }
    if (!q) throw new ConvexError("This lead has no call record yet, so it can't be assigned.");
    if (!q.conversationId) await ctx.db.patch(q._id, { conversationId: conv._id });

    const now = Date.now();
    if (userId === null) {
      if (!q.assignedUserId) return { assigneeName: null };
      await ctx.db.patch(q._id, {
        assignedUserId: undefined,
        assignedBy: undefined,
        assignedAt: undefined,
        assignmentReason: undefined,
        updatedAt: now,
      });
    } else {
      if (q.assignedUserId === userId && effectiveAssignedBy(q) === "manual") {
        return { assigneeName: fullNameOf(await ctx.db.get(userId)) };
      }
      await ctx.db.patch(q._id, {
        assignedUserId: userId,
        assignedBy: "manual",
        assignedAt: now,
        assignmentReason: "assigned by an admin",
        updatedAt: now,
      });
    }
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "conversation",
      entityId: elId ?? String(conv._id),
      action: userId ? "lead_assigned_manual" : "lead_unassigned",
      actorUserId: org.user._id,
      from: q.assignedUserId ? String(q.assignedUserId) : undefined,
      to: userId ? String(userId) : "unassigned",
    });
    return { assigneeName: userId ? fullNameOf(await ctx.db.get(userId)) : null };
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

/**
 * The callbacks the caller may see, newest first, with no cap: the admin view sees the team's, an
 * asset manager only the ones assigned to them. null = this view has no access.
 */
async function readableCallbacks(ctx: QueryCtx, org: OrgContext) {
  if (!hasAnyRole(org, "admin", "asset_manager")) return null;
  let rows: Doc<"callbackContacts">[];
  if (isAdminView(org)) {
    rows = await ctx.db
      .query("callbackContacts")
      .withIndex("by_org_and_created", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .collect();
  } else {
    rows = (
      await ctx.db
        .query("callbackContacts")
        .withIndex("by_assignee_and_status", (q) => q.eq("assignedUserId", org.user._id))
        .collect()
    )
      .filter((r) => r.orgId === org.orgId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  const assignees = new Map<string, Doc<"users"> | null>();
  return await Promise.all(
    rows.map(async (r) => {
      let assignee: Doc<"users"> | null = null;
      if (r.assignedUserId) {
        if (!assignees.has(r.assignedUserId)) assignees.set(r.assignedUserId, await ctx.db.get(r.assignedUserId));
        assignee = assignees.get(r.assignedUserId) ?? null;
      }
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
}

/** Callback contacts: the admin view sees the team's, an asset manager only theirs. Newest first. */
export const callbacks = query({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("called_back"), v.literal("closed"))) },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    const rows = await readableCallbacks(ctx, org);
    if (!rows) return [];
    return args.status ? rows.filter((r) => r.status === args.status) : rows;
  },
});

type CallbackRow = NonNullable<Awaited<ReturnType<typeof readableCallbacks>>>[number];

/**
 * One page of the Callbacks tab: same read scope as `callbacks` (checked first), then status and
 * search over the whole set. `total` is the true count; `counts` are per status for the viewer
 * (ignoring search) so the status chips can show them. Newest first.
 */
export const callbacksPage = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("called_back"), v.literal("closed"), v.literal("all"))),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    const rows = org ? await readableCallbacks(ctx, org) : null;
    if (!rows) {
      return { ...pageOf<CallbackRow>([], 1, args.pageSize), counts: countByStatus([]) };
    }
    const filtered = callbacksView(rows, { q: args.search, status: args.status });
    return { ...pageOf(filtered, args.page, args.pageSize), counts: countByStatus(rows) };
  },
});

/** Marks a callback done. Its assignee or the admin view only; anyone else sees "not found". */
export const setCallbackStatus = mutation({
  args: { id: v.id("callbackContacts"), status: v.union(v.literal("open"), v.literal("called_back"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) throw new ConvexError("No team found for this account. Try signing in again.");
    const row = await ctx.db.get(args.id);
    const admin = isAdminView(org);
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

