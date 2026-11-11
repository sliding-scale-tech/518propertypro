// Unit tests for owner identity (ROS, user decision 2026-11-11: an owner is NAME + EMAIL):
// convex/ownerIdentity.ts (the rule, the automatic link decision for a saved property, merge
// preconditions) plus source scans of the property write paths that call it. No packages.
// From dashboard/:
//   node --test scripts/probes/ros_owner_identity.test.mjs
// Every name and email here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const I = await import("../../convex/ownerIdentity.ts");
const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const read = (f) => readFileSync(join(CONVEX, f), "utf8");

const id = (name, emails = []) => I.identityOf(name, emails);
const cmp = (a, b) => I.compareIdentity(a, b);

// --- the rule ------------------------------------------------------------------------------------

test("rule: same name + a shared email = same owner, no flag", () => {
  assert.deepEqual(cmp(id("Ann Able", ["ann@x.com"]), id("Ann Able", ["ann@x.com", "a2@y.com"])), {
    same: true,
    flag: null,
    sharedEmails: ["ann@x.com"],
  });
});

test("rule: same name, both have emails, none shared = separate, same_name_different_email", () => {
  assert.deepEqual(cmp(id("Ann Able", ["ann@x.com"]), id("Ann Able", ["other@x.com"])), {
    same: false,
    flag: "same_name_different_email",
    sharedEmails: [],
  });
});

test("rule: different name + a shared email = separate, same_email_different_name", () => {
  assert.deepEqual(cmp(id("Eve Evans", ["e@x.com"]), id("Evans Holdings LLC", ["E@X.com "])), {
    same: false,
    flag: "same_email_different_name",
    sharedEmails: ["e@x.com"],
  });
});

test("rule: same name, one side (or both) without email = same owner, name_only_match", () => {
  assert.deepEqual(cmp(id("Ann Able", []), id("Ann Able", ["ann@x.com"])), { same: true, flag: "name_only_match", sharedEmails: [] });
  assert.deepEqual(cmp(id("Ann Able", ["ann@x.com"]), id("Ann Able", [])), { same: true, flag: "name_only_match", sharedEmails: [] });
  assert.deepEqual(cmp(id("Ann Able"), id("Ann Able")), { same: true, flag: "name_only_match", sharedEmails: [] });
});

test("rule: different name, no shared email = different owners, no flag", () => {
  assert.deepEqual(cmp(id("Ann Able", ["a@x.com"]), id("Bo Best", ["b@x.com"])), { same: false, flag: null, sharedEmails: [] });
  assert.deepEqual(cmp(id("Ann Able"), id("Bo Best")), { same: false, flag: null, sharedEmails: [] });
});

test("normalization: name case, inner spaces and a trailing period; email case and spaces", () => {
  assert.equal(cmp(id("  ANN   able. ", [" Ann@X.COM "]), id("Ann Able", ["ann@x.com"])).flag, null);
  assert.equal(cmp(id("  ANN   able. ", [" Ann@X.COM "]), id("Ann Able", ["ann@x.com"])).same, true);
  assert.deepEqual(I.cleanEmails([" A@x.com", "a@x.com", "", null, undefined, "b@y.org "]), ["a@x.com", "b@y.org"]);
});

test("an empty name never matches by name", () => {
  assert.deepEqual(cmp(id("", []), id("", [])), { same: false, flag: null, sharedEmails: [] });
  assert.equal(cmp(id(null, ["a@x.com"]), id("Ann", ["a@x.com"])).flag, "same_email_different_name");
});

test("joint names on one company domain: only an exact shared address is flagged, never a merge", () => {
  const joint = id("Pat Fiore & Alex Buell", ["pat@518propertypro.com", "alex@518propertypro.com"]);
  assert.deepEqual(cmp(joint, id("Property Pro Rentals, LLC", ["rentals@518propertypro.com"])), { same: false, flag: null, sharedEmails: [] });
  assert.deepEqual(cmp(joint, id("Fiore Family Trust", ["pat@518propertypro.com"])), {
    same: false,
    flag: "same_email_different_name",
    sharedEmails: ["pat@518propertypro.com"],
  });
  assert.equal(cmp(joint, id("pat fiore & alex buell", ["ALEX@518propertypro.com"])).same, true);
});

test("pair keys are order-independent; property keys carry the property page's identity", () => {
  assert.equal(I.ownerPairKey("b", "a"), I.ownerPairKey("a", "b"));
  const sig = I.identitySignature(id("Ann Able.", ["b@x.com", "a@x.com"]));
  assert.equal(sig, "ann able|a@x.com,b@x.com");
  assert.notEqual(I.propertyOwnerKey("p", "o", sig), I.propertyOwnerKey("p", "o", I.identitySignature(id("Ann Able", ["a@x.com"]))));
});

// --- the automatic link decision (linkOwnerForProperty) ------------------------------------------

const owner = (oid, legalName, emails = [], extra = {}) => ({ id: oid, legalName, emails, active: true, ...extra });
const decide = (property, owners, extra = {}) =>
  I.decidePropertyLink({ property: { id: "p1", ...property }, owners, linkedOwnerIds: [], hasOpenDraft: false, ...extra });

test("decide: exact name + email match to exactly one active owner -> link", () => {
  const owners = [owner("o1", "Ann Able", ["ann@x.com"]), owner("o2", "Bo Best", ["bo@x.com"])];
  assert.deepEqual(decide({ ownerName: "ann able", ownerEmails: ["ANN@x.com"] }, owners), { kind: "link", ownerId: "o1" });
});

test("decide: nobody matches or looks alike, name + email present -> create a new owner", () => {
  assert.deepEqual(decide({ ownerName: " New Owner LLC ", ownerEmails: ["New@x.com"] }, [owner("o1", "Ann Able", ["ann@x.com"])]), {
    kind: "create",
    legalName: "New Owner LLC",
    emails: ["new@x.com"],
  });
});

test("decide: never links or creates when anything is uncertain", () => {
  const owners = [owner("o1", "Ann Able", ["ann@x.com"]), owner("o2", "Eve Evans", ["eve@x.com"])];
  const d1 = decide({ ownerName: "Ann Able", ownerEmails: ["new@x.com"] }, owners);
  assert.equal(d1.kind, "needs");
  assert.equal(d1.reason, "flagged");
  assert.deepEqual(d1.candidates.map((c) => [c.ownerId, c.flag]), [["o1", "same_name_different_email"]]);
  const d2 = decide({ ownerName: "Evans Holdings", ownerEmails: ["eve@x.com"] }, owners);
  assert.deepEqual([d2.kind, d2.reason, d2.candidates[0].flag], ["needs", "flagged", "same_email_different_name"]);
  // Property page has no email: same name is only a name-only match.
  const d3 = decide({ ownerName: "Ann Able" }, owners);
  assert.deepEqual([d3.kind, d3.reason, d3.candidates[0].flag], ["needs", "flagged", "name_only_match"]);
  // The owner has no email: the same.
  const d4 = decide({ ownerName: "Bo Best", ownerEmails: ["bo@x.com"] }, [owner("o3", "Bo Best", [])]);
  assert.deepEqual([d4.kind, d4.reason], ["needs", "flagged"]);
  // Exact match, but another owner shares the email under another name: still a person's call.
  const d5 = decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, [...owners, owner("o4", "Able Family Trust", ["ann@x.com"])]);
  assert.deepEqual([d5.kind, d5.reason], ["needs", "flagged"]);
});

test("decide: no name, no email, several matches, inactive owner, invalid data, open draft", () => {
  const owners = [owner("o1", "Ann Able", ["ann@x.com"])];
  assert.deepEqual(decide({ ownerEmails: ["ann@x.com"] }, owners).reason, "no_owner_name");
  assert.deepEqual(decide({ ownerName: "  " }, owners).reason, "no_owner_name");
  assert.deepEqual(decide({ ownerName: "Brand New" }, owners).reason, "no_email");
  const twice = [owner("o1", "Ann Able", ["ann@x.com"]), owner("o2", "Ann Able", ["ann@x.com", "z@x.com"])];
  assert.equal(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, twice).reason, "several_match");
  const off = [owner("o1", "Ann Able", ["ann@x.com"], { active: false })];
  assert.equal(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, off).reason, "inactive_owner");
  const six = ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@x.com`);
  const bad = decide({ ownerName: "Six Mail", ownerEmails: six }, []);
  assert.deepEqual([bad.reason, bad.message], ["invalid_owner_data", "Add at most 5 email addresses."]);
  assert.equal(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, owners, { hasOpenDraft: true }).reason, "open_draft");
});

test("decide: a merged owner is never matched", () => {
  const owners = [owner("old", "Ann Able", ["ann@x.com"], { active: false, mergedIntoOwnerId: "new" }), owner("new", "Ann Able", ["ann@x.com"])];
  assert.deepEqual(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, owners), { kind: "link", ownerId: "new" });
});

test("decide: an existing link is never moved; a different owner on the page is a mismatch", () => {
  const owners = [owner("a", "Ann Able", ["ann@x.com"]), owner("b", "Bo Best", ["bo@x.com"])];
  // Moved to Bo by hand; the property page still names Ann.
  const d = decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, owners, { linkedOwnerIds: ["b"] });
  assert.equal(d.kind, "mismatch");
  assert.deepEqual(d.linkedOwnerIds, ["b"]);
  assert.deepEqual(d.candidates.map((c) => c.ownerId), ["a"]);
  // The page agrees with the link (exact or name-only), or says nothing: nothing to do.
  assert.deepEqual(decide({ ownerName: "Bo Best", ownerEmails: ["bo@x.com"] }, owners, { linkedOwnerIds: ["b"] }), { kind: "linked" });
  assert.deepEqual(decide({ ownerName: "Bo Best" }, owners, { linkedOwnerIds: ["b"] }), { kind: "linked" });
  assert.deepEqual(decide({}, owners, { linkedOwnerIds: ["b"] }), { kind: "linked" });
  // Co-owned: agreeing with one of the owners is enough.
  assert.deepEqual(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com"] }, owners, { linkedOwnerIds: ["a", "b"] }), { kind: "linked" });
});

test("decide: 'Not the same owner' decisions", () => {
  const owners = [owner("a", "Ann Able", ["ann@x.com"]), owner("t", "Able Family Trust", ["ann@x.com"])];
  const property = { ownerName: "Ann Able", ownerEmails: ["ann@x.com"] };
  assert.equal(decide(property, owners).kind, "needs");
  // Ann and the trust confirmed as different owners: the exact match links.
  const pairs = { ownerPairs: new Set([I.ownerPairKey("t", "a")]), propertyOwner: new Set() };
  assert.deepEqual(decide(property, owners, { dismissed: pairs }), { kind: "link", ownerId: "a" });
  // "This property's owner is not the trust" works too, but only for the page's current identity.
  const sig = I.identitySignature(I.identityOf(property.ownerName, property.ownerEmails));
  const prop = { ownerPairs: new Set(), propertyOwner: new Set([I.propertyOwnerKey("p1", "t", sig)]) };
  assert.deepEqual(decide(property, owners, { dismissed: prop }), { kind: "link", ownerId: "a" });
  assert.equal(decide({ ownerName: "Ann Able", ownerEmails: ["ann@x.com", "more@x.com"] }, owners, { dismissed: prop }).kind, "needs");
  // A mismatch acknowledged with "Keep linked" stays quiet until the page changes.
  const keep = { ownerPairs: new Set(), propertyOwner: new Set([I.propertyOwnerKey("p1", "b", sig)]) };
  const two = [owner("a", "Ann Able", ["ann@x.com"]), owner("b", "Bo Best", ["bo@x.com"])];
  assert.deepEqual(decide(property, two, { linkedOwnerIds: ["b"], dismissed: keep }), { kind: "linked" });
});

// --- merge preconditions -------------------------------------------------------------------------

const side = (sid, legalName, extra = {}) => ({
  id: sid,
  legalName,
  emails: [],
  active: true,
  hasFinal: false,
  hasOpenDraft: false,
  ledgerRows: 0,
  ...extra,
});

test("merge: allowed when fee and payee match (or the merged owner has none)", () => {
  assert.equal(I.mergeProblem(side("a", "Ann"), side("b", "Ann")), null);
  assert.equal(I.mergeProblem(side("a", "Ann", { managementFeeBps: 500, payeeName: "Ann Able" }), side("b", "Ann")), null);
  assert.equal(I.mergeProblem(side("a", "Ann", { managementFeeBps: 500 }), side("b", "Ann", { managementFeeBps: 500 })), null);
  assert.deepEqual(I.mergedEmails(["a@x.com"], ["b@x.com", "A@x.com"]), ["a@x.com", "b@x.com"]);
});

test("merge: every refusal names the field and says what to do", () => {
  const p = (keep, merge, shared) => I.mergeProblem(keep, merge, shared);
  assert.deepEqual(p(null, side("b", "B")), { field: "keepOwnerId", message: "Select the owner to keep." });
  assert.deepEqual(p(side("a", "A"), null), { field: "mergeOwnerId", message: "Select the owner to merge into it." });
  assert.equal(p(side("a", "A"), side("a", "A")).message, "Pick two different owners to merge.");
  assert.equal(p(side("a", "A"), side("b", "B", { mergedIntoOwnerId: "c" })).message, "B was already merged into another owner.");
  assert.equal(p(side("a", "A", { active: false }), side("b", "B")).field, "keepOwnerId");
  assert.deepEqual(p(side("a", "A", { hasFinal: true }), side("b", "B")), {
    field: "keepOwnerId",
    message: "A already has a final statement, so it can't be merged. Final statements stay with the owner they were issued to.",
  });
  assert.equal(p(side("a", "A"), side("b", "B", { hasFinal: true })).field, "mergeOwnerId");
  assert.equal(p(side("a", "A", { hasOpenDraft: true }), side("b", "B")).message, "A has an open draft statement. Finalize or discard it first.");
  assert.equal(p(side("a", "A"), side("b", "B", { hasOpenDraft: true })).message, "B has an open draft statement. Finalize or discard it first.");
  assert.equal(p(side("a", "A"), side("b", "B", { ledgerRows: 2 })).message, "B has 2 ledger transactions. Void them first (or merge the other way round).");
  assert.equal(
    p(side("a", "A", { managementFeeBps: 500 }), side("b", "B", { managementFeeBps: 600 })).message,
    "The management fees differ (A: 5.00%, B: 6.00%). Make them match on both owners first.",
  );
  assert.equal(
    p(side("a", "A"), side("b", "B", { managementFeeBps: 600 })).message,
    "The management fees differ (A: not set, B: 6.00%). Make them match on both owners first.",
  );
  assert.equal(
    p(side("a", "A", { payeeName: "Ann" }), side("b", "B", { payeeName: "Bo" })).message,
    "The owner draw payees differ (A: Ann, B: Bo). Make them match on both owners first.",
  );
  const many = (pre) => ["1", "2", "3"].map((n) => `${pre}${n}@x.com`);
  assert.equal(
    p(side("a", "A", { emails: many("a") }), side("b", "B", { emails: many("b") })).message,
    "Together these owners have 6 email addresses, and an owner can have at most 5. Remove some first.",
  );
  assert.equal(
    p(side("a", "A"), side("b", "B"), [{ propertyName: "1 Oak St", keep: {}, merge: { openingBalanceCents: 100 } }]).message,
    "Both owners are linked to 1 Oak St with different opening balance, first statement month, reserve or management fee. Make them match, or unlink it from one owner first.",
  );
  assert.equal(p(side("a", "A"), side("b", "B"), [{ propertyName: "1 Oak St", keep: { startMonth: "2026-01" }, merge: {} }]), null);
});

// --- wiring (source scans) -----------------------------------------------------------------------

test("every writer of a property's owner name / emails calls linkOwnerForProperty", () => {
  const props = read("properties.ts");
  const update = props.slice(props.indexOf("export const updateProfile"), props.indexOf("export const setDefaultAssetManager"));
  assert.match(update, /ownerIdentityChanged\(property, \{ \.\.\.property, \.\.\.patch \}\)/);
  assert.match(update, /linkOwnerForProperty\(ctx, property\._id, \{ source: "manual", actorUserId: org\.user\._id \}\)/);
  const roster = read("rosterImport.ts");
  const upsert = roster.slice(roster.indexOf("async function upsertProperty"), roster.indexOf("async function upsertSourceRow"));
  assert.equal((upsert.match(/linkOwnerForProperty\(ctx, /g) ?? []).length, 2);
  // No other module writes ownerName / ownerEmails onto a property.
  for (const f of ["demoSeed.ts", "units.ts", "sarahConfig.ts"]) assert.equal(/ownerEmails\s*:/.test(read(f)), false, f);
});

test("the owner linker never contacts anyone and never moves a link", () => {
  const src = read("ownerLinking.ts");
  for (const bad of ["resend", "twilio", "whatsapp", "elevenlabs", "scheduler", "runAction", "sendEmail", "invite"]) {
    assert.equal(src.toLowerCase().includes(bad.toLowerCase()), false, bad);
  }
  assert.equal(/\.delete\(|db\.patch\(/.test(src), false);
});

// --- "Link all exact matches" (planLinkAll) ---------------------------------------------------------

const prop = (pid, ownerName, ownerEmails = [], extra = {}) => ({
  id: pid,
  name: `${pid} Street`,
  ownerName,
  ownerEmails,
  linkedOwnerIds: [],
  hasOpenDraft: false,
  ...extra,
});
const plan = (properties, owners = [], dismissed) => I.planLinkAll({ properties, owners, dismissed });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.propertyId, r]));

test("bulk: Ready to link and New owner are safe; one new owner per name + shared email", () => {
  const owners = [owner("o1", "Ann Able", ["ann@x.com"])];
  const rows = byId(
    plan([
      prop("p1", "Ann Able", ["ann@x.com"]),
      prop("p2", "New Owner LLC", ["new@x.com"]),
      prop("p3", "new owner llc", ["NEW@x.com", "other@x.com"]),
      prop("p4", "Bo Best", ["bo@x.com"], { linkedOwnerIds: ["o2"] }), // linked; o2 not known -> mismatch
    ], [...owners, owner("o2", "Bo Best", ["bo@x.com"])]),
  );
  assert.deepEqual(rows.p1.action, { kind: "link", ownerId: "o1" });
  assert.deepEqual(rows.p2.action, { kind: "create", legalName: "New Owner LLC", emails: ["new@x.com"] });
  assert.deepEqual(rows.p3.action, { kind: "link_new", fromPropertyId: "p2" });
  assert.equal(rows.p4, undefined); // linked and agreeing: not on the list
  for (const r of Object.values(rows)) assert.equal(r.doubt, null);
});

test("bulk: every doubtful case is excluded, with a reason in plain words", () => {
  const owners = [
    owner("ann", "Ann Able", ["ann@x.com"]),
    owner("eve", "Eve Evans", ["eve@x.com"]),
    owner("off", "Ina Inactive", ["ina@x.com"], { active: false }),
    owner("k1", "Kim Key", ["k@x.com"]),
    owner("k2", "Kim Key", ["k@x.com", "k2@x.com"]),
    owner("bo", "Bo Best", ["bo@x.com"]),
  ];
  const rows = byId(
    plan(
      [
        prop("d1", "Evans Holdings", ["eve@x.com"]), // same email, different name
        prop("d2", "Ann Able", ["new@x.com"]), // same name, different email
        prop("d3", "Ann Able", []), // name only
        prop("d4", "Kim Key", ["k@x.com"]), // several possible owners
        prop("d5", "Ina Inactive", ["ina@x.com"]), // inactive owner
        prop("d6", "Zed Zee", []), // missing email
        prop("d7", "Ann Able", ["ann@x.com"], { hasOpenDraft: true }), // open draft
        prop("d8", "Ann Able", ["ann@x.com"], { linkedOwnerIds: ["bo"] }), // page differs from the linked owner
        prop("d9", "", []), // no owner name
        prop("d10", "Six Mail", ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@six.com`)), // invalid owner data
      ],
      owners,
    ),
  );
  const doubt = (k) => [rows[k].action, rows[k].doubt];
  assert.deepEqual(doubt("d1"), [null, "Same email, different name"]);
  assert.deepEqual(doubt("d2"), [null, "Same name, different email"]);
  assert.deepEqual(doubt("d3"), [null, "Name-only match, no email to confirm it"]);
  assert.deepEqual(doubt("d4"), [null, "Several possible owners"]);
  assert.deepEqual(doubt("d5"), [null, "Matches an inactive owner"]);
  assert.deepEqual(doubt("d6"), [null, "Missing email on the property page"]);
  assert.deepEqual(doubt("d7"), [null, "On an open draft statement"]);
  assert.deepEqual(doubt("d8"), [null, "The property page differs from the linked owner"]);
  assert.deepEqual(doubt("d9"), [null, "Missing owner name on the property page"]);
  assert.deepEqual(doubt("d10"), [null, "The owner details on the property page can't make an owner: Add at most 5 email addresses."]);
  const counts = I.linkAllCounts(Object.values(rows));
  assert.deepEqual(counts, { link: 0, create: 0, linkNew: 0, total: 0, doubtful: 10, thisRun: 0 });
});

test("bulk: a merged owner is never a target; an inactive exact match with a look-alike lists both reasons", () => {
  const owners = [owner("old", "Ann Able", ["ann@x.com"], { active: false, mergedIntoOwnerId: "new" }), owner("new", "Ann Able", ["ann@x.com"])];
  assert.deepEqual(plan([prop("p1", "Ann Able", ["ann@x.com"])], owners)[0].action, { kind: "link", ownerId: "new" });
  const r = plan([prop("p1", "Ann Able", [])], [owner("a", "Ann Able", ["a@x.com"]), owner("b", "Ann Able", ["b@x.com"])])[0];
  assert.equal(r.doubt, "Name-only match, no email to confirm it; several possible owners");
});

test("bulk: a New owner that looks like another property on the list is doubtful (both ways)", () => {
  const rows = byId(
    plan([
      prop("s1", "Sam Same", ["s1@x.com"]),
      prop("s2", "Sam Same", ["s2@x.com"]), // same name, different email
      prop("e1", "Eve Evans", ["shared@x.com"]),
      prop("e2", "Evans Holdings", ["shared@x.com"]), // same email, different name
      prop("n1", "Nia None", ["nia@x.com"]),
      prop("n2", "Nia None", []), // same name, no email
    ]),
  );
  assert.equal(rows.s1.doubt, "Same name, different email as s2 Street, also on this list");
  assert.equal(rows.s2.doubt, "Same name, different email as s1 Street, also on this list");
  assert.equal(rows.e1.doubt, "Same email, different name as e2 Street, also on this list");
  assert.equal(rows.e2.doubt, "Same email, different name as e1 Street, also on this list");
  assert.equal(rows.n1.doubt, "Name-only match, no email to confirm it as n2 Street, also on this list");
  assert.equal(rows.n2.doubt, "Missing email on the property page");
  for (const r of Object.values(rows)) assert.equal(r.action, null);
});

test("bulk: a chain of shared emails among New owners makes all of them doubtful", () => {
  // c1-c2 share a, c2-c3 share b, c1-c3 share nothing.
  const rows = byId(plan([prop("c1", "Chain", ["a@x.com"]), prop("c2", "Chain", ["a@x.com", "b@x.com"]), prop("c3", "Chain", ["b@x.com"])]));
  assert.match(rows.c1.doubt, /Same name, different email as c3 Street/);
  assert.match(rows.c3.doubt, /Same name, different email as c1 Street/);
  assert.equal(rows.c2.doubt, "Same owner as c1 Street, which needs a check first");
  for (const r of Object.values(rows)) assert.equal(r.action, null);
});

test("bulk: an owner marked “Not the same owner” with the same name + email blocks an automatic new owner", () => {
  const owners = [owner("o1", "Ann Able", ["ann@x.com"])];
  const property = { ownerName: "Ann Able", ownerEmails: ["ann@x.com"] };
  const sig = I.identitySignature(I.identityOf(property.ownerName, property.ownerEmails));
  const dismissed = { ownerPairs: new Set(), propertyOwner: new Set([I.propertyOwnerKey("p1", "o1", sig)]) };
  const d = decide(property, owners, { dismissed });
  assert.deepEqual([d.kind, d.reason], ["needs", "dismissed_match"]);
  assert.ok(I.NEEDS_REASON_TEXT.dismissed_match.length > 0);
  const r = plan([prop("p1", "Ann Able", ["ann@x.com"])], owners, dismissed)[0];
  assert.deepEqual([r.action, r.doubt], [null, "A same-name owner was marked “Not the same owner”"]);
  // A dismissed look-alike with ANOTHER email is the normal way to a new owner: still safe.
  const other = [owner("o2", "Ann Able", ["old@x.com"])];
  const dis2 = { ownerPairs: new Set(), propertyOwner: new Set([I.propertyOwnerKey("p1", "o2", sig)]) };
  assert.deepEqual(plan([prop("p1", "Ann Able", ["ann@x.com"])], other, dis2)[0].action, {
    kind: "create",
    legalName: "Ann Able",
    emails: ["ann@x.com"],
  });
  // createConflict ignores merged owners and other names.
  assert.equal(I.createConflict(I.identityOf("Ann Able", ["ann@x.com"]), [owner("m", "Ann Able", ["ann@x.com"], { mergedIntoOwnerId: "x" })]), false);
  assert.equal(I.createConflict(I.identityOf("Ann Able", ["ann@x.com"]), [owner("b", "Bo", ["ann@x.com"])]), false);
  assert.equal(I.createConflict(I.identityOf("Ann Able", ["ann@x.com"]), [owner("n", "Ann Able", [])]), true);
});

test("bulk: counts for the confirmation dialog, capped per call", () => {
  const properties = [];
  for (let i = 0; i < 130; i++) properties.push(prop(`p${String(i).padStart(3, "0")}`, `Owner ${i}`, [`o${i}@x.com`]));
  properties.push(prop("dup", "Owner 0", ["o0@x.com"])); // links to the new owner from p000
  const owners = [owner("x", "Owner 1", ["o1@x.com"])]; // p001 is Ready to link
  const rows = plan(properties, owners);
  assert.deepEqual(I.linkAllCounts(rows), { link: 1, create: 129, linkNew: 1, total: 131, doubtful: 0, thisRun: I.LINK_ALL_LIMIT });
  assert.equal(I.LINK_ALL_LIMIT, 100);
  assert.deepEqual(rows.find((r) => r.propertyId === "dup").action, { kind: "link_new", fromPropertyId: "p000" });
});

// --- verifier fixes: messages and wiring --------------------------------------------------------------

test("LOW-2: “Not the same owner” is refused for an exact unflagged match on an unlinked property", () => {
  const property = { ownerName: "Ann Able", ownerEmails: ["ann@x.com"] };
  const ann = { legalName: "ANN ABLE.", emails: ["ann@x.com", "z@x.com"] };
  assert.equal(
    I.propertyDismissProblem({ propertyLinked: false, property, owner: ann }),
    "This owner matches the property's name and email exactly. Link it, or change the owner on the property page.",
  );
  assert.equal(I.propertyDismissProblem({ propertyLinked: true, property, owner: ann }), null); // "Keep linked" path
  assert.equal(I.propertyDismissProblem({ propertyLinked: false, property, owner: { ...ann, emails: ["other@x.com"] } }), null);
  assert.equal(I.propertyDismissProblem({ propertyLinked: false, property: { ownerName: "Ann Able" }, owner: ann }), null); // name only
  assert.equal(I.propertyDismissProblem({ propertyLinked: false, property, owner: { ...ann, mergedIntoOwnerId: "x" } }), null);
  const src = read("owners.ts");
  const fn = src.slice(src.indexOf("export const dismissIdentityFlag"), src.indexOf("export const createForProperty"));
  assert.match(fn, /propertyDismissProblem\(\{/);
  assert.match(fn, /if \(refused\) throw fieldError\("ownerId", refused\)/);
});

test("MEDIUM-3: update, setActive and linkProperty refuse a merged owner with “X was merged into Y.”", () => {
  assert.equal(I.ownerMergedMessage("Old Owner LLC", "New Owner LLC"), "Old Owner LLC was merged into New Owner LLC.");
  const src = read("owners.ts");
  for (const [from, to] of [
    ["export const update = mutation", "export const setActive"],
    ["export const setActive = mutation", "// --- links"],
    ["export const linkProperty = mutation", "export const unlinkProperty"],
  ]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.match(body, /const owner = await loadOwner\(ctx, org, args\.ownerId\);\n\s+await refuseMerged\(ctx, owner\);/, from);
  }
  assert.match(src, /throw fieldError\("ownerId", ownerMergedMessage\(owner\.legalName, into \? into\.legalName : "another owner"\)\)/);
});

test("LOW-3: a merged owner's name is free again for a new owner", () => {
  const src = read("owners.ts");
  const fn = src.slice(src.indexOf("async function ownerNameTaken"), src.indexOf("const ownerFieldArgs"));
  assert.match(fn, /r\._id !== exceptId && r\.mergedIntoOwnerId === undefined/);
  assert.match(read("ownersImportLib.ts"), /ownerEmailsOf\(\{ ownerEmails: raw \}\)/);
  assert.match(read("schema.ts"), /NOT unique: owners with the same name are told apart by email/);
});

test("MEDIUM-4: the roster import reads owners once per batch and reports owner-link outcomes", () => {
  const roster = read("rosterImport.ts");
  const once = roster.slice(roster.indexOf("async function importOnce"), roster.indexOf("export const importProperties"));
  assert.equal((once.match(/loadIdentityData\(ctx, args\.orgId\)/g) ?? []).length, 1);
  assert.match(once, /ownerLinks: emptyLinkTally\(\)/);
  const upsert = roster.slice(roster.indexOf("async function upsertProperty"), roster.indexOf("async function upsertSourceRow"));
  assert.equal((upsert.match(/tallyLink\(owners\.tally, await linkOwnerForProperty\(ctx, [^)]+, \{ source: "sheet_import", data: owners\.data \}\)\)/g) ?? []).length, 2);
  const linking = read("ownerLinking.ts");
  // An owner created in a batch joins the preloaded data, so the next property matches it.
  assert.match(linking, /remember\(opts\.data, await ctx\.db\.get\(ownerId\)\)/);
  assert.match(linking, /decideForProperty\(ctx, property, opts\.data\)/);
});

test("linkAllExact: finance only, decides on the server, re-checks each property, capped, audited", () => {
  const src = read("owners.ts");
  const fn = src.slice(src.indexOf("export const linkAllExact"));
  assert.match(fn, /args: \{\},/); // never takes the browser's list
  assert.match(fn, /const org = await requireFinance\(ctx\);/);
  assert.match(fn, /safe\.slice\(0, LINK_ALL_LIMIT\)/);
  assert.match(fn, /const live = await decideForProperty\(ctx, property, data\);/);
  assert.match(fn, /applyLinkDecision\(ctx, property, live, opts\)/);
  for (const bad of ["resend", "twilio", "whatsapp", "elevenlabs", "scheduler", "runAction", "sendEmail", "invite", ".delete(", "db.patch("]) {
    assert.equal(fn.toLowerCase().includes(bad.toLowerCase()), false, bad);
  }
  // applyLinkDecision writes an audit row for every new owner and every link.
  const linking = read("ownerLinking.ts");
  const apply = linking.slice(linking.indexOf("export async function applyLinkDecision"), linking.indexOf("export async function linkOwnerForProperty"));
  assert.equal((apply.match(/await writeAudit\(ctx,/g) ?? []).length, 2);
  assert.match(apply, /action: "owner_created"/);
  assert.match(apply, /action: "owner_property_linked"/);
});
