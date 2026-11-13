// Tests for components/finance/statement-steps.ts: the statement page's guided steps (which step
// opens, the status dots), the Check step's warning grouping and one-click actions, the per-property
// line groups, the lock summary and the totals bar (server figures only). No packages. From dashboard/:
//   node --test scripts/probes/ros_statement_steps.test.mjs
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
const S = await import("../../components/finance/statement-steps.ts");

const OWNER = "own_1";
const A = "prop_a";
const B = "prop_b";
const PROPS = [
  { propertyId: A, name: "1 Main St" },
  { propertyId: B, name: "2 Oak Ave" },
];
const w = (code, fields = {}) => ({ code, message: `${code} message`, ...fields });

test("readStep: a draft opens on Check, a final or discarded statement on Review; ?step= wins when valid", () => {
  assert.equal(S.readStep(null, "draft"), "check");
  assert.equal(S.readStep(undefined, "final"), "review");
  assert.equal(S.readStep("", "discarded"), "review");
  assert.equal(S.readStep("bogus", "draft"), "check");
  for (const id of ["check", "in", "out", "payout", "review"]) {
    assert.equal(S.readStep(id, "draft"), id);
    assert.equal(S.readStep(id, "final"), id, "a final can view every step");
  }
});

test("the five steps in order, with next / previous", () => {
  assert.deepStrictEqual(
    S.STEPS.map((s) => s.label),
    ["Check", "Money in", "Money out", "Fees & payout", "Review & finalize"],
  );
  assert.equal(S.nextStep("check"), "in");
  assert.equal(S.nextStep("payout"), "review");
  assert.equal(S.nextStep("review"), null);
  assert.equal(S.prevStep("check"), null);
  assert.equal(S.prevStep("in"), "check");
  assert.equal(S.stepLabel("payout"), "Fees & payout");
});

test("warning tone: blocking = fix, NO_DRAW / PERIOD_OPEN = note, other info = worth a look", () => {
  assert.equal(S.warningTone("WO_MISSING_BILL", true), "fix");
  assert.equal(S.warningTone("NO_DRAW", true), "fix", "blocking always wins");
  assert.equal(S.warningTone("NO_DRAW", false), "note");
  assert.equal(S.warningTone("PERIOD_OPEN", false), "note");
  assert.equal(S.warningTone("OPENING_BALANCE_NOT_SET", false), "look");
  assert.equal(S.warningTone("RENT_UNPAID", false), "look");
});

/** Every code the builder or engine can raise, with the step it belongs to. */
const STEP_OF = {
  ACCOUNTS_MISSING: "check",
  OWNER_CHANGED: "check",
  CO_OWNED: "check",
  PREV_OWNER_BALANCE: "check",
  OPENING_BALANCE_NOT_SET: "check",
  PRIOR_NOT_FINAL: "check",
  START_MONTH_AFTER: "check",
  TOO_MANY_LINES: "check",
  DEPOSITS_NOT_SET: "payout",
  RENT_UNPAID: "in",
  RENT_PAYMENT_BEFORE_START: "in",
  WO_MISSING_BILL: "out",
  WO_AWAITING_REVIEW: "out",
  WO_BEFORE_START: "out",
  WO_BEFORE_START_MISSING_BILL: "out",
  FEE_NOT_SET: "payout",
  AMOUNT_TOO_LARGE: "payout",
  PAYEE_MISSING: "payout",
  NO_DRAW: "payout",
  NEGATIVE_ENDING: "payout",
  PERIOD_OPEN: "review",
};

test("every warning code the builder or engine raises has a step", () => {
  const src = ["../../convex/rosBuild.ts", "../../convex/rosCalc.ts"]
    .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
    .join("\n");
  const raised = new Set([...src.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]));
  for (const code of raised) {
    assert.ok(code in STEP_OF, `${code} is raised but not placed on a step in this test`);
    assert.equal(S.warningStep(code), STEP_OF[code], code);
  }
  assert.equal(S.warningStep("SOMETHING_NEW"), "check", "an unknown code lands on Check (never lost)");
});

test("one-click actions: opening balance and deposits are confirmed in place", () => {
  assert.deepStrictEqual(S.warningAction(w("OPENING_BALANCE_NOT_SET", { propertyId: A }), OWNER), {
    kind: "opening",
    propertyId: A,
    offerZero: true,
  });
  // The previous owner left a balance: set an amount, but no "It's $0.00" shortcut.
  assert.deepStrictEqual(S.warningAction(w("PREV_OWNER_BALANCE", { propertyId: A }), OWNER), {
    kind: "opening",
    propertyId: A,
    offerZero: false,
  });
  assert.deepStrictEqual(S.warningAction(w("DEPOSITS_NOT_SET", { propertyId: A }), OWNER), { kind: "deposits", propertyId: A });
  // Without the property id there is nothing to set in place (and no broken link): the opening
  // balance gets no action, the deposits open Fees & payout where they are shown.
  assert.equal(S.warningAction(w("OPENING_BALANCE_NOT_SET"), OWNER), null);
  assert.deepStrictEqual(S.warningAction(w("DEPOSITS_NOT_SET"), OWNER), {
    kind: "step",
    step: "payout",
    reveal: null,
    label: "Open Fees & payout →",
  });
});

test("other actions keep their deep links, or open the step the warning is about", () => {
  assert.deepStrictEqual(S.warningAction(w("RENT_UNPAID", { rentMonth: "2026-10" }), OWNER), {
    kind: "href",
    href: `/payments?month=2026-10&owner=${OWNER}&status=unpaid`,
    label: "Open Payments page →",
  });
  assert.deepStrictEqual(
    S.warningAction(w("WO_MISSING_BILL", { propertyId: A, workOrderId: "wo_9", message: "WO-2051 (1 Main St) is closed" }), OWNER),
    { kind: "href", href: "/work-orders/wo_9", label: "Open WO-2051 →" },
  );
  assert.equal(S.warningAction(w("PAYEE_MISSING"), OWNER).href, `/owner-statements/owners/${OWNER}#owner-payee`);
  assert.equal(S.warningAction(w("START_MONTH_AFTER", { propertyId: A }), OWNER).href, `/owner-statements/owners/${OWNER}#property-${A}-start`);
  // The left-off rent payments now live on Money in: open it with the section revealed.
  assert.deepStrictEqual(S.warningAction(w("RENT_PAYMENT_BEFORE_START", { propertyId: A }), OWNER), {
    kind: "step",
    step: "in",
    reveal: "left-off",
    label: "Show left-off lines →",
  });
  // No link anywhere, but it is about Fees & payout: open that step.
  assert.deepStrictEqual(S.warningAction(w("NEGATIVE_ENDING", { propertyId: A }), OWNER), {
    kind: "step",
    step: "payout",
    reveal: null,
    label: "Open Fees & payout →",
  });
  assert.equal(S.warningAction(w("NO_DRAW", { propertyId: A }), OWNER).step, "payout");
  // A WO warning about several work orders has no single one to open: open Money out instead.
  assert.equal(S.warningAction(w("WO_BEFORE_START", { propertyId: A, message: "WO-1, WO-2 (x)" }), OWNER).step, "out");
  // Nothing to do anywhere.
  assert.equal(S.warningAction(w("ACCOUNTS_MISSING"), OWNER), null);
  assert.equal(S.warningAction(w("PRIOR_NOT_FINAL", { propertyId: A }), OWNER), null);
  assert.equal(S.warningAction(w("PERIOD_OPEN"), OWNER), null);
});

test("groupWarnings: per property in statement order, blocking first, statement-wide and notes apart", () => {
  const g = S.groupWarnings(
    {
      blocking: [w("WO_MISSING_BILL", { propertyId: B, workOrderId: "wo_1" }), w("PAYEE_MISSING")],
      info: [
        w("OPENING_BALANCE_NOT_SET", { propertyId: B }),
        w("DEPOSITS_NOT_SET", { propertyId: B }),
        w("NO_DRAW", { propertyId: A }),
        w("RENT_UNPAID", { rentMonth: "2026-10" }),
        w("PERIOD_OPEN"),
        w("NEGATIVE_ENDING", { propertyId: "prop_gone" }),
      ],
    },
    PROPS,
    OWNER,
  );
  assert.deepStrictEqual(
    g.properties.map((p) => p.propertyId),
    [A, B],
    "every statement property, in order",
  );
  const [a, b] = g.properties;
  assert.equal(a.fix.length + a.look.length, 0, "1 Main St has only a note");
  assert.deepStrictEqual(b.fix.map((i) => i.code), ["WO_MISSING_BILL"]);
  assert.deepStrictEqual(b.look.map((i) => i.code), ["OPENING_BALANCE_NOT_SET", "DEPOSITS_NOT_SET"]);
  assert.equal(b.look[0].action.kind, "opening");
  assert.equal(b.look[1].action.kind, "deposits");
  assert.deepStrictEqual(g.statement.fix.map((i) => i.code), ["PAYEE_MISSING"]);
  // A property that isn't on the statement: kept, in the statement group.
  assert.deepStrictEqual(g.statement.look.map((i) => i.code), ["RENT_UNPAID", "NEGATIVE_ENDING"]);
  assert.deepStrictEqual(g.notes.map((i) => i.code), ["NO_DRAW", "PERIOD_OPEN"]);
  assert.equal(g.fixCount, 2);
  assert.equal(g.lookCount, 4);
  const keys = [g.statement, ...g.properties].flatMap((x) => [...x.fix, ...x.look]).concat(g.notes).map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "item keys are unique");
});

test("groupWarnings: nothing to do", () => {
  const g = S.groupWarnings({ blocking: [], info: [] }, PROPS, OWNER);
  assert.equal(g.fixCount + g.lookCount, 0);
  assert.equal(g.notes.length, 0);
  assert.equal(g.properties.length, 2);
});

test("step dots: a blocking item marks Check, its own step and Review; notes never do", () => {
  const st = S.stepStates({
    status: "draft",
    warnings: {
      blocking: [w("WO_MISSING_BILL", { propertyId: A })],
      info: [w("RENT_UNPAID", { rentMonth: "2026-10" }), w("NO_DRAW", { propertyId: A }), w("PERIOD_OPEN")],
    },
  });
  assert.deepStrictEqual(st.check, { status: "attention", fix: 1, look: 1 });
  assert.deepStrictEqual(st.in, { status: "info", fix: 0, look: 1 });
  assert.deepStrictEqual(st.out, { status: "attention", fix: 1, look: 0 });
  assert.deepStrictEqual(st.payout, { status: "done", fix: 0, look: 0 }, "NO_DRAW is a note");
  assert.deepStrictEqual(st.review, { status: "attention", fix: 1, look: 0 });
});

test("step dots: a clean draft is done everywhere except Review (still to finalize)", () => {
  const st = S.stepStates({ status: "draft", warnings: { blocking: [], info: [] } });
  for (const id of ["check", "in", "out", "payout"]) assert.equal(st[id].status, "done", id);
  assert.equal(st.review.status, "info");
  const setup = S.stepStates({ status: "draft", warnings: { blocking: [], info: [w("OPENING_BALANCE_NOT_SET", { propertyId: A })] } });
  assert.equal(setup.check.status, "info");
  assert.equal(setup.in.status, "done");
  const dep = S.stepStates({ status: "draft", warnings: { blocking: [], info: [w("DEPOSITS_NOT_SET", { propertyId: A })] } });
  assert.equal(dep.check.status, "info");
  assert.equal(dep.payout.status, "info");
});

test("step dots: a final or discarded statement is read-only, every step done", () => {
  for (const status of ["final", "discarded"]) {
    const st = S.stepStates({ status, warnings: { blocking: [w("X")], info: [w("NEGATIVE_ENDING")] } });
    for (const s of S.STEPS) assert.equal(st[s.id].status, "done", `${status} ${s.id}`);
  }
});

const line = (o) => ({ side: "addition", kind: "entry", propertyId: A, propertyName: "1 Main St", amountCents: 100, sourceLabel: "Manual", ...o });

test("linesForStep: Money in = additions; Money out = expenses without the fee and draw", () => {
  const lines = [
    line({ key: "r", rentForMonth: "2026-10" }),
    line({ key: "wo", side: "subtraction", kind: "wo" }),
    line({ key: "e", side: "subtraction" }),
    line({ key: "fee", side: "subtraction", kind: "fee" }),
    line({ key: "draw", side: "subtraction", kind: "draw" }),
  ];
  assert.deepStrictEqual(S.linesForStep(lines, "in").map((l) => l.key), ["r"]);
  assert.deepStrictEqual(S.linesForStep(lines, "out").map((l) => l.key), ["wo", "e"]);
});

test("groupByProperty: statement order, every property, subtotals from the line amounts", () => {
  const groups = S.groupByProperty(
    [
      line({ propertyId: B, amountCents: 250 }),
      line({ propertyId: A, amountCents: 100 }),
      line({ propertyId: B, amountCents: 5 }),
      line({ propertyId: "prop_x", propertyName: "9 Elm", amountCents: 7 }),
    ],
    [...PROPS, { propertyId: "prop_c", name: "3 Pine" }],
  );
  assert.deepStrictEqual(
    groups.map((g) => [g.propertyId, g.lines.length, g.subtotalCents]),
    [
      [A, 1, 100],
      [B, 2, 255],
      ["prop_c", 0, 0],
      ["prop_x", 1, 7],
    ],
  );
  assert.equal(groups[3].name, "9 Elm");
});

test("lockSummary counts what finalizing bills", () => {
  const s = S.lockSummary([
    line({ kind: "wo", sourceLabel: "WO-12" }),
    line({ kind: "wo", sourceLabel: "WO-13" }),
    line({ rentForMonth: "2026-10" }),
    line({}),
    line({ kind: "fee" }),
    line({ kind: "draw" }),
  ]);
  assert.deepStrictEqual(s, { workOrders: ["WO-12", "WO-13"], rentPayments: 1, transactions: 1, fees: 1, draws: 1 });
});

test("totalsOf reads the engine's result (a skipped fee counts 0)", () => {
  const cols = (total) => ({ byProperty: [total], total });
  const t = S.totalsOf({
    summary: {
      income: cols(200000),
      expenses: cols(30000),
      ownerDraws: cols(150000),
      ending: cols(20000),
      available: cols(5000),
    },
    generated: [{ fee: { amountCents: 10000 } }, { fee: { amountCents: 0 } }],
  });
  assert.deepStrictEqual(t, {
    incomeCents: 200000,
    expensesCents: 30000,
    feeCents: 10000,
    drawCents: 150000,
    endingCents: 20000,
    availableCents: 5000,
  });
});
