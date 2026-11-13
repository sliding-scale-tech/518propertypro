// Unit tests for the bulk "Change asset manager" (convex/bulkReassignLib.ts): form/server
// validation and its messages, which units move (whole scope or one holder's), the "nothing to
// move" messages, the preview sentence, the upcoming-tours note, the batching plan and which
// building defaults switch. Also checks the bulk path reuses the single-unit core in units.ts.
// No packages, no network. From dashboard/:
//   node --test scripts/probes/bulk_reassign.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const L = await import("../../convex/bulkReassignLib.ts");

test("validation: missing manager and reason, null/empty/whitespace all mean unset", () => {
  for (const to of [null, undefined, "", "   "]) {
    const errs = L.validateBulkInput({ toUserId: to, reason: "Handover" });
    assert.deepEqual(errs, [{ field: "toUserId", message: "Choose the new asset manager." }]);
  }
  for (const reason of [null, undefined, "", "  \u0007 "]) {
    const errs = L.validateBulkInput({ toUserId: "u1", reason });
    assert.deepEqual(errs, [{ field: "reason", message: "Enter a reason for this change." }]);
  }
  const both = L.validateBulkInput({ toUserId: "", reason: "" });
  assert.deepEqual(both.map((e) => e.field), ["toUserId", "reason"]);
});

test("validation: reason length and same-as-from", () => {
  assert.equal(L.validateBulkInput({ toUserId: "u1", reason: "ab" })[0].message, L.BULK_MSG.reasonShort);
  assert.equal(L.validateBulkInput({ toUserId: "u1", reason: "x".repeat(501) })[0].message, L.BULK_MSG.reasonLong);
  assert.deepEqual(L.validateBulkInput({ toUserId: "u1", reason: "x".repeat(500) }), []);
  assert.deepEqual(L.validateBulkInput({ toUserId: "u1", fromUserId: "u1", reason: "Handover" }), [
    { field: "toUserId", message: L.BULK_MSG.sameAsFrom },
  ]);
  assert.deepEqual(L.validateBulkInput({ toUserId: "u1", fromUserId: "", reason: "Handover" }), []);
  assert.equal(L.cleanReason("  hi\u0000 there "), "hi there");
});

const units = [
  { unitId: "a1", propertyId: "p1", assetManagerUserId: "nikki" },
  { unitId: "a2", propertyId: "p1", assetManagerUserId: "nikki" },
  { unitId: "a3", propertyId: "p2", assetManagerUserId: "pat" },
  { unitId: "a4", propertyId: "p2", assetManagerUserId: "delia" },
  { unitId: "a5", propertyId: "p3", assetManagerUserId: "nikki" },
];

test("plan: whole scope moves everything not already with the target", () => {
  const plan = L.planBulkMove(units, "delia");
  assert.equal(plan.total, 5);
  assert.equal(plan.alreadyWithTarget, 1);
  assert.deepEqual(plan.moving.map((u) => u.unitId), ["a1", "a2", "a3", "a5"]);
  assert.deepEqual(plan.fromCounts, [
    { userId: "nikki", count: 3 },
    { userId: "pat", count: 1 },
  ]);
  assert.deepEqual(plan.buildings.sort(), ["p1", "p2", "p3"]);
});

test("plan: limited to one holder", () => {
  const plan = L.planBulkMove(units, "delia", "nikki");
  assert.equal(plan.inFilter, 3);
  assert.deepEqual(plan.moving.map((u) => u.unitId), ["a1", "a2", "a5"]);
  assert.deepEqual(plan.fromCounts, [{ userId: "nikki", count: 3 }]);
  assert.deepEqual(plan.buildings.sort(), ["p1", "p3"]);
});

test("nothing to move: specific messages", () => {
  const base = { toName: "Delia", scopeLabel: "Silver" };
  assert.equal(L.nothingToMoveMessage({ ...base, total: 0, inFilter: 0, movingCount: 0 }), "Silver has no units yet.");
  assert.equal(
    L.nothingToMoveMessage({ ...base, scopeLabel: "this building", total: 0, inFilter: 0, movingCount: 0 }),
    "This building has no units yet.",
  );
  assert.equal(L.nothingToMoveMessage({ ...base, total: 48, inFilter: 48, movingCount: 0 }), "Delia already manages all 48 of these units.");
  assert.equal(L.nothingToMoveMessage({ ...base, total: 1, inFilter: 1, movingCount: 0 }), "Delia already manages this unit.");
  assert.equal(
    L.nothingToMoveMessage({ ...base, fromName: "Nikki", total: 48, inFilter: 0, movingCount: 0 }),
    "Nikki holds no units in Silver.",
  );
  assert.equal(L.nothingToMoveMessage({ ...base, total: 48, inFilter: 48, movingCount: 3 }), null);
  // A plan feeding straight into it.
  const plan = L.planBulkMove(units.filter((u) => u.assetManagerUserId === "delia"), "delia");
  assert.equal(
    L.nothingToMoveMessage({ ...base, total: plan.total, inFilter: plan.inFilter, movingCount: plan.moving.length }),
    "Delia already manages this unit.",
  );
});

test("preview sentence", () => {
  assert.equal(
    L.previewSentence({
      unitCount: 48,
      buildingCount: 6,
      from: [
        { name: "Nikki", count: 40 },
        { name: "Pat", count: 8 },
      ],
      toName: "Delia",
      requestsMoving: 7,
    }),
    "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia; also moves 7 open maintenance requests.",
  );
  assert.equal(
    L.previewSentence({ unitCount: 1, buildingCount: 1, from: [{ name: "Nikki", count: 1 }], toName: "Delia", requestsMoving: 0 }),
    "Moves 1 unit from Nikki to Delia.",
  );
  assert.equal(
    L.previewSentence({ unitCount: 12, buildingCount: 1, from: [{ name: "Nikki", count: 12 }], toName: "Delia", requestsMoving: 1 }),
    "Moves 12 units from Nikki to Delia; also moves 1 open maintenance request.",
  );
  assert.equal(L.joinNames(["A", "B", "C"]), "A, B and C");
  assert.equal(L.joinNames([]), "");
});

test("tours note", () => {
  assert.equal(L.toursStayNote([]), null);
  assert.equal(L.toursStayNote([{ name: "Nikki", count: 0 }]), null);
  assert.equal(L.toursStayNote([{ name: "Nikki", count: 3 }]), "3 upcoming tours stay with Nikki; change them in the calendar if needed.");
  assert.equal(L.toursStayNote([{ name: "Nikki", count: 1 }]), "1 upcoming tour stays with Nikki; change it in the calendar if needed.");
  assert.equal(
    L.toursStayNote([
      { name: "Nikki", count: 2 },
      { name: "Pat", count: 1 },
    ]),
    "3 upcoming tours stay with Nikki and Pat; change them in the calendar if needed.",
  );
});

test("batching: batch count and next batch always shrink what is left", () => {
  assert.equal(L.batchCount(0), 0);
  assert.equal(L.batchCount(1), 1);
  assert.equal(L.batchCount(L.BULK_BATCH_SIZE), 1);
  assert.equal(L.batchCount(L.BULK_BATCH_SIZE + 1), 2);
  assert.equal(L.batchCount(450, 40), 12);

  // Simulate the apply loop on 450 units: every batch re-plans from the current state.
  const many = Array.from({ length: 450 }, (_, i) => ({
    unitId: `u${i}`,
    propertyId: `p${i % 9}`,
    assetManagerUserId: i % 3 === 0 ? "pat" : "nikki",
  }));
  let batches = 0;
  let moved = 0;
  for (;;) {
    const b = L.nextBatch(many, "delia", null, 40);
    if (b.length === 0) break;
    assert.ok(b.length <= 40);
    for (const u of b) u.assetManagerUserId = "delia";
    moved += b.length;
    batches += 1;
    assert.ok(batches <= L.batchCount(450, 40));
  }
  assert.equal(moved, 450);
  assert.equal(batches, 12);
  assert.equal(L.nextBatch(many, "delia", null, 40).length, 0);
});

test("defaults: whole scope switches every building; one holder only switches theirs", () => {
  const props = [
    { propertyId: "p1", defaultAssetManagerUserId: "nikki" },
    { propertyId: "p2", defaultAssetManagerUserId: "pat" },
    { propertyId: "p3", defaultAssetManagerUserId: "delia" },
    { propertyId: "p4", defaultAssetManagerUserId: null },
  ];
  assert.deepEqual(L.defaultsToSwitch(props, "delia").map((p) => p.propertyId), ["p1", "p2", "p4"]);
  assert.deepEqual(L.defaultsToSwitch(props, "delia", "nikki").map((p) => p.propertyId), ["p1"]);
});

test("audit notes carry the reason, scope and counts", () => {
  assert.equal(L.bulkUnitReason("Handover", "Silver team"), "Handover (bulk change: Silver team)");
  const note = L.bulkAuditNote({
    scopeLabel: "Silver team",
    unitCount: 48,
    buildingCount: 6,
    from: [
      { name: "Nikki", count: 40 },
      { name: "Pat", count: 8 },
    ],
    toName: "Delia",
    requestsMoved: 7,
    reason: "Handover",
  });
  assert.equal(note, "48 units in 6 buildings (Silver team) moved from Nikki (40) and Pat (8) to Delia; 7 open requests moved. Reason: Handover");
  assert.match(L.bulkAuditNote({ scopeLabel: "x", unitCount: 1, buildingCount: 1, from: [], toName: "D", requestsMoved: 0, reason: "r", partial: true }), /^Stopped early: /);
});

test("teams", () => {
  assert.deepEqual([...L.BULK_TEAMS], ["gold", "silver", "make_up"]);
  assert.equal(L.isBulkTeam("make_up"), true);
  assert.equal(L.isBulkTeam("bronze"), false);
  assert.equal(L.isBulkTeam(null), false);
});

test("the bulk path reuses the single-unit core (units.reassignDetailed) and is admin-gated", () => {
  const units = readFileSync(new URL("../../convex/units.ts", import.meta.url), "utf8");
  const wrapper = units.slice(units.indexOf("export async function reassignUnitInBulk"));
  assert.match(wrapper.slice(0, 800), /reassignDetailed\(ctx, org, unit, to, reason, \{ notify: false \}\)/);
  assert.match(units, /reassignDetailed\(ctx, org, unit, to, reason\);/); // the single-unit path, unchanged
  const bulk = readFileSync(new URL("../../convex/bulkReassign.ts", import.meta.url), "utf8");
  assert.match(bulk, /reassignUnitInBulk\(ctx, org, row\.unit, people\.to, reason\)/);
  assert.match(bulk, /requireAdminViewId\(ctx\)/);
  // Every batch re-checks the admin; the queries answer null to anyone else.
  assert.equal((bulk.match(/await actorOrg\(ctx, args\.actorUserId\)/g) ?? []).length, 4); // leadHolders, applyLeadBatch, applyBatch, finishBulk
  assert.equal((bulk.match(/if \(!org \|\| !isAdminView\(org\)\) return null;/g) ?? []).length, 2);
  // Never `throw new Error` for an expected condition.
  assert.doesNotMatch(bulk, /throw new Error\(/);
});

// --- Leads move with the bulk change ---------------------------------------------------------

const lead = (leadId, assignedUserId, assignedPropertyId, assignedBy) => ({ leadId, assignedUserId, assignedPropertyId, assignedBy });
const leads = [
  lead("l1", "nikki", "p1", "auto_building"),
  lead("l2", "nikki", "p1", "manual"),
  lead("l3", "nikki", "p1", undefined), // assigned before B41: counts as manual
  lead("l4", "pat", "p2", "auto_building"),
  lead("l5", "nikki", "p9", "auto_building"), // another building, not in scope
  lead("l6", "delia", "p1", "auto_building"), // already with the target
  lead("l7", "carol", "p1", "auto_building"), // held by someone the units do not move away from
  lead("l8", undefined, "p1", undefined), // unassigned
  lead("l9", "nikki", undefined, "manual"), // not routed by a building
];
const scopeProps = new Set(["p1", "p2", "p3"]);

test("leads: buildings in scope + holders the units move away from; auto and manual both move", () => {
  const holders = new Set(L.planBulkMove(units, "delia").fromCounts.map((f) => f.userId)); // nikki, pat
  const moving = L.planLeadMove(leads, scopeProps, holders, "delia");
  assert.deepEqual(moving.map((l) => l.leadId), ["l1", "l2", "l3", "l4"]);
});

test("leads: a hand-assigned lead that kept its building moves with the handover", () => {
  const manual = [lead("h1", "nikki", "p1", "manual"), lead("h2", "pat", "p2", "manual")];
  const holders = new Set(["nikki", "pat"]);
  assert.deepEqual(L.planLeadMove(manual, scopeProps, holders, "delia").map((l) => l.leadId), ["h1", "h2"]);
  // A lead from before B41 has no building and is not found.
  assert.deepEqual(L.planLeadMove([lead("old", "nikki", undefined, undefined)], scopeProps, holders, "delia"), []);
});

test("leads: a one-person move only takes that person's leads", () => {
  const holders = new Set(L.planBulkMove(units, "delia", "nikki").fromCounts.map((f) => f.userId));
  assert.deepEqual(L.planLeadMove(leads, scopeProps, holders, "delia").map((l) => l.leadId), ["l1", "l2", "l3"]);
  // A single building scope.
  assert.deepEqual(L.planLeadMove(leads, new Set(["p2"]), new Set(["pat", "nikki"]), "delia").map((l) => l.leadId), ["l4"]);
  // Nobody holds anything: nothing moves.
  assert.deepEqual(L.planLeadMove(leads, scopeProps, new Set(), "delia"), []);
});

test("leads: closed / lost / converted / archived are skipped through isOpenLead (no lifecycle state exists today)", () => {
  assert.equal(L.isOpenLead({ assignedUserId: "nikki" }), true);
  assert.equal(L.isOpenLead({ assignedUserId: undefined }), false);
  assert.equal(L.isOpenLead({ assignedUserId: null }), false);
  // The planner goes through it, and the apply code reads the same rules (no separate filter).
  const src = readFileSync(new URL("../../convex/bulkReassignLib.ts", import.meta.url), "utf8");
  assert.match(src.slice(src.indexOf("export function planLeadMove")), /isOpenLead\(l\)/);
});

test("leads: re-reading after a batch only sees what is left, so nothing moves twice", () => {
  const many = Array.from({ length: 95 }, (_, i) => lead(`m${i}`, "nikki", "p1", i % 2 ? "manual" : "auto_building"));
  let rounds = 0;
  let movedTotal = 0;
  for (;;) {
    const left = L.planLeadMove(many, scopeProps, new Set(["nikki"]), "delia");
    if (left.length === 0) break;
    const batch = left.slice(0, L.BULK_BATCH_SIZE);
    for (const l of batch) l.assignedUserId = "delia";
    movedTotal += batch.length;
    rounds += 1;
    assert.ok(rounds <= L.batchCount(95));
  }
  assert.equal(movedTotal, 95);
  assert.equal(rounds, 3);
});

test("leads: the patch keeps assignedBy and assignedPropertyId, and only re-points the notified user when it was texted", () => {
  const p = L.leadMovePatch({}, "delia", 1000);
  assert.equal(p.assignedUserId, "delia");
  assert.equal(p.assignedAt, 1000);
  assert.equal("assignedBy" in p, false);
  assert.equal("assignedPropertyId" in p, false);
  assert.equal("leadNotifiedUserId" in p, false);
  assert.equal(L.leadMovePatch({ leadNotifiedAt: 5 }, "delia", 1000).leadNotifiedUserId, "delia");
  // The apply code writes only those fields.
  const bulk = readFileSync(new URL("../../convex/bulkReassign.ts", import.meta.url), "utf8");
  const apply = bulk.slice(bulk.indexOf("export const applyLeadBatch"), bulk.indexOf("export const applyBatch"));
  assert.doesNotMatch(apply, /assignedBy|assignedPropertyId:/);
  assert.match(apply, /lead_reassigned_bulk/);
  assert.match(apply, /by_assigned_property|openLeadsIn/);
});

test("preview sentence mentions leads when some move", () => {
  const base = { unitCount: 48, buildingCount: 6, from: [{ name: "Nikki", count: 40 }, { name: "Pat", count: 8 }], toName: "Delia" };
  assert.equal(
    L.previewSentence({ ...base, requestsMoving: 7, leadsMoving: 3 }),
    "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia; also moves 7 open maintenance requests and 3 open leads.",
  );
  assert.equal(
    L.previewSentence({ ...base, requestsMoving: 0, leadsMoving: 1 }),
    "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia; also moves 1 open lead.",
  );
  assert.equal(
    L.previewSentence({ ...base, requestsMoving: 7, leadsMoving: 0 }),
    "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia; also moves 7 open maintenance requests.",
  );
  assert.equal(L.previewSentence({ ...base, requestsMoving: 0 }), "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia.");
  const note = L.bulkAuditNote({ scopeLabel: "Silver team", unitCount: 2, buildingCount: 1, from: [{ name: "Nikki", count: 2 }], toName: "Delia", requestsMoved: 1, leadsMoved: 3, reason: "r" });
  assert.match(note, /1 open request moved and 3 open leads moved\./);
});

test("units_reassigned template: declared, rendered, validated, and texting stays off", () => {
  const notify = readFileSync(new URL("../../convex/notify.ts", import.meta.url), "utf8");
  assert.match(notify, /^  "units_reassigned",$/m); // TEMPLATES
  assert.match(notify, /v\.literal\("units_reassigned"\)/); // validator
  assert.match(notify, /case "units_reassigned":/); // body
  const twilio = readFileSync(new URL("../../convex/twilioApi.ts", import.meta.url), "utf8");
  assert.doesNotMatch(twilio, /units_reassigned/);
  const bulk = readFileSync(new URL("../../convex/bulkReassign.ts", import.meta.url), "utf8");
  assert.match(bulk, /template: "units_reassigned"/);
  assert.doesNotMatch(bulk, /request_reassigned/);
});

test("the Property assignments hint no longer says open requests stay put", () => {
  for (const f of ["components/asset-managers/property-assignments-tab.tsx"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /stay with whoever/);
  }
});
