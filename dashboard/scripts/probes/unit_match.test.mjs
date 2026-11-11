// Unit tests for convex/unitMatch.ts (Sarah's find_unit matching). No packages: Node's own test
// runner, and Node 22.18+ loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/unit_match.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cityOfProperty,
  matchCities,
  phoneticKey,
  saysNoUnit,
  similarUnits,
  spokenUnitKeys,
  streetWordLoose,
  streetWordSimilar,
  unitKey,
} from "../../convex/unitMatch.ts";

const labels = (xs) => xs.map((label) => ({ label, key: unitKey(label) }));
const similar = (spoken, xs) => similarUnits(spokenUnitKeys(spoken), labels(xs));

test("unitKey matches units.normalizeUnitKey's documented cases", () => {
  assert.equal(unitKey("apartment 4-B"), "4b");
  assert.equal(unitKey("Unit #4b"), "4b");
  assert.equal(unitKey("#4 B"), "4b");
  assert.equal(unitKey("unit apt 4b"), "4b");
  assert.equal(unitKey("-"), "");
});

test("spoken forms read exactly", () => {
  assert.ok(spokenUnitKeys("to").includes("2"));
  assert.ok(spokenUnitKeys("too").includes("2"));
  assert.ok(spokenUnitKeys("for").includes("4"));
  assert.ok(spokenUnitKeys("ate").includes("8"));
  assert.ok(spokenUnitKeys("be two").includes("b2"));
  assert.ok(spokenUnitKeys("B as in boy two").includes("b2"));
  assert.ok(spokenUnitKeys("bravo two").includes("b2"));
  assert.ok(spokenUnitKeys("one fourteen").includes("114"));
  assert.ok(spokenUnitKeys("one hundred fourteen").includes("114"));
  assert.ok(spokenUnitKeys("one oh one").includes("101"));
  assert.ok(spokenUnitKeys("three A").includes("3a"));
  assert.ok(spokenUnitKeys("third floor").includes("3rdfloor"));
  assert.ok(spokenUnitKeys("third floor").includes("3"));
  assert.ok(spokenUnitKeys("3rd floor").includes("3"));
  assert.ok(spokenUnitKeys("second rear").includes("2ndrear"));
  assert.ok(spokenUnitKeys("apartment number twenty one").includes("21"));
  assert.ok(spokenUnitKeys("see").includes("c"));
  // Real word labels survive.
  assert.ok(spokenUnitKeys("Garden").includes("garden"));
  assert.ok(spokenUnitKeys("garage").includes("garage"));
});

test("no-unit phrases, but a single letter is a unit", () => {
  for (const s of ["", "none", "no unit", "it's a house", "single family home"]) assert.equal(saysNoUnit(s), true, s);
  for (const s of ["A", "2", "B4", "Garden"]) assert.equal(saysNoUnit(s), false, s);
});

const GREEN_301 = Array.from({ length: 17 }, (_, i) => String(101 + i));
const STATE_687 = ["B4", "B3", "B2", "B1", "A3", "A2", "A1"];
const MADISON_1146 = ["4-3B", "4-3A", "4-2D", "4-2C", "4-2B", "4-2A", "4-1D", "4-1C", "4-1B", "4-1A"];

test("similar unit labels, best first, capped at 4", () => {
  assert.deepEqual(similar("B", STATE_687), ["B1", "B2", "B3", "B4"]);
  assert.deepEqual(similar("D2", STATE_687), ["B2"]); // sound-alike letter, never A2
  assert.deepEqual(similar("three A", MADISON_1146), ["4-3A"]);
  assert.deepEqual(similar("1", GREEN_301), ["101", "111", "102", "103"]);
  assert.deepEqual(similar("201", GREEN_301), ["101"]);
  assert.deepEqual(similar("2", ["3", "2R", "2L", "1R", "1"]), ["2L", "2R"]);
  assert.deepEqual(similar("4b", ["B4", "B3"]), ["B4"]);
});

test("nothing similar returns nothing", () => {
  assert.deepEqual(similar("Z9", GREEN_301), []);
  assert.deepEqual(similar("7", ["COM1", "2"]), []);
  assert.deepEqual(similar("D2", ["A1", "A2", "A3"]), []);
});

test("street words: phonetic key plus edit distance", () => {
  assert.equal(phoneticKey("remson"), phoneticKey("remsen"));
  assert.equal(phoneticKey("lafayet"), phoneticKey("lafayette"));
  assert.ok(streetWordSimilar("remson", "remsen") > 0);
  assert.ok(streetWordSimilar("lafayet", "lafayette") > 0);
  assert.ok(streetWordSimilar("washinton", "washington") > 0);
  assert.ok(streetWordSimilar("vranken", "franken") > 0);
  assert.equal(streetWordSimilar("evergreen", "green"), 0);
  assert.equal(streetWordSimilar("east", "west"), 0);
  assert.equal(streetWordSimilar("1st", "3rd"), 0); // short words must be exact
});

test("loose street words (only used when the house number is exactly ours)", () => {
  // The real test call: "86 Ramsden Street" and "86 Ramsay Street" for 86 Remsen Street.
  assert.ok(streetWordLoose("ramsden", "remsen") > 0);
  assert.ok(streetWordLoose("ramsay", "remsen") > 0);
  assert.ok(streetWordLoose("ramsey", "remsen") > 0);
  // Below a close match, and everything streetWordSimilar accepts is accepted.
  assert.ok(streetWordLoose("ramsay", "remsen") < streetWordSimilar("remson", "remsen"));
  assert.equal(streetWordLoose("remson", "remsen"), streetWordSimilar("remson", "remsen"));
  // Different first letter, too short, digits or unrelated: nothing.
  assert.equal(streetWordLoose("main", "remsen"), 0);
  assert.equal(streetWordLoose("rose", "remsen"), 0);
  assert.equal(streetWordLoose("river", "remsen"), 0);
  assert.equal(streetWordLoose("west", "east"), 0);
  assert.equal(streetWordLoose("5th", "4th"), 0);
  assert.equal(streetWordLoose("ram", "remsen"), 0);
});

// --- Cities (check_availability's city argument) ---------------------------------------------
// A stand-in for the cities derived from the data; nothing in the matcher knows these names.
const CITIES = ["Albany", "Clifton Park", "Cohoes", "Rensselaer", "Schenectady", "Troy", "Watervliet"];
const city = (s) => matchCities(s, CITIES);

test("cities: case, state and filler are ignored", () => {
  assert.deepEqual(city("Albany"), { status: "matched", cities: ["Albany"] });
  assert.deepEqual(city("albany ny"), { status: "matched", cities: ["Albany"] });
  assert.deepEqual(city("Albany, New York"), { status: "matched", cities: ["Albany"] });
  assert.deepEqual(city("troy ny 12180"), { status: "matched", cities: ["Troy"] });
  assert.deepEqual(city("somewhere near albany please"), { status: "matched", cities: ["Albany"] });
  assert.deepEqual(city("Clifton Park"), { status: "matched", cities: ["Clifton Park"] });
  assert.deepEqual(city("cliftonpark"), { status: "matched", cities: ["Clifton Park"] });
  assert.deepEqual(city("Water Vliet"), { status: "matched", cities: ["Watervliet"] });
});

test("cities: spelling and speech-to-text slips", () => {
  assert.deepEqual(city("Skenectady"), { status: "matched", cities: ["Schenectady"] });
  assert.deepEqual(city("Schenectedy"), { status: "matched", cities: ["Schenectady"] });
  assert.deepEqual(city("Albanie"), { status: "matched", cities: ["Albany"] });
  assert.deepEqual(city("Rensalaer"), { status: "matched", cities: ["Rensselaer"] });
  assert.deepEqual(city("Cohose"), { status: "matched", cities: ["Cohoes"] });
  assert.deepEqual(city("Troi"), { status: "matched", cities: ["Troy"] });
  // A distinctive word of a two-word city, but never a generic one.
  assert.deepEqual(city("Clifton"), { status: "matched", cities: ["Clifton Park"] });
  assert.equal(city("park").status, "unknown");
});

test("cities: several at once, in the order said", () => {
  assert.deepEqual(city("Albany or Troy"), { status: "matched", cities: ["Albany", "Troy"] });
  assert.deepEqual(city("troy and albany"), { status: "matched", cities: ["Troy", "Albany"] });
});

test("cities: no preference, not given and unknown", () => {
  for (const s of ["anywhere", "Anywhere is fine", "not sure", "the Capital Region", "no preference", "doesn't matter"]) {
    assert.equal(city(s).status, "no_preference", s);
  }
  assert.equal(city("").status, "not_given");
  assert.equal(city(undefined).status, "not_given");
  for (const s of ["Buffalo", "New York City", "Colonie", "Saratoga Springs", "Albion", "true"]) {
    assert.equal(city(s).status, "unknown", s);
  }
  // A city mentioned alongside a no-preference phrase is still a city.
  assert.deepEqual(city("anywhere in Albany"), { status: "matched", cities: ["Albany"] });
  // Nothing is hardcoded: an empty list matches nothing.
  assert.equal(matchCities("Albany", []).status, "unknown");
});

test("cityOfProperty: stored city, else the address part before the state", () => {
  assert.equal(cityOfProperty({ city: "Troy" }), "Troy");
  assert.equal(cityOfProperty({ address: { formatted: "184 Remsen Street, Cohoes, NY 12047" } }), "Cohoes");
  assert.equal(cityOfProperty({ address: { formatted: "1 Main Street, Albany, New York" } }), "Albany");
  assert.equal(cityOfProperty({ address: { formatted: "184 Remsen Street" } }), null);
  assert.equal(cityOfProperty({}), null);
});
