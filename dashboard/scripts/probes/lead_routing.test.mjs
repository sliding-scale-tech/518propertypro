// Unit tests for B41, leads routed by building (convex/leadRoutingLib.ts): a new lead is unassigned,
// picking a building sends it to that building's asset manager (the one with the most units there when
// split), a manual (or pre-B41) assignment is never overridden, and a building switch re-routes only an
// automatic assignment. Also the "new lead" text recipients, and that log_lead and the leasing prompt
// carry the chosen listing. No packages, no network. From dashboard/:
//   node --test scripts/probes/lead_routing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const L = await import("../../convex/leadRoutingLib.ts");
const A = await import("../../convex/agents.ts");
const C = await import("../../convex/sarahConfigLib.ts");

const NINA = "u_nina";
const NIKKI = "u_nikki";
const DELIA = "u_delia";
const GONE = "u_gone";
const members = new Set([NINA, NIKKI, DELIA]);
const BLDG_A = "p_a";
const BLDG_B = "p_b";

test("building asset manager: the only one, the majority when split, first seen on a tie", () => {
  assert.equal(L.buildingAssetManager([NINA, NINA, NINA], members), NINA);
  assert.equal(L.buildingAssetManager([NIKKI, NINA, NINA, NIKKI, NINA], members), NINA);
  assert.equal(L.buildingAssetManager([NIKKI, NINA, NINA, NIKKI], members), NIKKI);
});

test("building asset manager: removed members are skipped; none left means null", () => {
  assert.equal(L.buildingAssetManager([GONE, GONE, GONE, DELIA], members), DELIA);
  assert.equal(L.buildingAssetManager([GONE], members), null);
  assert.equal(L.buildingAssetManager([], members), null);
});

test("unassigned lead + building picked: assigned to that building's asset manager", () => {
  const d = L.decideBuildingRoute({}, { propertyId: BLDG_A, assetManagerUserId: NINA });
  assert.deepEqual(d, { action: "assign", userId: NINA, propertyId: BLDG_A, ownerChanged: true });
});

test("unassigned lead + building with no asset manager: stays unassigned", () => {
  assert.deepEqual(L.decideBuildingRoute({}, { propertyId: BLDG_A, assetManagerUserId: null }), {
    action: "keep",
    why: "no_asset_manager",
  });
});

test("manual assignment is never overridden, whatever building is picked", () => {
  const lead = { assignedUserId: DELIA, assignedBy: "manual" };
  for (const am of [NINA, DELIA, null]) {
    assert.deepEqual(L.decideBuildingRoute(lead, { propertyId: BLDG_B, assetManagerUserId: am }), {
      action: "keep",
      why: "manual",
    });
  }
});

test("a manual lead that kept its building is still never re-routed by Sarah", () => {
  // assignLead no longer clears assignedPropertyId, so a hand-assigned lead carries the building.
  const lead = { assignedUserId: DELIA, assignedBy: "manual", assignedPropertyId: BLDG_A };
  for (const [propertyId, am] of [[BLDG_A, NINA], [BLDG_B, NINA], [BLDG_A, DELIA], [BLDG_B, null]]) {
    assert.deepEqual(L.decideBuildingRoute(lead, { propertyId, assetManagerUserId: am }), { action: "keep", why: "manual" });
  }
  // Set back to Unassigned with the building kept: the next building the caller picks routes it again.
  assert.deepEqual(
    L.decideBuildingRoute({ assignedPropertyId: BLDG_A }, { propertyId: BLDG_B, assetManagerUserId: NINA }),
    { action: "assign", userId: NINA, propertyId: BLDG_B, ownerChanged: true },
  );
});

test("assignLead keeps assignedPropertyId (manual assignment and unassign)", () => {
  const src = readFileSync(new URL("../../convex/leads.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export const assignLead"), src.indexOf("// --- Unmatched callers"));
  assert.doesNotMatch(body, /assignedPropertyId/);
  assert.match(body, /assignedBy: "manual"/);
});

test("a pre-B41 assignment (assignee, no assignedBy) counts as manual and does not move", () => {
  assert.equal(L.effectiveAssignedBy({ assignedUserId: NIKKI }), "manual");
  assert.equal(L.effectiveAssignedBy({}), null);
  assert.deepEqual(L.decideBuildingRoute({ assignedUserId: NIKKI }, { propertyId: BLDG_A, assetManagerUserId: NINA }), {
    action: "keep",
    why: "manual",
  });
});

test("building switch: an automatic assignment follows the caller to the new building's asset manager", () => {
  const lead = { assignedUserId: NINA, assignedBy: "auto_building", assignedPropertyId: BLDG_A };
  assert.deepEqual(L.decideBuildingRoute(lead, { propertyId: BLDG_B, assetManagerUserId: NIKKI }), {
    action: "assign",
    userId: NIKKI,
    propertyId: BLDG_B,
    ownerChanged: true,
  });
});

test("building switch to another building of the same asset manager: only the building is updated", () => {
  const lead = { assignedUserId: NINA, assignedBy: "auto_building", assignedPropertyId: BLDG_A };
  assert.deepEqual(L.decideBuildingRoute(lead, { propertyId: BLDG_B, assetManagerUserId: NINA }), {
    action: "assign",
    userId: NINA,
    propertyId: BLDG_B,
    ownerChanged: false,
  });
  assert.deepEqual(L.decideBuildingRoute(lead, { propertyId: BLDG_A, assetManagerUserId: NINA }), {
    action: "keep",
    why: "unchanged",
  });
});

test("building switch to a building with no asset manager: the automatic owner stays", () => {
  const lead = { assignedUserId: NINA, assignedBy: "auto_building", assignedPropertyId: BLDG_A };
  assert.equal(L.decideBuildingRoute(lead, { propertyId: BLDG_B, assetManagerUserId: null }).action, "keep");
});

test("new lead text: nothing before contact info; first text = admins (+ owner if any)", () => {
  assert.equal(L.leadTextRecipients({ hasContact: false, notified: false }), null);
  assert.deepEqual(L.leadTextRecipients({ hasContact: true, notified: false }), {
    kind: "first",
    includeStaff: true,
    assignee: null,
  });
  assert.deepEqual(
    L.leadTextRecipients({ hasContact: true, notified: false, assignedUserId: NINA, assignedBy: "auto_building" }),
    { kind: "first", includeStaff: true, assignee: NINA },
  );
});

test("new lead text: a later owner by building is told alone; manual or already-told owners are not", () => {
  assert.deepEqual(
    L.leadTextRecipients({ hasContact: true, notified: true, assignedUserId: NIKKI, assignedBy: "auto_building" }),
    { kind: "new_owner", assignee: NIKKI },
  );
  assert.equal(
    L.leadTextRecipients({
      hasContact: true,
      notified: true,
      notifiedUserId: NIKKI,
      assignedUserId: NIKKI,
      assignedBy: "auto_building",
    }),
    null,
  );
  assert.equal(
    L.leadTextRecipients({ hasContact: true, notified: true, assignedUserId: DELIA, assignedBy: "manual" }),
    null,
  );
  assert.equal(L.leadTextRecipients({ hasContact: true, notified: true }), null);
});

test("log_lead takes the chosen listing as spoken_building / spoken_unit, from Sarah's own results only", () => {
  const defs = A.toolDefsFor("https://example.convex.site", false);
  const log = defs.find((d) => d.name === "log_lead");
  assert.ok(log, "log_lead tool exists");
  assert.ok(log.properties.spoken_building, "spoken_building on log_lead");
  assert.ok(log.properties.spoken_unit, "spoken_unit on log_lead");
  assert.ok(!log.required.includes("spoken_building"), "spoken_building is optional");
  const desc = log.properties.spoken_building.description;
  assert.match(desc, /exactly as a result in this call gave it/);
  assert.match(desc, /Never an address that is not in your results/);
  assert.match(desc, /never a city or area/);
  assert.match(log.description, /On the final log, pass the listing they chose, if they chose one, as spoken_building/);
});

test("leasing prompt: the final log carries the chosen listing, and choosing one later is logged", () => {
  const prompt = C.composeLeasing(C.defaultConfig()).replace(/\s+/g, " ");
  assert.match(prompt, /if they chose a listing, its address from your results as spoken_building \(and spoken_unit\)/);
  assert.match(prompt, /choosing a listing counts, even with no tour: log it as spoken_building/);
});
