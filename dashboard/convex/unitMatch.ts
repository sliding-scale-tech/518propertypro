/**
 * Pure string and phonetic matching for Sarah's find_unit tool. No Convex imports, no packages,
 * no embeddings: everything here is hand-written so it can be unit-tested with plain Node and
 * so its behaviour is easy to reason about on a phone call.
 *
 * Two jobs:
 *  1. spokenUnitKeys: the ways a caller's spoken unit can be read exactly ("unit to" -> "2",
 *     "B as in boy two" -> "b2", "one fourteen" -> "114"). A hit on any of these is the same unit
 *     the caller said, so it counts as an exact match (Sarah still confirms it with the caller).
 *  2. similarUnits / streetWordSimilar: when nothing is exact, which labels or street names are
 *     CLOSE to what was said. These are only ever offered as options for the caller to confirm;
 *     a similar label is never treated as identified.
 */

// --- Unit keys -------------------------------------------------------------------------------

/** Same normalization as units.normalizeUnitKey (kept in step; see the probe test). */
export function unitKey(s: string): string {
  let key = s.toLowerCase().trim();
  for (;;) {
    const next = key.replace(/^(?:unit|apartment|apt|suite|#)[\s.:#-]*/, "");
    if (next === key) break;
    key = next;
  }
  return key.replace(/[^a-z0-9]+/g, "");
}

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4,
  fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90,
};
const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th",
  seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
};
/** Spoken letter names and the phonetic alphabet. "a" and "i" are letters already. */
const LETTERS: Record<string, string> = {
  ay: "a", bee: "b", be: "b", see: "c", sea: "c", cee: "c", dee: "d", ee: "e", eff: "f", ef: "f",
  gee: "g", jee: "g", aitch: "h", jay: "j", kay: "k", el: "l", ell: "l", em: "m", en: "n",
  pee: "p", pea: "p", cue: "q", queue: "q", are: "r", ar: "r", ess: "s", tee: "t", tea: "t",
  vee: "v", ex: "x", why: "y", zee: "z", zed: "z",
  alpha: "a", alfa: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f",
  golf: "g", hotel: "h", india: "i", juliet: "j", juliett: "j", kilo: "k", lima: "l",
  mike: "m", november: "n", oscar: "o", papa: "p", quebec: "q", romeo: "r", sierra: "s",
  tango: "t", uniform: "u", victor: "v", whiskey: "w", whisky: "w", xray: "x", yankee: "y",
  zulu: "z",
};
/** Words a caller wraps around a unit that are never part of the label. */
const FILLER = new Set([
  "apartment", "apt", "unit", "number", "num", "no", "suite", "ste", "the", "its", "it", "is",
  "im", "i'm", "my", "in", "at", "um", "uh", "like", "please", "thats", "that's", "flat",
]);

type Tok = { kind: "num"; text: string } | { kind: "word"; text: string };

/**
 * Turns how a caller says a unit into tokens: number words to digits ("one fourteen" -> 1, 14),
 * "oh" as zero next to digits, letter names and phonetic alphabet to letters, "X as in Y" -> X,
 * ordinals ("third") to "3rd", and filler dropped.
 */
function spokenTokens(raw: string): Tok[] {
  const words = raw
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // "B as in boy": keep the letter, skip "as in <word>".
    if (words[i + 1] === "as" && words[i + 2] === "in") {
      const letter = /^[a-z]$/.test(w) ? w : LETTERS[w];
      if (letter) {
        out.push({ kind: "word", text: letter });
        i += 3;
        continue;
      }
    }
    if (FILLER.has(w)) continue;
    // "3rd" was split into "3" + "rd" above: put the ordinal back together.
    if (/^(st|nd|rd|th)$/.test(w) && out[out.length - 1]?.kind === "num") {
      const n = out.pop()!;
      out.push({ kind: "word", text: `${n.text}${w}` });
      continue;
    }
    if (/^\d+$/.test(w)) {
      out.push({ kind: "num", text: w });
      continue;
    }
    if (w in TENS) {
      // "twenty one" -> 21
      const next = words[i + 1];
      if (next && next in UNITS && UNITS[next] > 0 && next !== "oh") {
        out.push({ kind: "num", text: String(TENS[w] + UNITS[next]) });
        i++;
      } else out.push({ kind: "num", text: String(TENS[w]) });
      continue;
    }
    if (w in TEENS) {
      out.push({ kind: "num", text: String(TEENS[w]) });
      continue;
    }
    if (w === "hundred") {
      // "one hundred fourteen" -> 1, then "14" padded to two digits after it.
      const prev = out[out.length - 1];
      if (prev?.kind === "num") prev.text = `${prev.text}#H`;
      continue;
    }
    if (w in UNITS) {
      // "oh" and "o" are zero only next to other digits ("one oh one"); elsewhere they are a letter.
      if (w === "oh") {
        const prevNum = out[out.length - 1]?.kind === "num";
        const nextNum = /^\d+$/.test(words[i + 1] ?? "") || (words[i + 1] ?? "") in UNITS;
        if (!prevNum && !nextNum) {
          out.push({ kind: "word", text: "o" });
          continue;
        }
      }
      out.push({ kind: "num", text: String(UNITS[w]) });
      continue;
    }
    if (w === "o") {
      const prevNum = out[out.length - 1]?.kind === "num";
      const nextNum = /^\d+$/.test(words[i + 1] ?? "") || (words[i + 1] ?? "") in UNITS;
      out.push(prevNum && nextNum ? { kind: "num", text: "0" } : { kind: "word", text: "o" });
      continue;
    }
    if (w in ORDINALS) {
      out.push({ kind: "word", text: ORDINALS[w] });
      continue;
    }
    if (w in LETTERS) {
      out.push({ kind: "word", text: LETTERS[w] });
      continue;
    }
    out.push({ kind: "word", text: w.replace(/'/g, "") });
  }
  // Resolve "N hundred M": "1#H" followed by "14" -> "114"; "1#H" alone -> "100".
  const resolved: Tok[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.kind === "num" && t.text.endsWith("#H")) {
      const base = t.text.slice(0, -2);
      const next = out[i + 1];
      if (next?.kind === "num" && next.text.length <= 2) {
        resolved.push({ kind: "num", text: base + next.text.padStart(2, "0") });
        i++;
      } else resolved.push({ kind: "num", text: `${base}00` });
      continue;
    }
    resolved.push(t);
  }
  return resolved;
}

/**
 * Every exact reading of what the caller said, most literal first. "second floor" gives
 * "secondfloor", "2ndfloor" and "2"; "unit to" gives "to" and "2". Empty strings are dropped.
 */
export function spokenUnitKeys(raw: string): string[] {
  const keys: string[] = [];
  const push = (k: string) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  push(unitKey(raw));
  const toks = spokenTokens(raw);
  push(toks.map((t) => t.text).join(""));
  // Bare form: ordinals to plain digits and the word "floor" dropped ("third floor" -> "3").
  push(
    toks
      .filter((t) => t.text !== "floor" && t.text !== "fl")
      .map((t) => (t.kind === "word" && /^\d+(st|nd|rd|th)$/.test(t.text) ? t.text.replace(/\D+$/, "") : t.text))
      .join(""),
  );
  return keys;
}

/** Phrases meaning "there is no unit number" (a house or a whole building). */
export function saysNoUnit(raw: string | undefined): boolean {
  if (!raw) return true;
  const words = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return true;
  // "it's a house" -> "house". A single word is never trimmed: "A" is a real unit label.
  const filler = ["it", "its", "s", "is", "a", "an", "just", "there"];
  const s = (words.length > 1 ? words.filter((w) => !filler.includes(w)) : words).join(" ");
  if (!s) return false;
  return /^(?:none|no|nope|na|n a|not applicable|no unit|no unit number|no apartment|no number|there is no unit|theres no unit|house|the house|home|whole house|single family|single family home|townhouse|the whole building|whole building)$/.test(
    s,
  );
}

// --- Similarity ------------------------------------------------------------------------------

/** Letters that sound alike over phone audio or that speech-to-text swaps. */
const CONFUSABLE_GROUPS = ["bdeptvgcz", "mn", "fs", "ajk", "iy", "qu"];
function confusable(a: string, b: string): boolean {
  return a !== b && CONFUSABLE_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/** Levenshtein distance where swapping two confusable letters costs half. */
export function editDistance(a: string, b: string, weighted = false): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const same = a[i - 1] === b[j - 1];
      const sub = same ? 0 : weighted && confusable(a[i - 1], b[j - 1]) ? 0.5 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    prev = cur;
  }
  return prev[n];
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
const lettersOf = (s: string) => s.replace(/[^a-z]/g, "");
const sortChars = (s: string) => s.split("").sort().join("");

/**
 * How similar a spoken unit key is to a stored label key, 0 to 1. Features (the best one wins):
 *  - same digits and letters, letters placed differently ("4b" vs "b4"):           0.90
 *  - same digits, letters differ by one sound-alike letter ("d2" vs "b2"):          0.85
 *  - one is the other with a prefix/suffix added ("3a" in "43a", "b" in "b1"):  0.60 + 0.30 x the
 *    length ratio, +0.05 when it is both ("3a"/"43a" = 0.80, "b"/"b1" = 0.75, "1"/"101" = 0.75,
 *    "1"/"102" = 0.70)
 *  - same digits, letters missing on one side ("2" vs "2r"):                       0.70
 *  - same digits, unrelated letters ("d2" vs "a2"):                                0.55
 *  - edit distance (sound-alike letters cost half), both keys 2+ chars:  0.90 - 0.15 x distance,
 *    allowed up to 0.5 (one sound-alike swap) for 2-char keys, 1 for 3-4 chars, 2 for longer
 *    ("201" vs "101" = 0.75)
 */
export function unitSimilarity(spoken: string, label: string): number {
  if (!spoken || !label) return 0;
  if (spoken === label) return 1;
  let best = 0;
  const sd = digitsOf(spoken);
  const ld = digitsOf(label);
  const sl = lettersOf(spoken);
  const ll = lettersOf(label);

  // Same digits in the same order and the same letters, only placed differently: "4b" / "b4".
  // ("201" / "102" is NOT this: those are different numbers.)
  if (sd === ld && sl && sortChars(sl) === sortChars(ll)) best = Math.max(best, 0.9);
  if (sd && sd === ld) {
    if (sl.length === ll.length && sl.length > 0 && editDistance(sl, ll, true) <= 0.5) best = Math.max(best, 0.85);
    else if (!sl || !ll) best = Math.max(best, 0.7);
    else best = Math.max(best, 0.55);
  }
  // Containment: only when the shorter side is a real piece of the longer one.
  const [short, long] = spoken.length <= label.length ? [spoken, label] : [label, spoken];
  const pre = long.startsWith(short);
  const suf = long.endsWith(short);
  if (pre || suf) {
    best = Math.max(best, 0.6 + 0.3 * (short.length / long.length) + (pre && suf ? 0.05 : 0));
  }
  if (Math.min(spoken.length, label.length) >= 2) {
    const d = editDistance(spoken, label, true);
    const longest = Math.max(spoken.length, label.length);
    // Two-character keys allow only a sound-alike letter swap; one real slip there is half the label.
    const allowed = longest <= 2 ? 0.5 : longest <= 4 ? 1 : 2;
    if (d <= allowed) best = Math.max(best, 0.9 - 0.15 * d);
  }
  return best;
}

/** Below this a label is not offered at all. */
export const UNIT_SIMILARITY_THRESHOLD = 0.7;
/** Never more than this many unit options in one question. */
export const MAX_SIMILAR_UNITS = 4;

/** Natural order for labels: "2" before "10", "B1" before "B2". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/**
 * Labels close to what the caller said, best first, capped. `labels` are the building's stored
 * unit labels with their keys; unlabeled units (key "") are never offered.
 */
export function similarUnits(
  spokenKeys: string[],
  labels: Array<{ label: string; key: string }>,
): string[] {
  const scored = labels
    .filter((l) => l.key)
    .map((l) => ({ label: l.label, score: Math.max(0, ...spokenKeys.map((k) => unitSimilarity(k, l.key))) }))
    .filter((s) => s.score >= UNIT_SIMILARITY_THRESHOLD);
  scored.sort((a, b) => b.score - a.score || naturalCompare(a.label, b.label));
  return scored.slice(0, MAX_SIMILAR_UNITS).map((s) => s.label);
}

// --- Street names ----------------------------------------------------------------------------

/**
 * A small hand-written phonetic key in the spirit of Soundex: first letter, then consonant
 * classes, vowels and h/w/y dropped, repeats collapsed. "remson" and "remsen" -> "r525";
 * "lafayet" and "lafayette" -> "l13".
 */
export function phoneticKey(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  const code = (c: string): string => {
    if ("bfpv".includes(c)) return "1";
    if ("cgjkqsxz".includes(c)) return "2";
    if ("dt".includes(c)) return "3";
    if (c === "l") return "4";
    if ("mn".includes(c)) return "5";
    if (c === "r") return "6";
    return "";
  };
  let out = w[0];
  let last = code(w[0]);
  for (const c of w.slice(1)) {
    const k = code(c);
    if (k && k !== last) out += k;
    if (!"hw".includes(c)) last = k;
  }
  return out;
}

/**
 * How close a spoken street word is to a stored one: 1 exact, 0.8 a likely mishearing or
 * misspelling, 0 not the same street. Short words (under 4 letters, e.g. "3rd", "st") must be
 * exact, because one changed letter makes a different word.
 */
export function streetWordSimilar(spoken: string, stored: string): number {
  if (spoken === stored) return 1;
  if (spoken.length < 4 || stored.length < 4) return 0;
  const d = editDistance(spoken, stored);
  const longest = Math.max(spoken.length, stored.length);
  if (d <= 1) return 0.8;
  // Same sound key and close spelling: "lafayet" / "lafayette", "remsun" / "remsen".
  if (phoneticKey(spoken) === phoneticKey(stored) && d <= Math.max(2, Math.floor(longest / 3))) return 0.8;
  // Longer words tolerate two slips ("vanvranken" style run-togethers are rare; keep it at 2).
  if (longest >= 8 && d <= 2) return 0.8;
  return 0;
}

/**
 * A LOOSER street-word check, used only when the spoken house number EXACTLY matches one of our
 * buildings ("86 Ramsay Street" / "86 Ramsden Street" when we have 86 Remsen Street). Its result is
 * only ever a "Did you mean ...?" suggestion, never a match, so it can afford to be generous:
 *  - streetWordSimilar first (anything it accepts is accepted here too);
 *  - otherwise both words need 4+ letters, no digits, and the SAME first letter;
 *  - edit distance allowed scales with the longer word: a third of its length, or half of it
 *    when the two also sound alike (Soundex-style keys at most one step apart).
 * Returns 0.6 for a loose hit (below streetWordSimilar's 0.8), else 0.
 */
export function streetWordLoose(spoken: string, stored: string): number {
  const close = streetWordSimilar(spoken, stored);
  if (close > 0) return close;
  if (spoken.length < 4 || stored.length < 4) return 0;
  if (/\d/.test(spoken) || /\d/.test(stored)) return 0; // "3rd" / "5th" must be exact
  if (spoken[0] !== stored[0]) return 0;
  const longest = Math.max(spoken.length, stored.length);
  const d = editDistance(spoken, stored, true);
  const soundAlike = editDistance(phoneticKey(spoken), phoneticKey(stored)) <= 1;
  const allowed = soundAlike ? Math.ceil(longest / 2) : Math.floor(longest / 3);
  return d <= allowed ? 0.6 : 0;
}

/** Ordinal words a caller may say for numbered streets ("third street" -> "3rd"). */
export const STREET_ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th",
  seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th", nineteenth: "19th",
};

// --- Cities ----------------------------------------------------------------------------------

/**
 * The city a building is in: its stored `city`, else the part of the formatted address before
 * the state ("184 Remsen Street, Cohoes, NY 12047" -> "Cohoes"), else null. Never a guess.
 */
export function cityOfProperty(p: { city?: string | null; address?: { formatted?: string } | null }): string | null {
  const stored = p.city?.trim();
  if (stored) return stored;
  const parts = (p.address?.formatted ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const state = parts.findIndex((s, i) => i > 0 && /^(?:ny|new york)(?:\s+\d{5}(?:-\d{4})?)?$/i.test(s));
  return state > 1 ? parts[state - 1] : null;
}

/** Words around a city name that are never part of it ("albany ny", "the troy area"). */
const CITY_NOISE = new Set([
  "ny", "nys", "state", "upstate", "city", "of", "the", "in", "area", "around", "near", "by",
  "downtown", "somewhere", "town", "county", "like", "maybe", "probably", "please", "um", "uh",
  "im", "i", "looking", "rent", "renting", "to", "want", "would", "prefer", "preferably", "a",
  "an", "or", "and", "either", "also", "too", "thanks", "thank", "you", "just",
]);

/** Generic words a multi-word city name may contain; never enough on their own to match it. */
const GENERIC_CITY_WORDS = new Set([
  "park", "falls", "lake", "lakes", "city", "north", "south", "east", "west", "mount", "saint",
  "port", "spring", "springs", "village", "center", "centre", "junction", "heights", "hills",
  "valley", "beach", "new", "old", "upper", "lower", "fort",
]);

/** What a caller says when they have no area in mind. Checked only when no city matched. */
const NO_PREFERENCE =
  /\b(?:any ?where|any ?place|wherever|every ?where|no preference|no particular|not sure|unsure|dont know|do not know|no idea|doesnt matter|does not matter|dont mind|flexible|open to (?:any|all)|any (?:area|city|town)|all of them|capital (?:region|district|area))\b/;

function cityWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\bnew york\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * streetWordSimilar for a city name, stricter for short names: "Troy" tolerates one slip
 * ("Troi"), not a sound-alike two letters off ("true").
 */
function citySimilar(spoken: string, city: string): number {
  if (spoken === city) return 1;
  if (Math.max(spoken.length, city.length) <= 5) {
    return Math.min(spoken.length, city.length) >= 4 && editDistance(spoken, city) <= 1 ? 0.8 : 0;
  }
  return streetWordSimilar(spoken, city);
}

export type CityMatch =
  | { status: "not_given" }
  | { status: "no_preference" }
  | { status: "unknown"; spoken: string }
  /** `cities` are labels exactly as stored, best match first. */
  | { status: "matched"; cities: string[] };

/**
 * Which of the team's cities a spoken area refers to. `cities` comes from the data (never a
 * fixed list). Case, "NY" / "New York" / "state" and filler are ignored; spelling and
 * speech-to-text slips ("Skenectady", "Albanie") match through streetWordSimilar on the joined
 * words, so "clifton park" and "cliftonpark" are the same. A distinctive single word of a
 * multi-word city ("Clifton") matches it too. Several cities can match ("Albany or Troy").
 * "Anywhere", "not sure" and "the Capital Region" are no preference.
 */
export function matchCities(spoken: string | undefined | null, cities: string[]): CityMatch {
  const raw = (spoken ?? "").trim();
  if (!/[a-z]/i.test(raw)) return { status: "not_given" };
  const allWords = cityWords(raw);
  const words = allWords.filter((w) => !CITY_NOISE.has(w) && !/^\d+$/.test(w));

  const known = new Map<string, string>();
  for (const c of cities) {
    const label = c.trim();
    const key = cityWords(label).join(" ");
    if (key && !known.has(key)) known.set(key, label);
  }

  const scores = new Map<string, { score: number; at: number }>();
  for (const [key, label] of known) {
    const parts = key.split(" ");
    const joined = parts.join("");
    let best = 0;
    let at = Infinity;
    // Every run of spoken words of about the city's length, compared with the words joined up.
    for (let n = Math.max(1, parts.length - 1); n <= parts.length + 1; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const s = citySimilar(words.slice(i, i + n).join(""), joined);
        if (s > best || (s === best && s > 0 && i < at)) {
          best = s;
          at = i;
        }
      }
    }
    // "Clifton" for "Clifton Park": one distinctive word of a multi-word city.
    if (best === 0 && parts.length > 1) {
      for (const part of parts) {
        if (part.length < 5 || GENERIC_CITY_WORDS.has(part)) continue;
        words.forEach((w, i) => {
          const s = citySimilar(w, part) * 0.9;
          if (s > best) {
            best = s;
            at = i;
          }
        });
      }
    }
    if (best > 0) scores.set(label, { score: best, at });
  }

  if (scores.size > 0) {
    const cityList = [...scores.entries()]
      .sort((a, b) => a[1].at - b[1].at || b[1].score - a[1].score)
      .map(([label]) => label);
    return { status: "matched", cities: cityList };
  }
  if (NO_PREFERENCE.test(allWords.join(" "))) return { status: "no_preference" };
  return { status: "unknown", spoken: raw };
}
