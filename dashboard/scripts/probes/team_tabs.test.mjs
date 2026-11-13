// Team page tabs (pure, no packages). From dashboard/:  node --test scripts/probes/team_tabs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const T = await import("../../components/team/team-tabs.ts");

test("an admin sees all four tabs in order", () => {
  assert.deepEqual(
    T.visibleTeamTabs(true).map((t) => t.value),
    ["members", "routing", "settings", "audit"],
  );
});

test("a non-admin sees only Members and Settings", () => {
  assert.deepEqual(
    T.visibleTeamTabs(false).map((t) => t.value),
    ["members", "settings"],
  );
});

test("parseTeamTab: known tabs pass, admin-only tabs fall back for non-admins, junk falls back", () => {
  assert.equal(T.parseTeamTab("audit", true), "audit");
  assert.equal(T.parseTeamTab("routing", true), "routing");
  assert.equal(T.parseTeamTab("audit", false), "members");
  assert.equal(T.parseTeamTab("routing", false), "members");
  assert.equal(T.parseTeamTab("settings", false), "settings");
  assert.equal(T.parseTeamTab("nope", true), "members");
  assert.equal(T.parseTeamTab(null, true), "members");
  assert.equal(T.parseTeamTab(undefined, false), "members");
});

test("teamTabHref: Members is the bare path, the old /audit redirect target still works", () => {
  assert.equal(T.teamTabHref("members"), "/team");
  assert.equal(T.teamTabHref("audit"), "/team?tab=audit");
  assert.equal(T.teamTabHref("routing"), "/team?tab=routing");
  assert.equal(T.teamTabHref("settings"), "/team?tab=settings");
});
