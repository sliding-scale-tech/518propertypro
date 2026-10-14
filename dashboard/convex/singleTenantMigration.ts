import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantOrgId } from "./authz";
import { promoteIfNoAdmin } from "./team";

// orgId-stamped tables that hold people/activity data — these follow everyone into the tenant.
// Deliberately NOT agents, docs, properties, screeningQuestions, screeningBuiltins: those are a
// team's configuration and its ElevenLabs agent/KB. The tenant keeps its own; the other teams'
// rows are left in place, unread (every query scopes by the tenant's orgId) and never deleted,
// so nothing on ElevenLabs is orphaned or touched.
const PEOPLE_DATA = ["conversations", "tenantIssues", "tasks", "taskAttachments", "tours"] as const;

const isLive = (i: { acceptedAt?: number; revokedAt?: number; expiresAt: number }, now: number) =>
  !i.acceptedAt && !i.revokedAt && i.expiresAt > now;

/** Read-only report of what consolidate would change. */
export const check = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const tenant = await tenantOrgId(ctx);
    if (!tenant) return { error: "no organization exists" };

    const orgs = await ctx.db.query("organizations").collect();
    const memberships = await ctx.db.query("memberships").collect();
    const users = await ctx.db.query("users").collect();
    const invites = await ctx.db.query("invites").collect();

    const memberUserIds = new Set(memberships.map((m) => String(m.userId)));
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const peopleElsewhere: Record<string, number> = {};
    for (const table of PEOPLE_DATA) {
      const rows = await ctx.db.query(table).collect();
      peopleElsewhere[table] = rows.filter((r) => {
        const o = (r as { orgId?: string }).orgId;
        return Boolean(o) && String(o) !== String(tenant);
      }).length;
    }

    return {
      tenant: { id: tenant, name: (await ctx.db.get(tenant))?.name },
      orgCount: orgs.length,
      membershipsElsewhere: memberships
        .filter((m) => String(m.orgId) !== String(tenant))
        .map((m) => ({ email: userById.get(String(m.userId))?.email ?? null, role: m.role })),
      usersWithoutMembership: users
        .filter((u) => !memberUserIds.has(String(u._id)))
        .map((u) => u.email ?? null),
      liveInvitesElsewhere: invites.filter(
        (i) => isLive(i, now) && String(i.orgId) !== String(tenant),
      ).length,
      peopleDataElsewhere: peopleElsewhere,
      tenantAdmins: memberships
        .filter((m) => String(m.orgId) === String(tenant) && m.role === "admin")
        .map((m) => userById.get(String(m.userId))?.email ?? null),
    };
  },
});

/**
 * Makes `email` the tenant's only admin; everyone else becomes a member. Dev tool for handing
 * the team over — promotes first, so the team never has zero admins.
 *
 *   npx convex run singleTenantMigration:setTeamLead '{"email":"someone@example.com"}'
 */
export const setTeamLead = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const tenant = await tenantOrgId(ctx);
    if (!tenant) return { error: "no organization exists" };
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    if (!user) return { error: `no user with email ${args.email}` };

    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", tenant))
      .collect();
    const lead = members.find((m) => String(m.userId) === String(user._id));
    if (!lead) return { error: "that user is not on the team" };

    await ctx.db.patch(lead._id, { role: "admin" });
    const demoted: Array<string | null> = [];
    for (const m of members) {
      if (m._id === lead._id || m.role !== "admin") continue;
      await ctx.db.patch(m._id, { role: "member" });
      demoted.push((await ctx.db.get(m.userId))?.email ?? null);
    }
    return { teamLead: user.email, demoted };
  },
});

/**
 * Collapses every team into the tenant. Dry run unless `dryRun: false`.
 * No scheduler, no actions, no ElevenLabs calls — Convex rows only.
 *
 *   npx convex run singleTenantMigration:consolidate                       (dry run)
 *   npx convex run singleTenantMigration:consolidate '{"dryRun":false}'    (apply)
 */
export const consolidate = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const apply = args.dryRun === false;
    const now = Date.now();
    const tenant = await tenantOrgId(ctx);
    if (!tenant) return { error: "no organization exists" };

    const demoted: Array<string | null> = [];
    let membershipsMoved = 0;
    let membershipsAdded = 0;
    let invitesMoved = 0;
    const rewritten: Record<string, number> = {};

    // Memberships elsewhere move in; other teams' admins become members.
    const memberships = await ctx.db.query("memberships").collect();
    for (const m of memberships) {
      if (String(m.orgId) === String(tenant)) continue;
      if (m.role === "admin") demoted.push((await ctx.db.get(m.userId))?.email ?? null);
      membershipsMoved += 1;
      if (apply) await ctx.db.patch(m._id, { orgId: tenant, role: "member" });
    }

    // Users with no membership join as members, unless a live invite will place them.
    const memberUserIds = new Set(memberships.map((m) => String(m.userId)));
    const invites = await ctx.db.query("invites").collect();
    const invitedEmails = new Set(invites.filter((i) => isLive(i, now)).map((i) => i.email));
    for (const u of await ctx.db.query("users").collect()) {
      if (memberUserIds.has(String(u._id))) continue;
      if (u.email && invitedEmails.has(u.email.toLowerCase())) continue;
      membershipsAdded += 1;
      if (apply) {
        await ctx.db.insert("memberships", {
          orgId: tenant,
          userId: u._id,
          role: "member",
          createdAt: now,
        });
      }
    }

    for (const i of invites) {
      if (!isLive(i, now) || String(i.orgId) === String(tenant)) continue;
      invitesMoved += 1;
      if (apply) await ctx.db.patch(i._id, { orgId: tenant });
    }

    // Rows with no orgId (demo calls) are left alone; the post-call webhook backfills them.
    for (const table of PEOPLE_DATA) {
      let count = 0;
      for (const row of await ctx.db.query(table).collect()) {
        const o = (row as { orgId?: string }).orgId;
        if (!o || String(o) === String(tenant)) continue;
        count += 1;
        if (apply) await ctx.db.patch(row._id, { orgId: tenant } as never);
      }
      if (count) rewritten[table] = count;
    }

    if (apply) await promoteIfNoAdmin(ctx, tenant);

    return {
      dryRun: !apply,
      tenant: String(tenant),
      membershipsMoved,
      membershipsAdded,
      invitesMoved,
      rewritten,
      demotedAdmins: demoted,
    };
  },
});
