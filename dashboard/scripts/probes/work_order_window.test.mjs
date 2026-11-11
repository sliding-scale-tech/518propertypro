// Unit tests for convex/workOrderWindow.ts (appointment-window labels and validation). No
// packages. From dashboard/:
//   node --test scripts/probes/work_order_window.test.mjs
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
const { resolveTimeZone, tenantPreferredTimeText, windowIsToday, windowLabel, windowProblem, windowTimeRange, WINDOW_MAX_MS } = await import(
  "../../convex/workOrderWindow.ts"
);

const HOUR = 60 * 60 * 1000;
const NY = "America/New_York";
const NOW = Date.UTC(2026, 10, 2, 16); // Monday, November 2, 2026, 11:00 AM in New York
const at = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

test("labels are absolute, in the team's zone", () => {
  // 18:00 UTC = 1:00 PM EST on Nov 3.
  assert.equal(windowLabel(at(2026, 11, 3, 18), at(2026, 11, 3, 20), NY, NOW), "Tue, Nov 3, 1:00–3:00 PM");
  assert.equal(windowLabel(at(2026, 11, 3, 16), at(2026, 11, 3, 18), NY, NOW), "Tue, Nov 3, 11:00 AM–1:00 PM");
  assert.equal(windowLabel(at(2026, 11, 3, 18), at(2026, 11, 3, 20), "UTC", NOW), "Tue, Nov 3, 6:00–8:00 PM");
  // Never "Today", even for today's window.
  assert.doesNotMatch(windowLabel(NOW, NOW + 2 * HOUR, NY, NOW), /today|tomorrow/i);
});

test("the year appears only when it isn't this year; both days when crossing midnight", () => {
  assert.equal(windowLabel(at(2027, 1, 5, 14), at(2027, 1, 5, 16), NY, NOW), "Tue, Jan 5, 2027, 9:00–11:00 AM");
  assert.equal(windowLabel(at(2026, 11, 4, 3), at(2026, 11, 4, 7), NY, NOW), "Tue, Nov 3, 10:00 PM – Wed, Nov 4, 2:00 AM");
});

test("time range only", () => {
  assert.equal(windowTimeRange(at(2026, 11, 3, 18), at(2026, 11, 3, 20, 30), NY), "1:00–3:30 PM");
});

test("validation", () => {
  const ok = at(2026, 11, 3, 18);
  assert.equal(windowProblem(ok, ok + 2 * HOUR, NOW), null);
  assert.match(windowProblem(ok, ok, NOW), /end after it starts/);
  assert.match(windowProblem(ok, ok - HOUR, NOW), /end after it starts/);
  assert.equal(windowProblem(ok, ok + WINDOW_MAX_MS, NOW), null);
  assert.match(windowProblem(ok, ok + WINDOW_MAX_MS + 1, NOW), /12 hours/);
  assert.match(windowProblem(Number.NaN, ok, NOW), /valid/);
  assert.match(windowProblem(ok, Infinity, NOW), /valid/);
  assert.match(windowProblem(1.5, 2.5, NOW), /valid/);
  // Up to a day back is allowed (recording this morning's visit); older is not.
  assert.equal(windowProblem(NOW - 20 * HOUR, NOW - 18 * HOUR, NOW), null);
  assert.match(windowProblem(NOW - 25 * HOUR, NOW - 23 * HOUR, NOW), /in the past/);
  assert.match(windowProblem(NOW + 400 * 24 * HOUR, NOW + 400 * 24 * HOUR + 2 * HOUR, NOW), /next year/);
});

test("today is the team's local date", () => {
  // 03:00 UTC Nov 3 is still Nov 2 (10 PM) in New York.
  assert.equal(windowIsToday(at(2026, 11, 3, 3), NOW, NY), true);
  assert.equal(windowIsToday(at(2026, 11, 3, 3), NOW, "UTC"), false);
  assert.equal(windowIsToday(at(2026, 11, 3, 18), NOW, NY), false);
});

test("time zone: the team's, else a real browser zone, else UTC", () => {
  assert.equal(resolveTimeZone("America/Chicago", "Asia/Karachi"), "America/Chicago");
  assert.equal(resolveTimeZone(null, "Asia/Karachi"), "Asia/Karachi");
  assert.equal(resolveTimeZone(undefined, "Not/AZone"), "UTC");
  assert.equal(resolveTimeZone(undefined, undefined), "UTC");
});

test("tenant's preferred time: kept as said, blank is unset", () => {
  assert.equal(tenantPreferredTimeText("next week Monday"), "next week Monday");
  assert.equal(tenantPreferredTimeText("  after 3pm  "), "after 3pm");
  for (const unset of [null, undefined, "", "   "]) assert.equal(tenantPreferredTimeText(unset), undefined);
});
