// Tests for the list tools (pure helpers, no packages): the Payments page search / status filter /
// totals (components/finance/payments-search.ts), the shared pagination maths
// (components/ui/pagination-model.ts), sortable headers (components/ui/table-sort.ts) and the
// Owner statements / Owners list finders (components/finance/list-finders.ts). From dashboard/:
//   node --test scripts/probes/ros_lists.test.mjs
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
const S = await import("../../components/finance/payments-search.ts");
const PG = await import("../../components/ui/pagination-model.ts");
const TS = await import("../../components/ui/table-sort.ts");
const F = await import("../../components/finance/list-finders.ts");

// --- Payments search ----------------------------------------------------------------------------

const row = (o) => ({
  unitId: o.unitId ?? "u",
  propertyName: "108 Jackson Avenue",
  propertyAddress: "108 Jackson Ave, Schenectady, NY 12304, USA",
  unit: "2nd Floor",
  tenants: ["Sharavia Rivera", "Bob Ray"],
  ownerName: "Nye Properties LLC",
  status: "unpaid",
  rentCents: 95087,
  payment: null,
  canMark: true,
  ...o,
});

test("search: any part of property name / address, unit, tenant or owner; case-insensitive, trimmed, extra spaces ignored", () => {
  const r = row({});
  for (const q of ["jackson", "  JACKSON  ", "108   jackson", "schenectady", "12304", "2nd fl", "floor", "rivera", "BOB", "nye prop", "llc", ""]) {
    assert.equal(S.rowMatchesSearch(r, q), true, q);
  }
  for (const q of ["elm", "3rd", "ann lee", "jacksonave", "108 jackson street"]) assert.equal(S.rowMatchesSearch(r, q), false, q);
  // the name a payment was marked under counts as a tenant name too
  assert.equal(S.rowMatchesSearch(row({ tenants: [], payment: { amountCents: 1, counterparty: "Old Tenant" } }), "old ten"), true);
  // no owner / no address: just not matched on them
  assert.equal(S.rowMatchesSearch(row({ ownerName: null, propertyAddress: null }), "nye"), false);
  assert.equal(S.normalizeSearch("  A \t B\n c "), "a b c");
  assert.equal(S.normalizeSearch(null), "");
});

test("search AND status; the totals and chip counts follow the search, not the status; money in integer cents", () => {
  const rows = [
    row({ unitId: "a", status: "paid", payment: { amountCents: 88300 } }),
    row({ unitId: "b", status: "unpaid", rentCents: 95087 }),
    row({ unitId: "c", status: "not_markable", rentCents: null, canMark: false }),
    row({ unitId: "d", propertyName: "12 Elm Street", propertyAddress: null, status: "unpaid", rentCents: 100000, ownerName: "Ash LLC" }),
  ];
  const all = S.applyPaymentsView(rows, {});
  assert.deepStrictEqual(all.summary, { paid: 1, unpaid: 2, notMarkable: 1, total: 4, receivedCents: 88300, unpaidCents: 195087 });
  const jackson = S.applyPaymentsView(rows, { q: "jackson", status: "unpaid" });
  assert.deepStrictEqual(jackson.visible.map((r) => r.unitId), ["b"]);
  assert.deepStrictEqual(jackson.matched.map((r) => r.unitId), ["a", "b", "c"]);
  assert.deepStrictEqual(jackson.summary, { paid: 1, unpaid: 1, notMarkable: 1, total: 3, receivedCents: 88300, unpaidCents: 95087 });
  const none = S.applyPaymentsView(rows, { q: "zzz" });
  assert.deepStrictEqual([none.visible, none.summary.total, none.summary.receivedCents], [[], 0, 0]);
});

test("Select all = the markable rows of the page shown only, capped", () => {
  const page = [row({ unitId: "a" }), row({ unitId: "b", canMark: false }), row({ unitId: "c" })];
  assert.deepStrictEqual(S.selectableOnPage(page, 100), ["a", "c"]);
  assert.deepStrictEqual(S.selectableOnPage(page, 1), ["a"]);
  // with paging: page 2 of 3 rows a page
  const many = Array.from({ length: 7 }, (_, i) => row({ unitId: `u${i + 1}`, canMark: i !== 4 }));
  const p2 = PG.paginate(many, 2, 3);
  assert.deepStrictEqual(S.selectableOnPage(p2.rows, 100), ["u4", "u6"]);
});

// --- Pagination -----------------------------------------------------------------------------------

test("paginate: slices, clamps the page, and gives the range; empty lists are page 1 of 1", () => {
  const rows = Array.from({ length: 483 }, (_, i) => i + 1);
  const p = PG.paginate(rows, 2, 50);
  assert.deepStrictEqual([p.rows[0], p.rows.at(-1), p.rows.length, p.page, p.pageCount, p.from, p.to, p.total], [51, 100, 50, 2, 10, 51, 100, 483]);
  assert.equal(PG.rangeLabel(p.from, p.to, p.total), "Showing 51–100 of 483");
  const last = PG.paginate(rows, 10, 50);
  assert.deepStrictEqual([last.rows.length, last.from, last.to], [33, 451, 483]);
  assert.equal(PG.paginate(rows, 99, 50).page, 10, "past the end shows the last page");
  assert.equal(PG.paginate(rows, 0, 50).page, 1);
  assert.equal(PG.paginate(rows, NaN, 50).page, 1);
  const empty = PG.paginate([], 3, 25);
  assert.deepStrictEqual([empty.page, empty.pageCount, empty.from, empty.to, empty.rows], [1, 1, 0, 0, []]);
  assert.equal(PG.rangeLabel(0, 0, 0), "Showing 0 of 0");
  assert.equal(PG.rangeLabel(1, 1, 1), "Showing 1 of 1");
  assert.equal(PG.rangeLabel(51, 100, null), "Showing 51–100", "cursor-paged (no total)");
  assert.deepStrictEqual(PG.cursorRange(3, 50, 20), { from: 101, to: 120 });
  assert.deepStrictEqual(PG.cursorRange(3, 50, 20, 97), { from: 98, to: 117 }, "short earlier pages");
  assert.deepStrictEqual(PG.cursorRange(1, 50, 0), { from: 0, to: 0 });
});

test("page / size from the URL: 25 / 50 / 100 only (default 50); pages are whole numbers from 1", () => {
  assert.deepStrictEqual(PG.PAGE_SIZES, [25, 50, 100]);
  assert.equal(PG.DEFAULT_PAGE_SIZE, 50);
  for (const [raw, n] of [["25", 25], ["100", 100], [" 50 ", 50], ["10", 50], ["abc", 50], [null, 50], [undefined, 50], ["", 50], [25, 25], ["25.5", 50]]) {
    assert.equal(PG.readPageSize(raw), n, String(raw));
  }
  for (const [raw, n] of [["3", 3], ["1", 1], ["0", 1], ["-2", 1], ["2.5", 1], ["x", 1], [null, 1], ["999999999999999999999", 1]]) {
    assert.equal(PG.readPage(raw), n, String(raw));
  }
});

test("page buttons: first, last, current ± 1, gaps (a single hidden page is shown instead of a gap)", () => {
  assert.deepStrictEqual(PG.pageItems(1, 1), [1]);
  assert.deepStrictEqual(PG.pageItems(1, 5), [1, 2, "gap", 5]);
  assert.deepStrictEqual(PG.pageItems(3, 5), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(PG.pageItems(6, 20), [1, "gap", 5, 6, 7, "gap", 20]);
  assert.deepStrictEqual(PG.pageItems(20, 20), [1, "gap", 19, 20]);
  assert.deepStrictEqual(PG.pageItems(99, 10), [1, "gap", 9, 10], "clamped");
});

// --- Sortable headers -----------------------------------------------------------------------------

test("sort: read from the URL, header clicks flip / reset the direction, nulls last, stable", () => {
  const keys = ["owner", "status", "ending"];
  const def = { key: "owner", dir: "asc" };
  assert.deepStrictEqual(TS.readSort(null, null, keys, def), def);
  assert.deepStrictEqual(TS.readSort("ending", "desc", keys, def), { key: "ending", dir: "desc" });
  assert.deepStrictEqual(TS.readSort("bogus", "sideways", keys, def), def);
  assert.deepStrictEqual(TS.toggleSort({ key: "owner", dir: "asc" }, "owner"), { key: "owner", dir: "desc" });
  assert.deepStrictEqual(TS.toggleSort({ key: "owner", dir: "desc" }, "ending"), { key: "ending", dir: "asc" });
  assert.equal(TS.ariaSortOf({ key: "owner", dir: "desc" }, "owner"), "descending");
  assert.equal(TS.ariaSortOf({ key: "owner", dir: "desc" }, "ending"), "none");
  const rows = [{ n: "b", v: 2 }, { n: "a", v: null }, { n: "c", v: 10 }, { n: "d", v: 2 }];
  assert.deepStrictEqual(TS.sortRows(rows, (r) => r.v, "asc").map((r) => r.n), ["b", "d", "c", "a"]);
  assert.deepStrictEqual(TS.sortRows(rows, (r) => r.v, "desc").map((r) => r.n), ["c", "b", "d", "a"], "nulls last both ways; ties keep order");
  assert.deepStrictEqual(TS.sortRows([{ s: "Unit 10" }, { s: "unit 9" }], (r) => r.s, "asc").map((r) => r.s), ["unit 9", "Unit 10"], "natural, case-insensitive");
});

// --- Owner statements list -------------------------------------------------------------------------

const owner = (name, extra = {}) => ({
  legalName: name,
  emails: [],
  properties: [],
  ...extra,
});
const st = (status, extra = {}) => ({ status, propertyNames: [], updatedAt: 1, ...extra });
const SROWS = [
  { key: "1", owner: owner("Nye Properties LLC", { emails: ["adam@nye.com"], properties: [{ name: "108 Jackson Avenue", address: "108 Jackson Ave, Schenectady", category: "gold" }] }), statement: st("final", { endingCashCents: 5000, availableCents: 4000, updatedAt: 30 }) },
  { key: "2", owner: owner("Ash LLC", { properties: [{ name: "12 Elm Street", address: null, category: "silver" }] }), statement: st("draft", { updatedAt: 20 }) },
  { key: "3", owner: owner("Birch LLC", { properties: [{ name: "3 Oak Road", address: null, category: "gold" }] }), statement: null },
  { key: "4", owner: owner("Cedar Holdings", {}), statement: st("final", { endingCashCents: -100, availableCents: 0, updatedAt: 10 }) },
];

test("statements list: search owner / email / property / address; team; status chips counted after search and team", () => {
  const v = (f) => F.statementsView(SROWS, f);
  assert.deepStrictEqual(v({ q: "ELM" }).visible.map((r) => r.key), ["2"]);
  assert.deepStrictEqual(v({ q: "adam@" }).visible.map((r) => r.key), ["1"]);
  assert.deepStrictEqual(v({ q: "schenectady" }).visible.map((r) => r.key), ["1"]);
  assert.deepStrictEqual(v({ q: " llc " }).visible.map((r) => r.key), ["2", "3", "1"], "sorted by owner name");
  assert.deepStrictEqual(v({ team: "gold" }).visible.map((r) => r.key), ["3", "1"]);
  assert.deepStrictEqual(v({ team: "gold" }).counts, { all: 2, not_started: 1, draft: 0, final: 1 });
  assert.deepStrictEqual(v({}).counts, { all: 4, not_started: 1, draft: 1, final: 2 });
  assert.deepStrictEqual(v({ status: "final" }).visible.map((r) => r.key), ["4", "1"]);
  assert.deepStrictEqual(v({ status: "final" }).counts.all, 4, "the chips ignore the status filter");
  assert.deepStrictEqual(v({ q: "nothing like it" }).visible, []);
});

test("statements list: sort by owner, status, ending cash, available, updated (amounts only on finals, others last)", () => {
  const sorted = (key, dir) => F.sortStatements(SROWS, { key, dir }).map((r) => r.key);
  assert.deepStrictEqual(sorted("owner", "asc"), ["2", "3", "4", "1"]);
  assert.deepStrictEqual(sorted("owner", "desc"), ["1", "4", "3", "2"]);
  assert.deepStrictEqual(sorted("status", "asc"), ["3", "2", "4", "1"], "not started, draft, final; ties by name");
  assert.deepStrictEqual(sorted("ending", "asc"), ["4", "1", "2", "3"]);
  assert.deepStrictEqual(sorted("ending", "desc"), ["1", "4", "2", "3"]);
  assert.deepStrictEqual(sorted("available", "desc"), ["1", "4", "2", "3"]);
  assert.deepStrictEqual(sorted("updated", "desc"), ["1", "2", "4", "3"]);
});

test("owners list: search name / contact / email / property, problems-only, sortable", () => {
  const O = [
    { legalName: "Nye Properties LLC", contactName: "Adam Nye", emails: ["adam@nye.com"], propertyNames: ["108 Jackson Avenue"], propertyCount: 1, problems: [], coOwnedPropertyNames: [] },
    { legalName: "Ash LLC", contactName: null, emails: [], propertyNames: ["12 Elm Street", "2 Jackson Avenue"], propertyCount: 2, problems: ["Owner draw payee not set"], coOwnedPropertyNames: [] },
    { legalName: "Birch LLC", contactName: "Zed", emails: [], propertyNames: [], propertyCount: 0, problems: [], coOwnedPropertyNames: ["3 Oak"] },
  ];
  const names = (rows) => rows.map((o) => o.legalName);
  assert.deepStrictEqual(names(F.ownersView(O, { q: "jackson" })), ["Ash LLC", "Nye Properties LLC"]);
  assert.deepStrictEqual(names(F.ownersView(O, { q: "adam" })), ["Nye Properties LLC"]);
  assert.deepStrictEqual(names(F.ownersView(O, { problemsOnly: true })), ["Ash LLC", "Birch LLC"]);
  assert.deepStrictEqual(names(F.ownersView(O, { sort: { key: "properties", dir: "desc" } })), ["Ash LLC", "Nye Properties LLC", "Birch LLC"]);
  assert.deepStrictEqual(names(F.ownersView(O, { sort: { key: "contact", dir: "asc" } })), ["Nye Properties LLC", "Birch LLC", "Ash LLC"], "no contact last");
  assert.deepStrictEqual(names(F.ownersView(O, { sort: { key: "name", dir: "desc" } })), ["Nye Properties LLC", "Birch LLC", "Ash LLC"]);
});
