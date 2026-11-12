// Tests for convex/rosBuild.ts: the mapping from database rows to the statement engine, on the
// golden sample (ROS.pdf pages 3-7; spec 9.1), plus the draft rules around it (exclusions,
// carry-forward, blocking warnings, the finalize plan, the snapshot round trip, the preview hash).
// No packages. From dashboard/:
//   node --test scripts/probes/ros_build.test.mjs
// Spec: docs/specs/ros-build-spec.md 5.4. All rows are DB-shaped (`_id`, epoch-ms timestamps).
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
const B = await import("../../convex/rosBuild.ts");
const { buildView } = await import("../../convex/rosView.ts");
const { COMPANY_NAME, percentOf } = await import("../../convex/rosFormat.ts");

// --- DB-shaped fixture ---------------------------------------------------------------------------

const OWNER = { _id: "o1", legalName: "Nye Properties LLC", contactFirstName: "Adam", contactLastName: "Nye", managementFeeBps: 500 };
const ACCOUNTS = [
  { _id: "a_rent", name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true, active: true },
  { _id: "a_dump", name: "Dump Fees", kind: "expense", feeBase: false, active: true },
  { _id: "a_land", name: "Landscaping", kind: "expense", feeBase: false, active: true },
  { _id: "a_mgmt", name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false, active: true },
  { _id: "a_pest", name: "Pest Control", kind: "expense", feeBase: false, active: true },
  { _id: "a_pred", name: "Predicate Notice", kind: "expense", feeBase: false, active: true },
  { _id: "a_rep", name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false, active: true },
  { _id: "a_draw", name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false, active: true },
  { _id: "a_contrib", name: "Owner Contribution", kind: "owner_contribution", systemKey: "owner_contribution", feeBase: false, active: true },
];
const UNITS = [
  { _id: "u1", unitNumber: "1st Floor", securityDepositHeldCents: 80000 },
  { _id: "u2", unitNumber: "2nd Floor", securityDepositHeldCents: 80000 },
  { _id: "u3", unitNumber: "3rd Floor", securityDepositHeldCents: 80000 },
];
const W1_MEMO =
  "Unit 2 - Close up ceiling from previous leak repair, took down rest of damaged section, add new sheet rock, tape, mud, sanded, added 2 coats of prime, painted ceiling and walls";
const W3_MEMO =
  "Unit 3 - Ceiling tiles damaged from water, sprayed to keep from molding in areas that needed it, replaced ceiling tiles as needed";

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
// 12:00 New York time on the given September day (EDT = UTC-4).
const sept = (day) => Date.UTC(2026, 8, day, 16, 0, 0);
const wo = (id, number, day, unitId, accountId, amount, memo, extra = {}) => ({
  _id: id,
  number,
  propertyId: "p1",
  unitId,
  status: "reviewed_closed",
  completedAt: sept(day),
  closedAt: sept(day) + 3_600_000,
  createdAt: sept(day) - 86_400_000,
  billAmountCents: amount,
  rosAccountId: accountId,
  workCompletedDescription: `  ${memo}  `, // trimmed into the memo (A38)
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
const GOLDEN_WOS = [
  wo("w1", 2051, 12, "u2", "a_rep", 190700, W1_MEMO),
  wo("w2", 2052, 14, "u1", "a_pest", 28900, "Treatment of multiple bees' nest around the property", { billPropertyLevel: true }),
  wo("w3", 2053, 30, "u3", "a_rep", 26500, W3_MEMO),
];
// Rows that must NOT reach the statement.
const NOISE_ENTRIES = [
  entry("x_void", "2026-09-05", null, "a_land", COMPANY_NAME, "voided", 5000, { voided: true }),
  entry("x_other_owner", "2026-09-05", null, "a_land", COMPANY_NAME, "other owner", 5000, { ownerId: "o2" }),
  entry("x_billed", "2026-08-20", null, "a_land", COMPANY_NAME, "on August's final", 5000, { statementId: "s_aug" }),
  entry("x_october", "2026-10-02", null, "a_land", COMPANY_NAME, "next month", 5000),
];
const NOISE_WOS = [
  wo("x_wo_billed", 2040, 5, "u1", "a_rep", 9900, "billed already", { billedStatementId: "s_aug" }),
  wo("x_wo_nocharge", 2041, 6, "u1", "a_rep", 9900, "warranty", { noOwnerCharge: true }),
  wo("x_wo_awaiting", 2042, 20, "u1", undefined, undefined, "tech done", { status: "completed" }),
  wo("x_wo_before_start", 2039, 1, "u1", "a_rep", 9900, "before start", { completedAt: Date.UTC(2026, 7, 20, 16) }),
  wo("x_wo_after_end", 2043, 1, "u1", "a_rep", 9900, "October", { completedAt: Date.UTC(2026, 9, 3, 16) }),
];

function data(over = {}) {
  const statement = {
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
  };
  const property = {
    propertyId: "p1",
    property: { name: "108 Jackson Avenue" },
    links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, startMonth: "2026-09" }],
    linkOwnerNames: ["Nye Properties LLC"],
    prevFinalEndingCents: null,
    hasAnyFinal: false,
    units: UNITS,
    // shuffled on purpose: the engine sorts
    entries: [...NOISE_ENTRIES, ...GOLDEN_ENTRIES].reverse(),
    workOrders: [...GOLDEN_WOS, ...NOISE_WOS].reverse(),
    ...(over.property ?? {}),
  };
  return {
    statement,
    owner: over.owner ?? OWNER,
    accounts: over.accounts ?? ACCOUNTS,
    properties: [property],
    statementDate: over.statementDate ?? "2026-10-16",
  };
}

const rows = (vrows) => vrows.map((r) => [r.label, ...r.values]);
const detail = (lines) => lines.map((l) => [l.date, l.property, l.unit, l.account, l.name, l.memo, l.amount, l.balance].join(" | "));

// --- golden ----------------------------------------------------------------------------------------

test("DB rows map to the golden statement (summary, income statement, 13 detail lines)", () => {
  const built = B.assembleStatement(data());
  const view = buildView(built.result, { statementDate: "2026-10-16" });

  assert.deepStrictEqual(view.summary.columns, ["108 Jackson Avenue", "All properties"]);
  assert.deepStrictEqual(rows(view.summary.rows), [
    ["Beginning cash balance", "$0.00", "$0.00"],
    ["+ Additions to cash", "", ""],
    ["Income", "4,333.87", "4,333.87"],
    ["Owner contributions", "0.00", "0.00"],
    ["Other additions", "0.00", "0.00"],
    ["– Subtractions from cash", "", ""],
    ["Expenses", "3,676.55", "3,676.55"],
    ["Owner draws", "657.32", "657.32"],
    ["Other subtractions", "0.00", "0.00"],
    ["Ending cash balance", "$0.00", "$0.00"],
    ["– Adjustments", "", ""],
    ["Tenant security deposits and early payments", "2,400.00", "2,400.00"],
    ["Property reserve", "0.00", "0.00"],
    ["Unpaid bills", "0.00", "0.00"],
    ["Pending ePay payments", "0.00", "0.00"],
    ["Available for payment", "($2,400.00)", "($2,400.00)"],
  ]);
  assert.deepStrictEqual(rows(view.incomeStatement.rows), [
    ["Income", "", ""],
    ["Rent Income", "4,333.87", "4,333.87"],
    ["Total income", "$4,333.87", "$4,333.87"],
    ["Expense", "", ""],
    ["Dump Fees", "520.20", "520.20"],
    ["Landscaping", "210.00", "210.00"],
    ["Management Fees", "216.69", "216.69"],
    ["Pest Control", "289.00", "289.00"],
    ["Predicate Notice", "268.66", "268.66"],
    ["Repairs", "2,172.00", "2,172.00"],
    ["Total expenses", "$3,676.55", "$3,676.55"],
    ["Net income", "$657.32", "$657.32"],
  ]);

  const J = "108 Jackson Avenue";
  assert.deepStrictEqual(detail(view.detail.additions), [
    `9/1/2026 | ${J} | 1st Floor | Rent Income | Unit 1st Floor - David Roberts | Payment | 883.00 | 883.00`,
    `9/22/2026 | ${J} | 2nd Floor | Rent Income | Unit 2nd Floor - Sharavia Rivera | by Sharavia Rivera | 950.87 | 1,833.87`,
    `9/24/2026 | ${J} | 3rd Floor | Rent Income | Unit 3rd Floor - Adrianna Mimbs | by Adrianna Mimbs | 2,500.00 | 4,333.87`,
  ]);
  const P = COMPANY_NAME;
  assert.deepStrictEqual(detail(view.detail.subtractions), [
    `9/3/2026 | ${J} | Property level | Landscaping | ${P} | 9/3 - Lawn mowing and weed whacking | 100.00 | 4,233.87`,
    `9/11/2026 | ${J} | 2nd Floor | Predicate Notice | Unit 2nd Floor - ${P} | Bills | 134.33 | 4,099.54`,
    `9/11/2026 | ${J} | 3rd Floor | Predicate Notice | Unit 3rd Floor - ${P} | Bills | 134.33 | 3,965.21`,
    `9/12/2026 | ${J} | 2nd Floor | Repairs | Unit 2nd Floor - ${P} | ${W1_MEMO} | 1,907.00 | 2,058.21`,
    `9/14/2026 | ${J} | Property level | Pest Control | ${P} | Treatment of multiple bees' nest around the property | 289.00 | 1,769.21`,
    `9/16/2026 | ${J} | Property level | Dump Fees | ${P} | Dump Fees, driver, truck, fuel | 520.20 | 1,249.01`,
    `9/23/2026 | ${J} | Property level | Landscaping | ${P} | 9/23/26 - Lawn mowing and weed whacking | 110.00 | 1,139.01`,
    `9/30/2026 | ${J} | 3rd Floor | Repairs | Unit 3rd Floor - ${P} | ${W3_MEMO} | 265.00 | 874.01`,
    `9/30/2026 | ${J} | Property level | Management Fees | ${P} | Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87) | 216.69 | 657.32`,
    `9/30/2026 | ${J} | Property level | Owner Draw | Adam Nye | Owner Draw | 657.32 | 0.00`,
  ]);
  assert.equal(view.detail.additionsTotal.amount, "$4,333.87");
  assert.equal(view.detail.subtractionsTotal.amount, "$4,333.87");
  assert.deepStrictEqual(view.detail.ending, { label: "Ending cash balance as of 9/30/2026", balance: "$0.00" });

  const g = built.result.generated[0];
  assert.deepStrictEqual(
    { base: g.fee.baseCents, bps: g.fee.bps, computed: g.fee.computedCents, amount: g.fee.amountCents },
    { base: 433387, bps: 500, computed: 21669, amount: 21669 },
  );
  assert.deepStrictEqual({ s: g.draw.suggestedCents, a: g.draw.amountCents }, { s: 65732, a: 65732 });

  // The awaiting-review WO and the WO completed before the start month raise info warnings; nothing blocks.
  assert.deepStrictEqual(built.warnings.filter((w) => w.blocking), []);
  assert.deepStrictEqual(
    built.warnings.map((w) => w.code),
    ["WO_AWAITING_REVIEW", "WO_BEFORE_START"],
  );
  assert.equal(
    built.warnings[0].message,
    "WO-2042 (108 Jackson Avenue) was completed on 9/20/2026 but hasn't been closed by the office yet. It will go on a later statement once closed.",
  );
  assert.equal(built.payeeName, "Adam Nye");
});

test("LineViews: 13 lines in statement order, kinds, sources, ids, editability", () => {
  const built = B.assembleStatement(data());
  assert.equal(built.lines.length, 13);
  assert.deepStrictEqual(
    built.lines.map((l) => `${l.kind}:${l.side}:${l.sourceLabel}`),
    [
      "entry:addition:Manual",
      "entry:addition:Manual",
      "entry:addition:Manual",
      "entry:subtraction:Manual",
      "entry:subtraction:Manual",
      "entry:subtraction:Manual",
      "wo:subtraction:WO-2051",
      "wo:subtraction:WO-2052",
      "entry:subtraction:Manual",
      "entry:subtraction:Manual",
      "wo:subtraction:WO-2053",
      "fee:subtraction:Management fee (auto)",
      "draw:subtraction:Owner draw (suggested)",
    ],
  );
  assert.deepStrictEqual(
    built.lines.map((l) => l.key),
    ["entry:r1", "entry:r2", "entry:r3", "entry:e1", "entry:e2", "entry:e3", "wo:w1", "wo:w2", "entry:e4", "entry:e5", "wo:w3", "fee:p1", "draw:p1"],
  );
  assert.ok(built.lines.every((l) => l.editable));
  const w2 = built.lines.find((l) => l.key === "wo:w2");
  assert.deepStrictEqual(
    { unit: w2.unit, unitId: w2.unitId, pl: w2.billPropertyLevel, wo: w2.workOrderId, acc: w2.accountId, cp: w2.counterparty },
    { unit: "Property level", unitId: "u1", pl: true, wo: "w2", acc: "a_pest", cp: COMPANY_NAME },
  );
  const r1 = built.lines[0];
  assert.deepStrictEqual({ id: r1.entryId, unitId: r1.unitId, acc: r1.accountId, cp: r1.counterparty }, { id: "r1", unitId: "u1", acc: "a_rent", cp: "David Roberts" });
  const draw = built.lines.at(-1);
  assert.deepStrictEqual({ acc: draw.accountId, cp: draw.counterparty, amt: draw.amountCents }, { acc: "a_draw", cp: "Adam Nye", amt: 65732 });
  // Only the WO completed before the first statement month, excluded by default.
  assert.deepStrictEqual(built.excludedLines.map((l) => [l.key, l.defaultExcluded]), [["wo:x_wo_before_start", true]]);
  assert.deepStrictEqual(built.properties[0], {
    propertyId: "p1",
    name: "108 Jackson Avenue",
    securityDepositsCents: 240000,
    earlyPaymentsCents: 0,
    unpaidBillsCents: 0,
    propertyReserveCents: 0,
    propertyReserveDefaultCents: 0,
    feeSource: "default",
    fee: built.result.generated[0].fee,
    draw: built.result.generated[0].draw,
  });
});

test("final statement: not editable, no PERIOD_OPEN", () => {
  const built = B.assembleStatement(data({ statementDate: "2026-09-15" }), false);
  assert.ok(built.lines.every((l) => !l.editable));
  assert.ok(!built.warnings.some((w) => w.code === "PERIOD_OPEN"));
});

test("PERIOD_OPEN is an info warning on a draft whose month hasn't ended", () => {
  const built = B.assembleStatement(data({ statementDate: "2026-09-15" }));
  const w = built.warnings.find((x) => x.code === "PERIOD_OPEN");
  assert.deepStrictEqual(w, { code: "PERIOD_OPEN", message: "You can finalize September 2026 from 10/1/2026.", blocking: false });
});

// --- finalize plan, snapshot, preview hash -------------------------------------------------------

test("finalizePlan: WO rows at the effective date (property level when flagged), fee/draw with the deterministic sourceId, entries to stamp", () => {
  const built = B.assembleStatement(data());
  const plan = B.finalizePlan(built, "s1");
  assert.deepStrictEqual(
    plan.woRows.map((r) => [r.sourceId, r.date, r.unitId, r.accountId, r.type, r.amountCents, r.counterparty, r.woNumber]),
    [
      ["w1", "2026-09-12", "u2", "a_rep", "expense", 190700, COMPANY_NAME, 2051],
      ["w2", "2026-09-14", undefined, "a_pest", "expense", 28900, COMPANY_NAME, 2052],
      ["w3", "2026-09-30", "u3", "a_rep", "expense", 26500, COMPANY_NAME, 2053],
    ],
  );
  assert.equal(plan.woRows[0].memo, W1_MEMO);
  assert.deepStrictEqual(
    plan.generatedRows.map((r) => [r.source, r.sourceId, r.date, r.unitId, r.accountId, r.type, r.amountCents, r.counterparty]),
    [
      ["management_fee", "s1:p1", "2026-09-30", undefined, "a_mgmt", "expense", 21669, COMPANY_NAME],
      ["owner_draw", "s1:p1", "2026-09-30", undefined, "a_draw", "owner_draw", 65732, "Adam Nye"],
    ],
  );
  assert.equal(plan.generatedRows[0].memo, "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)");
  assert.deepStrictEqual(plan.entryIds, ["r1", "r2", "r3", "e1", "e2", "e3", "e4", "e5"]);
  assert.equal(B.generatedSourceId("s1", "p1"), "s1:p1");
});

test("snapshot round trip: a final's lines come from the snapshot + its billed ledger rows", () => {
  const built = B.assembleStatement(data(), false);
  const snap = JSON.parse(JSON.stringify(B.makeSnapshot(OWNER, built.result, "2026-10-16")));
  assert.deepStrictEqual(snap.header, {
    ownerLegalName: "Nye Properties LLC",
    footerName: "Adam Nye",
    payeeName: "Adam Nye",
    statementDate: "2026-10-16",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });
  const plan = B.finalizePlan(built, "s1");
  const billed = [
    ...plan.entryIds.map((id) => {
      const e = GOLDEN_ENTRIES.find((x) => x._id === id);
      return { _id: id, propertyId: "p1", unitId: e.unitId, accountId: e.accountId, counterparty: e.counterparty, source: "manual" };
    }),
    ...[...plan.woRows, ...plan.generatedRows].map((r, i) => ({
      _id: `L${i}`,
      propertyId: r.propertyId,
      unitId: r.unitId,
      accountId: r.accountId,
      counterparty: r.counterparty,
      source: r.source,
      sourceId: r.sourceId,
    })),
  ];
  const lines = B.linesFromSnapshot(snap, billed, { w1: 2051, w2: 2052, w3: 2053 });
  // Same line as the live build, except that a final's lines are never editable (and carry no
  // draft-only action hints such as onRentAccount: a Rent Income row is edited on the Payments page).
  const { onRentAccount, ...liveFirst } = built.lines[0];
  assert.equal(onRentAccount, true);
  assert.deepStrictEqual(lines[0], { ...liveFirst, editable: false });
  assert.deepStrictEqual(
    lines.map((l) => [l.key, l.sourceLabel, l.accountId, l.counterparty, l.editable]),
    built.lines.map((l) => [l.key, l.sourceLabel, l.accountId, l.counterparty, false]),
  );
  assert.equal(buildView(snap.result, snap.header).detail.ending.balance, "$0.00");
});

test("previewHash is stable for the same data and changes with any figure", () => {
  const a = B.resultHash(B.assembleStatement(data()).result);
  const b = B.resultHash(B.assembleStatement(data({ statementDate: "2026-11-02" })).result);
  assert.equal(a, b);
  const changed = data();
  changed.properties[0].entries = changed.properties[0].entries.map((e) => (e._id === "e4" ? { ...e, amountCents: 52021 } : e));
  assert.notEqual(B.resultHash(B.assembleStatement(changed).result), a);
  assert.match(a, /^[0-9a-f]{16}$/);
});

// --- exclusion and carry-forward -----------------------------------------------------------------

test("excluding a line affects only this statement; the row comes back next month, carried forward", () => {
  const sep = B.assembleStatement(data({ statement: { excludedKeys: ["entry:r1", "wo:w3"] } }));
  assert.deepStrictEqual(sep.excludedLines.map((l) => [l.key, l.date, l.editable, l.sourceLabel]), [
    ["entry:r1", "2026-09-01", true, "Manual"],
    ["wo:x_wo_before_start", "2026-09-01", true, "WO-2039"], // before the start month: excluded by default
    ["wo:w3", "2026-09-30", true, "WO-2053"],
  ]);
  assert.equal(sep.result.summary.income.total, 433387 - 88300);
  assert.equal(sep.result.generated[0].fee.computedCents, percentOf(433387 - 88300, 500));
  assert.ok(!sep.lines.some((l) => l.key === "entry:r1" || l.key === "wo:w3"));
  assert.equal(sep.result.summary.ending.total, 0); // the suggested draw absorbs the difference
  const plan = B.finalizePlan(sep, "s1");
  assert.ok(!plan.entryIds.includes("r1"));
  assert.ok(!plan.woRows.some((r) => r.sourceId === "w3"));

  // October: September is final (ending 0). w1/w2 are billed now; r1 and w3 are still unbilled.
  const billedIds = new Set(plan.woRows.map((r) => r.sourceId));
  const stampedIds = new Set(plan.entryIds);
  const oct = B.assembleStatement(
    data({
      statement: { _id: "s2", month: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      property: {
        prevFinalEndingCents: 0,
        hasAnyFinal: true,
        entries: GOLDEN_ENTRIES.map((e) => (stampedIds.has(e._id) ? { ...e, statementId: "s1" } : e)),
        workOrders: GOLDEN_WOS.map((w) => (billedIds.has(w._id) ? { ...w, billedStatementId: "s1" } : w)),
      },
      statementDate: "2026-11-05",
    }),
  );
  assert.deepStrictEqual(
    oct.lines.filter((l) => l.kind === "entry" || l.kind === "wo").map((l) => [l.key, l.date, l.storedDate, l.carriedForward]),
    [
      ["entry:r1", "2026-10-01", "2026-09-01", true],
      ["wo:w3", "2026-10-01", "2026-09-30", true],
    ],
  );
  assert.deepStrictEqual(oct.warnings.filter((w) => w.blocking), []);
});

// --- blocking warnings from the database ---------------------------------------------------------

test("PRIOR_NOT_FINAL when the property has finals but none for the previous month", () => {
  const built = B.assembleStatement(data({ property: { prevFinalEndingCents: null, hasAnyFinal: true } }));
  const w = built.warnings.find((x) => x.code === "PRIOR_NOT_FINAL");
  assert.equal(w.message, "108 Jackson Avenue has no final statement for August 2026. Finalize that month first.");
  assert.equal(w.blocking, true);
});

test("beginning = previous final's ending, else the opening balance (unset = 0 + info warning)", () => {
  assert.equal(B.assembleStatement(data({ property: { prevFinalEndingCents: 12345, hasAnyFinal: true } })).result.summary.beginning.total, 12345);
  const neg = B.assembleStatement(data({ property: { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: -5000 }] } }));
  assert.equal(neg.result.summary.beginning.total, -5000);
  const unset = B.assembleStatement(data({ property: { links: [{ _id: "l1", ownerId: "o1" }] } }));
  assert.equal(unset.result.summary.beginning.total, 0);
  assert.deepStrictEqual(
    unset.warnings.find((w) => w.code === "OPENING_BALANCE_NOT_SET"),
    { code: "OPENING_BALANCE_NOT_SET", propertyId: "p1", message: "The opening cash balance for 108 Jackson Avenue isn't set, so it starts at $0.00.", blocking: false },
  );
});

test("CO_OWNED and OWNER_CHANGED block", () => {
  const co = B.assembleStatement(
    data({
      property: {
        links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0 }, { _id: "l2", ownerId: "o2" }],
        linkOwnerNames: ["Nye Properties LLC", "Other LLC"],
      },
    }),
  );
  assert.equal(
    co.warnings[0].message,
    "108 Jackson Avenue is listed under 2 owners (Nye Properties LLC, Other LLC). Statements for it are paused until the ownership split is set.",
  );
  const moved = B.assembleStatement(data({ property: { links: [{ _id: "l2", ownerId: "o2" }], linkOwnerNames: ["Other LLC"] } }));
  assert.equal(moved.warnings[0].code, "OWNER_CHANGED");
  assert.equal(moved.warnings[0].message, "108 Jackson Avenue is no longer linked to Nye Properties LLC. Discard this draft and generate it again.");
});

test("WO_MISSING_BILL blocks; an account that isn't an expense account counts as missing", () => {
  const built = B.assembleStatement(
    data({
      property: {
        workOrders: [
          ...GOLDEN_WOS,
          wo("x1", 2060, 15, "u2", "a_rep", undefined, "no bill"),
          wo("x2", 2061, 16, "u1", "a_rent", 1000, "income account"),
        ],
      },
    }),
  );
  assert.deepStrictEqual(
    built.warnings.filter((w) => w.code === "WO_MISSING_BILL").map((w) => w.message),
    [
      "WO-2060 (108 Jackson Avenue, Unit 2nd Floor) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.",
      "WO-2061 (108 Jackson Avenue, Unit 1st Floor) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.",
    ],
  );
  assert.ok(!built.lines.some((l) => l.key === "wo:x1" || l.key === "wo:x2"));
});

test("ACCOUNTS_MISSING blocks without the engine throwing", () => {
  const built = B.assembleStatement(data({ accounts: ACCOUNTS.filter((a) => a.systemKey !== "owner_draw") }));
  assert.equal(built.warnings[0].code, "ACCOUNTS_MISSING");
  assert.equal(built.warnings[0].message, "The account list isn't set up yet. Open Accounts once to create it.");
  assert.ok(!built.lines.some((l) => l.kind === "fee" || l.kind === "draw"));
});

test("PAYEE_MISSING comes through from the engine; an owner without a fee no longer blocks (default 5.00%)", () => {
  const built = B.assembleStatement(data({ owner: { _id: "o1", legalName: "Two People LLC", contactFirstName: "Ann / Bob", contactLastName: "Lee" } }));
  assert.deepStrictEqual(
    built.warnings.filter((w) => w.blocking).map((w) => w.message),
    ["Set the owner draw payee for Two People LLC before finalizing."],
  );
  assert.ok(!built.warnings.some((w) => w.code === "FEE_NOT_SET"));
  assert.equal(built.result.generated[0].fee.bps, 500);
  assert.equal(built.result.generated[0].fee.amountCents, 21669);
});

test("overrides and adjustments flow into the engine; source labels say edited", () => {
  const built = B.assembleStatement(
    data({
      statement: {
        adjustments: [{ propertyId: "p1", earlyPaymentsCents: 1000, unpaidBillsCents: 2000, propertyReserveCents: 5000 }],
        overrides: [{ propertyId: "p1", feeAmountCents: 20000, drawAmountCents: 10000 }],
      },
      property: { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, propertyReserveCents: 7000 }] },
    }),
  );
  const g = built.result.generated[0];
  assert.deepStrictEqual([g.fee.amountCents, g.draw.amountCents], [20000, 10000]);
  assert.deepStrictEqual(built.lines.slice(-2).map((l) => l.sourceLabel), ["Management fee (edited)", "Owner draw (edited)"]);
  assert.deepStrictEqual(
    [built.properties[0].earlyPaymentsCents, built.properties[0].unpaidBillsCents, built.properties[0].propertyReserveCents, built.properties[0].propertyReserveDefaultCents],
    [1000, 2000, 5000, 7000],
  );
  // without a per-statement reserve, the owner-link default applies
  const dflt = B.assembleStatement(data({ property: { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, propertyReserveCents: 7000 }] } }));
  assert.equal(dflt.result.summary.propertyReserve.total, 7000);
  assert.equal(dflt.result.generated[0].draw.suggestedCents, 65732 - 7000);
});

test("woCompletedDate uses New York business time and falls back to close, then creation", () => {
  assert.equal(B.woCompletedDate({ completedAt: Date.UTC(2026, 9, 1, 3, 30), createdAt: 0 }), "2026-09-30");
  assert.equal(B.woCompletedDate({ closedAt: Date.UTC(2026, 8, 5, 16), createdAt: 0 }), "2026-09-05");
  assert.equal(B.woCompletedDate({ createdAt: Date.UTC(2026, 8, 6, 16) }), "2026-09-06");
});

// --- review fixes ----------------------------------------------------------------------------------

const J = "108 Jackson Avenue";
const blockingOf = (built) => built.warnings.filter((w) => w.blocking);

test("fix 1: after a sale the previous owner's ending is not carried; a non-zero one blocks until this owner's opening balance is set", () => {
  const sold = { prevFinalEndingCents: 450000, prevFinalOwnerId: "o_prev", prevFinalOwnerName: "Old Owner LLC", hasAnyFinal: true };
  const noOpening = B.assembleStatement(data({ property: { ...sold, links: [{ _id: "l1", ownerId: "o1" }] } }));
  assert.equal(noOpening.result.summary.beginning.total, 0);
  assert.deepStrictEqual(blockingOf(noOpening), [
    {
      code: "PREV_OWNER_BALANCE",
      propertyId: "p1",
      message: "Previous owner Old Owner LLC ended with $4,500.00 for 108 Jackson Avenue. Settle it on their statement or set this owner's opening balance.",
      blocking: true,
    },
  ]);
  const withOpening = B.assembleStatement(data({ property: { ...sold, links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 12300 }] } }));
  assert.equal(withOpening.result.summary.beginning.total, 12300);
  assert.deepStrictEqual(blockingOf(withOpening), []);
  // the previous owner ended at $0.00: nothing to settle, just the usual "not set" info
  const zero = B.assembleStatement(data({ property: { ...sold, prevFinalEndingCents: 0, links: [{ _id: "l1", ownerId: "o1" }] } }));
  assert.equal(zero.result.summary.beginning.total, 0);
  assert.deepStrictEqual(blockingOf(zero), []);
  assert.ok(zero.warnings.some((w) => w.code === "OPENING_BALANCE_NOT_SET" && !w.blocking));
  // same owner: carried as before (absent owner id = this owner, for older callers)
  const same = B.assembleStatement(data({ property: { ...sold, prevFinalOwnerId: "o1", links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 999 }] } }));
  assert.equal(same.result.summary.beginning.total, 450000);
  assert.ok(!same.warnings.some((w) => w.code === "PREV_OWNER_BALANCE"));
});

test("fix 2: a closed WO completed before the first statement month is shown excluded by default; one click includes it, carried forward", () => {
  const built = B.assembleStatement(data());
  const line = built.excludedLines.find((l) => l.key === "wo:x_wo_before_start");
  assert.deepStrictEqual(
    { d: line.defaultExcluded, note: line.note, stored: line.storedDate, date: line.date, cf: line.carriedForward, src: line.sourceLabel },
    {
      d: true,
      note: "Completed before this owner's first statement month — include it only if it wasn't billed in Buildium",
      stored: "2026-08-20",
      date: "2026-09-01",
      cf: true,
      src: "WO-2039",
    },
  );
  const w = built.warnings.find((x) => x.code === "WO_BEFORE_START");
  assert.deepStrictEqual(w, {
    code: "WO_BEFORE_START",
    propertyId: "p1",
    workOrderId: "x_wo_before_start",
    message:
      "WO-2039 (108 Jackson Avenue) was completed before this owner's first statement month (September 2026) and is left off this statement. Put it back from “Left off this statement” only if it wasn't billed in Buildium.",
    blocking: false,
  });
  // excluding it again (it is default-off) is a no-op on the keys; including it adds an includedKey only
  assert.deepStrictEqual(B.toggledKeys({ excludedKeys: [] }, "wo:x_wo_before_start", false, true), {
    excludedKeys: [],
    includedKeys: ["wo:x_wo_before_start"],
  });

  const inc = B.assembleStatement(data({ statement: { includedKeys: ["wo:x_wo_before_start"] } }));
  const l = inc.lines.find((x) => x.key === "wo:x_wo_before_start");
  assert.deepStrictEqual([l.date, l.storedDate, l.carriedForward, l.defaultExcluded], ["2026-09-01", "2026-08-20", true, true]);
  assert.ok(!inc.warnings.some((x) => x.code === "WO_BEFORE_START"));
  assert.equal(inc.result.summary.expenses.total, B.assembleStatement(data()).result.summary.expenses.total + 9900);
  // finalize: the ledger row keeps the completion date and is POSTED on the period's first day
  const row = B.finalizePlan(inc, "s1").woRows.find((r) => r.sourceId === "x_wo_before_start");
  assert.deepStrictEqual([row.date, row.postedDate], ["2026-08-20", "2026-09-01"]);
  // a normal line still uses excludedKeys
  assert.deepStrictEqual(B.toggledKeys({ excludedKeys: ["entry:a"], includedKeys: ["wo:b"] }, "entry:c", true, false), {
    excludedKeys: ["entry:a", "entry:c"],
    includedKeys: ["wo:b"],
  });
  assert.deepStrictEqual(B.toggledKeys({ excludedKeys: ["entry:a"], includedKeys: ["wo:b"] }, "wo:b", true, true), {
    excludedKeys: ["entry:a"],
    includedKeys: [],
  });
  assert.deepStrictEqual(B.toggledKeys({ excludedKeys: ["entry:a"] }, "entry:a", false, false), { excludedKeys: [], includedKeys: [] });
});

test("fix 2: a WO before the first month that is missing its bill is info only, never blocking", () => {
  const built = B.assembleStatement(
    data({
      property: {
        workOrders: [
          ...GOLDEN_WOS,
          wo("x_old1", 2030, 1, "u1", "a_rep", undefined, "old, no bill", { completedAt: Date.UTC(2026, 6, 10, 16) }),
          wo("x_old2", 2031, 1, "u1", undefined, 5000, "old, no account", { completedAt: Date.UTC(2026, 6, 11, 16) }),
        ],
      },
    }),
  );
  assert.deepStrictEqual(blockingOf(built), []);
  const w = built.warnings.find((x) => x.code === "WO_BEFORE_START_MISSING_BILL");
  assert.deepStrictEqual(w, {
    code: "WO_BEFORE_START_MISSING_BILL",
    propertyId: "p1",
    message:
      "WO-2030, WO-2031 (108 Jackson Avenue) were completed before this owner's first statement month (September 2026) and have no bill amount, account or description, so they aren't on this statement.",
    blocking: false,
  });
  assert.ok(!built.excludedLines.some((l) => l.key === "wo:x_old1" || l.key === "wo:x_old2"));
});

test("fix 2 (low): a manual row dated before the first statement month (no start month set) is excluded by default, not pulled in", () => {
  const early = entry("r_aug", "2026-08-15", "u1", "a_rent", "David Roberts", "August rent", 50000);
  const base = { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0 }], entries: [...GOLDEN_ENTRIES, early] };
  const built = B.assembleStatement(data({ property: base }));
  assert.ok(!built.lines.some((l) => l.key === "entry:r_aug"));
  assert.equal(built.result.summary.income.total, 433387);
  const off = built.excludedLines.find((l) => l.key === "entry:r_aug");
  assert.deepStrictEqual([off.defaultExcluded, off.note], [true, "Dated before this owner's first statement month — include it only if it wasn't billed in Buildium"]);
  const inc = B.assembleStatement(data({ statement: { includedKeys: ["entry:r_aug"] }, property: base }));
  const l = inc.lines.find((x) => x.key === "entry:r_aug");
  assert.deepStrictEqual([l.date, l.storedDate, l.carriedForward], ["2026-09-01", "2026-08-15", true]);
  const post = B.finalizePlan(inc, "s1").entryPosts.find((p) => p.entryId === "r_aug");
  assert.equal(post.postedDate, "2026-09-01");
  // a later month's draft (start month now set to September): an August row carried in is still included normally
  const oct = B.assembleStatement(
    data({
      statement: { _id: "s2", month: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      property: { prevFinalEndingCents: 0, hasAnyFinal: true, entries: [entry("r_sep", "2026-09-29", "u1", "a_rent", "D", "late", 100)], workOrders: [] },
      statementDate: "2026-11-05",
    }),
  );
  assert.deepStrictEqual(oct.lines.filter((x) => x.kind === "entry").map((x) => [x.key, x.carriedForward, x.defaultExcluded]), [["entry:r_sep", true, undefined]]);
});

test("fix 6: finalizePlan posts every billed row on its statement date (entries, WOs, fee, draw); in-period rows post on their own date", () => {
  const plan = B.finalizePlan(B.assembleStatement(data()), "s1");
  assert.deepStrictEqual(
    plan.entryPosts.map((p) => [p.entryId, p.postedDate]),
    GOLDEN_ENTRIES.map((e) => [e._id, e.date]).sort((a, b) => plan.entryIds.indexOf(a[0]) - plan.entryIds.indexOf(b[0])),
  );
  assert.ok(plan.woRows.every((r) => r.postedDate === r.date));
  assert.deepStrictEqual(plan.generatedRows.map((r) => [r.date, r.postedDate]), [["2026-09-30", "2026-09-30"], ["2026-09-30", "2026-09-30"]]);
});

test("fix 7: WO warnings carry the work order id, and splitWarnings passes it (and the property) through", () => {
  const built = B.assembleStatement(data({ property: { workOrders: [...GOLDEN_WOS, wo("x1", 2060, 15, "u2", "a_rep", undefined, "no bill")] } }));
  const missing = built.warnings.find((w) => w.code === "WO_MISSING_BILL");
  assert.equal(missing.workOrderId, "x1");
  const split = B.splitWarnings(built.warnings);
  assert.deepStrictEqual(split.blocking.find((w) => w.code === "WO_MISSING_BILL"), {
    code: "WO_MISSING_BILL",
    message: missing.message,
    propertyId: "p1",
    workOrderId: "x1",
  });
  const awaiting = B.assembleStatement(data()).warnings.find((w) => w.code === "WO_AWAITING_REVIEW");
  assert.equal(awaiting.workOrderId, "x_wo_awaiting");
  // a warning without a WO has no workOrderId key at all
  assert.deepStrictEqual(Object.keys(B.splitWarnings([{ code: "X", message: "m", blocking: false }]).info[0]), ["code", "message"]);
});

test("fix 8: DEPOSITS_NOT_SET needs at least one unit", () => {
  const none = B.assembleStatement(data({ property: { units: [] } }));
  assert.ok(!none.warnings.some((w) => w.code === "DEPOSITS_NOT_SET"));
  const unset = B.assembleStatement(data({ property: { units: [{ _id: "u1", unitNumber: "1" }] } }));
  assert.ok(unset.warnings.some((w) => w.code === "DEPOSITS_NOT_SET"));
});

test("fix 9: finalize is blocked when the statement month is before the link's first statement month", () => {
  const built = B.assembleStatement(data({ property: { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, startMonth: "2026-10" }] } }));
  assert.deepStrictEqual(blockingOf(built).map((w) => [w.code, w.message]), [
    ["START_MONTH_AFTER", `Statements for ${J} start in October 2026, after September 2026. Discard this draft, then check the first statement month.`],
  ]);
});

test("fix 11: the snapshot size guard counts UTF-8 bytes, not characters", () => {
  const dashes = "—".repeat(300_001); // 300,001 chars, 900,003 bytes
  assert.ok(dashes.length < B.SNAPSHOT_MAX_BYTES);
  assert.equal(B.snapshotTooLarge(dashes), true);
  assert.equal(B.snapshotTooLarge("x".repeat(899_999)), false);
  assert.equal(B.snapshotTooLarge("x".repeat(900_000)), true);
});

test("fix 3: the Finalize dialog sends the figures captured when it opened and refuses once the statement changed", async () => {
  const G = await import("../../components/finance/finalize-guard.ts");
  const live = { previewHash: "aaaa", result: { summary: { ending: { total: 100 }, available: { total: 40 } } } };
  const reviewed = G.captureReviewed(live);
  assert.deepStrictEqual(reviewed, { previewHash: "aaaa", expectedEndingCents: 100, expectedAvailableCents: 40 });
  // the live data moves on (another tab added a row): the dialog notices, and never sends the new figures
  const moved = { previewHash: "bbbb", result: { summary: { ending: { total: 250 }, available: { total: 190 } } } };
  assert.equal(G.reviewChanged(reviewed, live.previewHash), false);
  assert.equal(G.reviewChanged(reviewed, moved.previewHash), true);
  assert.deepStrictEqual(G.finalizeArgs("s1", reviewed), { statementId: "s1", expectedEndingCents: 100, expectedAvailableCents: 40, expectedHash: "aaaa" });
  assert.equal(G.STATEMENT_CHANGED, "The statement changed since you opened this. Review it again.");
});

// --- the DB loader on a fake database (fixes 1 and 5) ---------------------------------------------

function fakeDb(tables) {
  const reads = [];
  const all = () => Object.values(tables).flat();
  const db = {
    get: async (id) => all().find((r) => r._id === id) ?? null,
    query: (table) => {
      let rows = [...(tables[table] ?? [])];
      const api = {
        withIndex: (name, fn) => {
          const conds = [];
          const b = {
            eq: (f, v) => (conds.push((r) => r[f] === v), b),
            gte: (f, v) => (conds.push((r) => r[f] !== undefined && r[f] >= v), b),
            lte: (f, v) => (conds.push((r) => r[f] !== undefined && r[f] <= v), b),
          };
          if (fn) fn(b);
          rows = rows.filter((r) => conds.every((c) => c(r)));
          reads.push({ table, index: name, n: rows.length });
          return api;
        },
        filter: (fn) => {
          const q = { field: (f) => ({ f }), eq: (a, v) => (r) => r[a.f] === v };
          const pred = fn(q);
          rows = rows.filter(pred);
          return api;
        },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
      };
      return api;
    },
  };
  return { db, reads };
}

const dbWo = (id, number, status, extra = {}) => ({
  _id: id,
  orgId: "org1",
  number,
  propertyId: "p1",
  unitId: "u1",
  status,
  completedAt: sept(10),
  closedAt: sept(11),
  createdAt: sept(1),
  billAmountCents: 1000,
  rosAccountId: "a_rep",
  workCompletedDescription: "work",
  ...extra,
});

function fakeTables(over = {}) {
  return {
    owners: [
      { _id: "o1", orgId: "org1", legalName: "Nye Properties LLC", contactFirstName: "Adam", contactLastName: "Nye", managementFeeBps: 500 },
      { _id: "o_prev", orgId: "org1", legalName: "Old Owner LLC" },
    ],
    ledgerAccounts: ACCOUNTS.map((a) => ({ ...a, orgId: "org1" })),
    properties: [{ _id: "p1", orgId: "org1", name: J }],
    ownerProperties: [{ _id: "l1", orgId: "org1", ownerId: "o1", propertyId: "p1", startMonth: "2026-09" }],
    ownerStatementProperties: over.osp ?? [],
    units: UNITS.map((u) => ({ ...u, orgId: "org1", propertyId: "p1" })),
    ledgerEntries: [],
    workOrders: over.workOrders ?? [],
  };
}

const ST = {
  _id: "s1",
  orgId: "org1",
  ownerId: "o1",
  status: "draft",
  month: "2026-09",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  propertyIds: ["p1"],
  excludedKeys: [],
  adjustments: [],
  overrides: [],
};

test("fix 5: the loader reads pending WOs by rosPending, still finds closed WOs that predate the field, and skips settled ones", async () => {
  const { db, reads } = fakeDb(
    fakeTables({
      workOrders: [
        dbWo("w_pending", 3001, "reviewed_closed", { rosPending: true }),
        dbWo("w_legacy", 3002, "reviewed_closed"), // closed before rosPending existed (not backfilled)
        dbWo("w_legacy_nocharge", 3003, "reviewed_closed", { noOwnerCharge: true }),
        dbWo("w_billed", 3004, "reviewed_closed", { rosPending: false, billedStatementId: "s0" }),
        dbWo("w_settled_nocharge", 3005, "reviewed_closed", { rosPending: false, noOwnerCharge: true }),
        dbWo("w_open", 3006, "in_progress"),
        dbWo("w_done", 3007, "completed"),
        dbWo("w_missing", 3008, "reviewed_closed", { rosPending: true, billAmountCents: undefined }),
      ],
    }),
  );
  const built = await B.buildStatement({ db }, ST, { statementDate: "2026-10-05" });
  const read = new Set(built.data.properties[0].workOrders.map((w) => w._id));
  assert.deepStrictEqual([...read].sort(), ["w_done", "w_legacy", "w_legacy_nocharge", "w_missing", "w_pending"]);
  assert.deepStrictEqual(built.lines.filter((l) => l.kind === "wo").map((l) => l.key).sort(), ["wo:w_legacy", "wo:w_pending"]);
  assert.deepStrictEqual(built.warnings.filter((w) => w.code === "WO_MISSING_BILL").map((w) => w.workOrderId), ["w_missing"]);
  assert.deepStrictEqual(built.warnings.filter((w) => w.code === "WO_AWAITING_REVIEW").map((w) => w.workOrderId), ["w_done"]);
  // never the old "every reviewed_closed WO of the property" read
  const woReads = reads.filter((r) => r.table === "workOrders");
  assert.deepStrictEqual(woReads.map((r) => r.index), ["by_property_and_rosPending", "by_property_and_rosPending", "by_property_and_status"]);
  assert.ok(!woReads.some((r) => r.index === "by_property_and_status" && r.n > 1));
});

test("fix 1: the loader passes the previous final's owner, so a sale is detected from the database rows", async () => {
  const osp = [{ _id: "x1", orgId: "org1", statementId: "s0", ownerId: "o_prev", propertyId: "p1", month: "2026-08", status: "final", endingCashCents: 450000 }];
  const { db } = fakeDb(fakeTables({ osp }));
  const built = await B.buildStatement({ db }, ST, { statementDate: "2026-10-05" });
  assert.equal(built.data.properties[0].prevFinalOwnerId, "o_prev");
  assert.equal(built.result.summary.beginning.total, 0);
  assert.deepStrictEqual(blockingOf(built).map((w) => w.code), ["PREV_OWNER_BALANCE"]);
  // the same owner's previous final carries as before
  const { db: db2 } = fakeDb(fakeTables({ osp: [{ ...osp[0], ownerId: "o1" }] }));
  const same = await B.buildStatement({ db: db2 }, ST, { statementDate: "2026-10-05" });
  assert.equal(same.result.summary.beginning.total, 450000);
  assert.deepStrictEqual(blockingOf(same), []);
});
