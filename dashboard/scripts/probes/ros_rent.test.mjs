// Tests for the roster-rent prefill on Rental Owner Statement drafts (until Stripe): every draft
// gets one Rent Income line per occupied unit from units.rent; the accountant edits / removes
// ("didn't pay") / adds rows and confirms the rent lines before finalizing (RENT_NOT_CHECKED).
// No packages. From dashboard/:
//   node --test scripts/probes/ros_rent.test.mjs
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
const B = await import("../../convex/rosBuild.ts");
const P = await import("../../convex/rosPolicy.ts");
const { buildView } = await import("../../convex/rosView.ts");
const { COMPANY_NAME, percentOf } = await import("../../convex/rosFormat.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const read = (name) => readFileSync(join(CONVEX, name), "utf8");

// --- fixture: the golden 108 Jackson September (rent entered by hand) + optional extra units --------

const OWNER = { _id: "o1", legalName: "Nye Properties LLC", contactFirstName: "Adam", contactLastName: "Nye", managementFeeBps: 500 };
const ACCOUNTS = [
  { _id: "a_rent", name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true, active: true },
  { _id: "a_dump", name: "Dump Fees", kind: "expense", feeBase: false, active: true },
  { _id: "a_land", name: "Landscaping", kind: "expense", feeBase: false, active: true },
  { _id: "a_mgmt", name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false, active: true },
  { _id: "a_pred", name: "Predicate Notice", kind: "expense", feeBase: false, active: true },
  { _id: "a_rep", name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false, active: true },
  { _id: "a_draw", name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false, active: true },
];
// The golden units, now WITH roster rent and tenants (as the roster import writes them).
const GOLDEN_UNITS = [
  { _id: "u1", unitNumber: "1st Floor", securityDepositHeldCents: 80000, rent: 883, rentPaidTo: "company" },
  { _id: "u2", unitNumber: "2nd Floor", securityDepositHeldCents: 80000, rent: 950.87, rentPaidTo: "company" },
  { _id: "u3", unitNumber: "3rd Floor", securityDepositHeldCents: 80000, rent: 2500 },
];
const GOLDEN_RESIDENTS = [
  { unitId: "u1", fullName: "David Roberts", active: true },
  { unitId: "u2", fullName: "Sharavia Rivera", active: true },
  { unitId: "u3", fullName: "Adrianna Mimbs", active: true },
];

let seq = 1_000;
const entry = (id, date, unitId, accountId, counterparty, memo, amountCents, extra = {}) => ({
  _id: id,
  ownerId: "o1",
  propertyId: "p1",
  ...(unitId ? { unitId } : {}),
  date,
  accountId,
  counterparty,
  memo,
  amountCents,
  source: "manual",
  createdAt: seq++,
  ...extra,
});
const GOLDEN_ENTRIES = [
  entry("r1", "2026-09-01", "u1", "a_rent", "David Roberts", "Payment", 88300),
  entry("r2", "2026-09-22", "u2", "a_rent", "Sharavia Rivera", "by Sharavia Rivera", 95087),
  entry("r3", "2026-09-24", "u3", "a_rent", "Adrianna Mimbs", "by Adrianna Mimbs", 250000),
  entry("e1", "2026-09-03", null, "a_land", COMPANY_NAME, "9/3 - Lawn mowing and weed whacking", 10000),
  entry("e2", "2026-09-11", "u2", "a_pred", COMPANY_NAME, "Bills", 13433),
  entry("e3", "2026-09-11", "u3", "a_pred", COMPANY_NAME, "Bills", 13433),
  entry("e4", "2026-09-16", null, "a_dump", COMPANY_NAME, "Dump Fees, driver, truck, fuel", 52020),
  entry("e5", "2026-09-23", null, "a_land", COMPANY_NAME, "9/23/26 - Lawn mowing and weed whacking", 11000),
];

function data(over = {}) {
  return {
    statement: {
      _id: "s1",
      ownerId: "o1",
      month: "2026-09",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      propertyIds: ["p1"],
      excludedKeys: [],
      adjustments: [{ propertyId: "p1", earlyPaymentsCents: 0, unpaidBillsCents: 0 }],
      overrides: [],
      ...(over.statement ?? {}),
    },
    owner: OWNER,
    accounts: over.accounts ?? ACCOUNTS,
    properties: [
      {
        propertyId: "p1",
        property: { name: "108 Jackson Avenue" },
        links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, startMonth: "2026-09" }],
        linkOwnerNames: ["Nye Properties LLC"],
        prevFinalEndingCents: null,
        hasAnyFinal: false,
        units: GOLDEN_UNITS,
        residents: GOLDEN_RESIDENTS,
        entries: GOLDEN_ENTRIES,
        workOrders: [],
        ...(over.property ?? {}),
      },
    ],
    statementDate: over.statementDate ?? "2026-10-16",
  };
}

// A building whose rent is NOT entered by hand: two occupied units, prefilled from the roster.
const RENT_UNITS = [
  { _id: "u4", unitNumber: "4A", rent: 950.87, rentPaidTo: "company" },
  { _id: "u5", unitNumber: "4B", rent: 1200 },
];
const RENT_RESIDENTS = [
  { unitId: "u4", fullName: "Bob Ray", active: true },
  { unitId: "u4", fullName: "Ann Lee", active: true },
  { unitId: "u4", fullName: "Old Tenant", active: false },
  { unitId: "u5", fullName: "Cara Diaz", active: true },
];
const rentData = (over = {}) =>
  data({
    ...over,
    property: { units: RENT_UNITS, residents: RENT_RESIDENTS, entries: [], ...(over.property ?? {}) },
  });

const keys = (lines) => lines.map((l) => l.key);
const omit = (o, ...drop) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.includes(k)));
const warn = (built, code) => built.warnings.find((w) => w.code === code);

// --- conversion --------------------------------------------------------------------------------------

test("rosterRentToCents: exact cents, no float drift; anything that isn't a clean dollar amount is refused", () => {
  assert.equal(P.rosterRentToCents(950.87), 95087);
  assert.equal(P.rosterRentToCents(883), 88300);
  assert.equal(P.rosterRentToCents(0.1), 10);
  assert.equal(P.rosterRentToCents(1.005 + 0), null); // 3 decimals
  assert.equal(P.rosterRentToCents(19.99), 1999);
  assert.equal(P.rosterRentToCents(1_000_000), 100_000_000);
  for (const bad of [1e-3, NaN, -5, -0.01, 0, Infinity, -Infinity, 950.875, 1e21, 1_000_000.01, "950", "junk", null, undefined, {}, true]) {
    assert.equal(P.rosterRentToCents(bad), null, `should refuse ${String(bad)}`);
  }
  // Every 2-decimal amount up to $10,000 converts exactly.
  for (let c = 1; c <= 1_000_000; c += 997) assert.equal(P.rosterRentToCents(Number((c / 100).toFixed(2))), c);
});

test("invalid roster rent: no line, listed as skipped, and an info (not blocking) warning", () => {
  for (const rent of [1e-3, -5, 950.875]) {
    const built = B.assembleStatement(rentData({ property: { units: [{ _id: "u4", unitNumber: "4A", rent }] } }));
    assert.ok(!keys(built.lines).includes("rent:u4"));
    assert.deepStrictEqual(built.rent.skipped.map((s) => [s.unitId, s.code, s.reason]), [
      ["u4", "invalid_rent", "the roster rent isn't a valid dollar amount"],
    ]);
    assert.deepStrictEqual(warn(built, "RENT_INVALID"), {
      code: "RENT_INVALID",
      propertyId: "p1",
      message:
        "Unit 4A (108 Jackson Avenue) has a roster rent that isn't a valid dollar amount, so no rent line was added. Fix the rent on the unit, or add the payment with “Add transaction”.",
      blocking: false,
    });
  }
});

// --- the prefilled line ------------------------------------------------------------------------------

test("prefill: one Rent Income line per occupied unit, tenants joined with ' & ', memo Payment, dated periodStart", () => {
  const built = B.assembleStatement(rentData());
  const rent = built.lines.filter((l) => l.kind === "rent");
  assert.deepStrictEqual(
    rent.map((l) => [l.key, l.date, l.unit, l.accountId, l.accountName, l.counterparty, l.name, l.memo, l.amountCents, l.sourceLabel, l.side, l.unitId, l.editable, l.rentEdited]),
    [
      ["rent:u4", "2026-09-01", "4A", "a_rent", "Rent Income", "Ann Lee & Bob Ray", "Unit 4A - Ann Lee & Bob Ray", "Payment", 95087, "Roster rent", "addition", "u4", true, false],
      ["rent:u5", "2026-09-01", "4B", "a_rent", "Rent Income", "Cara Diaz", "Unit 4B - Cara Diaz", "Payment", 120000, "Roster rent", "addition", "u5", true, false],
    ],
  );
  assert.deepStrictEqual(rent[0].rentDefault, { amountCents: 95087, date: "2026-09-01", counterparty: "Ann Lee & Bob Ray", memo: "Payment" });
  assert.equal(built.rent.lineCount, 2);
  assert.equal(built.rent.skipped.length, 0);
  // The PDF / preview row reads like the sample's rent rows.
  const view = buildView(built.result, { statementDate: "2026-10-16" });
  const row = view.detail.additions.find((l) => l.name === "Unit 4A - Ann Lee & Bob Ray");
  assert.equal(row.memo, "Payment");
  assert.equal(row.amount, "950.87");
  assert.equal(row.date, "9/1/2026");
});

test("fee base: roster rent counts exactly like a manual Rent Income row of the same amount", () => {
  const prefilled = B.assembleStatement(rentData());
  const manual = B.assembleStatement(
    rentData({
      property: {
        units: RENT_UNITS.map((u) => omit(u, "rent")), // no roster rent -> no prefill
        entries: [
          entry("m4", "2026-09-01", "u4", "a_rent", "Ann Lee & Bob Ray", "Payment", 95087),
          entry("m5", "2026-09-01", "u5", "a_rent", "Cara Diaz", "Payment", 120000),
        ],
      },
    }),
  );
  assert.equal(prefilled.result.generated[0].fee.baseCents, 215087);
  assert.equal(prefilled.result.generated[0].fee.baseCents, manual.result.generated[0].fee.baseCents);
  assert.equal(prefilled.result.generated[0].fee.amountCents, percentOf(215087, 500));
  assert.deepStrictEqual(prefilled.result.summary, manual.result.summary);
  assert.deepStrictEqual(prefilled.result.incomeStatement, manual.result.incomeStatement);
  // Turning the account's fee base off takes roster rent out too.
  const off = B.assembleStatement(rentData({ accounts: ACCOUNTS.map((a) => (a._id === "a_rent" ? { ...a, feeBase: false } : a)) }));
  assert.equal(off.result.generated[0].fee.baseCents, 0);
});

// --- skip rules ----------------------------------------------------------------------------------------

test("skip rules: owner collects directly, included in another unit, vacant, no rent — each listed, none silent", () => {
  const units = [
    { _id: "a", unitNumber: "1", rent: 900, rentPaidTo: "owner_direct" },
    { _id: "b", unitNumber: "2", rent: 900, rentPaidTo: "included_in_other_unit" },
    { _id: "c", unitNumber: "3", rent: 900 }, // only an inactive resident -> vacant
    { _id: "d", unitNumber: "4" }, // no rent
    { _id: "e", unitNumber: "5", rent: 900, rentPaidTo: "company" },
    { _id: "f", unitNumber: "10", rent: 900 }, // nobody at all -> vacant
  ];
  const residents = ["a", "b", "d", "e"].map((unitId) => ({ unitId, fullName: `Tenant ${unitId}`, active: true }));
  residents.push({ unitId: "c", fullName: "Moved Out", active: false });
  const built = B.assembleStatement(rentData({ property: { units, residents } }));
  assert.deepStrictEqual(keys(built.lines.filter((l) => l.kind === "rent")), ["rent:e"]);
  assert.deepStrictEqual(built.rent.skipped.map((s) => [s.unit, s.code, s.reason]), [
    ["1", "owner_direct", "owner collects rent directly"],
    ["2", "included_in_other_unit", "rent is included in another unit"],
    ["3", "vacant", "no active tenant"],
    ["4", "no_rent", "no rent on the roster"],
    ["10", "vacant", "no active tenant"],
  ]);
  assert.ok(!warn(built, "RENT_INVALID"));
});

test("skip rule order (pure): paid-to first, then already recorded, vacant, no rent, invalid", () => {
  const d = (u) => P.rentPrefillDecision({ tenants: ["T"], alreadyRecorded: false, ...u });
  assert.deepStrictEqual(d({ rentPaidTo: "owner_direct", alreadyRecorded: true, tenants: [] }), { ok: false, code: "owner_direct" });
  assert.deepStrictEqual(d({ rent: 5, alreadyRecorded: true, tenants: [] }), { ok: false, code: "already_recorded" });
  assert.deepStrictEqual(d({ tenants: ["  "] }), { ok: false, code: "vacant" });
  assert.deepStrictEqual(d({ rent: null }), { ok: false, code: "no_rent" });
  assert.deepStrictEqual(d({ rent: 0 }), { ok: false, code: "invalid_rent" });
  assert.deepStrictEqual(d({ rent: 12.5, tenants: ["Zed", "amy", "Zed"] }), { ok: true, amountCents: 1250, counterparty: "amy & Zed" });
});

test("a unit marked vacant on the roster is skipped even when an active resident is still on file", () => {
  const d = (u) => P.rentPrefillDecision({ rent: 1200, tenants: ["Still Listed"], alreadyRecorded: false, ...u });
  assert.deepStrictEqual(d({ occupancy: "vacant" }), { ok: false, code: "roster_vacant" });
  assert.deepStrictEqual(d({ occupancy: "vacant_not_ready" }), { ok: false, code: "roster_vacant" });
  assert.deepStrictEqual(d({ leaseType: "vacant" }), { ok: false, code: "roster_vacant" });
  // occupied (or not stated) still prefills
  for (const occupancy of ["occupied", "occupied_leaving", undefined, null]) {
    assert.deepStrictEqual(d({ occupancy, leaseType: "fixed" }), { ok: true, amountCents: 120000, counterparty: "Still Listed" });
  }
  // order: paid-to and already-recorded come first (more specific), then the roster's vacant flag
  assert.deepStrictEqual(d({ occupancy: "vacant", rentPaidTo: "owner_direct" }), { ok: false, code: "owner_direct" });
  assert.deepStrictEqual(d({ occupancy: "vacant", alreadyRecorded: true }), { ok: false, code: "already_recorded" });
  assert.equal(P.RENT_SKIP_TEXT.roster_vacant, "unit is marked vacant on the roster");

  // through the build: no rent line, listed under "Not prefilled", the other unit still prefills
  const units = [
    { _id: "u4", unitNumber: "4A", rent: 950.87, rentPaidTo: "company", occupancy: "vacant" },
    { _id: "u5", unitNumber: "4B", rent: 1200, occupancy: "occupied" },
  ];
  const built = B.assembleStatement(rentData({ property: { units } }));
  assert.deepStrictEqual(keys(built.lines.filter((l) => l.kind === "rent")), ["rent:u5"]);
  assert.deepStrictEqual(built.rent.skipped.map((s) => [s.unitId, s.code, s.reason]), [
    ["u4", "roster_vacant", "unit is marked vacant on the roster"],
  ]);
  assert.equal(built.result.summary.income.total, 120000);
  assert.ok(!warn(built, "RENT_INVALID"));
});

test("GOLDEN: 108 Jackson September (rent entered by hand) gets NO prefill and is byte-for-byte the same statement", () => {
  const withRoster = B.assembleStatement(data());
  const without = B.assembleStatement(data({ property: { units: GOLDEN_UNITS.map((u) => omit(u, "rent", "rentPaidTo")), residents: [] } }));
  assert.equal(withRoster.lines.filter((l) => l.kind === "rent").length, 0);
  assert.deepStrictEqual(withRoster.result, without.result);
  assert.equal(B.resultHash(withRoster.result), B.resultHash(without.result));
  assert.equal(withRoster.result.summary.income.total, 433387); // not doubled
  assert.equal(withRoster.result.generated[0].fee.amountCents, 21669);
  assert.deepStrictEqual(withRoster.rent.skipped.map((s) => [s.unitId, s.code, s.reason]), [
    ["u1", "already_recorded", "rent is already recorded for September 2026"],
    ["u2", "already_recorded", "rent is already recorded for September 2026"],
    ["u3", "already_recorded", "rent is already recorded for September 2026"],
  ]);
  assert.ok(!warn(withRoster, "RENT_NOT_CHECKED"), "no roster line -> no confirmation needed");
  assert.equal(withRoster.rent.hash, null);
});

test("already recorded: only a non-voided Rent Income row of that unit dated inside the period counts", () => {
  const run = (entries, extra = {}) =>
    keys(B.assembleStatement(rentData({ property: { entries, ...extra } })).lines.filter((l) => l.kind === "rent"));
  assert.deepStrictEqual(run([]), ["rent:u4", "rent:u5"]);
  assert.deepStrictEqual(run([entry("m", "2026-09-15", "u4", "a_rent", "Ann Lee", "Payment", 50000)]), ["rent:u5"]);
  // an excluded manual rent row still counts as recorded (no second line)
  assert.deepStrictEqual(
    keys(
      B.assembleStatement(
        rentData({ statement: { excludedKeys: ["entry:m"] }, property: { entries: [entry("m", "2026-09-15", "u4", "a_rent", "Ann Lee", "Payment", 50000)] } }),
      ).lines.filter((l) => l.kind === "rent"),
    ),
    ["rent:u5"],
  );
  assert.deepStrictEqual(run([entry("v", "2026-09-15", "u4", "a_rent", "Ann", "Payment", 50000, { voided: true })]), ["rent:u4", "rent:u5"]);
  assert.deepStrictEqual(run([entry("aug", "2026-08-31", "u4", "a_rent", "Ann", "Payment", 50000)]), ["rent:u4", "rent:u5"]);
  assert.deepStrictEqual(run([entry("oth", "2026-09-15", "u4", "a_land", "Ann", "Other", 50000)]), ["rent:u4", "rent:u5"]);
  assert.deepStrictEqual(run([entry("pl", "2026-09-15", null, "a_rent", "Ann", "Payment", 50000)]), ["rent:u4", "rent:u5"]);
  // another owner's row for the unit still means "recorded" (never doubled across owners)
  assert.deepStrictEqual(run([entry("o2", "2026-09-15", "u4", "a_rent", "Ann", "Payment", 50000, { ownerId: "o2" })]), ["rent:u5"]);
  // a billed row dated in the period (loader's rentRecorded), e.g. Stripe later or a roster_rent row
  assert.deepStrictEqual(
    run([], { rentRecorded: [entry("b", "2026-09-01", "u5", "a_rent", "Cara Diaz", "Payment", 120000, { source: "roster_rent", statementId: "s0" })] }),
    ["rent:u4"],
  );
});

// --- edits (overrides) -------------------------------------------------------------------------------

test("overrides: amount, date, name and memo apply; invalid stored values are ignored", () => {
  const built = B.assembleStatement(
    rentData({
      statement: {
        rentOverrides: [
          { unitId: "u4", amountCents: 90000, date: "2026-09-05", counterparty: "Ann Lee", memo: "Partial payment" },
          { unitId: "u5", amountCents: 0, date: "2026-10-01", counterparty: "  ", memo: "" },
        ],
      },
    }),
  );
  const a = built.lines.find((l) => l.key === "rent:u4");
  const b = built.lines.find((l) => l.key === "rent:u5");
  assert.deepStrictEqual([a.amountCents, a.date, a.counterparty, a.memo, a.name, a.rentEdited], [90000, "2026-09-05", "Ann Lee", "Partial payment", "Unit 4A - Ann Lee", true]);
  assert.deepStrictEqual([b.amountCents, b.date, b.counterparty, b.memo, b.rentEdited], [120000, "2026-09-01", "Cara Diaz", "Payment", false]);
  assert.equal(built.result.generated[0].fee.baseCents, 90000 + 120000);
});

test("validateRentLineFields: same messages client and server; date must stay inside the period", () => {
  const base = { amount: "950.87", date: "2026-09-05", counterparty: "Ann Lee", memo: "Payment", month: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30", today: "2026-10-16" };
  const v = (o) => P.validateRentLineFields({ ...base, ...o });
  assert.deepStrictEqual(v({}), { ok: true, value: { amountCents: 95087, date: "2026-09-05", counterparty: "Ann Lee", memo: "Payment" } });
  assert.deepStrictEqual(v({ amount: 95087 }).value.amountCents, 95087); // server sends cents
  const msg = (o) => {
    const r = v(o);
    return r.ok ? null : [r.field, r.message];
  };
  assert.deepStrictEqual(msg({ amount: "" }), ["amountCents", "Enter the rent amount."]);
  assert.deepStrictEqual(msg({ amount: null }), ["amountCents", "Enter the rent amount."]);
  assert.deepStrictEqual(msg({ amount: "12.345" }), ["amountCents", "Enter the amount like 1,250.00."]);
  assert.deepStrictEqual(msg({ amount: 12.5 }), ["amountCents", "Enter the amount like 1,250.00."]); // cents must be integer
  assert.deepStrictEqual(msg({ amount: "0" }), ["amountCents", "The amount must be more than $0.00. If the tenant didn't pay, remove the line instead."]);
  assert.deepStrictEqual(msg({ amount: 100_000_001 }), ["amountCents", "The amount can't be more than $1,000,000.00."]);
  assert.deepStrictEqual(msg({ date: "" }), ["date", "Enter the payment date."]);
  assert.deepStrictEqual(msg({ date: "2026-09-31" }), ["date", "Enter a real date."]);
  assert.deepStrictEqual(msg({ date: "2026-08-31" }), ["date", "The payment date must be in September 2026."]);
  assert.deepStrictEqual(msg({ date: "2026-10-01" }), ["date", "The payment date must be in September 2026."]);
  assert.deepStrictEqual(msg({ date: "2026-09-20", today: "2026-09-10" }), ["date", "The date can't be in the future."]);
  assert.deepStrictEqual(msg({ counterparty: " " }), ["counterparty", "Enter the tenant name that prints on the statement."]);
  assert.deepStrictEqual(msg({ counterparty: "x".repeat(121) }), ["counterparty", "Keep the name under 120 characters."]);
  assert.deepStrictEqual(msg({ memo: "" }), ["memo", "Enter a memo (it prints on the statement)."]);
  assert.deepStrictEqual(msg({ memo: "x".repeat(301) }), ["memo", "Keep the memo under 300 characters."]);
  assert.deepStrictEqual(Object.keys(P.validateRentLineFieldsAll({ ...base, amount: "", date: "", counterparty: "", memo: "" })), ["amountCents", "date", "counterparty", "memo"]);
});

// --- remove = didn't pay -------------------------------------------------------------------------------

test("remove (exclude) = didn't pay: off the statement and the fee base, listed under Excluded, put back restores it", () => {
  const off = B.assembleStatement(rentData({ statement: { excludedKeys: ["rent:u4"] } }));
  assert.deepStrictEqual(keys(off.lines.filter((l) => l.kind === "rent")), ["rent:u5"]);
  const ex = off.excludedLines.find((l) => l.key === "rent:u4");
  assert.deepStrictEqual([ex.kind, ex.sourceLabel, ex.amountCents, ex.defaultExcluded, ex.note], [
    "rent",
    "Roster rent",
    95087,
    undefined,
    "Removed: the tenant didn't pay this month. Put it back if the payment came in.",
  ]);
  assert.equal(off.result.generated[0].fee.baseCents, 120000);
  assert.ok(!B.finalizePlan(off, "s1").rentRows.some((r) => r.key === "rent:u4"));
  const back = B.toggledKeys({ excludedKeys: ["rent:u4"] }, "rent:u4", false, false);
  assert.deepStrictEqual(back, { excludedKeys: [], includedKeys: [] });
  assert.equal(B.lineKindOf("rent:u4"), "rent");
});

// --- finalize plan -------------------------------------------------------------------------------------

test("finalizePlan: one roster_rent row per included rent line, deterministic sourceId, no duplicates", () => {
  const built = B.assembleStatement(rentData({ statement: { rentOverrides: [{ unitId: "u4", date: "2026-09-07" }] } }));
  const plan = B.finalizePlan(built, "s1");
  assert.deepStrictEqual(
    // detail order: by date (u5 on the 1st, u4 moved to the 7th)
    plan.rentRows.map((r) => [r.key, r.source, r.sourceId, r.propertyId, r.unitId, r.date, r.postedDate, r.type, r.accountId, r.counterparty, r.memo, r.amountCents]),
    [
      ["rent:u5", "roster_rent", "s1:u5", "p1", "u5", "2026-09-01", "2026-09-01", "income", "a_rent", "Cara Diaz", "Payment", 120000],
      ["rent:u4", "roster_rent", "s1:u4", "p1", "u4", "2026-09-07", "2026-09-07", "income", "a_rent", "Ann Lee & Bob Ray", "Payment", 95087],
    ],
  );
  assert.equal(new Set(plan.rentRows.map((r) => r.sourceId)).size, plan.rentRows.length);
  assert.deepStrictEqual(B.finalizePlan(built, "s1"), plan, "same statement -> same plan");
  assert.equal(B.rentSourceId("s1", "u4"), "s1:u4");
  // the fee is computed on the rent too, and rent rows are not stamped entries
  assert.equal(plan.generatedRows[0].amountCents, percentOf(215087, 500));
  assert.deepStrictEqual(plan.entryIds, []);
});

test("after finalize: the September roster rows are 'already recorded' for September, and October prefills again", () => {
  const sep = B.assembleStatement(rentData());
  const plan = B.finalizePlan(sep, "s1");
  const written = plan.rentRows.map((r, i) =>
    entry(`L${i}`, r.date, r.unitId, r.accountId, r.counterparty, r.memo, r.amountCents, { source: "roster_rent", sourceId: r.sourceId, statementId: "s1", postedDate: r.postedDate }),
  );
  // A rebuilt September (retry) never doubles: both units are recorded.
  const again = B.assembleStatement(rentData({ property: { rentRecorded: written } }));
  assert.equal(again.lines.filter((l) => l.kind === "rent").length, 0);
  assert.equal(B.finalizePlan(again, "s1").rentRows.length, 0);
  // October: a new month, prefilled from the roster again.
  const oct = B.assembleStatement(
    rentData({
      statement: { _id: "s2", month: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      property: { prevFinalEndingCents: 0, hasAnyFinal: true, rentRecorded: [] },
      statementDate: "2026-11-05",
    }),
  );
  assert.deepStrictEqual(
    oct.lines.filter((l) => l.kind === "rent").map((l) => [l.key, l.date]),
    [["rent:u4", "2026-10-01"], ["rent:u5", "2026-10-01"]],
  );
  assert.equal(B.finalizePlan(oct, "s2").rentRows[0].sourceId, "s2:u4");
});

test("final statement: a billed roster_rent row maps back to its rent line (label 'Roster rent')", () => {
  const built = B.assembleStatement(rentData(), false);
  const snap = JSON.parse(JSON.stringify(B.makeSnapshot(OWNER, built.result, "2026-10-16")));
  const plan = B.finalizePlan(built, "s1");
  const billed = [...plan.rentRows, ...plan.generatedRows].map((r, i) => ({
    _id: `L${i}`,
    propertyId: r.propertyId,
    unitId: r.unitId,
    accountId: r.accountId,
    counterparty: r.counterparty,
    source: r.source,
    sourceId: r.sourceId,
  }));
  assert.equal(B.keyOfBilledRow(billed[0]), "rent:u4");
  const lines = B.linesFromSnapshot(snap, billed, {});
  const r = lines.find((l) => l.key === "rent:u4");
  assert.deepStrictEqual([r.kind, r.sourceLabel, r.unitId, r.counterparty, r.editable], ["rent", "Roster rent", "u4", "Ann Lee & Bob Ray", false]);
  assert.equal(B.entrySourceLabel("roster_rent"), "Roster rent");
});

// --- the confirmation --------------------------------------------------------------------------------

test("RENT_NOT_CHECKED blocks while unchecked; a matching confirmation clears it; any rent change brings it back", () => {
  const first = B.assembleStatement(rentData());
  assert.deepStrictEqual(warn(first, "RENT_NOT_CHECKED"), {
    code: "RENT_NOT_CHECKED",
    message: "Check the rent lines for September 2026 and confirm them before finalizing.",
    blocking: true,
  });
  assert.equal(first.rent.checked, false);
  assert.match(first.rent.hash, /^[0-9a-f]{16}$/);

  const confirmed = { rentCheckedAt: 1, rentCheckedHash: first.rent.hash };
  const ok = B.assembleStatement(rentData({ statement: confirmed }));
  assert.ok(!warn(ok, "RENT_NOT_CHECKED"));
  assert.equal(ok.rent.checked, true);
  assert.equal(ok.rent.hash, first.rent.hash);
  // a hash alone (no rentCheckedAt) is not a confirmation
  assert.ok(warn(B.assembleStatement(rentData({ statement: { rentCheckedHash: first.rent.hash } })), "RENT_NOT_CHECKED"));

  const changes = {
    "amount override": { statement: { ...confirmed, rentOverrides: [{ unitId: "u4", amountCents: 90000 }] } },
    "removed (didn't pay)": { statement: { ...confirmed, excludedKeys: ["rent:u4"] } },
    "Rent Income row added by hand": {
      statement: confirmed,
      property: { entries: [entry("m", "2026-09-20", null, "a_rent", "Laundry", "Payment", 1000)] },
    },
    "roster rent changed": { statement: confirmed, property: { units: [{ ...RENT_UNITS[0], rent: 975 }, RENT_UNITS[1]] } },
    "tenant changed": { statement: confirmed, property: { residents: RENT_RESIDENTS.filter((r) => r.fullName !== "Bob Ray") } },
  };
  for (const [what, over] of Object.entries(changes)) {
    const b = B.assembleStatement(rentData(over));
    assert.ok(warn(b, "RENT_NOT_CHECKED"), `${what} must need a new confirmation`);
    assert.notEqual(b.rent.hash, first.rent.hash, what);
  }
  // all rent lines removed: still a rent decision to confirm
  const allOff = B.assembleStatement(rentData({ statement: { excludedKeys: ["rent:u4", "rent:u5"] } }));
  assert.equal(allOff.rent.lineCount, 2);
  assert.ok(warn(allOff, "RENT_NOT_CHECKED"));
  // the warning is not part of the preview hash (confirming doesn't make the finalize dialog stale)
  assert.equal(B.resultHash(first.result), B.resultHash(ok.result));
});

test("missing Rent Income account: no prefill, an info warning", () => {
  const built = B.assembleStatement(rentData({ accounts: ACCOUNTS.filter((a) => a._id !== "a_rent") }));
  assert.equal(built.lines.filter((l) => l.kind === "rent").length, 0);
  assert.equal(warn(built, "RENT_ACCOUNT_MISSING").blocking, false);
});

// --- server wiring (source scan; the handlers need Convex to run) ------------------------------------

test("server: roster_rent source, finalize writes rent rows once, rent changes clear the confirmation", () => {
  assert.match(read("rosValidators.ts"), /v\.literal\("roster_rent"\)/);
  const os = read("ownerStatements.ts");
  assert.match(os, /\^\(entry\|wo\|rent\):/, "rent lines can be removed / put back");
  const fin = os.slice(os.indexOf("export const finalize"));
  assert.match(fin, /for \(const r of plan\.rentRows\)/);
  assert.match(fin, /withIndex\("by_source", \(q\) => q\.eq\("source", "roster_rent"\)\.eq\("sourceId", r\.sourceId\)\)/);
  assert.match(fin, /source: "roster_rent",\s*sourceId: r\.sourceId,\s*statementId: st\._id/);
  for (const fn of ["setRentLine", "confirmRent"]) assert.match(os, new RegExp(`export const ${fn} = mutation\\(`));
  const set = os.slice(os.indexOf("export const setRentLine"), os.indexOf("export const confirmRent"));
  assert.match(set, /clearRentCheck\(ctx, org, st,/);
  assert.match(set, /validateRentLineFields\(/);
  const toggle = os.slice(os.indexOf("async function toggleLine"), os.indexOf("const lineArgs"));
  assert.match(toggle, /clearRentCheck\(ctx, org, st,/);
  const confirm = os.slice(os.indexOf("export const confirmRent"), os.indexOf("export const finalize"));
  assert.match(confirm, /args\.expectedRentHash !== built\.rent\.hash/);
  assert.match(confirm, /action: "rent_checked"/);
  const ledger = read("ledger.ts");
  for (const fn of ["add", "update", "voidEntry"]) {
    const body = ledger.slice(ledger.indexOf(`export const ${fn} = mutation`));
    const end = body.indexOf("\nexport ", 10);
    assert.match(body.slice(0, end === -1 ? undefined : end), /clearRentCheckForProperty\(ctx, org,/, `ledger.${fn} must clear the rent confirmation`);
  }
});
