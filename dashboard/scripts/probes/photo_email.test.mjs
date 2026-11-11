// Unit tests for photoReplyLines / dictateEmail (convex/sarahReplies.ts): where send_photo_link tells
// the caller to email photos. Client decision: Gold -> goldteam@, Silver -> ncermak@, Make Up ->
// dgallerie@518propertypro.com; unknown -> the old "asset manager will follow up" line, never a guess.
// No packages: Node's own test runner. From dashboard/:
//   node --test scripts/probes/photo_email.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_SAY, WAIT_FOR_CALLER, dictateEmail, photoReplyLines, speakablePhotoEmail } from "../../convex/sarahReplies.ts";

test("the three team addresses are dictated for the phone", () => {
  assert.equal(dictateEmail("goldteam@518propertypro.com"), "gold team, all one word, at 518propertypro dot com");
  assert.equal(dictateEmail("ncermak@518propertypro.com"), "N C E R M A K at 518propertypro dot com");
  assert.equal(dictateEmail("dgallerie@518propertypro.com"), "D G A L L E R I E at 518propertypro dot com");
});

test("a known address gives a say line with the address, name and unit, and one repeat offer", () => {
  const r = photoReplyLines("  NCermak@518PropertyPro.com ");
  assert.equal(r.photo_email, "ncermak@518propertypro.com");
  assert.equal(
    r.say,
    "Please email them to N C E R M A K at 518propertypro dot com, with your name and unit number. Want me to repeat that?",
  );
  assert.equal(r.repeat_line, "Sure. It's N C E R M A K at 518propertypro dot com.");
  assert.ok(r.message.endsWith(WAIT_FOR_CALLER));
  assert.doesNotMatch(r.say, /\btext\b|\blink\b/i);
});

test("unknown or unusable address falls back and never invents one", () => {
  for (const bad of [null, undefined, "", "   ", "not-an-email", "a@b", "x..y@518propertypro.com", "bob smith@x.com", "o'neil@x.com", ".a@x.com"]) {
    const r = photoReplyLines(bad);
    assert.equal(r.say, PHOTO_SAY, String(bad));
    assert.equal(r.photo_email, null);
    assert.equal(r.repeat_line, undefined);
    assert.doesNotMatch(r.say, /@| at .* dot /);
    assert.equal(speakablePhotoEmail(bad), null, String(bad));
  }
});

test("other shapes: separators and digits are spoken, single words stay words", () => {
  assert.equal(dictateEmail("j.smith-2@mail.example.com"), "J dot S M I T H dash 2 at mail dot example dot com");
  assert.equal(dictateEmail("office@518propertypro.com"), "office at 518propertypro dot com");
});
