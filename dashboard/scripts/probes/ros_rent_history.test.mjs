// Tests for rent changes with an effective month (2026-11-13, spec 5.9 "Rent history"):
// convex/unitRentPolicy.ts (pure rules), convex/unitRentLib.ts (changeRent / history on a fake
// database), the Payments page using the rent FOR the month (rentPaymentsLib), the unit form's
// number parsing (unitFieldsPolicy.ts) and the access gate (unitRent.ts: admin view + accountant).
// No packages. From dashboard/:
//   node --test scripts/probes/ros_rent_history.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const H = await import("../../convex/unitRentPolicy.ts");
const HL = await import("../../convex/unitRentLib.ts");
const L = await import("../../convex/rentPaymentsLib.ts");
const R = await import("../../convex/rentPaymentsPolicy.ts");
const P = await import("../../convex/rosPolicy.ts");
const UF = await import("../../convex/unitFieldsPolicy.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const read = (name) => readFileSync(join(CONVEX, name), "utf8");

const TODAY = "2026-11-13";

// =================================================================================================
// Part 1: the pure rules
// =================================================================================================

test("rentForMonth: no history = the roster rent in exact cents", () => {
  assert.equal(H.rentForMonth({ rent: 1200 }, [], "2026-10"), 120000);
  assert.equal(H.rentForMonth({ rent: 950.87 }, [], "2026-10"), 95087);
  assert.equal(H.rentForMonth({ rent: 950.875 }, [], "2026-10"), null);
  assert.equal(H.rentForMonth({}, [], "2026-10"), null);
  assert.deepStrictEqual(H.rentInEffect({ rent: 1200 }, [], "2026-10"), { cents: 120000, fromMonth: null, changeId: null, hasHistory: false });
});

test("rentForMonth: the latest change on or before the month; before the first change, the rent the unit had before it", () => {
  // units.rent is kept at the LATEST rent (1300), so the base must come from the first change.
  const unit = { rent: 1300 };
  const changes = [{ _id: "c1", effectiveMonth: "2026-11", rentCents: 130000, previousRentCents: 120000, createdAt: 2 }];
  assert.equal(H.rentForMonth(unit, changes, "2026-10"), 120000, "October rent is October's, not the new November rent");
  assert.equal(H.rentForMonth(unit, changes, "2026-11"), 130000);
  assert.equal(H.rentForMonth(unit, changes, "2027-06"), 130000);
  assert.deepStrictEqual(H.rentInEffect(unit, changes, "2026-12"), { cents: 130000, fromMonth: "2026-11", changeId: "c1", hasHistory: true });
  assert.deepStrictEqual(H.rentInEffect(unit, changes, "2026-10"), { cents: 120000, fromMonth: null, changeId: null, hasHistory: true });
  // several changes, any order
  const many = [
    { effectiveMonth: "2027-01", rentCents: 140000, previousRentCents: 130000, createdAt: 3 },
    { effectiveMonth: "2026-09", rentCents: 125000, previousRentCents: 120000, createdAt: 4 },
    ...changes,
  ];
  assert.deepStrictEqual(
    ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"].map((m) => H.rentForMonth(unit, many, m)),
    [120000, 125000, 125000, 130000, 130000, 140000],
  );
  // a unit that had no rent before its first change: no rent for the months before it
  assert.equal(H.rentForMonth({ rent: 900 }, [{ effectiveMonth: "2026-11", rentCents: 90000 }], "2026-10"), null);
  // a bad stored value never becomes money
  assert.equal(H.rentForMonth({}, [{ effectiveMonth: "2026-11", rentCents: 1.5 }], "2026-11"), null);
  // two rows for one month (should never happen): the newest written wins
  assert.equal(
    H.rentForMonth({}, [
      { effectiveMonth: "2026-11", rentCents: 1000, createdAt: 9 },
      { effectiveMonth: "2026-11", rentCents: 2000, createdAt: 1 },
    ], "2026-11"),
    1000,
  );
  assert.deepStrictEqual(H.upcomingRentChange(many, "2026-11").effectiveMonth, "2027-01");
  assert.equal(H.upcomingRentChange(many, "2027-01"), null);
  assert.equal(H.latestRentChange(many).effectiveMonth, "2027-01");
  assert.deepStrictEqual(H.governedMonths(many, "2026-09"), { from: "2026-09", until: "2026-11" });
  assert.deepStrictEqual(H.governedMonths(many, "2027-01"), { from: "2027-01", until: null });
});

test("centsToRosterDollars: units.rent round-trips to the same cents (no float drift)", () => {
  for (let c = 1; c <= 200_000; c++) assert.equal(P.rosterRentToCents(H.centsToRosterDollars(c)), c);
  for (let c = 200_000; c <= 100_000_000; c += 9973) assert.equal(P.rosterRentToCents(H.centsToRosterDollars(c)), c);
  assert.equal(P.rosterRentToCents(H.centsToRosterDollars(100_000_000)), 100_000_000);
  for (const bad of [0, -1, 1.5, 100_000_001, NaN]) assert.throws(() => H.centsToRosterDollars(bad));
});

test("rentHistoryLines: newest first, each with the rent it replaced", () => {
  const lines = H.rentHistoryLines({ rent: 1300 }, [
    { _id: "a", effectiveMonth: "2026-09", rentCents: 125000, previousRentCents: 120000, createdAt: 1 },
    { _id: "b", effectiveMonth: "2026-11", rentCents: 130000, previousRentCents: 120000, createdAt: 2 },
  ]);
  assert.deepStrictEqual(lines.map((l) => [l.change._id, l.fromCents, l.toCents]), [
    ["b", 125000, 130000],
    ["a", 120000, 125000],
  ]);
});

test("validateRentChange: exact messages; money parsed with parseDollarsToCents (never Number)", () => {
  const v = (o) => H.validateRentChange({ rent: "1,250.50", effectiveMonth: "2026-11", note: "", today: TODAY, ...o });
  assert.deepStrictEqual(v({}), { ok: true, value: { rentCents: 125050, effectiveMonth: "2026-11", note: null } });
  assert.deepStrictEqual(v({ rent: "$1200", note: "  lease renewal " }).value, { rentCents: 120000, effectiveMonth: "2026-11", note: "lease renewal" });
  const bad = (o) => {
    const r = v(o);
    assert.equal(r.ok, false, JSON.stringify(o));
    return [r.field, r.message];
  };
  for (const blank of ["", "   ", null, undefined]) assert.deepStrictEqual(bad({ rent: blank }), ["rent", "Enter the new rent."]);
  for (const shape of ["1250.555", "-5", "abc", "12.5.0", "1e3", "Infinity", "0x10"]) {
    assert.deepStrictEqual(bad({ rent: shape }), ["rent", "Enter the rent as a dollar amount, like 1250 or 1250.50."], shape);
  }
  for (const zero of ["0", "0.00", "$0"]) assert.deepStrictEqual(bad({ rent: zero }), ["rent", "The rent must be more than $0.00."], zero);
  for (const big of ["1000000.01", "2,000,000", "99999999999999999999"]) {
    assert.deepStrictEqual(bad({ rent: big }), ["rent", "The rent can't be more than $1,000,000.00."], big);
  }
  assert.equal(v({ rent: "1000000" }).value.rentCents, 100_000_000);
  assert.equal(v({ rent: "0.01" }).value.rentCents, 1);
  for (const blank of ["", null, undefined]) assert.deepStrictEqual(bad({ effectiveMonth: blank }), ["effectiveMonth", "Select the month the new rent starts."]);
  assert.deepStrictEqual(bad({ effectiveMonth: "2026-13" }), ["effectiveMonth", "Select a real month (like October 2026)."]);
  // 24 months back (Nov 2024) is the oldest; 12 ahead (Nov 2027) the latest
  assert.equal(v({ effectiveMonth: "2024-11" }).ok, true);
  assert.deepStrictEqual(bad({ effectiveMonth: "2024-10" }), [
    "effectiveMonth",
    "The new rent can't start in October 2024 — that's more than 24 months ago.",
  ]);
  assert.equal(v({ effectiveMonth: "2027-11" }).ok, true);
  assert.deepStrictEqual(bad({ effectiveMonth: "2027-12" }), [
    "effectiveMonth",
    "The new rent can't start in December 2027 — that's more than 12 months ahead.",
  ]);
  assert.deepStrictEqual(bad({ note: "x".repeat(201) }), ["note", "Keep the note under 200 characters."]);
  assert.deepStrictEqual(H.validateRentChangeAll({ rent: "", effectiveMonth: "", note: "x".repeat(201), today: TODAY }), {
    rent: "Enter the new rent.",
    effectiveMonth: "Select the month the new rent starts.",
    note: "Keep the note under 200 characters.",
  });
  const opts = H.rentChangeMonthOptions(TODAY);
  assert.equal(opts.length, 37);
  assert.deepStrictEqual([opts[0].value, opts[12].value, opts[36].value], ["2027-11", "2026-11", "2024-11"]);
  assert.equal(opts[12].label, "November 2026");
});

test("rentLabel: what the unit form shows", () => {
  assert.equal(H.rentLabel({ cents: 125000, fromMonth: "2026-11" }), "Rent $1,250.00/month (from November 2026)");
  assert.equal(H.rentLabel({ cents: 95087, fromMonth: null }), "Rent $950.87/month (from the roster)");
  assert.equal(H.rentLabel({ cents: null, fromMonth: null }), "No rent set");
});

test("rentMarkability with history: the amount is the rent FOR the month; no rent that month = not markable", () => {
  const changes = [{ effectiveMonth: "2026-11", rentCents: 130000, previousRentCents: 120000 }];
  assert.deepStrictEqual(R.rentMarkability({ rent: 1300 }, ["Cara Diaz"], { month: "2026-10", changes }), {
    markable: true,
    amountCents: 120000,
    counterparty: "Cara Diaz",
  });
  assert.equal(R.rentMarkability({ rent: 1300 }, ["Cara Diaz"], { month: "2026-11", changes }).amountCents, 130000);
  const none = R.rentMarkability({ rent: 900 }, ["T"], { month: "2026-10", changes: [{ effectiveMonth: "2026-11", rentCents: 90000 }] });
  assert.deepStrictEqual([none.markable, none.code, none.reason, none.sentence], [false, "no_rent_month", "No rent set for this month", "no rent is set for this month"]);
  // the roster rules still come first
  assert.equal(R.rentMarkability({ rent: 1300, rentPaidTo: "owner_direct" }, ["T"], { month: "2026-11", changes }).code, "owner_direct");
  assert.equal(R.rentMarkability({ rent: 1300 }, [], { month: "2026-11", changes }).code, "vacant");
  // no history: exactly the old behaviour (roster rent)
  assert.deepStrictEqual(R.rentMarkability({ rent: 1200 }, ["C"], { month: "2026-10", changes: [] }), R.rentMarkability({ rent: 1200 }, ["C"]));
});

test("unit form numbers: no silent NaN; exact field messages; rent via integer cents", () => {
  const ok = (o) => UF.validateUnitForm({ unitNumber: " 4B ", bedrooms: "1br", floor: "", bathrooms: "", ...o });
  assert.deepStrictEqual(ok({}), { errors: {}, value: { unitNumber: "4B", bedrooms: "1br" } });
  assert.deepStrictEqual(ok({ floor: "3", bathrooms: "1.5" }).value, { unitNumber: "4B", bedrooms: "1br", floor: 3, bathrooms: 1.5 });
  assert.deepStrictEqual(ok({ floor: "0", bathrooms: "2.0" }).value, { unitNumber: "4B", bedrooms: "1br", floor: 0, bathrooms: 2 });
  assert.deepStrictEqual(ok({ floor: "-1" }).value.floor, -1);
  for (const f of ["2.5", "abc", "1e2", "999", " - ", "NaN"]) {
    assert.equal(ok({ floor: f }).errors.floor, "Enter the floor as a whole number, like 2 (0 for the basement).", f);
  }
  for (const b of ["1.25", "-1", "abc", "21", "NaN", "1,5"]) {
    assert.equal(ok({ bathrooms: b }).errors.bathrooms, "Enter the bathrooms as a number like 1 or 1.5.", b);
  }
  assert.deepStrictEqual(ok({ unitNumber: "  ", bedrooms: "" }).errors, { unitNumber: "Enter a unit number.", bedrooms: "Select the unit type." });
  // Add unit: rent (dollars for units.rent, via cents) and the asset manager
  assert.equal(ok({ rent: "1,250.50", assetManagerUserId: "u" }).value.rent, 1250.5);
  assert.equal(ok({ rent: "", assetManagerUserId: "u" }).value.rent, undefined);
  for (const r of ["1250.555", "0", "-5", "abc", "1000000.01"]) {
    assert.equal(ok({ rent: r, assetManagerUserId: "u" }).errors.rent, "Enter the rent as a dollar amount over $0, like 1250 or 1250.50.", r);
  }
  for (const am of ["", null]) assert.equal(ok({ rent: "", assetManagerUserId: am }).errors.assetManagerUserId, "Select the asset manager for this unit.");
  // server-side twins
  assert.equal(UF.floorProblem(NaN), "Enter the floor as a whole number, like 2 (0 for the basement).");
  assert.equal(UF.floorProblem(2), null);
  assert.equal(UF.bathroomsProblem(Infinity), "Enter the bathrooms as a number like 1 or 1.5.");
  assert.equal(UF.bathroomsProblem(1.5), null);
  assert.equal(UF.rosterRentProblem(1250.555), "Enter the rent as a dollar amount over $0, like 1250 or 1250.50.");
  assert.equal(UF.rosterRentProblem(1250.5), null);
});

// =================================================================================================
// Part 2: changeRent / history and the Payments page on a fake database
// =================================================================================================

function fakeDb(tables) {
  let n = 0;
  const all = () => Object.values(tables).flat();
  return {
    normalizeId: (table, id) => ((tables[table] ?? []).some((r) => r._id === id) ? id : null),
    get: async (id) => all().find((r) => r._id === id) ?? null,
    query: (table) => {
      let rows = [...(tables[table] ?? [])];
      const api = {
        withIndex: (_name, fn) => {
          const conds = [];
          const b = {
            eq: (f, v) => (conds.push((r) => r[f] === v), b),
            gte: (f, v) => (conds.push((r) => r[f] !== undefined && r[f] >= v), b),
            lte: (f, v) => (conds.push((r) => r[f] !== undefined && r[f] <= v), b),
          };
          if (fn) fn(b);
          rows = rows.filter((r) => conds.every((c) => c(r)));
          return api;
        },
        order: (dir) => {
          rows.sort((a, b) => String(a.month ?? a.date ?? "").localeCompare(String(b.month ?? b.date ?? "")));
          if (dir === "desc") rows.reverse();
          return api;
        },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
        take: async (k) => rows.slice(0, k),
      };
      return api;
    },
    insert: async (table, doc) => {
      const _id = `${table}_${++n}`;
      (tables[table] ??= []).push({ _id, ...doc });
      return _id;
    },
    patch: async (id, patch) => {
      const r = all().find((x) => x._id === id);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete r[k];
        else r[k] = v;
      }
    },
  };
}

const J = "108 Jackson Avenue";
const RENT_ACC = { _id: "a_rent", orgId: "org1", name: "Rent Income", nameKey: "rent income", kind: "income", systemKey: "rent_income", feeBase: true, active: true };
const ORG = { orgId: "org1", user: { _id: "user1" } };

function setup() {
  const t = {
    users: [{ _id: "user1", firstName: "Delia", lastName: "Smith" }],
    owners: [{ _id: "o1", orgId: "org1", legalName: "Nye Properties LLC" }],
    properties: [
      { _id: "p1", orgId: "org1", name: J, category: "gold" },
      { _id: "px", orgId: "other", name: "Other org" },
    ],
    ownerProperties: [{ _id: "l1", orgId: "org1", ownerId: "o1", propertyId: "p1", startMonth: "2026-01" }],
    units: [
      { _id: "u1", orgId: "org1", propertyId: "p1", unitNumber: "1", rent: 1200, rentPaidTo: "company", occupancy: "occupied" },
      { _id: "u2", orgId: "org1", propertyId: "p1", unitNumber: "2", rent: 950.87 },
      { _id: "u3", orgId: "org1", propertyId: "p1", unitNumber: "3" },
      { _id: "ux", orgId: "other", propertyId: "px", unitNumber: "1", rent: 999 },
    ],
    residents: [
      { _id: "r1", orgId: "org1", unitId: "u1", fullName: "David Roberts", active: true },
      { _id: "r2", orgId: "org1", unitId: "u2", fullName: "Sharavia Rivera", active: true },
      { _id: "r3", orgId: "org1", unitId: "u3", fullName: "Third Tenant", active: true },
    ],
    ledgerAccounts: [RENT_ACC],
    ownerStatementProperties: [],
    ownerStatements: [],
    ledgerEntries: [],
    unitRentChanges: [],
  };
  const events = [];
  const deps = { audit: async (e) => void events.push(e), rentAccount: async () => RENT_ACC };
  return { t, ctx: { db: fakeDb(t) }, deps, events };
}

async function refused(promise, field, message) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.data?.field, field);
    assert.equal(e.data?.message, message);
    return true;
  });
}

const change = (s, o = {}) => HL.changeRent(s.ctx, ORG, { unitId: "u1", rent: "1300", effectiveMonth: "2026-11", note: "", ...o }, TODAY, s.deps);
const mark = (s, o = {}) =>
  L.markOne(s.ctx, ORG, { unitId: "u1", month: "2026-10", receivedDate: "2026-11-05", method: "check", note: null, ...o }, TODAY, s.deps);
const list = (s, month) => L.listPayments(s.ctx, ORG, { month }, TODAY);
const row = async (s, month, unitId = "u1") => (await list(s, month)).rows.find((r) => r.unitId === unitId);

test("changeRent: writes one change row, keeps units.rent at the latest rent, audits from / to / effective month", async () => {
  const s = setup();
  const out = await change(s, { note: " Lease renewal " });
  assert.deepStrictEqual(out, { rentCents: 130000, effectiveMonth: "2026-11", previousRentCents: 120000, replaced: false, paidMonths: [], info: [] });
  assert.equal(s.t.unitRentChanges.length, 1);
  const c = s.t.unitRentChanges[0];
  assert.deepStrictEqual(
    { orgId: c.orgId, unitId: c.unitId, effectiveMonth: c.effectiveMonth, rentCents: c.rentCents, previousRentCents: c.previousRentCents, note: c.note, createdBy: c.createdBy },
    { orgId: "org1", unitId: "u1", effectiveMonth: "2026-11", rentCents: 130000, previousRentCents: 120000, note: "Lease renewal", createdBy: "user1" },
  );
  assert.ok(Number.isSafeInteger(c.rentCents));
  assert.equal(s.t.units[0].rent, 1300);
  assert.equal(s.events.length, 1);
  const e = s.events[0];
  assert.deepStrictEqual([e.entity, e.entityId, e.action, e.actorUserId], ["unit", "u1", "rent_changed", "user1"]);
  assert.deepStrictEqual(JSON.parse(e.from), { rentCents: 120000 });
  assert.deepStrictEqual(JSON.parse(e.to), { rentCents: 130000, effectiveMonth: "2026-11" });
  assert.equal(e.note, "Unit 1 at 108 Jackson Avenue · from November 2026 · Lease renewal");
  // nothing was marked or sent: no ledger rows
  assert.equal(s.t.ledgerEntries.length, 0);
});

test("a late October payment marked after a November increase is October's rent", async () => {
  const s = setup();
  await change(s);
  const oct = await mark(s);
  assert.equal(oct.amountCents, 120000, "October is still $1,200.00");
  assert.equal(s.t.ledgerEntries[0].amountCents, 120000);
  const nov = await mark(s, { month: "2026-11", receivedDate: "2026-11-06" });
  assert.equal(nov.amountCents, 130000);
  // the list shows each month's rent; the summary's expected total follows it
  const octRow = await row(s, "2026-10");
  assert.equal(octRow.payment.amountCents, 120000);
  const dec = await row(s, "2026-12");
  assert.equal(dec.rentCents, 130000);
  assert.equal(dec.status, "unpaid");
  // mark selected uses the month's rent too
  const s2 = setup();
  await change(s2, { unitId: "u2", rent: "1000", effectiveMonth: "2026-11" });
  const many = await L.markMany(s2.ctx, ORG, { unitIds: ["u1", "u2"], month: "2026-10", receivedDate: "2026-11-05", method: "cash" }, TODAY, s2.deps);
  assert.deepStrictEqual(many, { count: 2, totalCents: 120000 + 95087 });
  const manyNov = await L.markMany(s2.ctx, ORG, { unitIds: ["u1", "u2"], month: "2026-11", receivedDate: "2026-11-06", method: "cash" }, TODAY, s2.deps);
  assert.deepStrictEqual(manyNov, { count: 2, totalCents: 120000 + 100000 });
});

test("a change effective in the past changes unpaid months only; paid months keep their amount (info message)", async () => {
  const s = setup();
  await mark(s, { month: "2026-09", receivedDate: "2026-09-03" });
  await mark(s, { month: "2026-10", receivedDate: "2026-10-04" });
  const out = await change(s, { rent: "1250", effectiveMonth: "2026-09" });
  assert.deepStrictEqual(out.paidMonths, [
    { month: "2026-09", amountCents: 120000 },
    { month: "2026-10", amountCents: 120000 },
  ]);
  assert.deepStrictEqual(out.info, [
    "September 2026 is already marked paid at $1,200.00; that payment isn't changed.",
    "October 2026 is already marked paid at $1,200.00; that payment isn't changed.",
  ]);
  // the payments themselves are untouched
  assert.deepStrictEqual(s.t.ledgerEntries.map((e) => e.amountCents), [120000, 120000]);
  assert.equal((await row(s, "2026-09")).payment.amountCents, 120000);
  // an unpaid month it covers now expects the new rent; before it, the old rent
  assert.equal((await row(s, "2026-11")).rentCents, 125000);
  assert.equal((await row(s, "2026-08")).rentCents, 120000);
  // the exact wording the brief asks for
  const s2 = setup();
  await mark(s2, { month: "2026-10", receivedDate: "2026-10-04" });
  const o2 = await change(s2, { rent: "1300", effectiveMonth: "2026-10" });
  assert.deepStrictEqual(o2.info, ["October 2026 is already marked paid at $1,200.00; that payment isn't changed."]);
  // only months it governs: a later change takes over from its own month
  const s3 = setup();
  await mark(s3, { month: "2026-11", receivedDate: "2026-11-02" });
  await change(s3, { rent: "1300", effectiveMonth: "2026-11" }).catch(() => {});
  const o3 = await change(s3, { rent: "1250", effectiveMonth: "2026-09" });
  assert.deepStrictEqual(o3.info, [], "November is governed by the November change, not this one");
  // a voided payment or one at the same amount is not reported
  const s4 = setup();
  await mark(s4, { month: "2026-10", receivedDate: "2026-10-04" });
  s4.t.ledgerEntries[0].voided = true;
  assert.deepStrictEqual((await change(s4, { rent: "1300", effectiveMonth: "2026-10" })).info, []);
});

test("same effective month: the later change replaces the earlier one (audited); the same amount is refused", async () => {
  const s = setup();
  await change(s);
  const out = await change(s, { rent: "1350" });
  assert.equal(out.replaced, true);
  assert.equal(out.previousRentCents, 130000);
  assert.equal(s.t.unitRentChanges.length, 1);
  assert.equal(s.t.unitRentChanges[0].rentCents, 135000);
  assert.equal(s.t.unitRentChanges[0].previousRentCents, 120000, "the pre-change rent is kept");
  assert.equal(s.t.units[0].rent, 1350);
  assert.equal(s.events.length, 2);
  assert.equal(s.events[1].note, "Unit 1 at 108 Jackson Avenue · from November 2026 · replaced the earlier change for November 2026 ($1,300.00)");
  assert.equal(H.rentForMonth(s.t.units[0], s.t.unitRentChanges, "2026-10"), 120000);
  await refused(change(s, { rent: "1350.00" }), "rent", "The rent from November 2026 is already $1,350.00.");
  // asking for the rent already in force from that month (no row for it) is refused too
  await refused(change(s, { rent: "1200", effectiveMonth: "2026-10" }), "rent", "The rent from October 2026 is already $1,200.00.");
  // replacing the FIRST change with the rent the unit had before any change would undo it: refused
  await refused(change(s, { rent: "1200" }), "rent", "The rent from November 2026 would be the same as before ($1,200.00). Nothing to change.");
  assert.equal(s.events.length, 2);
  assert.equal(s.t.unitRentChanges[0].rentCents, 135000, "the refused change wrote nothing");
});

test("an earlier change slots in before a later one; units.rent stays the latest (an upcoming rent too)", async () => {
  const s = setup();
  await change(s); // Nov 1300
  await change(s, { rent: "1250", effectiveMonth: "2026-09" });
  assert.equal(s.t.units[0].rent, 1300);
  const sep = s.t.unitRentChanges.find((c) => c.effectiveMonth === "2026-09");
  assert.equal(sep.previousRentCents, 120000);
  const at = (m) => H.rentForMonth(s.t.units[0], s.t.unitRentChanges, m);
  assert.deepStrictEqual(["2026-08", "2026-09", "2026-10", "2026-11"].map(at), [120000, 125000, 125000, 130000]);
  await change(s, { rent: "1400", effectiveMonth: "2027-01" });
  assert.equal(s.t.units[0].rent, 1400, "units.rent = the latest change (no cron needed when January starts)");
  const h = await HL.rentHistory(s.ctx, ORG, { unitId: "u1" }, TODAY);
  assert.deepStrictEqual(h.current, { cents: 130000, fromMonth: "2026-11" });
  assert.deepStrictEqual(h.upcoming, { month: "2027-01", cents: 140000 });
  assert.equal(h.hasHistory, true);
  assert.deepStrictEqual(h.lines.map((l) => [l.effectiveMonth, l.fromCents, l.toCents, l.byName]), [
    ["2027-01", 130000, 140000, "Delia Smith"],
    ["2026-11", 125000, 130000, "Delia Smith"],
    ["2026-09", 120000, 125000, "Delia Smith"],
  ]);
  assert.deepStrictEqual([h.earliestMonth, h.latestMonth, h.currentMonth], ["2024-11", "2027-11", "2026-11"]);
  // no history: the roster rent
  const h2 = await HL.rentHistory(s.ctx, ORG, { unitId: "u2" }, TODAY);
  assert.deepStrictEqual([h2.current, h2.upcoming, h2.hasHistory, h2.lines], [{ cents: 95087, fromMonth: null }, null, false, []]);
});

test("a unit with no rent before its first change: earlier months can't be marked ('no rent is set for this month')", async () => {
  const s = setup();
  await change(s, { unitId: "u3", rent: "900" });
  assert.equal(s.t.unitRentChanges[0].previousRentCents, undefined);
  assert.equal(s.t.units[2].rent, 900);
  await refused(mark(s, { unitId: "u3" }), "unitId", "Rent can't be marked for Unit 3 at 108 Jackson Avenue: no rent is set for this month.");
  const oct = await row(s, "2026-10", "u3");
  assert.deepStrictEqual([oct.status, oct.reason, oct.rentCents], ["not_markable", "No rent set for this month", null]);
  assert.equal((await mark(s, { unitId: "u3", month: "2026-11" })).amountCents, 90000);
});

test("changeRent: unit, amount, month and note refused with exact field messages; nothing written", async () => {
  const s = setup();
  await refused(change(s, { unitId: "" }), "unitId", "Select the unit to change rent for.");
  await refused(change(s, { unitId: null }), "unitId", "Select the unit to change rent for.");
  await refused(change(s, { unitId: "nope" }), "unitId", "Unit not found.");
  await refused(change(s, { unitId: "ux" }), "unitId", "Unit not found.");
  await refused(change(s, { rent: "" }), "rent", "Enter the new rent.");
  await refused(change(s, { rent: "1250.555" }), "rent", "Enter the rent as a dollar amount, like 1250 or 1250.50.");
  await refused(change(s, { rent: "-1200" }), "rent", "Enter the rent as a dollar amount, like 1250 or 1250.50.");
  await refused(change(s, { rent: "0" }), "rent", "The rent must be more than $0.00.");
  await refused(change(s, { rent: "1000000.01" }), "rent", "The rent can't be more than $1,000,000.00.");
  await refused(change(s, { effectiveMonth: null }), "effectiveMonth", "Select the month the new rent starts.");
  await refused(change(s, { effectiveMonth: "Nov" }), "effectiveMonth", "Select a real month (like October 2026).");
  await refused(change(s, { effectiveMonth: "2024-10" }), "effectiveMonth", "The new rent can't start in October 2024 — that's more than 24 months ago.");
  await refused(change(s, { effectiveMonth: "2027-12" }), "effectiveMonth", "The new rent can't start in December 2027 — that's more than 12 months ahead.");
  await refused(change(s, { note: "x".repeat(201) }), "note", "Keep the note under 200 characters.");
  assert.equal(s.t.unitRentChanges.length, 0);
  assert.equal(s.t.units[0].rent, 1200);
  assert.equal(s.events.length, 0);
  // history of another team's unit reads as not found
  await refused(HL.rentHistory(s.ctx, ORG, { unitId: "ux" }, TODAY), "unitId", "Unit not found.");
});

// =================================================================================================
// Part 3: server wiring (source scan; the registered handlers need Convex to run)
// =================================================================================================

test("access: unitRent.ts functions are admin view + accountant (requireFinance first); AM and technician are refused", () => {
  const src = read("unitRent.ts");
  for (const name of ["history", "changeRent"]) {
    const at = src.indexOf(`export const ${name} = `);
    assert.ok(at >= 0, name);
    const body = src.slice(at, src.indexOf("\n});", at));
    const handler = body.slice(body.search(/handler:\s*async\s*\(/));
    assert.equal(handler.slice(handler.indexOf("await "), handler.indexOf("await ") + "await requireFinance(ctx".length), "await requireFinance(ctx", name);
  }
  // the lib and the policy register nothing and check the org
  for (const f of ["unitRentLib.ts", "unitRentPolicy.ts", "unitFieldsPolicy.ts"]) {
    const s = read(f);
    assert.doesNotMatch(s, /\b(query|mutation|action|internalQuery|internalMutation|internalAction)\(\{/, f);
    assert.doesNotMatch(s, /^import \{[^}]*\} from "\.\/_generated\/server"/m, f);
  }
  assert.match(read("unitRentLib.ts"), /orgId === org\.orgId/);
  assert.match(read("unitRentLib.ts"), /orgId !== org\.orgId/);
  // never Number() / parseFloat on the typed rent
  assert.doesNotMatch(read("unitRentPolicy.ts"), /parseFloat|Number\(\s*(raw|s|input|i\.rent)/);
});

test("server: units.update refuses rent (Change rent keeps the history); the table, indexes and readers are wired", () => {
  const units = read("units.ts");
  assert.match(units, /if \(args\.rent !== undefined\) throw fieldError\("rent", RENT_CHANGE_MSG\.useChangeRent\);/);
  assert.doesNotMatch(units, /patch\.rent = args\.rent/);
  assert.equal(H.RENT_CHANGE_MSG.useChangeRent, "Rent is changed with Change rent, so its history is kept.");
  // a re-imported roster rent never overwrites a unit with history; removing a unit removes its history
  assert.match(units, /if \(key === "rent" && hasRentHistory\) \{[^}]*?continue;/s);
  assert.match(units, /rentKeptForHistory/);
  assert.match(units, /query\("unitRentChanges"\)/);
  const schema = read("schema.ts");
  assert.match(schema, /unitRentChanges: defineTable\(\{/);
  assert.match(schema, /\.index\("by_unit_and_month", \["unitId", "effectiveMonth"\]\)/);
  // the Payments page and the statement's unpaid check read the history
  const lib = read("rentPaymentsLib.ts");
  assert.match(lib, /rentMarkability\(u, tenants, \{ month, changes: rentChanges\.get\(u\._id\) \?\? \[\] \}\)/);
  assert.match(lib, /changes: await rentChangesOf\(ctx, org, unit\._id\)/);
  const build = read("rosBuild.ts");
  assert.match(build, /rentMarkability\(u, tenants, \{ month: m, changes \}\)/);
  assert.match(build, /query\("unitRentChanges"\)/);
});
