/**
 * Owner verification for the owner call menu (B36, user decision 2026-11-03): before Sarah puts an
 * existing owner through to a staff member, the caller names the property they own and the email
 * address on file for it. Pure (no imports) so the mid-call tool, the gate on check_staff_availability
 * and the tests share one set of rules.
 *
 *   - spokenEmailToAddress: what the caller said ("p f i o r e at gmail dot com") as an address.
 *   - ownerEmailMatches: case-insensitive EXACT match against every owner email of the property,
 *     after trimming. No fuzzy matching: a near miss is a fail.
 *   - verifyDecision: the attempt limits (2 email checks per call, and a per-property cap across
 *     calls), decided from server-side counts only, never from anything the model says.
 *
 * Nothing here ever returns or describes a stored email. Audit notes use maskEmail.
 */

/** Email checks allowed on one call, across every property the caller names. */
export const MAX_EMAIL_ATTEMPTS_PER_CALL = 2;
/** Failed checks on one property, across all calls, before it is locked for the window below. */
export const MAX_PROPERTY_FAILURES = 6;
export const PROPERTY_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Cross-call property lock (MAX_PROPERTY_FAILURES failures within PROPERTY_FAILURE_WINDOW_MS).
 * Disabled 2026-11-03 for testing at the user's request; re-enable before production (tracked in
 * BACKLOG B36). While false, failures on a property never block later calls. Failures are still
 * counted and audited, and the per-call limit (MAX_EMAIL_ATTEMPTS_PER_CALL) still applies.
 */
export const PROPERTY_LOCKOUT_ENABLED = false;
/** A verification unlocks transfers on its own call for this long, then it no longer counts. */
export const VERIFIED_TTL_MS = 2 * 60 * 60 * 1000;
/** Verification rows are deleted after this (the audit trail keeps the history). */
export const VERIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// --- Email shape ---------------------------------------------------------------------------------

/** Conservative on purpose: what a real owner address looks like, lowercase. */
const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function isEmailShape(s: string): boolean {
  return s.length <= 200 && EMAIL_SHAPE.test(s) && !s.includes("..") && !/^[.]|[.]@|@[.-]/.test(s);
}

/** Trim + lowercase: the stored form (properties.ownerEmails) and the compared form. */
export function canonicalEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

// --- Speech to email -----------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Letter names as speech-to-text writes them. Only used inside a spelled run (next to another
 * single letter), because several are real words ("you", "are", "why", "see").
 */
const LETTER_NAMES: Record<string, string> = {
  ay: "a", aye: "a", bee: "b", be: "b", cee: "c", see: "c", sea: "c", dee: "d", ee: "e",
  ef: "f", eff: "f", gee: "g", aitch: "h", eye: "i", jay: "j", kay: "k", el: "l", ell: "l",
  em: "m", en: "n", pee: "p", pea: "p", cue: "q", queue: "q", ar: "r", are: "r", ess: "s",
  tee: "t", tea: "t", you: "u", vee: "v", ex: "x", why: "y", zee: "z", zed: "z",
};

/** Words said around an address that are not part of it. */
const FILLER = new Set([
  "capital", "cap", "caps", "uppercase", "upper", "lowercase", "lower", "small", "letter", "letters",
  "all", "case", "the", "sign", "symbol", "and", "then", "is", "its", "my", "email", "address",
  "e-mail", "spelled", "spell", "that's", "thats",
]);

const SYMBOL_WORDS: Record<string, string> = {
  dot: ".", period: ".", point: ".", underscore: "_", dash: "-", hyphen: "-", minus: "-", plus: "+",
};

function isSingleLetter(t: string | undefined): boolean {
  return !!t && /^[a-z]$/.test(t);
}

function isLetterish(t: string | undefined): boolean {
  return !!t && (isSingleLetter(t) || t in LETTER_NAMES);
}

function isNumberish(t: string | undefined): boolean {
  return !!t && (/^\d+$/.test(t) || t in UNITS || t in TEENS || t in TENS);
}

/**
 * What a caller said, as an email address, or null when it does not come out as one. Handles:
 * "at" / "at sign" -> @, "dot" / "period" / "point" -> ., "underscore", "dash" / "hyphen" / "minus",
 * "plus", spelled letters ("p f i o r e"), letter names in a spelled run ("pee eff"), "p as in Peter",
 * "double t", digits as words ("twenty three", "nineteen eighty five", "oh" next to digits), any
 * case and extra spaces. An address that is already written out ("PFiore@Gmail.com ") is just
 * trimmed and lowercased. Never guesses a domain and never corrects a spelling.
 */
export function spokenEmailToAddress(raw: string | null | undefined): string | null {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/[<>"'`]/g, " ")
    .replace(/\bdot\s*com\b/g, " dot com ")
    .replace(/\bdotcom\b/g, " dot com ")
    .replace(/\bunder\s+score\b/g, " underscore ")
    .replace(/\bfull\s+stop\b/g, " dot ")
    .replace(/\bat\s+the\s+rate(\s+of)?\b/g, " @ ")
    .replace(/\bdouble[\s-]+(u|you)\b/g, " w ")
    .trim();
  if (!s) return null;

  // Written out already, maybe with spaces around the symbols ("john . smith @ gmail . com").
  const compact = s.replace(/\s*([@._+-])\s*/g, "$1");
  if (!/\s/.test(compact) && isEmailShape(compact)) return compact;

  const tokens: string[] = s.match(/[a-z]+|\d+|[@._+-]/g) ?? [];
  const hasAtSymbol = tokens.includes("@");
  // The LAST spoken "at" is the @ ("pat at gmail": pat@gmail; "at home at aol": athome@aol).
  const atIndex = hasAtSymbol ? -1 : tokens.lastIndexOf("at");

  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    if (t === "at") {
      out.push(i === atIndex ? "@" : "at");
      continue;
    }
    if (/^[@._+-]$/.test(t)) {
      out.push(t);
      continue;
    }
    if (t in SYMBOL_WORDS) {
      out.push(SYMBOL_WORDS[t]);
      continue;
    }
    // "p as in peter", "p for peter": the letter only.
    if ((t === "as" && next === "in") || t === "for") {
      if (isLetterish(prev) && tokens[i + (t === "as" ? 2 : 1)]) {
        i += t === "as" ? 2 : 1;
        continue;
      }
    }
    // "double t", "triple 7".
    if (t === "double" || t === "triple") {
      const n = t === "double" ? 2 : 3;
      if (next && (isSingleLetter(next) || next in LETTER_NAMES)) {
        out.push((LETTER_NAMES[next] ?? next).repeat(n));
        i++;
        continue;
      }
      if (next && (/^\d$/.test(next) || next in UNITS)) {
        out.push(String(UNITS[next] ?? next).repeat(n));
        i++;
        continue;
      }
    }
    // Number words. "oh" is a zero only next to other digits ("two oh one"); otherwise the letter o.
    if (t === "oh" || t === "o") {
      if (t === "oh" && (isNumberish(prev) || isNumberish(next))) out.push("0");
      else out.push("o");
      continue;
    }
    if (t in TENS) {
      const n = TENS[t];
      if (next && next in UNITS && UNITS[next] > 0) {
        out.push(String(n + UNITS[next]));
        i++;
      } else {
        out.push(String(n));
      }
      continue;
    }
    if (t in TEENS) {
      out.push(String(TEENS[t]));
      continue;
    }
    if (t in UNITS) {
      out.push(String(UNITS[t]));
      continue;
    }
    // Letter names only inside a spelled run.
    if (t in LETTER_NAMES && (isLetterish(prev) || isLetterish(next))) {
      out.push(LETTER_NAMES[t]);
      continue;
    }
    if (FILLER.has(t)) continue;
    out.push(t);
  }

  const joined = out.join("").replace(/^[._-]+|[._-]+$/g, "");
  return isEmailShape(joined) ? joined : null;
}

// --- Matching ------------------------------------------------------------------------------------

/**
 * True only when `candidate` equals one of the property's owner emails exactly, ignoring case and
 * surrounding spaces. Both owners of a two-owner property match. Nothing fuzzy.
 */
export function ownerEmailMatches(candidate: string | null | undefined, ownerEmails: Array<string | null | undefined>): boolean {
  const c = canonicalEmail(candidate);
  if (!c || !isEmailShape(c)) return false;
  return ownerEmails.some((e) => canonicalEmail(e) === c);
}

/** Every owner email on a property: ownerEmails, else the legacy single ownerEmail. Canonical, de-duplicated. */
export function ownerEmailsOf(p: { ownerEmails?: string[] | null; ownerEmail?: string | null }): string[] {
  const list = p.ownerEmails && p.ownerEmails.length ? p.ownerEmails : p.ownerEmail ? [p.ownerEmail] : [];
  return [...new Set(list.map(canonicalEmail).filter(isEmailShape))];
}

/** "jsmith@gmail.com" -> "j***@gmail.com". For audit notes; never the whole address. */
export function maskEmail(raw: string | null | undefined): string {
  const e = canonicalEmail(raw);
  const at = e.lastIndexOf("@");
  if (at <= 0) return e ? `${e.slice(0, 1)}***` : "(none)";
  return `${e.slice(0, 1)}***${e.slice(at)}`;
}

// --- Attempt limits ------------------------------------------------------------------------------

export type VerifyCounts = {
  /** Email checks already made on this call, across all properties. */
  callAttempts: number;
  /** Failed checks on this property in the last PROPERTY_FAILURE_WINDOW_MS, across all calls. */
  propertyFailures: number;
  /** This call already verified this property (within VERIFIED_TTL_MS). */
  alreadyVerified: boolean;
};

export type VerifyDecision =
  | { status: "verified"; counts: false; audit: null }
  | { status: "verified"; counts: true; audit: "owner_verify_ok" }
  | { status: "not_verified"; counts: true; attemptsLeft: number; audit: "owner_verify_failed" }
  | { status: "not_verified"; counts: false; attemptsLeft: number; audit: null; unclear: true }
  | { status: "no_match_take_message"; counts: true; audit: "owner_verify_failed" }
  | { status: "no_match_take_message"; counts: false; audit: "owner_verify_locked" };

/**
 * What one verify_owner email check does, from server-side counts. A property with no emails on
 * file behaves exactly like a wrong email (two tries, then a message), so the caller can never
 * tell whether a property has emails on file.
 *
 * `email` is the normalised address, or null when what was heard is not an address at all: that
 * is not a check and costs no attempt (nothing could match it).
 */
export function verifyDecision(
  counts: VerifyCounts,
  email: string | null,
  ownerEmails: string[],
  /** Overridable for tests only; production code uses the constant. */
  propertyLockoutEnabled: boolean = PROPERTY_LOCKOUT_ENABLED,
): VerifyDecision {
  if (counts.alreadyVerified) return { status: "verified", counts: false, audit: null };
  const propertyLocked = propertyLockoutEnabled && counts.propertyFailures >= MAX_PROPERTY_FAILURES;
  if (counts.callAttempts >= MAX_EMAIL_ATTEMPTS_PER_CALL || propertyLocked) {
    return { status: "no_match_take_message", counts: false, audit: "owner_verify_locked" };
  }
  const left = MAX_EMAIL_ATTEMPTS_PER_CALL - counts.callAttempts;
  if (email === null) return { status: "not_verified", counts: false, attemptsLeft: left, audit: null, unclear: true };
  if (ownerEmailMatches(email, ownerEmails)) return { status: "verified", counts: true, audit: "owner_verify_ok" };
  const after = left - 1;
  return after > 0
    ? { status: "not_verified", counts: true, attemptsLeft: after, audit: "owner_verify_failed" }
    : { status: "no_match_take_message", counts: true, audit: "owner_verify_failed" };
}

/** The gate on check_staff_availability: a verified owner on THIS call, recently. */
export function hasLiveVerification(
  rows: Array<{ verified: boolean; verifiedAt?: number | null }>,
  nowMs: number,
): boolean {
  return rows.some((r) => r.verified && typeof r.verifiedAt === "number" && nowMs - r.verifiedAt <= VERIFIED_TTL_MS);
}

/**
 * Who may be put through on THIS call (B46): a verified existing owner (hasLiveVerification), or a
 * NEW owner route_owner_prospect recorded on this call (wants the company to manage a property; no
 * email check, and Sarah has no owner data to give them). A call where an email check already failed
 * is never cleared by claiming to be new afterwards: that would get round verification.
 */
export function callCleared(
  rows: Array<{ verified: boolean; verifiedAt?: number | null; failures: number }>,
  newOwnerRecorded: boolean,
  nowMs: number,
): { cleared: boolean; newOwner: boolean } {
  if (hasLiveVerification(rows, nowMs)) return { cleared: true, newOwner: false };
  const ok = newOwnerRecorded && !rows.some((r) => !r.verified && r.failures > 0);
  return { cleared: ok, newOwner: ok };
}

// --- The address the caller said ----------------------------------------------------------------

/**
 * What verify_owner does with spoken_property_address before any lookup (never counts an attempt):
 *   "ask_property": nothing was said (empty, missing, blank). Ask for the property.
 *   "keypad_first": one keypad digit ("1", "3#"), i.e. a menu key pressed before verification, not an
 *   address. Say the menu comes once they are verified, and ask for the property. Any other input
 *   with no word in it (a bare street number) is "ask_property".
 *   "lookup": something with a word in it, matched like find_unit.
 */
export function addressInputKind(raw: string | null | undefined): "ask_property" | "keypad_first" | "lookup" {
  const s = (raw ?? "").trim();
  if (!s) return "ask_property";
  // A single key (a menu key) is a keypad press; a bare street number ("19") is half an address.
  if (!/[a-z]/i.test(s)) return /^[*#\s]*\d[*#\s]*$/.test(s) ? "keypad_first" : "ask_property";
  return "lookup";
}

// --- What Sarah says -----------------------------------------------------------------------------

export const VERIFY_SAY = {
  confirmOne: (address: string) => `Just to confirm, that's ${address}?`,
  confirmMany: (options: string[]) =>
    options.length === 2
      ? `Did you mean ${options[0]} or ${options[1]}?`
      : `Did you mean ${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}?`,
  needNumber: "Could you tell me the street number as well?",
  noAddress: "Which property do you own with us? The street address is fine.",
  keypadFirst: "I'll take you to the menu once I've verified you. Which property do you own with us?",
  notFound: "I'm sorry, I couldn't find that address. Could you say the street address again?",
  verified: "Thank you.",
  unclear: "Sorry, I didn't catch that. Could you spell the email address for me?",
  retry: "I'm sorry, I wasn't able to verify that. Could you spell the email address for me once more?",
  takeMessage: "I'm sorry, I wasn't able to verify that, so I can't put you through, but I can take a message and have them call you back.",
} as const;

// --- Editing a property's owner emails (Property page and properties.updateProfile) ---------------

export const MAX_OWNER_EMAILS = 5;

/**
 * Every problem with an edited owner-email list, tied to its row (index), in order. Blank rows are
 * ignored. The Property page and the server run this same function, so their messages match.
 */
export function ownerEmailProblems(list: string[]): Array<{ index: number; message: string }> {
  const out: Array<{ index: number; message: string }> = [];
  const seen = new Map<string, number>();
  let filled = 0;
  list.forEach((raw, i) => {
    const e = canonicalEmail(raw);
    if (!e) return;
    filled++;
    const label = `Owner email ${i + 1}`;
    if (e.length > 200) out.push({ index: i, message: `${label} is too long (200 characters at most).` });
    else if (!isEmailShape(e)) out.push({ index: i, message: `${label}: enter a full email address, like name@example.com.` });
    else if (seen.has(e)) out.push({ index: i, message: `${label} is the same as owner email ${seen.get(e)! + 1}. Remove one of them.` });
    else seen.set(e, i);
  });
  if (filled > MAX_OWNER_EMAILS) out.push({ index: list.length - 1, message: `A property can have at most ${MAX_OWNER_EMAILS} owner emails.` });
  return out;
}

/** The stored list: trimmed, lowercase, blanks dropped, in the order given. Assumes ownerEmailProblems is empty. */
export function cleanOwnerEmails(list: string[]): string[] {
  return [...new Set(list.map(canonicalEmail).filter(Boolean))];
}
