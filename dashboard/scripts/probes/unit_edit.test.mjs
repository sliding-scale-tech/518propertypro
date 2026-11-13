// Tests for B45 "Edit unit" (one dialog, one Save): convex/unitEditLib.ts — the diff of changed
// sections, the validation messages, the permission matrix (incl. asset managers adding residents
// to units they manage) and the roster-sync precedence. Also source checks that the one mutation
// applies its parts in order and that every path shares the same tenancy core.
// No packages, no network. From dashboard/:  node --test scripts/probes/unit_edit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const L = await import("../../convex/unitEditLib.ts");
const { LEASE_MSG } = await import("../../convex/leaseLib.ts");

const TODAY = "2026-11-13";
const ENV = { today: TODAY, rentToday: TODAY, residents: [{ _id: "r1", fullName: "Ann Lee" }, { _id: "r2", fullName: "Bo Kim" }] };

const SNAP = {
  unitNumber: "2B",
  bedrooms: "2br",
  floor: 2,
  bathrooms: 1.25, // an odd roster value
  isTopFloor: undefined,
  parking: undefined,
  availableFrom: undefined,
  leasingFacts: "Near the bus",
  available: false,
  occupancy: "occupied",
  leaseType: "fixed",
  rentPaidTo: "company",
  assetManagerUserId: "nikki",
};

const FORM = {
  details: { unitNumber: "2B", bedrooms: "2br", floor: "2", bathrooms: "1.25", isTopFloor: false, parking: "", availableFrom: "", leasingFacts: "Near the bus" },
  roster: { available: false, occupancy: "occupied", leaseType: "fixed", rentPaidTo: "company" },
  rent: { rent: "", effectiveMonth: "", note: "" },
  moveOuts: [],
  newRenter: undefined,
  manager: { assetManagerUserId: "nikki", reason: "" },
};
const form = (patch) => ({ ...FORM, ...patch });

// --- diff -------------------------------------------------------------------------------------------

test("diff: the form as loaded has no changes (No changes to save.)", () => {
  const c = L.unitEditChanges(SNAP, FORM);
  assert.deepEqual(c, {});
  assert.deepEqual(L.editSections(c), []);
  assert.equal(L.UNIT_EDIT_MSG.nothing, "No changes to save.");
});

test("diff: only changed fields are kept; equal numbers and a legacy value are not resent", () => {
  const c = L.unitEditChanges(SNAP, form({ details: { ...FORM.details, floor: "02", unitNumber: " 2B ", parking: "Lot 4" } }));
  assert.deepEqual(c, { details: { parking: "Lot 4" } });
  // A value that does not parse counts as a change, so validation can report it.
  const bad = L.unitEditChanges(SNAP, form({ details: { ...FORM.details, bathrooms: "1.3" } }));
  assert.deepEqual(bad.details, { bathrooms: "1.3" });
  // Clearing the floor is a change.
  assert.deepEqual(L.unitEditChanges(SNAP, form({ details: { ...FORM.details, floor: "" } })).details, { floor: "" });
});

test("diff: roster selects treat null and empty as 'not stated'; available null = untouched", () => {
  const c = L.unitEditChanges(SNAP, form({ roster: { available: null, occupancy: "", leaseType: null, rentPaidTo: "company" } }));
  assert.deepEqual(c.roster, { occupancy: null, leaseType: null });
  const none = L.unitEditChanges({ ...SNAP, occupancy: undefined }, form({ roster: { occupancy: null } }));
  assert.equal(none.roster, undefined);
  assert.deepEqual(L.unitEditChanges(SNAP, form({ roster: { available: true } })).roster, { available: true });
});

test("diff: rent counts when the new rent or its month is filled; the asset manager when another is chosen", () => {
  assert.equal(L.unitEditChanges(SNAP, form({ rent: { rent: "", effectiveMonth: "", note: "hi" } })).rent, undefined);
  assert.ok(L.unitEditChanges(SNAP, form({ rent: { rent: "1300" } })).rent);
  assert.ok(L.unitEditChanges(SNAP, form({ rent: { effectiveMonth: "2026-12" } })).rent);
  assert.equal(L.unitEditChanges(SNAP, form({ manager: { assetManagerUserId: "nikki", reason: "x" } })).manager, undefined);
  assert.ok(L.unitEditChanges(SNAP, form({ manager: { assetManagerUserId: "nina", reason: "" } })).manager);
  // A blank choice is a change (so validation says "Choose the asset manager.").
  assert.ok(L.unitEditChanges(SNAP, form({ manager: { assetManagerUserId: null } })).manager);
});

test("diff: move-outs are de-duplicated; sections come back in save order", () => {
  const c = L.unitEditChanges(
    SNAP,
    form({
      manager: { assetManagerUserId: "nina", reason: "Handover" },
      moveOuts: [{ residentId: "r1", moveOutDate: TODAY }, { residentId: "r1", moveOutDate: "2026-11-01" }, { residentId: "" }],
      rent: { rent: "1300", effectiveMonth: "2026-12" },
      roster: { occupancy: "vacant" },
      details: { ...FORM.details, unitNumber: "2C" },
    }),
  );
  assert.deepEqual(c.moveOuts, [{ residentId: "r1", moveOutDate: TODAY }]);
  assert.deepEqual(L.editSections(c), ["details", "roster", "rent", "tenancy", "manager"]);
});

// --- validation -------------------------------------------------------------------------------------

const errsOf = (raw) => L.validateUnitEdit(L.unitEditChanges(SNAP, form(raw)), ENV);

test("validation: details messages", () => {
  const e = errsOf({ details: { ...FORM.details, unitNumber: " ", bedrooms: "", floor: "2.5", bathrooms: "abc", availableFrom: "2026-02-30" } });
  assert.equal(e.unitNumber, "Enter a unit number.");
  assert.equal(e.bedrooms, "Select the unit type.");
  assert.equal(e.floor, "Enter the floor as a whole number, like 2 (0 for the basement).");
  assert.equal(e.bathrooms, "Enter the bathrooms as a number like 1 or 1.5.");
  assert.equal(e.availableFrom, L.UNIT_EDIT_MSG.availableFromInvalid);
});

test("validation: roster values must be from the list", () => {
  const e = errsOf({ roster: { occupancy: "at_will", leaseType: "weekly", rentPaidTo: "tenant" } });
  assert.equal(e.occupancy, L.UNIT_EDIT_MSG.occupancyInvalid);
  assert.equal(e.leaseType, L.UNIT_EDIT_MSG.leaseTypeInvalid);
  assert.equal(e.rentPaidTo, L.UNIT_EDIT_MSG.rentPaidToInvalid);
});

test("validation: rent needs its month, and the month needs a rent", () => {
  assert.equal(errsOf({ rent: { rent: "1300", effectiveMonth: "" } }).effectiveMonth, "Select the month the new rent starts.");
  assert.equal(errsOf({ rent: { rent: "", effectiveMonth: "2026-12" } }).rent, "Enter the new rent.");
  assert.deepEqual(errsOf({ rent: { rent: "1300", effectiveMonth: "2026-12" } }), {});
});

test("validation: move-out date (missing, future) and a resident who already left", () => {
  const f = L.moveOutField;
  assert.equal(errsOf({ moveOuts: [{ residentId: "r1", moveOutDate: "" }] })[f("r1")], LEASE_MSG.moveOutMissing);
  assert.equal(errsOf({ moveOuts: [{ residentId: "r1", moveOutDate: "2026-11-20" }] })[f("r1")], LEASE_MSG.moveOutFuture);
  assert.match(LEASE_MSG.moveOutFuture, /can't be in the future/);
  assert.equal(errsOf({ moveOuts: [{ residentId: "gone", moveOutDate: TODAY }] })[f("gone")], L.UNIT_EDIT_MSG.residentGone);
  assert.deepEqual(errsOf({ moveOuts: [{ residentId: "r1", moveOutDate: TODAY }] }), {});
});

test("validation: new renter fields, and replacing needs everyone moved out", () => {
  const e = errsOf({ newRenter: { fullName: " ", leaseStart: "2026-12-01", leaseEnd: "2026-11-30" }, moveOuts: [{ residentId: "r1", moveOutDate: TODAY }] });
  assert.equal(e.fullName, "Enter the new renter's full name.");
  assert.equal(e.leaseEnd, "Lease end must be after lease start.");
  assert.equal(e[L.moveOutField("r2")], 'Move out Bo Kim too, or turn off "Replace with a new renter".');
  assert.equal(e[L.moveOutField("r1")], undefined);
  // The new renter's rent is not part of this section (rent is section 3).
  assert.equal(e.rent, undefined);
  const ok = errsOf({
    newRenter: { fullName: "Cy Dee", phones: ["5185551234", ""], leaseStart: "2026-12-01", leaseEnd: "2027-11-30" },
    moveOuts: [{ residentId: "r1", moveOutDate: TODAY }, { residentId: "r2", moveOutDate: TODAY }],
  });
  assert.deepEqual(ok, {});
});

test("validation: asset manager change needs a reason", () => {
  assert.equal(errsOf({ manager: { assetManagerUserId: "nina", reason: "  " } }).reason, "Enter a reason for changing the asset manager.");
  assert.equal(errsOf({ manager: { assetManagerUserId: "nina", reason: "ab" } }).reason, L.UNIT_EDIT_MSG.reasonShort);
  assert.equal(errsOf({ manager: { assetManagerUserId: "nina", reason: "x".repeat(501) } }).reason, L.UNIT_EDIT_MSG.reasonLong);
  assert.equal(errsOf({ manager: { assetManagerUserId: "", reason: "Handover" } }).assetManagerUserId, "Choose the asset manager.");
  assert.deepEqual(errsOf({ manager: { assetManagerUserId: "nina", reason: "Handover" } }), {});
});

test("validation order: details first, the asset manager reason last", () => {
  const order = L.unitEditOrder(["r1"]);
  assert.ok(order.indexOf("unitNumber") < order.indexOf("occupancy"));
  assert.ok(order.indexOf("occupancy") < order.indexOf("rent"));
  assert.ok(order.indexOf("effectiveMonth") < order.indexOf(L.moveOutField("r1")));
  assert.ok(order.indexOf(L.moveOutField("r1")) < order.indexOf("fullName"));
  assert.equal(order.at(-1), "reason");
});

// --- permissions ------------------------------------------------------------------------------------

const P = (admin, accountant, ownAm) => L.unitEditPermissions({ admin, accountant, ownAm });

test("permission matrix", () => {
  assert.deepEqual(P(true, false, false), { details: true, roster: true, rent: true, moveOut: true, newRenter: true, manager: true, remove: true });
  // The unit's own asset manager: details, roster, move out AND new renter (adds residents); no rent, AM change or remove.
  assert.deepEqual(P(false, false, true), { details: true, roster: true, rent: false, moveOut: true, newRenter: true, manager: false, remove: false });
  // Accountant: the rent only (the finance rule unitRent.changeRent already had).
  assert.deepEqual(P(false, true, false), { details: false, roster: false, rent: true, moveOut: false, newRenter: false, manager: false, remove: false });
  // An asset manager on a unit they don't manage (or only cover): nothing.
  const none = P(false, false, false);
  assert.equal(L.canOpenUnitEdit(none), false);
  assert.equal(Object.values(none).some(Boolean), false);
  assert.equal(L.canOpenUnitEdit(P(false, true, false)), true);
});

test("deniedSection: each forbidden section has its own message", () => {
  const am = P(false, false, true);
  const c = (raw) => L.unitEditChanges(SNAP, form(raw));
  assert.deepEqual(L.deniedSection(am, c({ rent: { rent: "1300", effectiveMonth: "2026-12" } })), { field: "rent", message: "Only an admin can change the rent. Ask an admin." });
  assert.deepEqual(L.deniedSection(am, c({ manager: { assetManagerUserId: "nina", reason: "x" } })), {
    field: "assetManagerUserId",
    message: "Only an admin can change the asset manager. Ask an admin.",
  });
  assert.equal(L.deniedSection(am, c({ newRenter: { fullName: "Cy" }, moveOuts: [{ residentId: "r1", moveOutDate: TODAY }], roster: { occupancy: "vacant" } })), null);
  const other = P(false, false, false);
  assert.equal(L.deniedSection(other, c({ newRenter: { fullName: "Cy" } })).message, "You can only add residents to units you manage.");
  assert.equal(L.deniedSection(other, c({ moveOuts: [{ residentId: "r1", moveOutDate: TODAY }] })).message, L.UNIT_EDIT_MSG.moveOutNotYours);
  assert.equal(L.deniedSection(other, c({ details: { ...FORM.details, parking: "x" } })).message, "You can only edit units you manage.");
  assert.equal(L.deniedSection(P(true, false, false), c({ manager: { assetManagerUserId: "nina", reason: "x" } })), null);
});

// --- roster sync ------------------------------------------------------------------------------------

test("roster sync: new renter -> occupied + fixed (or month-to-month without a lease end)", () => {
  const cur = { occupancy: "vacant", leaseType: "vacant" };
  assert.deepEqual(L.rosterSync({ newRenter: { leaseEnd: "2027-11-30" }, movedOut: 1, leftAfter: 1, current: cur }), { occupancy: "occupied", leaseType: "fixed" });
  assert.deepEqual(L.rosterSync({ newRenter: { leaseEnd: "" }, movedOut: 0, leftAfter: 1, current: cur }), { occupancy: "occupied", leaseType: "month_to_month" });
});

test("roster sync: the last move-out -> vacant; others still there -> nothing", () => {
  const cur = { occupancy: "occupied", leaseType: "fixed" };
  assert.deepEqual(L.rosterSync({ newRenter: null, movedOut: 1, leftAfter: 0, current: cur }), { occupancy: "vacant", leaseType: "vacant" });
  assert.deepEqual(L.rosterSync({ newRenter: null, movedOut: 1, leftAfter: 1, current: cur }), {});
  assert.deepEqual(L.rosterSync({ newRenter: null, movedOut: 0, leftAfter: 0, current: cur }), {});
});

test("roster sync precedence: a manual roster edit in the same save wins; equal values are left out", () => {
  const cur = { occupancy: "occupied", leaseType: "fixed" };
  assert.deepEqual(L.rosterSync({ newRenter: null, movedOut: 1, leftAfter: 0, current: cur, manual: { occupancy: true } }), { leaseType: "vacant" });
  assert.deepEqual(L.rosterSync({ newRenter: null, movedOut: 1, leftAfter: 0, current: cur, manual: { occupancy: true, leaseType: true } }), {});
  assert.deepEqual(L.rosterSync({ newRenter: { leaseEnd: "2027-01-01" }, movedOut: 0, leftAfter: 1, current: cur }), {});
});

test("availability sync: new renter takes it off the market, a move-out offers it only when asked, manual wins", () => {
  assert.equal(L.availabilitySync({ newRenter: true, makeAvailable: false, current: true, manual: false }), false);
  assert.equal(L.availabilitySync({ newRenter: true, makeAvailable: false, current: false, manual: false }), null);
  assert.equal(L.availabilitySync({ newRenter: true, makeAvailable: false, current: true, manual: true }), null);
  assert.equal(L.availabilitySync({ newRenter: false, makeAvailable: true, current: false, manual: false }), true);
  assert.equal(L.availabilitySync({ newRenter: false, makeAvailable: false, current: false, manual: false }), null);
});

// --- wiring (source checks) -------------------------------------------------------------------------

const src = (p) => readFileSync(new URL(`../../convex/${p}`, import.meta.url), "utf8");

test("saveAll: one mutation, validates first, then details -> roster -> rent -> tenancy -> asset manager", () => {
  const s = src("unitEdit.ts");
  const body = s.slice(s.indexOf("export const saveAll"));
  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i > 0, `missing ${needle}`);
    return i;
  };
  const steps = ["unitEditChanges(", "deniedSection(", "validateUnitEdit(", "applyDetails(", "writeAvailability(", "writeRosterFields(", "changeRent(", "applyTenancy(", "reassignUnitWithReason("];
  const pos = steps.map(at);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.match(body, /UNIT_EDIT_MSG\.nothing/);
});

test("New renter, Move out and saveAll share the tenancy core; move-outs close lease follow-ups", () => {
  const leases = src("leases.ts");
  const newRenter = leases.slice(leases.indexOf("export const newRenter"), leases.indexOf("export const moveOut"));
  const moveOut = leases.slice(leases.indexOf("export const moveOut"), leases.indexOf("export const renew"));
  assert.match(newRenter, /applyTenancy\(/);
  assert.match(moveOut, /applyTenancy\(/);
  assert.doesNotMatch(newRenter + moveOut, /requireAdminView/);
  assert.match(newRenter, /UNIT_EDIT_MSG\.newRenterNotYours/);
  const record = leases.slice(leases.indexOf("export async function recordMoveOut"), leases.indexOf("export type NewRenterFields"));
  assert.match(record, /closeLeaseFollowUps\(/);
  const core = leases.slice(leases.indexOf("export async function applyTenancy"));
  assert.match(core, /recordMoveOut\(/);
  assert.match(core, /rosterSync\(/);
});

test("residents.create / update: admin view or the unit's own asset manager, with the specific message", () => {
  const r = src("residents.ts");
  const create = r.slice(r.indexOf("export const create"), r.indexOf("export const update"));
  assert.match(create, /canManageResidentsOf\(org, unit\)/);
  assert.match(create, /UNIT_EDIT_MSG\.newRenterNotYours/);
  assert.equal(L.UNIT_EDIT_MSG.newRenterNotYours, "You can only add residents to units you manage.");
  const update = r.slice(r.indexOf("export const update"), r.indexOf("export async function syncRosterResidents"));
  assert.match(update, /canManageResidentsOf\(org, home\)/);
  assert.match(update, /canManageResidentsOf\(org, unit\)/);
  // Deactivate stays admin only.
  const deactivate = r.slice(r.indexOf("export const deactivate"));
  assert.match(deactivate.slice(0, 400), /requireAdminView/);
});
