// Tests for B44 lease rules: convex/leaseLib.ts (lease tag, Lease filter, the daily follow-up's
// selection and task title, New renter / Move out / Renewed validation).
// From dashboard/:  node --test scripts/probes/lease_rules.test.mjs
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
const L = await import("../../convex/leaseLib.ts");

const NY = "America/New_York";
const active = (leaseEnd, extra = {}) => ({ active: true, leaseEnd, ...extra });

// --- team date and the midnight edge ------------------------------------------------------------

test("teamToday uses the team's time zone, not UTC", () => {
  // 2026-12-01 04:30 UTC is still Nov 30 (23:30) in New York; 05:00 UTC is Dec 1 00:00.
  const before = Date.UTC(2026, 11, 1, 4, 30);
  const after = Date.UTC(2026, 11, 1, 5, 0);
  assert.equal(L.teamToday(before, NY), "2026-11-30");
  assert.equal(L.teamToday(after, NY), "2026-12-01");
  assert.equal(L.teamToday(before, "UTC"), "2026-12-01");
});

test("teamToday falls back to New York when the zone is missing or invalid", () => {
  const ms = Date.UTC(2026, 11, 1, 4, 30);
  assert.equal(L.teamToday(ms, undefined), "2026-11-30");
  assert.equal(L.teamToday(ms, null), "2026-11-30");
  assert.equal(L.teamToday(ms, "Not/AZone"), "2026-11-30");
});

test("a lease ending Nov 30 is 'ending soon' until midnight in the team zone, then 'ended'", () => {
  const r = active("2026-11-30");
  assert.equal(L.leaseTag(r, L.teamToday(Date.UTC(2026, 11, 1, 4, 59), NY)), "ending_soon");
  assert.equal(L.leaseTag(r, L.teamToday(Date.UTC(2026, 11, 1, 5, 0), NY)), "ended");
  // The follow-up follows the same date.
  assert.equal(L.needsLeaseFollowUp(r, L.teamToday(Date.UTC(2026, 11, 1, 4, 59), NY), false), false);
  assert.equal(L.needsLeaseFollowUp(r, L.teamToday(Date.UTC(2026, 11, 1, 5, 0), NY), false), true);
});

// --- lease tag ----------------------------------------------------------------------------------

test("leaseTag rules", () => {
  const today = "2026-11-13";
  assert.equal(L.leaseTag(active(undefined), today), null);
  assert.equal(L.leaseTag(active("2026-11-12"), today), "ended");
  assert.equal(L.leaseTag(active("2026-11-13"), today), "ending_soon"); // ends today: not yet ended
  assert.equal(L.leaseTag(active("2027-01-12"), today), "ending_soon"); // today + 60
  assert.equal(L.leaseTag(active("2027-01-13"), today), null); // today + 61
  assert.equal(L.leaseTag(active("2025-01-01", { leaseStatus: "month_to_month" }), today), "month_to_month");
  assert.equal(L.leaseTag(active(undefined, { leaseStatus: "month_to_month" }), today), "month_to_month");
  assert.equal(L.leaseTag({ active: false, leaseEnd: "2025-01-01" }, today), null);
  assert.equal(L.LEASE_TAG_LABEL.ended, "Lease ended");
  assert.equal(L.LEASE_TAG_LABEL.ending_soon, "Ending soon");
  assert.equal(L.LEASE_TAG_LABEL.month_to_month, "Month-to-month");
});

// --- Lease filter -------------------------------------------------------------------------------

test("Lease filter", () => {
  const today = "2026-11-13";
  const ended = active("2026-10-01");
  const in20 = active("2026-12-03");
  const in45 = active("2026-12-28");
  const in80 = active("2027-02-01");
  const m2m = active("2026-10-01", { leaseStatus: "month_to_month" });
  const none = active(undefined);
  const gone = { active: false, leaseEnd: "2026-10-01" };
  const pick = (f) => ({ ended, in20, in45, in80, m2m, none, gone });
  const names = (f) =>
    Object.entries(pick(f))
      .filter(([, r]) => L.matchesLeaseFilter(r, f, today))
      .map(([k]) => k);
  assert.deepEqual(names("all"), ["ended", "in20", "in45", "in80", "m2m", "none", "gone"]);
  assert.deepEqual(names(undefined), names("all"));
  assert.deepEqual(names("ended"), ["ended"]);
  assert.deepEqual(names("ending_30"), ["in20"]);
  assert.deepEqual(names("ending_60"), ["in20", "in45"]);
  assert.deepEqual(names("ending_90"), ["in20", "in45", "in80"]);
  assert.deepEqual(names("month_to_month"), ["m2m"]);
  assert.deepEqual(names("none"), ["none"]);
  assert.deepEqual([...L.LEASE_FILTERS], ["all", "ended", "ending_30", "ending_60", "ending_90", "month_to_month", "none"]);
});

// --- daily follow-up selection --------------------------------------------------------------------

test("follow-up selection: only active, past lease end, not month-to-month, no open follow-up", () => {
  const today = "2026-11-13";
  const rows = [
    { _id: "a", ...active("2026-11-12") }, // picked
    { _id: "b", ...active("2026-11-13") }, // ends today: not yet
    { _id: "c", ...active("2025-06-30", { leaseStatus: "month_to_month" }) }, // month-to-month: skipped
    { _id: "d", active: false, leaseEnd: "2026-01-01" }, // moved out: skipped
    { _id: "e", ...active(undefined) }, // no lease date: skipped
    { _id: "f", ...active("2026-01-31") }, // picked
    { _id: "g", ...active("2026-02-01") }, // has an open follow-up: skipped
    { _id: "a", ...active("2026-11-12") }, // same resident again in a batch: once
  ];
  const picked = L.selectLeaseFollowUps(rows, today, new Set(["g"]));
  assert.deepEqual(
    picked.map((r) => r._id),
    ["a", "f"],
  );
});

test("follow-up selection is idempotent: a second run after the first creates nothing", () => {
  const today = "2026-11-13";
  const rows = [
    { _id: "a", ...active("2026-11-01") },
    { _id: "b", ...active("2026-10-01") },
    { _id: "c", ...active("2027-10-01") },
  ];
  const open = new Set();
  const first = L.selectLeaseFollowUps(rows, today, open);
  assert.deepEqual(
    first.map((r) => r._id),
    ["a", "b"],
  );
  for (const r of first) open.add(r._id); // the run inserts one open task each
  assert.deepEqual(L.selectLeaseFollowUps(rows, today, open), []);
  assert.deepEqual(L.selectLeaseFollowUps(rows, today, open), []);
  // Resolving one (task closed) without changing the lease would make it due again; Renewed moves
  // the date and Month-to-month sets the flag, so neither comes back.
  open.delete("a");
  const renewed = rows.map((r) => (r._id === "a" ? { ...r, leaseEnd: "2027-11-01" } : r));
  assert.deepEqual(L.selectLeaseFollowUps(renewed, today, open), []);
  const m2m = rows.map((r) => (r._id === "a" ? { ...r, leaseStatus: "month_to_month" } : r));
  assert.deepEqual(L.selectLeaseFollowUps(m2m, today, open), []);
});

test("follow-up task title", () => {
  assert.equal(
    L.leaseFollowUpTitle({ unitNumber: "2B", propertyName: "1635 Van Vranken Ave", leaseEnd: "2026-11-30", today: "2026-12-01" }),
    "Lease for Unit 2B at 1635 Van Vranken Ave ended on Nov 30. Renewed, moving out, or month-to-month?",
  );
  assert.equal(
    L.leaseFollowUpTitle({ unitNumber: "Unit 3", propertyName: "108 Jackson Avenue", leaseEnd: "2025-06-30", today: "2026-11-13" }),
    "Lease for Unit 3 at 108 Jackson Avenue ended on Jun 30, 2025. Renewed, moving out, or month-to-month?",
  );
});

// --- validation ---------------------------------------------------------------------------------

const TODAY = "2026-11-13";
const ok = { hasCurrent: true, moveOutDate: TODAY, fullName: "Jane Doe", phones: ["(518) 555-1234", ""], email: "jane@example.com", leaseStart: "2026-12-01", leaseEnd: "2027-11-30", rent: "1250", today: TODAY };

test("New renter: a complete form is valid", () => {
  assert.deepEqual(L.validateNewRenter(ok), {});
  assert.deepEqual(L.validateNewRenter({ ...ok, phones: [], email: "", leaseStart: "", leaseEnd: "", rent: "" }), {});
});

test("New renter: specific messages per field", () => {
  const v = (patch) => L.validateNewRenter({ ...ok, ...patch });
  assert.equal(v({ fullName: "  " }).fullName, "Enter the new renter's full name.");
  assert.equal(v({ leaseStart: "2027-01-01", leaseEnd: "2026-12-31" }).leaseEnd, "Lease end must be after lease start.");
  assert.equal(v({ leaseStart: "2027-01-01", leaseEnd: "2027-01-01" }).leaseEnd, "Lease end must be after lease start.");
  assert.equal(v({ phones: ["518-555-12"] }).phone0, "Phone 1 doesn't look complete. Use 10 digits, like (518) 555-1234.");
  assert.equal(v({ phones: ["5185551234", "518 555 999"] }).phone1, "Phone 2 doesn't look complete. Use 10 digits, like (518) 555-1234.");
  assert.equal(v({ phones: ["5185551234", "+1 518 555 1234"] }).phone1, "Phone 2 is the same as another number.");
  assert.equal(v({ email: "jane@" }).email, "That email address doesn't look right. Use the form name@example.com.");
  assert.equal(v({ moveOutDate: "" }).moveOutDate, "Enter the move-out date.");
  assert.equal(v({ moveOutDate: "2026-11-14" }).moveOutDate, L.LEASE_MSG.moveOutFuture);
  assert.equal(v({ moveOutDate: "2026-02-30" }).moveOutDate, L.LEASE_MSG.moveOutInvalid);
  assert.equal(v({ hasCurrent: false, moveOutDate: "" }).moveOutDate, undefined); // nobody to move out
  assert.equal(v({ leaseStart: "2026-13-01" }).leaseStart, L.LEASE_MSG.leaseStartInvalid);
  assert.equal(v({ leaseStart: "", leaseEnd: "2026-11-01" }).leaseEnd, L.LEASE_MSG.leaseEndPast);
  assert.equal(v({ rent: "abc" }).rent, "Enter the rent as a dollar amount, like 1250 or 1250.50.");
  assert.equal(v({ rent: "0" }).rent, "The rent must be more than $0.00.");
  // Every bad field at once, first in form order.
  const all = v({ fullName: "", email: "x", leaseEnd: "2026-11-30", leaseStart: "2026-12-01" });
  assert.deepEqual(L.firstError(all, L.NEW_RENTER_ORDER), { field: "fullName", message: "Enter the new renter's full name." });
  assert.ok(all.email && all.leaseEnd);
});

test("cleanPhoneList normalises to E.164 and ignores blank rows", () => {
  assert.deepEqual(L.cleanPhoneList(["(518) 555-1234", " ", "+1 518 555 9999"]), { phones: ["+15185551234", "+15185559999"], errors: {} });
});

test("Move out validation", () => {
  assert.deepEqual(L.validateMoveOut({ moveOutDate: TODAY, today: TODAY }), {});
  assert.deepEqual(L.validateMoveOut({ moveOutDate: "2026-10-31", today: TODAY }), {});
  assert.equal(L.validateMoveOut({ moveOutDate: "", today: TODAY }).moveOutDate, "Enter the move-out date.");
  assert.equal(L.validateMoveOut({ moveOutDate: null, today: TODAY }).moveOutDate, "Enter the move-out date.");
  assert.equal(L.validateMoveOut({ moveOutDate: "2026-11-20", today: TODAY }).moveOutDate, L.LEASE_MSG.moveOutFuture);
});

test("Renewed validation", () => {
  assert.deepEqual(L.validateRenewal({ leaseEnd: "2027-11-30", oldLeaseEnd: "2026-11-30", today: TODAY }), {});
  assert.equal(L.validateRenewal({ leaseEnd: "", oldLeaseEnd: "2026-11-30", today: TODAY }).leaseEnd, "Enter the new lease end date.");
  assert.equal(
    L.validateRenewal({ leaseEnd: "2026-11-30", oldLeaseEnd: "2026-11-30", today: "2026-12-05" }).leaseEnd,
    "The new lease end must be after the old one (Nov 30).",
  );
  assert.equal(L.validateRenewal({ leaseEnd: TODAY, oldLeaseEnd: "2026-10-31", today: TODAY }).leaseEnd, "The new lease end must be after today.");
  assert.equal(L.validateRenewal({ leaseEnd: "2027-02-29", oldLeaseEnd: null, today: TODAY }).leaseEnd, L.LEASE_MSG.leaseEndInvalid);
});
