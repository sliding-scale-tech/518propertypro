// Tests for the Property assignments table helpers (components/asset-managers/assignments-view.ts).
//   node --test scripts/probes/assignments_view.test.mjs
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
const V = await import("../../components/asset-managers/assignments-view.ts");

const rows = [
  { _id: "p1", name: "12 Oak St", address: { formatted: "12 Oak St, Albany" }, category: "silver", ownerName: "Kim Lee", unitCount: 4, defaultAssetManagerUserId: "nina" },
  { _id: "p2", name: "3 Elm Ave", address: null, category: "gold", ownerName: null, unitCount: 12, defaultAssetManagerUserId: "nikki" },
  { _id: "p3", name: "100 Main St", address: { formatted: "100 Main St" }, category: undefined, unitCount: 2 },
  { _id: "p4", name: "9 Birch Rd", category: "gold", unitCount: 7, defaultAssetManagerUserId: "nina" },
];
const names = (r) => r.map((p) => p.name);

test("search matches building name or address, not the owner", () => {
  assert.deepEqual(names(V.assignmentsView(rows, { q: "  OAK " })), ["12 Oak St"]);
  assert.deepEqual(names(V.assignmentsView(rows, { q: "albany" })), ["12 Oak St"]);
  assert.equal(V.assignmentsView(rows, { q: "kim" }).length, 0);
  assert.equal(V.assignmentsView(rows, { q: "" }).length, 4);
  assert.equal(V.assignmentsView(rows, { q: null }).length, 4);
});

test("team filter: a team, or all when empty / null", () => {
  assert.deepEqual(names(V.assignmentsView(rows, { team: "gold" })), ["3 Elm Ave", "9 Birch Rd"]);
  assert.equal(V.assignmentsView(rows, { team: "" }).length, 4);
  assert.equal(V.assignmentsView(rows, { team: null }).length, 4);
});

test("asset manager filter: one person, nobody, or anyone", () => {
  assert.deepEqual(names(V.assignmentsView(rows, { am: "nina" })), ["9 Birch Rd", "12 Oak St"]);
  assert.deepEqual(names(V.assignmentsView(rows, { am: V.AM_FILTER_NONE })), ["100 Main St"]);
  assert.equal(V.assignmentsView(rows, { am: "" }).length, 4);
  assert.equal(V.assignmentsView(rows, { am: null }).length, 4);
  assert.equal(V.assignmentsView(rows, { am: "someone-else" }).length, 0);
});

test("filters combine (AND)", () => {
  assert.deepEqual(names(V.assignmentsView(rows, { am: "nina", team: "gold" })), ["9 Birch Rd"]);
  assert.equal(V.assignmentsView(rows, { am: "nina", team: "gold", q: "oak" }).length, 0);
});

test("sorts by building (natural), team (Gold, Silver, Make Up, none) and units; no input is changed", () => {
  const before = names(rows);
  assert.deepEqual(names(V.assignmentsView(rows, {})), ["3 Elm Ave", "9 Birch Rd", "12 Oak St", "100 Main St"]);
  assert.deepEqual(names(V.assignmentsView(rows, { sort: { key: "name", dir: "desc" } })), ["100 Main St", "12 Oak St", "9 Birch Rd", "3 Elm Ave"]);
  assert.deepEqual(names(V.assignmentsView(rows, { sort: { key: "team", dir: "asc" } })), ["3 Elm Ave", "9 Birch Rd", "12 Oak St", "100 Main St"]);
  assert.deepEqual(names(V.assignmentsView(rows, { sort: { key: "units", dir: "desc" } })), ["3 Elm Ave", "9 Birch Rd", "12 Oak St", "100 Main St"]);
  assert.deepEqual(names(rows), before);
});

test("manager summary: building count, teams in Gold/Silver/Make Up order, buildings with no team", () => {
  assert.deepEqual(V.managerSummary(rows, "nina"), { buildings: 2, teams: ["gold", "silver"], noTeam: 0 });
  assert.deepEqual(V.managerSummary(rows, "nikki"), { buildings: 1, teams: ["gold"], noTeam: 0 });
  assert.deepEqual(V.managerSummary(rows, "nobody"), { buildings: 0, teams: [], noTeam: 0 });
  const noTeam = [{ _id: "x", name: "X", category: null, unitCount: 1, defaultAssetManagerUserId: "u" }];
  assert.deepEqual(V.managerSummary(noTeam, "u"), { buildings: 1, teams: [], noTeam: 1 });
});
