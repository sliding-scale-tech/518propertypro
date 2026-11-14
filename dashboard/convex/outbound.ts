/**
 * The go-live master switch for every message the app sends to a person: SMS and WhatsApp (Twilio
 * and WAHA), email (Resend) and phone calls (the owner-transfer <Dial>).
 *
 * One Convex env var, OUTBOUND_ENABLED. Only the exact value "true" (any case, surrounding spaces
 * ignored) turns sending on. Unset, empty, "false", "1", "yes" or anything else keeps it OFF, so a
 * fresh deployment (production before go-live) can never text, email or ring a real tenant, owner or
 * technician by accident.
 *
 * The check sits in the lowest send functions (twilioApi.send, resendApi.sendEmail, wahaApi.sendText
 * and the typing indicators, ownerTransfer.dial), so no caller and no cron can get around it. When it
 * is off the send is skipped, a line is logged with the recipient masked, and the function returns
 * normally (false), so the flow that triggered it carries on. It sits ON TOP of the SMS template
 * allowlist in twilioApi.ts (SMS_ALLOWED_TEMPLATES), which is unchanged: a send needs both.
 *
 *   npx convex env set OUTBOUND_ENABLED true     # sends allowed (subject to the allowlist)
 *   npx convex env remove OUTBOUND_ENABLED       # everything blocked
 *
 * Pure apart from reading process.env and console.log: no Convex imports, so the node tests load it.
 */

export type OutboundChannel = "sms" | "whatsapp" | "email" | "call";

export function outboundEnabled(): boolean {
  return (process.env.OUTBOUND_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * A recipient with most of it hidden, safe for logs: "+1518•••0123" for a phone number,
 * "p•••@example.com" for an email. Never the whole value.
 */
export function maskRecipient(to: string): string {
  const value = (to ?? "").trim().replace(/^whatsapp:/i, "");
  if (!value) return "(none)";
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.length <= 4) return "•••";
  const keepStart = digits.startsWith("+") ? Math.min(5, digits.length - 4) : Math.min(4, digits.length - 4);
  return `${digits.slice(0, keepStart)}•••${digits.slice(-4)}`;
}

/**
 * True when the send may go ahead. Otherwise logs what would have been sent (channel, masked
 * recipient and a short label such as the template or subject, never the body) and returns false.
 */
export function allowOutbound(channel: OutboundChannel, to: string, what?: string): boolean {
  if (outboundEnabled()) return true;
  const label = what ? ` (${what.replace(/\s+/g, " ").slice(0, 80)})` : "";
  console.log(`[outbound] ${channel} to ${maskRecipient(to)} skipped${label}: OUTBOUND_ENABLED is off on this deployment`);
  return false;
}
