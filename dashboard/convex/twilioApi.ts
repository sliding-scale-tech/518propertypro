/**
 * Thin wrapper over Twilio's SMS REST API. Mirrors the style of elevenLabsApi.ts: fetch-based,
 * no SDK, runs on Convex's default runtime.
 *
 * Two gates, both required for a text to leave: the template allowlist below, then the go-live
 * master switch (outbound.ts, Convex env var OUTBOUND_ENABLED) inside send(), the one function that
 * calls Twilio's Messages API.
 */
import { allowOutbound, outboundEnabled } from "./outbound";

// --- Texting policy -------------------------------------------------------------------
// For now the app texts people in only two cases: emergency alerts to admins, and (later)
// work-order texts to technicians. Everything else is dropped here and in convex/notify.ts.
// To turn technician texts on, flip SMS_TECHNICIAN_ENABLED to true; nothing else needs to change.
export const SMS_TECHNICIAN_ENABLED = false;

const TECHNICIAN_TEMPLATES = ["wo_assigned", "wo_changed", "wo_sent_back"] as const;

/** The only templates allowed to produce an outbound text. */
export const SMS_ALLOWED_TEMPLATES: readonly string[] = [
  "emergency_alert",
  ...(SMS_TECHNICIAN_ENABLED ? TECHNICIAN_TEMPLATES : []),
];

// TENANT CONSENT: when tenant texts are added (maintenance updates), a text may only go to
// maintenanceRequests.smsConfirmPhone, and only when that request's smsConsent === true. Sarah
// asks for it in STEP 3 of the maintenance flow (A2P 10DLC). Never text a tenant on caller ID alone.
export function isSmsAllowed(template: string | undefined): boolean {
  return template !== undefined && SMS_ALLOWED_TEMPLATES.includes(template);
}

/** Prefix on every staff/technician text, matching the registered 518 Property Pro SMS campaign. */
export const SMS_PREFIX = "518 Property Pro: ";

/** Opt-out line the campaign requires on every outgoing text. */
export const SMS_OPT_OUT = " Reply STOP to opt out.";

/** Adds the opt-out line once, right before an SMS is sent; a body that already ends with it is left alone. */
export function withOptOut(body: string): string {
  return body.endsWith(SMS_OPT_OUT) ? body : `${body}${SMS_OPT_OUT}`;
}

/** True when the send may go ahead. Otherwise logs why (no numbers, no message text) and returns false. */
function allowed(channel: "sms" | "whatsapp", template: string | undefined): boolean {
  if (isSmsAllowed(template)) return true;
  console.log(
    `twilio: ${channel} dropped, texting is off except emergency alerts (template: ${template ?? "none"})`,
  );
  return false;
}

// Twilio's public, shared WhatsApp Sandbox number — the same for every Twilio account using
// the sandbox. Not a secret; overridable once a real approved WhatsApp sender is in place.
const SANDBOX_WHATSAPP_FROM = "+14155238886";

function coreCredentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "Missing Twilio env vars. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN with: " +
        "npx convex env set <NAME> <value>",
    );
  }
  return { sid, token };
}

/** The only Twilio Messages call in the app. Returns false (nothing sent) while OUTBOUND_ENABLED is off. */
async function send(to: string, from: string, body: string, what?: string): Promise<boolean> {
  if (!allowOutbound(to.startsWith("whatsapp:") ? "whatsapp" : "sms", to, what)) return false;
  const { sid, token } = coreCredentials();

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      // Convex's default runtime is a V8 isolate, not Node — no Buffer available, so btoa
      // (ASCII-safe here: Twilio SIDs/tokens are always ASCII) does the base64 encoding.
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Twilio ${res.status}: ${detail.slice(0, 500)}`);
  }
  return true;
}

/**
 * Every call must name the allowlisted template it belongs to; anything else is dropped without
 * throwing, so callers keep working. Resolves true only when Twilio accepted the text; false when the
 * allowlist or the OUTBOUND_ENABLED switch dropped it.
 */
export async function sendSms(to: string, body: string, template?: string): Promise<boolean> {
  if (!allowed("sms", template)) return false;
  // Master switch before the env check, so a deployment with sending off never throws over a missing number.
  if (!outboundEnabled()) return allowOutbound("sms", to, template);
  const from = process.env.TWILIO_SMS_FROM_NUMBER;
  if (!from) {
    throw new Error(
      "Missing TWILIO_SMS_FROM_NUMBER. Set it with: npx convex env set TWILIO_SMS_FROM_NUMBER <value>",
    );
  }
  return await send(to, from, withOptOut(body));
}

export async function sendWhatsApp(to: string, body: string, template?: string): Promise<boolean> {
  if (!allowed("whatsapp", template)) return false;
  const from = process.env.TWILIO_WHATSAPP_FROM_NUMBER ?? SANDBOX_WHATSAPP_FROM;
  return await send(`whatsapp:${to}`, `whatsapp:${from}`, body, template);
}
