// Unit tests for convex/rosPolicy.ts (ROS rules: draft creation, period locks, work-order selection,
// finalize timing and the shared field validators). No packages. From dashboard/:
//   node --test scripts/probes/ros_policy.test.mjs
// Spec: docs/specs/ros-build-spec.md 4.4, 5.2, 5.3, 5.6, 5.8 and 9.2. All names are invented.
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
const { monthStart, nextMonth } = await import("../../convex/rosFormat.ts");

const MISSING = ["", null, undefined, "   "];

test("row types, kind labels, finance views", () => {
  assert.deepStrictEqual([...P.ADDITION_TYPES], ["income", "owner_contribution", "other_addition"]);
  assert.deepStrictEqual([...P.SUBTRACTION_TYPES], ["expense", "owner_draw", "other_subtraction"]);
  assert.equal(P.MAX_STATEMENT_LINES, 2000);
  assert.deepStrictEqual(P.KIND_LABELS, {
    income: "Income",
    expense: "Expense",
    owner_contribution: "Owner contribution",
    other_addition: "Other addition",
    other_subtraction: "Other subtraction",
    owner_draw: "Owner draw",
  });
  assert.equal(P.canUseFinanceView("admin"), true);
  assert.equal(P.canUseFinanceView("accountant"), true);
  for (const v of ["asset_manager", "technician", "none", ""]) assert.equal(P.canUseFinanceView(v), false, v);
});

test("sortProperties: natural name order, then id", () => {
  const out = P.sortProperties([
    { id: "c", name: "108 Jackson Avenue" },
    { id: "b", name: "12 B St" },
    { id: "z", name: "9 A St" },
    { id: "a", name: "9 a st" },
  ]);
  assert.deepStrictEqual(out.map((p) => p.id), ["a", "z", "b", "c"]);
});

// --- createDraftProblem ---------------------------------------------------------------------------

const TODAY = "2026-10-05";
const state = (o = {}) => ({
  id: "p1",
  name: "108 Jackson Avenue",
  ownerLinkCount: 1,
  linkedToThisOwner: true,
  coOwnerNames: ["Nye Properties LLC"],
  startMonth: null,
  finals: [],
  openDrafts: [],
  ...o,
});
const OWNER = "Nye Properties LLC";

test("createDraftProblem: OK cases", () => {
  assert.equal(P.createDraftProblem("2026-09", TODAY, state(), OWNER), null);
  assert.equal(P.createDraftProblem("2026-10", TODAY, state(), OWNER), null, "the current month may be drafted");
  assert.equal(P.createDraftProblem("2026-09", TODAY, state({ startMonth: "2026-09" }), OWNER), null);
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ finals: [{ month: "2026-08", ownerName: OWNER }], startMonth: "2026-07" }), OWNER),
    null,
  );
});

test("createDraftProblem: every rule, exact messages", () => {
  assert.equal(P.createDraftProblem("2026-11", TODAY, state(), OWNER), "You can't create a statement for a month that hasn't started.");
  assert.equal(P.createDraftProblem("2026-13", TODAY, state(), OWNER), "Select the statement month.");
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ linkedToThisOwner: false }), OWNER),
    "108 Jackson Avenue doesn't belong to Nye Properties LLC.",
  );
  assert.equal(
    P.createDraftProblem(
      "2026-09",
      TODAY,
      state({ name: "182 Remsen St", ownerLinkCount: 2, coOwnerNames: ["Remsen Holdings LLC", "Troy Rentals LLC"] }),
      "Remsen Holdings LLC",
    ),
    "182 Remsen St is listed under 2 owners (Remsen Holdings LLC, Troy Rentals LLC). Statements for it are paused until the ownership split is set.",
  );
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ openDrafts: [{ month: "2026-09", ownerName: OWNER }] }), OWNER),
    "108 Jackson Avenue already has a draft statement for September 2026 (Nye Properties LLC). Open it instead.",
  );
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ finals: [{ month: "2026-09", ownerName: "Old Owner LLC" }] }), OWNER),
    "108 Jackson Avenue already has a final statement for September 2026 (Old Owner LLC). Open it instead.",
  );
  assert.equal(
    P.createDraftProblem("2026-10", TODAY, state({ openDrafts: [{ month: "2026-09", ownerName: OWNER }] }), OWNER),
    "108 Jackson Avenue already has an open draft for September 2026. Finalize or discard it first.",
  );
  assert.equal(
    P.createDraftProblem("2026-08", TODAY, state({ finals: [{ month: "2026-09", ownerName: OWNER }] }), OWNER),
    "August 2026 is already final for 108 Jackson Avenue.",
  );
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ finals: [{ month: "2026-06", ownerName: OWNER }, { month: "2026-07", ownerName: OWNER }] }), OWNER),
    "108 Jackson Avenue has no final statement for August 2026. Generate and finalize that month first.",
  );
  assert.equal(
    P.createDraftProblem("2026-09", TODAY, state({ startMonth: "2026-08" }), OWNER),
    "Statements for 108 Jackson Avenue start in August 2026. Create that month first.",
  );
});

test("lockedThroughMonth and finalizeProblem", () => {
  assert.equal(P.lockedThroughMonth([]), null);
  assert.equal(P.lockedThroughMonth(["2026-07", "2026-09", "2026-08"]), "2026-09");
  assert.equal(P.lockedThroughMonth(["2025-12", "2026-01"]), "2026-01");
  assert.equal(P.finalizeProblem("2026-09", "2026-09-30"), "You can finalize September 2026 from 10/1/2026.");
  assert.equal(P.finalizeProblem("2026-09", "2026-10-01"), null);
  assert.equal(P.finalizeProblem("2026-12", "2026-12-31"), "You can finalize December 2026 from 1/1/2027.");
  assert.equal(P.finalizeProblem("2026-12", "2027-01-01"), null);
});

test("entryDateProblem", () => {
  const p = { name: "108 Jackson Avenue", lockedThrough: "2026-09", startMonth: "2026-08" };
  assert.equal(
    P.entryDateProblem("2026-09-15", "2026-10-20", p),
    "September 2026 is final for 108 Jackson Avenue. Date this transaction in October 2026 or later.",
  );
  assert.equal(P.entryDateProblem("2026-10-01", "2026-10-20", p), null);
  assert.equal(P.entryDateProblem("2026-10-20", "2026-10-20", p), null);
  assert.equal(P.entryDateProblem("2026-10-21", "2026-10-20", p), "The date can't be in the future.");
  assert.equal(
    P.entryDateProblem("2026-07-31", "2026-10-20", { name: "108 Jackson Avenue", lockedThrough: null, startMonth: "2026-08" }),
    "Statements for 108 Jackson Avenue start in August 2026. Use a date on or after 8/1/2026.",
  );
  assert.equal(P.entryDateProblem("2026-08-01", "2026-10-20", { name: "X", lockedThrough: null, startMonth: "2026-08" }), null);
  assert.equal(P.entryDateProblem("2020-01-01", "2026-10-20", { name: "X", lockedThrough: null, startMonth: null }), null);
});

test("5.8 message builders", () => {
  assert.equal(
    P.MSG.WO_MISSING_BILL(2051, "108 Jackson Avenue", "2nd Floor"),
    "WO-2051 (108 Jackson Avenue, Unit 2nd Floor) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.",
  );
  assert.equal(
    P.MSG.WO_MISSING_BILL(2051, "108 Jackson Avenue", null),
    "WO-2051 (108 Jackson Avenue) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.",
  );
  assert.equal(
    P.MSG.WO_AWAITING_REVIEW(2052, "108 Jackson Avenue", "2026-09-29"),
    "WO-2052 (108 Jackson Avenue) was completed on 9/29/2026 but hasn't been closed by the office yet. It will go on a later statement once closed.",
  );
  assert.equal(P.MSG.PRIOR_NOT_FINAL("108 Jackson Avenue", "2026-08"), "108 Jackson Avenue has no final statement for August 2026. Finalize that month first.");
  assert.equal(P.MSG.OWNER_CHANGED("108 Jackson Avenue", OWNER), "108 Jackson Avenue is no longer linked to Nye Properties LLC. Discard this draft and generate it again.");
  assert.equal(P.MSG.OPENING_BALANCE_NOT_SET("108 Jackson Avenue"), "The opening cash balance for 108 Jackson Avenue isn't set, so it starts at $0.00.");
  assert.equal(P.MSG.DEPOSITS_NOT_SET("108 Jackson Avenue"), "No security deposits are recorded for any unit at 108 Jackson Avenue.");
  assert.equal(P.MSG.ACCOUNTS_MISSING, "The account list isn't set up yet. Open Accounts once to create it.");
  assert.equal(P.MSG.TOO_MANY_LINES, "This statement has more than 2,000 transactions. Split it into fewer properties.");
  assert.equal(P.MSG.FEE_NOT_SET(OWNER), "Set the management fee % for Nye Properties LLC before finalizing.");
  assert.equal(P.MSG.PAYEE_MISSING(OWNER), "Set the owner draw payee for Nye Properties LLC before finalizing.");
});

// --- selectWorkOrders -----------------------------------------------------------------------------

const wo = (o = {}) => ({
  id: o.id ?? "w1",
  number: o.number ?? 2051,
  propertyId: "p1",
  unitLabel: "2nd Floor",
  status: "reviewed_closed",
  completedDate: "2026-09-12",
  billAmountCents: 190700,
  workCompletedDescription: "Fixed the ceiling",
  rosAccountId: "a_rep",
  ...o,
});
const ids = (list) => list.map((w) => w.id);

test("selectWorkOrders splits billable, missingBill and awaitingReview", () => {
  const all = [
    wo({ id: "ok" }),
    wo({ id: "billed", billedStatementId: "s1" }),
    wo({ id: "nocharge", noOwnerCharge: true, billAmountCents: undefined, rosAccountId: undefined }),
    wo({ id: "noamt", billAmountCents: undefined }),
    wo({ id: "zeroamt", billAmountCents: 0 }),
    wo({ id: "noacct", rosAccountId: undefined }),
    wo({ id: "nodesc", workCompletedDescription: "  " }),
    wo({ id: "completed", status: "completed", completedDate: "2026-09-29" }),
    wo({ id: "completedLate", status: "completed", completedDate: "2026-10-02" }),
    wo({ id: "beforeFloor", completedDate: "2026-07-31" }),
    wo({ id: "afterEnd", completedDate: "2026-10-01" }),
    wo({ id: "carried", completedDate: "2026-08-20" }),
    wo({ id: "inprogress", status: "in_progress" }),
    wo({ id: "cancelled", status: "cancelled" }),
    wo({ id: "nodate", completedDate: null }),
  ];
  const r = P.selectWorkOrders(all, "2026-09-30", "2026-08-01");
  assert.deepStrictEqual(ids(r.billable), ["carried", "ok"]);
  assert.deepStrictEqual(ids(r.missingBill).sort(), ["noacct", "noamt", "nodesc", "zeroamt"]);
  assert.deepStrictEqual(ids(r.awaitingReview), ["completed"]);
});

test("double-billing simulation: a billed WO never comes back; an excluded one carries to next month", () => {
  const wos = [wo({ id: "billMe", completedDate: "2026-09-12" }), wo({ id: "skipMe", number: 2060, completedDate: "2026-09-20" })];
  const floor = monthStart("2026-09");
  const sep = P.selectWorkOrders(wos, "2026-09-30", floor);
  assert.deepStrictEqual(ids(sep.billable), ["billMe", "skipMe"]);
  // finalize September with skipMe excluded: only billMe is marked billed
  const afterFinalize = wos.map((w) => (w.id === "billMe" ? { ...w, billedStatementId: "stmt_sep" } : w));
  const oct = P.selectWorkOrders(afterFinalize, "2026-10-31", floor);
  assert.deepStrictEqual(ids(oct.billable), ["skipMe"]);
  // and its effective date on October's statement is 10/1 (max(stored date, periodStart))
  const periodStart = monthStart(nextMonth("2026-09"));
  const eff = oct.billable[0].completedDate < periodStart ? periodStart : oct.billable[0].completedDate;
  assert.equal(eff, "2026-10-01");
});

// --- validateEntryFields ----------------------------------------------------------------------------

const entry = (o = {}) => ({
  propertyId: "p1",
  unitId: "u1",
  date: "2026-09-01",
  accountId: "a_rent",
  counterparty: "David Roberts",
  memo: "Payment",
  amount: "883.00",
  today: "2026-10-05",
  property: { name: "108 Jackson Avenue" },
  account: { name: "Rent Income", active: true },
  unitInProperty: true,
  ...o,
});

test("validateEntryFields: OK, from form text and from server cents", () => {
  assert.deepStrictEqual(P.validateEntryFields(entry()), {
    ok: true,
    value: {
      propertyId: "p1",
      unitId: "u1",
      date: "2026-09-01",
      accountId: "a_rent",
      counterparty: "David Roberts",
      memo: "Payment",
      amountCents: 88300,
    },
  });
  const server = P.validateEntryFields(entry({ amount: 88300, unitId: "", counterparty: "  David  ", memo: " Payment " }));
  assert.equal(server.ok, true);
  assert.equal(server.value.amountCents, 88300);
  assert.equal(server.value.unitId, null, "blank unit = Property level");
  assert.equal(server.value.counterparty, "David");
  for (const u of [null, undefined, ""]) assert.equal(P.validateEntryFields(entry({ unitId: u, unitInProperty: false })).ok, true);
});

test("validateEntryFields: every message", () => {
  const fail = (o) => {
    const r = P.validateEntryFields(entry(o));
    assert.equal(r.ok, false);
    return [r.field, r.message];
  };
  for (const m of MISSING) assert.deepStrictEqual(fail({ propertyId: m }), ["propertyId", "Select the property this transaction belongs to."]);
  assert.deepStrictEqual(fail({ property: null }), ["propertyId", "Select the property this transaction belongs to."]);
  assert.deepStrictEqual(fail({ unitInProperty: false }), ["unitId", "That unit isn't part of 108 Jackson Avenue."]);
  for (const m of MISSING) assert.deepStrictEqual(fail({ date: m }), ["date", "Enter the transaction date."]);
  assert.deepStrictEqual(fail({ date: "2026-02-30" }), ["date", "Enter a real date."]);
  assert.deepStrictEqual(fail({ date: "9/1/2026" }), ["date", "Enter a real date."]);
  assert.deepStrictEqual(fail({ date: "2026-10-06" }), ["date", "The date can't be in the future."]);
  for (const m of MISSING) assert.deepStrictEqual(fail({ accountId: m }), ["accountId", "Select the account for this transaction."]);
  assert.deepStrictEqual(fail({ account: null }), ["accountId", "Select the account for this transaction."]);
  assert.deepStrictEqual(fail({ account: { name: "Laundry Income", active: false } }), [
    "accountId",
    "The account “Laundry Income” is turned off. Pick another account.",
  ]);
  for (const m of MISSING) {
    assert.deepStrictEqual(fail({ counterparty: m }), ["counterparty", "Enter the name that prints on the statement (tenant, vendor or payee)."]);
  }
  assert.deepStrictEqual(fail({ counterparty: "x".repeat(121) }), ["counterparty", "Keep the name under 120 characters."]);
  assert.equal(P.validateEntryFields(entry({ counterparty: "x".repeat(120) })).ok, true);
  for (const m of MISSING) assert.deepStrictEqual(fail({ memo: m }), ["memo", "Enter a memo (it prints on the statement)."]);
  assert.deepStrictEqual(fail({ memo: "x".repeat(301) }), ["memo", "Keep the memo under 300 characters."]);
  for (const m of MISSING) assert.deepStrictEqual(fail({ amount: m }), ["amountCents", "Enter the amount."]);
  for (const bad of ["abc", "1.234", "-5", 10.5, NaN]) assert.deepStrictEqual(fail({ amount: bad }), ["amountCents", "Enter the amount like 1,250.00."]);
  for (const z of ["0", "0.00", 0, -100]) assert.deepStrictEqual(fail({ amount: z }), ["amountCents", "The amount must be more than $0.00."]);
  assert.deepStrictEqual(fail({ amount: "1,000,000.01" }), ["amountCents", "The amount can't be more than $1,000,000.00."]);
  assert.equal(P.validateEntryFields(entry({ amount: "1,000,000.00" })).ok, true);
});

test("validateEntryFields: first failing field in form order; All marks every field", () => {
  const raw = entry({ propertyId: "", date: "", accountId: null, counterparty: undefined, memo: "", amount: "" });
  const first = P.validateEntryFields(raw);
  assert.equal(first.field, "propertyId");
  assert.deepStrictEqual(P.validateEntryFieldsAll(raw), {
    propertyId: "Select the property this transaction belongs to.",
    date: "Enter the transaction date.",
    accountId: "Select the account for this transaction.",
    counterparty: "Enter the name that prints on the statement (tenant, vendor or payee).",
    memo: "Enter a memo (it prints on the statement).",
    amountCents: "Enter the amount.",
  });
  assert.deepStrictEqual(P.validateEntryFieldsAll(entry()), {});
});

// --- validateBillingFields --------------------------------------------------------------------------

const billing = (o = {}) => ({
  workCompletedDescription: "Replaced ceiling tiles",
  noOwnerCharge: false,
  billAmount: "395.00",
  cost: "245.00",
  rosAccountId: "a_rep",
  billPropertyLevel: false,
  account: { name: "Repairs", active: true, kind: "expense" },
  ...o,
});

test("validateBillingFields: OK and no-charge", () => {
  assert.deepStrictEqual(P.validateBillingFields(billing()), {
    ok: true,
    value: {
      workCompletedDescription: "Replaced ceiling tiles",
      noOwnerCharge: false,
      billAmountCents: 39500,
      costCents: 24500,
      rosAccountId: "a_rep",
      billPropertyLevel: false,
    },
  });
  const nc = P.validateBillingFields(billing({ noOwnerCharge: true, billAmount: "", rosAccountId: null, account: null, cost: "" }));
  assert.deepStrictEqual(nc, {
    ok: true,
    value: {
      workCompletedDescription: "Replaced ceiling tiles",
      noOwnerCharge: true,
      billAmountCents: null,
      costCents: null,
      rosAccountId: null,
      billPropertyLevel: false,
    },
  });
  const server = P.validateBillingFields(billing({ billAmount: 39500, cost: null, billPropertyLevel: true }));
  assert.equal(server.ok, true);
  assert.equal(server.value.costCents, null);
  assert.equal(server.value.billPropertyLevel, true);
  assert.equal(P.validateBillingFields(billing({ cost: "0" })).value.costCents, 0);
});

test("validateBillingFields: every message", () => {
  const fail = (o) => {
    const r = P.validateBillingFields(billing(o));
    assert.equal(r.ok, false);
    return [r.field, r.message];
  };
  for (const m of MISSING) {
    assert.deepStrictEqual(fail({ workCompletedDescription: m }), [
      "workCompletedDescription",
      "Describe the work completed (it prints on the owner statement).",
    ]);
  }
  assert.deepStrictEqual(fail({ workCompletedDescription: "x".repeat(2001) }), [
    "workCompletedDescription",
    "Keep the description under 2,000 characters.",
  ]);
  for (const m of MISSING) {
    assert.deepStrictEqual(fail({ billAmount: m }), [
      "billAmountCents",
      "Enter the bill amount (what the owner is charged), or tick “No charge to owner”.",
    ]);
  }
  for (const bad of ["abc", "3.999", 12.5]) assert.deepStrictEqual(fail({ billAmount: bad }), ["billAmountCents", "Enter the bill amount like 395.00."]);
  for (const z of ["0", 0, -1]) {
    assert.deepStrictEqual(fail({ billAmount: z }), [
      "billAmountCents",
      "The bill amount must be more than $0.00. Tick “No charge to owner” instead.",
    ]);
  }
  assert.deepStrictEqual(fail({ billAmount: 100000001 }), ["billAmountCents", "The bill amount can't be more than $1,000,000.00."]);
  for (const bad of ["abc", "-1", -1, 1.5, 100000001]) {
    assert.deepStrictEqual(fail({ cost: bad }), ["costCents", "Enter the cost like 245.00, or leave it blank."]);
  }
  for (const m of MISSING) assert.equal(P.validateBillingFields(billing({ cost: m })).ok, true, "cost is optional");
  for (const m of MISSING) {
    assert.deepStrictEqual(fail({ rosAccountId: m }), ["rosAccountId", "Select the account for this work order (usually Repairs)."]);
  }
  assert.deepStrictEqual(fail({ account: null }), ["rosAccountId", "Select the account for this work order (usually Repairs)."]);
  assert.deepStrictEqual(fail({ account: { name: "Old Repairs", active: false, kind: "expense" } }), [
    "rosAccountId",
    "The account “Old Repairs” is turned off. Pick another account.",
  ]);
  assert.deepStrictEqual(fail({ account: { name: "Rent Income", active: true, kind: "income" } }), [
    "rosAccountId",
    "Pick an expense account for a work order.",
  ]);
  const all = P.validateBillingFieldsAll(billing({ workCompletedDescription: "", billAmount: "", cost: "x", rosAccountId: "" }));
  assert.deepStrictEqual(Object.keys(all), ["workCompletedDescription", "billAmountCents", "costCents", "rosAccountId"]);
});

// --- validateOwnerFields ----------------------------------------------------------------------------

const owner = (o = {}) => ({
  mode: "create",
  legalName: "Nye Properties LLC",
  contactFirstName: "Adam",
  contactLastName: "Nye",
  emails: "Adam@Example.com, adam@example.com , second@example.org",
  payeeName: "",
  nameTaken: false,
  ...o,
});

test("validateOwnerFields: OK create and partial update", () => {
  assert.deepStrictEqual(P.validateOwnerFields(owner()), {
    ok: true,
    value: {
      legalName: "Nye Properties LLC",
      nameKey: "nye properties llc",
      contactFirstName: "Adam",
      contactLastName: "Nye",
      emails: ["adam@example.com", "second@example.org"],
      payeeName: null,
    },
  });
  // The management fee is no longer an owner field (per property since 2026-11-11): ignored here.
  assert.deepStrictEqual(P.validateOwnerFields({ mode: "update", managementFee: 1250 }), { ok: true, value: {} });
  assert.deepStrictEqual(P.validateOwnerFields({ mode: "update", payeeName: "", emails: [] }), { ok: true, value: { emails: [], payeeName: null } });
  assert.deepStrictEqual(P.validateOwnerFields(owner({ emails: undefined })).value.emails, []);
});

test("validateOwnerFields: every message", () => {
  const fail = (o) => {
    const r = P.validateOwnerFields(owner(o));
    assert.equal(r.ok, false);
    return [r.field, r.message];
  };
  for (const m of MISSING) {
    assert.deepStrictEqual(fail({ legalName: m }), ["legalName", "Enter the owner's legal name (the LLC or person the statement is for)."]);
  }
  assert.deepStrictEqual(fail({ mode: "update", legalName: "" }), ["legalName", "Enter the owner's legal name (the LLC or person the statement is for)."]);
  assert.deepStrictEqual(fail({ legalName: "x".repeat(161) }), ["legalName", "Keep the legal name under 160 characters."]);
  assert.deepStrictEqual(fail({ legalName: " Nye Properties LLC ", nameTaken: true }), ["legalName", "An owner named “Nye Properties LLC” already exists."]);
  assert.deepStrictEqual(fail({ contactFirstName: "x".repeat(81) }), ["contactFirstName", "Keep the name under 80 characters."]);
  assert.deepStrictEqual(fail({ contactLastName: "x".repeat(81) }), ["contactLastName", "Keep the name under 80 characters."]);
  assert.deepStrictEqual(fail({ emails: "good@example.com, not-an-email" }), ["emails", "“not-an-email” isn't a valid email address."]);
  assert.deepStrictEqual(fail({ emails: ["a b@example.com"] }), ["emails", "“a b@example.com” isn't a valid email address."]);
  assert.deepStrictEqual(fail({ emails: "a@x.co,b@x.co,c@x.co,d@x.co,e@x.co,f@x.co" }), ["emails", "Add at most 5 email addresses."]);
  // A blank fee no longer fails an owner (the fee is per property, default 5.00%).
  assert.equal(P.validateOwnerFields(owner({ managementFee: "" })).ok, true);
  assert.deepStrictEqual(fail({ payeeName: "x".repeat(121) }), ["payeeName", "Keep the payee name under 120 characters."]);
  const all = P.validateOwnerFieldsAll(owner({ legalName: "", emails: "bad", managementFee: "" }));
  assert.deepStrictEqual(Object.keys(all), ["legalName", "emails"]);
});

// --- validateAccountFields --------------------------------------------------------------------------

test("validateAccountFields", () => {
  assert.deepStrictEqual(P.validateAccountFields({ mode: "create", name: " Snow Removal ", kind: "expense" }), {
    ok: true,
    value: { name: "Snow Removal", nameKey: "snow removal", kind: "expense" },
  });
  const fail = (o) => {
    const r = P.validateAccountFields({ mode: "create", name: "Snow Removal", kind: "expense", ...o });
    assert.equal(r.ok, false);
    return [r.field, r.message];
  };
  for (const m of MISSING) assert.deepStrictEqual(fail({ name: m }), ["name", "Enter the account name."]);
  assert.deepStrictEqual(fail({ name: "x".repeat(61) }), ["name", "Keep the account name under 60 characters."]);
  assert.deepStrictEqual(fail({ nameTaken: true }), ["name", "An account named “Snow Removal” already exists."]);
  for (const m of [...MISSING, "bogus"]) assert.deepStrictEqual(fail({ kind: m }), ["kind", "Select the account type."]);
  assert.deepStrictEqual(fail({ kind: "owner_draw" }), ["kind", "Owner Draw is the only owner-draw account. Pick another type."]);
  assert.deepStrictEqual(P.validateAccountFields({ mode: "rename", name: "Snow" }), { ok: true, value: { name: "Snow", nameKey: "snow" } });
});

// --- review fixes --------------------------------------------------------------------------------

test("fix 2: selectWorkOrders keeps closed WOs completed before the floor (billable / missing bill) instead of dropping them", () => {
  const all = [
    wo({ id: "ok" }),
    wo({ id: "early", number: 2001, completedDate: "2026-07-31" }),
    wo({ id: "earlyNoAmt", number: 2002, completedDate: "2026-07-15", billAmountCents: undefined }),
    wo({ id: "earlyBilled", completedDate: "2026-07-15", billedStatementId: "s0" }),
    wo({ id: "earlyNoCharge", completedDate: "2026-07-15", noOwnerCharge: true }),
    wo({ id: "earlyCompleted", status: "completed", completedDate: "2026-07-15" }),
  ];
  const r = P.selectWorkOrders(all, "2026-09-30", "2026-08-01");
  assert.deepStrictEqual(ids(r.billable), ["ok"]);
  assert.deepStrictEqual(ids(r.missingBill), []); // a missing bill below the floor never blocks
  assert.deepStrictEqual(ids(r.beforeFloor), ["early"]);
  assert.deepStrictEqual(ids(r.beforeFloorMissingBill), ["earlyNoAmt"]);
  assert.deepStrictEqual(ids(r.awaitingReview), []);
});

test("fix 1 / 9: linkSettingProblem locks only on THIS owner's finals; the start month also waits for an open draft", () => {
  // new owner after a sale: the property has the old owner's finals, but none of this owner's
  assert.equal(P.linkSettingProblem("openingBalanceCents", "12 Oak St", 0, 0), null);
  assert.equal(P.linkSettingProblem("startMonth", "12 Oak St", 0, 0), null);
  assert.equal(
    P.linkSettingProblem("openingBalanceCents", "12 Oak St", 1, 0),
    "The opening balance can't change after 12 Oak St has a final statement.",
  );
  assert.equal(
    P.linkSettingProblem("startMonth", "12 Oak St", 2, 1),
    "The first statement month can't change after 12 Oak St has a final statement.",
  );
  // an open draft (any owner) freezes the start month but not the opening balance
  assert.equal(
    P.linkSettingProblem("startMonth", "12 Oak St", 0, 1),
    "12 Oak St has an open draft statement. Finalize or discard it before changing the first statement month.",
  );
  assert.equal(P.linkSettingProblem("openingBalanceCents", "12 Oak St", 0, 1), null);
});

test("fix 6: editing an unbilled row dated in a locked month is allowed while its date stays; moving the date into a locked month is not", () => {
  const p = { name: "12 Oak St", lockedThrough: "2026-09", startMonth: "2026-08" };
  assert.equal(P.entryChangeDateProblem("2026-09-15", "2026-09-15", "2026-10-20", p), null);
  assert.equal(
    P.entryChangeDateProblem("2026-09-20", "2026-09-15", "2026-10-20", p),
    "September 2026 is final for 12 Oak St. Date this transaction in October 2026 or later.",
  );
  assert.equal(
    P.entryChangeDateProblem("2026-09-20", "2026-10-02", "2026-10-20", p),
    "September 2026 is final for 12 Oak St. Date this transaction in October 2026 or later.",
  );
  assert.equal(P.entryChangeDateProblem("2026-10-02", "2026-09-15", "2026-10-20", p), null);
  // add (no current date): the rule always runs
  assert.equal(
    P.entryChangeDateProblem("2026-09-15", undefined, "2026-10-20", p),
    "September 2026 is final for 12 Oak St. Date this transaction in October 2026 or later.",
  );
});

test("fix 6: the ledger list puts a billed row in its POSTED month", () => {
  assert.equal(P.ledgerRowInMonth({ date: "2026-08-20", postedDate: "2026-10-01" }, "2026-10-01", "2026-10-31"), true);
  assert.equal(P.ledgerRowInMonth({ date: "2026-08-20", postedDate: "2026-10-01" }, "2026-08-01", "2026-08-31"), false);
  assert.equal(P.ledgerRowInMonth({ date: "2026-08-20" }, "2026-08-01", "2026-08-31"), true);
});

test("fix 5: rosPendingOf = closed, chargeable, not billed", () => {
  assert.equal(P.rosPendingOf({ status: "reviewed_closed" }), true);
  assert.equal(P.rosPendingOf({ status: "reviewed_closed", noOwnerCharge: false }), true);
  assert.equal(P.rosPendingOf({ status: "reviewed_closed", noOwnerCharge: true }), false);
  assert.equal(P.rosPendingOf({ status: "reviewed_closed", billedStatementId: "s1" }), false);
  for (const status of ["created", "assigned", "in_progress", "completed", "cancelled"]) {
    assert.equal(P.rosPendingOf({ status }), false);
  }
});
