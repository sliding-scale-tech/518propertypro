import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * TEST fixtures for scripts/probes/work_order_status_probe.py. Internal only (never reachable from
 * a browser or a tool webhook; run with `npx convex run`). Rows are inserted directly, NOT through
 * maintenance.createFromCall or workOrders.create, so nothing is routed, nobody is notified or
 * texted (no scheduleNotify / scheduleEmergencyAlert), no audit row is written and the MR/WO
 * counters are not touched. Every row is marked: title "TEST PROBE: ...", description starting
 * with FIXTURE_MARK, number >= 990000. deleteStatusFixtures removes only rows carrying the marks.
 */

const FIXTURE_MARK = "TEST PROBE fixture for check_work_order_status. Safe to delete.";
const TITLE_PREFIX = "TEST PROBE: ";
const NUMBER_BASE = 990000;

const requestStatus = v.union(
  v.literal("new"),
  v.literal("under_review"),
  v.literal("more_info_needed"),
  v.literal("forwarded_to_pat"),
  v.literal("work_order_created"),
  v.literal("closed_out_of_scope"),
  v.literal("closed_duplicate"),
);
const workOrderStatus = v.union(
  v.literal("created"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("reviewed_closed"),
  v.literal("cancelled"),
);

export const createStatusFixtures = internalMutation({
  args: {
    orgId: v.string(),
    createdBy: v.id("users"),
    requests: v.array(
      v.object({
        key: v.string(),
        unitId: v.id("units"),
        status: requestStatus,
        title: v.string(),
        issueType: v.string(),
        daysAgoCreated: v.number(),
        daysAgoUpdated: v.number(),
        closeReason: v.optional(v.string()),
        callerNumber: v.optional(v.string()),
      }),
    ),
    workOrders: v.array(
      v.object({
        key: v.string(),
        unitId: v.id("units"),
        requestKey: v.optional(v.string()),
        status: workOrderStatus,
        title: v.string(),
        daysAgoCreated: v.number(),
        dueInDays: v.optional(v.number()),
        window: v.optional(v.string()),
        completedDaysAgo: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Record<string, { id: string; number: number }>> => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const out: Record<string, { id: string; number: number }> = {};
    let n = NUMBER_BASE;
    const unitOf = async (unitId: Id<"units">) => {
      const unit = await ctx.db.get(unitId);
      if (!unit || unit.orgId !== args.orgId) throw new ConvexError("That unit is not on this team.");
      return unit;
    };
    for (const r of args.requests) {
      const unit = await unitOf(r.unitId);
      const number = ++n;
      const id = await ctx.db.insert("maintenanceRequests", {
        orgId: args.orgId,
        number,
        source: "manual",
        callerNumber: r.callerNumber,
        propertyId: unit.propertyId,
        unitId: unit._id,
        matchConfidence: "exact",
        title: `${TITLE_PREFIX}${r.title}`,
        issueType: r.issueType,
        description: FIXTURE_MARK,
        answers: [],
        severity: "routine",
        mediaRequested: false,
        inExceptionQueue: false,
        status: r.status,
        closeReason: r.closeReason,
        createdAt: now - r.daysAgoCreated * day,
        updatedAt: now - r.daysAgoUpdated * day,
      });
      out[r.key] = { id, number };
    }
    for (const w of args.workOrders) {
      const unit = await unitOf(w.unitId);
      const number = ++n;
      const requestId = w.requestKey ? (out[w.requestKey]?.id as Id<"maintenanceRequests"> | undefined) : undefined;
      if (w.requestKey && !requestId) throw new ConvexError(`No fixture request "${w.requestKey}".`);
      const id = await ctx.db.insert("workOrders", {
        orgId: args.orgId,
        number,
        requestId,
        unitId: unit._id,
        propertyId: unit.propertyId,
        title: `${TITLE_PREFIX}${w.title}`,
        scope: FIXTURE_MARK,
        priority: "routine",
        checklist: [],
        requiredOnSubmit: { photos: false, hours: false, receipts: false, notes: false },
        status: w.status,
        dueDate: w.dueInDays !== undefined ? now + w.dueInDays * day : undefined,
        window: w.window,
        createdBy: args.createdBy,
        createdAt: now - w.daysAgoCreated * day,
        updatedAt: now - (w.completedDaysAgo ?? w.daysAgoCreated) * day,
        completedAt: w.completedDaysAgo !== undefined ? now - w.completedDaysAgo * day : undefined,
      });
      out[w.key] = { id, number };
    }
    return out;
  },
});

/** Removes every fixture row (by its marks) and anything that hangs off it. Audit rows are kept. */
export const deleteStatusFixtures = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const isFixture = (title: string | undefined, text: string, number: number) =>
      (title ?? "").startsWith(TITLE_PREFIX) && text === FIXTURE_MARK && number > NUMBER_BASE;
    const removed = { requests: [] as number[], workOrders: [] as number[], attached: 0 };

    const wos = await ctx.db
      .query("workOrders")
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .collect();
    for (const w of wos) {
      if (!isFixture(w.title, w.scope, w.number)) continue;
      for (const table of ["workOrderFiles", "workOrderTime", "workOrderExpenses", "workOrderNotes"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_work_order", (q) => q.eq("workOrderId", w._id))
          .collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
          removed.attached++;
        }
      }
      await ctx.db.delete(w._id);
      removed.workOrders.push(w.number);
    }
    const reqs = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_org_and_created", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const r of reqs) {
      if (!isFixture(r.title, r.description, r.number)) continue;
      const media = await ctx.db
        .query("maintenanceMedia")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      for (const m of media) {
        await ctx.db.delete(m._id);
        removed.attached++;
      }
      await ctx.db.delete(r._id);
      removed.requests.push(r.number);
    }
    return removed;
  },
});
