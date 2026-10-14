/**
 * Defence in depth against the agent filling a field just to satisfy a tool schema rather than
 * leaving it out. It shipped "unknown" as a caller name on 2026-08-24 because caller_name was
 * a required property, and a fabricated value is worse than an absent one: it looks like real
 * data on the page, and it blocks a later real value from being written by the merge in
 * tenants.logIssue.
 *
 * Lives in its own module so both the HTTP routes and the mutations clean the same way — a
 * value cleaned in only one of the two paths still reaches the database through the other.
 */

const PLACEHOLDERS = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "nil",
  "null",
  "undefined",
  "no name",
  "no number",
  "anonymous",
  "not provided",
  "not given",
  "not specified",
  "not available",
  "no answer",
  "caller",
  "resident",
  "tenant",
  "customer",
  "-",
  "--",
]);

/** Returns the trimmed value, or undefined if it is blank or a placeholder. */
export function realValue(input?: string | null): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

/**
 * Same, plus a sanity check that the string actually contains enough digits to be a phone
 * number. Stops "call me anytime" or "the usual number" being stored as something staff would
 * later try to dial.
 */
export function realPhone(input?: string | null): string | undefined {
  const value = realValue(input);
  if (!value) return undefined;
  return (value.match(/\d/g)?.length ?? 0) >= 7 ? value : undefined;
}
