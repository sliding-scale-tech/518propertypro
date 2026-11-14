// The go-live master switch (convex/outbound.ts, Convex env var OUTBOUND_ENABLED). Proves that with the
// switch off (unset, or anything but "true") no SMS, WhatsApp, email or call leaves, that the skip is
// logged with the recipient masked and returns without throwing, and that with it on the existing
// template allowlist still decides. fetch is stubbed: nothing is sent, no deployment is touched.
// From dashboard/:
//   node --test scripts/probes/outbound_switch.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const O = await import("../../convex/outbound.ts");
const T = await import("../../convex/twilioApi.ts");
const RS = await import("../../convex/resendApi.ts");
const W = await import("../../convex/wahaApi.ts");
const OT = await import("../../convex/ownerTransfer.ts");
const N = await import("../../convex/notify.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const ENV_KEYS = ["OUTBOUND_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM_NUMBER", "RESEND_API_KEY", "WAHA_BASE_URL", "WAHA_API_KEY", "CONVEX_SITE_URL", "APP_BASE_URL"];

let saved;
let calls;
let logs;
let realFetch;
let realLog;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  calls = [];
  logs = [];
  realFetch = globalThis.fetch;
  realLog = console.log;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ status: "in-progress", to: "+15185550000", id: "x" }), { status: 200 });
  };
  console.log = (...a) => logs.push(a.join(" "));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function credentials() {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_SMS_FROM_NUMBER = "+15185550199";
  process.env.RESEND_API_KEY = "re_test";
  process.env.WAHA_BASE_URL = "https://waha.example";
  process.env.WAHA_API_KEY = "waha";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.APP_BASE_URL = "https://app.example";
}

test("the switch is OFF unless OUTBOUND_ENABLED is exactly true", () => {
  assert.equal(O.outboundEnabled(), false); // unset
  for (const v of ["", "false", "0", "1", "yes", "on", "enabled", "truee"]) {
    process.env.OUTBOUND_ENABLED = v;
    assert.equal(O.outboundEnabled(), false, JSON.stringify(v));
  }
  for (const v of ["true", "TRUE", " True "]) {
    process.env.OUTBOUND_ENABLED = v;
    assert.equal(O.outboundEnabled(), true, JSON.stringify(v));
  }
});

test("recipients are masked in logs: never the whole number or address", () => {
  assert.equal(O.maskRecipient("+15183650123"), "+1518•••0123");
  assert.equal(O.maskRecipient("whatsapp:+15183650123"), "+1518•••0123");
  assert.equal(O.maskRecipient("pat@example.com"), "p•••@example.com");
  assert.equal(O.maskRecipient(""), "(none)");
  assert.ok(!O.maskRecipient("+15183650123").includes("3650123"));
});

test("SMS: switch off -> nothing sent, logged masked, resolves false without throwing", async () => {
  credentials();
  const sent = await T.sendSms("+15183650123", "EMERGENCY: MR-1", "emergency_alert");
  assert.equal(sent, false);
  assert.equal(calls.length, 0);
  const line = logs.find((l) => l.includes("[outbound]"));
  assert.ok(line, "a skip line is logged");
  assert.match(line, /sms to \+1518•••0123 skipped \(emergency_alert\)/);
  assert.ok(!logs.join("\n").includes("3650123"), "the full number is never logged");
  assert.ok(!logs.join("\n").includes("EMERGENCY"), "the body is never logged");
});

test("SMS: switch off and no from-number configured still does not throw", async () => {
  assert.equal(await T.sendSms("+15183650123", "x", "emergency_alert"), false);
  assert.equal(calls.length, 0);
});

test("SMS: switch on -> the allowlisted template goes to Twilio, the others are still dropped", async () => {
  credentials();
  process.env.OUTBOUND_ENABLED = "true";
  assert.equal(await T.sendSms("+15183650123", "EMERGENCY: MR-1", "emergency_alert"), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.twilio\.com\/.*\/Messages\.json$/);
  // SMS_ALLOWED_TEMPLATES is unchanged: a non-allowlisted template stays dropped with the switch on.
  assert.equal(await T.sendSms("+15183650123", "hi", "tour_booked"), false);
  assert.equal(await T.sendSms("+15183650123", "hi"), false);
  assert.equal(calls.length, 1);
});

test("WhatsApp (Twilio): switch off -> nothing sent", async () => {
  credentials();
  assert.equal(await T.sendWhatsApp("+15183650123", "hi", "emergency_alert"), false);
  assert.equal(calls.length, 0);
});

test("email: switch off -> nothing sent, resolves false; on -> Resend is called", async () => {
  credentials();
  const mail = { to: "pat@example.com", subject: "Reset your Simplr password", html: "<p>x</p>", text: "x" };
  assert.equal(await RS.sendEmail(mail), false);
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => /\[outbound\] email to p•••@example\.com skipped/.test(l)));
  assert.ok(!logs.join("\n").includes("pat@example.com"));
  process.env.OUTBOUND_ENABLED = "true";
  assert.equal(await RS.sendEmail(mail), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.resend\.com\/emails$/);
});

test("WhatsApp (WAHA): switch off -> no text, no typing indicators", async () => {
  credentials();
  assert.equal(await W.sendText("15183650123@c.us", "hi"), false);
  await W.startTyping("15183650123@c.us");
  await W.stopTyping("15183650123@c.us");
  assert.equal(calls.length, 0);
  assert.equal(W.outboundAllowed(), false);
});

test("owner transfer call: switch off -> no Twilio request at all, Sarah takes a message", async () => {
  credentials();
  const mutations = [];
  const ctx = { runMutation: async (_fn, args) => (mutations.push(args), null) };
  await OT.dial._handler(ctx, {
    orgId: "org1",
    elevenLabsConversationId: "conv_1",
    callSid: "CA0123456789abcdef0123456789abcdef",
    label: "Pat Fiore",
    number: "+15183650123",
    digits: "",
  });
  assert.equal(calls.length, 0, "no lookup and no redirect");
  assert.ok(mutations.some((m) => m.action === "owner_transfer_failed" && /switched off/.test(m.note)));
  assert.ok(mutations.some((m) => m.person === "Pat Fiore" && /could not start/.test(m.message)), "a callback row is written");
  assert.ok(logs.some((l) => /\[outbound\] call to \+1518•••0123 skipped/.test(l)));
});

test("notification service: switch off -> logged as skipped, not as sent", async () => {
  credentials();
  const logged = [];
  const ctx = {
    runQuery: async () => [],
    runMutation: async (_fn, args) => (logged.push(args), null),
  };
  await N.send._handler(ctx, { orgId: "org1", phones: ["+15183650123"], template: "emergency_alert", data: { number: 7 } });
  assert.equal(calls.length, 0);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].status, "skipped");
  assert.match(logged[0].error, /OUTBOUND_ENABLED/);
});

// --- Source scan: every provider call sits behind the switch -----------------------------------------

const sources = readdirSync(CONVEX)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ f, src: readFileSync(join(CONVEX, f), "utf8") }));

test("only the gated wrappers talk to Twilio, Resend or WAHA's send endpoints", () => {
  const twilio = sources.filter((s) => s.src.includes("api.twilio.com")).map((s) => s.f).sort();
  assert.deepEqual(twilio, ["ownerTransfer.ts", "twilioApi.ts"]);
  const resend = sources.filter((s) => s.src.includes("api.resend.com")).map((s) => s.f);
  assert.deepEqual(resend, ["resendApi.ts"]);
  const waha = sources.filter((s) => /\/api\/(sendText|startTyping|stopTyping|send[A-Z])/.test(s.src)).map((s) => s.f);
  assert.deepEqual(waha, ["wahaApi.ts"]);
  for (const f of ["ownerTransfer.ts", "twilioApi.ts", "resendApi.ts", "wahaApi.ts"]) {
    assert.match(sources.find((s) => s.f === f).src, /from "\.\/outbound"/, `${f} imports the switch`);
  }
});

test("no other module calls an email or SMS provider or the ElevenLabs outbound-call API", () => {
  const providers = /api\.sendgrid\.com|api\.mailgun\.net|api\.postmarkapp\.com|graph\.facebook\.com|api\.stripe\.com|outbound[-_]call|twilio\/outbound/i;
  const hits = sources.filter((s) => providers.test(s.src)).map((s) => s.f);
  assert.deepEqual(hits, []);
});

test("the owner-transfer tool refuses to offer a transfer while the switch is off", () => {
  const http = sources.find((s) => s.f === "http.ts").src;
  const route = http.slice(http.indexOf('path: "/tools/check-staff-availability"'), http.indexOf('path: "/tools/transfer-owner-call"'));
  assert.match(route, /r\.status === "available" && r\.transferNumber && !outboundEnabled\(\)/);
});
