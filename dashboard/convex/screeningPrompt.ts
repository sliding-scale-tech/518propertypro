/**
 * Prompt surgery for the pre-screening questions feature.
 *
 * A pure module with no Convex function definitions, so the Settings page can import it
 * without pulling server code into the client bundle — same reason convex/waPrompt.ts and
 * convex/residentTriage.ts are shaped this way.
 *
 * This exists because agents.prompt lives in the database, not in the code. Editing
 * LEASING_PROMPT in convex/agents.ts changes what a NEW agent starts with and nothing about
 * an agent that already exists — saveAgent resolves `args.prompt ?? existing.prompt`. Every
 * agent created before this feature shipped still carries the old wording, which says the
 * five built-in fields are the only things that can be asked or can qualify. Left alone, that
 * text now directly contradicts the screening block appended after it, and a model handed two
 * contradictory instructions picks one unpredictably.
 */

export const SCREENING_PLACEHOLDER = "{{SCREENING_QUESTIONS}}";
export const CORE_PLACEHOLDER = "{{CORE_QUESTIONS}}";

/**
 * Generation 1: the original shipped prompt -> manager-defined extra questions.
 *
 * Kept after generation 2 shipped because an agent can still be carrying this text — anything
 * created from the old default, or restored from a backup. upgradeForScreening runs the
 * generations in order, so gen-1 output feeds straight into gen-2.
 */
const REWRITES_V1: Array<[string, string]> = [
  [
    `2. If it's a leasing inquiry, gather exactly five things — no more, no fewer — before
   deciding anything: unit type/bedroom count wanted, move-in timeline, budget range,
   whether they have pets (and what kind, if yes), and their name plus a callback number.
   Ask for these conversationally, one or two at a time, not as an interrogation. If they
   already told you one in passing, don't ask again.`,
    `2. If it's a leasing inquiry, gather these five things before deciding anything: unit
   type/bedroom count wanted, move-in timeline, budget range, whether they have pets (and
   what kind, if yes), and their name plus a callback number. Then ask anything listed
   under EXTRA SCREENING QUESTIONS below — those are set by this property and are just as
   required as the five. If that section is empty, the five are all there is; never invent
   extra questions of your own. Ask conversationally, one or two at a time, not as an
   interrogation. If they already told you one in passing, don't ask again.`,
  ],
  [
    `3. Once you have all five, call check_qualification with exactly those fields. Do not
   guess or estimate any of them yourself — the tool applies the actual property rules.`,
    `3. Once you have all of them, call check_qualification with those fields, plus every extra
   screening answer in the screening_answers argument. Do not guess or estimate any of them
   yourself — the tool applies the actual property rules.`,
  ],
  [
    `WHAT YOU NEVER DECIDE YOURSELF:
Qualification is based only on these five fields: unit type, move-in timeline, budget,
pets, and contact info. Nothing else — not how someone sounds, their name, their accent,
anything they mention about themselves — ever factors into whether they qualify. If you
are ever unsure whether someone qualifies, that is what check_qualification is for. Never
make that call on your own judgment.`,
    `WHAT YOU NEVER DECIDE YOURSELF:
Qualification is based only on the five fields above and the EXTRA SCREENING QUESTIONS
section — unit type, move-in timeline, budget, pets, contact info, and whatever this
property has explicitly listed there. Nothing else — not how someone sounds, their name,
their accent, anything they mention about themselves — ever factors into whether they
qualify. Your job is to report the answers accurately, not to judge them: never decide that
an answer disqualifies someone, and never skip asking a question because you assume you
know how it will go. check_qualification makes that call. Never make it on your own
judgment.

${SCREENING_PLACEHOLDER}`,
  ],
];

/**
 * Generation 2: the five built-in questions stop being fixed prose and become a rendered
 * block, so each manager can switch three of them off.
 */
const REWRITES_V2: Array<[string, string]> = [
  [
    `2. If it's a leasing inquiry, gather these five things before deciding anything: unit
   type/bedroom count wanted, move-in timeline, budget range, whether they have pets (and
   what kind, if yes), and their name plus a callback number. Then ask anything listed
   under EXTRA SCREENING QUESTIONS below — those are set by this property and are just as
   required as the five. If that section is empty, the five are all there is; never invent
   extra questions of your own. Ask conversationally, one or two at a time, not as an
   interrogation. If they already told you one in passing, don't ask again.`,
    `2. If it's a leasing inquiry, gather everything listed under WHAT TO ASK EVERY LEASING
   CALLER below before deciding anything, then everything under EXTRA SCREENING QUESTIONS.
   Both lists are set by this property. Never invent questions of your own.`,
  ],
  [
    `3. Once you have all of them, call check_qualification with those fields, plus every extra
   screening answer in the screening_answers argument. Do not guess or estimate any of them
   yourself — the tool applies the actual property rules.`,
    `3. Once you have all of them, call check_qualification. Send only the fields you were
   actually told to ask about — leave the rest out entirely rather than guessing at them —
   plus every extra screening answer in the screening_answers argument. Do not estimate any
   value yourself; the tool applies the actual property rules.`,
  ],
  [
    `PACING:
Move at a natural, brisk pace.`,
    `${CORE_PLACEHOLDER}

PACING:
Move at a natural, brisk pace.`,
  ],
  [
    `WHAT YOU NEVER DECIDE YOURSELF:
Qualification is based only on the five fields above and the EXTRA SCREENING QUESTIONS
section — unit type, move-in timeline, budget, pets, contact info, and whatever this
property has explicitly listed there. Nothing else`,
    `WHAT YOU NEVER DECIDE YOURSELF:
Qualification is based only on what the WHAT TO ASK EVERY LEASING CALLER and EXTRA SCREENING
QUESTIONS sections list, and nothing else`,
  ],
];

const GENERATIONS = [REWRITES_V1, REWRITES_V2];

/** True when this prompt still needs upgrading — drives the Settings banner. */
export function needsScreeningUpgrade(prompt: string): boolean {
  return !prompt.includes(SCREENING_PLACEHOLDER) || !prompt.includes(CORE_PLACEHOLDER);
}

/**
 * True when the stale passages are NOT the ones we know how to rewrite — the manager edited
 * them by hand. upgradeForScreening still works (it appends the placeholder), but the old
 * "these five fields are all that qualify" wording will survive somewhere above it and has to
 * be cleaned up by hand. The Settings banner says so rather than pretending otherwise.
 */
export function hasUnknownWording(prompt: string): boolean {
  // Walk the generations the way upgradeForScreening does, so a prompt that is merely one
  // generation behind is not mistaken for a hand-edited one.
  let next = prompt;
  let unknown = false;
  for (const rewrites of GENERATIONS) {
    for (const [before, after] of rewrites) {
      if (next.includes(before)) next = next.replace(before, after);
      else if (!next.includes(after)) unknown = true;
    }
  }
  return unknown;
}

/**
 * Rewrites the passages that contradict manager-defined questions and guarantees the block
 * has somewhere to render.
 *
 * Appends rather than replaces wholesale, for the same reason the resident-triage button
 * does: a manager's hand edits elsewhere in the prompt must survive this.
 */
export function upgradeForScreening(prompt: string): string {
  if (!needsScreeningUpgrade(prompt)) return prompt;

  let next = prompt;
  for (const rewrites of GENERATIONS) {
    for (const [before, replacement] of rewrites) {
      if (next.includes(before)) next = next.replace(before, replacement);
    }
  }

  // Appended last-resort so the blocks always have somewhere to render, even in a prompt
  // edited past recognition. Core first: an agent with no WHAT TO ASK section has nothing
  // telling it what to collect at all.
  if (!next.includes(CORE_PLACEHOLDER)) {
    next = `${next.trimEnd()}\n\n${CORE_PLACEHOLDER}`;
  }
  if (!next.includes(SCREENING_PLACEHOLDER)) {
    next = `${next.trimEnd()}\n\n${SCREENING_PLACEHOLDER}`;
  }
  return next;
}
