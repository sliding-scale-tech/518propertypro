/**
 * Thin wrapper over Twilio's SMS REST API. Mirrors the style of elevenLabsApi.ts: fetch-based,
 * no SDK, runs on Convex's default runtime.
 */

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

async function send(to: string, from: string, body: string): Promise<void> {
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
}

export async function sendSms(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_SMS_FROM_NUMBER;
  if (!from) {
    throw new Error(
      "Missing TWILIO_SMS_FROM_NUMBER. Set it with: npx convex env set TWILIO_SMS_FROM_NUMBER <value>",
    );
  }
  await send(to, from, body);
}

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_WHATSAPP_FROM_NUMBER ?? SANDBOX_WHATSAPP_FROM;
  await send(`whatsapp:${to}`, `whatsapp:${from}`, body);
}
