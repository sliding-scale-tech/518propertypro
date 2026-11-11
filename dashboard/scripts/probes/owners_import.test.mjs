// Unit tests for the owners import from the unit rosters (ROS WP4): convex/ownersImportLib.ts
// (grouping by owner NAME + EMAIL across categories, identity flags, no-owner properties,
// two-owner-looking names, company-owned, co-owned, a property moved by hand is never re-linked,
// open drafts, idempotency, adoption, the compact dry-run payload) and the CLI guards in
// scripts/owners/import_owners.mjs. No packages.
// From dashboard/:
//   node --test scripts/probes/owners_import.test.mjs
// Spec: docs/specs/ros-build-spec.md 8 and 12. Every property, name and email here is invented.
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
const L = await import("../../convex/ownersImportLib.ts");
const I = await import("../../convex/ownerIdentity.ts");
const CLI = await import("../owners/import_owners.mjs");

// --- synthetic fixture ---------------------------------------------------------------------------

const PROPERTIES = [
  { id: "p1", name: "1 Oak Street", category: "gold", ownership: "managed", ownerName: "Ann Able", ownerEmails: ["Ann@Example.com"] },
  // Same owner, spelling differs only in case/space/trailing period; different email set.
  { id: "p2", name: "2 Oak Street", category: "gold", ownership: "managed", ownerName: "ann  able.", ownerEmails: ["ann@example.com", "a2@example.net"] },
  // Same owner on another roster (cross-category), no email on this one.
  { id: "p3", name: "3 Elm Street", category: "silver", ownership: "managed", ownerName: "Ann Able" },
  { id: "p4", name: "4 Elm Street", category: "silver", ownership: "managed", ownerName: "Bo Best & Cy Cole", ownerEmails: ["bo@example.org", "cy@example.org"] },
  { id: "p5", name: "5 Pine Street", category: "make_up", ownership: "company_owned", ownerName: "Dee Dot and Eve Ell", ownerEmails: ["dee@example.com"] },
  { id: "p6", name: "6 Pine Street", category: "make_up", ownership: "company_owned", ownerName: "Fay Fox / Gus Gold", ownerEmails: ["fay@example.com"] },
  { id: "p7", name: "7 Birch Road", category: "gold", ownership: "managed" }, // no owner on the roster
  { id: "p8", name: "8 Birch Road", category: "silver", ownership: "managed", ownerName: "   " }, // blank = no owner
  { id: "p9", name: "9 Hand Made Lane" }, // made by hand: no category, no owner
];

const fresh = (extra = {}) => L.planImport({ properties: PROPERTIES, owners: [], links: [], ...extra });

/** The database after carrying out a plan, as the next run would read it. */
function applyPlan(plan, owners, links) {
  const o = owners.map((x) => ({ ...x, emails: [...x.emails] }));
  const l = links.map((x) => ({ ...x }));
  const idOf = new Map();
  for (const op of plan.ownerOps) {
    if (op.kind === "create") {
      const id = `o${o.length + 1}`;
      o.push({ id, ...op.fields, importKey: op.importKey });
      idOf.set(op.importKey, id);
    } else {
      idOf.set(op.importKey, op.ownerId);
      if (op.kind === "patch") Object.assign(o.find((x) => x.id === op.ownerId), op.patch);
    }
  }
  for (const op of plan.linkOps) l.push({ ownerId: idOf.get(op.importKey), propertyId: op.propertyId });
  return { owners: o, links: l };
}

// --- grouping ------------------------------------------------------------------------------------

test("group: name + email; a no-email property joins the one owner of that name (flagged)", () => {
  const g = L.groupRosterOwners(PROPERTIES);
  assert.deepEqual(
    g.owners.map((o) => [o.importKey, o.legalName, o.properties.map((p) => p.id), o.nameOnly]),
    [
      ["ann able", "Ann Able", ["p1", "p2", "p3"], ["3 Elm Street"]],
      ["bo best & cy cole", "Bo Best & Cy Cole", ["p4"], []],
      ["dee dot and eve ell", "Dee Dot and Eve Ell", ["p5"], []],
      ["fay fox / gus gold", "Fay Fox / Gus Gold", ["p6"], []],
    ],
  );
  assert.deepEqual(g.ambiguous, []);
});

test("group: emails are the lowercased, de-duplicated union in property order", () => {
  const ann = L.groupRosterOwners(PROPERTIES).owners.find((o) => o.importKey === "ann able");
  assert.deepEqual(ann.emails, ["ann@example.com", "a2@example.net"]);
});

test("group: same name with different emails = two owners; a chain of shared emails = one", () => {
  const props = [
    { id: "x1", name: "1 X St", ownerName: "Sam Same", ownerEmails: ["s1@example.com"] },
    { id: "x2", name: "2 X St", ownerName: "sam same", ownerEmails: ["s2@example.com"] },
    { id: "x3", name: "3 X St", ownerName: "Sam Same", ownerEmails: ["s2@example.com", "s3@example.com"] },
    { id: "x4", name: "4 X St", ownerName: "Sam Same" }, // no email, two owners of that name
    { id: "y1", name: "1 Y St", ownerName: "Chain", ownerEmails: ["c1@example.com"] },
    { id: "y2", name: "2 Y St", ownerName: "Chain", ownerEmails: ["c2@example.com"] },
    { id: "y3", name: "3 Y St", ownerName: "Chain", ownerEmails: ["c1@example.com", "c2@example.com"] }, // joins y1 and y2
  ];
  const g = L.groupRosterOwners(props);
  assert.deepEqual(
    g.owners.map((o) => [o.importKey, o.properties.map((p) => p.id), o.emails]),
    [
      ["sam same", ["x1"], ["s1@example.com"]],
      ["sam same#2", ["x2", "x3"], ["s2@example.com", "s3@example.com"]],
      ["chain", ["y1", "y2", "y3"], ["c1@example.com", "c2@example.com"]],
    ],
  );
  assert.deepEqual(g.ambiguous.map((a) => [a.property.id, a.owners]), [["x4", 2]]);
});

test("twoOwnerReason: flags /, & and 'and'; never for a plain name", () => {
  assert.equal(L.twoOwnerReason("Bo Best & Cy Cole"), 'contains " & "');
  assert.equal(L.twoOwnerReason("Dee Dot AND Eve Ell"), 'contains " and "');
  assert.equal(L.twoOwnerReason("Fay Fox/Gus Gold"), 'contains "/"');
  assert.equal(L.twoOwnerReason("Andrea Sandberg"), null);
  assert.equal(L.twoOwnerReason("Ann Able"), null);
});

// --- the plan and the report ---------------------------------------------------------------------

test("plan from empty: owners and links, nothing invented", () => {
  const { report, ownerOps, linkOps } = fresh();
  assert.deepEqual(report.owners, { created: 4, updated: 0, unchanged: 0 });
  assert.deepEqual(report.links, { created: 6, existing: 0 });
  assert.deepEqual(
    linkOps.map((l) => `${l.importKey}>${l.propertyId}`),
    ["ann able>p1", "ann able>p2", "ann able>p3", "bo best & cy cole>p4", "dee dot and eve ell>p5", "fay fox / gus gold>p6"],
  );
  for (const op of ownerOps) {
    assert.equal(op.kind, "create");
    assert.deepEqual(Object.keys(op.fields).sort(), ["emails", "legalName", "nameKey"]);
  }
  const ann = ownerOps.find((o) => o.importKey === "ann able");
  assert.deepEqual(ann.fields, { legalName: "Ann Able", nameKey: "ann able", emails: ["ann@example.com", "a2@example.net"] });
  // A two-owner-looking name stays one owner, not split.
  assert.equal(ownerOps.filter((o) => o.importKey.includes("bo best")).length, 1);
});

test("report: no-owner properties, flags, cross-category, company-owned, two-owner names", () => {
  const { report } = fresh();
  assert.deepEqual(report.noOwner, ["7 Birch Road (Gold)", "8 Birch Road (Silver)", "9 Hand Made Lane (No category)"]);
  assert.deepEqual(
    report.flags.map((f) => f.flag),
    ["name_only_match"],
  );
  assert.match(report.flags[0].detail, /3 Elm Street has no email and joined this owner by name only/);
  assert.deepEqual(report.crossCategory, ["Ann Able (Gold, Silver; 3 properties)"]);
  assert.deepEqual(report.companyOwned, [
    { owner: "Dee Dot and Eve Ell", properties: ["5 Pine Street"] },
    { owner: "Fay Fox / Gus Gold", properties: ["6 Pine Street"] },
  ]);
  assert.deepEqual(report.twoOwnerNames, [
    { owner: "Bo Best & Cy Cole", reason: 'contains " & "', properties: 1 },
    { owner: "Dee Dot and Eve Ell", reason: 'contains " and "', properties: 1 },
    { owner: "Fay Fox / Gus Gold", reason: 'contains "/"', properties: 1 },
  ]);
  assert.deepEqual(report.coOwned, []);
  assert.deepEqual(report.linkedElsewhere, []);
  assert.deepEqual(report.invalid, []);
  assert.deepEqual(report.byCategory.gold, { properties: 3, withOwner: 2, noOwner: 1, companyOwned: 0, linksToCreate: 2, linksExisting: 0 });
  assert.deepEqual(report.byCategory.silver, { properties: 3, withOwner: 2, noOwner: 1, companyOwned: 0, linksToCreate: 2, linksExisting: 0 });
  assert.deepEqual(report.byCategory.make_up, { properties: 2, withOwner: 2, noOwner: 0, companyOwned: 2, linksToCreate: 2, linksExisting: 0 });
  assert.deepEqual(report.byCategory.none, { properties: 1, withOwner: 0, noOwner: 1, companyOwned: 0, linksToCreate: 0, linksExisting: 0 });
  assert.deepEqual(report.ownersToCreate, [
    "Ann Able (3 properties)",
    "Bo Best & Cy Cole (1 property)",
    "Dee Dot and Eve Ell (1 property)",
    "Fay Fox / Gus Gold (1 property)",
  ]);
  assert.equal("linksToCreate" in report, false);
});

test("report never holds a full email address", () => {
  const props = [
    ...PROPERTIES,
    { id: "z1", name: "1 Z St", ownerName: "Ann Able", ownerEmails: ["other@example.org"] },
    { id: "z2", name: "2 Z St", ownerName: "Zed Zee", ownerEmails: ["bo@example.org"] },
  ];
  const text = JSON.stringify(L.planImport({ properties: props, owners: [], links: [] }).report);
  for (const e of ["ann@example.com", "a2@example.net", "bo@example.org", "cy@example.org", "dee@example.com", "fay@example.com", "other@example.org"]) {
    assert.equal(text.toLowerCase().includes(e), false, e);
  }
});

test("an owner the owner rules refuse is reported, not created or linked", () => {
  const many = ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@example.com`);
  const properties = [
    { id: "q1", name: "1 A St", category: "gold", ownerName: "Six Mail", ownerEmails: [...many.slice(0, 3)] },
    { id: "q2", name: "2 A St", category: "gold", ownerName: "Six Mail", ownerEmails: ["a@example.com", ...many.slice(3)] },
  ];
  const plan = L.planImport({ properties, owners: [], links: [] });
  assert.equal(plan.ownerOps.length, 0);
  assert.equal(plan.linkOps.length, 0);
  assert.equal(plan.report.invalid.length, 1);
  assert.equal(plan.report.invalid[0].owner, "Six Mail");
  assert.equal(plan.report.invalid[0].properties, 2);
  assert.match(plan.report.invalid[0].message, /at most 5/);
  assert.equal(plan.report.invalid[0].message.includes("a@example.com"), false);
});

// --- identity flags ------------------------------------------------------------------------------

test("identity: same name + different emails -> two owners, flagged; same email + different names -> two owners, flagged", () => {
  const properties = [
    { id: "s1", name: "1 S St", category: "gold", ownerName: "Sam Same", ownerEmails: ["sam@example.com"] },
    { id: "s2", name: "2 S St", category: "silver", ownerName: "SAM  SAME.", ownerEmails: ["sam.other@example.net"] },
    { id: "e1", name: "1 E St", category: "gold", ownerName: "Eve Evans", ownerEmails: ["shared@example.com"] },
    { id: "e2", name: "2 E St", category: "gold", ownerName: "Evans Holdings LLC", ownerEmails: ["shared@example.com"] },
  ];
  const plan = L.planImport({ properties, owners: [], links: [] });
  assert.deepEqual(plan.report.owners, { created: 4, updated: 0, unchanged: 0 });
  assert.deepEqual(plan.report.links, { created: 4, existing: 0 });
  assert.deepEqual(plan.ownerOps.map((o) => o.importKey), ["sam same", "sam same#2", "eve evans", "evans holdings llc"]);
  assert.deepEqual(plan.report.flags.map((f) => f.flag).sort(), ["same_email_different_name", "same_name_different_email"]);
  const shared = plan.report.flags.find((f) => f.flag === "same_email_different_name");
  assert.match(shared.detail, /s\*\*\*@example\.com: possibly the same owner/);
});

test("identity: joint names on @518propertypro.com addresses only flag an EXACT shared address", () => {
  const properties = [
    { id: "j1", name: "1 J St", category: "make_up", ownership: "company_owned", ownerName: "Pat Fiore & Alex Buell", ownerEmails: ["pat@518propertypro.com", "alex@518propertypro.com"] },
    { id: "j2", name: "2 J St", category: "make_up", ownership: "company_owned", ownerName: "Property Pro Rentals, LLC", ownerEmails: ["rentals@518propertypro.com"] },
    { id: "j3", name: "3 J St", category: "make_up", ownership: "company_owned", ownerName: "Pat Fiore & Alex Buell", ownerEmails: ["alex@518propertypro.com", "pat@518propertypro.com"] },
  ];
  const plan = L.planImport({ properties, owners: [], links: [] });
  assert.deepEqual(plan.report.owners.created, 2);
  assert.deepEqual(plan.report.flags, []); // same domain is not a match
  const withShared = [...properties, { id: "j4", name: "4 J St", ownerName: "Fiore Family Trust", ownerEmails: ["pat@518propertypro.com"] }];
  const again = L.planImport({ properties: withShared, owners: [], links: [] });
  assert.equal(again.report.owners.created, 3); // never merged
  assert.deepEqual(again.report.flags.map((f) => f.flag), ["same_email_different_name"]);
});

test("identity: a no-email property is not linked when its name matches two roster owners", () => {
  const properties = [
    { id: "a1", name: "1 A St", ownerName: "Ann Able", ownerEmails: ["one@example.com"] },
    { id: "a2", name: "2 A St", ownerName: "Ann Able", ownerEmails: ["two@example.com"] },
    { id: "a3", name: "3 A St", ownerName: "ann able" },
  ];
  const plan = L.planImport({ properties, owners: [], links: [] });
  assert.equal(plan.linkOps.some((l) => l.propertyId === "a3"), false);
  assert.deepEqual(plan.report.flags.map((f) => f.flag).sort(), ["name_only_ambiguous", "same_name_different_email"]);
});

test("against owners in the app: several matches, an inactive match and a merged owner", () => {
  const properties = [
    { id: "k1", name: "1 K St", ownerName: "Kim Key", ownerEmails: ["k1@example.com", "k2@example.com"] },
    { id: "i1", name: "1 I St", ownerName: "Ina Inactive", ownerEmails: ["ina@example.com"] },
    { id: "m1", name: "1 M St", ownerName: "Mo Merged", ownerEmails: ["mo@example.com"] },
  ];
  const owners = [
    { id: "o1", legalName: "Kim Key", nameKey: "kim key", emails: ["k1@example.com"] },
    { id: "o2", legalName: "Kim Key", nameKey: "kim key", emails: ["k2@example.com"] },
    { id: "o3", legalName: "Ina Inactive", nameKey: "ina inactive", emails: ["ina@example.com"], active: false },
    { id: "o4", legalName: "Mo Merged", nameKey: "mo merged", emails: ["mo@example.com"], active: false, mergedIntoOwnerId: "o5" },
    { id: "o5", legalName: "Mo Merged", nameKey: "mo merged", emails: ["mo@example.com"] },
  ];
  const plan = L.planImport({ properties, owners, links: [] });
  assert.deepEqual(plan.linkOps.map((l) => [l.propertyId, l.ownerId]), [["m1", "o5"]]);
  assert.equal(plan.ownerOps.some((o) => o.kind === "create"), false);
  const flags = plan.report.flags.map((f) => f.flag);
  assert.ok(flags.includes("several_owners_match"));
  assert.ok(flags.includes("inactive_owner_match"));
});

test("two roster owners reaching one app owner by name only are not imported", () => {
  const properties = [
    { id: "a1", name: "1 A St", ownerName: "Ann Able", ownerEmails: ["one@example.com"] },
    { id: "a2", name: "2 A St", ownerName: "Ann Able", ownerEmails: ["two@example.com"] },
  ];
  const owners = [{ id: "o1", legalName: "Ann Able", nameKey: "ann able", emails: [] }];
  const plan = L.planImport({ properties, owners, links: [] });
  assert.deepEqual(plan.linkOps, []);
  assert.deepEqual(plan.ownerOps, []);
  assert.equal(plan.report.flags.filter((f) => f.flag === "name_only_match").length, 2);
  assert.deepEqual(plan.report.needsOwner.map((n) => n.property), ["1 A St", "2 A St"]);
});

test("'Not the same owner' decisions suppress the flag between two owners", () => {
  const properties = [
    { id: "e1", name: "1 E St", ownerName: "Eve Evans", ownerEmails: ["shared@example.com"] },
    { id: "e2", name: "2 E St", ownerName: "Evans Holdings LLC", ownerEmails: ["shared@example.com"] },
  ];
  const owners = [
    { id: "o1", legalName: "Eve Evans", nameKey: "eve evans", emails: ["shared@example.com"] },
    { id: "o2", legalName: "Evans Holdings LLC", nameKey: "evans holdings llc", emails: ["shared@example.com"] },
  ];
  const flagged = L.planImport({ properties, owners, links: [] });
  assert.ok(flagged.report.flags.length > 0);
  const quiet = L.planImport({ properties, owners, links: [], dismissedOwnerPairs: [I.ownerPairKey("o2", "o1")] });
  assert.deepEqual(quiet.report.flags, []);
  assert.deepEqual(quiet.linkOps.map((l) => [l.propertyId, l.ownerId]), [["e1", "o1"], ["e2", "o2"]]);
});

// --- idempotency, adoption, links, drafts --------------------------------------------------------

test("idempotent: a second run creates nothing (the dry-run second pass contract)", () => {
  const first = fresh();
  const db = applyPlan(first, [], []);
  const second = L.planImport({ properties: PROPERTIES, ...db });
  assert.deepEqual(second.report.owners, { created: 0, updated: 0, unchanged: 4 });
  assert.deepEqual(second.report.links, { created: 0, existing: 6 });
  assert.equal(second.linkOps.length, 0);
  assert.equal(second.ownerOps.every((o) => o.kind === "unchanged"), true);
  assert.deepEqual(second.report.differsFromRoster, []);
});

test("an owner typed in by hand: adopted only on name + email; name only or a look-alike waits for a person", () => {
  // MEDIUM-1: a name-only match is never adopted, and a look-alike in the app blocks the link.
  const owners = [
    { id: "m1", legalName: "ANN ABLE", nameKey: "ann able", emails: [] },
    { id: "m2", legalName: "Bo Best & Cy Cole", nameKey: "bo best & cy cole", emails: ["edited@example.com"], contactFirstName: "Bo" },
  ];
  const plan = L.planImport({ properties: PROPERTIES, owners, links: [] });
  assert.deepEqual(plan.report.owners, { created: 2, updated: 0, unchanged: 0 });
  assert.equal(plan.ownerOps.some((o) => o.importKey === "ann able"), false);
  assert.equal(plan.ownerOps.some((o) => o.importKey === "bo best & cy cole"), false);
  assert.equal(plan.linkOps.some((l) => ["p1", "p2", "p3", "p4"].includes(l.propertyId)), false);
  assert.ok(plan.report.flags.some((f) => f.flag === "name_only_match" && f.detail.includes("ANN ABLE") && f.detail.includes("Not linked")));
  assert.ok(plan.report.flags.some((f) => f.flag === "same_name_different_email" && f.detail.includes("Bo Best & Cy Cole")));
  assert.deepEqual(
    plan.report.needsOwner.map((n) => [n.property, n.reason]),
    [
      ["1 Oak Street", "matches “ANN ABLE” by name only"],
      ["2 Oak Street", "matches “ANN ABLE” by name only"],
      ["3 Elm Street", "matches “ANN ABLE” by name only"],
      ["4 Elm Street", "Same name, different email: “Bo Best & Cy Cole”"],
    ],
  );
  // MEDIUM-2: Bo gets no link, so no owner is created for it; it is listed instead.
  assert.deepEqual(plan.report.notCreated, ["Bo Best & Cy Cole (1 property)"]);
  assert.equal(plan.report.ownersToCreate.length, 2);
  // An owner with the same name AND a shared email is adopted (only the import key is filled in).
  const typed = [{ id: "m1", legalName: "ANN ABLE", nameKey: "ann able", emails: ["ann@example.com"] }];
  const adopted = L.planImport({ properties: PROPERTIES, owners: typed, links: [] });
  const ann = adopted.ownerOps.find((o) => o.importKey === "ann able");
  assert.deepEqual([ann.kind, ann.ownerId, ann.patch], ["patch", "m1", { importKey: "ann able" }]);
  assert.equal(adopted.linkOps.filter((l) => l.importKey === "ann able").every((l) => l.ownerId === "m1"), true);
  assert.deepEqual(adopted.report.differsFromRoster, [{ owner: "ANN ABLE", fields: ["legalName", "emails"] }]);
  const db = applyPlan(adopted, typed, []);
  assert.deepEqual(L.planImport({ properties: PROPERTIES, ...db }).report.owners, { created: 0, updated: 0, unchanged: 4 });
});

test("a property moved to another owner by hand is never re-linked to the roster owner (no co-owning)", () => {
  // Ann was linked to 1 Oak Street, then the accountant unlinked her and linked Manual Owner.
  const owners = [
    { id: "ann", legalName: "Ann Able", nameKey: "ann able", emails: ["ann@example.com", "a2@example.net"] },
    { id: "m9", legalName: "Manual Owner", nameKey: "manual owner", emails: [] },
  ];
  const links = [{ ownerId: "m9", propertyId: "p1" }];
  const plan = L.planImport({ properties: PROPERTIES, owners, links });
  assert.equal(plan.linkOps.some((l) => l.propertyId === "p1"), false);
  assert.deepEqual(plan.report.linkedElsewhere, [{ property: "1 Oak Street", roster: "Ann Able", linkedTo: ["Manual Owner"] }]);
  assert.deepEqual(plan.report.coOwned, []);
  // Re-running changes nothing: the manual link stays the only link, and nothing is removed.
  const db = applyPlan(plan, owners, links);
  assert.deepEqual(db.links.filter((l) => l.propertyId === "p1"), [{ ownerId: "m9", propertyId: "p1" }]);
  const again = L.planImport({ properties: PROPERTIES, ...db });
  assert.equal(again.linkOps.length, 0);
  assert.deepEqual(again.report.coOwned, []);
  assert.deepEqual(again.report.linkedElsewhere, [{ property: "1 Oak Street", roster: "Ann Able", linkedTo: ["Manual Owner"] }]);
  // An owner name removed from the roster keeps its existing link (nothing is deleted).
  const renamed = PROPERTIES.map((p) => (p.id === "p4" ? { ...p, ownerName: undefined } : p));
  const later = L.planImport({ properties: renamed, ...db });
  assert.equal(later.linkOps.length, 0);
  assert.equal(later.ownerOps.some((o) => o.importKey === "bo best & cy cole"), false);
});

test("an existing co-owned property is reported; no third link is added", () => {
  const owners = [
    { id: "x", legalName: "X Owner", nameKey: "x owner", emails: [] },
    { id: "y", legalName: "Y Owner", nameKey: "y owner", emails: [] },
  ];
  const links = [{ ownerId: "x", propertyId: "p1" }, { ownerId: "y", propertyId: "p1" }];
  const plan = L.planImport({ properties: PROPERTIES, owners, links });
  assert.deepEqual(plan.report.coOwned, [{ property: "1 Oak Street", owners: ["X Owner", "Y Owner"] }]);
  assert.equal(plan.linkOps.some((l) => l.propertyId === "p1"), false);
});

test("a property on an open statement draft gets no new link and is listed", () => {
  const plan = fresh({ draftPropertyIds: ["p2", "p7"] });
  assert.equal(plan.linkOps.some((l) => l.propertyId === "p2"), false);
  assert.deepEqual(plan.report.skippedOpenDraft, ["2 Oak Street -> Ann Able"]);
  assert.deepEqual(plan.report.links, { created: 5, existing: 0 });
  // An existing link on a draft property is just "existing", not skipped.
  const db = applyPlan(fresh(), [], []);
  const again = L.planImport({ properties: PROPERTIES, ...db, draftPropertyIds: ["p2"] });
  assert.deepEqual(again.report.skippedOpenDraft, []);
  assert.deepEqual(again.report.links, { created: 0, existing: 6 });
});

// --- verifier fixes (2026-11-11) ------------------------------------------------------------------

test("HIGH-1: a property marked “Not the same owner” for the matched owner is never linked to it", () => {
  const properties = [
    { id: "d1", name: "1 D St", ownerName: "Ann Able", ownerEmails: ["ann@example.com"] },
    { id: "d2", name: "2 D St", ownerName: "Ann Able", ownerEmails: ["ann@example.com", "a2@example.net"] },
  ];
  // The group's emails (ann + a2) match the owner exactly, but 1 D St on its own was dismissed.
  const owners = [{ id: "o1", legalName: "Ann Able", nameKey: "ann able", emails: ["a2@example.net"] }];
  const sig = I.identitySignature(I.identityOf("Ann Able", ["ann@example.com"]));
  const dismissedPropertyOwner = [I.propertyOwnerKey("d1", "o1", sig)];
  const plan = L.planImport({ properties, owners, links: [], dismissedPropertyOwner });
  assert.deepEqual(plan.linkOps.map((l) => [l.propertyId, l.ownerId]), [["d2", "o1"]]);
  assert.deepEqual(plan.report.needsOwner, [{ property: "1 D St", roster: "Ann Able", reason: "marked “Not the same owner” for “Ann Able”" }]);
  assert.ok(plan.report.flags.some((f) => f.flag === "dismissed_owner" && f.detail.includes("1 D St")));
  // Dismissed for every property: nothing linked, and no duplicate owner is created either.
  const sig2 = I.identitySignature(I.identityOf("Ann Able", ["ann@example.com", "a2@example.net"]));
  const all = L.planImport({ properties, owners, links: [], dismissedPropertyOwner: [...dismissedPropertyOwner, I.propertyOwnerKey("d2", "o1", sig2)] });
  assert.deepEqual(all.linkOps, []);
  assert.equal(all.ownerOps.some((o) => o.kind === "create"), false);
  assert.equal(all.report.needsOwner.length, 2);
  // Without the dismissal both are linked (the dismissal is what stops it).
  assert.equal(L.planImport({ properties, owners, links: [] }).linkOps.length, 2);
});

test("MEDIUM-1: an exact match next to a flagged look-alike in the app is not adopted; it waits on Needs an owner", () => {
  const properties = [{ id: "e1", name: "1 E St", ownerName: "Eve Evans", ownerEmails: ["shared@example.com"] }];
  const owners = [
    { id: "o1", legalName: "Eve Evans", nameKey: "eve evans", emails: ["shared@example.com"] },
    { id: "o2", legalName: "Evans Holdings LLC", nameKey: "evans holdings llc", emails: ["shared@example.com"] },
  ];
  const plan = L.planImport({ properties, owners, links: [] });
  assert.deepEqual(plan.linkOps, []);
  assert.deepEqual(plan.report.needsOwner.map((n) => n.reason), ["Same email, different name: possibly the same owner: “Evans Holdings LLC”"]);
  // No new owner beside a look-alike either (the automatic link would not make one).
  const fresh2 = L.planImport({ properties: [{ id: "n1", name: "1 N St", ownerName: "Evans Holdings Two", ownerEmails: ["shared@example.com"] }], owners: [owners[0]], links: [] });
  assert.deepEqual([fresh2.ownerOps, fresh2.linkOps, fresh2.report.notCreated], [[], [], ["Evans Holdings Two (1 property)"]]);
  // Already linked to the matched owner: counted as existing, not reported as needing an owner.
  const linked = L.planImport({ properties, owners, links: [{ ownerId: "o1", propertyId: "e1" }] });
  assert.deepEqual([linked.report.links, linked.report.needsOwner], [{ created: 0, existing: 1 }, []]);
});

test("MEDIUM-2: no owner is created when none of its properties gets a link; ownersToCreate is what happens", () => {
  const properties = [
    { id: "a1", name: "1 A St", ownerName: "Ann Able", ownerEmails: ["ann@example.com"] },
    { id: "a2", name: "2 A St", ownerName: "Ann Able", ownerEmails: ["ann@example.com"] },
    { id: "b1", name: "1 B St", ownerName: "Bo Best", ownerEmails: ["bo@example.com"] },
    { id: "c1", name: "1 C St", ownerName: "Cy Cole", ownerEmails: ["cy@example.com"] },
  ];
  const owners = [{ id: "x", legalName: "Someone Else", nameKey: "someone else", emails: [] }];
  const links = [{ ownerId: "x", propertyId: "a1" }, { ownerId: "x", propertyId: "a2" }];
  const plan = L.planImport({ properties, owners, links, draftPropertyIds: ["b1"] });
  assert.deepEqual(plan.ownerOps.map((o) => [o.kind, o.importKey]), [["create", "cy cole"]]);
  assert.deepEqual(plan.report.ownersToCreate, ["Cy Cole (1 property)"]);
  assert.deepEqual(plan.report.notCreated, ["Ann Able (2 properties)", "Bo Best (1 property)"]);
  assert.deepEqual(plan.report.owners, { created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(plan.linkOps.map((l) => l.propertyId), ["c1"]);
  assert.equal(plan.report.linkedElsewhere.length, 2);
  assert.deepEqual(plan.report.skippedOpenDraft, ["1 B St -> Bo Best"]);
});

test("LOW-1: a chain of shared emails is still one owner, flagged; so is an app owner bridging two roster owners", () => {
  const props = [
    { id: "y1", name: "1 Y St", ownerName: "Chain", ownerEmails: ["c1@example.com"] },
    { id: "y2", name: "2 Y St", ownerName: "Chain", ownerEmails: ["c2@example.com"] },
    { id: "y3", name: "3 Y St", ownerName: "Chain", ownerEmails: ["c1@example.com", "c2@example.com"] },
    { id: "x2", name: "2 X St", ownerName: "Sam Same", ownerEmails: ["s2@example.com"] },
    { id: "x3", name: "3 X St", ownerName: "Sam Same", ownerEmails: ["s2@example.com", "s3@example.com"] },
  ];
  const g = L.groupRosterOwners(props);
  assert.deepEqual(g.owners.map((o) => [o.importKey, o.properties.length, o.chained]), [["chain", 3, true], ["sam same", 2, false]]);
  const plan = L.planImport({ properties: props, owners: [], links: [] });
  assert.deepEqual(plan.report.flags.map((f) => f.flag), ["joined_via_shared_email_chain"]);
  assert.match(plan.report.flags[0].detail, /“Chain” \(3 properties\).*chain of shared emails/);
  assert.equal(plan.linkOps.length, 5); // still grouped and linked
  // Two roster owners with different emails, joined by one app owner that has both emails.
  const bridge = [
    { id: "b1", name: "1 B St", ownerName: "Bo Best", ownerEmails: ["one@example.com"] },
    { id: "b2", name: "2 B St", ownerName: "Bo Best", ownerEmails: ["two@example.com"] },
  ];
  const owners = [{ id: "o1", legalName: "Bo Best", nameKey: "bo best", emails: ["one@example.com", "two@example.com"] }];
  const bp = L.planImport({ properties: bridge, owners, links: [] });
  assert.deepEqual(bp.linkOps.map((l) => [l.propertyId, l.ownerId]), [["b1", "o1"], ["b2", "o1"]]);
  assert.deepEqual(bp.report.flags.map((f) => f.flag), ["joined_via_shared_email_chain"]);
  assert.match(bp.report.flags[0].detail, /owner already in the app “Bo Best”/);
});

test("LOW-3: an owner email that isn't a valid address is ignored (as the automatic link does) and reported", () => {
  const properties = [
    { id: "v1", name: "1 V St", ownerName: "Val Valid", ownerEmails: ["val@example.com", "not-an-email"] },
    { id: "v2", name: "2 V St", ownerName: "Nia None", ownerEmails: ["nope@"] },
  ];
  const plan = L.planImport({ properties, owners: [], links: [] });
  assert.deepEqual(plan.report.ignoredEmails, ["1 V St: 1 owner email isn't a valid address", "2 V St: 1 owner email isn't a valid address"]);
  const val = plan.ownerOps.find((o) => o.importKey === "val valid");
  assert.deepEqual(val.fields.emails, ["val@example.com"]);
  // Nia has no valid email left: a name with no email is still one owner (roster rule), no email stored.
  assert.deepEqual(plan.ownerOps.find((o) => o.importKey === "nia none").fields.emails, []);
  assert.equal(JSON.stringify(plan.report).includes("nope@"), false);
});

// --- dry-run payload size --------------------------------------------------------------------------

/** 150 properties, 50 owners, realistic lengths and plenty to report. */
function bigRoster() {
  const cats = ["gold", "silver", "make_up"];
  const streets = ["Washington Avenue", "Remsen Street", "Delaware Avenue", "Spring Street", "Hudson River Road", "Madison Avenue"];
  const properties = [];
  for (let i = 0; i < 150; i++) {
    const o = i % 50;
    const company = o < 3;
    const ownerName =
      i % 37 === 5
        ? undefined
        : company
          ? ["Property Pro Rentals, LLC", "Pat Fiore & Alex Buell", "Delia Rentals and Management LLC"][o]
          : `${["Hudson", "Capital", "Mohawk", "Albany", "Troy"][o % 5]} Valley Holdings ${o} LLC`;
    const email = company
      ? [`rentals${o}@518propertypro.com`, `pat@518propertypro.com`]
      : [`owner.number.${o}@examplemail.com`];
    properties.push({
      id: `p${i}`,
      name: `${100 + i} ${streets[i % streets.length]}, Building ${i}`,
      category: cats[(i + o) % 3],
      ownership: company ? "company_owned" : "managed",
      ...(ownerName ? { ownerName } : {}),
      // A few owners with a second, different email on one building (same name, different email).
      ownerEmails: i % 29 === 7 ? [`second.address.${o}@otherexample.org`] : email,
    });
  }
  return properties;
}

test("dry-run report for a realistic 150-property / 50-owner roster serializes under 12 KB", () => {
  const plan = L.planImport({ properties: bigRoster(), owners: [], links: [] });
  const payload = { kind: "dry_run", dryRun: true, report: L.compactReport(plan.report), secondPass: { owners: plan.report.owners, links: plan.report.links } };
  const bytes = L.jsonBytes(payload);
  assert.ok(bytes < 12_000, `dry-run payload is ${bytes} bytes`);
  assert.equal(plan.report.truncated, undefined);
  assert.ok(plan.report.flags.length > 0);
  assert.ok(plan.report.companyOwned.length > 0);
  assert.ok(plan.report.noOwner.length > 0);
});

test("compactReport cuts the longest lists to fit and says how many items it left out", () => {
  const huge = L.planImport({
    properties: Array.from({ length: 900 }, (_, i) => ({
      id: `h${i}`,
      name: `${i} A Very Long Street Name For Testing The Report Size Limit`,
      category: "gold",
      ownership: "company_owned",
      ownerName: `Owner With A Long Legal Name Number ${i} LLC`,
      ownerEmails: [`owner${i}@example.com`],
    })),
    owners: [],
    links: [],
  }).report;
  assert.ok(L.jsonBytes(huge) > L.MAX_REPORT_BYTES);
  const cut = L.compactReport(huge);
  assert.ok(L.jsonBytes(cut) <= L.MAX_REPORT_BYTES);
  assert.ok(Object.values(cut.truncated).reduce((a, b) => a + b, 0) > 0);
  assert.deepEqual(cut.owners, huge.owners); // counts are never cut
  assert.equal(huge.truncated, undefined); // the input is not changed
});

// --- CLI guards ----------------------------------------------------------------------------------

test("CLI: refuses --prod, unknown modes and a deployment that is not the dev one in .env.local", () => {
  assert.throws(() => CLI.parseArgs(["apply", "--org", "o", "--deployment", "d", "--prod"]), /--prod/);
  assert.throws(() => CLI.parseArgs(["delete", "--org", "o", "--deployment", "d"]), /dry-run/);
  assert.throws(() => CLI.parseArgs(["dry-run", "--deployment", "d"]), /--org/);
  assert.throws(() => CLI.parseArgs(["dry-run", "--org", "o", "--file", "x.json"]), /Unknown argument/);
  assert.deepEqual(CLI.parseArgs(["dry-run", "--org", "o1", "--deployment", "happy-cat-1"]), {
    mode: "dry-run",
    org: "o1",
    deployment: "happy-cat-1",
  });
  const env = "# comment\nCONVEX_DEPLOYMENT=dev:happy-cat-1 # team: x\n";
  assert.equal(CLI.deploymentProblem("happy-cat-1", env), null);
  assert.match(CLI.deploymentProblem("other-dog-2", env), /refusing/);
  assert.match(CLI.deploymentProblem("happy-cat-1", "CONVEX_DEPLOYMENT=prod:happy-cat-1\n"), /refusing/);
});

test("CLI: dry-run data is read from stderr; the printed report has no full email", () => {
  const stderr = 'Error: [Request ID: 1] Server Error\nUncaught ConvexError: {"kind":"dry_run","report":{"note":"a } in text"}}\n    at handler (x.ts:1:1)\n';
  assert.deepEqual(CLI.dryRunData(stderr), { kind: "dry_run", report: { note: "a } in text" } });
  assert.equal(CLI.dryRunData("nothing here"), null);
  const lines = [];
  CLI.printReport(fresh().report, "test", { owners: { created: 0, updated: 0 }, links: { created: 0 } }, (l) => lines.push(l));
  const out = lines.join("\n");
  assert.match(out, /Owners: created 4/);
  assert.match(out, /Gold: 3 properties/);
  assert.match(out, /9 Hand Made Lane \(No category\)/);
  assert.equal(out.includes("ann@example.com"), false);
});
