/**
 * Pure text rules for roster columns that need more than a label lookup. No imports, so Node's
 * test runner can load this file directly (scripts/probes/roster_fields.test.mjs).
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `properties.address.formatted` from the roster's Property text and City: "<street>, <City>, NY".
 *
 * Make Up's Property text already ends with the city ("19 Spring St, Troy", or "86 - 88 4th St.
 * Waterford" with no comma), so a trailing city (case-insensitive, after a comma or a space) is
 * dropped from the street part first and the city is written once. A Property with no city in it
 * ("17 Harrison Ave") gets the City column. Gold and Silver Property text never ends with its
 * city, so their result is unchanged ("184 Remsen Street, Albany, NY"; no city: "<street>, NY").
 */
export function rosterAddressFormatted(property: string, city: string | undefined): string {
  let street = property;
  if (city) {
    const trailing = new RegExp(`(?:\\s*,\\s*|\\s+)${escapeRegExp(city)}$`, "i");
    const stripped = property.replace(trailing, "").replace(/,\s*$/, "").trim();
    if (stripped !== "") street = stripped;
  }
  return [street, city, "NY"].filter(Boolean).join(", ");
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const OWNER_EMAIL_SEPARATOR = ", ";

/** "jane@x.com" -> "j***@x.com": what an error message may show of an owner's email. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * The "Owners Email Address" cell -> lowercase addresses, in sheet order. Two owners share one
 * cell, separated by ", " exactly (as on the sheet). Returns an error (with masked addresses) for
 * anything that is not a clean list of valid addresses; the caller turns it into a ConvexError.
 */
export function parseOwnerEmails(cell: string): { emails: string[] } | { error: string } {
  const parts = cell.trim().split(OWNER_EMAIL_SEPARATOR);
  const emails: string[] = [];
  for (const part of parts) {
    const email = part.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) {
      return { error: `has an address that is not valid (${maskEmail(part.trim())}); separate two addresses with ", "` };
    }
    if (part !== part.trim()) return { error: `has extra spaces around ${maskEmail(email)}` };
    if (emails.includes(email)) return { error: `lists ${maskEmail(email)} twice` };
    emails.push(email);
  }
  return { emails };
}
