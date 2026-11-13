// Unit tests for maintenanceLogLines and PHOTO_SAY (convex/sarahReplies.ts): what log_maintenance_request
// and send_photo_link tell Sarah to say. Real call on v17 (conv_7301m6e31kq8fs8razf5mys7t6wj, request
// #1012): every urgent result carried a say line, so "I've logged this" came out mid-intake. No
// packages: Node's own test runner, and Node 22.18+ loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/sarah_replies.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_LOG_AT_FINAL,
  LEAD_NO_SIZE_SAY,
  LEAD_TOUR_OFFER_SAY,
  LOG_AT_FINAL,
  PHOTO_SAY,
  WAIT_FOR_CALLER,
  leadLogLines,
  maintenanceLogLines,
} from "../../convex/sarahReplies.ts";

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

test("a routine or urgent log says not to log again after each answer (two logs per call)", () => {
  for (const severity of ["urgent", "routine"]) {
    for (const saved of [routed, unrouted, null]) {
      const r = maintenanceLogLines({ severity, emergencyAlerted: false, saved });
      assert.ok(r.message.includes(LOG_AT_FINAL), severity);
    }
  }
  // A question that is not a repair (informational) has no STEP 3 final log; life-safety logs and
  // alerts straight away. Neither gets the line.
  assert.ok(!maintenanceLogLines({ severity: "informational", emergencyAlerted: false, saved: routed }).message.includes(LOG_AT_FINAL));
  assert.ok(!maintenanceLogLines({ severity: "emergency", emergencyAlerted: true, saved: routed }).message.includes(LOG_AT_FINAL));
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

// log_lead (conv_0001m7acgw57fpwagbr0ydncsybk): the result said "Call again to add details as you learn
// them" and offered a tour on every log, and Sarah called log_lead 7 times. Now one first and one final log.
test("log_lead first log: no tour offer, no say line, and told not to log after each answer", () => {
  const r = leadLogLines({ final: false, typeAvailable: null, areaSay: null, areaMessage: null });
  assert.equal(r.say, undefined);
  assert.ok(r.message.includes(LEAD_LOG_AT_FINAL));
  assert.ok(r.message.includes("Never tell the caller they do or do not qualify"));
  assert.ok(r.message.endsWith(WAIT_FOR_CALLER));
  assert.ok(!/call again to add details/i.test(r.message));
  assert.match(LEAD_LOG_AT_FINAL, /ONE final log_lead/);
  assert.match(LEAD_LOG_AT_FINAL, /final_log/);
});

test("log_lead final log: offers the tour once and does not ask for more logging", () => {
  const r = leadLogLines({ final: true, typeAvailable: true, areaSay: null, areaMessage: null });
  assert.equal(r.say, LEAD_TOUR_OFFER_SAY);
  assert.ok(!r.message.includes(LEAD_LOG_AT_FINAL));
  assert.match(r.message, /final log: call log_lead again only if the caller says something new/);
  const noBedsYet = leadLogLines({ final: true, typeAvailable: null, areaSay: null, areaMessage: null });
  assert.equal(noBedsYet.say, LEAD_TOUR_OFFER_SAY);
});

test("log_lead: nothing open in that size or area is said straight away, on any log", () => {
  for (const final of [false, true]) {
    assert.equal(leadLogLines({ final, typeAvailable: false, areaSay: null, areaMessage: null }).say, LEAD_NO_SIZE_SAY);
    const area = leadLogLines({ final, typeAvailable: null, areaSay: "We don't have anything open in Troy.", areaMessage: "Offer other cities." });
    assert.equal(area.say, "We don't have anything open in Troy.");
    assert.ok(area.message.includes("Offer other cities."));
  }
});
