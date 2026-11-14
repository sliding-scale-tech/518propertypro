// Unit tests for the SMS consent step (A2P 10DLC): STEP 3 of the maintenance prompt reads the number
// back and asks permission to text in the same turn, log_maintenance_request carries sms_consent, and the
// result lines tell Sarah what to ask. No packages, no network. From dashboard/:
//   node --test scripts/probes/sms_consent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
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

const A = await import("../../convex/agents.ts");
const C = await import("../../convex/sarahConfigLib.ts");
const R = await import("../../convex/sarahReplies.ts");
const T = await import("../../convex/twilioApi.ts");

const flat = (s) => s.replace(/\s+/g, " ");
const maint = () => flat(C.composeResidentCalls(C.defaultConfig()));

test("STEP 3: the read-back and the texting question are one turn", () => {
  const p = maint();
  assert.match(
    p,
    /So that's five one eight, five five five, one two three four \u2014 is that right\? And is it okay if 518 Property Pro texts you updates about this request at that number\?/,
  );
  assert.match(p, /in the SAME turn/);
  assert.match(p, /never two separate questions/);
});

test("STEP 3: a corrected number is read back and both asked again", () => {
  assert.match(maint(), /read the whole number back again, asking both again in the same way/);
});

test("STEP 3: consent rules - yes counts, no or silence is no, never pushed, never asked twice", () => {
  const p = maint();
  assert.match(p, /yes \(sms_consent true\) only if they clearly agree/);
  assert.match(p, /"No", or any refusal or reluctance about texting, is no \(sms_consent false\)/);
  assert.match(p, /never push/);
  assert.match(p, /the request is logged the same/);
  assert.match(p, /confirm the number but say nothing about texting, that is no as well: do not ask a second time/);
});

test("STEP 3: Sarah never says texting is unavailable, and never promises a text", () => {
  const p = maint();
  assert.match(p, /Never say that texting is unavailable, off or not working/);
  assert.match(p, /Only the one permission question in step 3 may mention texting\. Never promise that a text will arrive/);
});

test("STEP 3 final log sends sms_consent; emergencies and no-number logs leave it out", () => {
  const p = maint();
  assert.match(p, /confirmed_phone_yes true, sms_consent true or false as above/);
  assert.match(p, /no number and no sms_consent/);
  assert.match(flat(C.composeLifeSafety(C.defaultConfig())), /do not ask about texting in an emergency: leave sms_consent out/);
});

test("log_maintenance_request has an optional boolean sms_consent that is never true by default", () => {
  const log = A.toolDefsFor("https://example.convex.site", false).find((d) => d.name === "log_maintenance_request");
  assert.ok(log, "tool exists");
  assert.ok(log.properties.confirmed_phone, "confirmed_phone is still there");
  assert.ok(log.properties.confirmed_phone_yes, "confirmed_phone_yes is still there");
  const p = log.properties.sms_consent;
  assert.ok(p, "sms_consent exists");
  assert.equal(p.type, "boolean");
  assert.ok(!log.required.includes("sms_consent"), "sms_consent is optional");
  assert.match(p.description, /text them updates about this request/);
  assert.match(p.description, /False if they said no, refused, or confirmed the number but did not answer/);
  assert.match(p.description, /Never true by default/);
});

test("result lines ask both questions in one turn when the number is not confirmed or incomplete", () => {
  for (const line of [R.CONFIRMED_PHONE_UNCONFIRMED, R.CONFIRMED_PHONE_INVALID]) {
    assert.match(line, /is it okay (if 518 Property Pro texts you updates about this request at that number|to text updates at that number)/);
  }
  assert.match(R.CONFIRMED_PHONE_UNCONFIRMED, /sms_consent true or false/);
  for (const line of [R.CONFIRMED_PHONE_SAVED, R.CONFIRMED_PHONE_NOT_STORED]) {
    assert.match(line, /do not say anything will be texted or sent/i);
    assert.ok(!/unavailable|disabled|switched off/i.test(line));
  }
});

test("tenant texting is still off: only the emergency alert template may be sent", () => {
  assert.deepEqual([...T.SMS_ALLOWED_TEMPLATES], ["emergency_alert"]);
  assert.equal(T.isSmsAllowed("emergency_alert"), true);
  assert.equal(T.isSmsAllowed("tenant_update"), false);
});

test("outgoing SMS: prefix is 518 Property Pro and the STOP line is added exactly once", () => {
  assert.equal(T.SMS_PREFIX, "518 Property Pro: ");
  const body = `${T.SMS_PREFIX}Emergency at Oak St. https://app.example/x`;
  const once = T.withOptOut(body);
  assert.equal(once, `${body} Reply STOP to opt out.`);
  assert.equal(T.withOptOut(once), once);
  assert.equal(once.split("Reply STOP to opt out.").length - 1, 1);
  assert.ok(!/Simplr:/.test(once));
});

test("outgoing SMS: notify.ts uses the shared prefix and sendSms adds the STOP line before sending", () => {
  const notify = readFileSync(new URL("../../convex/notify.ts", import.meta.url), "utf8");
  assert.match(notify, /`\$\{SMS_PREFIX\}\$\{text\}`/);
  assert.ok(!/`Simplr: /.test(notify));
  const twilio = readFileSync(new URL("../../convex/twilioApi.ts", import.meta.url), "utf8");
  assert.match(twilio, /await send\(to, from, withOptOut\(body\)\)/);
});
