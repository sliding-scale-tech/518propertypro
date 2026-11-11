// Tests for components/finance/line-labels.ts: which draft lines get a Delete button, the
// carried-forward pill text, the date cell, and the Leave off / Delete UI strings. No packages.
// From dashboard/:
//   node --test scripts/probes/ros_line_labels.test.mjs
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
const L = await import("../../components/finance/line-labels.ts");
const P = await import("../../convex/rosPolicy.ts");

const line = (over = {}) => ({
  kind: "entry",
  editable: true,
  entryId: "e_1",
  date: "2026-10-05",
  storedDate: "2026-10-05",
  carriedForward: false,
  ...over,
});

test("canDeleteLine: only editable manual ledger rows", () => {
  assert.equal(L.canDeleteLine(line()), true);
  // imported / Stripe / opening-balance entries are not editable on a draft
  assert.equal(L.canDeleteLine(line({ editable: false })), false);
  // final statement: nothing is editable
  assert.equal(L.canDeleteLine(line({ editable: false, entryId: "e_2" })), false);
  // no ledger row to void
  assert.equal(L.canDeleteLine(line({ entryId: undefined })), false);
  assert.equal(L.canDeleteLine(line({ entryId: "" })), false);
  // roster rent, work orders, fees and draws keep their own actions
  for (const kind of ["rent", "wo", "fee", "draw"]) {
    assert.equal(L.canDeleteLine(line({ kind })), false, kind);
    assert.equal(L.canDeleteLine(line({ kind, entryId: undefined })), false, kind);
  }
});

test("carriedForwardTag: draft and final wording", () => {
  const carried = line({ date: "2026-10-01", storedDate: "2026-09-22", carriedForward: true });
  assert.equal(L.carriedForwardTag(carried, true), "From September 2026 — not on a final statement yet");
  assert.equal(L.carriedForwardTag(carried, false), "From September 2026");
  // across a year boundary
  const dec = line({ date: "2027-01-01", storedDate: "2026-12-31", carriedForward: true });
  assert.equal(L.carriedForwardTag(dec, true), "From December 2026 — not on a final statement yet");
  // several months back
  const old = line({ date: "2026-10-01", storedDate: "2026-07-03", carriedForward: true });
  assert.equal(L.carriedForwardTag(old, true), "From July 2026 — not on a final statement yet");
});

test("carriedForwardTag: none for an in-period line", () => {
  assert.equal(L.carriedForwardTag(line(), true), null);
  assert.equal(L.carriedForwardTag(line(), false), null);
  assert.equal(L.carriedForwardTag(line({ date: "2026-10-01", storedDate: "2026-10-01" }), true), null);
  // a stale flag without an earlier stored date never shows a wrong month
  assert.equal(L.carriedForwardTag(line({ carriedForward: true }), true), null);
});

test("lineDateCell: original date plus the posting hint", () => {
  assert.deepEqual(L.lineDateCell(line({ date: "2026-10-01", storedDate: "2026-09-22", carriedForward: true })), {
    date: "9/22/2026",
    posts: "posts 10/1/2026",
  });
  assert.deepEqual(L.lineDateCell(line({ date: "2026-10-15", storedDate: "2026-10-15" })), { date: "10/15/2026", posts: null });
});

test("UI strings", () => {
  assert.equal(L.LEAVE_OFF.button, "Leave off this month");
  assert.equal(L.LEAVE_OFF.cardTitle, "Left off this statement");
  assert.equal(L.LEAVE_OFF.putBack, "Put back");
  assert.equal(L.LEAVE_OFF.toast, "Left off this statement. Put it back from “Left off this statement” below.");
  assert.equal(L.DELETE_ENTRY.button, "Delete");
  assert.equal(L.DELETE_ENTRY.title, "Delete this transaction?");
  assert.equal(
    L.DELETE_ENTRY.body,
    "It is removed from this and every future statement. It stays in the history with your reason.",
  );
  assert.equal(L.DELETE_ENTRY.toast, "Transaction deleted.");
  // the reason check the dialog and ledger.voidEntry share
  assert.equal(P.ENTRY_MSG.voidReasonMissing, "Enter why you're deleting this transaction.");
  assert.equal(P.ENTRY_MSG.voidReasonLong, "Keep the reason under 300 characters.");
  assert.equal(P.MAX_MEMO, 300);
});
