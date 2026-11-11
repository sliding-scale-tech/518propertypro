// Unit tests for isVagueIssue (convex/sanitize.ts): the check that stops log_maintenance_request
// creating and routing a request before the caller has said what is wrong (test call 2026-11-02:
// "Maintenance complaint." was logged and sent to the asset manager). No packages: Node's own
// test runner, and Node 22.18+ loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/vague_issue.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVagueIssue } from "../../convex/sanitize.ts";

test("blank, missing and placeholder descriptions are vague", () => {
  for (const d of [undefined, null, "", "   ", "unknown", "N/A", "none", "-"]) {
    assert.equal(isVagueIssue(d), true, String(d));
  }
});

test("generic 'it's maintenance' descriptions are vague", () => {
  for (const d of [
    "Maintenance complaint.",
    "maintenance issue",
    "Maintenance request",
    "Caller has a maintenance complaint.",
    "Resident reports an issue with their apartment.",
    "Something is broken in my unit",
    "It's broken.",
    "Something is not working",
    "There is a problem.",
    "Repair needed",
    "Question, not a repair:",
    "General maintenance, details not yet provided",
  ]) {
    assert.equal(isVagueIssue(d), true, d);
  }
});

test("the caller's own name, address and unit don't make it specific", () => {
  const known = ["Tom Martin", "1 Washington Avenue", "1"];
  assert.equal(isVagueIssue("Tom Martin at 1 Washington Avenue, unit 1, has a maintenance complaint.", known), true);
  assert.equal(isVagueIssue("Maintenance complaint for 4B", ["", "", "4B"]), true);
  assert.equal(isVagueIssue("Issue on the 3rd floor of the building, apt 4B"), true);
  // Without the call's address, an unknown street word counts as content: allowed through.
  assert.equal(isVagueIssue("Maintenance complaint at 1 Washington Avenue"), false);
});

test("any real word about the problem makes it specific", () => {
  for (const d of [
    "Kitchen sink is leaking under the cabinet.",
    "No heat",
    "No hot water in the shower since last night.",
    "Broken window in the bedroom.",
    "Heater not working",
    "Toilet keeps running",
    "Light bulb in the hallway is out",
    "There is a leak",
    "Mold on the bathroom ceiling",
    "Question, not a repair: when is the package room open?",
    "Front door lock is broken",
  ]) {
    assert.equal(isVagueIssue(d), false, d);
  }
  const known = ["Tom Martin", "1 Washington Avenue", "1"];
  assert.equal(isVagueIssue("Tom Martin at 1 Washington Avenue unit 1: the radiator is cold.", known), false);
});

test("'someone is reporting something' sentences with no problem are vague (#1010)", () => {
  const d = "Resident Tom Martin reporting a maintenance issue.";
  // Name known from the call, and name missing (the model omitted caller_name).
  assert.equal(isVagueIssue(d, ["Tom Martin", "1 Washington Avenue", "1"]), true);
  assert.equal(isVagueIssue(d, ["", "1 Washington Avenue", "1"]), true);
  assert.equal(isVagueIssue(d), true);
  for (const v of [
    "Tom Martin reporting a maintenance issue",
    "Tenant Maria Lopez calling about a maintenance request.",
    "Occupant Sam wants help with a problem",
    "Renter needs assistance regarding a concern",
  ]) {
    assert.equal(isVagueIssue(v), true, v);
  }
});

test("real issues are never vague", () => {
  for (const d of [
    "door knob broken",
    "sink leaking",
    "no heat",
    "toilet running",
    "window cracked",
    "Broken door knob",
    "the stove does not work",
    "mold in bathroom",
    "lock jammed",
    "smoke alarm beeping",
    "ceiling leak",
    "no hot water",
    "Leak reporting",
    "Resident Tom Martin reporting a leaking sink.",
    "Resident Tom Martin reporting mold",
    "Tom Martin",
  ]) {
    assert.equal(isVagueIssue(d), false, d);
    assert.equal(isVagueIssue(d, ["Tom Martin", "1 Washington Avenue", "1"]), d === "Tom Martin", d);
  }
});
