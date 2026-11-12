// Tests for the exceptions queue ordering (convex/exceptionOrder.ts, pure).
// From dashboard/:  node --test scripts/probes/exceptions_order.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
const { sortExceptionRows } = await import("../../convex/exceptionOrder.ts");

const row = (id, reason, severityRank, createdAt) => ({ id, reason, severityRank, createdAt });
const sort = (rows) => sortExceptionRows(rows, (r) => r).map((r) => r.id);

test("an emergency in a late reason group comes before non-emergencies of earlier groups", () => {
  const rows = [
    row("a-routine", "aaa_reason", 2, 1),
    row("a-urgent", "aaa_reason", 1, 2),
    row("z-emerg", "zzz_reason", 0, 3),
    row("z-routine", "zzz_reason", 2, 1),
  ];
  assert.deepEqual(sort(rows), ["z-emerg", "z-routine", "a-urgent", "a-routine"]);
});

test("groups stay contiguous, severity then oldest within a group", () => {
  const rows = [
    row("b2", "b", 1, 20),
    row("a1", "a", 1, 5),
    row("b1", "b", 1, 10),
    row("a0", "a", 2, 1),
    row("b0", "b", 0, 99),
  ];
  assert.deepEqual(sort(rows), ["b0", "b1", "b2", "a1", "a0"]);
});

test("groups with the same worst severity fall back to reason name", () => {
  const rows = [row("y", "y", 1, 1), row("x", "x", 1, 2)];
  assert.deepEqual(sort(rows), ["x", "y"]);
});

test("groups holding an emergency all come before groups with none", () => {
  const rows = [];
  let t = 0;
  for (const reason of ["ambiguous", "no_match", "other"]) for (let sev = 1; sev <= 3; sev++) rows.push(row(`${reason}-${sev}`, reason, sev, t++));
  for (const reason of ["unit_unknown", "zz"]) for (let sev = 0; sev <= 3; sev++) rows.push(row(`${reason}-${sev}`, reason, sev, t++));
  const out = sortExceptionRows(rows, (r) => r);
  // 8 rows in the two emergency groups come first; the 9 rows of the others follow.
  assert.ok(out.slice(0, 8).every((r) => r.reason === "unit_unknown" || r.reason === "zz"));
  assert.ok(out.slice(8).every((r) => r.severityRank > 0));
  assert.equal(out[0].severityRank, 0);
});

test("does not mutate the input and handles empty", () => {
  const rows = [row("b", "b", 1, 1), row("a", "a", 0, 1)];
  sort(rows);
  assert.equal(rows[0].id, "b");
  assert.deepEqual(sort([]), []);
});
