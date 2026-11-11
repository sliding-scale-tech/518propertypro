// Unit tests for convex/residentMatch.ts (verifying a caller's name against a unit's residents).
// No packages: Node's own test runner, and Node 22.18+ loads .ts directly. From dashboard/:
//   node --test scripts/probes/resident_match.test.mjs
// Every name here is invented; the shapes copy the roster formats ("A & B Surname", pairs, titles).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// convex/*.ts import each other without an extension (the Convex bundler resolves it); Node does
// not, so add ".ts" to extensionless relative imports. Built into Node, no loader package.
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
const { matchResidentName, nameWordSimilar, peopleOf, surnameSoundAlike } = await import("../../convex/residentMatch.ts");

const unit = (...names) => names.map((fullName, i) => ({ id: `r${i + 1}`, fullName }));
const match = (spoken, residents) => matchResidentName(spoken, residents);

test("peopleOf splits pairs and shares a trailing surname", () => {
  assert.deepEqual(peopleOf("Dana Pell & Rory Quist"), [
    { first: "dana", rest: ["pell"] },
    { first: "rory", rest: ["quist"] },
  ]);
  assert.deepEqual(peopleOf("Tessa & Wren Marlow"), [
    { first: "tessa", rest: ["marlow"] },
    { first: "wren", rest: ["marlow"] },
  ]);
  assert.deepEqual(peopleOf("Ivo Bram and Lena Bram"), [
    { first: "ivo", rest: ["bram"] },
    { first: "lena", rest: ["bram"] },
  ]);
  assert.deepEqual(peopleOf("Mr. Okafor"), [{ first: "okafor", rest: [] }]);
  assert.deepEqual(peopleOf("Petra O'Malley"), [{ first: "petra", rest: ["omalley"] }]);
  assert.deepEqual(peopleOf(""), []);
  assert.deepEqual(peopleOf(undefined), []);
});

test("full name matches either person of a pair entry", () => {
  const r = unit("Dana Pell & Rory Quist");
  assert.equal(match("Dana Pell", r).matched, true);
  assert.equal(match("Rory Quist", r).matched, true);
  // A first name from one person with the other's surname is nobody.
  assert.equal(match("Dana Quist", r).matched, false);
});

test("a shared trailing surname applies to both first names", () => {
  const r = unit("Tessa & Wren Marlow");
  assert.equal(match("Tessa Marlow", r).matched, true);
  assert.equal(match("Wren Marlow", r).matched, true);
  assert.equal(match("Wren Marlowe", r).matched, true); // one letter off
});

test("first name alone only when unique in the unit", () => {
  assert.deepEqual(match("Tessa", unit("Tessa & Wren Marlow")), { matched: true, how: "first_name", residentId: "r1" });
  const twoSams = unit("Sam Ortiz", "Sam Lee");
  assert.deepEqual(match("Sam", twoSams), { matched: false, reason: "first_name_not_unique" });
  assert.equal(match("Sam Lee", twoSams).matched, true); // the full name settles it
  // The same person listed twice is still one person.
  assert.equal(match("Sam", unit("Sam Ortiz", "Sam Ortiz")).matched, true);
});

test("a wrong surname is a miss, never a first-name fallback", () => {
  assert.equal(match("Tessa Brown", unit("Tessa & Wren Marlow")).matched, false);
  assert.equal(match("Dana Smith", unit("Dana Pell")).matched, false);
});

test("small spelling and speech-to-text tolerance", () => {
  const r = unit("Brianna Selwyn", "Katelyn Moss");
  assert.equal(match("Breanna Selwyn", r).matched, true); // one letter
  assert.equal(match("Brianna Selwin", r).matched, true);
  assert.equal(match("Kaitlyn Moss", r).matched, true); // sound-alike spelling, two letters
  assert.equal(match("Jon Ferris", unit("John Ferris")).matched, true);
  assert.equal(match("Petra O Malley", unit("Petra O'Malley")).matched, true);
  assert.equal(match("Lars Van Dyke", unit("Lars Van Dyk")).matched, true);
  assert.equal(match("Lars Dyk", unit("Lars Van Dyk")).matched, true); // last word of the surname
  assert.equal(match("Hal Ward-Price", unit("Hal Ward-Price")).matched, true);
  assert.equal(match("Hal Price", unit("Hal Ward-Price")).matched, true); // one half of a hyphen
  // Too far, or a different first letter: no match.
  assert.equal(match("Karen Moss", r).matched, false);
  assert.equal(match("Catelyn Moss", r).matched, false);
  assert.equal(match("Dan Ferris", unit("Don Ferris")).matched, false); // 3 letters: exact only
});

test("first name alone is held to a stricter bar", () => {
  assert.equal(match("Mary", unit("Mark Hale")).matched, false); // 4 letters: exact only
  assert.equal(match("Breanna", unit("Brianna Selwyn")).matched, true); // 7 letters, one off
});

test("a middle name is never taken for a surname", () => {
  const r = unit("Nora Jean Pike");
  assert.equal(match("Nora Pike", r).matched, true);
  assert.equal(match("Nora Jean Pike", r).matched, true);
  assert.equal(match("Nora Jean", r).matched, false);
});

test("spoken lead-ins and titles are ignored", () => {
  const r = unit("Dana Pell & Rory Quist");
  assert.equal(match("my name is Rory Quist", r).matched, true);
  assert.equal(match("Hi, this is Dana Pell", r).matched, true);
  assert.equal(match("It's Mr. Rory Quist", r).matched, true);
});

test("single-word entries match on that word", () => {
  assert.equal(match("Okafor", unit("Mr. Okafor")).matched, true);
  assert.equal(match("Ade Okafor", unit("Mr. Okafor")).matched, true); // the stored word is a surname
  assert.equal(match("Ade Bello", unit("Mr. Okafor")).matched, false);
});

test("nothing to compare: no match", () => {
  assert.deepEqual(match("", unit("Dana Pell")), { matched: false, reason: "no_name" });
  assert.deepEqual(match(undefined, unit("Dana Pell")), { matched: false, reason: "no_name" });
  assert.deepEqual(match("Dana Pell", []), { matched: false, reason: "no_residents" });
});

test("nameWordSimilar basics", () => {
  assert.equal(nameWordSimilar("sharp", "sharpe"), true);
  assert.equal(nameWordSimilar("sharp", "sharpless"), false);
  assert.equal(nameWordSimilar("chen", "shen"), false); // first letter must agree
});

test("a surname heard as a sound-alike still matches next to the right first name", () => {
  // The real test call (2026-10-31), with invented names of the same shape: exact first name, the
  // surname's first letter swapped S/C by speech-to-text and the ending spelled differently.
  const r = unit("Vera Cermik");
  assert.equal(match("Vera Sermic", r).matched, true);
  assert.equal(match("Vera Cermick", r).matched, true);
  assert.equal(match("Vera Kermik", r).matched, true); // C/K
  assert.equal(match("Ola Faller", unit("Ola Valler")).matched, true); // F/V
  // Different consonant sounds, or a different first name: still a miss.
  assert.equal(match("Vera Sermon", r).matched, false);
  assert.equal(match("Vera Smith", r).matched, false);
  assert.equal(match("Dora Sermic", r).matched, false);
  assert.equal(surnameSoundAlike("sermic", "cermik"), true);
  assert.equal(surnameSoundAlike("sermic", "dermik"), false); // D is not a sound-alike of S
  assert.equal(surnameSoundAlike("lee", "li"), false); // too short to guess
});
