// Golden test: the engine + view must reproduce the sample Rental Owner Statement in ROS.pdf pages 3-7
// (transcribed in docs/context/work-order-receipt-and-owner-statement-samples.md) string for string.
// No packages. From dashboard/:
//   node --test scripts/probes/ros_golden.test.mjs
// Spec: docs/specs/ros-build-spec.md 9.1.
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
const { computeStatement, effectivePayee, footerName } = await import("../../convex/rosCalc.ts");
const { buildView, footerLeft, pageLabel } = await import("../../convex/rosView.ts");
const { COMPANY_NAME } = await import("../../convex/rosFormat.ts");

// --- fixture -----------------------------------------------------------------------------------

const OWNER = { legalName: "Nye Properties LLC", contactFirstName: "Adam", contactLastName: "Nye", payeeName: null };

// The seed list (spec 3.4), with ids.
const ACCOUNTS = [
  { id: "a_rent", name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true },
  { id: "a_dump", name: "Dump Fees", kind: "expense", feeBase: false },
  { id: "a_land", name: "Landscaping", kind: "expense", feeBase: false },
  { id: "a_mgmt", name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false },
  { id: "a_pest", name: "Pest Control", kind: "expense", feeBase: false },
  { id: "a_pred", name: "Predicate Notice", kind: "expense", feeBase: false },
  { id: "a_rep", name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false },
  { id: "a_draw", name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false },
  { id: "a_contrib", name: "Owner Contribution", kind: "owner_contribution", systemKey: "owner_contribution", feeBase: false },
];

const UNIT_DEPOSITS = { "1st Floor": 80000, "2nd Floor": 80000, "3rd Floor": 80000 }; // A15: sums to $2,400.00

const W1_MEMO =
  "Unit 2 - Close up ceiling from previous leak repair, took down rest of damaged section, add new sheet rock, tape, mud, sanded, added 2 coats of prime, painted ceiling and walls";
const W3_MEMO =
  "Unit 3 - Ceiling tiles damaged from water, sprayed to keep from molding in areas that needed it, replaced ceiling tiles as needed";

// [key, date, unit, accountId, counterparty, memo, cents, source] in spec 9.1 table order.
const TABLE = [
  ["entry:r1", "2026-09-01", "1st Floor", "a_rent", "David Roberts", "Payment", 88300, "manual"],
  ["entry:r2", "2026-09-22", "2nd Floor", "a_rent", "Sharavia Rivera", "by Sharavia Rivera", 95087, "manual"],
  ["entry:r3", "2026-09-24", "3rd Floor", "a_rent", "Adrianna Mimbs", "by Adrianna Mimbs", 250000, "manual"],
  ["entry:e1", "2026-09-03", null, "a_land", COMPANY_NAME, "9/3 - Lawn mowing and weed whacking", 10000, "manual"],
  ["entry:e2", "2026-09-11", "2nd Floor", "a_pred", COMPANY_NAME, "Bills", 13433, "manual"],
  ["entry:e3", "2026-09-11", "3rd Floor", "a_pred", COMPANY_NAME, "Bills", 13433, "manual"],
  ["wo:w1", "2026-09-12", "2nd Floor", "a_rep", COMPANY_NAME, W1_MEMO, 190700, "work_order"],
  ["wo:w2", "2026-09-14", null, "a_pest", COMPANY_NAME, "Treatment of multiple bees' nest around the property", 28900, "work_order"], // billPropertyLevel
  ["entry:e4", "2026-09-16", null, "a_dump", COMPANY_NAME, "Dump Fees, driver, truck, fuel", 52020, "manual"],
  ["entry:e5", "2026-09-23", null, "a_land", COMPANY_NAME, "9/23/26 - Lawn mowing and weed whacking", 11000, "manual"],
  ["wo:w3", "2026-09-30", "3rd Floor", "a_rep", COMPANY_NAME, W3_MEMO, 26500, "work_order"],
];
const ROWS = TABLE.map(([key, date, unitLabel, accountId, counterparty, memo, amountCents, source], i) => ({
  key,
  propertyId: "p1",
  unitLabel,
  date,
  accountId,
  counterparty,
  memo,
  amountCents,
  source,
  seq: i + 1,
}));

// Deterministic shuffles (mulberry32), so a failure is reproducible.
function shuffled(arr, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function input(rows) {
  return {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    owner: { legalName: OWNER.legalName, payeeName: effectivePayee(OWNER), managementFeeBps: 500 },
    companyName: COMPANY_NAME,
    properties: [
      {
        id: "p1",
        name: "108 Jackson Avenue",
        beginningCashCents: 0,
        securityDepositsCents: Object.values(UNIT_DEPOSITS).reduce((s, c) => s + c, 0),
        earlyPaymentsCents: 0,
        propertyReserveCents: 0,
        unpaidBillsCents: 0,
        pendingEpayCents: 0,
        fee: { amountOverrideCents: null, memoOverride: null, excluded: false },
        draw: { amountOverrideCents: null, excluded: false },
      },
    ],
    accounts: shuffled(ACCOUNTS, 7),
    rows,
  };
}

const STATEMENT_DATE = "2026-10-16";
const shuffledRows = shuffled(ROWS, 20261016);
assert.notDeepEqual(
  shuffledRows.map((r) => r.key),
  ROWS.map((r) => r.key),
  "the fixture rows really are shuffled",
);
const result = computeStatement(input(shuffledRows));
const view = buildView(result, { statementDate: STATEMENT_DATE });

const P = "108 Jackson Avenue";
const line = (s) => {
  const [date, property, unit, account, name, memo, amount, balance] = s.split(" | ");
  return { date, property, unit, account, name, memo, amount, balance };
};

// --- assertions --------------------------------------------------------------------------------

test("owner derived names", () => {
  assert.equal(effectivePayee(OWNER), "Adam Nye");
  assert.equal(footerName(OWNER), "Adam Nye");
});

test("header, footer and page label", () => {
  assert.deepStrictEqual(view.header, {
    title: "Rental Owner Statement",
    periodLabel: "Statement period",
    period: "9/1/2026 - 9/30/2026",
    dateLabel: "Statement date",
    date: "10/16/2026",
    preparedBy: ["Prepared By: Property Pro Realty Group Inc.", "60 Broad Street", "Waterford, NY 12188"],
  });
  assert.equal(footerLeft("Adam Nye", Date.UTC(2026, 9, 16, 13, 26, 36)), "Adam Nye - Generated 10/16/2026 09:26:36");
  assert.equal(pageLabel(1), "Page 1");
});

test("summary by property", () => {
  assert.equal(view.summary.title, "Summary by property");
  assert.deepStrictEqual(view.summary.columns, [P, "All properties"]);
  const r = (kind, label, v) => ({ kind, label, values: [v, v] });
  assert.deepStrictEqual(view.summary.rows, [
    r("total", "Beginning cash balance", "$0.00"),
    r("section", "+ Additions to cash", ""),
    r("row", "Income", "4,333.87"),
    r("row", "Owner contributions", "0.00"),
    r("row", "Other additions", "0.00"),
    r("section", "– Subtractions from cash", ""),
    r("row", "Expenses", "3,676.55"),
    r("row", "Owner draws", "657.32"),
    r("row", "Other subtractions", "0.00"),
    r("total", "Ending cash balance", "$0.00"),
    r("section", "– Adjustments", ""),
    r("row", "Tenant security deposits and early payments", "2,400.00"),
    r("row", "Property reserve", "0.00"),
    r("row", "Unpaid bills", "0.00"),
    r("row", "Pending ePay payments", "0.00"),
    r("grand", "Available for payment", "($2,400.00)"),
  ]);
});

test("income statement", () => {
  assert.equal(view.incomeStatement.title, "Income statement");
  assert.deepStrictEqual(view.incomeStatement.columns, [P, "All properties"]);
  const r = (kind, label, v) => ({ kind, label, values: [v, v] });
  assert.deepStrictEqual(view.incomeStatement.rows, [
    r("section", "Income", ""),
    r("row", "Rent Income", "4,333.87"),
    r("total", "Total income", "$4,333.87"),
    r("section", "Expense", ""),
    r("row", "Dump Fees", "520.20"),
    r("row", "Landscaping", "210.00"),
    r("row", "Management Fees", "216.69"),
    r("row", "Pest Control", "289.00"),
    r("row", "Predicate Notice", "268.66"),
    r("row", "Repairs", "2,172.00"),
    r("total", "Total expenses", "$3,676.55"),
    r("grand", "Net income", "$657.32"),
  ]);
  const labels = view.incomeStatement.rows.map((x) => x.label);
  assert.ok(!labels.includes("Owner Draw"));
  assert.ok(!labels.includes("Owner Contribution"));
});

test("detail transactions", () => {
  const d = view.detail;
  assert.equal(d.title, "Detail transactions");
  assert.deepStrictEqual(d.columns, ["Date", "Property", "Unit", "Account", "Name", "Memo", "Amount", "Balance"]);
  assert.deepStrictEqual(d.beginning, { label: "Beginning cash balance as of 9/1/2026", balance: "$0.00" });
  assert.equal(d.additionsTitle, "Additions to cash");
  assert.deepStrictEqual(d.additions, [
    line(`9/1/2026 | ${P} | 1st Floor | Rent Income | Unit 1st Floor - David Roberts | Payment | 883.00 | 883.00`),
    line(`9/22/2026 | ${P} | 2nd Floor | Rent Income | Unit 2nd Floor - Sharavia Rivera | by Sharavia Rivera | 950.87 | 1,833.87`),
    line(`9/24/2026 | ${P} | 3rd Floor | Rent Income | Unit 3rd Floor - Adrianna Mimbs | by Adrianna Mimbs | 2,500.00 | 4,333.87`),
  ]);
  assert.deepStrictEqual(d.additionsTotal, { label: "Total from additions to cash", amount: "$4,333.87" });
  assert.equal(d.subtractionsTitle, "Subtractions from cash");
  assert.deepStrictEqual(d.subtractions, [
    line(`9/3/2026 | ${P} | Property level | Landscaping | Property Pro Realty Group Inc. | 9/3 - Lawn mowing and weed whacking | 100.00 | 4,233.87`),
    line(`9/11/2026 | ${P} | 2nd Floor | Predicate Notice | Unit 2nd Floor - Property Pro Realty Group Inc. | Bills | 134.33 | 4,099.54`),
    line(`9/11/2026 | ${P} | 3rd Floor | Predicate Notice | Unit 3rd Floor - Property Pro Realty Group Inc. | Bills | 134.33 | 3,965.21`),
    line(`9/12/2026 | ${P} | 2nd Floor | Repairs | Unit 2nd Floor - Property Pro Realty Group Inc. | ${W1_MEMO} | 1,907.00 | 2,058.21`),
    line(`9/14/2026 | ${P} | Property level | Pest Control | Property Pro Realty Group Inc. | Treatment of multiple bees' nest around the property | 289.00 | 1,769.21`),
    line(`9/16/2026 | ${P} | Property level | Dump Fees | Property Pro Realty Group Inc. | Dump Fees, driver, truck, fuel | 520.20 | 1,249.01`),
    line(`9/23/2026 | ${P} | Property level | Landscaping | Property Pro Realty Group Inc. | 9/23/26 - Lawn mowing and weed whacking | 110.00 | 1,139.01`),
    line(`9/30/2026 | ${P} | 3rd Floor | Repairs | Unit 3rd Floor - Property Pro Realty Group Inc. | ${W3_MEMO} | 265.00 | 874.01`),
    line(`9/30/2026 | ${P} | Property level | Management Fees | Property Pro Realty Group Inc. | Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87) | 216.69 | 657.32`),
    line(`9/30/2026 | ${P} | Property level | Owner Draw | Adam Nye | Owner Draw | 657.32 | 0.00`),
  ]);
  assert.deepStrictEqual(d.subtractionsTotal, { label: "Total from subtractions from cash", amount: "$4,333.87" });
  assert.deepStrictEqual(d.ending, { label: "Ending cash balance as of 9/30/2026", balance: "$0.00" });
});

test("generated fee and draw, warnings", () => {
  assert.equal(result.generated.length, 1);
  assert.deepStrictEqual(result.generated[0], {
    propertyId: "p1",
    fee: {
      baseCents: 433387,
      bps: 500,
      computedCents: 21669,
      amountCents: 21669,
      memo: "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)",
      overridden: false,
      excluded: false,
    },
    draw: { suggestedCents: 65732, amountCents: 65732, overridden: false, excluded: false },
  });
  assert.deepStrictEqual(
    result.warnings.filter((w) => w.blocking),
    [],
  );
  assert.deepStrictEqual(result.warnings, []);
});

test("raw numbers and line metadata", () => {
  assert.equal(result.summary.ending.total, 0);
  assert.equal(result.summary.available.total, -240000);
  assert.equal(result.detail.endingCents, 0);
  assert.equal(result.detail.totalAdditionsCents, 433387);
  assert.equal(result.detail.totalSubtractionsCents, 433387);
  assert.deepStrictEqual(
    result.detail.subtractions.map((l) => [l.key, l.source, l.type, l.carriedForward]),
    [
      ["entry:e1", "manual", "expense", false],
      ["entry:e2", "manual", "expense", false],
      ["entry:e3", "manual", "expense", false],
      ["wo:w1", "work_order", "expense", false],
      ["wo:w2", "work_order", "expense", false],
      ["entry:e4", "manual", "expense", false],
      ["entry:e5", "manual", "expense", false],
      ["wo:w3", "work_order", "expense", false],
      ["fee:p1", "management_fee", "expense", false],
      ["draw:p1", "owner_draw", "owner_draw", false],
    ],
  );
});

test("output is the same for every input order", () => {
  for (const seed of [1, 2, 3, 42, 999, 123456]) {
    const other = computeStatement(input(shuffled(ROWS, seed)));
    assert.deepStrictEqual(other, result, `seed ${seed}`);
  }
  assert.deepStrictEqual(computeStatement(input([...ROWS].reverse())), result);
});

test("the snapshot survives a JSON round trip unchanged", () => {
  const snapshot = {
    version: 1,
    header: {
      ownerLegalName: OWNER.legalName,
      footerName: footerName(OWNER),
      payeeName: effectivePayee(OWNER),
      statementDate: STATEMENT_DATE,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    },
    result,
  };
  const back = JSON.parse(JSON.stringify(snapshot));
  assert.deepStrictEqual(back, snapshot);
  assert.deepStrictEqual(buildView(back.result, back.header), view);
});
