// Unit tests for stripAudioTags (convex/sanitize.ts): ElevenLabs expressive mode puts delivery tags in
// the LLM's text ("[happy] Thanks."), and people must never read them. No packages: Node's own test
// runner, and Node 22.18+ loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/audio_tags.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAudioTags } from "../../convex/sanitize.ts";

test("removes a leading tag and the space after it", () => {
  assert.equal(stripAudioTags("[happy] Thanks, Brennan."), "Thanks, Brennan.");
  assert.equal(stripAudioTags("[excited] Leave the building immediately."), "Leave the building immediately.");
});

test("removes an inline tag and leaves one space", () => {
  assert.equal(
    stripAudioTags("I'll record that offer. [slow] Your asset manager will follow up."),
    "I'll record that offer. Your asset manager will follow up.",
  );
});

test("removes a tag before punctuation and at the end of a line", () => {
  assert.equal(stripAudioTags("Thanks [laughs]."), "Thanks.");
  assert.equal(stripAudioTags("Thanks. [sighs]"), "Thanks.");
});

test("removes tags in a row and a two-word tag", () => {
  assert.equal(stripAudioTags("[calm] [slow] Is that right?"), "Is that right?");
  assert.equal(stripAudioTags("[speaking softly] Is that right?"), "Is that right?");
  assert.equal(stripAudioTags("One moment. [speaking-softly] Thanks."), "One moment. Thanks.");
});

test("handles a capitalised tag and each line of a multi-line text", () => {
  assert.equal(stripAudioTags("[Happy] Hello"), "Hello");
  assert.equal(stripAudioTags("[calm] First line\n[slow] Second line"), "First line\nSecond line");
});

test("removes a tag cut off by the token limit", () => {
  assert.equal(stripAudioTags("[slow"), "");
  assert.equal(stripAudioTags("Thanks, Tom. [sl"), "Thanks, Tom.");
});

test("a line that is only a tag becomes empty", () => {
  assert.equal(stripAudioTags("[happy]"), "");
  assert.equal(stripAudioTags("  [happy]  "), "");
});

test("leaves real text alone", () => {
  for (const text of [
    "Thanks, I have unit 1 at 4 Union Street. Is that right?",
    "Unit [B2] is on the second floor.",
    "Unit [2] is on the second floor.",
    "Am I speaking with [first_name] in unit [unit_label]?",
    "Rent is $1,450 [approx. 2026 rate].",
    "Reply to [John Smith] please.",
    "",
  ]) {
    assert.equal(stripAudioTags(text), text);
  }
});

test("keeps surrounding spacing that is not next to a tag", () => {
  assert.equal(stripAudioTags("Line one.\n\n[calm] Line two."), "Line one.\n\nLine two.");
  assert.equal(stripAudioTags("Two  spaces [calm] stay  here."), "Two  spaces stay  here.");
});
