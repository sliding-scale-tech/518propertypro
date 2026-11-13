// Tests for the Tenants lists' pure helpers: convex/tenantViews.ts (paging, filters, search, sort of
// residents / resident calls / callbacks) and components/residents/tenant-list-params.ts (URL reads).
// From dashboard/:  node --test scripts/probes/tenants_paging.test.mjs
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
const V = await import("../../convex/tenantViews.ts");
const P = await import("../../components/residents/tenant-list-params.ts");

// --- paging -------------------------------------------------------------------------------------

test("pageOf: slices, counts and clamps", () => {
  const rows = Array.from({ length: 120 }, (_, i) => i + 1);
  const p1 = V.pageOf(rows, 1, 50);
  assert.equal(p1.rows.length, 50);
  assert.equal(p1.total, 120);
  assert.equal(p1.pageCount, 3);
  const p3 = V.pageOf(rows, 3, 50);
  assert.deepEqual(p3.rows, rows.slice(100));
  assert.equal(V.pageOf(rows, 99, 50).page, 3, "past the end shows the last page");
  assert.equal(V.pageOf(rows, 0, 50).page, 1);
  assert.equal(V.pageOf(rows, Number.NaN, 50).page, 1);
  assert.equal(V.pageOf(rows, undefined, undefined).pageSize, 50);
  assert.equal(V.pageOf(rows, 1, 7).pageSize, 50, "an unoffered size falls back to the default");
  assert.equal(V.pageOf(rows, 1, 25).pageCount, 5);
});

test("pageOf: an empty list is page 1 of 1 with total 0", () => {
  const p = V.pageOf([], 4, 25);
  assert.deepEqual([p.rows.length, p.total, p.page, p.pageCount], [0, 0, 1, 1]);
});

test("no row is lost or repeated across pages (more than the old 2000 cap)", () => {
  const rows = Array.from({ length: 2503 }, (_, i) => i);
  const seen = [];
  const count = V.pageOf(rows, 1, 100).pageCount;
  for (let page = 1; page <= count; page++) seen.push(...V.pageOf(rows, page, 100).rows);
  assert.equal(seen.length, 2503);
  assert.equal(new Set(seen).size, 2503);
});

// --- residents ----------------------------------------------------------------------------------

const res = (o) => ({
  fullName: "Ann Lee",
  phones: [],
  active: true,
  unitNumber: "1A",
  propertyId: "p1",
  propertyName: "108 Jackson Avenue",
  category: "gold",
  ...o,
});
const residents = [
  res({ fullName: "Zed Young", unitNumber: "10", phones: ["+15185550123"] }),
  res({ fullName: "Amy Park", unitNumber: "2", leaseEnd: "2027-06-30", email: "amy@example.com" }),
  res({ fullName: "Bob Moved", unitNumber: "3", active: false, propertyId: "p2", propertyName: "687 State Street", category: "silver" }),
  res({ fullName: "Cy Dunn", unitNumber: "1", leaseEnd: "2026-12-31", propertyId: "p2", propertyName: "687 State Street", category: "silver" }),
];
const names = (rows) => rows.map((r) => r.fullName);

test("residentsView: defaults to active residents, name A-Z", () => {
  assert.deepEqual(names(V.residentsView(residents, {})), ["Amy Park", "Cy Dunn", "Zed Young"]);
});

test("residentsView: status, property and team filters", () => {
  assert.deepEqual(names(V.residentsView(residents, { status: "inactive" })), ["Bob Moved"]);
  assert.equal(V.residentsView(residents, { status: "all" }).length, 4);
  assert.deepEqual(names(V.residentsView(residents, { propertyId: "p2" })), ["Cy Dunn"]);
  assert.deepEqual(names(V.residentsView(residents, { team: "silver", status: "all" })), ["Bob Moved", "Cy Dunn"]);
});

test("residentsView: search name, unit, property, email and phone digits", () => {
  assert.deepEqual(names(V.residentsView(residents, { q: "  AMY " })), ["Amy Park"]);
  assert.deepEqual(names(V.residentsView(residents, { q: "state" })), ["Cy Dunn"]);
  assert.deepEqual(names(V.residentsView(residents, { q: "amy@example" })), ["Amy Park"]);
  assert.deepEqual(names(V.residentsView(residents, { q: "(518) 555-0123" })), ["Zed Young"]);
  assert.deepEqual(names(V.residentsView(residents, { q: "nobody" })), []);
  // one or two digits are not a phone search ("2" is matched on the unit only)
  assert.deepEqual(names(V.residentsView(residents, { q: "2" })), ["Amy Park"]);
});

test("residentsView: sorts; unit is natural (2 before 10); missing lease end always last", () => {
  assert.deepEqual(names(V.residentsView(residents, { sort: { key: "name", dir: "desc" } })), ["Zed Young", "Cy Dunn", "Amy Park"]);
  assert.deepEqual(names(V.residentsView(residents, { sort: { key: "unit", dir: "asc" } })), ["Amy Park", "Zed Young", "Cy Dunn"]);
  assert.deepEqual(names(V.residentsView(residents, { sort: { key: "lease", dir: "asc" } })), ["Cy Dunn", "Amy Park", "Zed Young"]);
  assert.deepEqual(names(V.residentsView(residents, { sort: { key: "lease", dir: "desc" } })), ["Amy Park", "Cy Dunn", "Zed Young"]);
  assert.deepEqual(names(V.residentsView(residents, { status: "all", sort: { key: "status", dir: "asc" } })).at(-1), "Bob Moved");
});

// --- resident calls -----------------------------------------------------------------------------

const call = (o) => ({
  reason: "Leak",
  severity: 4,
  status: "open",
  statusLabel: "Open",
  createdAt: 1000,
  durationSec: null,
  ...o,
});
const calls = [
  call({ callerName: "Dee", reason: "Heat out", severity: 8, createdAt: 3000, callType: "maintenance", mrNumber: "MR-12", durationSec: 90 }),
  call({ callerName: "Eve", reason: "Noise", severity: 2, createdAt: 5000, category: "noise", callerNumber: "+15185550999" }),
  call({ callerName: "Fay", reason: "Rent q", severity: 5, createdAt: 4000, status: "resolved", statusLabel: "Resolved", durationSec: 30 }),
];
const callers = (rows) => rows.map((r) => r.callerName);

test("callsView: open only, newest first by default", () => {
  assert.deepEqual(callers(V.callsView(calls, {})), ["Eve", "Dee"]);
  assert.deepEqual(callers(V.callsView(calls, { status: "all" })), ["Eve", "Fay", "Dee"]);
  assert.deepEqual(callers(V.callsView(calls, { status: "resolved" })), ["Fay"]);
});

test("callsView: severity band, call type (callType else category) and search", () => {
  assert.deepEqual(callers(V.callsView(calls, { status: "all", severity: "high" })), ["Dee"]);
  assert.deepEqual(callers(V.callsView(calls, { status: "all", severity: "low" })), ["Eve"]);
  assert.deepEqual(callers(V.callsView(calls, { type: "noise" })), ["Eve"]);
  assert.deepEqual(callers(V.callsView(calls, { q: "mr-12" })), ["Dee"]);
  assert.deepEqual(callers(V.callsView(calls, { q: "555 0999" })), ["Eve"]);
  assert.deepEqual(V.callsView(calls, { q: "zzz" }), []);
  assert.equal(V.callTypeOf({ category: "x" }), "x");
  assert.equal(V.callTypeOf({}), "");
});

test("callsView: sort by severity and duration (missing duration last)", () => {
  assert.deepEqual(callers(V.callsView(calls, { status: "all", sort: { key: "severity", dir: "desc" } })), ["Dee", "Fay", "Eve"]);
  assert.deepEqual(callers(V.callsView(calls, { status: "all", sort: { key: "duration", dir: "asc" } })), ["Fay", "Dee", "Eve"]);
  assert.deepEqual(callers(V.callsView(calls, { status: "all", sort: { key: "duration", dir: "desc" } })), ["Dee", "Fay", "Eve"]);
});

// --- callbacks ----------------------------------------------------------------------------------

const cb = (o) => ({
  callerName: null,
  callbackNumber: null,
  callerEmail: null,
  reason: "no unit",
  issueSummary: "Needs a call",
  assignedName: null,
  status: "open",
  ...o,
});
const cbs = [
  cb({ callerName: "Gus", callbackNumber: "518-555-0100", status: "open" }),
  cb({ callerName: "Hal", callerEmail: "hal@x.com", status: "closed", assignedName: "Nina Gold" }),
  cb({ callerName: null, issueSummary: "Boiler broken", status: "called_back" }),
];

test("callbacksView: status and search keep the incoming (newest-first) order", () => {
  assert.equal(V.callbacksView(cbs, {}).length, 3);
  assert.deepEqual(V.callbacksView(cbs, { status: "open" }).map((r) => r.callerName), ["Gus"]);
  assert.equal(V.callbacksView(cbs, { q: "boiler" }).length, 1);
  assert.equal(V.callbacksView(cbs, { q: "5185550100" }).length, 1);
  assert.equal(V.callbacksView(cbs, { q: "hal@x" }).length, 1);
  assert.equal(V.callbacksView(cbs, { q: "nina" }).length, 1);
  assert.equal(V.callbacksView(cbs, { q: "nope" }).length, 0);
});

test("countByStatus: per status and overall", () => {
  assert.deepEqual(V.countByStatus(cbs), { open: 1, called_back: 1, closed: 1, all: 3 });
  assert.deepEqual(V.countByStatus([]), { open: 0, called_back: 0, closed: 0, all: 0 });
});

// --- URL params ---------------------------------------------------------------------------------

test("filtersAtDefault: true only when every filter is at its default", () => {
  const d = { q: "", status: "open", severity: "all", type: "all" };
  assert.equal(P.filtersAtDefault({ q: "", status: "open", severity: "all", type: "all" }, d), true);
  assert.equal(P.filtersAtDefault({}, d), true);
  assert.equal(P.filtersAtDefault({ status: "resolved" }, d), false);
  assert.equal(P.filtersAtDefault({ q: "leak" }, d), false);
  assert.equal(P.filtersAtDefault({ severity: "high", status: "open" }, d), false);
});

test("readChoice: only an allowed value, else the fallback", () => {
  assert.equal(P.readChoice("all", ["active", "inactive", "all"], "active"), "all");
  assert.equal(P.readChoice("bogus", ["active", "all"], "active"), "active");
  assert.equal(P.readChoice(null, ["active", "all"], "active"), "active");
  assert.equal(P.readChoice("", ["active", "all"], "active"), "active");
});

test("nextQuery: sets and clears keys and always drops the page", () => {
  assert.equal(P.nextQuery("tab=residents&page=3", { status: "all" }), "tab=residents&status=all");
  assert.equal(P.nextQuery("tab=residents&status=all&page=2", { status: null }), "tab=residents");
  assert.equal(P.nextQuery("tab=calls&q=leak", { q: "" }), "tab=calls");
  assert.equal(P.nextQuery("size=25&page=2", { sort: "name", dir: "desc" }), "size=25&sort=name&dir=desc");
});
