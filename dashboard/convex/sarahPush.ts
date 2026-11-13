import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminView } from "./authz";
import {
  claim,
  finished,
  PUSH_DEBOUNCE_MS,
  pushView,
  requested,
  safePushError,
  type PushOutcome,
  type PushState,
  type PushView,
} from "./sarahPushLib";

/**
 * Sends a team's saved Sarah setup to ElevenLabs after a dashboard save (B43).
 *
 * The ONLY callers of requestPush are the Sarah config writes that make something live: an admin's
 * save, an approval, and a rollback (convex/sarahConfig.ts goLive / rollback), plus the Retry button
 * here. Code changes still reach Sarah only through `npx convex run agents:pushKnowledgeBase`.
 *
 * Pushes change the agent for NEW calls only; a call already in progress keeps its setup.
 * The pure state machine (debounce, lock, retries, status text) is in sarahPushLib.ts.
 */

function toState(row: Doc<"sarahPushes"> | null): PushState | null {
  if (!row) return null;
  return {
    orgId: row.orgId,
    generation: row.generation,
    status: row.status,
    attempt: row.attempt,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
    ...(row.requestedBy ? { requestedBy: row.requestedBy } : {}),
    ...(row.runningGeneration !== undefined ? { runningGeneration: row.runningGeneration } : {}),
    ...(row.runningSince !== undefined ? { runningSince: row.runningSince } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    ...(row.lastOkAt !== undefined ? { lastOkAt: row.lastOkAt } : {}),
  };
}

async function rowFor(ctx: MutationCtx, orgId: string) {
  return ctx.db
    .query("sarahPushes")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

async function write(ctx: MutationCtx, row: Doc<"sarahPushes"> | null, next: PushState): Promise<void> {
  const body = {
    orgId: next.orgId,
    generation: next.generation,
    status: next.status,
    attempt: next.attempt,
    requestedAt: next.requestedAt,
    updatedAt: next.updatedAt,
    ...(next.requestedBy ? { requestedBy: next.requestedBy as Id<"users"> } : {}),
    ...(next.runningGeneration !== undefined ? { runningGeneration: next.runningGeneration } : {}),
    ...(next.runningSince !== undefined ? { runningSince: next.runningSince } : {}),
    ...(next.lastError ? { lastError: next.lastError } : {}),
    ...(next.lastOkAt !== undefined ? { lastOkAt: next.lastOkAt } : {}),
  };
  // replace() so cleared fields (lock, error) really go away.
  if (row) await ctx.db.replace(row._id, body);
  else await ctx.db.insert("sarahPushes", body);
}

/**
 * Asks for a push of the team's published setup. Coalesces: only the newest request's run pushes,
 * so several saves within PUSH_DEBOUNCE_MS give one push. Call from a mutation, after the commit.
 */
export async function requestPush(
  ctx: MutationCtx,
  orgId: string,
  userId: Id<"users"> | undefined,
  delayMs: number = PUSH_DEBOUNCE_MS,
): Promise<void> {
  const row = await rowFor(ctx, orgId);
  const next = requested(toState(row), { orgId, userId, now: Date.now() });
  await write(ctx, row, next);
  await ctx.scheduler.runAfter(delayMs, internal.sarahPush.run, { orgId, generation: next.generation });
}

/** The status line under Save: "Saved. Sarah updated", "Saved, but Sarah couldn't be updated yet. Retrying", … */
export const status = query({
  args: {},
  handler: async (ctx): Promise<PushView> => {
    const org = await requireAdminView(ctx);
    const row = await ctx.db
      .query("sarahPushes")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .first();
    return pushView(toState(row), Date.now());
  },
});

/** The Retry button. Pushes the setup that is live in the dashboard now; never changes it. */
export const retry = mutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const org = await requireAdminView(ctx);
    await requestPush(ctx, org.orgId, org.user._id, 0);
  },
});

/** Takes the team's push lock for `generation`, or says why not (stale, or busy and re-scheduled). */
export const claimRun = internalMutation({
  args: { orgId: v.string(), generation: v.number() },
  handler: async (ctx, args): Promise<{ go: boolean; userId: Id<"users"> | null }> => {
    const row = await rowFor(ctx, args.orgId);
    const decision = claim(toState(row), args.generation, Date.now());
    if (decision.kind === "stale") return { go: false, userId: null };
    if (decision.kind === "busy") {
      await ctx.scheduler.runAfter(decision.recheckInMs, internal.sarahPush.run, args);
      return { go: false, userId: null };
    }
    await write(ctx, row, decision.next);
    return { go: true, userId: (decision.next.requestedBy as Id<"users"> | undefined) ?? null };
  },
});

export const finishRun = internalMutation({
  args: {
    orgId: v.string(),
    generation: v.number(),
    outcome: v.union(v.literal("ok"), v.literal("no_agent"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await rowFor(ctx, args.orgId);
    const state = toState(row);
    if (!state) return;
    const outcome: PushOutcome =
      args.outcome === "error" ? { kind: "error", message: args.error ?? "Unknown error" } : { kind: args.outcome };
    const { next, retryInMs } = finished(state, args.generation, outcome, Date.now());
    await write(ctx, row, next);
    if (retryInMs !== null) {
      await ctx.scheduler.runAfter(retryInMs, internal.sarahPush.run, { orgId: args.orgId, generation: args.generation });
    }
  },
});

/** One scheduled push. A no-op unless it is still the newest request and no other push is running. */
export const run = internalAction({
  args: { orgId: v.string(), generation: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const claimed: { go: boolean; userId: Id<"users"> | null } = await ctx.runMutation(internal.sarahPush.claimRun, args);
    if (!claimed.go) return;
    let outcome: { outcome: "ok" | "no_agent" | "error"; error?: string };
    try {
      const agent = await ctx.runQuery(internal.agents.currentInternal, { orgId: args.orgId });
      if (!agent) {
        console.log(`[sarahPush] team ${args.orgId} has no agent; nothing to update.`);
        outcome = { outcome: "no_agent" };
      } else {
        // The "policies" knowledge-base doc follows the published setup. Never blocks the push: the
        // doc is reference material, the prompt is what enforces the rules.
        if (claimed.userId) {
          try {
            await ctx.runAction(internal.sarahKb.regenerate, { orgId: args.orgId, userId: claimed.userId });
          } catch (err) {
            console.error("[sarahPush] policy doc refresh failed:", err);
          }
        }
        console.log(`[sarahPush] pushing team ${args.orgId} (request ${args.generation}): Sarah setup saved in the dashboard.`);
        await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: args.orgId });
        outcome = { outcome: "ok" };
      }
    } catch (err) {
      // Detail stays in the logs: the upstream message can carry raw voice-service response text.
      console.error("[sarahPush] voice service update failed:", err);
      outcome = { outcome: "error", error: safePushError(err) };
    }
    await ctx.runMutation(internal.sarahPush.finishRun, { ...args, ...outcome });
  },
});
