// Sarah config page tabs (pure, no packages). From dashboard/:  node --test scripts/probes/sarah_tabs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const T = await import("../../components/sarah/sarah-tabs.ts");

test("by default only Emergency scripts, Escalation contacts and Identity show", () => {
  assert.deepEqual(
    T.visibleSarahTabs(false).map((t) => t.id),
    ["emergency", "escalation", "identity"],
  );
});

test("Advanced shows every tab, and Phone line / Routing directory are gone from the page", () => {
  const ids = T.visibleSarahTabs(true).map((t) => t.id);
  assert.equal(ids.length, 9);
  assert.ok(!ids.includes("routing"));
  assert.ok(!ids.includes("phone-line"));
  for (const b of T.BASIC_TABS) assert.ok(ids.includes(b));
});

test("a deep link to a hidden tab switches Advanced on and shows that tab", () => {
  assert.deepEqual(T.initialSarahView("leasing", false), { tab: "leasing", advanced: true, redirectTo: null });
  assert.deepEqual(T.initialSarahView("emergency", false), { tab: "emergency", advanced: false, redirectTo: null });
  assert.deepEqual(T.initialSarahView("emergency", true), { tab: "emergency", advanced: true, redirectTo: null });
});

test("old routing and phone-line links go to the Team page", () => {
  assert.equal(T.initialSarahView("routing", false).redirectTo, "/team?tab=phone");
  assert.equal(T.initialSarahView("phone-line", true).redirectTo, "/team?tab=phone");
});

test("no or unknown tab lands on the first visible tab", () => {
  assert.equal(T.initialSarahView(null, false).tab, "emergency");
  assert.equal(T.initialSarahView("nope", false).tab, "emergency");
  assert.equal(T.initialSarahView(null, true).tab, "call-types");
});
