// Management fee per property (user decision 2026-11-11): org default 5.00%, an optional own fee
// per property (on the owner-property link), "Change fee for all properties" with a counts guard.
// No packages. From dashboard/:
//   node --test scripts/probes/ros_fee.test.mjs
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
const P = await import("../../convex/rosPolicy.ts");
const C = await import("../../convex/rosCalc.ts");
const B = await import("../../convex/rosBuild.ts");
const L = await import("../../convex/feeSettingsLib.ts");
const { buildView } = await import("../../convex/rosView.ts");
const { COMPANY_NAME, percentOf } = await import("../../convex/rosFormat.ts");

// --- effective fee resolution ------------------------------------------------------------------------

test("readFeeInput: blank = use the default; 0..100.00 with at most 2 decimals; exact messages", () => {
  for (const b of [undefined, null, "", "   "]) assert.deepStrictEqual(P.readFeeInput(b), { ok: true, bps: null });
  const ok = (raw, bps) => assert.deepStrictEqual(P.readFeeInput(raw), { ok: true, bps }, String(raw));
  ok("5", 500);
  ok("5.0", 500);
  ok("5.00", 500);
  ok(" 6.25% ", 625);
  ok("0", 0);
  ok("0.01", 1);
  ok("100", 10000);
  ok("100.00%", 10000);
  ok(0, 0);
  ok(10000, 10000);
  ok(600, 600);
  const unparseable = "Enter the management fee as a percentage like 5.00.";
  const range = "The management fee must be between 0.00% and 100.00%.";
  for (const bad of ["abc", "5.123", "-5", "5%%", "1,5", "5 .0"]) {
    assert.deepStrictEqual(P.readFeeInput(bad), { ok: false, message: unparseable }, bad);
  }
  for (const bad of ["100.01", "150", 10001, -1, 2.5, NaN]) {
    assert.deepStrictEqual(P.readFeeInput(bad), { ok: false, message: range }, String(bad));
  }
});

test("effectiveFee: own fee overrides the default; absent/invalid falls back; default absent = 5.00%", () => {
  assert.equal(P.DEFAULT_FEE_BPS, 500);
  assert.deepStrictEqual(P.effectiveFee(600, 500), { bps: 600, own: true });
  assert.deepStrictEqual(P.effectiveFee(0, 500), { bps: 0, own: true }); // 0% is a real own fee
  assert.deepStrictEqual(P.effectiveFee(undefined, 450), { bps: 450, own: false });
  assert.deepStrictEqual(P.effectiveFee(null, 450), { bps: 450, own: false });
  assert.deepStrictEqual(P.effectiveFee(undefined, undefined), { bps: 500, own: false });
  assert.deepStrictEqual(P.effectiveFee(10001, 450), { bps: 450, own: false });
  assert.deepStrictEqual(P.effectiveFee(2.5, undefined), { bps: 500, own: false });
  assert.equal(P.orgDefaultFeeBps(undefined), 500);
  assert.equal(P.orgDefaultFeeBps(-1), 500);
  assert.equal(P.orgDefaultFeeBps(0), 0);
  assert.equal(P.orgDefaultFeeBps(10000), 10000);
});

test("feeRangeLabel: one fee, a range, none", () => {
  assert.equal(P.feeRangeLabel([500, 500]), "5.00%");
  assert.equal(P.feeRangeLabel([600, 500, 525]), "5.00–6.00%");
  assert.equal(P.feeRangeLabel([]), null);
});

test("Change fee for all properties: the alert wording", () => {
  assert.equal(
    P.defaultFeeConfirmText(500, 600, { totalProperties: 147, ownFeeCount: 3 }),
    "Change the management fee from 5.00% to 6.00% for all 147 properties? 3 properties have their own fee and won't change.",
  );
  assert.equal(
    P.defaultFeeConfirmText(500, 450, { totalProperties: 1, ownFeeCount: 1 }),
    "Change the management fee from 5.00% to 4.50% for all 1 property? 1 property has its own fee and won't change.",
  );
  assert.equal(P.defaultFeeConfirmText(500, 600, { totalProperties: 147, ownFeeCount: 0 }), "Change the management fee from 5.00% to 6.00% for all 147 properties?");
  assert.equal(P.resetOverridesLabel(3, 600), "Also reset those 3 properties to 6.00%");
  assert.equal(P.resetOverridesLabel(1, 600), "Also reset that 1 property to 6.00%");
  assert.equal(P.DEFAULT_FEE_DRAFT_NOTE, "Open drafts will recalculate. Final statements are not affected.");
});

test("setDefaultFeeProblem: missing / range / counts changed / unchanged", () => {
  const actual = { totalProperties: 10, ownFeeCount: 2 };
  const expected = { ...actual, currentBps: 500 };
  const p = (o) => P.setDefaultFeeProblem({ bps: 600, alsoResetOverrides: false, currentBps: 500, actual, expected, ...o });
  assert.equal(p({}), null);
  assert.deepStrictEqual(p({ bps: null }), { field: "bps", message: "Enter the new management fee % for all properties (for example 5.00)." });
  assert.deepStrictEqual(p({ bps: 10001 }), { field: "bps", message: "The management fee must be between 0.00% and 100.00%." });
  const changed = { field: "expectedCounts", message: "The properties changed while you were deciding. Check the numbers and confirm again." };
  assert.deepStrictEqual(p({ expected: null }), changed);
  assert.deepStrictEqual(p({ expected: { ...expected, totalProperties: 11 } }), changed);
  assert.deepStrictEqual(p({ expected: { ...expected, ownFeeCount: 1 } }), changed);
  assert.deepStrictEqual(p({ expected: { ...expected, currentBps: 450 } }), changed);
  assert.deepStrictEqual(p({ bps: 500 }), { field: "bps", message: "The default management fee is already 5.00%. Enter a different fee." });
  // same %, but resetting the own fees is a real change
  assert.equal(p({ bps: 500, alsoResetOverrides: true }), null);
  assert.deepStrictEqual(
    P.setDefaultFeeProblem({ bps: 500, alsoResetOverrides: true, currentBps: 500, actual: { totalProperties: 10, ownFeeCount: 0 }, expected: { totalProperties: 10, ownFeeCount: 0, currentBps: 500 } }),
    { field: "bps", message: "The default management fee is already 5.00%. Enter a different fee." },
  );
});

// --- the engine: each property at its own % ---------------------------------------------------------

const ACC = [
  { id: "a_rent", name: "Rent Income", kind: "income", systemKey: "rent_income", feeBase: true },
  { id: "a_mgmt", name: "Management Fees", kind: "expense", systemKey: "management_fees", feeBase: false },
  { id: "a_rep", name: "Repairs", kind: "expense", systemKey: "repairs", feeBase: false },
  { id: "a_draw", name: "Owner Draw", kind: "owner_draw", systemKey: "owner_draw", feeBase: false },
];
const cprop = (id, name, feeBps, o = {}) => ({
  id,
  name,
  ...(feeBps !== "omit" ? { feeBps } : {}),
  beginningCashCents: 0,
  securityDepositsCents: 0,
  earlyPaymentsCents: 0,
  propertyReserveCents: 0,
  unpaidBillsCents: 0,
  pendingEpayCents: 0,
  fee: { amountOverrideCents: null, memoOverride: null, excluded: false },
  draw: { amountOverrideCents: null, excluded: false },
  ...o,
});
let seqN = 0;
const crow = (key, propertyId, accountId, amountCents) => ({
  key,
  propertyId,
  unitLabel: null,
  date: "2026-09-05",
  accountId,
  counterparty: COMPANY_NAME,
  memo: "memo",
  amountCents,
  source: "manual",
  seq: ++seqN,
});
const cinput = (properties, rows, owner = {}) => ({
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  owner: { legalName: "Test Owner LLC", payeeName: "Pat Payee", ...owner },
  companyName: COMPANY_NAME,
  properties,
  accounts: ACC,
  rows,
});

test("multi-property: each property's fee at its own %, memos, totals and the All-properties column", () => {
  const props = [cprop("pA", "9 A St", 500), cprop("pB", "12 B St", 600), cprop("pC", "108 C Ave", 1250), cprop("pD", "200 D Rd", 0)];
  const rows = [
    crow("entry:ra", "pA", "a_rent", 433387),
    crow("entry:rb", "pB", "a_rent", 100001),
    crow("entry:rc", "pC", "a_rent", 250000),
    crow("entry:rd", "pD", "a_rent", 90000),
    crow("entry:xb", "pB", "a_rep", 5000),
  ];
  const r = C.computeStatement(cinput(props, rows));
  const fees = r.generated.map((g) => [g.propertyId, g.fee.bps, g.fee.baseCents, g.fee.computedCents, g.fee.amountCents, g.fee.memo]);
  assert.deepStrictEqual(fees, [
    ["pA", 500, 433387, 21669, 21669, "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87)"],
    ["pB", 600, 100001, 6000, 6000, "Management Fee 9/1/2026 - 9/30/2026 (6.00% of $1,000.01)"],
    ["pC", 1250, 250000, 31250, 31250, "Management Fee 9/1/2026 - 9/30/2026 (12.50% of $2,500.00)"],
    ["pD", 0, 90000, 0, 0, "Management Fee 9/1/2026 - 9/30/2026 (0.00% of $900.00)"],
  ]);
  assert.equal(percentOf(100001, 600), 6000); // 6000.06 -> half up to the cent
  // fee rows: one per property with a fee > 0, each with its own memo; none at 0%
  const feeLines = r.detail.subtractions.filter((l) => l.source === "management_fee");
  assert.deepStrictEqual(feeLines.map((l) => [l.key, l.amountCents, l.memo]), [
    ["fee:pA", 21669, fees[0][5]],
    ["fee:pB", 6000, fees[1][5]],
    ["fee:pC", 31250, fees[2][5]],
  ]);
  // income statement Management Fees row: per column, All properties = the sum
  const mgmt = r.incomeStatement.expense.accounts.find((a) => a.accountId === "a_mgmt");
  assert.deepStrictEqual(mgmt.values, { byProperty: [21669, 6000, 31250, 0], total: 58919 });
  // expenses per column = fee (+ repairs on B); totals add up; ending = 0 (draw takes the rest)
  assert.deepStrictEqual(r.summary.expenses.byProperty, [21669, 11000, 31250, 0]);
  assert.equal(r.summary.expenses.total, 21669 + 11000 + 31250);
  assert.deepStrictEqual(r.generated.map((g) => g.draw.suggestedCents), [433387 - 21669, 100001 - 11000, 250000 - 31250, 90000]);
  assert.equal(r.summary.ending.total, 0);
  assert.equal(r.detail.endingCents, r.summary.ending.total);
  assert.deepStrictEqual(r.warnings.filter((w) => w.blocking), []);
  // the view's All properties column
  const view = buildView(r, { statementDate: "2026-10-05" });
  const row = view.incomeStatement.rows.find((x) => x.label === "Management Fees");
  assert.deepStrictEqual(row.values, ["216.69", "60.00", "312.50", "0.00", "589.19"]);
});

test("FEE_NOT_SET no longer blocks: an owner without a fee is fine when every property has one", () => {
  const r = C.computeStatement(cinput([cprop("p1", "1 Main St", 500)], [crow("entry:r", "p1", "a_rent", 100000)], { managementFeeBps: null }));
  assert.ok(!r.warnings.some((w) => w.code === "FEE_NOT_SET"));
  assert.equal(r.generated[0].fee.amountCents, 5000);
  // a property's feeBps wins over the (old) owner fallback
  const r2 = C.computeStatement(cinput([cprop("p1", "1 Main St", 600)], [crow("entry:r", "p1", "a_rent", 100000)], { managementFeeBps: 500 }));
  assert.equal(r2.generated[0].fee.bps, 600);
  // the guard only fires when a property has no fee at all (can't happen from rosBuild)
  const r3 = C.computeStatement(cinput([cprop("p1", "1 Main St", null), cprop("p2", "2 Main St", 500)], [crow("entry:r", "p1", "a_rent", 100000)]));
  assert.deepStrictEqual(r3.warnings.filter((w) => w.code === "FEE_NOT_SET").length, 1);
  assert.throws(() => C.computeStatement(cinput([cprop("p1", "1 Main St", 10001)], [])), /feeBps of p1/);
  assert.throws(() => C.computeStatement(cinput([cprop("p1", "1 Main St", 2.5)], [])), /feeBps of p1/);
});

// --- rosBuild: link own fee ?? org default; preview hash; snapshot --------------------------------

const BACC = ACC.map((a) => ({ _id: a.id, name: a.name, kind: a.kind, feeBase: a.feeBase, systemKey: a.systemKey, active: true }));
const OWNER = { _id: "o1", legalName: "Nye Properties LLC", contactFirstName: "Adam", contactLastName: "Nye" };
const bentry = (id, propertyId, amountCents) => ({
  _id: id,
  ownerId: "o1",
  propertyId,
  date: "2026-09-05",
  accountId: "a_rent",
  counterparty: "Tenant",
  memo: "Payment",
  amountCents,
  source: "manual",
  createdAt: ++seqN,
});
function bdata({ feeA, feeB, defaultFeeBps } = {}) {
  const pd = (pid, name, fee, amount) => ({
    propertyId: pid,
    property: { name },
    links: [{ _id: `l_${pid}`, ownerId: "o1", openingBalanceCents: 0, startMonth: "2026-09", ...(fee !== undefined ? { managementFeeBps: fee } : {}) }],
    linkOwnerNames: [OWNER.legalName],
    prevFinalEndingCents: null,
    hasAnyFinal: false,
    units: [],
    entries: [bentry(`r_${pid}`, pid, amount)],
    workOrders: [],
  });
  return {
    statement: {
      _id: "s1",
      ownerId: "o1",
      month: "2026-09",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      propertyIds: ["pA", "pB"],
      excludedKeys: [],
      adjustments: [],
      overrides: [],
    },
    owner: OWNER,
    accounts: BACC,
    properties: [pd("pA", "9 A St", feeA, 200000), pd("pB", "12 B St", feeB, 300000)],
    statementDate: "2026-10-05",
    ...(defaultFeeBps !== undefined ? { defaultFeeBps } : {}),
  };
}

test("rosBuild: own fee on the link, else the org default (absent = 5.00%); feeSource per property", () => {
  const a = B.assembleStatement(bdata({ feeB: 600 }));
  assert.deepStrictEqual(a.input.properties.map((p) => p.feeBps), [500, 600]);
  assert.deepStrictEqual(a.properties.map((p) => [p.propertyId, p.feeSource, p.fee.bps, p.fee.amountCents]), [
    ["pA", "default", 500, 10000],
    ["pB", "own", 600, 18000],
  ]);
  assert.ok(!a.warnings.some((w) => w.code === "FEE_NOT_SET"));
  const fees = a.lines.filter((l) => l.kind === "fee").map((l) => [l.propertyId, l.memo]);
  assert.deepStrictEqual(fees, [
    ["pA", "Management Fee 9/1/2026 - 9/30/2026 (5.00% of $2,000.00)"],
    ["pB", "Management Fee 9/1/2026 - 9/30/2026 (6.00% of $3,000.00)"],
  ]);
  // a changed org default moves only the property without its own fee
  const b = B.assembleStatement(bdata({ feeB: 600, defaultFeeBps: 450 }));
  assert.deepStrictEqual(b.properties.map((p) => [p.fee.bps, p.fee.amountCents, p.feeSource]), [
    [450, 9000, "default"],
    [600, 18000, "own"],
  ]);
  // the deprecated owner fee is never read
  const c = B.assembleStatement({ ...bdata(), owner: { ...OWNER, managementFeeBps: 900 } });
  assert.deepStrictEqual(c.properties.map((p) => p.fee.bps), [500, 500]);
});

test("previewHash changes when a property's fee or the default changes, and only then", () => {
  const h = (o) => B.resultHash(B.assembleStatement(bdata(o)).result);
  const base = h({});
  assert.equal(h({}), base);
  assert.equal(h({ defaultFeeBps: 500 }), base); // explicit 5.00% = the built-in default
  assert.equal(h({ feeA: 500 }), base); // an own fee equal to the default prints the same statement
  assert.notEqual(h({ feeA: 600 }), base);
  assert.notEqual(h({ defaultFeeBps: 450 }), base);
  // even when the fee base is 0 (no rent), the % shown on the statement changes the hash
  const noRent = (o) => {
    const d = bdata(o);
    for (const p of d.properties) p.entries = [];
    return B.resultHash(B.assembleStatement(d).result);
  };
  assert.notEqual(noRent({ feeA: 600 }), noRent({}));
});

test("the snapshot stores the % used per property", () => {
  const built = B.assembleStatement(bdata({ feeB: 600 }), false);
  const snap = B.makeSnapshot(OWNER, built.result, "2026-10-05");
  const back = JSON.parse(JSON.stringify(snap));
  assert.deepStrictEqual(back.result.generated.map((g) => [g.propertyId, g.fee.bps]), [["pA", 500], ["pB", 600]]);
  const plan = B.finalizePlan(built, "s1");
  assert.deepStrictEqual(plan.generatedRows.filter((r) => r.source === "management_fee").map((r) => [r.propertyId, r.amountCents]), [
    ["pA", 10000],
    ["pB", 18000],
  ]);
});

// --- setDefaultFee on a fake database ------------------------------------------------------------

function fakeDb(tables) {
  let n = 0;
  const all = () => Object.values(tables).flat();
  const db = {
    get: async (id) => all().find((r) => r._id === id) ?? null,
    query: (table) => {
      let rows = [...(tables[table] ?? [])];
      const api = {
        withIndex: (_name, fn) => {
          const conds = [];
          const b = { eq: (f, v) => (conds.push((r) => r[f] === v), b) };
          if (fn) fn(b);
          rows = rows.filter((r) => conds.every((c) => c(r)));
          return api;
        },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
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
  return db;
}

function feeTables(settings) {
  return {
    financeSettings: settings ? [{ _id: "fs1", orgId: "org1", ...settings }] : [],
    properties: [
      { _id: "p1", orgId: "org1", name: "1 Main St" },
      { _id: "p2", orgId: "org1", name: "2 Main St" },
      { _id: "p3", orgId: "org1", name: "3 Main St" },
      { _id: "px", orgId: "other", name: "Other org" },
    ],
    ownerProperties: [
      { _id: "l1", orgId: "org1", ownerId: "o1", propertyId: "p1", managementFeeBps: 600 },
      { _id: "l2", orgId: "org1", ownerId: "o1", propertyId: "p2" },
      { _id: "l3", orgId: "org1", ownerId: "o2", propertyId: "p3", managementFeeBps: 450 },
      { _id: "lx", orgId: "other", ownerId: "ox", propertyId: "px", managementFeeBps: 700 },
    ],
  };
}

const ORG = { orgId: "org1", userId: "user1" };
const spy = () => {
  const events = [];
  const fn = async (_ctx, e) => void events.push(e);
  return { events, fn };
};

test("setDefaultFee: counts the org's properties and own fees", async () => {
  const db = fakeDb(feeTables());
  const { counts, usingDefaultCount } = await L.loadFeeCounts({ db }, "org1");
  assert.deepStrictEqual(counts, { totalProperties: 3, ownFeeCount: 2 });
  assert.equal(usingDefaultCount, 1);
  assert.equal(await L.readDefaultFeeBps({ db }, "org1"), 500);
});

test("setDefaultFee without reset: sets the default, own fees stay, one audit row", async () => {
  const tables = feeTables();
  const db = fakeDb(tables);
  const a = spy();
  const res = await L.applyDefaultFee({ db }, ORG, { bps: 600, alsoResetOverrides: false, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, a.fn);
  assert.deepStrictEqual(res, { defaultBps: 600, reset: 0 });
  assert.equal(tables.financeSettings.length, 1);
  assert.equal(tables.financeSettings[0].rosDefaultFeeBps, 600);
  assert.equal(await L.readDefaultFeeBps({ db }, "org1"), 600);
  assert.deepStrictEqual(tables.ownerProperties.map((l) => l.managementFeeBps), [600, undefined, 450, 700]);
  assert.deepStrictEqual(a.events.map((e) => [e.entity, e.entityId, e.action, e.from, e.to]), [
    ["config", "ros_default_fee", "ros_default_fee_changed", "5.00%", "6.00%"],
  ]);
});

test("setDefaultFee with reset: every own fee in the org is cleared (other orgs untouched), audited per link", async () => {
  const tables = feeTables({ rosDefaultFeeBps: 500, updatedAt: 1 });
  const db = fakeDb(tables);
  const a = spy();
  const res = await L.applyDefaultFee({ db }, ORG, { bps: 550, alsoResetOverrides: true, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, a.fn);
  assert.deepStrictEqual(res, { defaultBps: 550, reset: 2 });
  assert.equal(tables.financeSettings.length, 1);
  assert.equal(tables.financeSettings[0].rosDefaultFeeBps, 550);
  assert.deepStrictEqual(tables.ownerProperties.map((l) => [l._id, l.managementFeeBps]), [["l1", undefined], ["l2", undefined], ["l3", undefined], ["lx", 700]]);
  assert.deepStrictEqual(a.events.map((e) => [e.action, e.entityId, e.from, e.to, e.note ?? null]), [
    ["ros_default_fee_changed", "ros_default_fee", "5.00%", "5.50%", JSON.stringify({ totalProperties: 3, ownFeeCount: 2, alsoResetOverrides: true })],
    ["owner_property_fee_changed", "o1", "6.00% (own)", "5.50% (default)", '1 Main St: reset by "Change fee for all properties"'],
    ["owner_property_fee_changed", "o2", "4.50% (own)", "5.50% (default)", '3 Main St: reset by "Change fee for all properties"'],
  ]);
  // same % with reset is allowed (only the own fees change)
  tables.ownerProperties[1].managementFeeBps = 800;
  const b = spy();
  const again = await L.applyDefaultFee({ db }, ORG, { bps: 550, alsoResetOverrides: true, expectedCounts: { totalProperties: 3, ownFeeCount: 1, currentBps: 550 } }, b.fn);
  assert.deepStrictEqual(again, { defaultBps: 550, reset: 1 });
  assert.deepStrictEqual(b.events.map((e) => e.action), ["owner_property_fee_changed"]);
});

test("setDefaultFee refuses (and writes nothing) when the counts or the default changed, or the fee is bad", async () => {
  const refuse = async (args, field, message, settings) => {
    const tables = feeTables(settings);
    const before = JSON.stringify(tables);
    const a = spy();
    await assert.rejects(L.applyDefaultFee({ db: fakeDb(tables) }, ORG, args, a.fn), (e) => {
      assert.deepStrictEqual(e.data, { message, field });
      return true;
    });
    assert.equal(JSON.stringify(tables), before);
    assert.deepStrictEqual(a.events, []);
  };
  const changed = "The properties changed while you were deciding. Check the numbers and confirm again.";
  await refuse({ bps: 600, alsoResetOverrides: true, expectedCounts: { totalProperties: 3, ownFeeCount: 1, currentBps: 500 } }, "expectedCounts", changed);
  await refuse({ bps: 600, expectedCounts: { totalProperties: 2, ownFeeCount: 2, currentBps: 500 } }, "expectedCounts", changed);
  await refuse({ bps: 600, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, "expectedCounts", changed, { rosDefaultFeeBps: 450, updatedAt: 1 });
  await refuse({ bps: 600 }, "expectedCounts", changed);
  await refuse({ bps: null, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, "bps", "Enter the new management fee % for all properties (for example 5.00).");
  await refuse({ bps: 10001, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, "bps", "The management fee must be between 0.00% and 100.00%.");
  await refuse({ bps: 500, expectedCounts: { totalProperties: 3, ownFeeCount: 2, currentBps: 500 } }, "bps", "The default management fee is already 5.00%. Enter a different fee.");
});
