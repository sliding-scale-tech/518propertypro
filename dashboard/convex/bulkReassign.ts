import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, isAdminView, requireAdminViewId } from "./authz";
import type { OrgContext } from "./authz";
import { userName } from "./board";
import { scheduleNotify } from "./notify";
import { reassignUnitInBulk } from "./units";
import * as L from "./bulkReassignLib";

/**
 * Teams view and bulk "Change asset manager" (Asset Managers > Teams, and the property page).
 *
 * Admin-view only, checked on the server: the queries return null for anyone else (so a page
 * never crashes on a role change) and the action re-checks the admin in EVERY batch mutation.
 * The org always comes from the session; every client-sent id is normalized and re-checked
 * against that org. Nothing here reads or returns resident data.
 *
 * Moving a unit goes through units.reassignUnitInBulk, which is the same per-unit core
 * (units.reassignDetailed) as the single "Reassign unit" flow: the unit's own "am_changed" audit
 * row with the reason, and every open maintenance request on the unit repointed with its own
 * audit row. On top of that the whole change gets ONE summary audit row (who, when, reason,
 * from -> to, counts). Open LEADS move too (see openLeadsIn: routed by a building in scope and held
 * by someone the units move away from, auto and manual alike, assignedBy kept as it was), each with
 * its own audit row. Booked tours are NOT moved: they stay on the old manager's Google calendar and
 * the preview/result says how many.
 *
 * Scale: the apply is an action that runs internal mutations of L.BULK_BATCH_SIZE units (or leads)
 * each. Each batch re-reads what is still left to move, so a re-run or a concurrent edit never moves
 * a unit or a lead twice and the loop always ends. Leads go first (their holders are read from the
 * units that still have to move), then the units.
 */

const OPEN_REQUEST_STATUSES = ["new", "under_review", "more_info_needed", "forwarded_to_pat"] as const;

type ScopeArgs = { team?: string; propertyId?: string };

type Scope = {
  kind: "building" | "team";
  /** For messages: "this building" / "Silver". */
  label: string;
  /** For the audit and the result: "12 Main St" / "Silver team". */
  name: string;
  auditEntity: "property" | "config";
  auditEntityId: string;
  properties: Doc<"properties">[];
};

const scopeArgs = {
  team: v.optional(v.string()),
  propertyId: v.optional(v.string()),
};
const personArgs = {
  toUserId: v.optional(v.string()),
  fromUserId: v.optional(v.string()),
};

function isAmMembership(m: Doc<"memberships"> | null | undefined, orgId: string): m is Doc<"memberships"> {
  return !!m && m.orgId === orgId && (m.jobRoles ?? []).includes("asset_manager");
}

async function membershipOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

async function resolveScope(ctx: QueryCtx, org: OrgContext, args: ScopeArgs): Promise<Scope> {
  const rawProperty = (args.propertyId ?? "").trim();
  if (rawProperty !== "") {
    const id = ctx.db.normalizeId("properties", rawProperty);
    const property = id ? await ctx.db.get(id) : null;
    if (!property || property.orgId !== org.orgId) throw new ConvexError(L.BULK_MSG.buildingNotFound);
    return {
      kind: "building",
      label: "this building",
      name: property.name,
      auditEntity: "property",
      auditEntityId: property._id,
      properties: [property],
    };
  }
  const team = (args.team ?? "").trim();
  if (team === "") throw new ConvexError(L.BULK_MSG.chooseScope);
  if (!L.isBulkTeam(team)) throw new ConvexError(L.BULK_MSG.teamUnknown);
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org_and_category", (q) => q.eq("orgId", org.orgId).eq("category", team))
    .collect();
  return {
    kind: "team",
    label: L.BULK_TEAM_LABEL[team],
    name: `${L.BULK_TEAM_LABEL[team]} team`,
    auditEntity: "config",
    auditEntityId: `am_team:${team}`,
    properties,
  };
}

async function scopeUnits(ctx: QueryCtx, org: OrgContext, scope: Scope): Promise<Doc<"units">[]> {
  const out: Doc<"units">[] = [];
  for (const p of scope.properties) {
    const rows = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", p._id))
      .collect();
    for (const u of rows) if (u.orgId === org.orgId) out.push(u);
  }
  return out;
}

type People = { to: Id<"users">; toName: string; from: Id<"users"> | null; fromName: string | null };

/** The new manager (an AM on this org) and the optional "only units held by" manager (a member). */
async function resolvePeople(
  ctx: QueryCtx,
  org: OrgContext,
  args: { toUserId?: string; fromUserId?: string },
): Promise<People | L.BulkFieldError> {
  const problems = L.validateBulkInput({ toUserId: args.toUserId, fromUserId: args.fromUserId, reason: "skip" }).filter(
    (p) => p.field !== "reason",
  );
  if (problems.length > 0) return problems[0];
  const to = ctx.db.normalizeId("users", (args.toUserId ?? "").trim());
  const toUser = to ? await ctx.db.get(to) : null;
  if (!to || !toUser || !isAmMembership(await membershipOf(ctx, to), org.orgId)) {
    return { field: "toUserId", message: L.BULK_MSG.notAnAm };
  }
  const rawFrom = (args.fromUserId ?? "").trim();
  if (rawFrom === "") return { to, toName: userName(toUser), from: null, fromName: null };
  const from = ctx.db.normalizeId("users", rawFrom);
  const fromUser = from ? await ctx.db.get(from) : null;
  const fromMembership = from ? await membershipOf(ctx, from) : null;
  if (!from || !fromUser || !fromMembership || fromMembership.orgId !== org.orgId) {
    return { field: "fromUserId", message: L.BULK_MSG.fromNotFound };
  }
  return { to, toName: userName(toUser), from, fromName: userName(fromUser) };
}

function isFieldError(p: People | L.BulkFieldError): p is L.BulkFieldError {
  return "field" in p && "message" in p;
}

async function namesOf(ctx: QueryCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const uid = ctx.db.normalizeId("users", id);
    out.set(id, userName(uid ? await ctx.db.get(uid) : null));
  }
  return out;
}

/** Open requests on any of these units (4 index reads for the whole org, not one per unit). */
async function openRequestsOn(ctx: QueryCtx, org: OrgContext, unitIds: ReadonlySet<string>): Promise<number> {
  let n = 0;
  for (const status of OPEN_REQUEST_STATUSES) {
    const rows = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", status))
      .collect();
    for (const r of rows) if (r.unitId && unitIds.has(r.unitId)) n += 1;
  }
  return n;
}

/**
 * The open leads a change moves (rules in L.planLeadMove): routed by one of the scope's buildings
 * (read through the by_assigned_property index, so the org comes from the buildings, which are
 * already checked against the org) and held by one of `holders`. Never anything already with `to`.
 */
async function openLeadsIn(
  ctx: QueryCtx,
  scope: Scope,
  holders: ReadonlySet<string>,
  to: string,
): Promise<Doc<"qualifications">[]> {
  if (holders.size === 0) return [];
  const rows: Doc<"qualifications">[] = [];
  for (const p of scope.properties) {
    rows.push(
      ...(await ctx.db
        .query("qualifications")
        .withIndex("by_assigned_property", (q) => q.eq("assignedPropertyId", p._id))
        .collect()),
    );
  }
  const byId = new Map(rows.map((r) => [r._id as string, r]));
  return L.planLeadMove(
    rows.map((r) => ({
      leadId: r._id as string,
      assignedUserId: r.assignedUserId as string | undefined,
      assignedPropertyId: r.assignedPropertyId as string | undefined,
      assignedBy: r.assignedBy,
    })),
    new Set(scope.properties.map((p) => p._id as string)),
    holders,
    to,
  ).flatMap((l) => {
    const r = byId.get(l.leadId);
    return r ? [r] : [];
  });
}

/** Upcoming booked tours for these buildings that sit with one of `holders` (not `to`), by person. */
async function toursStaying(
  ctx: QueryCtx,
  org: OrgContext,
  propertyIds: ReadonlySet<string>,
  holders: ReadonlySet<string>,
  to: string,
): Promise<Array<{ name: string; count: number }>> {
  const now = Date.now();
  const rows = await ctx.db
    .query("tours")
    .withIndex("by_org_and_start", (q) => q.eq("orgId", String(org.orgId)).gte("start", now))
    .collect();
  const counts = new Map<string, number>();
  for (const t of rows) {
    if (t.status !== "booked" || !t.propertyId || !propertyIds.has(t.propertyId)) continue;
    if (t.assignedUserId === to || !holders.has(t.assignedUserId)) continue;
    counts.set(t.assignedUserId, (counts.get(t.assignedUserId) ?? 0) + 1);
  }
  const names = await namesOf(ctx, [...counts.keys()]);
  return [...counts.entries()].map(([id, count]) => ({ name: names.get(id) ?? "Unknown", count }));
}

// --- Teams view ---------------------------------------------------------------------------

/** Gold / Silver / Make Up: buildings, units, current managers (with photo email), for admins. */
export const teamsOverview = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org || !isAdminView(org)) return null;
    const [properties, units, memberships] = await Promise.all([
      ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
      ctx.db
        .query("units")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
    ]);
    const memberByUser = new Map(memberships.map((m) => [m.userId as string, m]));
    const userIds = new Set<string>([
      ...units.map((u) => u.assetManagerUserId as string),
      ...memberships.filter((m) => isAmMembership(m, org.orgId)).map((m) => m.userId as string),
    ]);
    const names = await namesOf(ctx, [...userIds]);

    const unitsByProperty = new Map<string, Doc<"units">[]>();
    for (const u of units) {
      const list = unitsByProperty.get(u.propertyId) ?? [];
      list.push(u);
      unitsByProperty.set(u.propertyId, list);
    }

    const teams = L.BULK_TEAMS.map((team) => {
      const props = properties.filter((p) => p.category === team).sort((a, b) => a.name.localeCompare(b.name));
      const perManager = new Map<string, number>();
      let unitCount = 0;
      const buildings = props.map((p) => {
        const list = unitsByProperty.get(p._id) ?? [];
        unitCount += list.length;
        for (const u of list) perManager.set(u.assetManagerUserId, (perManager.get(u.assetManagerUserId) ?? 0) + 1);
        return { propertyId: p._id, name: p.name, unitCount: list.length };
      });
      const managers = [...perManager.entries()]
        .map(([userId, count]) => ({
          userId: userId as Id<"users">,
          name: names.get(userId) ?? "Unknown",
          units: count,
          photoEmail: memberByUser.get(userId)?.photoEmail ?? null,
        }))
        .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
      return { team, label: L.BULK_TEAM_LABEL[team], buildingCount: props.length, unitCount, buildings, managers };
    });

    const assetManagers = memberships
      .filter((m) => isAmMembership(m, org.orgId))
      .map((m) => ({ userId: m.userId, name: names.get(m.userId) ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const noTeamBuildings = properties.filter((p) => !L.isBulkTeam(p.category)).length;
    return { teams, assetManagers, noTeamBuildings };
  },
});

// --- Preview ------------------------------------------------------------------------------

export type BulkPreview =
  | { ok: false; field?: L.BulkField; message: string }
  | {
      ok: true;
      sentence: string;
      scopeName: string;
      unitCount: number;
      buildingCount: number;
      from: Array<{ name: string; count: number }>;
      toName: string;
      requestsMoving: number;
      leadsMoving: number;
      toursNote: string | null;
      defaultsSwitching: number;
    };

/**
 * Exactly what `apply` would do right now. Never throws for a user-fixable problem: it answers
 * { ok: false, field, message } so the dialog can mark the field (a throwing query would crash
 * the page). Null for non-admins.
 */
export const preview = query({
  args: { ...scopeArgs, ...personArgs },
  handler: async (ctx, args): Promise<BulkPreview | null> => {
    const org = await currentOrg(ctx);
    if (!org || !isAdminView(org)) return null;
    let scope: Scope;
    try {
      scope = await resolveScope(ctx, org, args);
    } catch (e) {
      if (e instanceof ConvexError && typeof e.data === "string") return { ok: false, message: e.data };
      throw e;
    }
    const people = await resolvePeople(ctx, org, args);
    if (isFieldError(people)) return { ok: false, field: people.field, message: people.message };

    const units = await scopeUnits(ctx, org, scope);
    const plan = L.planBulkMove(
      units.map((u) => ({ unitId: u._id as string, propertyId: u.propertyId as string, assetManagerUserId: u.assetManagerUserId as string })),
      people.to,
      people.from,
    );
    const nothing = L.nothingToMoveMessage({
      total: plan.total,
      inFilter: plan.inFilter,
      movingCount: plan.moving.length,
      toName: people.toName,
      fromName: people.fromName,
      scopeLabel: scope.label,
    });
    if (nothing) {
      const field: L.BulkField | undefined =
        people.from && plan.inFilter === 0 ? "fromUserId" : plan.total > 0 ? "toUserId" : undefined;
      return { ok: false, field, message: nothing };
    }

    const names = await namesOf(ctx, plan.fromCounts.map((f) => f.userId));
    const from = plan.fromCounts.map((f) => ({ name: names.get(f.userId) ?? "Unknown", count: f.count }));
    const requestsMoving = await openRequestsOn(ctx, org, new Set(plan.moving.map((u) => u.unitId)));
    const leadsMoving = (await openLeadsIn(ctx, scope, new Set(plan.fromCounts.map((f) => f.userId)), people.to)).length;
    const tours = await toursStaying(
      ctx,
      org,
      new Set(scope.properties.map((p) => p._id as string)),
      new Set(plan.fromCounts.map((f) => f.userId)),
      people.to,
    );
    const defaultsSwitching = L.defaultsToSwitch(
      scope.properties.map((p) => ({ propertyId: p._id as string, defaultAssetManagerUserId: p.defaultAssetManagerUserId ?? null })),
      people.to,
      people.from,
    ).length;
    return {
      ok: true,
      sentence: L.previewSentence({
        unitCount: plan.moving.length,
        buildingCount: plan.buildings.length,
        from,
        toName: people.toName,
        requestsMoving,
        leadsMoving,
      }),
      scopeName: scope.name,
      unitCount: plan.moving.length,
      buildingCount: plan.buildings.length,
      from,
      toName: people.toName,
      requestsMoving,
      leadsMoving,
      toursNote: L.toursStayNote(tours),
      defaultsSwitching,
    };
  },
});

// --- Apply --------------------------------------------------------------------------------

/** The admin behind an action-run batch, re-checked in every batch (role may change mid-run). */
async function actorOrg(ctx: QueryCtx, actorUserId: Id<"users">): Promise<OrgContext> {
  const user = await ctx.db.get(actorUserId);
  const membership = user ? await membershipOf(ctx, actorUserId) : null;
  if (!user || !membership) throw new ConvexError("No team found for this account. Try signing in again.");
  const org: OrgContext = {
    orgId: membership.orgId,
    role: membership.role,
    isAdmin: membership.role === "admin",
    jobRoles: membership.jobRoles ?? [],
    user,
  };
  if (!isAdminView(org)) throw new ConvexError("Only admins can do this.");
  return org;
}

function fieldError(e: L.BulkFieldError): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message: e.message, field: e.field });
}

const batchArgs = {
  actorUserId: v.id("users"),
  ...scopeArgs,
  ...personArgs,
  reason: v.string(),
};

/**
 * Who the units are moving away from, and how many open leads they hold in scope. Read once at the
 * start of an apply (before any unit moves) so the lead phase knows its holders. Also rejects a
 * no-op change with the same message as the first unit batch.
 */
export const leadHolders = internalQuery({
  args: batchArgs,
  handler: async (ctx, args): Promise<{ holders: string[]; leads: number }> => {
    const org = await actorOrg(ctx, args.actorUserId);
    const scope = await resolveScope(ctx, org, args);
    const people = await resolvePeople(ctx, org, args);
    if (isFieldError(people)) throw fieldError(people);
    const units = await scopeUnits(ctx, org, scope);
    const plan = L.planBulkMove(
      units.map((u) => ({ unitId: u._id as string, propertyId: u.propertyId as string, assetManagerUserId: u.assetManagerUserId as string })),
      people.to,
      people.from,
    );
    const nothing = L.nothingToMoveMessage({
      total: plan.total,
      inFilter: plan.inFilter,
      movingCount: plan.moving.length,
      toName: people.toName,
      fromName: people.fromName,
      scopeLabel: scope.label,
    });
    if (nothing) throw new ConvexError(nothing);
    const holders = plan.fromCounts.map((f) => f.userId);
    return { holders, leads: (await openLeadsIn(ctx, scope, new Set(holders), people.to)).length };
  },
});

/** Only people on this org, never the new manager, and (for a one-person move) only that person. */
async function checkedHolders(
  ctx: QueryCtx,
  org: OrgContext,
  raw: readonly string[],
  people: People,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of raw) {
    const uid = ctx.db.normalizeId("users", id);
    if (!uid || uid === people.to) continue;
    if (people.from && uid !== people.from) continue;
    const m = await membershipOf(ctx, uid);
    if (m && m.orgId === org.orgId) out.add(uid);
  }
  return out;
}

/**
 * Moves up to one batch of the open leads still left (L.planLeadMove): the assignee becomes the new
 * manager; assignedBy and assignedPropertyId stay as they were. One audit row per lead (the same
 * entity and id as a manual lead assignment, so it shows on the lead's own history).
 */
export const applyLeadBatch = internalMutation({
  args: { ...batchArgs, holders: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ moved: number; remaining: number }> => {
    const org = await actorOrg(ctx, args.actorUserId);
    const scope = await resolveScope(ctx, org, args);
    const people = await resolvePeople(ctx, org, args);
    if (isFieldError(people)) throw fieldError(people);
    const holders = await checkedHolders(ctx, org, args.holders, people);
    const leads = await openLeadsIn(ctx, scope, holders, people.to);
    const batch = leads.slice(0, L.BULK_BATCH_SIZE);
    const now = Date.now();
    const note = `Bulk change (${scope.name}). Reason: ${args.reason}`.slice(0, 2000);
    for (const q of batch) {
      const patch = L.leadMovePatch(q, people.to, now);
      await ctx.db.patch(q._id, {
        assignedUserId: people.to,
        assignedAt: patch.assignedAt,
        assignmentReason: patch.assignmentReason,
        updatedAt: patch.updatedAt,
        ...(patch.leadNotifiedUserId ? { leadNotifiedUserId: people.to } : {}),
      });
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "conversation",
        entityId: q.elevenLabsConversationId,
        action: "lead_reassigned_bulk",
        actorUserId: org.user._id,
        from: q.assignedUserId ? String(q.assignedUserId) : undefined,
        to: String(people.to),
        note,
      });
    }
    return { moved: batch.length, remaining: leads.length - batch.length };
  },
});

/** Moves up to one batch of what is still left. The first batch also rejects a no-op change. */
export const applyBatch = internalMutation({
  args: { ...batchArgs, first: v.boolean() },
  handler: async (ctx, args) => {
    const org = await actorOrg(ctx, args.actorUserId);
    const scope = await resolveScope(ctx, org, args);
    const people = await resolvePeople(ctx, org, args);
    if (isFieldError(people)) throw fieldError(people);

    const units = await scopeUnits(ctx, org, scope);
    const plan = L.planBulkMove(
      units.map((u) => ({ unitId: u._id as string, propertyId: u.propertyId as string, assetManagerUserId: u.assetManagerUserId as string, unit: u })),
      people.to,
      people.from,
    );
    if (args.first) {
      const nothing = L.nothingToMoveMessage({
        total: plan.total,
        inFilter: plan.inFilter,
        movingCount: plan.moving.length,
        toName: people.toName,
        fromName: people.fromName,
        scopeLabel: scope.label,
      });
      if (nothing) throw new ConvexError(nothing);
    }

    const batch = plan.moving.slice(0, L.BULK_BATCH_SIZE);
    const reason = L.bulkUnitReason(args.reason, scope.name);
    const fromCounts = new Map<string, number>();
    const buildings = new Set<string>();
    let requestsMoved = 0;
    let moved = 0;
    for (const row of batch) {
      const res = await reassignUnitInBulk(ctx, org, row.unit, people.to, reason);
      if (!res) continue;
      moved += 1;
      buildings.add(row.propertyId);
      fromCounts.set(res.previousManagerUserId, (fromCounts.get(res.previousManagerUserId) ?? 0) + 1);
      requestsMoved += res.requestsMoved.length;
    }
    return {
      moved,
      remaining: plan.moving.length - moved,
      buildings: [...buildings],
      fromCounts: [...fromCounts.entries()].map(([userId, count]) => ({ userId, count })),
      requestsMoved,
    };
  },
});

/** The one summary audit row, the building defaults, and the one notification. */
export const finishBulk = internalMutation({
  args: {
    ...batchArgs,
    moved: v.number(),
    buildings: v.array(v.string()),
    fromCounts: v.array(v.object({ userId: v.string(), count: v.number() })),
    requestsMoved: v.number(),
    leadsMoved: v.number(),
    partial: v.boolean(),
  },
  handler: async (ctx, args) => {
    const org = await actorOrg(ctx, args.actorUserId);
    const scope = await resolveScope(ctx, org, args);
    const people = await resolvePeople(ctx, org, args);
    if (isFieldError(people)) throw fieldError(people);

    const names = await namesOf(ctx, args.fromCounts.map((f) => f.userId));
    const from = [...args.fromCounts]
      .sort((a, b) => b.count - a.count)
      .map((f) => ({ name: names.get(f.userId) ?? "Unknown", count: f.count }));

    // New units in a building start with its default; after a full move that should be the new
    // manager. Skipped when the run stopped early, so a half-done change never rewrites defaults.
    let defaultsSwitched = 0;
    if (!args.partial) {
      const switching = L.defaultsToSwitch(
        scope.properties.map((p) => ({ propertyId: p._id as string, defaultAssetManagerUserId: p.defaultAssetManagerUserId ?? null, doc: p })),
        people.to,
        people.from,
      );
      for (const s of switching) {
        await ctx.db.patch(s.doc._id, { defaultAssetManagerUserId: people.to, updatedAt: Date.now() });
        await writeAudit(ctx, {
          orgId: org.orgId,
          entity: "property",
          entityId: s.doc._id,
          action: "default_am_set",
          actorUserId: org.user._id,
          from: s.doc.defaultAssetManagerUserId,
          to: people.to,
          note: `Bulk change (${scope.name}). Reason: ${args.reason}`.slice(0, 2000),
        });
        defaultsSwitched += 1;
      }
    }

    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: scope.auditEntity,
      entityId: scope.auditEntityId,
      action: "am_bulk_changed",
      actorUserId: org.user._id,
      from: args.fromCounts.map((f) => f.userId).join(",") || undefined,
      to: people.to,
      note: L.bulkAuditNote({
        scopeLabel: scope.name,
        unitCount: args.moved,
        buildingCount: args.buildings.length,
        from,
        toName: people.toName,
        requestsMoved: args.requestsMoved,
        leadsMoved: args.leadsMoved,
        reason: args.reason,
        partial: args.partial,
      }),
    });

    // One short summary to the new manager (counts and the building/team name only).
    if ((args.moved > 0 || args.leadsMoved > 0) && people.to !== org.user._id) {
      await scheduleNotify(ctx, {
        orgId: org.orgId,
        userIds: [people.to],
        template: "units_reassigned",
        data: {
          units: args.moved,
          leads: args.leadsMoved,
          scope: scope.name,
          by: org.user.firstName || "an admin",
          path: "/asset-managers",
        },
      });
    }

    const tours = await toursStaying(
      ctx,
      org,
      new Set(scope.properties.map((p) => p._id as string)),
      new Set(args.fromCounts.map((f) => f.userId)),
      people.to,
    );
    return { defaultsSwitched, toursNote: L.toursStayNote(tours), from, toName: people.toName, scopeName: scope.name };
  },
});

export type BulkResult = {
  moved: number;
  buildingCount: number;
  requestsMoved: number;
  leadsMoved: number;
  from: Array<{ name: string; count: number }>;
  toName: string;
  scopeName: string;
  defaultsSwitched: number;
  toursNote: string | null;
  batches: number;
};

/**
 * Applies the change in batches: first the open leads (their holders are read from the units that
 * still have to move), then the units. Validation (same messages as the form) happens before
 * anything is written; the first batch rejects a no-op. If a later batch fails, what already moved
 * stays moved (each lead and unit is complete and audited on its own), the summary audit records
 * the partial run, and the error says what moved.
 */
export const apply = action({
  args: { ...scopeArgs, ...personArgs, reason: v.optional(v.string()) },
  handler: async (ctx, args): Promise<BulkResult> => {
    const me = await requireAdminViewId(ctx);
    const problems = L.validateBulkInput({ toUserId: args.toUserId, reason: args.reason, fromUserId: args.fromUserId });
    if (problems.length > 0) throw fieldError(problems[0]);
    const base = {
      actorUserId: me.userId,
      team: args.team,
      propertyId: args.propertyId,
      toUserId: args.toUserId,
      fromUserId: args.fromUserId,
      reason: L.cleanReason(args.reason),
    };

    // Nothing is written yet: a no-op or a bad field is thrown as the plain validation message.
    const plan = await ctx.runQuery(internal.bulkReassign.leadHolders, base);

    let moved = 0;
    let requestsMoved = 0;
    let leadsMoved = 0;
    const buildings = new Set<string>();
    const fromCounts = new Map<string, number>();
    let batches = 0;
    let failure: unknown = null;
    let remaining = 0;
    let leadsRemaining = 0;

    // Leads first. Bounded by what the first read says: leads can't appear faster than this plan.
    if (plan.leads > 0) {
      const leadLimit = L.batchCount(plan.leads) + 2;
      for (let n = 0; n < leadLimit; n++) {
        let res;
        try {
          res = await ctx.runMutation(internal.bulkReassign.applyLeadBatch, { ...base, holders: plan.holders });
        } catch (e) {
          if (leadsMoved === 0) throw e; // nothing written yet: just the validation message
          failure = e;
          break;
        }
        leadsMoved += res.moved;
        leadsRemaining = res.remaining;
        if (res.remaining === 0 || res.moved === 0) break;
      }
    }

    let limit = Infinity;
    while (failure === null && batches < limit) {
      let res;
      try {
        res = await ctx.runMutation(internal.bulkReassign.applyBatch, { ...base, first: batches === 0 });
      } catch (e) {
        if (batches === 0 && leadsMoved === 0) throw e; // nothing written yet: just the validation message
        failure = e;
        break;
      }
      batches += 1;
      // Bound the loop by the first answer: units can't appear faster than this plan allows.
      if (batches === 1) limit = L.batchCount(res.moved + res.remaining) + 2;
      moved += res.moved;
      remaining = res.remaining;
      requestsMoved += res.requestsMoved;
      for (const b of res.buildings) buildings.add(b);
      for (const f of res.fromCounts) fromCounts.set(f.userId, (fromCounts.get(f.userId) ?? 0) + f.count);
      if (res.remaining === 0 || res.moved === 0) break;
    }

    const partial = failure !== null || remaining > 0 || leadsRemaining > 0;
    const summary = await ctx.runMutation(internal.bulkReassign.finishBulk, {
      ...base,
      moved,
      buildings: [...buildings],
      fromCounts: [...fromCounts.entries()].map(([userId, count]) => ({ userId, count })),
      requestsMoved,
      leadsMoved,
      partial,
    });
    if (partial) {
      const leadsPart = leadsMoved > 0 ? ` and ${leadsMoved} open lead${leadsMoved === 1 ? "" : "s"}` : "";
      throw new ConvexError(
        `Stopped after moving ${moved} unit${moved === 1 ? "" : "s"}${leadsPart}; those changes are saved. Open the preview again to move the rest.`,
      );
    }
    return {
      moved,
      buildingCount: buildings.size,
      requestsMoved,
      leadsMoved,
      from: summary.from,
      toName: summary.toName,
      scopeName: summary.scopeName,
      defaultsSwitched: summary.defaultsSwitched,
      toursNote: summary.toursNote,
      batches,
    };
  },
});
