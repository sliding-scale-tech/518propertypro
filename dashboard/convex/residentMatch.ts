/**
 * Pure name matching: does the name a caller gave belong to one of the people on a unit's
 * resident list? No Convex imports and no packages, so it can be unit-tested with plain Node
 * (scripts/probes/resident_match.test.mjs) and reused later for building-level identification.
 *
 * Used to VERIFY a caller before anything about their unit is disclosed (check_work_order_status),
 * so it errs on the side of "no match": a miss only means the question goes to a team member.
 *
 * Rules:
 *  - A stored entry can hold several people: "Amanda Chura & Breianna Selig" is two people, and a
 *    shared trailing surname applies to every first name before it ("Christina & Kaylee Sharp" is
 *    Christina Sharp and Kaylee Sharp). Separators: "&", "and", "+", "/".
 *  - A FULL name matches a person when the first name and the surname both match. The surname may
 *    be the whole rest of the stored name ("Van Wyk", "St Louis") or its last word, and each half of
 *    a hyphenated surname counts. A middle name is never taken for a surname.
 *  - A FIRST name alone matches only when exactly one person in the unit has that first name.
 *  - A surname that does not match is a miss: it never falls back to the first name alone.
 *  - A surname next to a matching first name may also be a sound-alike: the same consonant sounds,
 *    first letters that sound the same (S/C, C/K, F/V, G/J), up to half the letters spelled differently
 *    ("Sermic" for "Cermik"; found on a real test call, 2026-10-31).
 *  - Tolerance is otherwise small, for spelling and speech-to-text slips only: same first letter, one
 *    letter off for ordinary names (two for long ones, or for two sound-alike spellings), and
 *    exact for 3-letter names. A first name used on its own is held to a stricter bar (exact up to
 *    4 letters, one letter off above that).
 */

import { editDistance, phoneticKey } from "./unitMatch";

export type Person = {
  first: string;
  /** Surname words after the first name, as stored ("van", "wyk"); empty for a single-word entry. */
  rest: string[];
};

/** Leading words that are never part of a name ("Mr. Halal", "my name is Sam"). */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "madam", "mister"]);
const SPOKEN_LEAD =
  /^(?:(?:hi|hello|hey|yes|yeah|yep|um|uh|so|oh|ok|okay)[\s,]+)*(?:(?:this is|it is|its|it's|i am|im|i'm|my name is|my names|my name's|name is|the name is|you're speaking with|youre speaking with|you are speaking with|speaking with)\s+)?/;

function normalize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[’'`.]/g, "") // O'Neil -> oneil, Mr. -> mr
    .replace(/\s*-\s*/g, "-") // "Maloney - Diamond" -> "maloney-diamond"
    .replace(/[^a-z&+/\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(part: string): string[] {
  const toks = part.split(" ").filter((t) => t && t !== "-");
  while (toks.length > 0 && TITLES.has(toks[0])) toks.shift();
  return toks.map((t) => t.replace(/^-+|-+$/g, "")).filter(Boolean);
}

/** The people in one stored resident entry (or in what a caller said). */
export function peopleOf(raw: string | undefined | null, spoken = false): Person[] {
  let s = normalize(raw ?? "");
  if (spoken) s = s.replace(SPOKEN_LEAD, "");
  if (!s) return [];
  const parts = s
    .split(/\s*(?:&|\+|\/|\band\b)\s*/)
    .map(tokensOf)
    .filter((t) => t.length > 0);
  if (parts.length === 0) return [];
  // "Christina & Kaylee Sharp": the last part's surname applies to the bare first names before it.
  const last = parts[parts.length - 1];
  const shared = last.length >= 2 ? last.slice(1) : [];
  return parts.map((toks, i) => ({
    first: toks[0],
    rest: toks.length > 1 ? toks.slice(1) : i < parts.length - 1 ? shared : [],
  }));
}

/** Every way the surname can be said: the whole rest, its last word, each half of a hyphen. */
function surnameForms(rest: string[]): string[] {
  if (rest.length === 0) return [];
  const forms = new Set<string>();
  const add = (s: string) => {
    if (s.length >= 2) forms.add(s);
  };
  add(rest.join("").replace(/-/g, ""));
  const lastWord = rest[rest.length - 1];
  add(lastWord.replace(/-/g, ""));
  for (const piece of lastWord.split("-")) add(piece);
  return [...forms];
}

/** One name word against another, with the small tolerance described above. */
export function nameWordSimilar(spoken: string, stored: string): boolean {
  if (spoken === stored) return true;
  if (!spoken || !stored || spoken[0] !== stored[0]) return false;
  const short = Math.min(spoken.length, stored.length);
  const long = Math.max(spoken.length, stored.length);
  if (short < 3 || long <= 3) return false; // "Dan" / "Don": exact only. "Jon" / "John" is fine.
  const d = editDistance(spoken, stored);
  if (long <= 7) return d <= 1 || (d <= 2 && short >= 5 && phoneticKey(spoken) === phoneticKey(stored));
  return d <= 2;
}

/** First letters a phone line or speech-to-text swaps for the same sound ("Sermic" / "Cermik"). */
const SOUND_ALIKE_FIRST = ["csz", "ckq", "fv", "gj", "ie", "ao", "uo"];

/** Consonant classes over the WHOLE word (first letter included), vowels and h/w/y dropped. */
function soundCode(word: string): string {
  const code = (c: string): string =>
    "bfpv".includes(c) ? "1" : "cgjkqsxz".includes(c) ? "2" : "dt".includes(c) ? "3" : c === "l" ? "4" : "mn".includes(c) ? "5" : c === "r" ? "6" : "";
  let out = "";
  let last = "";
  for (const c of word) {
    const k = code(c);
    if (k && k !== last) out += k;
    if (!"hw".includes(c)) last = k;
  }
  return out;
}

/**
 * Surnames only, and only next to a matching first name: the same surname heard differently. The
 * first letters may be a sound-alike pair (S/C/Z, C/K/Q, F/V, G/J), the consonant sounds must be
 * identical, and the spelling may differ by up to half the longer word ("Sermic" / "Cermik").
 */
export function surnameSoundAlike(spoken: string, stored: string): boolean {
  if (nameWordSimilar(spoken, stored)) return true;
  if (Math.min(spoken.length, stored.length) < 4 || Math.abs(spoken.length - stored.length) > 2) return false;
  const a = spoken[0];
  const b = stored[0];
  if (a !== b && !SOUND_ALIKE_FIRST.some((g) => g.includes(a) && g.includes(b))) return false;
  const code = soundCode(spoken);
  if (code.length < 2 || code !== soundCode(stored)) return false;
  return editDistance(spoken, stored) <= Math.ceil(Math.max(spoken.length, stored.length) / 2);
}

/** A first name said on its own: stricter, because it is the only thing being checked. */
function firstAloneSimilar(spoken: string, stored: string): boolean {
  if (spoken === stored) return true;
  if (Math.max(spoken.length, stored.length) <= 4) return false;
  return spoken[0] === stored[0] && editDistance(spoken, stored) <= 1;
}

export type NameMatch =
  | { matched: true; how: "full_name" | "first_name"; residentId: string }
  | { matched: false; reason: "no_name" | "no_residents" | "no_match" | "first_name_not_unique" };

/**
 * Does `spokenName` belong to one of `residents` (the ACTIVE residents of ONE unit)? Returns the
 * matching resident's id, never anything about anyone else.
 */
export function matchResidentName(
  spokenName: string | undefined | null,
  residents: ReadonlyArray<{ id: string; fullName: string }>,
): NameMatch {
  const said = peopleOf(spokenName, true);
  if (said.length === 0) return { matched: false, reason: "no_name" };
  const people = residents.flatMap((r) => peopleOf(r.fullName).map((p) => ({ ...p, residentId: r.id })));
  if (people.length === 0) return { matched: false, reason: "no_residents" };

  let firstNotUnique = false;
  for (const s of said) {
    if (s.rest.length > 0) {
      const spokenForms = surnameForms(s.rest);
      const hit = people.find((p) => {
        if (!nameWordSimilar(s.first, p.first)) return false;
        // A single-word entry ("Halal") has no surname to compare: only its one name can match.
        if (p.rest.length === 0) return false;
        const stored = surnameForms(p.rest);
        return spokenForms.some((a) => stored.some((b) => surnameSoundAlike(a, b)));
      });
      if (hit) return { matched: true, how: "full_name", residentId: hit.residentId };
      // A wrong surname is a miss; it never falls back to the first name alone. The exception is a
      // stored single-word entry, which is matched on that word below.
      // A single-word entry may be a first name or a surname ("Mr. Okafor"): either spoken word counts.
      const lastSaid = s.rest[s.rest.length - 1].replace(/-/g, "");
      const singles = people.filter(
        (p) => p.rest.length === 0 && (firstAloneSimilar(s.first, p.first) || firstAloneSimilar(lastSaid, p.first)),
      );
      if (singles.length === 1 && !people.some((p) => p.rest.length > 0 && nameWordSimilar(s.first, p.first))) {
        return { matched: true, how: "first_name", residentId: singles[0].residentId };
      }
      continue;
    }
    const hits = people.filter((p) => firstAloneSimilar(s.first, p.first));
    // The same person listed twice is still one person; two different people are not unique.
    const distinct = new Set(hits.map((p) => `${p.first} ${p.rest.join(" ")}`));
    if (distinct.size === 1) return { matched: true, how: "first_name", residentId: hits[0].residentId };
    if (distinct.size > 1) firstNotUnique = true;
  }
  return { matched: false, reason: firstNotUnique ? "first_name_not_unique" : "no_match" };
}
