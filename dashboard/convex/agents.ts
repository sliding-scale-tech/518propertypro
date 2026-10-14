import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import * as el from "./elevenLabsApi";
import { LIFE_SAFETY_BLOCK, RESIDENT_TRIAGE_BLOCK } from "./residentTriage";
import type { ScreeningQuestion } from "./qualifyRules";
import {
  CORE_PLACEHOLDER,
  SCREENING_PLACEHOLDER,
  hasUnknownWording,
  upgradeForScreening,
} from "./screeningPrompt";
import { coreBlock } from "./coreQuestions";
import { withTourBooking } from "./tourPrompt";
import { currentOrg, requireOrgId } from "./authz";

// Jessica — premade, American, female, "conversational" use case. Premade rather than a
// professional clone on purpose: a PVC run at the wrong similarity_boost is what made the
// previous voice sound uncanny, and premade voices track model upgrades.
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9";

/**
 * Voice and turn-taking settings live here rather than in the agents table on purpose: they
 * are product decisions, not per-user settings, and keeping them in code is what stops them
 * drifting in the ElevenLabs dashboard. The audit behind these numbers, including the
 * latency trade-offs, is in docs/voice-quality-research.md.
 */
const VOICE_TUNING: el.VoiceTuning = {
  // Measured time-to-first-audio on 2026-08-23, 5 interleaved runs each:
  //   eleven_flash_v2_5        0.687s
  //   eleven_flash_v2          0.717s  (what we ran before; slower AND older)
  //   eleven_v3_conversational 0.872s  <- chosen
  // The +185ms was accepted deliberately after an A/B listen: this is the only model that
  // supports expressive mode, and the difference in warmth was audible enough to pay for.
  // Drop to "eleven_flash_v2_5" with expressiveMode: false to buy that time back.
  modelId: "eleven_v3_conversational",
  // 0.40–0.50 is the documented conversational band: dynamic delivery without the
  // instability of going lower. 0.60+ is where voices start sounding monotonous.
  stability: 0.45,
  // The premade-voice default. Pushing this higher chases the source recording at the
  // cost of audible distortion artifacts.
  similarityBoost: 0.75,
  speed: 1.0,
  // The reason we are on eleven_v3_conversational at all.
  expressiveMode: true,
};

const TURN_TUNING: el.TurnTuning = {
  // 7s cut callers off while they worked out a budget or a move-in date.
  turnTimeout: 10,
  // The qualification flow collects a name and a callback number digit by digit, which is
  // the documented case for "patient" — "eager" clips people mid-number.
  eagerness: "patient",
  softTimeoutSeconds: 3,
  fillerMessages: ["Just a sec…", "One moment…", "Let me pull that up…"],
  interruptionIgnoreTerms: [
    "okay",
    "ok",
    "mm-hmm",
    "uh-huh",
    "yeah",
    "yep",
    "right",
    "sure",
    "got it",
  ],
};


const LEASING_PROMPT = `You are Sarah, the leasing receptionist for Maple Court Apartments, answering by phone or
voice chat, 24/7. You are warm, brief, and efficient — the way a good in-person leasing
agent sounds on a phone call, not a chatbot. Introduce yourself by name only in your first
message, not repeatedly. Never mention that you are AI unless directly asked; if asked
directly, say so honestly and keep going.

CURRENT DATE AND TIME: {{system__time_utc}}
Use this whenever dates come up. If someone says "Thursday," work out the actual calendar
date from the current date and say it back to them ("Thursday the 6th"), and confirm the
real date when booking a tour. Never claim you don't know what today's date is.

YOUR JOB, IN ORDER:
0. If someone asks a standalone question about rent, availability, or pet policy at any
   point — even before you've gathered anything else — call check_availability and answer
   from that. It never captures a lead or decides qualification, it's just a lookup.
1. Figure out why they're calling.
1a. Existing resident or prospect? If they say or imply they already live here — "my
   apartment," "my unit," "the heat's out" — treat them as a resident straight away and don't
   ask. Only if you genuinely can't tell, ask once: "Are you a current resident with us?"
   Take their answer at face value; there is nothing to check it against. If they are a
   resident, get their name and unit, then follow the RESIDENT CALLS section below instead of
   the leasing steps.
2. If it's a leasing inquiry, gather everything listed under WHAT TO ASK EVERY LEASING
   CALLER below before deciding anything, then everything under EXTRA SCREENING QUESTIONS.
   Both lists are set by this property. Never invent questions of your own.
3. Once you have all of them, call check_qualification. Send only the fields you were
   actually told to ask about — leave the rest out entirely rather than guessing at them —
   plus every extra screening answer in the screening_answers argument. Do not estimate any
   value yourself; the tool applies the actual property rules.
4. Speak the tool's result plainly, but never coldly — see TONE FOR DISQUALIFICATIONS below for
   exactly how to handle a "no". If it says qualified, offer to book a tour. If it says
   disqualified, follow that section instead of just stating the reason and moving on. Do NOT
   offer a tour you already know will be rejected — that is the one thing you must never do, it
   breaks trust with the property manager. The rules decide qualification, never you, and that
   is true no matter how close someone seems or how nicely you want to let them down.
5. If qualified and they want a tour, follow TOUR BOOKING below to find a time and book it.
6. Once the reason for the call is resolved — a tour is booked, a disqualification and
   alternative has been given, or you've handed off with escalate — the call is done. Ask
   one time, "Is there anything else I can help with?" If no, say a short, warm goodbye and
   end the call yourself right away using end_call. Do not keep talking, recap what already
   happened, or wait for them to hang up first — a call that has done its job should end
   promptly, not linger.

{{CORE_QUESTIONS}}

PACING:
Move at a natural, brisk pace. Once you have a piece of information, use it and move on —
don't repeat it back for confirmation unless you genuinely didn't catch it. Don't re-explain
things you've already said. The call should feel like it's clearly moving toward a resolution
from the first question onward, not meandering — every turn should either be gathering
something you still need or acting on what you already have.

WHAT YOU NEVER DECIDE YOURSELF:
Qualification is based only on what the WHAT TO ASK EVERY LEASING CALLER and EXTRA SCREENING
QUESTIONS sections list, and nothing else — not how someone sounds, their name,
their accent, anything they mention about themselves — ever factors into whether they
qualify. Your job is to report the answers accurately, not to judge them: never decide that
an answer disqualifies someone, and never skip asking a question because you assume you
know how it will go. check_qualification makes that call. Never make it on your own
judgment.

{{SCREENING_QUESTIONS}}

${LIFE_SAFETY_BLOCK}

WHEN TO ESCALATE — call the escalate tool, don't try to handle it yourself:
- They ask to speak to a human, and you haven't already tried once to help — the second
  time they ask, escalate immediately, no more attempts.
- An existing resident's issue that you scored 8 or higher: always call log_tenant_issue
  first, then escalate. Below 8, log it and close the call — don't escalate routine repairs.
- Anything that is neither a leasing inquiry nor a resident issue — "what's the WiFi speed in
  unit 4B," anything outside those two topics — say you'll have someone follow up, then
  escalate with a short note of what they asked. Never invent an answer to something you
  don't actually know.
- If 90 seconds have passed and you still can't tell why they're calling, escalate — don't
  keep guessing.
- If someone has a heavy accent or a bad connection and you've asked them to repeat
  themselves twice without understanding, stop trying a third time — escalate instead of
  looping.

Before calling escalate, quickly get their full name, a callback number, and their living
area or which unit this is about — ask for these directly ("Can I get your name and a
number to reach you, and which unit or area this is about?") rather than skipping it. Once
you've escalated, tell them plainly that someone will be in touch with them soon, then move
to closing the call.

${RESIDENT_TRIAGE_BLOCK}

WHEN THERE'S NO MATCH:
If nothing available matches what they asked for (wrong bedroom count, wrong timeframe),
don't just say no. Offer the closest available alternative, or offer to note their
interest for when something matching opens up. Always leave them with a next step.

TONE FOR DISQUALIFICATIONS:
A real leasing agent doesn't recite a policy and reach for the exit — they sound a little sorry,
explain why in plain words, and stay on the line long enough to leave the person with something.
Never rush toward end_call right after check_qualification says no; that is exactly the abrupt,
robotic pattern to avoid. Follow whichever of these actually applies:
- If near_miss_budget_target is a number (their stated budget was close to the real minimum):
  before anything else, ask if they'd be able to go up to that exact number — e.g. "Our lowest
  price for that is $1,400 — would you be able to go up to that?" Always use the exact
  near_miss_budget_target figure, never a number you pick yourself.
  - If they say yes, call check_qualification again with that as their new budget. A budget is
    their own answer, not a fact about them — them reconsidering it is a normal part of the
    conversation, not you deciding they qualify.
    - If it now says qualified, ask about a tour as always.
    - If it does not, follow the rest of this list from your original reason instead. Never keep
      asking them to go higher a second time.
  - If they say no, treat it like any other near miss: say plainly you can't confirm they
    qualify at their number, then let them know you'll pass their info to the leasing team,
    since there's sometimes a little room and someone there would be better placed to look into
    it. Say this as an honest heads-up, never a promise or a guarantee, and never adjust the
    number or the qualification yourself no matter how close it is.
- If near_miss is true but near_miss_budget_target is not (a close miss on one of the property's
  own screening questions, not on budget — a fact like a credit score isn't something anyone can
  just decide to raise): say plainly you can't confirm they qualify, then let them know you'll
  pass their info to the leasing team, the same honest-heads-up way as above.
- Otherwise, state the real reason honestly and kindly (e.g. "this building doesn't allow pets"
  or "our lowest rent is above what you mentioned"), then do what WHEN THERE'S NO MATCH says:
  offer the closest alternative if one exists, or offer to note their interest for later.
Either way, ask if there's anything else you can help with before closing, the same as any other
call — a disqualification is a normal ending to a call, not a reason to cut it short.

TONE FOR VOICE:
Short sentences. No lists, no markdown, nothing that only makes sense written down. Confirm
you understood something before moving to the next question. Before checking availability,
qualification, or anything else that takes a moment, say a short natural phrase first —
"let me check that," "one sec, pulling that up," "give me just a moment" — never go silent
while you look something up.

WHAT YOU DO NOT DO:
Negotiate rent. Discuss lease terms or legal questions. Try to resolve a maintenance issue
yourself. Guess at facts you don't have. Speak a language other than English.`;

const DEFAULT_FIRST_MESSAGE =
  "Thanks for calling Maple Court Apartments, this is Sarah! Are you calling about renting an apartment, or something else?";

/**
 * Renders the property manager's own questions into the prompt.
 *
 * Deliberately tells the agent nothing about which questions are criteria and which are just
 * recorded, and never states a passing answer. If the agent knew that a 650 credit score
 * fails, it would start pre-judging — softening the question, skipping it when it expects a
 * bad answer, or announcing the outcome before check_qualification has run. It asks; the
 * rules in convex/qualifyRules.ts decide.
 */
function screeningBlock(questions: ScreeningQuestion[]): string {
  if (questions.length === 0) return "";

  const lines = questions.map((q) => {
    const shape =
      q.answerKind === "yes_no"
        ? "answer as true or false"
        : q.answerKind === "number"
          ? "answer as a number"
          : q.answerKind === "choice"
            ? `answer as exactly one of: ${(q.choices ?? []).join(", ")}`
            : "answer as a short string, in their own words";
    return `- "${q.question}"  →  key "${q.key}", ${shape}`;
  });

  return `EXTRA SCREENING QUESTIONS FOR THIS PROPERTY:
Ask every one of these as well, in your own words, worked naturally into the conversation
rather than read out as a list. Ask them after the five core fields unless the caller brings
one up first. They are set by the property manager and are not optional.

${lines.join("\n")}

Pass all of them to check_qualification in the screening_answers argument, as a JSON object
keyed by the key shown above — for example {"${questions[0].key}": ...}. Include a key only
for questions the caller actually answered; never invent or guess a value, and never leave a
question out just because you think you know what they would say.`;
}

/**
 * Splices both rendered blocks into a prompt: the built-in questions this property still asks,
 * and the manager's own extra ones.
 *
 * Falls back to appending when a placeholder is missing, because agents.prompt is editable in
 * Settings and an agent may predate either block. The core block is appended unconditionally
 * rather than only when non-empty — an agent with no WHAT TO ASK section would have nothing
 * telling it what to collect at all.
 */
function composePrompt(
  prompt: string,
  questions: ScreeningQuestion[],
  disabledCore: string[] = [],
): string {
  // First, so the old "confirmation text is on its way" step is rewritten before anything else
  // is spliced in around it — see convex/tourPrompt.ts.
  prompt = withTourBooking(prompt);
  let next = prompt.includes(CORE_PLACEHOLDER)
    ? prompt.replace(CORE_PLACEHOLDER, coreBlock(disabledCore))
    : `${prompt}\n\n${coreBlock(disabledCore)}`;

  const block = screeningBlock(questions);
  if (next.includes(SCREENING_PLACEHOLDER)) {
    next = next.replace(SCREENING_PLACEHOLDER, block);
  } else if (block) {
    next = `${next}\n\n${block}`;
  }
  return next;
}


// --- Reads ----------------------------------------------------------------

/**
 * Signed in (the dashboard: /call, Settings) → the caller's own agent, or null if they
 * haven't had one created yet (mintToken/saveAgent do that lazily).
 *
 * Not signed in (the public landing-page demo) → the one agent that existed before
 * multi-tenancy, unchanged. That row now belongs to a real user (see the migration this
 * shipped with) but is also the demo's fixed, always-on stand-in — nobody's dashboard data
 * leaks here, since a query with no identity can only ever reach this branch.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) return null; // signed in, just no team resolved yet
      return ctx.db.query("agents").first();
    }
    return ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .first();
  },
});

/**
 * `orgId` undefined means "resolve the fallback" — the same row `current` above falls back to
 * for anonymous callers. Every mid-call tool webhook (convex/http.ts) that can't yet tell
 * which team a call belongs to goes through this same fallback, so a phone call or a
 * landing-page demo still has an agent to answer from.
 */
export const currentInternal = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: (ctx, args) => {
    const orgId = args.orgId;
    if (!orgId) return ctx.db.query("agents").first();
    return ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
  },
});

/** The team behind an ElevenLabs agent — how tour booking identifies a team mid-call. */
export const orgByElevenLabsAgentId = internalQuery({
  args: { elevenLabsAgentId: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_elevenlabs_id", (q) => q.eq("elevenLabsAgentId", args.elevenLabsAgentId))
      .first();
    return agent?.orgId ?? null;
  },
});

/**
 * Whichever team owns the oldest agent — the same row `current`/`currentInternal` fall back to
 * for an unresolvable caller. Doubles as "the template": every brand-new team's agent and
 * property are bootstrapped as a copy of this one's (see agents.ensure). The knowledge base is
 * not part of this clone — see docs.DEFAULT_DOCS — so it has no dependency on this org's docs
 * staying unedited.
 */
export const templateOrgId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agent = await ctx.db.query("agents").first();
    return agent?.orgId;
  },
});

export const voices = action({
  args: {},
  handler: async (): Promise<Array<{ voiceId: string; name: string }>> => {
    const { voices } = await el.listVoices();
    return voices.map((v) => ({ voiceId: v.voice_id, name: v.name }));
  },
});

// --- Server tools ------------------------------------------------------

const TOOL_DEFS = (siteUrl: string): el.ToolDefinition[] => [
  {
    name: "check_availability",
    description:
      "Looks up current rent and availability for a bedroom type, or the whole property, " +
      "with no lead capture and no qualification decision. Call this any time someone asks " +
      "a standalone question like 'what's the rent for a 2BR' or 'do you allow pets', even " +
      "before you've gathered the five qualification fields.",
    url: `${siteUrl}/tools/check-availability`,
    // conversation_id isn't required from the model — it's a dynamic_variable the platform
    // fills in regardless — but declaring it is what lets the webhook resolve *whose*
    // property this is. Without it every "what's the rent" question answered whichever
    // property happened to be first in the database, no matter who the agent belonged to.
    required: [],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      bedrooms: {
        type: "string",
        description:
          "The bedroom count asked about: 'studio', '1br', '2br', or '3br+'. Omit to get all units.",
      },
    },
  },
  {
    name: "check_qualification",
    description:
      "Checks a prospective tenant's stated bedrooms, budget, move-in date, pet needs and " +
      "any extra screening answers against the property's real availability and rules. Call " +
      "this once you have the five qualification fields and every extra screening question " +
      "your instructions list. Safe to call again in the same call if the caller revises an " +
      "answer — e.g. after agreeing to a higher budget on a near miss. Never decide " +
      "qualification yourself.",
    url: `${siteUrl}/tools/check-qualification`,
    // Only the two structural fields are required. move_in_date, budget and pets_wanted are
    // optional because each property manager can switch those questions off (see
    // convex/coreQuestions.ts) and this tool is shared by every agent, so `required` cannot
    // vary per user. Which ones actually get asked is driven by each agent's own prompt; the
    // webhook already type-guards all three, so an absent field simply skips its rule.
    required: ["conversation_id", "bedrooms", "caller_name", "caller_phone"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      bedrooms: {
        type: "string",
        description: "The bedroom count they want: 'studio', '1br', '2br', or '3br+'.",
      },
      move_in_date: { type: "string", description: "When they want to move in, in their own words." },
      budget: { type: "number", description: "Their monthly budget in dollars." },
      pets_wanted: { type: "boolean", description: "Whether they have or plan to bring pets." },
      pet_type: { type: "string", description: "The kind of pet, if pets_wanted is true." },
      caller_name: { type: "string", description: "The caller's name." },
      caller_phone: { type: "string", description: "A callback number for the caller." },
      // One string rather than a property per question, because this tool is shared by every
      // property manager's agent (ensureTools looks tools up by name across the whole
      // workspace) and their question sets differ. The keys and expected shapes are injected
      // into each agent's own prompt by screeningBlock(); the webhook coerces what comes back
      // using the stored answerKind, so a loosely-typed value here still lands as a real
      // boolean or number before it ever reaches evaluateQualification.
      screening_answers: {
        type: "string",
        description:
          "JSON object of this property's extra screening answers, keyed exactly as listed " +
          "under EXTRA SCREENING QUESTIONS in your instructions — e.g. " +
          '{"q_co_signer": true, "q_credit_score": 720}. Include every question you asked. ' +
          "Omit this argument entirely if your instructions list no extra questions.",
      },
    },
  },
  {
    name: "find_tour_times",
    description:
      "Checks open tour times on the day the caller asked for. Only call this after the caller " +
      "has told you what day suits them; never to get times to suggest. Call it again every time " +
      "they ask for a different day or time. Only offer times from the latest result.",
    url: `${siteUrl}/tools/find-tour-times`,
    required: ["conversation_id", "date"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      // Identifies the team mid-call on a phone line, where no conversations row exists yet —
      // see resolveBookingOrg in convex/http.ts.
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      date: {
        type: "string",
        description:
          "The day the caller asked for, as YYYY-MM-DD, worked out from the current date. " +
          "Required — ask them first if they have not said.",
      },
      time: {
        type: "string",
        description:
          "The exact time they asked for, as 24-hour HH:MM (e.g. 10:00, 14:30). Send it whenever " +
          "they name a time, together with date — the result says whether that exact time is open.",
      },
      tour_id: {
        type: "string",
        description:
          "Only when moving an existing tour: its tour_id from find_my_tour, so that tour does not " +
          "block the times around it. Leave out when booking a new tour.",
      },
    },
  },
  {
    name: "request_tour",
    description:
      "Books a tour for a caller who has already qualified. Pass slot_start with a start value " +
      "from your latest find_tour_times result, only after reading it back and hearing yes. " +
      "Only if find_tour_times said booking isn't available, pass " +
      "preferred_slot with their preferred day and time instead. Only call this after " +
      "check_qualification returned qualifies: true.",
    url: `${siteUrl}/tools/request-tour`,
    // Neither slot field is required: which one applies depends on whether the team has booking
    // set up, and the webhook rejects a call that sends neither.
    required: ["conversation_id", "caller_name", "caller_phone", "caller_confirmed"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      also_book: {
        type: "boolean",
        description:
          "Only after request_tour told you the caller already has upcoming tours, you told them, and " +
          "they said they want this new tour as well. Leave out otherwise.",
      },
      caller_confirmed: {
        type: "boolean",
        description:
          "True only after you read the exact day and time back to the caller and they clearly " +
          "said yes. Booking is refused otherwise.",
      },
      slot_start: {
        type: "string",
        description:
          "The exact start value of the time the caller chose and confirmed, from your latest " +
          "find_tour_times result, e.g. 2026-09-16T14:00.",
      },
      preferred_slot: {
        type: "string",
        description: "Their preferred day and time in words. Only when booking isn't available.",
      },
      caller_name: { type: "string", description: "The caller's name." },
      caller_phone: { type: "string", description: "A callback number for the caller." },
    },
  },
  {
    name: "find_my_tour",
    description:
      "Looks up the caller's upcoming tour: one booked earlier on this call, or on another call under " +
      "the same phone number. Call this first whenever a caller wants to cancel or move a tour.",
    url: `${siteUrl}/tools/find-my-tour`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      caller_phone: {
        type: "string",
        description:
          "The phone number the caller says they booked with, as digits. Leave out if they have not given one.",
      },
    },
  },
  {
    name: "cancel_tour",
    description:
      "Cancels the caller's upcoming tour. Only after find_my_tour returned it, you read its day and " +
      "time back, and the caller clearly confirmed they want it cancelled.",
    url: `${siteUrl}/tools/cancel-tour`,
    required: ["conversation_id", "tour_id", "caller_confirmed"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      tour_id: { type: "string", description: "The tour_id from find_my_tour." },
      caller_phone: {
        type: "string",
        description: "The phone number they booked with, if they gave one, as digits.",
      },
      caller_confirmed: {
        type: "boolean",
        description: "True only after the caller clearly confirmed they want this tour cancelled.",
      },
    },
  },
  {
    name: "reschedule_tour",
    description:
      "Moves the caller's existing tour to a new time. Use this, never request_tour, when someone who " +
      "already has a tour wants a different time. Only with a time from your latest find_tour_times " +
      "result (called with this tour_id), after reading the new time back and hearing yes.",
    url: `${siteUrl}/tools/reschedule-tour`,
    required: ["conversation_id", "tour_id", "slot_start", "caller_confirmed"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      tour_id: { type: "string", description: "The tour_id from find_my_tour." },
      slot_start: {
        type: "string",
        description: "The exact start value of the new time, from your latest find_tour_times result.",
      },
      caller_phone: {
        type: "string",
        description: "The phone number they booked with, if they gave one, as digits.",
      },
      caller_confirmed: {
        type: "boolean",
        description: "True only after you read the new day and time back and the caller said yes.",
      },
    },
  },
  {
    name: "escalate",
    description:
      "Hands the call off to a human staff member. Use for maintenance/urgent tenant issues, " +
      "requests to speak to a human (after one attempt to help), anything off-topic, or when " +
      "you can't identify why someone is calling after about 90 seconds. Always gather the " +
      "caller's name, callback number, and living area/address before calling this.",
    url: `${siteUrl}/tools/escalate`,
    required: ["conversation_id", "reason", "summary", "caller_name", "caller_phone", "living_area"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      reason: {
        type: "string",
        description:
          "Why this call is being escalated: 'requested_human', 'urgent_tenant_issue', " +
          "'off_topic', or 'unclear_intent'.",
      },
      summary: { type: "string", description: "One short sentence a staff member can act on." },
      caller_name: { type: "string", description: "The caller's full name." },
      caller_phone: { type: "string", description: "A callback number for the caller." },
      living_area: {
        type: "string",
        description: "Where the caller currently lives or the area/unit they're calling about.",
      },
    },
  },
  {
    name: "log_tenant_issue",
    description:
      "Records that an existing resident called, why they called, and how severe it is on a " +
      "1-10 scale. Call this for every resident before you close the call, even for small " +
      "things. Ask for their name, unit and a callback number FIRST and pass them here — do " +
      "not call this with a " +
      "placeholder like 'unknown'. Safe to call more than once in the same call: a second call " +
      "updates the same record, so if you learn or correct anything afterwards, call it again " +
      "with the full details. Do not call it for people looking to rent — that is " +
      "check_qualification. If the severity is 8 or higher, call escalate as well.",
    url: `${siteUrl}/tools/log-tenant-issue`,
    // caller_name is deliberately NOT required. When it was, the agent satisfied the schema by
    // inventing "unknown" and calling the tool before it had actually asked — see the call on
    // 2026-08-24. Better an absent name we can fill in later than a fabricated one.
    required: ["conversation_id", "reason", "severity"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      caller_name: {
        type: "string",
        description:
          "The resident's full name, exactly as they gave it. Never a placeholder such as " +
          "'unknown' or 'not provided' — if you don't have it yet, ask for it before calling this.",
      },
      unit: {
        type: "string",
        description:
          "Their unit or apartment number, e.g. '4B'. Ask for it before calling this rather " +
          "than leaving it out.",
      },
      caller_phone: {
        type: "string",
        description:
          "The callback number the resident gives you, as digits. Always ask for it, even on " +
          "a phone call — the number they are calling from is not always the one they want to " +
          "be reached on. Read it back to confirm before passing it here. Leave it out if they " +
          "decline; never invent one.",
      },
      reason: {
        type: "string",
        description:
          "One plain sentence: why they called, in their words. E.g. 'No hot water in the " +
          "shower since last night.'",
      },
      category: {
        type: "string",
        description: "One of: maintenance, billing, noise, lockout, lease, other.",
      },
      severity: {
        type: "number",
        description:
          "1-10 using the severity scale in your instructions. Judge the issue itself, never " +
          "how upset the caller sounds.",
      },
      severity_reason: {
        type: "string",
        description:
          "A few words on why that number, e.g. 'no hot water, unlivable but not dangerous'.",
      },
    },
  },
];

/**
 * Idempotently creates the server tools this agent needs, checking for existing tools
 * first so re-running (e.g. after a deploy) doesn't create duplicates.
 *
 * Tools are matched by URL rather than by name, and that distinction is load-bearing. Tools
 * live at the ElevenLabs workspace level while agents only hold tool ids, so with one
 * workspace shared by several Convex deployments a name match made whichever deployment ran
 * this last the owner of every tool: saving the prompt from dev rewrote production's tools to
 * point at the dev deployment. Nothing looked wrong afterwards -- the tool ids never changed,
 * so production agents kept their config and simply started writing live calls into the dev
 * database. The URL is the one part of a tool that is specific to a deployment, so matching
 * on it means each deployment finds, and can only overwrite, its own copies.
 */
export const ensureTools = internalAction({
  args: {},
  handler: async (): Promise<string[]> => {
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not set on this deployment.");

    const { tools: existing } = await el.listTools();
    const defs = TOOL_DEFS(siteUrl);
    const ids: string[] = [];

    for (const def of defs) {
      const found = existing.find((t) => t.tool_config.api_schema?.url === def.url);
      if (found) {
        // Keeps tool_ids stable but re-syncs settings like pre_tool_speech onto tools that
        // already existed before that field was added.
        await el.updateTool(found.id, def);
        ids.push(found.id);
        continue;
      }
      const created = await el.createTool(def);
      ids.push(created.id);
    }

    return ids;
  },
});

// --- Writes ---------------------------------------------------------------

/** Creates the caller's own agent on first run, updates it thereafter. Safe to call repeatedly. */
export const saveAgent = action({
  args: {
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    firstMessage: v.optional(v.string()),
    voiceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const { orgId, userId } = await requireOrgId(ctx);
    // A no-op if this user already has an agent. Guarantees that even someone who opens
    // Settings and hits Save before ever placing a call still starts from the same seeded
    // setup (property + knowledge base included) as everyone else — not a bare prompt with
    // nothing behind it.
    await ctx.runAction(internal.agents.ensure, { orgId, userId });
    const existing = await ctx.runQuery(internal.agents.currentInternal, { orgId });
    // Still none means another setup run is mid-flight. Creating one here would give the team a
    // second ElevenLabs agent, so ask them to retry once that run has finished.
    if (!existing) throw new Error("Your assistant is still being set up. Try saving again in a few seconds.");
    const knowledgeBase: el.KnowledgeBaseEntry[] = await ctx.runQuery(
      internal.docs.syncedEntries,
      { orgId },
    );
    const toolIds: string[] = await ctx.runAction(internal.agents.ensureTools, {});
    const questions: ScreeningQuestion[] = await ctx.runQuery(
      internal.screening.activeForOrg,
      { orgId },
    );
    const disabledCore: string[] = await ctx.runQuery(
      internal.screening.disabledBuiltinsForOrg,
      { orgId },
    );

    // Two different prompts on purpose: `sourcePrompt` is what the manager typed and what gets
    // stored, `config.prompt` is that with the screening block rendered in. Storing the
    // composed one would bake the render into the editable text and duplicate the block on
    // every subsequent save.
    const sourcePrompt = args.prompt ?? existing?.prompt ?? LEASING_PROMPT;

    const config: el.AgentConfig = {
      name: args.name ?? existing?.name ?? "Sarah",
      prompt: composePrompt(sourcePrompt, questions, disabledCore),
      firstMessage: args.firstMessage ?? existing?.firstMessage ?? DEFAULT_FIRST_MESSAGE,
      voiceId: args.voiceId ?? existing?.voiceId ?? DEFAULT_VOICE_ID,
      knowledgeBase,
      toolIds,
      voice: VOICE_TUNING,
      turn: TURN_TUNING,
    };

    const elevenLabsAgentId = existing
      ? (await el.updateAgent(existing.elevenLabsAgentId, config)).agent_id ??
        existing.elevenLabsAgentId
      : (await el.createAgent(config)).agent_id;

    await ctx.runMutation(internal.agents.upsert, {
      orgId,
      userId,
      elevenLabsAgentId,
      name: config.name,
      prompt: sourcePrompt,
      firstMessage: config.firstMessage,
      voiceId: config.voiceId,
    });

    return elevenLabsAgentId;
  },
});

/**
 * Re-attaches one user's current set of synced docs to their agent. Called after a doc
 * finishes indexing or is deleted; a no-op when that user has no agent yet.
 */
export const pushKnowledgeBase = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.runQuery(internal.agents.currentInternal, { orgId: args.orgId });
    if (!agent) return;

    const knowledgeBase: el.KnowledgeBaseEntry[] = await ctx.runQuery(
      internal.docs.syncedEntries,
      { orgId: args.orgId },
    );
    const toolIds: string[] = await ctx.runAction(internal.agents.ensureTools, {});
    const questions: ScreeningQuestion[] = await ctx.runQuery(
      internal.screening.activeForOrg,
      { orgId: args.orgId },
    );
    const disabledCore: string[] = await ctx.runQuery(
      internal.screening.disabledBuiltinsForOrg,
      { orgId: args.orgId },
    );
    await el.updateAgent(agent.elevenLabsAgentId, {
      name: agent.name,
      prompt: composePrompt(agent.prompt, questions, disabledCore),
      firstMessage: agent.firstMessage,
      voiceId: agent.voiceId,
      knowledgeBase,
      toolIds,
      voice: VOICE_TUNING,
      turn: TURN_TUNING,
    });
  },
});

/**
 * Re-renders one user's prompt after their screening questions change, so the agent starts
 * asking (or stops asking) on the next call rather than the next time they open Settings.
 *
 * Scheduled by every write in convex/screening.ts. A no-op for a user with no agent yet —
 * agents.ensure composes the block itself when it eventually creates one.
 */
export const pushScreening = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: args.orgId });
  },
});

/**
 * Mints a short-lived WebRTC token. This is the only ElevenLabs call on the hot path of
 * starting a call, and the browser talks to ElevenLabs directly from here on — audio never
 * transits Convex.
 *
 * Signed in (the dashboard) → the caller's team agent, created on first call. Not signed in
 * (the public landing-page demo) → the fallback agent — see agents.current for the same branch
 * on the read side.
 */
export const mintToken = action({
  args: {},
  handler: async (ctx): Promise<{ token: string; agentId: string }> => {
    const identity = await ctx.auth.getUserIdentity();

    // Not requireOrgId: this is also the public demo's entry point, and a signed-out caller
    // has to fall through to the shared agent rather than be rejected.
    let orgId: string | undefined;
    let userId: Id<"users"> | undefined;
    if (identity) {
      const resolved = await requireOrgId(ctx);
      orgId = resolved.orgId;
      userId = resolved.userId;
    }

    let agent = await ctx.runQuery(internal.agents.currentInternal, { orgId });
    if (!agent && orgId && userId) {
      await ctx.runAction(internal.agents.ensure, { orgId, userId });
      agent = await ctx.runQuery(internal.agents.currentInternal, { orgId });
    }
    if (!agent) {
      throw new Error(
        orgId
          ? "Your assistant is still being set up. Try again in a few seconds."
          : "Could not create an agent.",
      );
    }

    const { token } = await el.getWebrtcToken(agent.elevenLabsAgentId);
    return { token, agentId: agent.elevenLabsAgentId };
  },
});

/**
 * Public entry point for the setup below. The Knowledge tab calls it when it finds no docs.
 * Normally a no-op — sign-up already schedules ensure (team.ensureTeamForUser) — so it only
 * matters for a team whose setup failed or that predates sign-up doing it.
 */
export const ensureSeeded = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const { orgId, userId } = await requireOrgId(ctx);
    await ctx.runAction(internal.agents.ensure, { orgId, userId });
  },
});

/**
 * Sets up a brand-new team: a copy of the template's property and agent config (prompt, voice,
 * first message) — see templateOrgId — plus the fixed DEFAULT_DOCS knowledge base
 * (docs.cloneDefaultsForOrg). Falls back to the coded LEASING_PROMPT/DEFAULT_* constants for the
 * agent/property when there is no template to copy from (a from-scratch install).
 *
 * Scheduled at sign-up, and also called by the Knowledge tab, a first call and a Settings save
 * as fallbacks. claimBootstrap makes sure only one of those actually runs: without it, two
 * overlapping runs both see "no agent", both create one on ElevenLabs, and upsert keeps only the
 * second — leaving the first orphaned and still billable.
 */
export const ensure = internalAction({
  args: { orgId: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const claimed: boolean = await ctx.runMutation(internal.agents.claimBootstrap, {
      orgId: args.orgId,
    });
    if (!claimed) return;

    try {
      await bootstrapTeam(ctx, args);
    } catch (err) {
      // Free the claim so the next fallback can retry now, rather than waiting out the lease.
      await ctx.runMutation(internal.agents.releaseBootstrap, { orgId: args.orgId });
      throw err;
    }
  },
});

async function bootstrapTeam(
  ctx: ActionCtx,
  args: { orgId: string; userId: Id<"users"> },
): Promise<void> {
  // Convex queries can't return `undefined` over the ctx.runQuery boundary — it comes back
  // as `null` here, so this normalizes back to `undefined` for the mutations below, which
  // declare templateOrgId as v.optional (translating to `T | undefined` in TS, not `| null`).
  const templateOrgId = (await ctx.runQuery(internal.agents.templateOrgId, {})) ?? undefined;
  const template = templateOrgId
    ? await ctx.runQuery(internal.agents.currentInternal, { orgId: templateOrgId })
    : null;

  // Property first, then docs: the property clone schedules the auto-generated property doc,
  // which cloneDefaultsForOrg deliberately looks past when deciding whether this team already
  // has knowledge — it can land before the defaults do.
  await ctx.runMutation(internal.properties.cloneForOrg, {
    orgId: args.orgId,
    userId: args.userId,
    templateOrgId,
  });
  await ctx.runMutation(internal.docs.cloneDefaultsForOrg, {
    orgId: args.orgId,
    userId: args.userId,
  });

  // The cloned docs above are only scheduled to sync, not yet indexed — same as a doc saved
  // by hand, the agent starts with an empty knowledge base and pushKnowledgeBase re-attaches
  // it automatically once each one finishes (see docs.pollRagIndex).
  const knowledgeBase: el.KnowledgeBaseEntry[] = await ctx.runQuery(
    internal.docs.syncedEntries,
    { orgId: args.orgId },
  );
  const toolIds: string[] = await ctx.runAction(internal.agents.ensureTools, {});
  // A brand-new user has no questions of their own yet, but this is read rather than assumed
  // empty so a cloned template's questions would render if cloning ever covers them.
  const questions: ScreeningQuestion[] = await ctx.runQuery(
    internal.screening.activeForOrg,
    { orgId: args.orgId },
  );
  const disabledCore: string[] = await ctx.runQuery(
    internal.screening.disabledBuiltinsForOrg,
    { orgId: args.orgId },
  );

  const name = template?.name ?? "Sarah";
  const prompt = template?.prompt ?? LEASING_PROMPT;
  const firstMessage = template?.firstMessage ?? DEFAULT_FIRST_MESSAGE;
  const voiceId = template?.voiceId ?? DEFAULT_VOICE_ID;

  const created = await el.createAgent({
    name,
    prompt: composePrompt(prompt, questions, disabledCore),
    firstMessage,
    voiceId,
    knowledgeBase,
    toolIds,
    voice: VOICE_TUNING,
    turn: TURN_TUNING,
  });
  await ctx.runMutation(internal.agents.upsert, {
    orgId: args.orgId,
    userId: args.userId,
    elevenLabsAgentId: created.agent_id,
    name,
    prompt,
    firstMessage,
    voiceId,
  });
}

/**
 * How long a started setup is trusted to still be running. Only reached if a run died without
 * reaching its catch (a crashed action); normal failures release the claim straight away.
 */
const BOOTSTRAP_LEASE_MS = 10 * 60 * 1000;

/** True if this caller may set the team up now; false if it already has an agent or a run is live. */
export const claimBootstrap = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (agent) return false;

    // No organizations row to record the claim on: set up without the guard rather than never.
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (!orgId || !org) return true;

    const now = Date.now();
    if (org.bootstrapStartedAt && now - org.bootstrapStartedAt < BOOTSTRAP_LEASE_MS) return false;
    await ctx.db.patch(orgId, { bootstrapStartedAt: now });
    return true;
  },
});

export const releaseBootstrap = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    if (orgId) await ctx.db.patch(orgId, { bootstrapStartedAt: undefined });
  },
});

export const upsert = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
    elevenLabsAgentId: v.string(),
    name: v.string(),
    prompt: v.string(),
    firstMessage: v.string(),
    voiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    const row = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("agents", row);
  },
});

// --- One-off migration ----------------------------------------------------

/**
 * Every agent row, for the prompt migration below. Deliberately unscoped — this is the one
 * place that is supposed to touch other people's agents, and it is internal so only a
 * deployment operator can run it.
 */
export const allForMigration = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("agents").collect(),
});

/** Patches just the prompt. agents.upsert needs every field, which a migration should not invent. */
export const setPrompt = internalMutation({
  args: { agentId: v.id("agents"), prompt: v.string() },
  handler: (ctx, args) =>
    ctx.db.patch(args.agentId, { prompt: args.prompt, updatedAt: Date.now() }),
});

/**
 * Brings every existing agent's stored prompt up to date with pre-screening questions.
 *
 * Needed because agents.prompt lives in the database: editing LEASING_PROMPT only affects
 * agents created afterwards, so without this every account that existed before this feature
 * keeps telling Sarah the five built-in fields are the only things she may ask — which now
 * contradicts the screening block appended below it.
 *
 * Safe to re-run: upgradeForScreening is a no-op once the placeholder is present, so a second
 * pass reports "already up to date" and pushes nothing.
 *
 * Run `--dryRun true` first — it reports exactly what it would change and writes nothing.
 */
export const upgradePromptsForScreening = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    total: number;
    upgraded: number;
    skipped: number;
    failed: number;
    needsManualReview: string[];
    detail: Array<{ agent: string; status: string; note?: string }>;
  }> => {
    const agents = await ctx.runQuery(internal.agents.allForMigration, {});
    const detail: Array<{ agent: string; status: string; note?: string }> = [];
    const needsManualReview: string[] = [];
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of agents) {
      const next = upgradeForScreening(agent.prompt);

      if (next === agent.prompt) {
        skipped += 1;
        detail.push({ agent: agent.name, status: "already up to date" });
        continue;
      }

      // The placeholder gets appended either way, so the block still renders. But when the old
      // passages were hand-edited we could not rewrite them, and the stale "these five fields
      // are all that qualify" wording survives somewhere above it. That agent works, but it is
      // carrying a contradiction a human should look at.
      const handEdited = hasUnknownWording(agent.prompt);
      if (handEdited) needsManualReview.push(agent.name);

      if (args.dryRun) {
        detail.push({
          agent: agent.name,
          status: "would upgrade",
          note: handEdited ? "hand-edited — some old wording will survive" : undefined,
        });
        upgraded += 1;
        continue;
      }

      try {
        // Write first, then push: pushKnowledgeBase re-reads the row, so the order is what
        // makes the new prompt the one that reaches ElevenLabs.
        await ctx.runMutation(internal.agents.setPrompt, {
          agentId: agent._id,
          prompt: next,
        });
        if (!agent.orgId) throw new Error("Agent has no organization yet — run orgMigration.backfill first.");
        await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: agent.orgId });
        upgraded += 1;
        detail.push({
          agent: agent.name,
          status: "upgraded",
          note: handEdited ? "hand-edited — some old wording will survive" : undefined,
        });
      } catch (err) {
        // One account's ElevenLabs push failing must not strand the rest half-migrated. The
        // database row is already correct, so a re-run will retry only the push.
        failed += 1;
        detail.push({
          agent: agent.name,
          status: "FAILED",
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { total: agents.length, upgraded, skipped, failed, needsManualReview, detail };
  },
});
