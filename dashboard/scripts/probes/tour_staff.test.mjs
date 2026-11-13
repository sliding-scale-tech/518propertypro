// Unit tests for B40, per-team tour staff (convex/tourStaffLib.ts): which list a team uses (saved vs
// the default of its asset managers), removed members dropped, who is in the booking pool with and
// without a chosen building, the per-person bookability checks, the no-one-bookable fallback and the
// Settings warning. Also: the tour prompt and tools pass the chosen listing to find_tour_times, and
// the tour address only ever comes from Sarah's own listing results. No packages, no network.
// From dashboard/:
//   node --test scripts/probes/tour_staff.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        try {
          return next(`${specifier}.ts`, context);
        } catch {
          return next(`${specifier}.js`, context);
        }
      }
      throw err;
    }
  },
});

const S = await import("../../convex/tourStaffLib.ts");
const A = await import("../../convex/agents.ts");
const P = await import("../../convex/tourPrompt.ts");

const NINA = "u_nina";
const NIKKI = "u_nikki";
const DELIA = "u_delia";
const PAT = "u_pat";
const GONE = "u_gone"; // was on the team, since removed
const members = new Set([NINA, NIKKI, DELIA, PAT]);

test("teams: the three categories, with labels; anything else is not a team", () => {
  assert.deepEqual([...S.TOUR_TEAMS], ["gold", "silver", "make_up"]);
  assert.equal(S.TOUR_TEAM_LABEL.make_up, "Make Up");
  for (const t of S.TOUR_TEAMS) assert.ok(S.isTourTeam(t));
  for (const bad of ["Gold", "bronze", "", null, undefined, 3]) assert.equal(S.isTourTeam(bad), false);
});

test("default: the team's asset managers, distinct, most units first, members only", () => {
  // Gold: Nina on 3 units, Pat on 1 (a unit covered by someone else), a removed member on 2.
  const unitAMs = [PAT, NINA, GONE, NINA, GONE, NINA];
  assert.deepEqual(S.defaultTourStaff(unitAMs, members), [NINA, PAT]);
  // Ties keep the order first seen.
  assert.deepEqual(S.defaultTourStaff([NIKKI, DELIA, DELIA, NIKKI], members), [NIKKI, DELIA]);
  assert.deepEqual(S.defaultTourStaff([], members), []);
});

test("resolve: no saved list means the default; a saved list wins, even an empty one", () => {
  assert.deepEqual(S.resolveTourStaff(null, [NINA], members), { userIds: [NINA], isDefault: true });
  assert.deepEqual(S.resolveTourStaff(undefined, [NINA], members), { userIds: [NINA], isDefault: true });
  assert.deepEqual(S.resolveTourStaff([PAT, NIKKI], [NINA], members), { userIds: [PAT, NIKKI], isDefault: false });
  // Empty saved list: nobody (Sarah then takes a preferred time), not the default.
  assert.deepEqual(S.resolveTourStaff([], [NINA], members), { userIds: [], isDefault: false });
});

test("resolve: removed members are dropped silently, duplicates once", () => {
  assert.deepEqual(S.resolveTourStaff([GONE, NINA, NINA, PAT], [], members).userIds, [NINA, PAT]);
  assert.deepEqual(S.resolveTourStaff(null, [GONE, DELIA], members).userIds, [DELIA]);
  // A saved list of only removed people is empty: the fallback, never a widened pool.
  assert.deepEqual(S.resolveTourStaff([GONE], [NINA], members).userIds, []);
});

const m = (userId, extra = {}) => ({ userId, createdAt: 1, ...extra });
const memberships = [
  m(NINA, { leadAssignee: true, jobRoles: ["asset_manager"] }),
  m(NIKKI, { jobRoles: ["asset_manager"] }), // not a lead assignee
  m(DELIA, { leadAssignee: true, jobRoles: ["accountant"] }), // lead assignee without the AM role
  m(PAT, { jobRoles: ["executive"] }),
];
const ids = (rows) => rows.map((r) => r.userId);

test("pool, no building chosen: today's pool exactly (lead assignees with the asset_manager role)", () => {
  assert.deepEqual(ids(S.poolCandidates(memberships, null)), [NINA]);
});

test("pool, building chosen: only that team's list, in its order, no lead-assignee or role requirement", () => {
  assert.deepEqual(ids(S.poolCandidates(memberships, [NIKKI, PAT])), [NIKKI, PAT]);
  assert.deepEqual(ids(S.poolCandidates(memberships, [DELIA])), [DELIA]);
  // Not a member any more: dropped; duplicates once.
  assert.deepEqual(ids(S.poolCandidates(memberships, [GONE, NIKKI, NIKKI])), [NIKKI]);
  // Empty team list: an empty pool (the no-calendar fallback), never today's pool.
  assert.deepEqual(ids(S.poolCandidates(memberships, [])), []);
});

test("bookable: connected calendar Google accepts, taking tours, not out of office", () => {
  const now = 1_000_000;
  const ok = { calendar: "connected" };
  assert.equal(S.bookable(ok, now), true);
  assert.equal(S.bookable({ ...ok, availableForTours: true }, now), true);
  assert.equal(S.bookable({ ...ok, availableForTours: false }, now), false);
  assert.equal(S.bookable({ ...ok, unavailableUntil: now + 1 }, now), false);
  assert.equal(S.bookable({ ...ok, unavailableUntil: now - 1 }, now), true); // out of office has ended
  assert.equal(S.bookable({ calendar: "needs_reconnect" }, now), false);
  assert.equal(S.bookable({ calendar: "not_connected" }, now), false);
});

test("calendar state from the connection row", () => {
  assert.equal(S.calendarState(null), "not_connected");
  assert.equal(S.calendarState(undefined), "not_connected");
  assert.equal(S.calendarState({}), "connected");
  assert.equal(S.calendarState({ invalidAt: 5 }), "needs_reconnect");
});

test("nobody bookable: a reason per pool (logs only); today's wording kept without a building", () => {
  assert.equal(S.noOneBookableReason(null), "No lead-assignee asset manager has a calendar connected and is taking tours.");
  assert.match(S.noOneBookableReason("gold"), /Gold tour list/);
});

test("settings warning: empty list, nobody bookable, or none", () => {
  assert.equal(
    S.tourStaffWarning("gold", []),
    "No one gives tours for Gold buildings; Sarah will take the caller's preferred time.",
  );
  const p = (calendar, takingTours = true, outOfOffice = false) => ({ calendar, takingTours, outOfOffice });
  assert.match(S.tourStaffWarning("silver", [p("not_connected"), p("connected", false), p("connected", true, true)]), /No one on this list can be booked/);
  assert.equal(S.tourStaffWarning("make_up", [p("not_connected"), p("connected")]), null);
});

test("tools: find_tour_times takes the listing; every tour building comes from Sarah's own results", () => {
  const defs = A.toolDefsFor("https://example.convex.site", false);
  const byName = (n) => defs.find((d) => d.name === n);
  const find = byName("find_tour_times");
  assert.ok(find.properties.spoken_building);
  assert.ok(find.properties.spoken_unit);
  assert.ok(!find.required.includes("spoken_building"));
  assert.match(find.description, /spoken_building/);
  for (const name of ["find_tour_times", "request_tour", "reschedule_tour"]) {
    assert.match(byName(name).properties.spoken_building.description, /not in your results/, name);
  }
});

test("prompt: the listing is settled first and passed to find_tour_times; caller-said addresses refused", () => {
  const block = P.TOUR_BOOKING_BLOCK.replace(/\s+/g, " ");
  assert.ok(block.includes("A tour is for ONE available listing from a tool result in this call"));
  assert.ok(block.includes("Never use a building address the caller says that is not in your results"));
  assert.ok(block.includes("1. Settle the listing first."));
  assert.ok(block.includes("offer at most three, by address and rent"));
  assert.ok(block.includes("say that one isn't showing as available and offer what is"));
  assert.ok(block.includes("Pass the listing as spoken_building (and spoken_unit) every time."));
  // The no-building path stays as the safety net.
  assert.ok(block.includes("Only if there are no listings at all, or they insist on a tour without choosing"));
  // Moving a tour still refers to steps 2 to 5, and the address correction to step 7.
  assert.ok(block.includes("follow TOUR BOOKING steps 2 to 5"));
  assert.ok(block.includes("read back the listing from your results they mean"));
});
