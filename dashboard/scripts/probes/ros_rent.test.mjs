// Tests for rent on the Rental Owner Statement (2026-11-12): rent is marked received on the Payments
// page (convex/rentPayments.ts -> rentPaymentsLib.ts, rules in rentPaymentsPolicy.ts) and ONLY those
// payments reach the statement as Rent Income. The roster-rent prefill is gone (these tests replace
// the ones that asserted it). Decisions: cash basis (a payment lands on the statement of the month it
// was RECEIVED), one full-roster-rent payment per unit per rent month, owner-direct / included /
// vacant / no-rent units greyed out, editable until the covering statement is final, rent edited
// only on the Payments page.
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
const R = await import("../../convex/rentPaymentsPolicy.ts");
const L = await import("../../convex/rentPaymentsLib.ts");
const LL = await import("../../components/finance/line-labels.ts");
const { COMPANY_NAME, percentOf } = await import("../../convex/rosFormat.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const read = (name) => readFileSync(join(CONVEX, name), "utf8");

// =================================================================================================
// Part 1: the pure rules (rentPaymentsPolicy.ts)
// =================================================================================================

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
  for (let c = 1; c <= 1_000_000; c += 997) assert.equal(P.rosterRentToCents(Number((c / 100).toFixed(2))), c);
});

test("rentMarkability: amount is ALWAYS the roster rent in cents; tenants joined with ' & '", () => {
  assert.deepStrictEqual(R.rentMarkability({ rent: 950.87, rentPaidTo: "company" }, ["Bob Ray", "Ann Lee", " "]), {
    markable: true,
    amountCents: 95087,
    counterparty: "Ann Lee & Bob Ray",
  });
  assert.deepStrictEqual(R.rentMarkability({ rent: 1200 }, ["Cara Diaz"]), { markable: true, amountCents: 120000, counterparty: "Cara Diaz" });
});

test("rentMarkability: greyed-out units and their reasons, in rule order", () => {
  const no = (u, tenants = ["T"]) => {
    const m = R.rentMarkability(u, tenants);
    assert.equal(m.markable, false);
    return [m.code, m.reason, m.sentence];
  };
  assert.deepStrictEqual(no({ rent: 900, rentPaidTo: "owner_direct" }), ["owner_direct", "Owner collects rent directly", "owner collects rent directly"]);
  assert.deepStrictEqual(no({ rent: 900, rentPaidTo: "included_in_other_unit" }), [
    "included_in_other_unit",
    "Rent is included in another unit",
    "rent is included in another unit",
  ]);
  assert.deepStrictEqual(no({ rent: 900, occupancy: "vacant" }), ["roster_vacant", "Vacant on the roster", "unit is marked vacant on the roster"]);
  assert.deepStrictEqual(no({ rent: 900, occupancy: "vacant_not_ready" })[0], "roster_vacant");
  assert.deepStrictEqual(no({ rent: 900, leaseType: "vacant" })[0], "roster_vacant");
  assert.deepStrictEqual(no({ rent: 900 }, []), ["vacant", "Vacant (no active tenant)", "no active tenant"]);
  assert.deepStrictEqual(no({}), ["no_rent", "No rent on the roster", "no rent on the roster"]);
  assert.deepStrictEqual(no({ rent: null }), ["no_rent", "No rent on the roster", "no rent on the roster"]);
  assert.deepStrictEqual(no({ rent: 950.875 }), ["invalid_rent", "Roster rent isn't a valid dollar amount", "the roster rent isn't a valid dollar amount"]);
  // order: owner-direct wins over vacant / no tenant / no rent
  assert.equal(no({ rentPaidTo: "owner_direct", occupancy: "vacant" }, [])[0], "owner_direct");
  // marked vacant on the roster wins even with an active resident on file
  assert.equal(no({ rent: 900, occupancy: "vacant" }, ["Still On File"])[0], "roster_vacant");
  // "occupied_leaving" is still occupied
  assert.equal(R.rentMarkability({ rent: 900, occupancy: "occupied_leaving" }, ["T"]).markable, true);
});

const TODAY = "2026-11-12";

test("validatePaymentFields: exact messages, every field; null / empty / unknown method all mean 'not chosen'", () => {
  const v = (o) => R.validatePaymentFields({ month: "2026-10", receivedDate: "2026-10-02", method: "check", note: "", today: TODAY, ...o });
  assert.deepStrictEqual(v({}), { ok: true, value: { month: "2026-10", receivedDate: "2026-10-02", method: "check", note: null } });
  assert.deepStrictEqual(v({ note: "  #1043 " }).value.note, "#1043");
  const bad = (o) => {
    const r = v(o);
    assert.equal(r.ok, false);
    return [r.field, r.message];
  };
  assert.deepStrictEqual(bad({ month: "" }), ["month", "Select the rent month."]);
  assert.deepStrictEqual(bad({ month: null }), ["month", "Select the rent month."]);
  assert.deepStrictEqual(bad({ month: "2026-13" }), ["month", "Select a real month (like October 2026)."]);
  assert.deepStrictEqual(bad({ month: "2027-01" }), ["month", "You can't mark rent for January 2027 yet."]);
  assert.equal(v({ month: "2026-12", receivedDate: "2026-11-10" }).ok, true, "next month's rent can be marked (paid early)");
  assert.deepStrictEqual(bad({ receivedDate: "" }), ["receivedDate", "Enter the date the rent was received."]);
  assert.deepStrictEqual(bad({ receivedDate: undefined }), ["receivedDate", "Enter the date the rent was received."]);
  assert.deepStrictEqual(bad({ receivedDate: "2026-02-30" }), ["receivedDate", "Enter a real date."]);
  assert.deepStrictEqual(bad({ receivedDate: "2026-11-13" }), ["receivedDate", "The received date can't be in the future."]);
  // window: from the 1st of the month two months before the rent month
  assert.deepStrictEqual(bad({ receivedDate: "2026-07-31" }), ["receivedDate", "For October 2026 rent, the received date must be on or after 8/1/2026."]);
  assert.equal(v({ receivedDate: "2026-08-01" }).ok, true);
  assert.equal(v({ receivedDate: TODAY }).ok, true, "a late payment can be received any time up to today");
  for (const m of ["", null, undefined, "cheque", "CHECK", "venmo"]) assert.deepStrictEqual(bad({ method: m }), ["method", "Select how the rent was paid."], String(m));
  for (const m of R.PAYMENT_METHODS) assert.equal(v({ method: m }).ok, true, m);
  assert.deepStrictEqual(R.PAYMENT_METHODS.map((m) => R.PAYMENT_METHOD_LABELS[m]), ["Cash", "Check", "Money order", "Other"]);
  assert.deepStrictEqual(bad({ note: "x".repeat(201) }), ["note", "Keep the note under 200 characters."]);
  assert.equal(v({ note: "x".repeat(200) }).ok, true);
  // all fields at once, for the form
  assert.deepStrictEqual(R.validatePaymentFieldsAll({ month: "2026-10", receivedDate: "", method: "", note: "x".repeat(201), today: TODAY }), {
    receivedDate: "Enter the date the rent was received.",
    method: "Select how the rent was paid.",
    note: "Keep the note under 200 characters.",
  });
});

test("receivedDateLockProblem: a month final for the property, or before the owner's first statement month", () => {
  const p = { name: "108 Jackson Avenue", lockedThrough: "2026-09", startMonth: "2026-09" };
  assert.equal(R.receivedDateLockProblem("2026-09-30", p), "September 2026 is final for 108 Jackson Avenue. Use a received date in October 2026 or later.");
  assert.equal(R.receivedDateLockProblem("2026-10-01", p), null);
  assert.equal(
    R.receivedDateLockProblem("2026-08-31", { ...p, lockedThrough: null }),
    "Statements for 108 Jackson Avenue start in September 2026. Use a received date on or after 9/1/2026.",
  );
  assert.equal(R.receivedDateLockProblem("2026-08-31", { ...p, lockedThrough: null, startMonth: null }), null);
});

test("rentRecordsFor / paymentStatus: a payment counts for its RENT month; rent entered by hand counts for the month it is DATED", () => {
  const rent = new Set(["a_rent"]);
  const recs = [
    { _id: "p1", unitId: "u1", date: "2026-10-02", accountId: "a_rent", source: "rent_payment", rentForMonth: "2026-09", amountCents: 88300 },
    { _id: "p2", unitId: "u1", date: "2026-10-03", accountId: "a_rent", source: "rent_payment", rentForMonth: "2026-10", amountCents: 88300, voided: true },
    { _id: "m1", unitId: "u2", date: "2026-09-22", accountId: "a_rent", source: "manual", amountCents: 95087 },
    { _id: "m2", unitId: "u2", date: "2026-09-23", accountId: "a_laundry", source: "manual", amountCents: 1000 },
    { _id: "m3", unitId: "u3", date: "2026-09-24", accountId: "a_rent", source: "manual", amountCents: 1, voided: true },
  ];
  const at = (u, m) => R.rentRecordsFor(u, m, recs, rent);
  assert.equal(at("u1", "2026-09").payment._id, "p1", "received in October, for September");
  assert.equal(at("u1", "2026-10").payment, null, "a voided payment doesn't count");
  assert.deepStrictEqual(at("u1", "2026-10").ledger, [], "a payment never counts as 'entered by hand' for its received month");
  assert.deepStrictEqual(at("u2", "2026-09").ledger.map((r) => r._id), ["m1"], "Rent Income only, not other income");
  assert.deepStrictEqual(at("u3", "2026-09"), { payment: null, ledger: [] });
  assert.equal(R.paymentStatus(true, at("u1", "2026-09")), "paid");
  assert.equal(R.paymentStatus(true, at("u2", "2026-09")), "paid");
  assert.equal(R.paymentStatus(true, at("u3", "2026-09")), "unpaid");
  assert.equal(R.paymentStatus(false, at("u3", "2026-09")), "not_markable");
  // paid wins over not markable (a payment stays visible after the roster changed)
  assert.equal(R.paymentStatus(false, at("u1", "2026-09")), "paid");
});

test("paymentLock: billed on a final, or dated in a month that is final; else editable", () => {
  const p = { name: "108 Jackson Avenue", lockedThrough: "2026-09" };
  assert.deepStrictEqual(R.paymentLock({ statementId: "s1", date: "2026-10-02" }, { ...p, statementMonth: "2026-10" }), {
    locked: true,
    reason: "On the October 2026 final statement.",
    message: "This payment is on a final statement and can't be changed. Put a correction on a later statement.",
  });
  assert.deepStrictEqual(R.paymentLock({ date: "2026-09-29" }, p), {
    locked: true,
    reason: "September 2026 is final for 108 Jackson Avenue.",
    message: "September 2026 is final for 108 Jackson Avenue, so this payment can't be changed.",
  });
  assert.deepStrictEqual(R.paymentLock({ date: "2026-10-01" }, p), { locked: false, reason: null, message: null });
});

test("unpaidCheckMonths: the statement month and up to two before, never before the first statement month", () => {
  assert.deepStrictEqual(R.unpaidCheckMonths("2026-11", null), ["2026-11"]);
  assert.deepStrictEqual(R.unpaidCheckMonths("2026-11", "2026-11"), ["2026-11"]);
  assert.deepStrictEqual(R.unpaidCheckMonths("2026-11", "2026-10"), ["2026-10", "2026-11"]);
  assert.deepStrictEqual(R.unpaidCheckMonths("2026-11", "2026-01"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepStrictEqual(R.unpaidCheckMonths("2027-01", "2026-01"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepStrictEqual(R.unpaidCheckMonths("2026-11", "2026-12"), ["2026-11"]);
  assert.equal(R.RENT_PAY_MSG.UNPAID(1, "2026-10"), "1 unit has no rent marked received for October 2026.");
  assert.equal(R.RENT_PAY_MSG.UNPAID(3, "2026-10"), "3 units have no rent marked received for October 2026.");
});

test("manual ledger: Rent Income is refused ('Record rent on the Payments page.'), other income accounts are fine", () => {
  const base = {
    propertyId: "p1",
    unitId: "u1",
    date: "2026-10-05",
    accountId: "a_rent",
    counterparty: "David Roberts",
    memo: "Payment",
    amount: "883.00",
    today: TODAY,
    property: { name: "108 Jackson Avenue" },
    unitInProperty: true,
  };
  assert.deepStrictEqual(P.validateEntryFields({ ...base, account: { name: "Rent Income", active: true, systemKey: "rent_income" } }), {
    ok: false,
    field: "accountId",
    message: "Record rent on the Payments page.",
  });
  assert.equal(P.validateEntryFieldsAll({ ...base, account: { name: "Rent Income", active: true, systemKey: "rent_income" } }).accountId, "Record rent on the Payments page.");
  assert.equal(P.validateEntryFields({ ...base, accountId: "a_laundry", account: { name: "Laundry Income", active: true } }).ok, true);
  assert.equal(P.validateEntryFields({ ...base, accountId: "a_laundry", account: { name: "Laundry Income", active: true, systemKey: null } }).ok, true);
});

// =================================================================================================
// Part 2: the Payments page functions (rentPaymentsLib.ts) on a fake database
// =================================================================================================

function fakeDb(tables) {
  let n = 0;
  const all = () => Object.values(tables).flat();
  const db = {
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
        // The indexes these tests use end in month (ownerStatementProperties) or date (ledgerEntries).
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
  return db;
}

const J = "108 Jackson Avenue";
const RENT_ACC = { _id: "a_rent", orgId: "org1", name: "Rent Income", nameKey: "rent income", kind: "income", systemKey: "rent_income", feeBase: true, active: true };

function tables(over = {}) {
  const unit = (id, propertyId, unitNumber, extra = {}) => ({ _id: id, orgId: "org1", propertyId, unitNumber, ...extra });
  return {
    owners: [
      { _id: "o1", orgId: "org1", legalName: "Nye Properties LLC" },
      { _id: "o2", orgId: "org1", legalName: "Ash LLC" },
      { _id: "o3", orgId: "org1", legalName: "Birch LLC" },
      { _id: "ox", orgId: "other", legalName: "Other Org LLC" },
    ],
    properties: [
      { _id: "p1", orgId: "org1", name: J, category: "gold" },
      { _id: "p2", orgId: "org1", name: "12 Elm Street", category: "silver" },
      { _id: "p3", orgId: "org1", name: "3 Co Owned Way", category: "make_up" },
      { _id: "p4", orgId: "org1", name: "2 Jackson Avenue", category: "gold" },
      { _id: "px", orgId: "other", name: "Other org" },
    ],
    ownerProperties: [
      { _id: "l1", orgId: "org1", ownerId: "o1", propertyId: "p1", startMonth: "2026-09" },
      { _id: "l3a", orgId: "org1", ownerId: "o2", propertyId: "p3" },
      { _id: "l3b", orgId: "org1", ownerId: "o3", propertyId: "p3" },
      { _id: "l4", orgId: "org1", ownerId: "o2", propertyId: "p4" },
    ],
    units: [
      unit("u1", "p1", "1st Floor", { rent: 883, rentPaidTo: "company", occupancy: "occupied" }),
      unit("u2", "p1", "2nd Floor", { rent: 950.87 }),
      unit("u10", "p1", "10", { rent: 1000 }),
      unit("u3", "p1", "3rd Floor", { rent: 2500, rentPaidTo: "owner_direct" }),
      unit("u4", "p1", "Basement", { rent: 700, occupancy: "vacant" }),
      unit("u5", "p1", "Garage"),
      unit("u6", "p1", "Rear", { rent: 950.875 }),
      unit("u8", "p1", "Attic", { rent: 500, rentPaidTo: "included_in_other_unit" }),
      unit("u9", "p1", "Loft", { rent: 600 }),
      unit("u7", "p2", "A", { rent: 1000 }),
      unit("u11", "p3", "1", { rent: 1100 }),
      unit("u12", "p4", "1", { rent: 1300 }),
      unit("ux", "px", "1", { rent: 999 }),
    ].map((u) => ({ ...u, orgId: u.orgId })),
    residents: [
      ["u1", "David Roberts"],
      ["u2", "Sharavia Rivera"],
      ["u10", "Ten Tenant"],
      ["u3", "Owner Direct Tenant"],
      ["u4", "Still On File"],
      ["u5", "Garage Renter"],
      ["u6", "Rear Tenant"],
      ["u8", "Attic Tenant"],
      ["u7", "Elm Tenant"],
      ["u11", "Co Tenant"],
      ["u12", "Two Jackson Tenant"],
    ]
      .map(([unitId, fullName], i) => ({ _id: `r${i}`, orgId: "org1", unitId, fullName, active: true }))
      .concat([{ _id: "r_old", orgId: "org1", unitId: "u9", fullName: "Moved Out", active: false }]),
    ledgerAccounts: [RENT_ACC, { _id: "a_laundry", orgId: "org1", name: "Laundry", kind: "income", feeBase: false, active: true }],
    ownerStatementProperties: over.osp ?? [],
    ownerStatements: over.statements ?? [],
    ledgerEntries: [
      // The seeded September 108 Jackson row entered by hand (before the Payments page)
      {
        _id: "legacy_u2",
        orgId: "org1",
        ownerId: "o1",
        propertyId: "p1",
        unitId: "u2",
        date: "2026-09-22",
        type: "income",
        accountId: "a_rent",
        counterparty: "Sharavia Rivera",
        memo: "by Sharavia Rivera",
        amountCents: 95087,
        source: "manual",
        createdAt: 1,
        updatedAt: 1,
      },
      ...(over.entries ?? []),
    ],
  };
}

const ORG = { orgId: "org1", user: { _id: "user1" } };
function setup(over) {
  const t = tables(over);
  const db = fakeDb(t);
  const events = [];
  const deps = { audit: async (e) => void events.push(e), rentAccount: async () => RENT_ACC };
  return { t, ctx: { db }, deps, events };
}
const payments = (t) => t.ledgerEntries.filter((e) => e.source === "rent_payment");

async function refused(promise, field, message) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.data?.field, field);
    assert.equal(e.data?.message, message);
    return true;
  });
}

const mark = (s, o = {}) =>
  L.markOne(s.ctx, ORG, { unitId: "u1", month: "2026-10", receivedDate: "2026-10-02", method: "check", note: "#1043", ...o }, TODAY, s.deps);

test("markReceived: writes ONE Rent Income ledger row: roster rent in cents, received date, rent month, tenant, memo Payment", async () => {
  const s = setup();
  // an amount sent by a (malicious or stale) client is ignored: the roster rent is used
  const out = await mark(s, { amountCents: 1 });
  assert.equal(out.amountCents, 88300);
  const rows = payments(s.t);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepStrictEqual(
    {
      ownerId: r.ownerId,
      propertyId: r.propertyId,
      unitId: r.unitId,
      date: r.date,
      type: r.type,
      accountId: r.accountId,
      counterparty: r.counterparty,
      memo: r.memo,
      amountCents: r.amountCents,
      source: r.source,
      rentForMonth: r.rentForMonth,
      paymentMethod: r.paymentMethod,
      paymentNote: r.paymentNote,
      statementId: r.statementId,
      createdBy: r.createdBy,
    },
    {
      ownerId: "o1",
      propertyId: "p1",
      unitId: "u1",
      date: "2026-10-02",
      type: "income",
      accountId: "a_rent",
      counterparty: "David Roberts",
      memo: "Payment",
      amountCents: 88300,
      source: "rent_payment",
      rentForMonth: "2026-10",
      paymentMethod: "check",
      paymentNote: "#1043",
      statementId: undefined,
      createdBy: "user1",
    },
  );
  assert.ok(Number.isSafeInteger(r.amountCents));
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].action, "rent_marked_received");
  assert.equal(s.events[0].entity, "ledger_entry");
  // no note -> no paymentNote field
  await mark(s, { unitId: "u10", note: "  " });
  assert.equal("paymentNote" in payments(s.t)[1], false);
});

test("uniqueness: at most one non-voided payment per unit per rent month", async () => {
  const s = setup();
  await mark(s);
  await refused(mark(s, { receivedDate: "2026-10-05", method: "cash" }), "unitId", "Unit 1st Floor at 108 Jackson Avenue already has rent marked received for October 2026.");
  assert.equal(payments(s.t).length, 1, "nothing written");
  // another rent month of the same unit is fine, even received in the same month (MEDIUM-1 only
  // guards against rent entered by hand in the ledger)
  await mark(s, { month: "2026-09", receivedDate: "2026-10-02" });
  assert.equal(payments(s.t).length, 2);
  // undo, then it can be marked again
  const oct = payments(s.t).find((e) => e.rentForMonth === "2026-10");
  await L.undoOne(s.ctx, ORG, { entryId: oct._id, reason: "Bounced check" }, s.deps);
  await mark(s, { receivedDate: "2026-10-09", method: "cash" });
  assert.equal(payments(s.t).filter((e) => e.rentForMonth === "2026-10" && e.voided !== true).length, 1);
});

test("markReceived: greyed-out units, no owner, co-owned, unknown units — each refused with its exact message", async () => {
  const s = setup();
  const cases = [
    ["u3", "Rent can't be marked for Unit 3rd Floor at 108 Jackson Avenue: owner collects rent directly."],
    ["u8", "Rent can't be marked for Unit Attic at 108 Jackson Avenue: rent is included in another unit."],
    ["u4", "Rent can't be marked for Unit Basement at 108 Jackson Avenue: unit is marked vacant on the roster."],
    ["u9", "Rent can't be marked for Unit Loft at 108 Jackson Avenue: no active tenant."],
    ["u5", "Rent can't be marked for Unit Garage at 108 Jackson Avenue: no rent on the roster."],
    ["u6", "Rent can't be marked for Unit Rear at 108 Jackson Avenue: the roster rent isn't a valid dollar amount."],
    ["u7", "12 Elm Street has no owner yet. Link it on the Owners page first."],
    ["u11", "3 Co Owned Way is listed under 2 owners (Ash LLC, Birch LLC). Statements for it are paused until the ownership split is set."],
    ["ux", "Unit not found."],
    ["nope", "Unit not found."],
    ["", "Select the unit to mark rent for."],
    [null, "Select the unit to mark rent for."],
  ];
  for (const [unitId, message] of cases) await refused(mark(s, { unitId }), "unitId", message);
  assert.equal(payments(s.t).length, 0);
});

test("markReceived: date window, future and locked months; the month itself", async () => {
  const s = setup({ osp: [{ _id: "f1", orgId: "org1", statementId: "s_sep", ownerId: "o1", propertyId: "p1", month: "2026-09", status: "final" }] });
  await refused(mark(s, { receivedDate: "2026-07-31" }), "receivedDate", "For October 2026 rent, the received date must be on or after 8/1/2026.");
  await refused(mark(s, { receivedDate: "2026-11-13" }), "receivedDate", "The received date can't be in the future.");
  await refused(mark(s, { receivedDate: "2026-09-30" }), "receivedDate", "September 2026 is final for 108 Jackson Avenue. Use a received date in October 2026 or later.");
  await refused(mark(s, { month: "2027-01" }), "month", "You can't mark rent for January 2027 yet.");
  await refused(mark(s, { method: "" }), "method", "Select how the rent was paid.");
  await refused(mark(s, { method: null }), "method", "Select how the rent was paid.");
  assert.equal(payments(s.t).length, 0);
  await mark(s, { receivedDate: "2026-10-01" });
  assert.equal(payments(s.t).length, 1);
  // before the owner's first statement month (no finals yet)
  const s2 = setup();
  await refused(
    mark(s2, { month: "2026-09", receivedDate: "2026-08-31" }),
    "receivedDate",
    "Statements for 108 Jackson Avenue start in September 2026. Use a received date on or after 9/1/2026.",
  );
});

test("rent entered by hand before the Payments page: shown as Paid ('entered in the ledger'), never doubled", async () => {
  const s = setup();
  const sep = await L.listPayments(s.ctx, ORG, { month: "2026-09" }, TODAY);
  const u2 = sep.rows.find((r) => r.unitId === "u2");
  assert.equal(u2.status, "paid");
  assert.deepStrictEqual(
    { kind: u2.payment.kind, amount: u2.payment.amountCents, date: u2.payment.receivedDate, locked: u2.payment.locked, reason: u2.payment.lockedReason, canMark: u2.canMark },
    { kind: "ledger", amount: 95087, date: "2026-09-22", locked: true, reason: "Entered in the ledger. Change it on the Ledger page.", canMark: false },
  );
  await refused(
    mark(s, { unitId: "u2", month: "2026-09", receivedDate: "2026-09-25" }),
    "unitId",
    "Unit 2nd Floor at 108 Jackson Avenue already has rent recorded in the ledger for September 2026. Check it on the Ledger page.",
  );
  // October: nothing dated in October, so October rent is still unpaid and can be marked
  const oct = await L.listPayments(s.ctx, ORG, { month: "2026-10" }, TODAY);
  assert.equal(oct.rows.find((r) => r.unitId === "u2").status, "unpaid");
  await mark(s, { unitId: "u2" });
  assert.equal(payments(s.t)[0].amountCents, 95087);
});

test("markManyReceived: all or nothing, with every failing unit listed; dedupes; bounded", async () => {
  const s = setup();
  const many = (unitIds, o = {}) =>
    L.markMany(s.ctx, ORG, { unitIds, month: "2026-10", receivedDate: "2026-10-03", method: "cash", ...o }, TODAY, s.deps);
  await assert.rejects(many(["u1", "u3", "u7"]), (e) => {
    assert.equal(e.data.field, "unitIds");
    assert.equal(
      e.data.message,
      "Nothing was saved: 2 of the selected units can't be marked received. Rent can't be marked for Unit 3rd Floor at 108 Jackson Avenue: owner collects rent directly. 12 Elm Street has no owner yet. Link it on the Owners page first.",
    );
    assert.deepStrictEqual(e.data.problems.map((p) => p.unitId), ["u3", "u7"]);
    return true;
  });
  assert.equal(payments(s.t).length, 0, "nothing written when any unit fails");
  const out = await many(["u1", "u2", "u1", " u2 "]);
  assert.deepStrictEqual(out, { count: 2, totalCents: 88300 + 95087 });
  assert.deepStrictEqual(payments(s.t).map((e) => [e.unitId, e.amountCents, e.date, e.paymentMethod]), [
    ["u1", 88300, "2026-10-03", "cash"],
    ["u2", 95087, "2026-10-03", "cash"],
  ]);
  // marking again: both already marked
  await assert.rejects(many(["u1"]), (e) => /already has rent marked received for October 2026/.test(e.data.message));
  await refused(many([]), "unitIds", "Select at least one unit to mark received.");
  await refused(many(null), "unitIds", "Select at least one unit to mark received.");
  await refused(many(Array.from({ length: 101 }, (_, i) => `u_${i}`)), "unitIds", "Select at most 100 units at a time.");
  await refused(many(["u10"], { method: "" }), "method", "Select how the rent was paid.");
  assert.equal(payments(s.t).length, 2);
});

test("updatePayment / undoPayment: editable until final; locked after; only rent payments; exact messages", async () => {
  const s = setup();
  await mark(s);
  const id = payments(s.t)[0]._id;
  await L.updateOne(s.ctx, ORG, { entryId: id, method: "money_order", note: "" }, TODAY, s.deps);
  let row = payments(s.t)[0];
  assert.equal(row.paymentMethod, "money_order");
  assert.equal("paymentNote" in row, false, "an empty note clears it");
  assert.equal(row.amountCents, 88300, "the amount never changes");
  await L.updateOne(s.ctx, ORG, { entryId: id, receivedDate: "2026-10-09" }, TODAY, s.deps);
  assert.equal(payments(s.t)[0].date, "2026-10-09");
  assert.deepStrictEqual(s.events.map((e) => e.action), ["rent_marked_received", "rent_payment_updated", "rent_payment_updated"]);
  // no change -> no write, no audit
  await L.updateOne(s.ctx, ORG, { entryId: id, receivedDate: "2026-10-09" }, TODAY, s.deps);
  assert.equal(s.events.length, 3);
  await refused(L.updateOne(s.ctx, ORG, { entryId: id, receivedDate: "2026-11-20" }, TODAY, s.deps), "receivedDate", "The received date can't be in the future.");
  await refused(L.updateOne(s.ctx, ORG, { entryId: id, method: "" }, TODAY, s.deps), "method", "Select how the rent was paid.");

  // October becomes final for the property: the payment is locked (billed on it)
  row = payments(s.t)[0];
  row.statementId = "s_oct";
  row.postedDate = row.date;
  s.t.ownerStatementProperties.push({ _id: "f2", orgId: "org1", statementId: "s_oct", ownerId: "o1", propertyId: "p1", month: "2026-10", status: "final" });
  const billed = "This payment is on a final statement and can't be changed. Put a correction on a later statement.";
  await refused(L.updateOne(s.ctx, ORG, { entryId: id, note: "x" }, TODAY, s.deps), "entryId", billed);
  await refused(L.undoOne(s.ctx, ORG, { entryId: id, reason: "oops" }, s.deps), "entryId", billed);

  // an unbilled payment dated in a final month is locked too (the locked-month rule)
  delete row.statementId;
  await refused(
    L.undoOne(s.ctx, ORG, { entryId: id, reason: "oops" }, s.deps),
    "entryId",
    "October 2026 is final for 108 Jackson Avenue, so this payment can't be changed.",
  );

  // a hand-entered row isn't a payment; unknown ids aren't found
  await refused(L.updateOne(s.ctx, ORG, { entryId: "legacy_u2", note: "x" }, TODAY, s.deps), "entryId", "That transaction isn't a rent payment from the Payments page.");
  await refused(L.undoOne(s.ctx, ORG, { entryId: "nope", reason: "x" }, s.deps), "entryId", "Payment not found.");
});

test("undoPayment: needs a reason; voids (kept in history); the unit shows as unpaid again", async () => {
  const s = setup();
  await mark(s);
  const id = payments(s.t)[0]._id;
  await refused(L.undoOne(s.ctx, ORG, { entryId: id, reason: "  " }, s.deps), "reason", "Enter why you're undoing this payment.");
  await refused(L.undoOne(s.ctx, ORG, { entryId: id, reason: "x".repeat(301) }, s.deps), "reason", "Keep the reason under 300 characters.");
  await L.undoOne(s.ctx, ORG, { entryId: id, reason: "Entered on the wrong unit" }, s.deps);
  const row = payments(s.t)[0];
  assert.deepStrictEqual([row.voided, row.voidReason, row.voidedBy], [true, "Entered on the wrong unit", "user1"]);
  assert.equal(s.events.at(-1).action, "rent_payment_undone");
  await refused(L.undoOne(s.ctx, ORG, { entryId: id, reason: "again" }, s.deps), "entryId", "This payment was already undone.");
  const list = await L.listPayments(s.ctx, ORG, { month: "2026-10" }, TODAY);
  assert.equal(list.rows.find((r) => r.unitId === "u1").status, "unpaid");
});

test("list: one row per unit of the org, statuses, greyed-out reasons, summary, sort and filters", async () => {
  const s = setup({ statements: [{ _id: "s_oct", orgId: "org1", month: "2026-10" }] });
  await mark(s, { month: "2026-10", receivedDate: "2026-10-02" });
  const out = await L.listPayments(s.ctx, ORG, { month: "2026-10" }, TODAY);
  assert.equal(out.monthLabel, "October 2026");
  assert.equal(out.earliestReceivedDate, "2026-08-01");
  assert.equal(out.truncated, false);
  // sorted by team (Gold, Silver, Make Up), property (natural), unit (natural); other orgs never shown
  assert.deepStrictEqual(
    out.rows.map((r) => [r.teamLabel, r.propertyName, r.unit, r.status]),
    [
      ["Gold", "2 Jackson Avenue", "1", "unpaid"],
      ["Gold", J, "1st Floor", "paid"],
      ["Gold", J, "2nd Floor", "unpaid"],
      ["Gold", J, "3rd Floor", "not_markable"],
      ["Gold", J, "10", "unpaid"],
      ["Gold", J, "Attic", "not_markable"],
      ["Gold", J, "Basement", "not_markable"],
      ["Gold", J, "Garage", "not_markable"],
      ["Gold", J, "Loft", "not_markable"],
      ["Gold", J, "Rear", "not_markable"],
      ["Silver", "12 Elm Street", "A", "unpaid"],
      ["Make Up", "3 Co Owned Way", "1", "unpaid"],
    ],
  );
  const by = (u) => out.rows.find((r) => r.unitId === u);
  assert.deepStrictEqual([by("u3").reason, by("u8").reason, by("u4").reason, by("u9").reason, by("u5").reason, by("u6").reason], [
    "Owner collects rent directly",
    "Rent is included in another unit",
    "Vacant on the roster",
    "Vacant (no active tenant)",
    "No rent on the roster",
    "Roster rent isn't a valid dollar amount",
  ]);
  assert.deepStrictEqual(
    { rent: by("u1").rentCents, owner: by("u1").ownerName, tenants: by("u1").tenants, canMark: by("u1").canMark, method: by("u1").payment.methodLabel, note: by("u1").payment.note, locked: by("u1").payment.locked },
    { rent: 88300, owner: "Nye Properties LLC", tenants: ["David Roberts"], canMark: false, method: "Check", note: "#1043", locked: false },
  );
  assert.equal(by("u2").canMark, true);
  assert.equal(by("u7").canMark, false);
  assert.equal(by("u7").ownerProblem, "12 Elm Street has no owner yet. Link it on the Owners page first.");
  assert.equal(by("u11").canMark, false);
  assert.match(by("u11").ownerProblem, /listed under 2 owners/);
  assert.deepStrictEqual(out.summary, {
    paid: 1,
    unpaid: 5,
    notMarkable: 6,
    total: 12,
    receivedCents: 88300,
    unpaidCents: 130000 + 95087 + 100000 + 100000 + 110000,
  });

  // filters: team, owner, property, status (the summary ignores only the status filter)
  const f = async (o) => L.listPayments(s.ctx, ORG, { month: "2026-10", ...o }, TODAY);
  assert.deepStrictEqual((await f({ category: "silver" })).rows.map((r) => r.unitId), ["u7"]);
  assert.deepStrictEqual((await f({ ownerId: "o2" })).rows.map((r) => r.unitId), ["u12"], "co-owned properties belong to no single owner");
  assert.deepStrictEqual((await f({ propertyId: "p1", status: "unpaid" })).rows.map((r) => r.unitId), ["u2", "u10"]);
  const paidOnly = await f({ status: "paid" });
  assert.deepStrictEqual(paidOnly.rows.map((r) => r.unitId), ["u1"]);
  assert.equal(paidOnly.summary.total, 12);
  assert.deepStrictEqual(out.filters.owners, [
    { ownerId: "o2", name: "Ash LLC" },
    { ownerId: "o1", name: "Nye Properties LLC" },
  ]);
  await refused(f({ category: "bronze" }), "category", "Select a team.");
  await refused(f({ status: "partial" }), "status", "Select a status.");
  await refused(f({ ownerId: "ox" }), "ownerId", "Owner not found.");
  await refused(f({ propertyId: "px" }), "propertyId", "Property not found.");
  await refused(L.listPayments(s.ctx, ORG, { month: "" }, TODAY), "month", "Select the rent month.");

  // billed on the October final: locked, with the statement named
  const row = payments(s.t)[0];
  row.statementId = "s_oct";
  const locked = (await f({})).rows.find((r) => r.unitId === "u1").payment;
  assert.deepStrictEqual([locked.locked, locked.lockedReason, locked.statementId], [true, "On the October 2026 final statement.", "s_oct"]);
});

test("MEDIUM-1: never a payment on top of a Rent Income row entered by hand in the ledger dated in the received month", async () => {
  // u2 has a hand-entered Rent Income row dated 9/22 (legacy_u2, no rent month): it is matched by the
  // month it is DATED, so October rent received in September would be counted twice on September's statement.
  const s = setup();
  const sameMonth = (o) => mark(s, { unitId: "u2", ...o });
  await refused(
    sameMonth({ month: "2026-10", receivedDate: "2026-09-25" }),
    "unitId",
    "Unit 2nd Floor at 108 Jackson Avenue already has rent entered in the ledger dated in September 2026. Check it on the Ledger page before adding another payment.",
  );
  assert.equal(payments(s.t).length, 0);
  // received in October: no rent dated in October yet -> fine
  await sameMonth({ month: "2026-10", receivedDate: "2026-10-01" });
  // a voided row doesn't count
  const s2 = setup({ entries: [{ ...tables().ledgerEntries[0], _id: "void_u10", unitId: "u10", date: "2026-10-03", voided: true }] });
  await mark(s2, { unitId: "u10", receivedDate: "2026-10-04" });
  assert.equal(payments(s2.t).length, 1);
  // another account (not Rent Income) doesn't count
  const s3 = setup({ entries: [{ ...tables().ledgerEntries[0], _id: "laundry_u10", unitId: "u10", date: "2026-10-03", accountId: "a_laundry" }] });
  await mark(s3, { unitId: "u10", receivedDate: "2026-10-04" });
  // only source "manual" counts: another source on the Rent Income account (e.g. Stripe) dated in
  // the received month doesn't (November rent received 10/4, a Stripe row dated 10/3)
  const s5 = setup({ entries: [{ ...tables().ledgerEntries[0], _id: "stripe_u10", unitId: "u10", date: "2026-10-03", source: "stripe" }] });
  await mark(s5, { unitId: "u10", month: "2026-11", receivedDate: "2026-10-04" });
  assert.equal(payments(s5.t).length, 1);
  // bulk: all or nothing, with the same message for the failing unit (u2 has the 9/22 ledger row)
  const s4 = setup();
  await assert.rejects(
    L.markMany(s4.ctx, ORG, { unitIds: ["u1", "u2"], month: "2026-10", receivedDate: "2026-09-25", method: "cash" }, TODAY, s4.deps),
    (e) => {
      assert.deepStrictEqual(e.data.problems, [
        {
          unitId: "u2",
          message: "Unit 2nd Floor at 108 Jackson Avenue already has rent entered in the ledger dated in September 2026. Check it on the Ledger page before adding another payment.",
        },
      ]);
      return true;
    },
  );
  assert.equal(payments(s4.t).length, 0, "nothing written");
  // a date edit into a month with rent entered by hand dated in it is refused too (the row itself never counts)
  await mark(s4, { unitId: "u2", month: "2026-10", receivedDate: "2026-10-01" });
  const octRow = payments(s4.t)[0];
  await refused(
    L.updateOne(s4.ctx, ORG, { entryId: octRow._id, receivedDate: "2026-09-26" }, TODAY, s4.deps),
    "receivedDate",
    "Unit 2nd Floor at 108 Jackson Avenue already has rent entered in the ledger dated in September 2026. Check it on the Ledger page before adding another payment.",
  );
  await L.updateOne(s4.ctx, ORG, { entryId: octRow._id, receivedDate: "2026-10-09" }, TODAY, s4.deps);
  assert.equal(octRow.date, "2026-10-09", "moving within the same month is fine");
});

test("MEDIUM-1: two rent payments for different rent months received in the same month are allowed", async () => {
  // a tenant pays November and December rent on 11/28: both land on the November statement, which is right
  const s = setup();
  await mark(s, { unitId: "u10", month: "2026-11", receivedDate: "2026-11-10" });
  await mark(s, { unitId: "u10", month: "2026-12", receivedDate: "2026-11-10" });
  assert.deepStrictEqual(
    payments(s.t)
      .filter((e) => e.unitId === "u10")
      .map((e) => [e.rentForMonth, e.date]),
    [
      ["2026-11", "2026-11-10"],
      ["2026-12", "2026-11-10"],
    ],
  );
  // and in bulk
  await L.markMany(s.ctx, ORG, { unitIds: ["u1"], month: "2026-11", receivedDate: "2026-11-10", method: "cash" }, TODAY, s.deps);
  await L.markMany(s.ctx, ORG, { unitIds: ["u1"], month: "2026-12", receivedDate: "2026-11-10", method: "cash" }, TODAY, s.deps);
  // moving a payment's date into a month that has another payment is fine too
  const dec = payments(s.t).find((e) => e.unitId === "u10" && e.rentForMonth === "2026-12");
  await L.updateOne(s.ctx, ORG, { entryId: dec._id, receivedDate: "2026-10-30" }, TODAY, s.deps);
  assert.equal(dec.date, "2026-10-30");
  // still at most one per unit per rent month
  await refused(mark(s, { unitId: "u10", month: "2026-12", receivedDate: "2026-11-11" }), "unitId", "Unit 10 at 108 Jackson Avenue already has rent marked received for December 2026.");
});

test("LOW-1: rent months before the owner's first statement month, or more than 24 months ago, can't be marked", async () => {
  const s = setup();
  // 108 Jackson starts in September 2026
  await refused(mark(s, { month: "2026-08", receivedDate: "2026-09-02" }), "month", "Statements for 108 Jackson Avenue start in September 2026.");
  assert.equal(R.RENT_PAY_MSG.monthBeforeStart(J, "2026-09"), "Statements for 108 Jackson Avenue start in September 2026.");
  // 2 Jackson (no start month): any month in range
  await mark(s, { unitId: "u12", month: "2026-08", receivedDate: "2026-08-15" });
  // 24 months back is the oldest (November 2024 when today is 11/12/2026)
  assert.equal(R.earliestRentMonth(TODAY), "2024-11");
  assert.equal(R.markRentMonthProblem("2024-11", TODAY), null);
  assert.equal(R.markRentMonthProblem("2024-10", TODAY), "You can't mark rent for October 2024 — it's more than 24 months ago.");
  await refused(mark(s, { unitId: "u12", month: "2024-10", receivedDate: "2024-10-05" }), "month", "You can't mark rent for October 2024 — it's more than 24 months ago.");
  assert.deepStrictEqual(R.validatePaymentFieldsAll({ month: "2020-01", receivedDate: "", method: "", today: TODAY }), {
    month: "You can't mark rent for January 2020 — it's more than 24 months ago.",
    method: "Select how the rent was paid.",
  });
  // ...but an old month can still be VIEWED (links from old statements open it), read-only
  const old = await L.listPayments(s.ctx, ORG, { month: "2024-01" }, TODAY);
  assert.equal(old.monthClosed, "You can't mark rent for January 2024 — it's more than 24 months ago.");
  assert.equal(old.rows.some((r) => r.canMark), false);
  assert.equal((await L.listPayments(s.ctx, ORG, { month: "2026-10" }, TODAY)).monthClosed, null);
  // the list greys out months before the first statement month (not "unpaid")
  const aug = await L.listPayments(s.ctx, ORG, { month: "2026-08", propertyId: "p1" }, TODAY);
  const u1 = aug.rows.find((r) => r.unitId === "u1");
  assert.deepStrictEqual([u1.status, u1.reason, u1.canMark], ["not_markable", "Statements start in September 2026", false]);
  assert.equal(aug.summary.unpaid, 0);
});

test("LOW-4: a date edit after the property changed owners says so (not 'has no owner yet')", async () => {
  const s = setup();
  await mark(s);
  const id = payments(s.t)[0]._id;
  s.t.ownerProperties.find((l) => l._id === "l1").ownerId = "o3";
  await refused(
    L.updateOne(s.ctx, ORG, { entryId: id, receivedDate: "2026-10-05" }, TODAY, s.deps),
    "receivedDate",
    "108 Jackson Avenue now belongs to a different owner, so this payment's date can't be changed. Undo it and mark it again.",
  );
  // no owner at all keeps the no-owner message
  s.t.ownerProperties = s.t.ownerProperties.filter((l) => l._id !== "l1");
  await refused(
    L.updateOne(s.ctx, ORG, { entryId: id, receivedDate: "2026-10-05" }, TODAY, s.deps),
    "receivedDate",
    "108 Jackson Avenue has no owner yet. Link it on the Owners page first.",
  );
});

test("LOW-5: lockedThrough reads only the newest final (index order), whatever order the rows were written in", async () => {
  const osp = [
    { _id: "f_oct", orgId: "org1", statementId: "s_oct", ownerId: "o1", propertyId: "p1", month: "2026-10", status: "final" },
    { _id: "f_sep", orgId: "org1", statementId: "s_sep", ownerId: "o1", propertyId: "p1", month: "2026-09", status: "final" },
  ];
  const s = setup({ osp });
  await refused(
    mark(s, { month: "2026-11", receivedDate: "2026-10-30" }),
    "receivedDate",
    "October 2026 is final for 108 Jackson Avenue. Use a received date in November 2026 or later.",
  );
  const lib = read("rentPaymentsLib.ts");
  assert.match(lib, /\.eq\("status", "final"\)\)\s*\.order\("desc"\)\s*\.first\(\)/);
});

test("LOW-3: a team / owner / property filter reads only those properties' units (the 3,000 cap applies after it)", async () => {
  const s = setup();
  const gold = await L.listPayments(s.ctx, ORG, { month: "2026-10", category: "gold" }, TODAY);
  assert.deepStrictEqual(gold.rows.map((r) => r.unitId).sort(), ["u1", "u10", "u12", "u2", "u3", "u4", "u5", "u6", "u8", "u9"].sort());
  assert.equal(gold.truncated, false);
  assert.equal(gold.maxUnits, 3000);
  // the filter choices list every property / owner, not only the filtered rows
  const one = await L.listPayments(s.ctx, ORG, { month: "2026-10", propertyId: "p2" }, TODAY);
  assert.deepStrictEqual(one.rows.map((r) => r.unitId), ["u7"]);
  assert.deepStrictEqual(one.filters.properties.map((p) => p.propertyId), ["p4", "p1", "p2", "p3"]);
  assert.deepStrictEqual(one.filters.owners.map((o) => o.ownerId), ["o2", "o1"]);
  const lib = read("rentPaymentsLib.ts");
  assert.match(lib, /withIndex\("by_property", \(q\) => q\.eq\("propertyId", p\._id\)\)/);
});

// =================================================================================================
// Part 3: the statement (rosBuild): no prefill; rent payments flow like any ledger row
// =================================================================================================

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
// The golden units, WITH roster rent and tenants (as the roster import writes them).
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
const pay = (id, received, unitId, rentForMonth, counterparty, amountCents, extra = {}) =>
  entry(id, received, unitId, "a_rent", counterparty, "Payment", amountCents, { source: "rent_payment", rentForMonth, ...extra });
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
  const month = over.month ?? "2026-09";
  const end = { "2026-09": "2026-09-30", "2026-10": "2026-10-31", "2026-11": "2026-11-30" }[month];
  return {
    statement: {
      _id: "s1",
      ownerId: "o1",
      month,
      periodStart: `${month}-01`,
      periodEnd: end,
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
        property: { name: J },
        links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0, startMonth: "2026-09" }],
        linkOwnerNames: ["Nye Properties LLC"],
        prevFinalEndingCents: month === "2026-09" ? null : 0,
        hasAnyFinal: month !== "2026-09",
        units: GOLDEN_UNITS,
        residents: GOLDEN_RESIDENTS,
        entries: GOLDEN_ENTRIES,
        workOrders: [],
        ...(over.property ?? {}),
      },
    ],
    statementDate: over.statementDate ?? "2026-11-12",
  };
}

// A building whose rent is NOT entered by hand: two occupied units.
const RENT_UNITS = [
  { _id: "u4", unitNumber: "4A", rent: 950.87, rentPaidTo: "company" },
  { _id: "u5", unitNumber: "4B", rent: 1200 },
];
const RENT_RESIDENTS = [
  { unitId: "u4", fullName: "Bob Ray", active: true },
  { unitId: "u4", fullName: "Ann Lee", active: true },
  { unitId: "u5", fullName: "Cara Diaz", active: true },
];
const rentData = (over = {}) =>
  data({ ...over, property: { units: RENT_UNITS, residents: RENT_RESIDENTS, entries: [], ...(over.property ?? {}) } });

const warn = (built, code) => built.warnings.filter((w) => w.code === code);

test("the draft no longer prefills rent from the roster: no rent lines, no rent confirmation, no roster warnings", () => {
  const built = B.assembleStatement(rentData());
  assert.deepStrictEqual(built.lines.filter((l) => l.accountId === "a_rent"), []);
  assert.deepStrictEqual(built.lines.map((l) => l.kind).filter((k) => k === "rent"), []);
  assert.equal(built.result.summary.income.total, 0);
  for (const code of ["RENT_NOT_CHECKED", "RENT_INVALID", "RENT_ACCOUNT_MISSING"]) assert.deepStrictEqual(warn(built, code), [], code);
  assert.equal("rent" in built, false);
  // old stored roster-rent state on a draft (overrides, confirmation, a removed line) is ignored
  const legacy = B.assembleStatement(
    rentData({ statement: { rentOverrides: [{ unitId: "u4", amountCents: 1 }], rentCheckedAt: 1, rentCheckedHash: "x", excludedKeys: ["rent:u4"] } }),
  );
  assert.deepStrictEqual(legacy.result, built.result);
  // the Rent Income account missing raises nothing rent-specific any more
  assert.deepStrictEqual(warn(B.assembleStatement(rentData({ accounts: ACCOUNTS.filter((a) => a._id !== "a_rent") })), "RENT_ACCOUNT_MISSING"), []);
});

test("RENT_UNPAID (info only): units with markable rent and nothing recorded, per rent month, with the month for the link", () => {
  const built = B.assembleStatement(rentData());
  assert.deepStrictEqual(warn(built, "RENT_UNPAID"), [
    { code: "RENT_UNPAID", rentMonth: "2026-09", message: "2 units have no rent marked received for September 2026.", blocking: false },
  ]);
  assert.deepStrictEqual(built.warnings.filter((w) => w.blocking), []);
  // one marked (rentRecords from the loader) -> 1 unit
  const one = B.assembleStatement(rentData({ property: { rentRecords: [pay("q1", "2026-09-05", "u4", "2026-09", "Ann Lee & Bob Ray", 95087)] } }));
  assert.equal(warn(one, "RENT_UNPAID")[0].message, "1 unit has no rent marked received for September 2026.");
  // greyed-out units never count
  const grey = B.assembleStatement(
    rentData({ property: { units: [{ ...RENT_UNITS[0], rentPaidTo: "owner_direct" }, { ...RENT_UNITS[1], occupancy: "vacant" }] } }),
  );
  assert.deepStrictEqual(warn(grey, "RENT_UNPAID"), []);
  // up to two months back, never before the first statement month (2026-09 here); oldest first
  const nov = B.assembleStatement(rentData({ month: "2026-11", property: { rentRecords: [pay("q2", "2026-10-02", "u4", "2026-10", "A", 95087)] } }));
  assert.deepStrictEqual(warn(nov, "RENT_UNPAID").map((w) => [w.rentMonth, w.message]), [
    ["2026-09", "2 units have no rent marked received for September 2026."],
    ["2026-10", "1 unit has no rent marked received for October 2026."],
    ["2026-11", "2 units have no rent marked received for November 2026."],
  ]);
  // splitWarnings passes the month to the UI
  assert.deepStrictEqual(B.splitWarnings(warn(built, "RENT_UNPAID")).info[0].rentMonth, "2026-09");
  // a final statement view raises none (isDraft false)
  assert.deepStrictEqual(warn(B.assembleStatement(rentData(), false), "RENT_UNPAID"), []);
});

test("GOLDEN: 108 Jackson September (rent entered by hand) is byte-for-byte the same statement; its rent counts as recorded", () => {
  const withRoster = B.assembleStatement(data());
  const noRoster = (u) => Object.fromEntries(Object.entries(u).filter(([k]) => k !== "rent" && k !== "rentPaidTo"));
  const without = B.assembleStatement(data({ property: { units: GOLDEN_UNITS.map(noRoster), residents: [] } }));
  assert.deepStrictEqual(withRoster.result, without.result);
  assert.equal(B.resultHash(withRoster.result), B.resultHash(without.result));
  assert.equal(withRoster.result.summary.income.total, 433387);
  assert.equal(withRoster.result.generated[0].fee.amountCents, 21669);
  assert.deepStrictEqual(warn(withRoster, "RENT_UNPAID"), [], "rent entered by hand in the ledger counts as received");
  // hand-entered Rent Income rows stay on the statement, flagged so the UI offers no Edit
  const r1 = withRoster.lines.find((l) => l.key === "entry:r1");
  assert.deepStrictEqual([r1.sourceLabel, r1.editable, r1.onRentAccount, r1.rentForMonth], ["Manual", true, true, undefined]);
  assert.equal(withRoster.lines.find((l) => l.key === "entry:e1").onRentAccount, undefined);
});

test("cash basis: September rent received 10/2 is on the OCTOBER statement, not September's", () => {
  const late = pay("q_late", "2026-10-02", "u5", "2026-09", "Cara Diaz", 120000);
  const sep = B.assembleStatement(rentData({ property: { entries: [late], rentRecords: [late] } }));
  assert.equal(sep.lines.some((l) => l.key === "entry:q_late"), false);
  assert.equal(sep.result.summary.income.total, 0);
  // ...but September's rent for 4B counts as received (no RENT_UNPAID for it)
  assert.equal(warn(sep, "RENT_UNPAID")[0].message, "1 unit has no rent marked received for September 2026.");

  const oct = B.assembleStatement(rentData({ month: "2026-10", property: { entries: [late], rentRecords: [late] } }));
  const line = oct.lines.find((l) => l.key === "entry:q_late");
  assert.deepStrictEqual(
    [line.kind, line.date, line.unit, line.name, line.memo, line.amountCents, line.accountName, line.sourceLabel, line.rentForMonth, line.editable, line.onRentAccount],
    ["entry", "2026-10-02", "4B", "Unit 4B - Cara Diaz", "Payment", 120000, "Rent Income", "Payments page", "2026-09", false, true],
  );
  assert.equal(oct.result.summary.income.total, 120000);
  assert.equal(oct.result.generated[0].fee.baseCents, 120000);
  // UI rules for that line: read-only, link to the Payments page, no Leave off / Delete / Edit
  assert.equal(LL.isRentPaymentLine(line), true);
  assert.equal(LL.canLeaveOffLine(line), false);
  assert.equal(LL.canDeleteLine(line), false);
  assert.equal(LL.canEditEntryLine(line), false);
  assert.equal(LL.paymentsPageHref(line), "/payments?month=2026-09&property=p1");
  // a hand-entered Rent Income line: Delete and Leave off, but no Edit
  const legacyLine = { kind: "entry", editable: true, entryId: "r1", onRentAccount: true, date: "2026-09-01", storedDate: "2026-09-01", carriedForward: false };
  assert.deepStrictEqual([LL.canEditEntryLine(legacyLine), LL.canDeleteLine(legacyLine), LL.canLeaveOffLine(legacyLine)], [false, true, true]);
});

test("fee base: a rent payment counts exactly like a hand-entered Rent Income row of the same amount", () => {
  const paid = B.assembleStatement(
    rentData({ property: { entries: [pay("q4", "2026-09-01", "u4", "2026-09", "Ann Lee & Bob Ray", 95087), pay("q5", "2026-09-03", "u5", "2026-09", "Cara Diaz", 120000)] } }),
  );
  const manual = B.assembleStatement(
    rentData({
      property: {
        entries: [
          entry("m4", "2026-09-01", "u4", "a_rent", "Ann Lee & Bob Ray", "Payment", 95087),
          entry("m5", "2026-09-03", "u5", "a_rent", "Cara Diaz", "Payment", 120000),
        ],
      },
    }),
  );
  assert.equal(paid.result.generated[0].fee.baseCents, 215087);
  assert.equal(paid.result.generated[0].fee.amountCents, percentOf(215087, 500));
  assert.deepStrictEqual(paid.result.summary, manual.result.summary);
  assert.deepStrictEqual(paid.result.incomeStatement, manual.result.incomeStatement);
});

test("finalize: a rent payment is billed ONCE (stamped like a manual row); no roster_rent row is ever written", () => {
  const q = pay("q1", "2026-10-02", "u4", "2026-10", "Ann Lee & Bob Ray", 95087);
  const built = B.assembleStatement(rentData({ month: "2026-10", property: { entries: [q] } }), true);
  const plan = B.finalizePlan(built, "s_oct");
  assert.deepStrictEqual(Object.keys(plan).sort(), ["entryIds", "entryPosts", "generatedRows", "woRows"]);
  assert.deepStrictEqual(plan.entryPosts, [{ entryId: "q1", postedDate: "2026-10-02" }]);
  assert.deepStrictEqual(plan.generatedRows.map((r) => r.source).sort(), ["management_fee", "owner_draw"]);
  // after finalize the row is billed: the next draft doesn't pick it up again
  const nov = B.assembleStatement(rentData({ month: "2026-11", property: { entries: [{ ...q, statementId: "s_oct", postedDate: "2026-10-02" }] } }));
  assert.equal(nov.lines.some((l) => l.key === "entry:q1"), false);
  // a payment left off by default (dated before the first statement month) can be put back, so finalize stamps it then
  const early = pay("q0", "2026-08-28", "u5", "2026-09", "Cara Diaz", 120000);
  const sep = B.assembleStatement(rentData({ property: { entries: [early] } }));
  assert.equal(sep.excludedLines.find((l) => l.key === "entry:q0").defaultExcluded, true);
  const back = B.assembleStatement(rentData({ statement: { includedKeys: ["entry:q0"] }, property: { entries: [early] } }));
  assert.deepStrictEqual(B.finalizePlan(back, "s1").entryPosts, [{ entryId: "q0", postedDate: "2026-09-01" }]);
});

test("final statements: a billed rent payment maps back to its line ('Payments page'); an old roster_rent row still reads 'Roster rent'", () => {
  const q = pay("q1", "2026-10-02", "u4", "2026-09", "Ann Lee & Bob Ray", 95087);
  const built = B.assembleStatement(rentData({ month: "2026-10", property: { entries: [q] } }), false);
  const snap = JSON.parse(JSON.stringify(B.makeSnapshot(OWNER, built.result, "2026-11-02")));
  const lines = B.linesFromSnapshot(
    snap,
    [{ _id: "q1", propertyId: "p1", unitId: "u4", accountId: "a_rent", counterparty: "Ann Lee & Bob Ray", source: "rent_payment", rentForMonth: "2026-09" }],
    {},
  );
  const l = lines.find((x) => x.key === "entry:q1");
  assert.deepStrictEqual([l.kind, l.sourceLabel, l.entryId, l.rentForMonth, l.editable], ["entry", "Payments page", "q1", "2026-09", false]);
  assert.equal(B.entrySourceLabel("rent_payment"), "Payments page");
  // historical: a roster_rent row billed before 2026-11-12
  assert.equal(B.keyOfBilledRow({ _id: "L1", propertyId: "p1", unitId: "u4", accountId: "a_rent", counterparty: "x", source: "roster_rent", sourceId: "s0:u4" }), "rent:u4");
  assert.equal(B.entrySourceLabel("roster_rent"), "Roster rent");
});

// =================================================================================================
// Part 4: server wiring (source scan; the registered handlers need Convex to run)
// =================================================================================================

test("server: rent_payment source + payment fields + indexes; roster_rent kept valid for history", () => {
  const val = read("rosValidators.ts");
  assert.match(val, /v\.literal\("rent_payment"\)/);
  assert.match(val, /v\.literal\("roster_rent"\)/);
  assert.match(val, /paymentMethodValidator = v\.union\(\s*v\.literal\("cash"\),\s*v\.literal\("check"\),\s*v\.literal\("money_order"\),\s*v\.literal\("other"\),?\s*\)/);
  assert.match(read("rosCalc.ts"), /\| "rent_payment"/);
  const schema = read("schema.ts");
  for (const f of ["rentForMonth: v.optional(v.string())", "paymentMethod: v.optional(paymentMethodValidator)", "paymentNote: v.optional(v.string())"]) assert.ok(schema.includes(f), f);
  assert.match(schema, /\.index\("by_unit_and_rent_month", \["unitId", "rentForMonth"\]\)/);
  assert.match(schema, /\.index\("by_org_and_rent_month", \["orgId", "rentForMonth"\]\)/);
  assert.match(schema, /\.index\("by_unit_and_date", \["unitId", "date"\]\)/);
  // the deprecated statement fields stay (optional) so existing rows remain valid
  for (const f of ["rentOverrides: v.optional(", "rentCheckedAt: v.optional(", "rentCheckedHash: v.optional("]) assert.ok(schema.includes(f), f);
});

test("server: the roster prefill is gone from statements; the old rent mutations refuse; payments can't be left off", () => {
  const os = read("ownerStatements.ts");
  for (const fn of ["setRentLine", "confirmRent"]) {
    const body = os.slice(os.indexOf(`export const ${fn} = mutation(`));
    const end = body.indexOf("\nexport ", 10);
    const src = body.slice(0, end);
    assert.match(src, /await requireFinance\(ctx\);\s*throw new ConvexError\(RENT_PAY_MSG\.onPaymentsPage\);/, fn);
  }
  assert.equal(read("rentPaymentsPolicy.ts").includes('onPaymentsPage: "Rent is recorded on the Payments page."'), true);
  const fin = os.slice(os.indexOf("export const finalize"));
  assert.doesNotMatch(fin, /roster_rent/);
  assert.doesNotMatch(fin, /rentRows/);
  const toggle = os.slice(os.indexOf("async function toggleLine"), os.indexOf("const lineArgs"));
  assert.match(toggle, /\^\(entry\|wo\):/);
  assert.match(toggle, /origin\.source === "rent_payment" && line\.defaultExcluded !== true/);
  assert.match(toggle, /RENT_PAY_MSG\.leaveOffRefused/);
  assert.doesNotMatch(os, /clearRentCheck/);
  const build = read("rosBuild.ts");
  assert.doesNotMatch(build, /RENT_NOT_CHECKED|RENT_INVALID|RENT_ACCOUNT_MISSING|rentPrefillDecision|source: "roster_rent"/);
});

test("server: the manual ledger refuses Rent Income; payments are changed only through rentPayments", () => {
  const ledger = read("ledger.ts");
  assert.doesNotMatch(ledger, /clearRentCheckForProperty/);
  // add / update go through validateEntryFields with the account doc (systemKey "rent_income" is refused)
  assert.match(ledger, /const checked = validateEntryFields\(\{[\s\S]*?account,[\s\S]*?\}\);/);
  // the ledger's edit / delete is for manual rows only, so a rent payment can't be changed there
  assert.match(ledger, /if \(entry\.source !== "manual"\) throw fieldError\("entryId", ENTRY_MSG\.notManual\);/);
  const rp = read("rentPayments.ts");
  for (const fn of ["list", "markReceived", "markManyReceived", "updatePayment", "undoPayment"]) {
    assert.match(rp, new RegExp(`export const ${fn} = (query|mutation)\\(`), fn);
  }
  // the client never sends an amount
  assert.doesNotMatch(rp, /amountCents: v\./);
  const lib = read("rentPaymentsLib.ts");
  assert.match(lib, /amountCents: plan\.amountCents/);
  assert.match(lib, /withIndex\("by_unit_and_rent_month", \(q\) => q\.eq\("unitId", unit\._id\)\.eq\("rentForMonth", month\)\)/);
});

test("which statement a payment lands on: the month it was RECEIVED (cash basis)", () => {
  assert.equal(R.statementMonthFor("2026-11-12"), "2026-11");
  assert.equal(R.landsOnText("2026-11-12"), "Goes on the November 2026 statement (the month it was received).");
  assert.equal(R.landsOnText(""), null);
  assert.equal(R.landsOnText("2026-02-30"), null);
  assert.equal(R.landsOnShort("2026-10-02"), "→ Oct 2026 statement");
  // the same helper the server's cash basis uses: a payment dated 11/12 is on November's draft, not October's
  const nov = pay("q_nov", "2026-11-12", "u4", "2026-11", "Ann Lee & Bob Ray", 95087);
  const oct = B.assembleStatement(rentData({ month: "2026-10", property: { entries: [nov] } }));
  assert.equal(oct.lines.some((l) => l.key === "entry:q_nov"), false);
  const novSt = B.assembleStatement(rentData({ month: "2026-11", property: { entries: [nov] } }));
  assert.equal(novSt.lines.some((l) => l.key === "entry:q_nov"), true);
});

test("MEDIUM-2: a rent payment left off by default (before the first statement month) raises RENT_PAYMENT_BEFORE_START (info)", async () => {
  const early = pay("q0", "2026-08-28", "u5", "2026-09", "Cara Diaz", 120000);
  const early2 = pay("q00", "2026-08-30", "u4", "2026-09", "Ann Lee & Bob Ray", 95087);
  const sep = B.assembleStatement(rentData({ property: { entries: [early2, early] } }));
  assert.deepStrictEqual(warn(sep, "RENT_PAYMENT_BEFORE_START"), [
    {
      code: "RENT_PAYMENT_BEFORE_START",
      propertyId: "p1",
      message:
        "2 rent payments received before this owner's first statement month (September 2026) are left off this statement: Unit 4B, 8/28/2026; Unit 4A, 8/30/2026 (108 Jackson Avenue). Put them back from “Left off this statement” only if they weren't billed in Buildium.",
      blocking: false,
    },
  ]);
  // put one back: the warning lists only the one still off
  const one = B.assembleStatement(rentData({ statement: { includedKeys: ["entry:q00"] }, property: { entries: [early2, early] } }));
  assert.equal(
    warn(one, "RENT_PAYMENT_BEFORE_START")[0].message,
    "A rent payment received before this owner's first statement month (September 2026) is left off this statement: Unit 4B, 8/28/2026 (108 Jackson Avenue). Put it back from “Left off this statement” only if it wasn't billed in Buildium.",
  );
  // both put back: no warning
  const none = B.assembleStatement(rentData({ statement: { includedKeys: ["entry:q00", "entry:q0"] }, property: { entries: [early2, early] } }));
  assert.deepStrictEqual(warn(none, "RENT_PAYMENT_BEFORE_START"), []);
  // no start month set: the statement month is the floor
  const noStart = B.assembleStatement(
    rentData({ property: { links: [{ _id: "l1", ownerId: "o1", openingBalanceCents: 0 }], entries: [early] } }),
  );
  assert.match(warn(noStart, "RENT_PAYMENT_BEFORE_START")[0].message, /first statement month \(September 2026\)/);
  // a hand-entered row before the start month keeps its own handling (no rent-payment warning)
  const manual = B.assembleStatement(rentData({ property: { entries: [entry("m0", "2026-08-28", "u5", "a_rent", "Cara Diaz", "Payment", 120000)] } }));
  assert.deepStrictEqual(warn(manual, "RENT_PAYMENT_BEFORE_START"), []);
  // it links to the statement's "Left off this statement" card
  const WL = await import("../../components/finance/warning-links.ts");
  assert.deepStrictEqual(WL.warningTarget(B.splitWarnings(warn(sep, "RENT_PAYMENT_BEFORE_START")).info[0], "o1"), {
    kind: "scroll",
    anchor: "left-off",
    label: "Show left-off lines →",
  });
});

test("LOW-2: the ledger refuses ANY edit of a row whose current account is Rent Income (Delete only)", () => {
  const msg = "Rent can't be moved to another account. Delete it and record it on the Payments page.";
  assert.equal(P.entryEditProblem({ systemKey: "rent_income" }), msg);
  assert.equal(P.ENTRY_MSG.rentRowLocked, msg);
  for (const ok of [{ systemKey: "repairs" }, { systemKey: null }, {}, null]) assert.equal(P.entryEditProblem(ok), null);
  const ledger = read("ledger.ts");
  const update = ledger.slice(ledger.indexOf("export const update = mutation("), ledger.indexOf("export const voidEntry"));
  // checked on the row's CURRENT account, before any field (even a memo-only change) is applied
  assert.match(
    update,
    /loadForChange\(entry\);\s*\/\/[^\n]*\n\s*const rentProblem = entryEditProblem\(await ctx\.db\.get\(entry\.accountId\)\);\s*if \(rentProblem\) throw fieldError\("accountId", rentProblem\);/,
  );
  // Delete (voidEntry) stays allowed
  assert.doesNotMatch(ledger.slice(ledger.indexOf("export const voidEntry")), /entryEditProblem/);
});

// =================================================================================================
// Payments page grouping (components/finance/payments-search.ts): pages count buildings
// =================================================================================================

test("Payments page: rows grouped by building in list order, greyed-out units split off, never split by paging", async () => {
  const S = await import("../../components/finance/payments-search.ts");
  const PG = await import("../../components/ui/pagination-model.ts");
  const row = (unitId, propertyId, status, reason = null) => ({ unitId, propertyId, status, reason, canMark: status === "unpaid" });
  const rows = [
    row("a1", "pA", "paid"),
    row("a2", "pA", "unpaid"),
    row("a3", "pA", "not_markable", "Vacant on the roster"),
    row("a4", "pA", "not_markable", "Owner collects rent directly"),
    row("a5", "pA", "not_markable", "Vacant on the roster"),
    row("b1", "pB", "unpaid"),
    row("c1", "pC", "not_markable", "Statements start in September 2026"),
  ];
  const groups = S.groupByProperty(rows);
  assert.deepStrictEqual(groups.map((g) => g.propertyId), ["pA", "pB", "pC"]);
  assert.deepStrictEqual(groups[0].active.map((r) => r.unitId), ["a1", "a2"]);
  assert.deepStrictEqual(groups[0].notMarkable.map((r) => r.unitId), ["a3", "a4", "a5"]);
  assert.equal(groups[2].active.length, 0);
  // distinct reasons, first letter lower-cased only (month names keep their capital)
  assert.equal(S.reasonsSummary(groups[0].notMarkable), "vacant on the roster, owner collects rent directly");
  assert.equal(S.reasonsSummary(groups[2].notMarkable), "statements start in September 2026");
  // "x of y paid" leaves greyed-out units out
  const prog = S.paidProgressByProperty(rows);
  assert.deepStrictEqual(prog.get("pA"), { paid: 1, due: 2 });
  assert.deepStrictEqual(prog.get("pB"), { paid: 0, due: 1 });
  assert.equal(prog.get("pC"), undefined);
  // paging by building: 2 buildings per page keeps every unit of a building together
  const p1 = PG.paginate(groups, 1, 2);
  assert.deepStrictEqual(p1.rows.flatMap((g) => g.rows).map((r) => r.unitId), ["a1", "a2", "a3", "a4", "a5", "b1"]);
  assert.equal(p1.total, 3);
  assert.deepStrictEqual(S.selectableOnPage(p1.rows.flatMap((g) => g.rows), 100), ["a2", "b1"]);
  // page sizes count buildings
  assert.deepStrictEqual(S.BUILDING_PAGE_SIZES, [10, 25, 50]);
  assert.equal(PG.readPageSize("25", S.BUILDING_PAGE_SIZES, S.DEFAULT_BUILDING_PAGE_SIZE), 25);
  assert.equal(PG.readPageSize("100", S.BUILDING_PAGE_SIZES, S.DEFAULT_BUILDING_PAGE_SIZE), 10);
});
