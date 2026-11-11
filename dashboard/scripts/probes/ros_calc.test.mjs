// Unit tests for convex/rosCalc.ts + convex/rosView.ts (the ROS statement engine). No packages.
// From dashboard/:
//   node --test scripts/probes/ros_calc.test.mjs
// Spec: docs/specs/ros-build-spec.md 4.2, 4.3 and 9.2. All names and numbers are invented.
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
const C = await import("../../convex/rosCalc.ts");
const { buildView } = await import("../../convex/rosView.ts");
const { COMPANY_NAME } = await import("../../convex/rosFormat.ts");

const ACCOUNTS = [
  { id: "a_rent", name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true },
  { id: "a_laundry", name: "Laundry Income", kind: "income", feeBase: false },
  { id: "a_land", name: "Landscaping", kind: "expense", feeBase: false },
  { id: "a_mgmt", name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false },
  { id: "a_rep", name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false },
  { id: "a_draw", name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false },
  { id: "a_contrib", name: "Owner Contribution", kind: "owner_contribution", systemKey: "owner_contribution", feeBase: false },
  { id: "a_oadd", name: "Insurance Refund", kind: "other_addition", feeBase: false },
  { id: "a_osub", name: "Escrow Transfer", kind: "other_subtraction", feeBase: false },
];

function prop(id, name, o = {}) {
  return {
    id,
    name,
    beginningCashCents: 0,
    securityDepositsCents: 0,
    earlyPaymentsCents: 0,
    propertyReserveCents: 0,
    unpaidBillsCents: 0,
    pendingEpayCents: 0,
    fee: { amountOverrideCents: null, memoOverride: null, excluded: false, ...(o.fee ?? {}) },
    draw: { amountOverrideCents: null, excluded: false, ...(o.draw ?? {}) },
    ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== "fee" && k !== "draw")),
  };
}

let seqN = 0;
function row(key, propertyId, date, accountId, amountCents, o = {}) {
  seqN += 1;
  return {
    key,
    propertyId,
    unitLabel: null,
    date,
    accountId,
    counterparty: COMPANY_NAME,
    memo: "memo",
    amountCents,
    source: "manual",
    seq: seqN,
    ...o,
  };
}

function input(properties, rows, o = {}) {
  return {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    owner: { legalName: "Test Owner LLC", payeeName: "Pat Payee", managementFeeBps: 500, ...(o.owner ?? {}) },
    companyName: COMPANY_NAME,
    properties,
    accounts: ACCOUNTS,
    rows,
  };
}

const codes = (r) => r.warnings.map((w) => w.code);
const keysOf = (lines) => lines.map((l) => l.key);

// --- ordering -----------------------------------------------------------------------------------

test("ordering: a manual owner-draw row on the last day sorts after the fee", () => {
  const r = C.computeStatement(
    input(
      [prop("p1", "1 Main St")],
      [
        row("entry:rent", "p1", "2026-09-01", "a_rent", 100000),
        row("entry:middraw", "p1", "2026-09-30", "a_draw", 10000, { counterparty: "Pat Payee", memo: "Owner Draw" }),
        row("entry:rep", "p1", "2026-09-30", "a_rep", 5000),
      ],
    ),
  );
  // rep (ordinary) -> fee -> the ledger draw and the generated draw (both rank 2; seq decides)
  assert.deepStrictEqual(keysOf(r.detail.subtractions), ["entry:rep", "fee:p1", "entry:middraw", "draw:p1"]);
  // the mid-month draw reduces the suggested draw
  assert.equal(r.generated[0].draw.suggestedCents, 100000 - 5000 - 5000 - 10000);
  assert.equal(r.summary.ending.total, 0);
});

test("ordering: same date follows column order, Property level before units, natural unit order", () => {
  const r = C.computeStatement(
    input(
      [prop("pB", "12 B St"), prop("pA", "9 A St")].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
      [
        row("entry:b10", "pB", "2026-09-05", "a_rep", 100, { unitLabel: "10" }),
        row("entry:b2", "pB", "2026-09-05", "a_rep", 100, { unitLabel: "2" }),
        row("entry:bP", "pB", "2026-09-05", "a_rep", 100),
        row("entry:a2", "pA", "2026-09-05", "a_rep", 100, { unitLabel: "2" }),
        row("entry:aLand", "pA", "2026-09-05", "a_land", 100, { unitLabel: "2" }),
        row("entry:rent", "pA", "2026-09-01", "a_rent", 100000),
        row("entry:rentB", "pB", "2026-09-01", "a_rent", 100000),
      ],
      { owner: { managementFeeBps: 0 } },
    ),
  );
  assert.deepStrictEqual(r.columns.map((c) => c.name), ["9 A St", "12 B St"]);
  assert.deepStrictEqual(keysOf(r.detail.additions), ["entry:rent", "entry:rentB"]);
  assert.deepStrictEqual(keysOf(r.detail.subtractions), [
    "entry:aLand", // 9 A St, unit 2, Landscaping < Repairs
    "entry:a2",
    "entry:bP", // 12 B St, Property level first
    "entry:b2", // "2" before "10" (natural)
    "entry:b10",
    "draw:pA",
    "draw:pB",
  ]);
});

test("ordering: additions are never interleaved with subtractions; balance runs additions then subtractions", () => {
  const r = C.computeStatement(
    input(
      [prop("p1", "1 Main St", { beginningCashCents: 1000 })],
      [
        row("entry:rep", "p1", "2026-09-02", "a_rep", 300),
        row("entry:rent2", "p1", "2026-09-20", "a_rent", 2000),
        row("entry:rent1", "p1", "2026-09-01", "a_rent", 500),
        row("entry:contrib", "p1", "2026-09-10", "a_contrib", 700),
      ],
      { owner: { managementFeeBps: 1000 } },
    ),
  );
  assert.deepStrictEqual(r.detail.additions.map((l) => [l.key, l.balanceCents]), [
    ["entry:rent1", 1500],
    ["entry:contrib", 2200],
    ["entry:rent2", 4200],
  ]);
  // fee = 10% of 2500 = 250
  assert.deepStrictEqual(r.detail.subtractions.map((l) => [l.key, l.balanceCents]), [
    ["entry:rep", 3900],
    ["fee:p1", 3650],
    ["draw:p1", 0],
  ]);
  assert.ok(r.detail.additions.every((l) => ["income", "owner_contribution", "other_addition"].includes(l.type)));
  assert.ok(r.detail.subtractions.every((l) => ["expense", "owner_draw", "other_subtraction"].includes(l.type)));
});

// --- multi-property -----------------------------------------------------------------------------

test("multi-property: columns, totals, per-property fee and draw, one date-sorted detail list", () => {
  const props = [prop("p12", "12 B St"), prop("p108", "108 Jackson Avenue"), prop("p9", "9 A St", { beginningCashCents: 5000 })];
  const sorted = [...props].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
  const r = C.computeStatement(
    input(sorted, [
      row("entry:r9", "p9", "2026-09-03", "a_rent", 120000, { unitLabel: "1", counterparty: "Tenant Nine" }),
      row("entry:r12", "p12", "2026-09-01", "a_rent", 99999, { unitLabel: "A", counterparty: "Tenant Twelve" }),
      row("entry:r108", "p108", "2026-09-02", "a_rent", 50001, { unitLabel: "2nd Floor", counterparty: "Tenant 108" }),
      row("entry:l108", "p108", "2026-09-15", "a_land", 7500),
      row("entry:rep9", "p9", "2026-09-15", "a_rep", 2500),
      row("entry:oadd12", "p12", "2026-09-20", "a_oadd", 1000),
      row("entry:osub12", "p12", "2026-09-21", "a_osub", 400),
    ]),
  );
  const view = buildView(r, { statementDate: "2026-10-05" });
  assert.deepStrictEqual(view.summary.columns, ["9 A St", "12 B St", "108 Jackson Avenue", "All properties"]);
  assert.deepStrictEqual(r.columns.map((c) => c.propertyId), ["p9", "p12", "p108"]);

  // every summary row total = the sum of its columns
  for (const [name, c] of Object.entries(r.summary)) {
    assert.equal(c.byProperty.length, 3, name);
    assert.equal(c.total, c.byProperty.reduce((s, v) => s + v, 0), name);
  }
  for (const g of [r.incomeStatement.income, r.incomeStatement.expense]) {
    for (const a of g.accounts) assert.equal(a.values.total, a.values.byProperty.reduce((s, v) => s + v, 0));
  }

  // fee per property, rounded once per property row: 5% of 120000 = 6000; of 99999 = 4999.95 -> 5000; of 50001 = 2500.05 -> 2500
  assert.deepStrictEqual(r.generated.map((g) => [g.propertyId, g.fee.baseCents, g.fee.computedCents]), [
    ["p9", 120000, 6000],
    ["p12", 99999, 5000],
    ["p108", 50001, 2500],
  ]);
  // draws: cash before draw per property
  assert.deepStrictEqual(r.generated.map((g) => g.draw.suggestedCents), [
    5000 + 120000 - 2500 - 6000, // 116500
    99999 + 1000 - 400 - 5000, // 95599
    50001 - 7500 - 2500, // 40001
  ]);
  assert.deepStrictEqual(r.summary.ending.byProperty, [0, 0, 0]);

  // an income-statement account with activity in only one property shows 0.00 elsewhere
  const landscaping = view.incomeStatement.rows.find((x) => x.label === "Landscaping");
  assert.deepStrictEqual(landscaping.values, ["0.00", "0.00", "75.00", "75.00"]);
  const repairs = view.incomeStatement.rows.find((x) => x.label === "Repairs");
  assert.deepStrictEqual(repairs.values, ["25.00", "0.00", "0.00", "25.00"]);
  // other additions/subtractions are not on the income statement
  assert.ok(!view.incomeStatement.rows.some((x) => x.label === "Insurance Refund" || x.label === "Escrow Transfer"));
  const otherAdd = view.summary.rows.find((x) => x.label === "Other additions");
  assert.deepStrictEqual(otherAdd.values, ["0.00", "10.00", "0.00", "10.00"]);
  const otherSub = view.summary.rows.find((x) => x.label === "Other subtractions");
  assert.deepStrictEqual(otherSub.values, ["0.00", "4.00", "0.00", "4.00"]);
  const beginningRow = view.summary.rows[0];
  assert.deepStrictEqual(beginningRow.values, ["$50.00", "$0.00", "$0.00", "$50.00"]);

  // detail: one list sorted by date across properties
  assert.deepStrictEqual(keysOf(r.detail.additions), ["entry:r12", "entry:r108", "entry:r9", "entry:oadd12"]);
  assert.deepStrictEqual(keysOf(r.detail.subtractions), [
    "entry:rep9", // 9/15: 9 A St before 108 Jackson Avenue (column order)
    "entry:l108",
    "entry:osub12",
    "fee:p9",
    "fee:p12",
    "fee:p108",
    "draw:p9",
    "draw:p12",
    "draw:p108",
  ]);
  assert.equal(r.detail.beginningCents, 5000);
  assert.equal(r.detail.endingCents, r.summary.ending.total);
  assert.equal(view.detail.additions[0].name, "Unit A - Tenant Twelve");
  assert.equal(view.detail.additions[0].property, "12 B St");
});

// --- beginning balance and carry-forward ------------------------------------------------------------

test("carry-forward beginning with no rows; negative beginning shows in brackets", () => {
  const r = C.computeStatement(input([prop("p1", "1 Main St", { beginningCashCents: 12345, securityDepositsCents: 2000 })], []));
  assert.equal(r.summary.ending.total, 12345 - 12345); // the suggested draw takes it out
  const noDraw = C.computeStatement(
    input([prop("p1", "1 Main St", { beginningCashCents: 12345, securityDepositsCents: 2000, draw: { excluded: true } })], []),
  );
  assert.equal(noDraw.summary.ending.total, 12345);
  assert.equal(noDraw.summary.available.total, 12345 - 2000);
  let v = buildView(noDraw, { statementDate: "2026-10-01" });
  assert.deepStrictEqual(v.detail.beginning, { label: "Beginning cash balance as of 9/1/2026", balance: "$123.45" });
  assert.deepStrictEqual(v.detail.ending, { label: "Ending cash balance as of 9/30/2026", balance: "$123.45" });
  assert.deepStrictEqual(v.detail.additions, []);
  assert.deepStrictEqual(v.detail.subtractions, []);
  assert.deepStrictEqual(v.detail.additionsTotal, { label: "Total from additions to cash", amount: "$0.00" });

  const neg = C.computeStatement(input([prop("p1", "1 Main St", { beginningCashCents: -5000 })], []));
  v = buildView(neg, { statementDate: "2026-10-01" });
  assert.equal(v.detail.beginning.balance, "($50.00)");
  assert.deepStrictEqual(v.summary.rows[0].values, ["($50.00)", "($50.00)"]);
  assert.deepStrictEqual(v.summary.rows.find((x) => x.label === "Ending cash balance").values, ["($50.00)", "($50.00)"]);
  assert.deepStrictEqual(v.summary.rows.find((x) => x.label === "Available for payment").values, ["($50.00)", "($50.00)"]);
  assert.equal(neg.generated[0].draw.suggestedCents, 0);
  assert.deepStrictEqual(codes(neg), ["NO_DRAW", "NEGATIVE_ENDING"]);
  assert.equal(neg.warnings[0].message, "No owner draw is suggested for 1 Main St: cash after expenses is ($50.00).");
  assert.equal(neg.warnings[1].message, "The ending cash balance for 1 Main St is negative (($50.00)).");
});

test("carried-forward rows show periodStart, sort first, and count in the fee base", () => {
  const r = C.computeStatement(
    input(
      [prop("p1", "1 Main St")],
      [
        row("entry:sep", "p1", "2026-09-01", "a_rent", 50000, { seq: 1 }),
        row("entry:aug", "p1", "2026-08-28", "a_rent", 100000, { seq: 999 }),
        row("wo:old", "p1", "2026-07-15", "a_rep", 2000, { source: "work_order" }),
      ],
    ),
  );
  const first = r.detail.additions[0];
  assert.equal(first.key, "entry:aug");
  assert.equal(first.date, "2026-09-01");
  assert.equal(first.storedDate, "2026-08-28");
  assert.equal(first.carriedForward, true);
  assert.equal(r.detail.additions[1].carriedForward, false);
  assert.equal(r.generated[0].fee.baseCents, 150000);
  assert.equal(r.generated[0].fee.computedCents, 7500);
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.equal(v.detail.additions[0].date, "9/1/2026");
  assert.equal(v.detail.subtractions[0].date, "9/1/2026");
  assert.equal(r.detail.subtractions[0].carriedForward, true);
  // the standard fee memo prints the base including the carried-forward rent
  assert.equal(r.generated[0].fee.memo, "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $1,500.00)");
});

// --- owner draw ------------------------------------------------------------------------------------

test("draw suggestion subtracts reserve and unpaid bills, not deposits or early payments", () => {
  const p = prop("p1", "1 Main St", {
    propertyReserveCents: 50000,
    unpaidBillsCents: 10000,
    securityDepositsCents: 80000,
    earlyPaymentsCents: 3000,
  });
  const r = C.computeStatement(input([p], [row("entry:rent", "p1", "2026-09-01", "a_rent", 200000)], { owner: { managementFeeBps: 0 } }));
  assert.equal(r.generated[0].draw.suggestedCents, 200000 - 60000);
  assert.equal(r.summary.ending.total, 60000);
  assert.equal(r.summary.depositsAndEarlyPayments.total, 83000);
  assert.equal(r.summary.available.total, 60000 - 83000 - 50000 - 10000);
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.deepStrictEqual(v.summary.rows.at(-1), { kind: "grand", label: "Available for payment", values: ["($830.00)", "($830.00)"] });
  // a zero fee (0 bps) gives no fee row and no Management Fees line
  assert.ok(!r.detail.subtractions.some((l) => l.source === "management_fee"));
  assert.ok(!v.incomeStatement.rows.some((x) => x.label === "Management Fees"));
});

test("negative cash before draw: no draw row, NO_DRAW, NEGATIVE_ENDING, available in brackets", () => {
  const r = C.computeStatement(
    input([prop("p1", "1 Main St")], [row("entry:rent", "p1", "2026-09-01", "a_rent", 10000), row("entry:rep", "p1", "2026-09-05", "a_rep", 30000)]),
  );
  // fee 5% of 10000 = 500; cash = 10000 - 30000 - 500 = -20500
  assert.equal(r.generated[0].draw.suggestedCents, 0);
  assert.equal(r.generated[0].draw.amountCents, 0);
  assert.ok(!r.detail.subtractions.some((l) => l.key === "draw:p1"));
  assert.deepStrictEqual(r.warnings, [
    { code: "NO_DRAW", propertyId: "p1", message: "No owner draw is suggested for 1 Main St: cash after expenses is ($205.00).", blocking: false },
    { code: "NEGATIVE_ENDING", propertyId: "p1", message: "The ending cash balance for 1 Main St is negative (($205.00)).", blocking: false },
  ]);
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.deepStrictEqual(v.summary.rows.at(-1).values, ["($205.00)", "($205.00)"]);
  assert.equal(v.detail.ending.balance, "($205.00)");
  assert.equal(v.detail.subtractions.at(-1).balance, "(205.00)");
});

test("draw override is used; excluded gives no row; NO_DRAW only when suggested 0 and not overridden/excluded", () => {
  const rows = [row("entry:rent", "p1", "2026-09-01", "a_rent", 100000)];
  const over = C.computeStatement(input([prop("p1", "1 Main St", { draw: { amountOverrideCents: 30000 } })], rows, { owner: { managementFeeBps: 0 } }));
  const drawLine = over.detail.subtractions.find((l) => l.key === "draw:p1");
  assert.equal(drawLine.amountCents, 30000);
  assert.equal(drawLine.name, "Pat Payee");
  assert.equal(drawLine.memo, "Owner Draw");
  assert.equal(drawLine.unit, "Property level");
  assert.equal(drawLine.date, "2026-09-30");
  assert.deepStrictEqual(over.generated[0].draw, { suggestedCents: 100000, amountCents: 30000, overridden: true, excluded: false });
  assert.equal(over.summary.ending.total, 70000);

  const excl = C.computeStatement(input([prop("p1", "1 Main St", { draw: { excluded: true, amountOverrideCents: 30000 } })], rows, { owner: { managementFeeBps: 0 } }));
  assert.ok(!excl.detail.subtractions.some((l) => l.key === "draw:p1"));
  assert.deepStrictEqual(excl.generated[0].draw, { suggestedCents: 100000, amountCents: 0, overridden: true, excluded: true });
  assert.equal(excl.summary.ending.total, 100000);
  assert.deepStrictEqual(codes(excl), []);

  const zeroOverride = C.computeStatement(input([prop("p1", "1 Main St", { draw: { amountOverrideCents: 0 } })], rows, { owner: { managementFeeBps: 0 } }));
  assert.ok(!zeroOverride.detail.subtractions.some((l) => l.key === "draw:p1"));

  // nothing to draw and nothing overridden -> NO_DRAW only
  const empty = C.computeStatement(input([prop("p1", "1 Main St")], []));
  assert.deepStrictEqual(codes(empty), ["NO_DRAW"]);
  assert.equal(empty.warnings[0].message, "No owner draw is suggested for 1 Main St: cash after expenses is $0.00.");
});

test("PAYEE_MISSING: blocking only when a draw is produced, once per statement", () => {
  const rows = [row("entry:r1", "p1", "2026-09-01", "a_rent", 100000), row("entry:r2", "p2", "2026-09-01", "a_rent", 100000)];
  const r = C.computeStatement(input([prop("p1", "1 Main St"), prop("p2", "2 Main St")], rows, { owner: { payeeName: null } }));
  assert.deepStrictEqual(r.warnings.filter((w) => w.blocking), [
    { code: "PAYEE_MISSING", message: "Set the owner draw payee for Test Owner LLC before finalizing.", blocking: true },
  ]);
  assert.equal(r.detail.subtractions.find((l) => l.key === "draw:p1").name, "");
  const blank = C.computeStatement(input([prop("p1", "1 Main St")], [rows[0]], { owner: { payeeName: "   " } }));
  assert.deepStrictEqual(codes(blank), ["PAYEE_MISSING"]);
  const skipped = C.computeStatement(input([prop("p1", "1 Main St", { draw: { excluded: true } })], [rows[0]], { owner: { payeeName: null } }));
  assert.deepStrictEqual(codes(skipped), []);
});

// --- management fee --------------------------------------------------------------------------------

test("fee not set: FEE_NOT_SET blocking (once) and no fee row", () => {
  const rows = [row("entry:r1", "p1", "2026-09-01", "a_rent", 100000), row("entry:r2", "p2", "2026-09-01", "a_rent", 100000)];
  const r = C.computeStatement(input([prop("p1", "1 Main St"), prop("p2", "2 Main St")], rows, { owner: { managementFeeBps: null } }));
  assert.deepStrictEqual(r.warnings.filter((w) => w.blocking), [
    { code: "FEE_NOT_SET", message: "Set the management fee % for Test Owner LLC before finalizing.", blocking: true },
  ]);
  assert.ok(!r.detail.subtractions.some((l) => l.source === "management_fee"));
  assert.deepStrictEqual(r.generated[0].fee, {
    baseCents: 100000,
    bps: null,
    computedCents: 0,
    amountCents: 0,
    memo: "",
    overridden: false,
    excluded: false,
  });
});

test("fee override replaces the amount and keeps the standard memo; memo override replaces the memo", () => {
  const rows = [row("entry:r1", "p1", "2026-09-01", "a_rent", 433387)];
  const r = C.computeStatement(input([prop("p1", "1 Main St", { fee: { amountOverrideCents: 20000 } })], rows));
  const fee = r.detail.subtractions.find((l) => l.key === "fee:p1");
  assert.equal(fee.amountCents, 20000);
  assert.equal(fee.memo, "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)");
  assert.equal(fee.name, COMPANY_NAME);
  assert.equal(fee.accountName, "Management Fees");
  assert.equal(fee.unit, "Property level");
  assert.deepStrictEqual(
    { computed: r.generated[0].fee.computedCents, amount: r.generated[0].fee.amountCents, overridden: r.generated[0].fee.overridden },
    { computed: 21669, amount: 20000, overridden: true },
  );
  assert.equal(r.generated[0].draw.suggestedCents, 433387 - 20000);

  const m = C.computeStatement(input([prop("p1", "1 Main St", { fee: { memoOverride: "Management Fee (reduced, per agreement)" } })], rows));
  const feeM = m.detail.subtractions.find((l) => l.key === "fee:p1");
  assert.equal(feeM.amountCents, 21669);
  assert.equal(feeM.memo, "Management Fee (reduced, per agreement)");
  assert.equal(m.generated[0].fee.overridden, true);
});

test("fee excluded gives no row", () => {
  const rows = [row("entry:r1", "p1", "2026-09-01", "a_rent", 100000)];
  const r = C.computeStatement(input([prop("p1", "1 Main St", { fee: { excluded: true, amountOverrideCents: 999 } })], rows));
  assert.ok(!r.detail.subtractions.some((l) => l.key === "fee:p1"));
  assert.equal(r.generated[0].fee.amountCents, 0);
  assert.equal(r.generated[0].fee.computedCents, 5000);
  assert.equal(r.generated[0].fee.excluded, true);
  assert.equal(r.generated[0].draw.suggestedCents, 100000);
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.ok(!v.incomeStatement.rows.some((x) => x.label === "Management Fees"));
});

test("only feeBase accounts count toward the fee base", () => {
  const rows = [row("entry:rent", "p1", "2026-09-01", "a_rent", 100000), row("entry:laundry", "p1", "2026-09-02", "a_laundry", 40000)];
  const r = C.computeStatement(input([prop("p1", "1 Main St")], rows));
  assert.equal(r.generated[0].fee.baseCents, 100000);
  assert.equal(r.generated[0].fee.computedCents, 5000);
  assert.equal(r.summary.income.total, 140000);
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.deepStrictEqual(
    v.incomeStatement.rows.slice(0, 4).map((x) => [x.kind, x.label, x.values[1]]),
    [
      ["section", "Income", ""],
      ["row", "Laundry Income", "400.00"],
      ["row", "Rent Income", "1,000.00"],
      ["total", "Total income", "$1,400.00"],
    ],
  );
});

test("fee rounding happens once per property row, half up", () => {
  // two rent rows of 1010 each: per-row 5% = 50.5 -> 51 each = 102 if rounded per row; once = 5% of 2020 = 101
  const rows = [row("entry:a", "p1", "2026-09-01", "a_rent", 1010), row("entry:b", "p1", "2026-09-02", "a_rent", 1010)];
  const r = C.computeStatement(input([prop("p1", "1 Main St")], rows));
  assert.equal(r.generated[0].fee.computedCents, 101);
  // exactly half rounds up: 5% of 10 = 0.5 -> 1
  const h = C.computeStatement(input([prop("p1", "1 Main St")], [row("entry:c", "p1", "2026-09-01", "a_rent", 10)]));
  assert.equal(h.generated[0].fee.computedCents, 1);
});

// --- income statement --------------------------------------------------------------------------------

test("zero-activity accounts are hidden; empty Income section and Total income $0.00 still show", () => {
  const r = C.computeStatement(input([prop("p1", "1 Main St", { beginningCashCents: 50000 })], [row("entry:rep", "p1", "2026-09-04", "a_rep", 12000)]));
  const v = buildView(r, { statementDate: "2026-10-01" });
  assert.deepStrictEqual(v.incomeStatement.rows, [
    { kind: "section", label: "Income", values: ["", ""] },
    { kind: "total", label: "Total income", values: ["$0.00", "$0.00"] },
    { kind: "section", label: "Expense", values: ["", ""] },
    { kind: "row", label: "Repairs", values: ["120.00", "120.00"] },
    { kind: "total", label: "Total expenses", values: ["$120.00", "$120.00"] },
    { kind: "grand", label: "Net income", values: ["($120.00)", "($120.00)"] },
  ]);
});

// --- names --------------------------------------------------------------------------------------

test("effectivePayee, footerName, displayName, feeMemo", () => {
  assert.equal(C.effectivePayee({ payeeName: "  Jane Roe ", contactFirstName: "A", contactLastName: "B" }), "Jane Roe");
  assert.equal(C.effectivePayee({ contactFirstName: "Adam", contactLastName: "Nye" }), "Adam Nye");
  assert.equal(C.effectivePayee({ contactFirstName: "Adam", contactLastName: null }), "Adam");
  assert.equal(C.effectivePayee({ contactFirstName: "Ann / Bob", contactLastName: "Smith" }), null);
  assert.equal(C.effectivePayee({ contactFirstName: "Ann and Bob", contactLastName: "Smith" }), null);
  assert.equal(C.effectivePayee({ contactFirstName: "Ann", contactLastName: "Smith & Jones" }), null);
  assert.equal(C.effectivePayee({ payeeName: "Ann Smith", contactFirstName: "Ann / Bob" }), "Ann Smith");
  assert.equal(C.effectivePayee({}), null);
  assert.equal(C.effectivePayee({ payeeName: "  " }), null);
  assert.equal(C.footerName({ contactFirstName: "Adam", contactLastName: "Nye", legalName: "Nye Properties LLC" }), "Adam Nye");
  assert.equal(C.footerName({ legalName: "Nye Properties LLC" }), "Nye Properties LLC");
  assert.equal(C.displayName("2nd Floor", "David Roberts"), "Unit 2nd Floor - David Roberts");
  assert.equal(C.displayName(null, "Property Pro Realty Group Inc."), "Property Pro Realty Group Inc.");
  assert.equal(C.feeMemo("2026-09-01", "2026-09-30", 500, 433387), "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)");
  assert.equal(C.feeMemo("2026-02-01", "2026-02-28", 1250, 0), "Management Fee 2/1/2026 - 2/28/2026 (12.50% of $0.00)");
});

// --- invariants ----------------------------------------------------------------------------------

test("inconsistent input throws", () => {
  const ok = () => input([prop("p1", "1 Main St")], [row("entry:x", "p1", "2026-09-01", "a_rent", 100)]);
  C.computeStatement(ok());
  const bad = (mut) => {
    const i = ok();
    mut(i);
    return () => C.computeStatement(i);
  };
  assert.throws(bad((i) => (i.rows[0].amountCents = 0)), /bad amount/);
  assert.throws(bad((i) => (i.rows[0].amountCents = 10.5)), /bad amount/);
  assert.throws(bad((i) => (i.rows[0].amountCents = -100)), /bad amount/);
  assert.throws(bad((i) => (i.rows[0].amountCents = 100000001)), /bad amount/);
  assert.throws(bad((i) => (i.rows[0].date = "2026-10-01")), /after the period end/);
  assert.throws(bad((i) => (i.rows[0].date = "2026-09-31")), /bad date/);
  assert.throws(bad((i) => (i.rows[0].accountId = "nope")), /unknown account/);
  assert.throws(bad((i) => (i.rows[0].propertyId = "nope")), /unknown property/);
  assert.throws(bad((i) => i.rows.push({ ...i.rows[0] })), /duplicate row key/);
  assert.throws(bad((i) => (i.properties[0].fee.amountOverrideCents = -1)), /fee override/);
  assert.throws(bad((i) => (i.properties[0].draw.amountOverrideCents = 1.5)), /draw override/);
  assert.throws(bad((i) => (i.properties[0].beginningCashCents = 0.5)));
  assert.throws(bad((i) => (i.properties[0].propertyReserveCents = -1)), /propertyReserveCents/);
  assert.throws(bad((i) => (i.owner.managementFeeBps = 10001)), /managementFeeBps/);
  assert.throws(bad((i) => (i.owner.managementFeeBps = 2.5)), /managementFeeBps/);
  assert.throws(bad((i) => (i.periodStart = "2026-10-01")), /after periodEnd/);
  assert.throws(bad((i) => (i.accounts = i.accounts.filter((a) => a.systemKey !== "management_fees"))), /management_fees/);
  assert.throws(bad((i) => (i.accounts = i.accounts.filter((a) => a.systemKey !== "owner_draw"))), /owner_draw/);
});

test("ending invariant throws on mismatch", () => {
  C.assertEndingInvariant(0, 0);
  C.assertEndingInvariant(-500, -500);
  assert.throws(() => C.assertEndingInvariant(1, 0), /does not match/);
  assert.throws(() => C.assertEndingInvariant(0, -1), /does not match/);
});

test("deterministic: same input, same output; input arrays are not mutated", () => {
  const rows = [row("entry:b", "p1", "2026-09-02", "a_rent", 100), row("entry:a", "p1", "2026-09-01", "a_rent", 100)];
  const i = input([prop("p1", "1 Main St")], rows);
  const before = JSON.stringify(i);
  const a = C.computeStatement(i);
  assert.equal(JSON.stringify(i), before);
  assert.deepStrictEqual(C.computeStatement(i), a);
});

// --- review fix 10: a fee / draw over the $1,000,000.00 cap blocks instead of throwing ------------

test("AMOUNT_TOO_LARGE: a huge fee blocks, the row is capped, the statement still builds and renders", () => {
  // 101 rent rows of $990,000.00 = $99,990,000.00 base; 5% = $4,999,500.00 fee (over the cap).
  const rows = Array.from({ length: 101 }, (_, i) => row(`entry:big${i}`, "p1", "2026-09-10", "a_rent", 99_000_000));
  const r = C.computeStatement(input([prop("p1", "1 Main St")], rows));
  const w = r.warnings.find((x) => x.code === "AMOUNT_TOO_LARGE");
  assert.deepStrictEqual(w, {
    code: "AMOUNT_TOO_LARGE",
    propertyId: "p1",
    message: "Management fee for 1 Main St is over $1,000,000.00. Check the transactions.",
    blocking: true,
  });
  assert.equal(r.generated[0].fee.computedCents, 499_950_000);
  assert.equal(r.generated[0].fee.amountCents, 100_000_000);
  const feeLine = r.detail.subtractions.find((l) => l.key === "fee:p1");
  assert.equal(feeLine.amountCents, 100_000_000);
  // the draw is capped too (cash after the capped fee is far above $1M)
  const drawW = r.warnings.filter((x) => x.code === "AMOUNT_TOO_LARGE").map((x) => x.message);
  assert.deepStrictEqual(drawW, [
    "Management fee for 1 Main St is over $1,000,000.00. Check the transactions.",
    "Owner draw for 1 Main St is over $1,000,000.00. Check the transactions.",
  ]);
  assert.equal(r.generated[0].draw.amountCents, 100_000_000);
  assert.equal(r.detail.endingCents, r.summary.ending.total);
  assert.ok(r.warnings.findIndex((x) => x.blocking) === 0, "blocking warnings first");
  // the view (get / pdfData) renders without throwing
  assert.doesNotThrow(() => buildView(r, { statementDate: "2026-10-05" }));
});

test("AMOUNT_TOO_LARGE: a huge suggested draw alone blocks with the draw wording; at the cap it is fine", () => {
  const big = C.computeStatement(input([prop("p1", "1 Main St", { beginningCashCents: 250_000_000 })], [], { owner: { managementFeeBps: 0 } }));
  assert.deepStrictEqual(
    big.warnings.filter((w) => w.blocking).map((w) => w.message),
    ["Owner draw for 1 Main St is over $1,000,000.00. Check the transactions."],
  );
  assert.equal(big.generated[0].draw.suggestedCents, 250_000_000);
  assert.equal(big.generated[0].draw.amountCents, 100_000_000);
  assert.equal(big.summary.ending.total, 150_000_000);
  const atCap = C.computeStatement(input([prop("p1", "1 Main St", { beginningCashCents: 100_000_000 })], [], { owner: { managementFeeBps: 0 } }));
  assert.ok(!atCap.warnings.some((w) => w.code === "AMOUNT_TOO_LARGE"));
  assert.equal(atCap.generated[0].draw.amountCents, 100_000_000);
});
