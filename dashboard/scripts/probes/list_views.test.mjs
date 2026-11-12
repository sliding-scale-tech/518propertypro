// Tests for the list helpers of the messaging / team / docs / audit / leads screens (pure, no
// packages): cursor paging (lib/cursor-paging.ts), the Team member list view
// (components/team/member-list-view.ts) and the Knowledge page view (components/docs/docs-view.ts).
// From dashboard/:  node --test scripts/probes/list_views.test.mjs
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
const C = await import("../../lib/cursor-paging.ts");
const M = await import("../../components/team/member-list-view.ts");
const D = await import("../../components/docs/docs-view.ts");

// --- Cursor paging --------------------------------------------------------------------------------
test("cursor paging: forward one page at a time, back to any earlier page", () => {
  let s = C.FIRST_PAGE;
  assert.equal(C.pageOf(s), 1);
  assert.equal(C.cursorOf(s), null);
  assert.equal(C.rowsBeforeOf(s), 0);
  s = C.goToPage(s, 2, { rowsOnPage: 50, hasNext: true, continueCursor: "c1" });
  assert.equal(C.pageOf(s), 2);
  assert.equal(C.cursorOf(s), "c1");
  s = C.goToPage(s, 3, { rowsOnPage: 47, hasNext: true, continueCursor: "c2" });
  assert.equal(C.cursorOf(s), "c2");
  assert.equal(C.rowsBeforeOf(s), 97); // pages can be short: a sum, not page x size
  s = C.goToPage(s, 1, { rowsOnPage: 10, hasNext: true, continueCursor: "c3" });
  assert.equal(C.pageOf(s), 1);
  assert.equal(C.cursorOf(s), null);
  assert.equal(C.rowsBeforeOf(s), 0);
});

test("cursor paging: pages that were never visited or do not exist are ignored", () => {
  const s = C.FIRST_PAGE;
  assert.equal(C.goToPage(s, 3, { rowsOnPage: 5, hasNext: true, continueCursor: "c" }), s); // skipping ahead
  assert.equal(C.goToPage(s, 2, { rowsOnPage: 5, hasNext: false, continueCursor: "c" }), s); // no next page
  assert.equal(C.goToPage(s, 2, { rowsOnPage: 5, hasNext: true, continueCursor: null }), s); // no cursor
  assert.equal(C.goToPage(s, 0, { rowsOnPage: 5, hasNext: true, continueCursor: "c" }), s);
  assert.equal(C.goToPage(s, 1.5, { rowsOnPage: 5, hasNext: true, continueCursor: "c" }), s);
});

// --- Team member list ----------------------------------------------------------------------------
const people = [
  { name: "Zoe Admin", email: "zoe@x.com", appRole: "admin", joinedAt: 3 },
  { name: "adam tech", email: "adam@x.com", appRole: "technician", joinedAt: 1 },
  { name: "Mia Manager", email: "mia@x.com", appRole: "asset_manager", joinedAt: 2 },
  { name: "Nora Nobody", email: "", appRole: null, joinedAt: 4 },
  { name: "Bob Books", email: "bob@x.com", appRole: "accountant", joinedAt: 5 },
];
const labels = { admin: "Admin", asset_manager: "Asset manager", technician: "Technician", accountant: "Accountant" };
const view = (o) =>
  M.membersView(people, {
    q: "",
    roleMatches: () => true,
    roleLabel: (m) => labels[m.appRole] ?? "No role yet",
    sort: M.MEMBER_SORT_DEFAULT,
    ...o,
  }).map((m) => m.name);

test("members: sort by name is case-insensitive, either direction", () => {
  assert.deepEqual(view({}), ["adam tech", "Bob Books", "Mia Manager", "Nora Nobody", "Zoe Admin"]);
  assert.deepEqual(view({ sort: { key: "name", dir: "desc" } })[0], "Zoe Admin");
});

test("members: sort by role puts admins first and people with no role last; joined sorts by date", () => {
  assert.deepEqual(view({ sort: { key: "role", dir: "asc" } }), ["Zoe Admin", "Mia Manager", "adam tech", "Bob Books", "Nora Nobody"]);
  assert.deepEqual(view({ sort: { key: "joined", dir: "desc" } })[0], "Bob Books");
  assert.deepEqual(view({ sort: { key: "joined", dir: "asc" } })[0], "adam tech");
});

test("members: search matches name, email and role label; every word must match", () => {
  assert.deepEqual(view({ q: "  MIA " }), ["Mia Manager"]);
  assert.deepEqual(view({ q: "adam@x" }), ["adam tech"]);
  assert.deepEqual(view({ q: "technician" }), ["adam tech"]);
  assert.deepEqual(view({ q: "asset mia" }), ["Mia Manager"]);
  assert.deepEqual(view({ q: "nobody zzz" }), []);
});

test("members: the role filter and search combine", () => {
  assert.deepEqual(view({ roleMatches: (m) => m.appRole === null }), ["Nora Nobody"]);
  assert.deepEqual(view({ roleMatches: (m) => m.appRole === "admin", q: "mia" }), []);
});

// --- Knowledge docs ------------------------------------------------------------------------------
const docs = [
  { title: "Pet policy", body: "Two pets allowed, deposit $300.", updatedAt: 100 },
  { title: "Application fee", body: "The fee is $50 per adult.", updatedAt: 300 },
  { title: "Parking", body: "One spot per unit. Pets must be leashed.", updatedAt: 0 },
];
const titles = (o) => D.docsView(docs, { q: "", sort: D.DOC_SORT_DEFAULT, ...o }).map((d) => d.title);

test("docs: newest update first by default; a missing date counts as the oldest", () => {
  assert.deepEqual(titles({}), ["Application fee", "Pet policy", "Parking"]);
  assert.deepEqual(titles({ sort: { key: "updated", dir: "asc" } }), ["Parking", "Pet policy", "Application fee"]);
});

test("docs: sort by title either way", () => {
  assert.deepEqual(titles({ sort: { key: "title", dir: "asc" } }), ["Application fee", "Parking", "Pet policy"]);
  assert.deepEqual(titles({ sort: { key: "title", dir: "desc" } }), ["Pet policy", "Parking", "Application fee"]);
});

test("docs: search looks in the title and the text, every word must match", () => {
  assert.deepEqual(titles({ q: "PETS" }), ["Pet policy", "Parking"]);
  assert.deepEqual(titles({ q: "pets deposit" }), ["Pet policy"]);
  assert.deepEqual(titles({ q: "fee" }), ["Application fee"]);
  assert.deepEqual(titles({ q: "nothing here" }), []);
  assert.equal(titles({ q: "   " }).length, 3);
});
