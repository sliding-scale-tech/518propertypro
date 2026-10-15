/**
 * Phone helpers, dependency-free. Everything stored or matched is E.164 ("+15185550123"),
 * because caller ID, Twilio and the residentPhones index all need one canonical spelling.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(s: string): boolean {
  return E164.test(s);
}

/**
 * Best-effort normalisation to E.164, or null when it can't be done safely. A bare 10-digit
 * number is assumed North American (the pilot is in the 518 area code); anything else must
 * already carry its country code with a leading "+" or an 11-digit "1" prefix.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  let out: string;
  if (trimmed.startsWith("+")) out = `+${digits}`;
  else if (digits.length === 10) out = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) out = `+${digits}`;
  else return null;
  return isE164(out) ? out : null;
}

/** Throws a user-facing error for any phone that can't be normalised. */
export function requireE164(raw: string, label = "Phone number"): string {
  const out = toE164(raw);
  if (!out) throw new Error(`${label} must be a valid phone number, e.g. +15185550123.`);
  return out;
}
