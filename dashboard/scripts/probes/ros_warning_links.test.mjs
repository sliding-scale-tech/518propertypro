// Tests for components/finance/warning-links.ts: every statement warning that has a place to fix
// it links there (owner page section, work order, or the Payments page for unpaid rent), and the rest
// get no link. No packages. From dashboard/:
//   node --test scripts/probes/ros_warning_links.test.mjs
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
const L = await import("../../components/finance/warning-links.ts");
const B = await import("../../convex/rosBuild.ts");

const OWNER = "own_1";
const PID = "prop_1";
const owner = (hash) => `/owner-statements/owners/${OWNER}#${hash}`;

/** code -> [warning fields, expected target]. */
const CASES = {
  OPENING_BALANCE_NOT_SET: [{ propertyId: PID }, { kind: "href", href: owner(`property-${PID}-opening`), label: "Set opening balance →" }],
  PREV_OWNER_BALANCE: [{ propertyId: PID }, { kind: "href", href: owner(`property-${PID}-opening`), label: "Set opening balance →" }],
  START_MONTH_AFTER: [{ propertyId: PID }, { kind: "href", href: owner(`property-${PID}-start`), label: "Check first statement month →" }],
  DEPOSITS_NOT_SET: [{ propertyId: PID }, { kind: "href", href: owner(`property-${PID}-deposits`), label: "Enter deposits →" }],
  CO_OWNED: [{ propertyId: PID }, { kind: "href", href: owner(`property-${PID}`), label: "Review property links →" }],
  PAYEE_MISSING: [{}, { kind: "href", href: owner("owner-payee"), label: "Set payee →" }],
  WO_MISSING_BILL: [
    { propertyId: PID, workOrderId: "wo_9", message: "WO-2051 (1 Main St) is closed but has no bill amount." },
    { kind: "href", href: "/work-orders/wo_9", label: "Open WO-2051 →" },
  ],
  WO_AWAITING_REVIEW: [
    { propertyId: PID, workOrderId: "wo_8", message: "WO-77 (1 Main St) was completed on Oct 2, 2026." },
    { kind: "href", href: "/work-orders/wo_8", label: "Open WO-77 →" },
  ],
  WO_BEFORE_START: [
    { propertyId: PID, workOrderId: "wo_7", message: "WO-12 (1 Main St) was completed before ..." },
    { kind: "href", href: "/work-orders/wo_7", label: "Open WO-12 →" },
  ],
  WO_BEFORE_START_MISSING_BILL: [
    { propertyId: PID, workOrderId: "wo_6", message: "WO-13 (1 Main St) was completed before ..." },
    { kind: "href", href: "/work-orders/wo_6", label: "Open WO-13 →" },
  ],
  RENT_UNPAID: [
    { rentMonth: "2026-10" },
    { kind: "href", href: `/owner-statements/payments?month=2026-10&owner=${OWNER}&status=unpaid`, label: "Open Payments page →" },
  ],
};

/** Codes with nowhere specific to fix them: no link. */
const NO_LINK = [
  "ACCOUNTS_MISSING",
  "AMOUNT_TOO_LARGE",
  "FEE_NOT_SET",
  "NEGATIVE_ENDING",
  "NO_DRAW",
  "OWNER_CHANGED",
  "PERIOD_OPEN",
  "PRIOR_NOT_FINAL",
  "TOO_MANY_LINES",
  "SOMETHING_NEW",
];

test("each linking warning code points at the right place", () => {
  for (const [code, [fields, expected]] of Object.entries(CASES)) {
    const w = { code, message: "m", ...fields };
    assert.deepStrictEqual(L.warningTarget(w, OWNER), expected, code);
  }
});

test("other codes get no link", () => {
  for (const code of NO_LINK) {
    assert.equal(L.warningTarget({ code, message: "m", propertyId: PID, workOrderId: "wo_1" }, OWNER), null, code);
  }
});

test("a warning missing the id it needs gets no link (never a broken one)", () => {
  for (const code of ["OPENING_BALANCE_NOT_SET", "PREV_OWNER_BALANCE", "START_MONTH_AFTER", "DEPOSITS_NOT_SET", "CO_OWNED"]) {
    assert.equal(L.warningTarget({ code, message: "m" }, OWNER), null, code);
  }
  // several WOs before the start month: no single work order to open
  for (const code of ["WO_MISSING_BILL", "WO_AWAITING_REVIEW", "WO_BEFORE_START", "WO_BEFORE_START_MISSING_BILL"]) {
    assert.equal(L.warningTarget({ code, message: "WO-1, WO-2 (x)", propertyId: PID }, OWNER), null, code);
  }
  // a WO warning whose text has no WO number still links, with a generic label
  assert.equal(L.warningTarget({ code: "WO_MISSING_BILL", message: "m", workOrderId: "w" }, OWNER).label, "Open work order →");
});

test("every warning code the builder or engine can raise is classified", () => {
  const src = ["../../convex/rosBuild.ts", "../../convex/rosCalc.ts"]
    .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
    .join("\n");
  const raised = new Set([...src.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]));
  const known = new Set([...Object.keys(CASES), ...NO_LINK]);
  for (const code of raised) assert.ok(known.has(code), `${code} is raised but not classified in this test`);
  for (const code of Object.keys(CASES)) assert.ok(raised.has(code), `${code} links but is never raised`);
});

test("anchors match what the targets use, and the owner id is URL-encoded", () => {
  assert.equal(L.ANCHOR.opening("p"), "property-p-opening");
  assert.equal(L.ANCHOR.startMonth("p"), "property-p-start");
  assert.equal(L.ANCHOR.deposits("p"), "property-p-deposits");
  assert.equal(L.ANCHOR.property("p"), "property-p");
  assert.equal(L.warningTarget({ code: "PAYEE_MISSING", message: "m" }, "a/b").href, "/owner-statements/owners/a%2Fb#owner-payee");
});

test("splitWarnings carries propertyId and workOrderId, so the card can build the link", () => {
  const split = B.splitWarnings([
    { code: "DEPOSITS_NOT_SET", propertyId: PID, message: "d", blocking: false },
    { code: "WO_MISSING_BILL", propertyId: PID, workOrderId: "wo_9", message: "WO-5 x", blocking: true },
    { code: "RENT_UNPAID", rentMonth: "2026-09", message: "r", blocking: false },
  ]);
  assert.deepStrictEqual(split.info, [
    { code: "DEPOSITS_NOT_SET", message: "d", propertyId: PID },
    { code: "RENT_UNPAID", message: "r", rentMonth: "2026-09" },
  ]);
  assert.deepStrictEqual(split.blocking, [{ code: "WO_MISSING_BILL", message: "WO-5 x", propertyId: PID, workOrderId: "wo_9" }]);
  assert.equal(L.warningTarget(split.info[0], OWNER).href, owner(`property-${PID}-deposits`));
  assert.equal(L.warningTarget(split.blocking[0], OWNER).href, "/work-orders/wo_9");
  assert.equal(L.warningTarget(split.info[1], OWNER).href, `/owner-statements/payments?month=2026-09&owner=${OWNER}&status=unpaid`);
  // RENT_UNPAID without its month: no (broken) link
  assert.equal(L.warningTarget({ code: "RENT_UNPAID", message: "r" }, OWNER), null);
});
