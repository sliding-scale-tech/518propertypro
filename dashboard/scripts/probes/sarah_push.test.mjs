// B43: a dashboard save updates Sarah on its own. Pure state machine in convex/sarahPushLib.ts:
// debounce by generation, one push per team at a time, retries with backoff, the status texts.
// No packages, no network. From dashboard/:  node --test scripts/probes/sarah_push.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../../convex/sarahPushLib.ts");

const ORG = "org1";
const t0 = 1_000_000;

function req(prev, now = t0, userId = "u1") {
  return P.requested(prev, { orgId: ORG, userId, now });
}

test("each request bumps the generation and is pending", () => {
  const a = req(null);
  assert.equal(a.generation, 1);
  assert.equal(a.status, "pending");
  assert.equal(a.attempt, 0);
  const b = req(a, t0 + 100);
  assert.equal(b.generation, 2);
  assert.equal(b.status, "pending");
});

test("three saves within the debounce window give exactly one push (only the newest run claims)", () => {
  let s = req(null, t0);
  s = req(s, t0 + 500);
  s = req(s, t0 + 1500);
  const now = t0 + 1500 + P.PUSH_DEBOUNCE_MS;
  assert.equal(P.claim(s, 1, now).kind, "stale");
  assert.equal(P.claim(s, 2, now).kind, "stale");
  const go = P.claim(s, 3, now);
  assert.equal(go.kind, "go");
  assert.equal(go.next.status, "pushing");
  assert.equal(go.next.runningGeneration, 3);
  // The same run delivered twice cannot push twice.
  assert.equal(P.claim(go.next, 3, now + 1).kind, "stale");
});

test("a run for an unknown team or an already handled request does nothing", () => {
  assert.equal(P.claim(null, 1, t0).kind, "stale");
  const s = req(null);
  const go = P.claim(s, 1, t0 + 3000);
  const done = P.finished(go.next, 1, { kind: "ok" }, t0 + 4000).next;
  assert.equal(P.claim(done, 1, t0 + 5000).kind, "stale");
});

test("never two pushes at once: a newer request waits while a push is running", () => {
  let s = req(null, t0);
  const go = P.claim(s, 1, t0 + 3000);
  s = req(go.next, t0 + 4000); // a save while generation 1 is pushing
  assert.equal(s.generation, 2);
  assert.equal(s.runningGeneration, 1, "the running push keeps its lock");
  const busy = P.claim(s, 2, t0 + 7000);
  assert.equal(busy.kind, "busy");
  assert.equal(busy.recheckInMs, P.PUSH_BUSY_RECHECK_MS);
  // Generation 1 finishes: lock released, but the status stays with the newer request.
  const after = P.finished(s, 1, { kind: "ok" }, t0 + 8000);
  assert.equal(after.retryInMs, null);
  assert.equal(after.next.status, "pending");
  assert.equal(after.next.generation, 2);
  assert.equal(after.next.runningGeneration, undefined);
  assert.equal(after.next.lastOkAt, undefined, "an older setup going out is not reported as the current one");
  // Now generation 2 can push.
  assert.equal(P.claim(after.next, 2, t0 + 12000).kind, "go");
});

test("an older failure while a newer request is pending neither retries nor marks failed", () => {
  let s = req(null, t0);
  s = P.claim(s, 1, t0 + 3000).next;
  s = req(s, t0 + 4000);
  const r = P.finished(s, 1, { kind: "error", message: "x" }, t0 + 5000);
  assert.equal(r.retryInMs, null);
  assert.equal(r.next.status, "pending");
  assert.equal(r.next.attempt, 0);
});

test("a dead lock (run never reported back) expires and does not block forever", () => {
  let s = req(null, t0);
  s = P.claim(s, 1, t0 + 3000).next; // pushing, then the action died
  assert.equal(P.pushView(s, t0 + 3000 + P.PUSH_LOCK_MS + 1).state, "failed");
  s = req(s, t0 + 3000 + P.PUSH_LOCK_MS + 1); // Retry
  assert.equal(P.claim(s, 2, t0 + 3000 + P.PUSH_LOCK_MS + 2).kind, "go");
});

test("status transitions: success", () => {
  let s = req(null, t0);
  assert.equal(P.pushView(s, t0).state, "updating");
  assert.equal(P.pushView(s, t0).text, "Saved. Updating Sarah…");
  s = P.claim(s, 1, t0 + 3000).next;
  assert.equal(P.pushView(s, t0 + 3000).state, "updating");
  const r = P.finished(s, 1, { kind: "ok" }, t0 + 5000);
  assert.equal(r.retryInMs, null);
  const v = P.pushView(r.next, t0 + 5000);
  assert.equal(v.state, "ok");
  assert.equal(v.text, "Saved. Sarah updated");
  assert.equal(v.at, t0 + 5000);
  assert.equal(v.canRetry, false);
  assert.equal(r.next.runningGeneration, undefined);
});

test("status transitions: failures retry with backoff, then stay failed with Retry", () => {
  let s = req(null, t0);
  let now = t0 + 3000;
  const delays = [];
  for (let i = 0; i <= P.PUSH_RETRY_DELAYS_MS.length; i++) {
    const go = P.claim(s, 1, now);
    assert.equal(go.kind, "go", `attempt ${i} claims`);
    const r = P.finished(go.next, 1, { kind: "error", message: "The voice service answered with error 500." }, now + 100);
    s = r.next;
    if (r.retryInMs !== null) {
      delays.push(r.retryInMs);
      assert.equal(s.status, "pending");
      const v = P.pushView(s, now + 100);
      assert.equal(v.state, "retrying");
      assert.equal(v.text, "Saved, but Sarah couldn't be updated yet. Retrying");
      assert.equal(v.canRetry, true);
      now += 100 + r.retryInMs;
    }
  }
  assert.deepEqual(delays, [...P.PUSH_RETRY_DELAYS_MS]);
  assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]), "backoff grows");
  assert.equal(s.status, "failed");
  assert.equal(s.lastError, "The voice service answered with error 500.");
  const v = P.pushView(s, now);
  assert.equal(v.state, "failed");
  assert.equal(v.canRetry, true);
  // No further automatic run: a stale claim.
  assert.equal(P.claim(s, 1, now + 999_999).kind, "stale");
  // Retry starts over with a fresh attempt count and clears the error.
  const again = req(s, now + 1);
  assert.equal(again.status, "pending");
  assert.equal(again.attempt, 0);
  assert.equal(again.lastError, undefined);
});

test("a team without an agent is reported, not retried", () => {
  let s = req(null, t0);
  s = P.claim(s, 1, t0 + 3000).next;
  const r = P.finished(s, 1, { kind: "no_agent" }, t0 + 3500);
  assert.equal(r.retryInMs, null);
  assert.equal(P.pushView(r.next, t0 + 3500).state, "no_agent");
});

test("no state yet shows nothing", () => {
  assert.deepEqual(P.pushView(null, t0), { state: "none", text: "", canRetry: false, at: null });
});

test("stored errors are short and never raw upstream text", () => {
  assert.equal(
    P.safePushError(new Error('ElevenLabs 422 on /v1/convai/agents/x: {"detail":"secret prompt text"}')),
    "The voice service answered with error 422.",
  );
  assert.equal(P.safePushError({ data: "Sarah is not set up." }), "Sarah is not set up.");
  assert.equal(P.safePushError(new Error("fetch failed: key=sk_live_abc")), "The voice service could not be reached or did not accept the update.");
  assert.equal(P.safePushError("weird"), "The voice service could not be reached or did not accept the update.");
  assert.ok(P.safePushError({ data: "x".repeat(500) }).length <= 200);
});

test("no undefined fields are left in a state (safe to write with replace)", () => {
  let s = req(null, t0);
  s = P.claim(s, 1, t0 + 3000).next;
  s = P.finished(s, 1, { kind: "ok" }, t0 + 4000).next;
  for (const [k, val] of Object.entries(s)) assert.notEqual(val, undefined, k);
});
