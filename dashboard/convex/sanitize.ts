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
 * Expressive mode makes the LLM put delivery tags in what it says ("[happy] Thanks."). The voice acts
 * on them, but people must never read them, so they are removed from transcripts and from anything
 * Sarah writes into a record. Only the tag shapes are matched: one word of letters, or two lowercase
 * words ("[speaking softly]"). "[B2]" and "[first_name]" stay. A tag cut off at the end of a reply by
 * the token limit ("[slow") goes too.
 */
const AUDIO_TAGS = /(?:[ \t]*\[(?:[A-Za-z]+|[a-z]+[ -][a-z]+)\][ \t]*)+/g;
const CUT_OFF_AUDIO_TAG = /[ \t]*\[[A-Za-z]*$/;

export function stripAudioTags(text: string): string {
  if (!text.includes("[")) return text;
  return text
    .replace(AUDIO_TAGS, (tags: string, at: number, whole: string) => {
      const before = whole[at - 1];
      const after = whole[at + tags.length];
      const atEdge = before === undefined || before === "\n" || after === undefined || after === "\n";
      return atEdge || /[.,!?;:]/.test(after) ? "" : " ";
    })
    .replace(CUT_OFF_AUDIO_TAG, "");
}

/**
 * Words that say a call is about maintenance without saying what is wrong. On 2026-11-02 Sarah
 * logged "Maintenance complaint." the moment a caller said "I have a maintenance complaint", and
 * the empty request was routed to the asset manager. Only generic words are listed: one real
 * word ("window", "heat", "leak", "toilet") makes a description specific.
 */
const VAGUE_ISSUE_WORDS = new Set(
  (
    "a an the my our their his her its it it's i i'm im we they he she me you your this that these " +
    "is are was were be been has have had there there's some something someone kind sort of about with " +
    "for in on at to from and or just please also general generic other unspecified specific not yet no " +
    "details detail given provided described description pending tbd tba unknown need needs needed want " +
    "wants would like calling called call caller resident tenant reports reported reporting report " +
    "log logged logging new maintenance maint complaint complaints issue issues problem problems request " +
    "requests repair repairs concern concerns question questions help work order ticket service fix " +
    "fixed fixing broken working wrong apartment apt unit home place building property house room " +
    "address avenue ave street st road rd lane ln drive dr boulevard blvd pl court ct floor " +
    "renter occupant wanted assistance regarding"
  ).split(" "),
);

/** Words that, right before a capitalised name, say "someone is reporting" ("Resident Tom Martin"). */
const REPORTER_ROLES = new Set(["resident", "tenant", "caller", "renter", "occupant"]);
/** Words that, right after a capitalised name, say "someone is reporting" ("Tom reporting ..."). */
const REPORTER_VERBS = new Set([
  "reporting", "reported", "reports", "report", "calling", "called", "calls", "call",
  "wants", "wanted", "needs", "need", "requesting", "requests", "request",
]);
/** Generic nouns that stand in for "a problem" when no actual problem is named. */
const GENERIC_ISSUE_NOUNS = new Set([
  "maintenance", "maint", "issue", "issues", "problem", "problems", "complaint", "complaints",
  "concern", "concerns", "request", "requests", "repair", "repairs", "service", "help", "assistance",
]);

/**
 * True when a maintenance description says nothing about what is wrong: blank, a placeholder, or
 * only generic words ("Maintenance complaint", "Caller has an issue with their unit"). `known`
 * holds the caller's name, address and unit from the same call, so "Tom Martin at 1 Washington
 * Avenue has a maintenance issue" still counts as vague. Numbers and single letters are ignored.
 */
export function isVagueIssue(input?: string | null, known: Array<string | undefined> = []): boolean {
  const value = realValue(input);
  if (!value) return true;
  const knownWords = new Set(known.join(" ").toLowerCase().match(/[a-z']+/g) ?? []);
  const tokens = value.match(/[A-Za-z0-9']+/g) ?? [];
  const lower = tokens.map((t) => t.toLowerCase());
  const remaining: number[] = [];
  lower.forEach((w, i) => {
    const generic =
      VAGUE_ISSUE_WORDS.has(w) || knownWords.has(w) || /^\d+[a-z]{0,2}$/.test(w) || w.length === 1;
    if (!generic) remaining.push(i);
  });
  if (remaining.length === 0) return true;
  // The caller's name when the model left caller_name out: "Resident Tom Martin reporting a
  // maintenance issue." is still no issue. Deliberately narrow: up to three adjacent capitalised
  // alphabetic words, framed as a reporter (a role word before, or a reporting word after), in a
  // sentence whose only nouns are generic ("maintenance issue"). Anything else counts as content,
  // so a real problem is never rejected.
  if (remaining.length > 3) return false;
  const first = remaining[0];
  const last = remaining[remaining.length - 1];
  const isName = remaining.every(
    (i, n) => /^[A-Z][a-z']+$/.test(tokens[i]) && (n === 0 || i === remaining[n - 1] + 1),
  );
  if (!isName) return false;
  const framed =
    (first > 0 && REPORTER_ROLES.has(lower[first - 1])) ||
    (last + 1 < lower.length && REPORTER_VERBS.has(lower[last + 1]));
  return framed && lower.some((w) => GENERIC_ISSUE_NOUNS.has(w));
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
