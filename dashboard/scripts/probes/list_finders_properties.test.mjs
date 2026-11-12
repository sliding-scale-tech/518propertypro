// Tests for the Properties list and unit inventory finders (components/properties/property-finders.ts).
//   node --test scripts/probes/list_finders_properties.test.mjs
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
const F = await import("../../components/properties/property-finders.ts");

const props = [
  { name: "Zeta Court", address: { formatted: "9 Elm St, Albany" }, category: "silver", ownerName: "Kim Lee", unitCount: 4 },
  { name: "alpha house", address: null, category: "gold", ownerName: null, unitCount: 12 },
  { name: "Mid Plaza", address: { formatted: "1 Main St" }, category: undefined, ownerName: "Pat", unitCount: 2 },
];

test("properties: search matches name, address and owner, case/space-insensitive", () => {
  assert.equal(F.propertiesView(props, { q: "ELM" }).length, 1);
  assert.equal(F.propertiesView(props, { q: "  kim  lee " })[0].name, "Zeta Court");
  assert.equal(F.propertiesView(props, { q: "" }).length, 3);
  assert.equal(F.propertiesView(props, { q: "nope" }).length, 0);
});

test("properties: team filter", () => {
  assert.deepEqual(F.propertiesView(props, { team: "gold" }).map((p) => p.name), ["alpha house"]);
  assert.equal(F.propertiesView(props, { team: "make_up" }).length, 0);
});

test("properties: sorts (name default, units numeric, address nulls last, team rank)", () => {
  assert.deepEqual(F.propertiesView(props, {}).map((p) => p.name), ["alpha house", "Mid Plaza", "Zeta Court"]);
  assert.deepEqual(F.propertiesView(props, { sort: { key: "units", dir: "desc" } }).map((p) => p.unitCount), [12, 4, 2]);
  const byAddr = F.propertiesView(props, { sort: { key: "address", dir: "asc" } }).map((p) => p.name);
  assert.equal(byAddr.at(-1), "alpha house");
  assert.deepEqual(F.propertiesView(props, { sort: { key: "team", dir: "asc" } }).map((p) => p.name), ["alpha house", "Zeta Court", "Mid Plaza"]);
});

const units = [
  { _id: "a", unitNumber: "10", bedrooms: "1br", rent: 1500, available: true, assetManagerName: "Nina" },
  { _id: "b", unitNumber: "2", bedrooms: "2br", rent: undefined, available: false, assetManagerName: "Nikki" },
  { _id: "c", unitNumber: "3A", bedrooms: "studio", rent: 900, available: false, assetManagerName: "Nina" },
];
const tenants = { a: ["Sam Cho"], b: [], c: ["Ann Roe", "Bo Roe"] };
const tOf = (u) => tenants[u._id];

test("units: natural unit sort, tenant / status / manager search", () => {
  assert.deepEqual(F.unitsView(units, tOf, {}).map((u) => u.unitNumber), ["2", "3A", "10"]);
  assert.deepEqual(F.unitsView(units, tOf, { q: "roe" }).map((u) => u._id), ["c"]);
  assert.deepEqual(F.unitsView(units, tOf, { q: "vacant" }).map((u) => u._id), ["b"]);
  assert.deepEqual(F.unitsView(units, tOf, { q: "nikki" }).map((u) => u._id), ["b"]);
});

test("units: filters and rent sort (missing rent last in both directions)", () => {
  assert.deepEqual(F.unitsView(units, tOf, { filter: "available" }).map((u) => u._id), ["a"]);
  assert.deepEqual(F.unitsView(units, tOf, { filter: "unavailable" }).map((u) => u._id), ["b", "c"]);
  assert.deepEqual(F.unitsView(units, tOf, { filter: "vacant" }).map((u) => u._id), ["b"]);
  assert.deepEqual(F.unitsView(units, tOf, { sort: { key: "rent", dir: "asc" } }).map((u) => u._id), ["c", "a", "b"]);
  assert.deepEqual(F.unitsView(units, tOf, { sort: { key: "rent", dir: "desc" } }).map((u) => u._id), ["a", "c", "b"]);
});
