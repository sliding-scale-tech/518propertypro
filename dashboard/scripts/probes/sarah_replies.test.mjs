// Unit tests for maintenanceLogLines and PHOTO_SAY (convex/sarahReplies.ts): what log_maintenance_request
// and send_photo_link tell Sarah to say. Real call on v17 (conv_7301m6e31kq8fs8razf5mys7t6wj, request
// #1012): every urgent result carried a say line, so "I've logged this" came out mid-intake. No
// packages: Node's own test runner, and Node 22.18+ loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/sarah_replies.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_SAY, WAIT_FOR_CALLER, maintenanceLogLines } from "../../convex/sarahReplies.ts";

const routed = { routedToAm: true, closedOutOfScope: false };
const unrouted = { routedToAm: false, closedOutOfScope: false };
const CLOSE_ONLY = /^Logged\. Keep going with the next step\. Say closing_line once, only when you close the call\./;

test("an urgent result is not spoken mid-intake: closing_line, never say", () => {
  for (const saved of [routed, unrouted]) {
    const r = maintenanceLogLines({ severity: "urgent", emergencyAlerted: false, saved });
    assert.equal(r.say, undefined);
    assert.equal(r.closing_line, "I've logged this and the team will follow up with you as soon as possible.");
    assert.match(r.message, CLOSE_ONLY);
  }
});

test("routine and informational results carry closing_line, never say", () => {
  for (const severity of ["routine", "informational"]) {
    const toAm = maintenanceLogLines({ severity, emergencyAlerted: false, saved: routed });
    assert.equal(toAm.say, undefined);
    assert.match(toAm.closing_line, /asset manager for your building/);
    assert.match(toAm.message, CLOSE_ONLY);
    const noUnit = maintenanceLogLines({ severity, emergencyAlerted: false, saved: unrouted });
    assert.equal(noUnit.say, undefined);
    assert.match(noUnit.closing_line, /match it to your unit/);
  }
});

test("no saved request: urgent and routine still wait for the close", () => {
  for (const severity of ["urgent", "routine"]) {
    const r = maintenanceLogLines({ severity, emergencyAlerted: false, saved: null });
    assert.equal(r.say, undefined);
    assert.equal(r.closing_line, "I've logged that and the team will follow up with you.");
  }
});

test("life-safety is unchanged: spoken at once, and 'alerted' only when an alert was queued", () => {
  for (const saved of [routed, unrouted, null]) {
    const alerted = maintenanceLogLines({ severity: "emergency", emergencyAlerted: true, saved });
    assert.equal(alerted.say, "I've logged this as an emergency and alerted the team right away.");
    assert.equal(alerted.closing_line, undefined);
    assert.equal(alerted.message, `Say the say line once. ${WAIT_FOR_CALLER}`);

    const notAlerted = maintenanceLogLines({ severity: "emergency", emergencyAlerted: false, saved });
    assert.equal(notAlerted.say, "I've logged this and the team will follow up with you as soon as possible.");
    assert.equal(notAlerted.closing_line, undefined);
    assert.doesNotMatch(notAlerted.say, /alerted/);
  }
});

test("a tenant-responsibility close is still spoken straight away", () => {
  const r = maintenanceLogLines({
    severity: "informational",
    emergencyAlerted: false,
    saved: { routedToAm: true, closedOutOfScope: true },
  });
  assert.match(r.say, /resident's responsibility/);
  assert.equal(r.closing_line, undefined);
});

test("every result tells her to wait for an unanswered question", () => {
  for (const severity of ["emergency", "urgent", "routine", "informational"]) {
    const r = maintenanceLogLines({ severity, emergencyAlerted: false, saved: routed });
    assert.ok(r.message.endsWith(WAIT_FOR_CALLER), severity);
  }
});

test("the photo line is a brief acknowledgement that keeps its meaning", () => {
  assert.match(PHOTO_SAY, /asset manager will follow up about photos/);
  assert.doesNotMatch(PHOTO_SAY, /passed|logged|sent/i);
  assert.doesNotMatch(PHOTO_SAY, /\btext\b|\blink\b/i);
  assert.ok(PHOTO_SAY.split(/\s+/).length <= 10, PHOTO_SAY);
});
