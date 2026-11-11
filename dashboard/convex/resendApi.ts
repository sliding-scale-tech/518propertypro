/**
 * Thin wrapper over the Resend REST API — same shape as elevenLabsApi.ts's request() helper.
 * Two callers send mail through it: the landing page's "send me the transcript" ask
 * (convex/transcriptEmail.ts) and team invitations (convex/team.ts).
 */

import { ConvexError } from "convex/values";

const BASE = "https://api.resend.com";

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key?.trim()) {
    throw new Error("Missing RESEND_API_KEY. Set it with: npx convex env set RESEND_API_KEY <key>");
  }
  return key;
}

// Must be a domain verified on this Resend account — sending "from" an unverified domain gets
// silently rejected or spam-foldered by most providers, so this can't default to something
// guessed. simplr.pro is the product's own domain and matches the app the recipient is being
// sent to; slidingscale.xyz is also verified on the account if this ever needs to fall back.
const FROM_ADDRESS = "Simplr <no-reply@simplr.pro>";

/*
 * `text` is optional in the type but should always be passed: an HTML-only body is one of the
 * strongest spam signals there is, because bulk senders skip the plain-text part and filters
 * know it. Supplying both makes the message multipart/alternative, which is what a normal mail
 * client sends. It is also what renders in watches, screen readers and text-only clients.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    // JSON.stringify drops an undefined `text`, so an omitted one sends HTML-only as before.
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // The person sees a generic line; the cause goes to the logs. Only the status and Resend's
    // error name are logged, because the body can echo the recipient's address.
    let errorName = "unknown";
    try {
      const parsed = JSON.parse(detail) as { name?: unknown };
      if (typeof parsed.name === "string") errorName = parsed.name.slice(0, 80);
    } catch {
      /* body was not JSON; the status is still logged */
    }
    console.error(`[resend] send failed: status ${res.status}, error ${errorName}`);
    throw new ConvexError("We couldn't send that email. Check the address and try again.");
  }
}
