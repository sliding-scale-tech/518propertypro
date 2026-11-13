// Pure state machine for "a dashboard save updates Sarah" (B43). No Convex imports, so
// scripts/probes/sarah_push.test.mjs can load it directly.
//
// One row per team (table sarahPushes). Every request bumps `generation`; a scheduled run carries the
// generation it was scheduled for and does nothing unless it is still the newest one, so several saves
// within the debounce window produce ONE push. `runningGeneration`/`runningSince` is the per-team lock:
// a run that finds it held waits and checks again, so two pushes for one team never overlap.

export type PushStatus = "pending" | "pushing" | "ok" | "failed" | "no_agent";

export type PushState = {
  orgId: string;
  generation: number;
  status: PushStatus;
  /** Failed attempts so far for the current generation (0 = first try). */
  attempt: number;
  requestedBy?: string;
  requestedAt: number;
  runningGeneration?: number;
  runningSince?: number;
  /** Short, user-safe reason of the last failure (never raw upstream text or secrets). */
  lastError?: string;
  lastOkAt?: number;
  updatedAt: number;
};

/** Saves within this window are pushed together. */
export const PUSH_DEBOUNCE_MS = 3000;
/** How long a run waits before checking again when another push for the team is still running. */
export const PUSH_BUSY_RECHECK_MS = 5000;
/** A lock older than this is treated as dead (longer than a Convex action can run). */
export const PUSH_LOCK_MS = 10 * 60 * 1000;
/** Automatic retries after a failed push, in order. After the last one the status stays "failed". */
export const PUSH_RETRY_DELAYS_MS: ReadonlyArray<number> = [10_000, 60_000, 5 * 60_000];

function clean(s: PushState): PushState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined) out[k] = v;
  return out as PushState;
}

/** A new push request (a save, an approval, a rollback or Retry). Supersedes any earlier pending one. */
export function requested(prev: PushState | null, args: { orgId: string; userId?: string; now: number }): PushState {
  return clean({
    orgId: args.orgId,
    generation: (prev?.generation ?? 0) + 1,
    status: "pending",
    attempt: 0,
    requestedBy: args.userId ?? prev?.requestedBy,
    requestedAt: args.now,
    // A push already running keeps its lock; the new run waits for it.
    runningGeneration: prev?.runningGeneration,
    runningSince: prev?.runningSince,
    lastOkAt: prev?.lastOkAt,
    updatedAt: args.now,
  });
}

export function isLocked(s: PushState, now: number): boolean {
  return s.runningGeneration !== undefined && s.runningSince !== undefined && now - s.runningSince < PUSH_LOCK_MS;
}

export type ClaimDecision =
  | { kind: "stale" }
  | { kind: "busy"; recheckInMs: number }
  | { kind: "go"; next: PushState };

/**
 * What a scheduled run for `generation` may do.
 * - stale: a newer request exists, or this one was already handled. Do nothing.
 * - busy: another push for this team is running. Check again shortly (same generation).
 * - go: take the lock and push.
 */
export function claim(s: PushState | null, generation: number, now: number): ClaimDecision {
  if (!s || s.generation !== generation || s.status !== "pending") return { kind: "stale" };
  if (isLocked(s, now)) return { kind: "busy", recheckInMs: PUSH_BUSY_RECHECK_MS };
  return {
    kind: "go",
    next: clean({ ...s, status: "pushing", runningGeneration: generation, runningSince: now, updatedAt: now }),
  };
}

export type PushOutcome = { kind: "ok" } | { kind: "no_agent" } | { kind: "error"; message: string };

/**
 * Records how the run for `generation` ended and releases its lock. When a newer request arrived
 * meanwhile, that request owns the status (its own run pushes the newer setup), so only the lock changes.
 * `retryInMs` is set when the same generation should be tried again after that delay.
 */
export function finished(
  s: PushState,
  generation: number,
  outcome: PushOutcome,
  now: number,
): { next: PushState; retryInMs: number | null } {
  const unlocked: PushState =
    s.runningGeneration === generation ? { ...s, runningGeneration: undefined, runningSince: undefined } : { ...s };
  if (s.generation !== generation) return { next: clean({ ...unlocked, updatedAt: now }), retryInMs: null };
  if (outcome.kind === "ok") {
    return {
      next: clean({ ...unlocked, status: "ok", attempt: 0, lastError: undefined, lastOkAt: now, updatedAt: now }),
      retryInMs: null,
    };
  }
  if (outcome.kind === "no_agent") {
    return { next: clean({ ...unlocked, status: "no_agent", attempt: 0, lastError: undefined, updatedAt: now }), retryInMs: null };
  }
  if (s.attempt < PUSH_RETRY_DELAYS_MS.length) {
    return {
      next: clean({ ...unlocked, status: "pending", attempt: s.attempt + 1, lastError: outcome.message, updatedAt: now }),
      retryInMs: PUSH_RETRY_DELAYS_MS[s.attempt],
    };
  }
  return { next: clean({ ...unlocked, status: "failed", lastError: outcome.message, updatedAt: now }), retryInMs: null };
}

export type PushViewState = "none" | "updating" | "ok" | "retrying" | "failed" | "no_agent";
export type PushView = { state: PushViewState; text: string; canRetry: boolean; at: number | null };

export const PUSH_TEXT: Record<Exclude<PushViewState, "none">, string> = {
  updating: "Saved. Updating Sarah…",
  ok: "Saved. Sarah updated",
  retrying: "Saved, but Sarah couldn't be updated yet. Retrying",
  failed: "Saved, but Sarah couldn't be updated yet.",
  no_agent: "Saved. Sarah isn't connected for this team yet, so there was nothing to update.",
};

/** What the dashboard shows for a team's last push. */
export function pushView(s: PushState | null, now: number): PushView {
  if (!s) return { state: "none", text: "", canRetry: false, at: null };
  const view = (state: Exclude<PushViewState, "none">, canRetry: boolean, at: number | null = null): PushView => ({
    state,
    text: PUSH_TEXT[state],
    canRetry,
    at,
  });
  if (s.status === "ok") return view("ok", false, s.lastOkAt ?? null);
  if (s.status === "no_agent") return view("no_agent", false);
  if (s.status === "failed") return view("failed", true);
  // A push whose run died without reporting back (its lock expired) would otherwise spin forever.
  if (s.status === "pushing" && !isLocked(s, now)) return view("failed", true);
  return s.attempt > 0 ? view("retrying", true) : view("updating", false);
}

/**
 * A short reason that is safe to store and show: our own ConvexError text, or the voice service's
 * HTTP status. Raw upstream bodies can echo request content, so they are never kept.
 */
export function safePushError(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (typeof data === "string" && data.trim()) return data.trim().slice(0, 200);
  }
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = /^ElevenLabs (\d{3})\b/.exec(msg);
  if (m) return `The voice service answered with error ${m[1]}.`;
  return "The voice service could not be reached or did not accept the update.";
}
