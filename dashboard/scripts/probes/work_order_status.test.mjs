// Unit tests for convex/workOrderStatus.ts (check_work_order_status: verification, the status
// mapping and the 30-day window). No packages. From dashboard/:
//   node --test scripts/probes/work_order_status.test.mjs
// All names, numbers and records here are invented.
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
const {
  REQUEST_STATUS_TEXT,
  WORK_ORDER_STATUS_TEXT,
  STATUS_WINDOW_DAYS,
  buildStatusItems,
  closedText,
  rankByIssue,
  visitWindow,
  spokenClock,
  spokenDate,
  verifyStatusCaller,
} = await import("../../convex/workOrderStatus.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 16); // Friday, October 30, 2026, noon in New York
const day = spokenDate("America/New_York");
const req = (o) => ({
  id: o.id ?? "q1",
  number: o.number ?? 1001,
  status: o.status ?? "new",
  title: o.title ?? "Water leak: kitchen sink dripping",
  issueType: o.issueType ?? "water_leak",
  description: o.description ?? "The kitchen sink drips under the cabinet.",
  createdAt: o.createdAt ?? NOW - 2 * DAY,
  updatedAt: o.updatedAt ?? NOW - 2 * DAY,
  closeReason: o.closeReason,
  callerNumber: o.callerNumber,
  callbackNumber: o.callbackNumber,
});
const wo = (o) => ({
  id: o.id ?? "w1",
  number: o.number ?? 2001,
  requestId: o.requestId,
  status: o.status ?? "created",
  title: o.title ?? "Fix kitchen sink",
  dueDate: o.dueDate,
  window: o.window,
  windowStart: o.windowStart,
  windowEnd: o.windowEnd,
  createdAt: o.createdAt ?? NOW - DAY,
  updatedAt: o.updatedAt ?? NOW - DAY,
  completedAt: o.completedAt,
  closedAt: o.closedAt,
});
const one = (requests, workOrders = [], showVisit = false) => {
  const r = buildStatusItems(requests, workOrders, NOW, day, () => showVisit);
  assert.equal(r.ok, true);
  return r.items;
};

// The schema's status unions (convex/schema.ts maintenanceRequests.status / workOrders.status).
const REQUEST_STATUSES = ["new", "under_review", "more_info_needed", "forwarded_to_pat", "work_order_created", "closed_out_of_scope", "closed_duplicate"];
const WORK_ORDER_STATUSES = ["created", "assigned", "in_progress", "completed", "reviewed_closed", "cancelled"];

test("every status value in the schema is mapped", () => {
  assert.deepEqual(Object.keys(REQUEST_STATUS_TEXT).sort(), [...REQUEST_STATUSES].sort());
  assert.deepEqual(Object.keys(WORK_ORDER_STATUS_TEXT).sort(), [...WORK_ORDER_STATUSES].sort());
});

test("request statuses in plain English", () => {
  const say = (status) => one([req({ status })])[0].status;
  assert.match(say("new"), /received it/);
  assert.equal(say("under_review"), "It's with your asset manager for review.");
  assert.match(say("more_info_needed"), /asked for more information/);
  assert.match(say("forwarded_to_pat"), /approved it/);
  assert.match(say("closed_duplicate"), /already covered by another request/);
});

test("closed requests: the reason only for tenant-facing presets", () => {
  assert.match(closedText("Tenant responsibility under the lease"), /tenant's responsibility/);
  assert.match(closedText("Tenant responsibility per company policy (light bulbs, window blinds, trash to the curb). Logged by Sarah. bulb out"), /tenant's responsibility/);
  assert.match(closedText("Not a repair · passed to leasing"), /isn't a repair/);
  assert.match(closedText("Duplicate of an open work order"), /another open request/);
  assert.equal(closedText("Resolved on the call"), "It was closed as resolved.");
  // "Other" and free text: closed, with no reason read out.
  assert.equal(closedText("Other"), "It was closed by your asset manager.");
  assert.equal(closedText("Owner says it is the neighbour's pipe, $400"), "It was closed by your asset manager.");
  assert.equal(closedText(undefined), "It was closed by your asset manager.");
});

test("work-order statuses, with dates in the team's zone", () => {
  const say = (o, showVisit = false) => one([req({ id: "q1", status: "work_order_created" })], [wo({ requestId: "q1", ...o })], showVisit)[0];
  assert.match(say({ status: "created" }).status, /approved, and a technician will be assigned/);
  assert.match(say({ status: "assigned" }).status, /hasn't been scheduled yet/);
  assert.equal(say({ status: "in_progress" }).status, "The work is in progress.");
  assert.equal(say({ status: "completed", completedAt: NOW - 3 * DAY }).status, "The work was completed on Tuesday, October 27.");
  assert.match(say({ status: "reviewed_closed", completedAt: NOW - 3 * DAY }).status, /completed on Tuesday, October 27, and it's now closed/);
  assert.match(say({ status: "cancelled" }).status, /cancelled/);
});

test("a scheduled visit: day and time for a verified caller only", () => {
  const due = Date.UTC(2026, 10, 3, 17); // Tuesday, November 3
  const item = (showVisit, window) =>
    one([req({ id: "q1", status: "work_order_created" })], [wo({ requestId: "q1", status: "assigned", dueDate: due, window })], showVisit)[0];
  // Not verified: that a visit is scheduled, and who confirms the time. No day, date or time.
  const plain = item(false, "2-4pm");
  assert.equal(plain.status, "A technician visit is scheduled, and your asset manager will confirm the exact time with you.");
  assert.equal(plain.visitDate, null);
  assert.doesNotMatch(plain.status, /Tuesday|November|2-4pm/);
  // Verified: day, date and the time window.
  assert.equal(item(true, "2-4pm").status, "A technician visit is scheduled for Tuesday, November 3, 2-4pm.");
  assert.equal(item(true, "2-4pm").visitDate, due);
  // A relative window ("Today 2-4pm") is never read; the date still is.
  assert.equal(item(true, "Today 2-4pm").status, "A technician visit is scheduled for Tuesday, November 3.");
  assert.equal(visitWindow("Tomorrow morning"), null);
  assert.equal(visitWindow("9am-12pm"), "9am-12pm");
  // A finished work order has no visit to read out.
  const done = one([req({ id: "q1", status: "work_order_created" })], [wo({ requestId: "q1", status: "completed", completedAt: NOW, dueDate: due })], true)[0];
  assert.equal(done.visitDate, null);
});

test("a picked window: its day and times are read, never its stored label", () => {
  const clock = spokenClock("America/New_York");
  const windowStart = Date.UTC(2026, 10, 3, 18); // Tuesday, November 3, 1:00 PM in New York
  const windowEnd = Date.UTC(2026, 10, 3, 20); // 3:00 PM
  const item = (showVisit, extra = {}) =>
    buildStatusItems(
      [req({ id: "q1", status: "work_order_created" })],
      [wo({ requestId: "q1", status: "assigned", windowStart, windowEnd, window: "Tue, Nov 3, 1:00–3:00 PM", ...extra })],
      NOW,
      day,
      () => showVisit,
      clock,
    ).items[0];
  // Scheduled even without a due date; the window's day wins over a due date.
  assert.equal(item(true).status, "A technician visit is scheduled for Tuesday, November 3, between 1:00 PM and 3:00 PM.");
  assert.equal(item(true, { dueDate: Date.UTC(2026, 10, 9, 17) }).status, "A technician visit is scheduled for Tuesday, November 3, between 1:00 PM and 3:00 PM.");
  assert.equal(item(true).visitDate, windowStart);
  // Not verified: still no day or time.
  assert.equal(item(false).status, "A technician visit is scheduled, and your asset manager will confirm the exact time with you.");
  assert.equal(item(false).visitDate, null);
  // Without a clock the date alone is read (the label would repeat the date).
  const noClock = buildStatusItems(
    [req({ id: "q1", status: "work_order_created" })],
    [wo({ requestId: "q1", status: "assigned", windowStart, windowEnd, window: "Tue, Nov 3, 1:00–3:00 PM" })],
    NOW,
    day,
    () => true,
  ).items[0];
  assert.equal(noClock.status, "A technician visit is scheduled for Tuesday, November 3.");
});

test("showVisitFor is asked per request (caller ID on one request only)", () => {
  const due = Date.UTC(2026, 10, 3, 17);
  const r = buildStatusItems(
    [req({ id: "q1", number: 1, status: "work_order_created" }), req({ id: "q2", number: 2, status: "work_order_created" })],
    [wo({ id: "w1", requestId: "q1", status: "assigned", dueDate: due }), wo({ id: "w2", requestId: "q2", status: "assigned", dueDate: due })],
    NOW,
    day,
    (requestId) => requestId === "q1",
  );
  const byRef = Object.fromEntries(r.items.map((i) => [i.ref, i.status]));
  assert.match(byRef["MR-1"], /scheduled for Tuesday/);
  assert.match(byRef["MR-2"], /asset manager will confirm/);
});

test("the newest work order describes the request; the request title is the summary", () => {
  const items = one(
    [req({ id: "q1", status: "work_order_created", title: "Broken item: front door lock" })],
    [wo({ id: "w1", requestId: "q1", status: "cancelled", createdAt: NOW - 5 * DAY }), wo({ id: "w2", requestId: "q1", status: "in_progress", createdAt: NOW - DAY })],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, "Broken item: front door lock");
  assert.equal(items[0].status, "The work is in progress.");
  assert.equal(items[0].ref, "MR-1001");
});

test("a work order made by hand is its own item", () => {
  const items = one([], [wo({ id: "w9", number: 2009, status: "assigned", title: "Replace smoke detector" })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].ref, "WO-2009");
  assert.equal(items[0].summary, "Replace smoke detector");
});

test(`open items always; closed ones only for ${STATUS_WINDOW_DAYS} days`, () => {
  const items = one([
    req({ id: "old-open", number: 1, status: "under_review", createdAt: NOW - 90 * DAY }),
    req({ id: "recent-closed", number: 2, status: "closed_out_of_scope", closeReason: "Tenant responsibility under the lease", updatedAt: NOW - 10 * DAY }),
    req({ id: "old-closed", number: 3, status: "closed_out_of_scope", createdAt: NOW - 60 * DAY, updatedAt: NOW - 45 * DAY }),
  ]);
  assert.deepEqual(items.map((i) => i.ref).sort(), ["MR-1", "MR-2"]);
  assert.equal(items[0].ref, "MR-1"); // open first
});

test("unknown status values fail closed", () => {
  assert.deepEqual(buildStatusItems([req({ status: "on_hold" })], [], NOW, day), { ok: false, reason: "unknown_status", statusKey: "request:on_hold" });
  const r = buildStatusItems([req({ id: "q1", status: "work_order_created" })], [wo({ requestId: "q1", status: "paused" })], NOW, day);
  assert.equal(r.ok, false);
  // A request that says it has a work order but has none: never guessed at.
  assert.equal(buildStatusItems([req({ status: "work_order_created" })], [], NOW, day).ok, false);
  // Prototype keys are not statuses.
  assert.equal(buildStatusItems([req({ status: "toString" })], [], NOW, day).ok, false);
});

test("items carry nothing beyond the tenant-safe fields", () => {
  const [item] = one([req({ status: "new", closeReason: "x", callerNumber: "+15185550100" })]);
  assert.deepEqual(Object.keys(item).sort(), ["closedAt", "matchText", "open", "ref", "reportedAt", "requestId", "status", "statusKey", "summary", "visitDate", "workOrderId"].sort());
});

test("summary falls back to the issue type and is capped", () => {
  assert.equal(one([req({ title: "", issueType: "electrical" })])[0].summary, "electrical request");
  assert.ok(one([req({ title: "x".repeat(200) })])[0].summary.length <= 80);
});

test("rankByIssue picks the one item the caller described, or none on a tie", () => {
  const items = [
    { ref: "MR-1", matchText: "Water leak: kitchen sink dripping under the cabinet" },
    { ref: "MR-2", matchText: "Electrical: bedroom outlet has no power" },
  ];
  assert.equal(rankByIssue(items, "the leak under my kitchen sink"), "MR-1");
  assert.equal(rankByIssue(items, "my outlet in the bedroom"), "MR-2");
  assert.equal(rankByIssue(items, "the thing I called about"), null);
  assert.equal(rankByIssue(items, ""), null);
  assert.equal(rankByIssue([{ ref: "A", matchText: "sink" }, { ref: "B", matchText: "sink" }], "sink"), null);
});

const residents = [{ id: "r1", fullName: "Tessa & Wren Marlow" }];
const requests = [req({ id: "q1", callerNumber: "+15185550142" }), req({ id: "q2", callbackNumber: "(518) 555-0177" })];

test("verification: resident caller ID or a resident's name covers the unit", () => {
  assert.deepEqual(verifyStatusCaller({ callerId: "+15185550199", callerIdIsUnitResident: true, residents, requests }), { verified: true, scope: "unit", how: "caller_id" });
  assert.deepEqual(verifyStatusCaller({ callerName: "Wren Marlow", callerIdIsUnitResident: false, residents, requests }), { verified: true, scope: "unit", how: "name" });
});

test("verification: caller ID recorded on a request covers only that request", () => {
  assert.deepEqual(verifyStatusCaller({ callerId: "+15185550142", callerIdIsUnitResident: false, callerName: "Someone Else", residents, requests }), {
    verified: true,
    scope: "requests",
    how: "caller_id_on_request",
    requestIds: ["q1"],
  });
  assert.deepEqual(verifyStatusCaller({ callerId: "5185550177", callerIdIsUnitResident: false, residents, requests }).requestIds, ["q2"]);
});

test("the tenant's preferred time is never read as a scheduled visit", () => {
  const preferred = "next week Monday";
  const say = (o) => one([req({ id: "q1", status: "work_order_created" })], [{ ...wo({ requestId: "q1", status: "assigned", ...o }), tenantPreferredTime: preferred }], true)[0];
  // Assigned with no window or due date: still unscheduled, whatever the tenant asked for.
  const unscheduled = say({});
  assert.match(unscheduled.status, /hasn't been scheduled yet/);
  assert.equal(unscheduled.visitDate, null);
  // With a real window, only that window is read out.
  const start = Date.UTC(2026, 10, 3, 18);
  const scheduled = say({ windowStart: start, windowEnd: start + 2 * 60 * 60 * 1000 });
  assert.equal(scheduled.visitDate, start);
  assert.match(scheduled.status, /Tuesday, November 3/);
  for (const item of [unscheduled, scheduled]) assert.ok(!JSON.stringify(item).includes(preferred));
});

test("verification: nothing matches, nothing disclosed", () => {
  assert.deepEqual(verifyStatusCaller({ callerId: "+15185550100", callerIdIsUnitResident: false, callerName: "Tessa Brown", residents, requests }), { verified: false });
  assert.deepEqual(verifyStatusCaller({ callerIdIsUnitResident: false, residents, requests }), { verified: false });
  // A resident flag without a real number is not caller-ID verification.
  assert.deepEqual(verifyStatusCaller({ callerId: "", callerIdIsUnitResident: true, residents: [], requests: [] }), { verified: false });
});
