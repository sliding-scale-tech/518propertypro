import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PROPERTY_DOC_TITLE } from "./docs";

/**
 * Moves teams out of Clerk and into this database.
 *
 * Clerk organizations were the source of truth for about an hour; every data row carries the
 * Clerk org id it was stamped with. This creates the equivalent Convex organization and
 * membership rows, then rewrites each data row's `orgId` from the Clerk id to the new Convex
 * one, so `orgId` can become a real `v.id("organizations")` reference afterwards.
 *
 * Idempotent by mapping: a row whose orgId is not a key in `mapping` is left alone, so a
 * second pass finds nothing to do rather than double-writing.
 */
export const importFromClerk = internalMutation({
  args: {
    teams: v.array(
      v.object({
        clerkOrgId: v.string(),
        name: v.string(),
        // Clerk user ids of the members, with the admin flagged.
        members: v.array(v.object({ clerkUserId: v.string(), role: v.union(v.literal("admin"), v.literal("member")) })),
      }),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const mapping = new Map<string, Id<"organizations">>();
    const created: Array<{ name: string; orgId: string; members: number }> = [];
    const problems: string[] = [];

    for (const team of args.teams) {
      const resolved: Array<{ userId: Id<"users">; role: "admin" | "member" }> = [];
      for (const member of team.members) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", member.clerkUserId))
          .unique();
        if (!user) {
          problems.push(`${team.name}: no Convex user for ${member.clerkUserId}`);
          continue;
        }
        resolved.push({ userId: user._id, role: member.role });
      }

      const admin = resolved.find((r) => r.role === "admin") ?? resolved[0];
      if (!admin) {
        problems.push(`${team.name}: no resolvable members, skipped`);
        continue;
      }

      // An org already imported under this name+creator would duplicate on a re-run, so reuse
      // it instead. Cheap because this table is tiny and only ever read here.
      const existing = (await ctx.db.query("organizations").collect()).find(
        (o) => o.name === team.name && o.createdBy === admin.userId,
      );

      const orgId =
        existing?._id ??
        (args.dryRun
          ? ("dry_run" as unknown as Id<"organizations">)
          : await ctx.db.insert("organizations", {
              name: team.name,
              createdBy: admin.userId,
              createdAt: now,
              updatedAt: now,
            }));

      if (!args.dryRun) {
        for (const member of resolved) {
          const alreadyMember = await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", member.userId))
            .first();
          if (alreadyMember) continue;
          await ctx.db.insert("memberships", {
            orgId,
            userId: member.userId,
            role: member.role,
            createdAt: now,
          });
        }
      }

      mapping.set(team.clerkOrgId, orgId);
      created.push({ name: team.name, orgId: String(orgId), members: resolved.length });
    }

    // --- rewrite orgId on every data row ---------------------------------
    const owned = [
      "agents",
      "docs",
      "properties",
      "screeningQuestions",
      "screeningBuiltins",
      "conversations",
      "tenantIssues",
    ] as const;

    const rewritten: Record<string, number> = {};
    for (const table of owned) {
      const rows = await ctx.db.query(table).collect();
      let count = 0;
      for (const row of rows) {
        const current = (row as { orgId?: string }).orgId;
        if (!current) continue;
        const next = mapping.get(current);
        if (!next) continue; // already a Convex id, or an org we were not given
        if (!args.dryRun) await ctx.db.patch(row._id, { orgId: next } as never);
        count += 1;
      }
      if (count) rewritten[table] = count;
    }

    return {
      dryRun: Boolean(args.dryRun),
      teams: created,
      rewritten,
      totalRewritten: Object.values(rewritten).reduce((a, b) => a + b, 0),
      problems,
    };
  },
});

/** What is still unstamped, per table. Run after a migration to prove nothing was missed. */
export const audit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "agents",
      "docs",
      "properties",
      "screeningQuestions",
      "screeningBuiltins",
      "conversations",
      "tenantIssues",
    ] as const;

    const orgIds = new Set((await ctx.db.query("organizations").collect()).map((o) => String(o._id)));
    const out: Record<string, { total: number; missing: number; notConvexOrg: number }> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      out[table] = {
        total: rows.length,
        missing: rows.filter((r) => !(r as { orgId?: string }).orgId).length,
        notConvexOrg: rows.filter((r) => {
          const id = (r as { orgId?: string }).orgId;
          return Boolean(id) && !orgIds.has(String(id));
        }).length,
      };
    }
    return {
      organizations: orgIds.size,
      memberships: (await ctx.db.query("memberships").collect()).length,
      tables: out,
    };
  },
});

// --- Setup backfill -------------------------------------------------------

/**
 * Gap between agent setups started by backfillSetup. Each one creates an ElevenLabs agent and
 * indexes several docs; starting them all at once is how a backfill runs into rate limits.
 */
const BACKFILL_STAGGER_MS = 5_000;

/**
 * Who predates sign-up setting teams up, and what each of them is missing.
 *
 * - usersWithoutTeam: no membership and no live invite. A live invite is left alone — that
 *   person should join the inviting team, not get one of their own.
 * - needsAgent: a team with no agent. agents.ensure gives it property, knowledge and agent.
 * - needsKnowledge: a team with an agent but no knowledge besides the auto-generated property
 *   doc — what the property-doc race left behind. This cannot tell that apart from a team that
 *   deliberately deleted every doc, which is why backfillSetup dry-runs by default.
 * - skipped: teams with no admin to own the setup.
 */
export const setupPlan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const users = await ctx.db.query("users").collect();
    const memberships = await ctx.db.query("memberships").collect();
    const invites = await ctx.db.query("invites").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const agents = await ctx.db.query("agents").collect();
    const docs = await ctx.db.query("docs").collect();

    const memberUserIds = new Set(memberships.map((m) => String(m.userId)));
    const invitedEmails = new Set(
      invites
        .filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > now)
        .map((i) => i.email),
    );
    const usersWithoutTeam = users
      .filter(
        (u) =>
          !memberUserIds.has(String(u._id)) &&
          !(u.email && invitedEmails.has(u.email.toLowerCase())),
      )
      .map((u) => ({ userId: u._id, email: u.email ?? null }));

    const orgsWithAgent = new Set(agents.map((a) => a.orgId));
    const orgsWithKnowledge = new Set(
      docs.filter((d) => d.title !== PROPERTY_DOC_TITLE).map((d) => d.orgId),
    );

    const needsAgent: Array<{ orgId: string; name: string; userId: Id<"users"> }> = [];
    const needsKnowledge: Array<{ orgId: string; name: string; userId: Id<"users"> }> = [];
    const skipped: Array<{ orgId: string; name: string; reason: string }> = [];

    for (const org of orgs) {
      const orgId = String(org._id);
      const admin = memberships.find((m) => String(m.orgId) === orgId && m.role === "admin");
      if (!admin) {
        skipped.push({ orgId, name: org.name, reason: "no admin member" });
        continue;
      }
      if (!orgsWithAgent.has(orgId)) {
        needsAgent.push({ orgId, name: org.name, userId: admin.userId });
      } else if (!orgsWithKnowledge.has(orgId)) {
        needsKnowledge.push({ orgId, name: org.name, userId: admin.userId });
      }
    }

    return { usersWithoutTeam, needsAgent, needsKnowledge, skipped };
  },
});

/**
 * Brings accounts that existed before sign-up set teams up to the same state a new sign-up gets.
 *
 * Dry-run by default — it lists who would be touched and changes nothing. Review the list, then:
 *   npx convex run orgMigration:backfillSetup                       (dry run)
 *   npx convex run orgMigration:backfillSetup '{"dryRun":false}'    (apply)
 *
 * Safe to re-run: every step is the same idempotent path sign-up uses. ensureTeamForUser skips
 * anyone who already has a team, agents.ensure claims the team first so overlapping runs cannot
 * create two agents, and cloneDefaultsForOrg skips a team that already has knowledge.
 */
export const backfillSetup = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<unknown> => {
    const plan = await ctx.runQuery(internal.orgMigration.setupPlan, {});
    if (args.dryRun !== false) return { dryRun: true, ...plan };

    // Creates the team, and schedules its setup in the same mutation.
    for (const user of plan.usersWithoutTeam) {
      await ctx.runMutation(internal.team.ensureTeamForUser, { userId: user.userId });
    }

    for (const [index, org] of plan.needsAgent.entries()) {
      await ctx.scheduler.runAfter(index * BACKFILL_STAGGER_MS, internal.agents.ensure, {
        orgId: org.orgId,
        userId: org.userId,
      });
    }

    // Each seeded doc indexes on its own and attaches to the existing agent when it finishes
    // (docs.pollRagIndex → agents.pushKnowledgeBase), so nothing else is needed here.
    for (const org of plan.needsKnowledge) {
      await ctx.runMutation(internal.docs.cloneDefaultsForOrg, {
        orgId: org.orgId,
        userId: org.userId,
      });
    }

    return {
      teamsCreatedFor: plan.usersWithoutTeam.map((u) => u.email ?? u.userId),
      setupScheduledFor: plan.needsAgent.map((o) => o.name),
      knowledgeSeededFor: plan.needsKnowledge.map((o) => o.name),
      skipped: plan.skipped,
    };
  },
});

// --- Sarah rename + default doc cleanup ------------------------------------

/**
 * The old default-doc wording, fixed. Applied to existing docs by applySarahCleanup so teams
 * seeded before the cleanup match what DEFAULT_DOCS now seeds. Exact-phrase replacements only,
 * so a doc a team has rewritten is left as they wrote it.
 */
function cleanDocTitle(title: string): string {
  return title === "sqyards" ? "Unit sizes" : renameSara(title);
}

function cleanDocBody(body: string): string {
  return renameSara(
    body
      .replace(
        "5br: approx. 2000-2200 sq ft (estimate, not sourced market data, for testing purposes)",
        "5br: approx. 2000-2200 sq ft",
      )
      .replace(
        "9am to 5pm Monday through Friday, UK time.",
        "9am to 5pm Monday through Friday, local time.",
      ),
  );
}

/** Whole word only, so nothing like "Sarah" or "Saratoga" is touched. */
function renameSara(text: string): string {
  return text.replace(/\bSara\b/g, "Sarah");
}

/** Every agent and doc whose stored text still has the old name or old default wording. */
export const sarahCleanupPlan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = (await ctx.db.query("agents").collect())
      .map((a) => ({
        agentId: a._id,
        orgId: a.orgId,
        name: renameSara(a.name),
        prompt: renameSara(a.prompt),
        firstMessage: renameSara(a.firstMessage),
        changed:
          renameSara(a.name) !== a.name ||
          renameSara(a.prompt) !== a.prompt ||
          renameSara(a.firstMessage) !== a.firstMessage,
        oldName: a.name,
      }))
      .filter((a) => a.changed);

    const docs = (await ctx.db.query("docs").collect())
      .map((d) => ({
        docId: d._id,
        orgId: d.orgId,
        oldTitle: d.title,
        title: cleanDocTitle(d.title),
        body: cleanDocBody(d.body),
        changed: cleanDocTitle(d.title) !== d.title || cleanDocBody(d.body) !== d.body,
      }))
      .filter((d) => d.changed);

    return { agents, docs };
  },
});

export const patchAgentText = internalMutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    prompt: v.string(),
    firstMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      name: args.name,
      prompt: args.prompt,
      firstMessage: args.firstMessage,
      updatedAt: Date.now(),
    });
  },
});

/** Same row change docs.save makes for an edit, minus the scheduling — the caller syncs it. */
export const patchDocText = internalMutation({
  args: { docId: v.id("docs"), title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.docId, {
      title: args.title,
      body: args.body,
      syncState: "pending",
      syncError: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Longest one doc is waited on before moving to the next. pollRagIndex itself gives up at ~40s. */
const DOC_SYNC_WAIT_MS = 90_000;

/**
 * Extra wait after a doc reads synced. pollRagIndex marks it synced *before* its
 * pushKnowledgeBase call, so moving on the moment it flips let the next doc delete its old
 * ElevenLabs copy mid-push — the push then 404'd and marked the finished doc failed.
 */
const DOC_PUSH_SETTLE_MS = 8_000;

/**
 * Renames the agent to Sarah (name, prompt, first message) on every team, on ElevenLabs too, and
 * fixes the old default-doc wording in existing knowledge bases.
 *
 * Dry-run by default:
 *   npx convex run orgMigration:applySarahCleanup                     (dry run)
 *   npx convex run orgMigration:applySarahCleanup '{"dryRun":false}'  (apply)
 *
 * Agents first, while every doc still points at a live ElevenLabs document. Then docs strictly
 * one at a time, each waited on until it is Live and its push to the agent has finished:
 * re-syncing a doc deletes its old ElevenLabs copy before the new one exists, and a push still
 * running from the previous doc would attach that deleted copy to the agent and fail. Safe to re-run — a
 * second pass finds nothing left to change.
 */
export const applySarahCleanup = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<unknown> => {
    const plan = await ctx.runQuery(internal.orgMigration.sarahCleanupPlan, {});
    if (args.dryRun !== false) {
      return {
        dryRun: true,
        agents: plan.agents.map((a) => ({ orgId: a.orgId, from: a.oldName, to: a.name })),
        docs: plan.docs.map((d) => ({ orgId: d.orgId, from: d.oldTitle, to: d.title })),
      };
    }

    const agentResults: Array<{ orgId: string; name: string; error?: string }> = [];
    for (const agent of plan.agents) {
      await ctx.runMutation(internal.orgMigration.patchAgentText, {
        agentId: agent.agentId,
        name: agent.name,
        prompt: agent.prompt,
        firstMessage: agent.firstMessage,
      });
      try {
        await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: agent.orgId });
        agentResults.push({ orgId: agent.orgId, name: agent.name });
      } catch (err) {
        agentResults.push({
          orgId: agent.orgId,
          name: agent.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const docResults: Array<{ orgId: string; title: string; syncState: string; error?: string }> = [];
    for (const doc of plan.docs) {
      await ctx.runMutation(internal.orgMigration.patchDocText, {
        docId: doc.docId,
        title: doc.title,
        body: doc.body,
      });
      await ctx.runAction(internal.docs.syncDoc, { docId: doc.docId });

      const deadline = Date.now() + DOC_SYNC_WAIT_MS;
      let row = await ctx.runQuery(internal.docs.getInternal, { docId: doc.docId });
      while (row && row.syncState !== "synced" && row.syncState !== "failed" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        row = await ctx.runQuery(internal.docs.getInternal, { docId: doc.docId });
      }
      if (row?.syncState === "synced") {
        await new Promise((resolve) => setTimeout(resolve, DOC_PUSH_SETTLE_MS));
        row = await ctx.runQuery(internal.docs.getInternal, { docId: doc.docId });
      }
      docResults.push({
        orgId: doc.orgId,
        title: doc.title,
        syncState: row?.syncState ?? "missing",
        error: row?.syncError,
      });
    }

    return { agents: agentResults, docs: docResults };
  },
});
