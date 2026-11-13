// Unit tests for owner verification on the owner call menu (convex/ownerVerifyLib.ts, the gate in
// convex/ownerRoutingLib.ts and the prompt in convex/sarahConfigLib.ts): the speech-to-email
// normaliser, exact matching against every owner email, the attempt limits, the transfer gate, the
// Property page's owner-email rules, and the prompt staying unchanged while the menu is off.
// No packages, no network, no real emails. From dashboard/:
//   node --test scripts/probes/owner_verify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        // convex/_generated is .js; everything else in convex/ is .ts.
        try {
          return next(`${specifier}.ts`, context);
        } catch {
          return next(`${specifier}.js`, context);
        }
      }
      throw err;
    }
  },
});

const V = await import("../../convex/ownerVerifyLib.ts");
const R = await import("../../convex/ownerRoutingLib.ts");
const L = await import("../../convex/sarahConfigLib.ts");
const A = await import("../../convex/agents.ts");

// --- Speech to email -----------------------------------------------------------------------------

test("normaliser: spelled letters, 'at' and 'dot'", () => {
  const n = V.spokenEmailToAddress;
  assert.equal(n("p f i o r e at gmail dot com"), "pfiore@gmail.com");
  assert.equal(n("j smith at yahoo dot co dot uk"), "jsmith@yahoo.co.uk");
  assert.equal(n("john dot smith at gmail dot com"), "john.smith@gmail.com");
  assert.equal(n("j smith at sign gmail period com"), "jsmith@gmail.com");
  assert.equal(n("j smith at gmail dotcom"), "jsmith@gmail.com");
  // "p as in peter", letter names inside a spelled run, "double t".
  assert.equal(n("p as in peter f i o r e at gmail dot com"), "pfiore@gmail.com");
  assert.equal(n("pee eff eye oh are ee at gmail dot com"), "pfiore@gmail.com");
  assert.equal(n("m a double t at gmail dot com"), "matt@gmail.com");
  // The last spoken "at" is the @.
  assert.equal(n("at home at aol dot com"), "athome@aol.com");
  assert.equal(n("pat at gmail dot com"), "pat@gmail.com");
});

test("normaliser: underscore, dash / hyphen, plus", () => {
  const n = V.spokenEmailToAddress;
  assert.equal(n("pat underscore fiore at aol dot com"), "pat_fiore@aol.com");
  assert.equal(n("pat under score fiore at aol dot com"), "pat_fiore@aol.com");
  assert.equal(n("mary dash ann at gmail dot com"), "mary-ann@gmail.com");
  assert.equal(n("bob hyphen jones at gmail dot com"), "bob-jones@gmail.com");
  assert.equal(n("bob plus rent at gmail dot com"), "bob+rent@gmail.com");
});

test("normaliser: numbers said as words", () => {
  const n = V.spokenEmailToAddress;
  assert.equal(n("jsmith twenty three at gmail dot com"), "jsmith23@gmail.com");
  assert.equal(n("nina nineteen eighty five at hotmail dot com"), "nina1985@hotmail.com");
  assert.equal(n("j o h n two oh one at gmail dot com"), "john201@gmail.com");
  assert.equal(n("bob seven seven at gmail dot com"), "bob77@gmail.com");
  assert.equal(n("bob double seven at gmail dot com"), "bob77@gmail.com");
  assert.equal(n("bob 77 at gmail dot com"), "bob77@gmail.com");
  // "oh" away from digits is the letter o.
  assert.equal(n("j oh n at gmail dot com"), "jon@gmail.com");
});

test("normaliser: uppercase, extra spaces, already written out", () => {
  const n = V.spokenEmailToAddress;
  assert.equal(n("  PFiore@Gmail.COM  "), "pfiore@gmail.com");
  assert.equal(n("john . smith @ yahoo . com"), "john.smith@yahoo.com");
  assert.equal(n("Capital J   SMITH at   Gmail Dot Com"), "jsmith@gmail.com");
  assert.equal(n("J S M I T H AT GMAIL DOT COM"), "jsmith@gmail.com");
});

test("normaliser: what is not an address comes back null, never guessed", () => {
  const n = V.spokenEmailToAddress;
  for (const bad of ["", "   ", null, undefined, "hello", "pat at gmail", "j smith gmail dot com", "j.smith@gmail..com", "@gmail.com", "jsmith@"]) {
    assert.equal(n(bad), null, String(bad));
  }
});

// --- Matching ------------------------------------------------------------------------------------

const OWNERS = ["owner.one@example.com", "second_owner@example.org"];

test("match: either owner email, case-insensitive, trimmed", () => {
  assert.equal(V.ownerEmailMatches("owner.one@example.com", OWNERS), true);
  assert.equal(V.ownerEmailMatches("SECOND_OWNER@Example.ORG ", OWNERS), true);
  assert.equal(V.ownerEmailMatches(V.spokenEmailToAddress("second underscore owner at example dot org"), OWNERS), true);
  // Stored values are compared in canonical form too (a legacy mixed-case ownerEmail).
  assert.equal(V.ownerEmailMatches("owner.one@example.com", [" Owner.One@Example.com "]), true);
});

test("match: no fuzzy matching, a near miss is a fail", () => {
  for (const near of ["owner.on@example.com", "ownerone@example.com", "owner.one@example.co", "owner.one@exampel.com", "owner.one@example.com.au", "wner.one@example.com", ""]) {
    assert.equal(V.ownerEmailMatches(near, OWNERS), false, near);
  }
  assert.equal(V.ownerEmailMatches("owner.one@example.com", []), false);
  assert.equal(V.ownerEmailMatches(null, OWNERS), false);
});

test("owner emails of a property: ownerEmails, else the legacy ownerEmail", () => {
  assert.deepEqual(V.ownerEmailsOf({ ownerEmails: ["a@x.com", "b@y.com"], ownerEmail: "a@x.com" }), ["a@x.com", "b@y.com"]);
  assert.deepEqual(V.ownerEmailsOf({ ownerEmail: " Legacy@X.com " }), ["legacy@x.com"]);
  assert.deepEqual(V.ownerEmailsOf({}), []);
  assert.deepEqual(V.ownerEmailsOf({ ownerEmails: [] }), []);
});

test("masking: never the whole address", () => {
  assert.equal(V.maskEmail("jsmith@gmail.com"), "j***@gmail.com");
  assert.equal(V.maskEmail(" JSmith@Gmail.com "), "j***@gmail.com");
  assert.equal(V.maskEmail(null), "(none)");
  assert.equal(V.maskEmail("nonsense"), "n***");
});

// --- Attempt limits ------------------------------------------------------------------------------

const fresh = { callAttempts: 0, propertyFailures: 0, alreadyVerified: false };

test("limits: a match verifies and counts one attempt", () => {
  const d = V.verifyDecision(fresh, "owner.one@example.com", OWNERS);
  assert.equal(d.status, "verified");
  assert.equal(d.counts, true);
  assert.equal(d.audit, "owner_verify_ok");
});

test("limits: one retry, then a message (2 email attempts per call)", () => {
  const first = V.verifyDecision(fresh, "wrong@example.com", OWNERS);
  assert.deepEqual(first, { status: "not_verified", counts: true, attemptsLeft: 1, audit: "owner_verify_failed" });
  const second = V.verifyDecision({ ...fresh, callAttempts: 1 }, "still.wrong@example.com", OWNERS);
  assert.deepEqual(second, { status: "no_match_take_message", counts: true, audit: "owner_verify_failed" });
  // A third try is refused without checking, even with the right email.
  const third = V.verifyDecision({ ...fresh, callAttempts: 2 }, "owner.one@example.com", OWNERS);
  assert.deepEqual(third, { status: "no_match_take_message", counts: false, audit: "owner_verify_locked" });
  // The second try can still succeed.
  assert.equal(V.verifyDecision({ ...fresh, callAttempts: 1 }, "owner.one@example.com", OWNERS).status, "verified");
  assert.equal(V.MAX_EMAIL_ATTEMPTS_PER_CALL, 2);
});

test("limits: switching property does not reset the per-call count", () => {
  // callAttempts is summed over every property tried on the call (ownerRouting.verifyOwner).
  assert.equal(V.verifyDecision({ ...fresh, callAttempts: 2 }, "owner.one@example.com", OWNERS).status, "no_match_take_message");
});

test("limits: property lockout is OFF for testing (PROPERTY_LOCKOUT_ENABLED), so failures never block later calls", () => {
  assert.equal(V.PROPERTY_LOCKOUT_ENABLED, false);
  // Even far past the old cap, a fresh call can still verify, and a wrong email is an ordinary failed check.
  const many = { ...fresh, propertyFailures: V.MAX_PROPERTY_FAILURES + 10 };
  assert.equal(V.verifyDecision(many, "owner.one@example.com", OWNERS).status, "verified");
  assert.deepEqual(V.verifyDecision(many, "wrong@example.com", OWNERS), {
    status: "not_verified",
    counts: true,
    attemptsLeft: 1,
    audit: "owner_verify_failed",
  });
});

test("limits: the per-call limit still works with the property lockout off", () => {
  const many = { ...fresh, propertyFailures: 99 };
  assert.deepEqual(V.verifyDecision({ ...many, callAttempts: 1 }, "wrong@example.com", OWNERS), {
    status: "no_match_take_message",
    counts: true,
    audit: "owner_verify_failed",
  });
  assert.deepEqual(V.verifyDecision({ ...many, callAttempts: 2 }, "owner.one@example.com", OWNERS), {
    status: "no_match_take_message",
    counts: false,
    audit: "owner_verify_locked",
  });
});

test("limits: when re-enabled, a property with repeated failures across calls is locked", () => {
  const d = V.verifyDecision({ ...fresh, propertyFailures: V.MAX_PROPERTY_FAILURES }, "owner.one@example.com", OWNERS, true);
  assert.deepEqual(d, { status: "no_match_take_message", counts: false, audit: "owner_verify_locked" });
  assert.equal(V.verifyDecision({ ...fresh, propertyFailures: V.MAX_PROPERTY_FAILURES - 1 }, "owner.one@example.com", OWNERS, true).status, "verified");
});

test("limits: no emails on file behaves exactly like a wrong email", () => {
  const withEmails = [V.verifyDecision(fresh, "a@b.com", OWNERS), V.verifyDecision({ ...fresh, callAttempts: 1 }, "a@b.com", OWNERS)];
  const without = [V.verifyDecision(fresh, "a@b.com", []), V.verifyDecision({ ...fresh, callAttempts: 1 }, "a@b.com", [])];
  assert.deepEqual(without, withEmails);
});

test("limits: an unreadable email costs no attempt; an already verified call is not re-checked", () => {
  const d = V.verifyDecision(fresh, null, OWNERS);
  assert.equal(d.status, "not_verified");
  assert.equal(d.counts, false);
  assert.equal(d.attemptsLeft, 2);
  assert.deepEqual(V.verifyDecision({ ...fresh, alreadyVerified: true, callAttempts: 2 }, "x@y.com", OWNERS), {
    status: "verified",
    counts: false,
    audit: null,
  });
});

test("the say lines never mention or hint at a stored email", () => {
  for (const [k, line] of Object.entries(V.VERIFY_SAY)) {
    const text = typeof line === "function" ? (k === "confirmMany" ? line(["86 Remsen Street", "184 Remsen Street"]) : line("184 Remsen Street")) : line;
    assert.doesNotMatch(text, /@|on file|we have|doesn't match|does not match|wrong email|no email/i, text);
  }
});

// --- The gate ------------------------------------------------------------------------------------

const six = (phone) =>
  ["Pat Fiore", "Alex Buell", "Nikki", "Nina", "Delia (Accounting)", "Alyssa"].map((label) => ({ label, phone }));
const TEST_NUMBER = "+17542795559";
const tueNoon = Date.UTC(2026, 10, 3, 17);

test("gate: no transfer number without a verified owner on this call", () => {
  const menu = R.menuOf({ enabled: true, entries: six(TEST_NUMBER) });
  const unverified = R.staffCheck(menu, false, "Nina", tueNoon);
  assert.equal(unverified.status, "verify_first");
  assert.equal(unverified.transferNumber, null);
  assert.equal(unverified.transferDigits, "w");
  assert.equal(unverified.say, "");
  const verified = R.staffCheck(menu, true, "Nina", tueNoon);
  assert.equal(verified.status, "available");
  assert.equal(verified.transferNumber, TEST_NUMBER);
  // Menu off: never a number either way.
  assert.equal(R.staffCheck(null, true, "Nina", tueNoon).transferNumber, null);
  // Verified but after hours: no number.
  const after = R.menuOf({ enabled: true, entries: six(TEST_NUMBER).map((e) => ({ ...e, hours: "Mon-Fri 09:00-17:00" })) });
  assert.equal(R.staffCheck(after, true, "Nina", Date.UTC(2026, 10, 4, 2)).transferNumber, null);
});

test("gate: a verification counts only on its own call, and only for a while", () => {
  const now = 10_000_000;
  assert.equal(V.hasLiveVerification([], now), false);
  assert.equal(V.hasLiveVerification([{ verified: false, verifiedAt: now }], now), false);
  assert.equal(V.hasLiveVerification([{ verified: true, verifiedAt: now - 60_000 }], now), true);
  assert.equal(V.hasLiveVerification([{ verified: true, verifiedAt: now - V.VERIFIED_TTL_MS - 1 }], now), false);
  assert.equal(V.hasLiveVerification([{ verified: true }], now), false);
});

test("gate (B46): a new owner recorded on the call is cleared, but never after a failed email check", () => {
  const now = 10_000_000;
  const ok = { verified: true, verifiedAt: now - 1000, failures: 0 };
  const failed = { verified: false, failures: 1 };
  const addressOnly = { verified: false, failures: 0 };
  assert.deepEqual(V.callCleared([], false, now), { cleared: false, newOwner: false });
  assert.deepEqual(V.callCleared([], true, now), { cleared: true, newOwner: true });
  assert.deepEqual(V.callCleared([ok], false, now), { cleared: true, newOwner: false });
  assert.deepEqual(V.callCleared([ok], true, now), { cleared: true, newOwner: false });
  assert.deepEqual(V.callCleared([addressOnly], true, now), { cleared: true, newOwner: true });
  // Said they were existing, failed the email, then claimed to be new: still refused.
  assert.deepEqual(V.callCleared([failed], true, now), { cleared: false, newOwner: false });
  assert.deepEqual(V.callCleared([failed], false, now), { cleared: false, newOwner: false });
});

test("gate: everyone on one test number still resolves by person, and each gets the number", () => {
  const menu = R.menuOf({ enabled: true, entries: six(TEST_NUMBER) });
  assert.equal(menu.filter((m) => m.phone === TEST_NUMBER).length, 6);
  assert.equal(R.staffCheck(menu, true, "3", tueNoon).label, "Nikki");
  assert.equal(R.staffCheck(menu, true, "accounting", tueNoon).label, "Delia (Accounting)");
  assert.equal(R.staffCheck(menu, true, "Pat", tueNoon).transferNumber, TEST_NUMBER);
});

// --- Property page owner emails ------------------------------------------------------------------

test("owner email editing: per-row messages, duplicates, limit, stored lowercase", () => {
  assert.deepEqual(V.ownerEmailProblems(["a@x.com", "", "B@Y.com"]), []);
  assert.deepEqual(V.ownerEmailProblems(["a@x.com", "not-an-email"]), [
    { index: 1, message: "Owner email 2: enter a full email address, like name@example.com." },
  ]);
  assert.deepEqual(V.ownerEmailProblems(["a@x.com", " A@X.com "]), [
    { index: 1, message: "Owner email 2 is the same as owner email 1. Remove one of them." },
  ]);
  assert.match(V.ownerEmailProblems(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"])[0].message, /at most 5 owner emails/);
  assert.deepEqual(V.cleanOwnerEmails([" A@X.com ", "", "b@y.com"]), ["a@x.com", "b@y.com"]);
});

// --- The prompt while the menu is off ------------------------------------------------------------

test("the prompt is byte-identical while the menu is off, with the test number in all six entries", () => {
  const base = L.composeSarahSections(L.normalizeConfig(L.defaultConfig()));
  const c = L.normalizeConfig(L.defaultConfig());
  // The draft state on dev: all six on the test number, call type off and unapproved, directory off.
  const draft = { ...c, routingDirectory: { ...c.routingDirectory, entries: six(TEST_NUMBER) } };
  assert.deepEqual(L.composeSarahSections(draft), base);
  const dirOn = { ...draft, routingDirectory: { ...draft.routingDirectory, enabled: true } };
  assert.deepEqual(L.composeSarahSections(dirOn), base);
  for (const s of Object.values(base)) assert.doesNotMatch(s, /verify_owner|OWNER CALL ROUTING|7542795559/);
  // The shared number is flagged in the missing-items list and keeps the item open.
  const item = L.allItems(draft).find((i) => i.id === "routing-phones");
  assert.match(item.detail, /Test setup: everyone in the menu shares one number \(\+1 754-279-5559\)/);
  assert.notEqual(item.status, "complete");
});

// --- Where the address comes from (conv_5201m6gvmsxafxssy2xrjzjgxten, 2026-11-03) -----------------
// Sarah sent verify_owner "184 Remsen Street", which the caller never said: it was the example in
// the tool's parameter description.

test("verify_owner: no address, or only a keypad digit, asks for the property and counts nothing", () => {
  for (const raw of [undefined, null, "", "   ", "\t"]) assert.equal(V.addressInputKind(raw), "ask_property", String(raw));
  // A menu key pressed before verification is not a property.
  for (const raw of ["1", " 3 ", "1#", "*2"]) assert.equal(V.addressInputKind(raw), "keypad_first", raw);
  // A bare street number is half an address: ask for the property, not "the menu comes later".
  for (const raw of ["19", "184", "#"]) assert.equal(V.addressInputKind(raw), "ask_property", raw);
  for (const raw of ["19 Spring Street", "Spring", "4th Street"]) assert.equal(V.addressInputKind(raw), "lookup", raw);
  assert.match(V.VERIFY_SAY.keypadFirst, /menu once I've verified you\. Which property do you own with us\?$/);
  assert.match(V.VERIFY_SAY.noAddress, /^Which property do you own with us\?/);
});

// Real streets from the rosters, and any "<number> <Name> Street" except the placeholder "Example Street".
const REAL_ADDRESSES = /Remsen|Washington Ave|Spring St|Broad St|Union St|State St|Myrtle|Newark St|Harrison Ave|\b\d+ (?!Example )[A-Z][a-z]+ (Street|Avenue|St|Ave|Road|Rd|Place|Lane|Drive|Blvd)\b/;

test("no tool or parameter description carries an example street address a model could copy", () => {
  const site = "https://example.convex.site";
  for (const routing of [false, true]) {
    for (const d of A.toolDefsFor(site, routing)) {
      const text = JSON.stringify({ name: d.name, description: d.description, properties: d.properties });
      assert.doesNotMatch(text, REAL_ADDRESSES, d.name);
    }
  }
  const verify = A.toolDefsFor(site, true).find((d) => d.name === "verify_owner");
  assert.ok(verify.description.includes(R.OWNER_ADDRESS_RULE));
  // Not required, so the model is never pushed to fill it before the caller says one.
  assert.deepEqual(verify.required, ["conversation_id"]);
  assert.match(verify.properties.spoken_property_address.description, /caller's own words from this call/);
  assert.equal(verify.properties.caller_name.type, "string");
  // Off: no routing tools at all.
  assert.equal(A.toolDefsFor(site, false).some((d) => d.name === "verify_owner"), false);
  // The transfer tool too (static fallback, unused in twilio_dial mode).
  const menu = R.menuOf({ enabled: true, entries: six(TEST_NUMBER) });
  assert.doesNotMatch(JSON.stringify(R.transferToolConfig(menu, "static")), REAL_ADDRESSES);
});

test("the live prompt carries no real example address; off, the resident example is unchanged", () => {
  const c = L.normalizeConfig(L.defaultConfig());
  c.callTypes = c.callTypes.map((t) => (t.key === "owner_routing" ? { ...t, enabled: true, approvedBy: "Test", approvedAt: 1 } : t));
  c.routingDirectory = { ...c.routingDirectory, enabled: true, entries: six(TEST_NUMBER) };
  const live = L.composeSarahSections(c);
  for (const s of Object.values(live)) assert.doesNotMatch(s, REAL_ADDRESSES);
  assert.match(live.resident, /"Is that 12, 14 or 16 Example Street\?"/);
  assert.match(R.composeOwnerRoutingBlock(L.ownerRoutingMenu(c), "518 Property Pro"), /^OWNER CALL ROUTING/);
  // Off: byte-identical, so the find_unit example is still the original one.
  const off = L.composeSarahSections(L.normalizeConfig(L.defaultConfig()));
  assert.match(off.resident, /"Is that 182, 184 or 188 Remsen Street\?"/);
  for (const k of ["top", "lifeSafety", "extra", "bottom"]) assert.doesNotMatch(off[k], /Example Street/);
});
