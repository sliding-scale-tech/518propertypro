import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { leaseFollowUpTitle, selectLeaseFollowUps, teamToday } from "./leaseLib";

/**
 * B44 lease-ended follow-up. Once a day (crons.ts) this walks every resident in batches and, for
 * each ACTIVE resident whose lease end has passed (team date), who is not marked month-to-month and
 * who has no open follow-up yet, creates ONE task for the unit's asset manager:
 *   "Lease for Unit 2B at 1635 Van Vranken Ave ended on Nov 30. Renewed, moving out, or month-to-month?"
 *
 * Idempotent: a resident with an open follow-up (tasks.by_resident, status != completed) is
 * skipped, so re-runs and overlapping batches are no-ops. It never moves anyone out or changes a
 * lease; only a person resolves it (leases.ts: Renewed / Moving out / Month-to-month), and every
 * resolution closes the task. No text message is sent (texting is off except emergency alerts).
 */

const BATCH = 100;

type Ctx = QueryCtx | MutationCtx;

/** The resident's open lease follow-up tasks (normally 0 or 1). */
export async function openLeaseFollowUps(ctx: Ctx, residentId: Id<"residents">): Promise<Doc<"tasks">[]> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_resident", (q) => q.eq("residentId", residentId))
    .collect();
  return rows.filter((t) => t.kind === "lease_follow_up" && t.status !== "completed");
}

/**
 * Closes the resident's open follow-ups (a resolution, a move-out, a lease end edit). Audited on
 * the resident with the resolution. Returns how many were closed.
 */
export async function closeLeaseFollowUps(
  ctx: MutationCtx,
  resident: Pick<Doc<"residents">, "_id" | "orgId">,
  resolution: string,
  actorUserId?: Id<"users">,
): Promise<number> {
  const open = (await openLeaseFollowUps(ctx, resident._id)).filter((t) => t.orgId === resident.orgId);
  const now = Date.now();
  for (const t of open) await ctx.db.patch(t._id, { status: "completed", updatedAt: now });
  if (open.length > 0) {
    await writeAudit(ctx, {
      orgId: resident.orgId,
      entity: "resident",
      entityId: resident._id,
      action: "lease_follow_up_closed",
      actorUserId,
      note: resolution,
    });
  }
  return open.length;
}

/** Team date per org, cached for one batch. */
async function todayFor(ctx: Ctx, cache: Map<string, string>, orgId: string, now: number): Promise<string> {
  let today = cache.get(orgId);
  if (today === undefined) {
    const id = ctx.db.normalizeId("organizations", orgId);
    const org = id ? await ctx.db.get(id) : null;
    today = teamToday(now, org?.timeZone);
    cache.set(orgId, today);
  }
  return today;
}

/** Candidates of one batch: past-lease active residents with no open follow-up. */
async function candidates(ctx: Ctx, rows: Doc<"residents">[], now: number) {
  const todays = new Map<string, string>();
  const out: Array<{ resident: Doc<"residents">; today: string }> = [];
  for (const r of rows) {
    if (!r.active || !r.leaseEnd || r.leaseStatus === "month_to_month") continue; // cheap pre-filter
    const today = await todayFor(ctx, todays, r.orgId, now);
    const open = new Set<string>();
    if ((await openLeaseFollowUps(ctx, r._id)).length > 0) open.add(r._id);
    for (const picked of selectLeaseFollowUps([r], today, open)) out.push({ resident: picked, today });
  }
  return out;
}

/** One batch of the daily job; schedules the next batch until the table is done. */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ created: number; isDone: boolean }> => {
    const now = Date.now();
    const page = await ctx.db.query("residents").paginate({ cursor: args.cursor ?? null, numItems: BATCH });
    let created = 0;
    for (const { resident, today } of await candidates(ctx, page.page, now)) {
      const unit = await ctx.db.get(resident.unitId);
      if (!unit || unit.orgId !== resident.orgId) continue;
      const property = await ctx.db.get(unit.propertyId);
      const title = leaseFollowUpTitle({
        unitNumber: unit.unitNumber,
        propertyName: property?.name ?? "the property",
        leaseEnd: resident.leaseEnd as string,
        today,
      });
      // tasks.userId (the creator) is required and there is no system user: the AM it is for.
      await ctx.db.insert("tasks", {
        orgId: resident.orgId,
        userId: unit.assetManagerUserId,
        assigneeUserId: unit.assetManagerUserId,
        title,
        description: `Resident: ${resident.fullName}. Created by the daily lease check.`,
        status: "todo",
        priority: "medium",
        category: "Leasing",
        unitId: unit._id,
        residentId: resident._id,
        kind: "lease_follow_up",
        createdAt: now,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        orgId: resident.orgId,
        entity: "resident",
        entityId: resident._id,
        action: "lease_follow_up_created",
        note: title,
      });
      created += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.leaseFollowUp.run, { cursor: page.continueCursor });
    }
    if (created > 0) console.log(`lease follow-up: created ${created} task(s) in this batch`);
    return { created, isDone: page.isDone };
  },
});

/** Read-only: how many follow-ups the next run would create (per org). For checks before a run. */
export const preview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("residents").collect();
    const picked = await candidates(ctx, rows, Date.now());
    const byOrg: Record<string, number> = {};
    for (const p of picked) byOrg[p.resident.orgId] = (byOrg[p.resident.orgId] ?? 0) + 1;
    return { total: picked.length, byOrg, activeWithLeaseEnd: rows.filter((r) => r.active && r.leaseEnd).length };
  },
});
