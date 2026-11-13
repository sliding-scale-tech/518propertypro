import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, isAdminView, requireAdminView, type OrgContext } from "./authz";
import {
  TOUR_TEAMS,
  TOUR_TEAM_LABEL,
  calendarState,
  defaultTourStaff,
  isTourTeam,
  resolveTourStaff,
  tourStaffWarning,
  type TourTeam,
} from "./tourStaffLib";

/**
 * Who gives tours for each property team (B40). The rules are in tourStaffLib.ts (pure, tested);
 * this file reads and writes the tourStaff table. Booking reads the list through tourStaffFor
 * (tours.bookingContext); admins manage it in Team → Lead routing → Tour staff.
 */

type Ctx = QueryCtx | MutationCtx;

function nameOf(user: Doc<"users"> | null): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email || "Unknown";
}

async function savedRow(ctx: Ctx, orgId: string, team: TourTeam) {
  return ctx.db
    .query("tourStaff")
    .withIndex("by_org_and_category", (q) => q.eq("orgId", orgId).eq("category", team))
    .unique();
}

/** The asset managers of a team's units, one entry per unit. */
async function teamUnitManagers(ctx: Ctx, orgId: string, team: TourTeam): Promise<string[]> {
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_org_and_category", (q) => q.eq("orgId", orgId).eq("category", team))
    .collect();
  const ids: string[] = [];
  for (const property of properties) {
    const units = await ctx.db
      .query("units")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect();
    for (const unit of units) if (unit.orgId === orgId) ids.push(unit.assetManagerUserId);
  }
  return ids;
}

async function orgMembers(ctx: Ctx, orgId: string): Promise<Doc<"memberships">[]> {
  const id = ctx.db.normalizeId("organizations", orgId);
  if (!id) return [];
  return ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", id))
    .collect();
}

/**
 * A team's tour list: the saved one, or the default (the team's asset managers). Only current members
 * of the org, each once. `memberships` may be passed when the caller already has them.
 */
export async function tourStaffFor(
  ctx: Ctx,
  orgId: string,
  team: TourTeam,
  memberships?: ReadonlyArray<{ userId: Id<"users"> }>,
): Promise<{ userIds: Id<"users">[]; isDefault: boolean }> {
  const members = memberships ?? (await orgMembers(ctx, orgId));
  const memberIds = new Set<string>(members.map((m) => m.userId));
  const row = await savedRow(ctx, orgId, team);
  const defaults = row ? [] : defaultTourStaff(await teamUnitManagers(ctx, orgId, team), memberIds);
  const resolved = resolveTourStaff(row ? row.userIds : null, defaults, memberIds);
  return { userIds: resolved.userIds as Id<"users">[], isDefault: resolved.isDefault };
}

// --- Team → Lead routing → Tour staff---------------------------------------------------

/**
 * Per team: the people on its tour list (name, email, calendar and tour status), whether it is the
 * default, and the org's members who could be added. Admins only; null for anyone else.
 */
export const listForSettings = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org || !isAdminView(org)) return null;
    const orgId = String(org.orgId);

    const memberships = await orgMembers(ctx, orgId);
    const now = Date.now();
    const people = new Map<
      string,
      {
        userId: Id<"users">;
        name: string;
        email: string | null;
        calendar: ReturnType<typeof calendarState>;
        takingTours: boolean;
        outOfOffice: boolean;
      }
    >();
    for (const m of memberships) {
      const [user, connection, hours] = await Promise.all([
        ctx.db.get(m.userId),
        ctx.db
          .query("googleCalendarConnections")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .unique(),
        ctx.db
          .query("tourAvailability")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .unique(),
      ]);
      people.set(m.userId, {
        userId: m.userId,
        name: nameOf(user),
        email: user?.email ?? null,
        calendar: calendarState(connection),
        takingTours: hours?.availableForTours ?? true,
        outOfOffice: m.unavailableUntil !== undefined && m.unavailableUntil > now,
      });
    }

    const teams = [];
    for (const team of TOUR_TEAMS) {
      const staff = await tourStaffFor(ctx, orgId, team, memberships);
      const buildings = (
        await ctx.db
          .query("properties")
          .withIndex("by_org_and_category", (q) => q.eq("orgId", orgId).eq("category", team))
          .collect()
      ).length;
      const list = staff.userIds.flatMap((id) => {
        const p = people.get(id);
        return p ? [p] : [];
      });
      teams.push({
        category: team,
        label: TOUR_TEAM_LABEL[team],
        buildings,
        isDefault: staff.isDefault,
        people: list,
        warning: tourStaffWarning(team, list),
      });
    }

    const members = [...people.values()]
      .map((p) => ({ userId: p.userId, name: p.name, email: p.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { teams, members };
  },
});

/** The team from a client-sent string, with a specific message when it is not one of the three. */
function teamArg(category: unknown): TourTeam {
  if (typeof category !== "string" || category.trim() === "") throw new ConvexError("Choose a team: Gold, Silver or Make Up.");
  if (!isTourTeam(category)) throw new ConvexError("That team does not exist. Choose Gold, Silver or Make Up.");
  return category;
}

/** A person id from the client: present, a real user, and a member of this org. */
async function memberArg(ctx: MutationCtx, org: OrgContext, userId: unknown, team: TourTeam): Promise<Doc<"users">> {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new ConvexError({ message: "Choose a person to add.", field: "person" });
  }
  const id = ctx.db.normalizeId("users", userId);
  const user = id ? await ctx.db.get(id) : null;
  const membership = user
    ? await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first()
    : null;
  if (!user || !membership || membership.orgId !== org.orgId) {
    throw new ConvexError({
      message: `That person is not a member of this team, so they cannot give ${TOUR_TEAM_LABEL[team]} tours.`,
      field: "person",
    });
  }
  return user;
}

async function namesOf(ctx: MutationCtx, ids: ReadonlyArray<Id<"users">>): Promise<string> {
  if (ids.length === 0) return "(nobody)";
  const names = await Promise.all(ids.map(async (id) => nameOf(await ctx.db.get(id))));
  return names.join(", ");
}

/** Saves a team's list (replacing the default if it was in use) and records it in the audit log. */
async function saveList(
  ctx: MutationCtx,
  org: OrgContext,
  team: TourTeam,
  before: Id<"users">[],
  next: Id<"users">[],
  action: string,
  note?: string,
): Promise<void> {
  const orgId = String(org.orgId);
  const row = await savedRow(ctx, orgId, team);
  const now = Date.now();
  if (row) await ctx.db.patch(row._id, { userIds: next, updatedAt: now, updatedBy: org.user._id });
  else await ctx.db.insert("tourStaff", { orgId, category: team, userIds: next, updatedAt: now, updatedBy: org.user._id });
  await writeAudit(ctx, {
    orgId,
    entity: "config",
    entityId: `tour_staff:${team}`,
    action,
    actorUserId: org.user._id,
    from: await namesOf(ctx, before),
    to: await namesOf(ctx, next),
    note,
  });
}

/** Adds one org member to a team's tour list. */
export const addPerson = mutation({
  args: { category: v.optional(v.string()), userId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const team = teamArg(args.category);
    const user = await memberArg(ctx, org, args.userId, team);
    const current = await tourStaffFor(ctx, String(org.orgId), team);
    if (current.userIds.includes(user._id)) {
      throw new ConvexError({
        message: `${nameOf(user)} is already on the ${TOUR_TEAM_LABEL[team]} tour list.`,
        field: "person",
      });
    }
    await saveList(ctx, org, team, current.userIds, [...current.userIds, user._id], "tour_staff_added", nameOf(user));
  },
});

/** Removes one person from a team's tour list. An empty list is allowed (Sarah then takes a preferred time). */
export const removePerson = mutation({
  args: { category: v.optional(v.string()), userId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const team = teamArg(args.category);
    if (typeof args.userId !== "string" || args.userId.trim() === "") {
      throw new ConvexError("Choose the person to remove.");
    }
    const current = await tourStaffFor(ctx, String(org.orgId), team);
    const id = ctx.db.normalizeId("users", args.userId);
    if (!id || !current.userIds.includes(id)) {
      throw new ConvexError(`That person is not on the ${TOUR_TEAM_LABEL[team]} tour list.`);
    }
    const user = await ctx.db.get(id);
    await saveList(ctx, org, team, current.userIds, current.userIds.filter((u) => u !== id), "tour_staff_removed", nameOf(user));
  },
});

/** Replaces a team's whole tour list. Every person must be a member of this org; duplicates are dropped. */
export const setForTeam = mutation({
  args: { category: v.optional(v.string()), userIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const team = teamArg(args.category);
    if (!Array.isArray(args.userIds)) throw new ConvexError("Send the list of people (it may be empty).");
    const next: Id<"users">[] = [];
    for (const raw of args.userIds) {
      const user = await memberArg(ctx, org, raw, team);
      if (!next.includes(user._id)) next.push(user._id);
    }
    const current = await tourStaffFor(ctx, String(org.orgId), team);
    await saveList(ctx, org, team, current.userIds, next, "tour_staff_set");
  },
});

/** Goes back to the default list (the team's asset managers) by deleting the saved one. */
export const resetToDefault = mutation({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const team = teamArg(args.category);
    const orgId = String(org.orgId);
    const row = await savedRow(ctx, orgId, team);
    if (!row) throw new ConvexError(`${TOUR_TEAM_LABEL[team]} is already using the default list.`);
    const before = await tourStaffFor(ctx, orgId, team);
    await ctx.db.delete(row._id);
    const after = await tourStaffFor(ctx, orgId, team);
    await writeAudit(ctx, {
      orgId,
      entity: "config",
      entityId: `tour_staff:${team}`,
      action: "tour_staff_reset",
      actorUserId: org.user._id,
      from: await namesOf(ctx, before.userIds),
      to: await namesOf(ctx, after.userIds),
    });
  },
});
