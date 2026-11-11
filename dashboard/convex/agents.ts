import { ConvexError, v } from "convex/values";
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
import { currentOrg, isAdminView, requireOrgId } from "./authz";
import { writeAudit } from "./audit";
import { composeSarahSections, defaultConfig, normalizeConfig, ownerRoutingMenu } from "./sarahConfigLib";
import type { SarahConfig } from "./sarahConfigLib";
import {
  OWNER_ADDRESS_RULE,
  OWNER_TRANSFER_DIGITS_VAR,
  OWNER_TRANSFER_VAR,
  TRANSFER_DESTINATION_MODE,
  TRANSFER_MECHANISM,
  transferPlaceholders,
  transferToolConfig,
} from "./ownerRoutingLib";
import type { MenuEntry } from "./ownerRoutingLib";
import { ownLines } from "./ownerRouting";

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
  // Sarah handles complaints, emergencies and legal topics, so nothing upbeat. This is only a
  // suggestion (the API lets the agent use other tags): the rule in composeStyle enforces it.
  suggestedAudioTags: [
    { tag: "calm", description: "The default for routine questions and information." },
    { tag: "empathetic", description: "When the caller is upset or reporting a problem." },
  ],
};

const TURN_TUNING: el.TurnTuning = {
  // 7s cut callers off while they worked out a budget or a move-in date.
  turnTimeout: 10,
  // The qualification flow collects a name and a callback number digit by digit, which is
  // the documented case for "patient" — "eager" clips people mid-number.
  eagerness: "patient",
  // conv_7301m6e31kq8fs8razf5mys7t6wj: a turn with one tool reaches its first real words about 2.8-3.7s
  // after the turn starts, so 3s put a filler on four of the five, under a second before the reply.
  // Two tools in a row (log, then escalate) take about 5s. 4.5s clears the slowest one-tool turn that
  // call's LLM timings allow (about 4.3s) and still covers the long wait.
  softTimeoutSeconds: 4.5,
  maxSoftTimeoutsPerGeneration: 1,
  // No "Let me pull that up…": tools run silently since v17, so it played before replies that pulled
  // nothing up ("Let me pull that up…. I'm sorry to hear that.").
  fillerMessages: ["Just a sec…", "One moment…"],
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
  // Our list above stays; ElevenLabs' curated English backchannels are added on top of it.
  mergeWithDefaultIgnoreTerms: true,
  interruptionIgnoreTermLanguages: ["en"],
  // Callers often ring from noisy places; a cough or a TV should not cut off the greeting.
  disableFirstMessageInterruptions: true,
};

/**
 * The LLM behind Sarah. Switched 2026-11-02 from "gemini-3.1-flash-lite" to
 * "gemini-3-flash-preview" after the simulated eval in docs/llm-eval-2026-11-02.md (best rule
 * following, lowest and steadiest latency, no backup-LLM takeovers).
 *
 * TO REVERT: set `model` back to "gemini-3.1-flash-lite" and publish. (The previous config sent
 * reasoningEffort null; if the API rejects "minimal" for flash-lite, set that to null too.)
 *
 * Cost: about $0.08 per call minute vs about $0.045 on flash-lite. This is a preview model, so
 * Google may change or retire it without much notice.
 *
 * reasoningEffort "minimal" is the lowest the API accepts for this model and is exactly what
 * the eval ran (scripts/probes/llm_eval.py, reasoning_fields). Temperature 0 and max_tokens 160
 * are unchanged. The backup LLM cascade is not set here and is left as configured on the agent.
 */
const LLM_TUNING: el.LlmTuning = {
  model: "gemini-3-flash-preview",
  temperature: 0,
  reasoningEffort: "minimal",
  maxTokens: 160,
};

const VAD_TUNING: el.VadTuning = {
  // Filters voices that aren't the caller's (a TV, someone else in the room) before they count
  // as speech. User approved 2026-11-02 (Sarah v15); still needs a real phone test.
  backgroundVoiceDetection: true,
};
// turn.noisy_environment_detection stays off on purpose: it would ask callers, including ones reporting emergencies, to "move somewhere quieter".


/**
 * The company name Sarah says on the phone. A code constant for now (build plan C13); it moves
 * to Sarah configuration (F9) once that exists. The exact spoken name is still to be confirmed
 * with the client, so change it here and nowhere else.
 */
export const COMPANY_NAME = "518 Property Pro";

export const LEASING_PROMPT = `You are Sarah, the receptionist for ${COMPANY_NAME}, answering by phone or
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
   from that. It never captures a lead, it's just a lookup. Only ever offer what it returns:
   a unit type that is not in its result is not available, so never offer it.
1. Figure out why they're calling: renting an apartment, a maintenance issue or another
   matter as a current resident, an owner who wants ${COMPANY_NAME} to manage their property,
   or something else.
1a. Existing resident or prospect? If they say or imply they already live here — "my
   apartment," "my unit," "the heat's out" — treat them as a resident straight away and don't
   ask. Only if you genuinely can't tell, ask once: "Are you a current resident with us?"
   Take their answer at face value. If they are a resident, follow the RESIDENT CALLS section
   below instead of the leasing steps.
1b. A property owner who wants ${COMPANY_NAME} to manage their property is not a renter and
   not a resident. Get their name and the best number to reach them on, plus the property's
   address and a few plain details about it (type, number of units) if they offer them, then
   call route_owner_prospect. Tell them someone from the team will be in touch. Do not discuss
   fees, terms or what the company can promise.
2. If it's a leasing inquiry, follow the LEASING CALLS section below: collect what is listed under
   WHAT TO ASK EVERY LEASING CALLER, LEASING QUESTIONS WE ONLY RECORD and EXTRA SCREENING QUESTIONS,
   exactly ONE question per turn, recording it with log_lead as you go. Never invent questions of your own.
3. Record, never judge. log_lead only stores their answers for the team and returns what is
   available; it never decides anything. If EXTRA SCREENING QUESTIONS are listed, record those
   answers with check_qualification too. Tell them their answers are recorded and the team will
   review them. Follow CAPTURE ONLY below: you never tell a caller whether they qualify. If the
   result says something of the type they asked for is available, offer a tour. If not, say so and
   follow WHEN THERE'S NO MATCH.
4. If they want a tour, follow TOUR BOOKING below to find a time and book it.
5. Once the reason for the call is resolved — a tour is booked, their details are recorded and
   next steps given, or you've handed off with escalate — the call is done. Ask one time, "Is
   there anything else I can help with?" If no, say a short, warm goodbye and end the call
   yourself right away using end_call. Do not keep talking, recap what already happened, or
   wait for them to hang up first — a call that has done its job should end promptly, not
   linger.

{{CORE_QUESTIONS}}

LEASING QUESTIONS WE ONLY RECORD:
These are approved for ${COMPANY_NAME} and are the only questions allowed besides the list above.
Ask them one at a time, in the order the LEASING QUESTION FLOW gives, and send the
answers to log_lead with the argument named in brackets. Include every answer you have each time you call it.
- Whether someone else, such as an agency, an employer or a family member, will be paying part or
  all of the rent [third_party_payer, true or false]. If yes, ask for that payer's name
  [payer_name], phone number [payer_phone] and email address [payer_email].
- Which city or area they want to rent in [preferred_area], asked first, and any communities they
  want to avoid [avoid_communities].
- How many pets, as a number [pet_count], on top of the type of pet.
- Anything else they'd like us to know [other_info].

PACING:
The HARD RULES FOR EVERY TURN at the top and bottom of these instructions are the only pacing rules:
exactly ONE question per turn, a few words of acknowledgement, at most 25 words. Once you have a piece
of information, use it and move on and never ask for something you already have. Record early: call
the logging tool after the first useful answer and again as you learn more. The call should feel like
it is clearly moving toward a resolution from the first question onward.

CAPTURE ONLY — YOU NEVER JUDGE:
Your job with a renter is to record their answers accurately, not to judge them. Never tell a
caller they do not qualify, are not approved, are not eligible or were turned down, and never
give a reason that sounds like one — not about their budget, pets, credit, income, background or
anything else. Never decide that an answer rules someone out, and never skip a question because
you assume you know how it will go. Nothing about how someone sounds, their name, their accent
or anything they mention about themselves ever changes how you treat them. The team reviews every
inquiry and decides; you can say exactly that. If they ask whether they'd be approved, say the
team will review their answers and follow up.

{{SCREENING_QUESTIONS}}

${LIFE_SAFETY_BLOCK}

WHEN TO ESCALATE — call the escalate tool, don't try to handle it yourself:
- They ask to speak to a human, and you haven't already tried once to help — the second
  time they ask, escalate immediately, no more attempts.
- A resident's maintenance issue that is an emergency or urgent: always call
  log_maintenance_request first, then escalate. Routine and informational requests are logged
  and the call closed — don't escalate routine repairs.
- Anything that is neither a leasing inquiry nor a resident issue — "what's the WiFi speed in
  unit 4B," anything outside those topics — say you'll have someone follow up, then
  escalate with a short note of what they asked. Never invent an answer to something you
  don't actually know.
- If 90 seconds have passed and you still can't tell why they're calling, escalate — don't
  keep guessing.
- If someone has a heavy accent or a bad connection and you've asked them to repeat
  themselves twice without understanding, stop trying a third time — escalate instead of
  looping.

Before calling escalate, get their full name, a callback number, and their living area or
which unit this is about: one question each, only for what they have not already said. Once
you've escalated, tell them plainly that someone will be in touch with them soon, then move
to closing the call.

${RESIDENT_TRIAGE_BLOCK}

WHEN THERE'S NO MATCH:
If nothing available matches what they asked for (wrong bedroom count, wrong timeframe),
don't just say no. Offer the closest available alternative from check_availability, or offer
to note their interest for when something matching opens up. Always leave them with a next step.

TONE FOR VOICE:
Short sentences. No lists, no markdown, nothing that only makes sense written down. Confirm
you understood something before moving to the next question. Tools run in silence (TURN RULE).

WHAT YOU DO NOT DO:
Negotiate rent. Discuss lease terms or legal questions, or give legal advice. Diagnose a
maintenance issue or make commitments beyond what is written in these instructions. Guess at
facts you don't have. Speak a language other than English.`;

export const DEFAULT_FIRST_MESSAGE = `Thanks for calling ${COMPANY_NAME}, this is Sarah! Are you calling about renting an apartment, a maintenance issue, as a property owner, or something else?`;

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
Ask each of these as well, one question per turn, in your own words, never read out as a list.
Ask them after the core fields unless the caller brings one up first. They are set by the
property manager and are not optional.

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
// The stored prompt's older leasing-record lines (before the city or area question moved to the
// start of the leasing intake, 2026-10-30), whitespace-tolerant so re-wrapped text still matches.
// Rewritten at compose time, like withTourBooking, so every agent picks the change up on its next
// push and a manager's own edits elsewhere in Settings stay untouched.
const OLD_RECORD_OPTIONAL =
  /They are OPTIONAL: ask them one at a time, only after the required questions are done, and send the\s+answers to log_lead/;
const NEW_RECORD_ORDER =
  "Ask them one at a time, in the order the LEASING QUESTION FLOW gives, and send the\nanswers to log_lead";
const OLD_COMMUNITIES_LINE =
  /- Which communities they'd prefer in the Capital Region \[preferred_communities\], and any they\s+want to avoid \[avoid_communities\]\./;
const NEW_AREA_LINE =
  "- Which city or area they want to rent in [preferred_area], asked first, and any communities they\n  want to avoid [avoid_communities].";

// The stored prompt's older pre-escalation line asked for three things in one question "rather than
// skipping it", against HARD RULES 1 and 4 (a caller re-asked for a name and unit they had given,
// 2026-11-02). Rewritten at compose time the same way.
const OLD_ESCALATE_ASK =
  /Before calling escalate, quickly get their full name, a callback number, and their living\s+area or which unit this is about — ask for these directly \("Can I get your name and a\s+number to reach you, and which unit or area this is about\?"\) rather than skipping it\./;
const NEW_ESCALATE_ASK =
  "Before calling escalate, get their full name, a callback number, and their living area or\nwhich unit this is about: one question each, only for what they have not already said.";

// The stored prompt told Sarah to speak before every tool, which put questions in the same step as
// tool calls (see pre_tool_speech in elevenLabsApi.ts). Rewritten at compose time the same way.
const OLD_TOOL_SPEECH =
  /Before checking availability,\s+looking someone up, logging a request, or anything else that takes a moment, say a short\s+natural phrase first — "let me check that," "one sec, pulling that up," "give me just a\s+moment" — never go silent while you look something up\./;
const NEW_TOOL_SPEECH = "Tools run in silence (TURN RULE).";

export function withAreaFirst(prompt: string): string {
  return prompt
    .replace(OLD_RECORD_OPTIONAL, NEW_RECORD_ORDER)
    .replace(OLD_COMMUNITIES_LINE, NEW_AREA_LINE)
    .replace(OLD_ESCALATE_ASK, NEW_ESCALATE_ASK)
    .replace(OLD_TOOL_SPEECH, NEW_TOOL_SPEECH);
}

export function composePrompt(
  prompt: string,
  questions: ScreeningQuestion[],
  disabledCore: string[] = [],
  sarah: SarahConfig | null = null,
): string {
  // First, so the old "confirmation text is on its way" step is rewritten before anything else
  // is spliced in around it — see convex/tourPrompt.ts.
  prompt = withAreaFirst(withTourBooking(prompt));
  let next = prompt.includes(CORE_PLACEHOLDER)
    ? prompt.replace(CORE_PLACEHOLDER, coreBlock(disabledCore))
    : `${prompt}\n\n${coreBlock(disabledCore)}`;

  const block = screeningBlock(questions);
  if (next.includes(SCREENING_PLACEHOLDER)) {
    next = next.replace(SCREENING_PLACEHOLDER, block);
  } else if (block) {
    next = `${next}\n\n${block}`;
  }
  // Last: the published Sarah configuration (P17) replaces the hard-coded life-safety and
  // resident blocks, so nothing above can re-introduce an unapproved script.
  // With nothing published the defaults still apply: they carry the safe emergency fallback
  // (leave the area, call 911), the one-question-at-a-time rules and the capture-only leasing flow.
  return applySarahConfig(next, sarah ?? normalizeConfig(defaultConfig()));
}

/** Swaps one known block for its configured replacement, or appends the replacement if the stored prompt no longer contains it verbatim. */
function replaceBlock(prompt: string, old: string, replacement: string): string {
  const at = prompt.indexOf(old);
  if (at === -1) return `${prompt}\n\n${replacement}`;
  return `${prompt.slice(0, at)}${replacement}${prompt.slice(at + old.length)}`;
}

/**
 * Swaps the resident-calls block for its configured replacement. A stored prompt can still carry an
 * OLDER version of RESIDENT_TRIAGE_BLOCK (the text was reworded to ask one question at a time), which
 * would not match verbatim and would be left in place next to the new one. So when the current text
 * is not found, the old block is cut out by its fixed start line and the section that follows it.
 */
function replaceResidentBlock(prompt: string, replacement: string): string {
  if (prompt.includes(RESIDENT_TRIAGE_BLOCK)) return replaceBlock(prompt, RESIDENT_TRIAGE_BLOCK, replacement);
  const start = prompt.indexOf("RESIDENT CALLS:\nThis section supersedes");
  const endMarker = "\n\nWHEN THERE'S NO MATCH:";
  const end = start === -1 ? -1 : prompt.indexOf(endMarker, start);
  if (start === -1 || end === -1) return `${prompt}\n\n${replacement}`;
  return `${prompt.slice(0, start)}${replacement}${prompt.slice(end)}`;
}

/**
 * Renders a Sarah configuration into a prompt: company name, call types, the life-safety block
 * with per-incident scripts (approved ones verbatim), the resident-calls block and the
 * leasing mode. Pure, so the /sarah preview and the real push produce identical text.
 */
export function applySarahConfig(prompt: string, config: SarahConfig): string {
  const sections = composeSarahSections(config);
  let next = replaceBlock(prompt, LIFE_SAFETY_BLOCK, sections.lifeSafety);
  next = replaceResidentBlock(next, sections.resident);
  if (config.identity.companyName !== COMPANY_NAME) {
    next = next.split(COMPANY_NAME).join(config.identity.companyName);
  }
  // The one-question-at-a-time rules open and close the prompt, so nothing between can outweigh them.
  return [sections.top, next, sections.extra, sections.bottom].filter(Boolean).join("\n\n");
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
      "a standalone question like 'what's the rent for this type of unit' or 'do you allow pets', even " +
      "before you've gathered the five qualification fields. Returns only units that are " +
      "available right now: never offer a unit type that is not in the result. Once the caller " +
      "has said which city or area they want, always pass it as city: the result then holds " +
      "only units in that city. If city_status is none_available or unknown_city, nothing may " +
      "be offered there: use its say line and name only cities from cities_with_availability, " +
      "never calling them nearby or saying how far away they are.",
    url: `${siteUrl}/tools/check-availability`,
    // conversation_id isn't required from the model — it's a dynamic_variable the platform
    // fills in regardless — but declaring it is what lets the webhook resolve *whose*
    // property this is. Without it every "what's the rent" question answered whichever
    // property happened to be first in the database, no matter who the agent belonged to.
    required: [],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      // A phone call has no conversations row until it ends, so the agent id is what tells the
      // webhook which team's units to read — see resolveBookingOrg in convex/http.ts.
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      bedrooms: {
        type: "string",
        description:
          "The bedroom count asked about: 'studio', '1br', '2br', or '3br+'. Omit to get all units.",
      },
      city: {
        type: "string",
        description:
          "The city or area the caller wants to rent in, in their own words (it may name more than one place). " +
          "Only a place they want, never one they want to avoid. Omit it when they have no " +
          "preference ('anywhere', 'not sure', 'the Capital Region') or have not said yet.",
      },
    },
  },
  {
    name: "get_unit_details",
    description:
      "Looks up the details of an AVAILABLE unit a caller is interested in: bathrooms, floor, laundry, " +
      "heating fuel and who pays for gas, electric and heat. Call it only when the caller asks about " +
      "one of those, with the building they named; do not read every field unprompted. It returns only " +
      "units that are available right now, never anything about residents or owners. A null field is " +
      "not known: say you don't have that detail and the team will follow up, never guess. If it asks " +
      "which building, use its say line, or let the caller choose from its candidates.",
    url: `${siteUrl}/tools/get-unit-details`,
    required: ["conversation_id", "spoken_building"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      spoken_building: {
        type: "string",
        description: "The building the caller is asking about, as they said it: a street address or a community name.",
      },
      bedrooms: {
        type: "string",
        description: "The bedroom count they asked about: 'studio', '1br', '2br' or '3br+'. Omit it if they did not say.",
      },
      spoken_unit: {
        type: "string",
        description: "The unit or apartment number they asked about, exactly as the caller said it. Omit it if they did not say one.",
      },
    },
  },
  {
    name: "check_qualification",
    description:
      "Records a prospective tenant's stated bedrooms, budget, move-in date, pet needs, the " +
      "leasing answers your instructions list and any extra screening answers, and returns " +
      "what is available. It is capture only: the team reviews every answer, and the result " +
      "never says whether the caller qualifies, so never tell them they do or do not. Use " +
      "log_lead for the normal leasing answers as you collect them; call this only when your " +
      "instructions list EXTRA SCREENING QUESTIONS, to record those answers. Safe to call again " +
      "in the same call; include every answer you have each time.",
    url: `${siteUrl}/tools/check-qualification`,
    // Only the two structural fields are required. move_in_date, budget and pets_wanted are
    // optional because each property manager can switch those questions off (see
    // convex/coreQuestions.ts) and this tool is shared by every agent, so `required` cannot
    // vary per user. Which ones actually get asked is driven by each agent's own prompt; the
    // webhook already type-guards all three, so an absent field simply skips its rule.
    required: ["conversation_id", "bedrooms", "caller_name", "caller_phone"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      bedrooms: {
        type: "string",
        description: "The bedroom count they want: 'studio', '1br', '2br', or '3br+'.",
      },
      // The leasing questions that are only recorded (build plan C8). All optional: leave out
      // whatever the caller was not asked or did not answer.
      third_party_payer: {
        type: "boolean",
        description: "Whether someone else (an agency, employer or family member) will pay some or all of the rent.",
      },
      payer_name: { type: "string", description: "That payer's name, only if third_party_payer is true." },
      payer_phone: { type: "string", description: "That payer's phone number, as digits, only if they gave one." },
      payer_email: { type: "string", description: "That payer's email address, only if they gave one." },
      preferred_communities: {
        type: "string",
        description: "Communities in the Capital Region they would prefer, in their words.",
      },
      avoid_communities: {
        type: "string",
        description: "Communities in the Capital Region they want to avoid, in their words.",
      },
      pet_count: { type: "number", description: "How many pets they have or plan to bring." },
      other_info: { type: "string", description: "Anything else the caller wants the team to know." },
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
      "Books a tour for a leasing caller who wants one. Pass slot_start with a start value " +
      "from your latest find_tour_times result, only after reading it back and hearing yes. " +
      "Only if find_tour_times said booking isn't available, pass " +
      "preferred_slot with their preferred day and time instead. Call log_lead first so the " +
      "caller's answers are recorded.",
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
      // Lets the webhook find the team to alert on a phone call, before any conversations row
      // exists — see resolveBookingOrg in convex/http.ts.
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
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
      "Records a call from an existing resident that is NOT a maintenance issue — rent or fees, " +
      "portal login, an application, eviction, non-renewal, renewal, a work-order status, a " +
      "vendor payment, a neighbor dispute or anything else — with its call_type and how severe " +
      "it is on a 1-10 scale. For anything broken, leaking or unsafe use " +
      "log_maintenance_request instead. Ask for their name, unit and a callback number FIRST " +
      "and pass them here — do not call this with a placeholder like 'unknown'. Safe to call " +
      "more than once in the same call: a second call updates the same record, so if you learn " +
      "or correct anything afterwards, call it again with the full details. Do not call it for " +
      "people looking to rent — that is check_qualification. If the severity is 8 or higher, " +
      "call escalate as well.",
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
          "The unit or apartment number exactly as the caller said it. Ask for it before calling this rather " +
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
          "One plain sentence: why they called, in their words.",
      },
      category: {
        type: "string",
        description: "One of: maintenance, billing, noise, lockout, lease, other.",
      },
      call_type: {
        type: "string",
        description:
          "What kind of call this was. One of: rent, portal_login, application, eviction, " +
          "non_renewal, renewal, work_order_status, vendor_payment, neighbor_dispute, other.",
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
          "A few words on why that number, in terms of how the problem affects the home and its occupants.",
      },
    },
  },
  {
    name: "lookup_caller",
    description:
      "Looks up the caller's phone number (caller ID) against the resident list. Call it at the " +
      "start of a resident or maintenance call. If it matches, you get a first name and a unit " +
      "label: use them only to CONFIRM ('Am I speaking with Sam in unit 4B?'), never to assume. " +
      "It returns nothing else about the resident. If it does not match, ask only for what the " +
      "caller has not already said (name, then property, then unit) and use find_unit.",
    url: `${siteUrl}/tools/lookup-caller`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
    },
  },
  {
    name: "find_unit",
    description:
      "Checks whether the property name or address and the unit number a caller said match a unit " +
      "in our records. It returns only unit labels and building street addresses, never anything " +
      "about who lives anywhere or whether a unit is occupied. Use it after lookup_caller did not " +
      "match, once you have the property and the unit, asked or already said (then call it right " +
      "away, in silence, and ask its say line only after the result). Only matched true " +
      "identifies the unit. When matched is false it may return options for the caller to choose " +
      "from: similar_units or all_units (property_matched true: the building matched, the unit did " +
      "not) or address_options (several or close buildings). Read the options as one question, let " +
      "the caller pick, never pick for them, then call find_unit again with exactly what they " +
      "confirmed. With no options, follow its say line (repeat, spell or give the floor). If the " +
      "caller says none of them or it still does not match, take a callback number or email only to " +
      "record it and use log_unmatched_caller.",
    url: `${siteUrl}/tools/find-unit`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      spoken_address: {
        type: "string",
        description: "The street address the caller said, as they said it. Leave out if they did not give one.",
      },
      spoken_unit: {
        type: "string",
        description:
          "The unit or apartment number exactly as the caller said it. Leave it out only if they say the " +
          "home has no unit number (a house).",
      },
    },
  },
  {
    name: "check_work_order_status",
    description:
      "Looks up the recorded status of a resident's existing maintenance request or work order. Use it " +
      "when a resident asks about something they already reported, once you have their name, the address and " +
      "the unit, and after find_unit returned matched true for that address and unit (a suggestion or similar " +
      "unit is not enough). Pass the name they gave and the issue if they said it. If it returns choices, ask " +
      "which one using its say line, then call it again with request_ref. Say only what it returns; never " +
      "mention identity checks or whether a name matched.",
    url: `${siteUrl}/tools/check-work-order-status`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      caller_name: { type: "string", description: "The caller's full name, exactly as they gave it." },
      spoken_address: {
        type: "string",
        description: "The property_address find_unit returned with matched true (else the address as they said it).",
      },
      spoken_unit: {
        type: "string",
        description: "The unit_label find_unit returned with matched true. Leave out only for a house with no unit label.",
      },
      issue_description: {
        type: "string",
        description: "What the maintenance issue is, in the caller's words. Optional.",
      },
      first_reported: {
        type: "string",
        description: "When they say they first reported it, in their words. Optional.",
      },
      request_ref: {
        type: "string",
        description:
          "Only on a second call: the ref of the choice the caller picked from this tool's choices. Never read it out.",
      },
    },
  },
  {
    name: "log_maintenance_request",
    description:
      "Records a resident's maintenance request, including emergencies. Use it for anything " +
      "broken, leaking, not working or unsafe, and for tenant-responsibility items (bulbs, " +
      "blinds, trash to the curb) with issue_type tenant_responsibility. A matched resident's " +
      "question that is not a repair (a lease question, a package, parking) is also logged here, " +
      "with issue_type other, severity informational and a description that begins 'Question, not " +
      "a repair:'; the asset manager reviews it. Call it only once the unit is identified " +
      "(the caller said yes to lookup_caller's or find_unit's match) AND the caller has said what is actually " +
      "wrong, EXCEPT in a life-safety emergency, where you log immediately with whatever you have. " +
      "'A maintenance issue' or 'a complaint' is not a description: ask what's going on first; a " +
      "call without a real description is refused with logged false. Say it was logged only when " +
      "a result had logged true, once, when you close the call (a life-safety result's say line is " +
      "the only exception). Never pass a placeholder " +
      "like 'unknown' for anything — leave the field out instead. Safe to call more than once " +
      "in the same call: each call updates the same request, so if you learn or correct " +
      "anything afterwards, call it again: only the fields you send are updated. Log it as soon " +
      "as you know what is wrong, then update as you learn more. For an emergency or urgent " +
      "issue, call escalate after logging it.",
    url: `${siteUrl}/tools/log-maintenance-request`,
    // Only what an emergency can supply with nothing else known. caller_name and the rest are
    // deliberately optional: when they were required for log_tenant_issue the agent satisfied the
    // schema by inventing "unknown" (2026-08-24).
    required: ["conversation_id", "issue_type", "description", "severity", "unit_confirmed"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      unit_confirmed: {
        type: "boolean",
        description:
          "True only if the caller said yes, in their own words, after you read the unit back. A tool " +
          "result is not a yes. Without it the request is refused, except in a life-safety emergency.",
      },
      caller_name: {
        type: "string",
        description:
          "The resident's full name, exactly as they gave it. Never a placeholder such as " +
          "'unknown' — if you don't have it yet, ask, or leave it out.",
      },
      caller_email: { type: "string", description: "The caller's email address, only if they gave one." },
      title: { type: "string", description: "A short title for the issue, in the caller's own words." },
      callback_phone: {
        type: "string",
        description:
          "The number they want to be reached on, as digits, read back and confirmed. Leave it " +
          "out if they decline or say to use the number they called from; never invent one.",
      },
      spoken_address: { type: "string", description: "The property address the caller said, as they said it." },
      spoken_unit: { type: "string", description: "The unit or apartment number exactly as the caller said it." },
      issue_type: {
        type: "string",
        description:
          "One of: electrical, water_leak, broken_item, gas, fire, flooding, " +
          "tenant_responsibility, other.",
      },
      description: {
        type: "string",
        description:
          "One or two plain sentences on what is wrong and where, in the caller's words. " +
          "Never a generic 'maintenance issue' or 'complaint'.",
      },
      first_noticed: { type: "string", description: "When they first noticed it, in their words." },
      answers: {
        type: "string",
        description:
          "JSON object of the issue-specific answers, short key to short string value, e.g. " +
          '{"<question key>": "<the caller\'s answer in their words>"}. ' +
          "Include every answer you were given; omit if there are none.",
      },
      pets: { type: "string", description: "Pets in the unit: their type and how many, as the caller described them; omit if none." },
      preferred_access_times: {
        type: "string",
        description: "Times that suit the caller for a technician to come by, in their words.",
      },
      severity: {
        type: "string",
        description:
          "One of: emergency, urgent, routine, informational, using the levels in your " +
          "instructions. Judge the issue itself, never how upset the caller sounds.",
      },
      severity_score: {
        type: "number",
        description:
          "A 1-10 score for how serious the issue is, consistent with the level you chose " +
          "(emergency 9-10, urgent 7-8, routine 3-6, informational 1-2). Judge the issue, not the caller.",
      },
      severity_reason: {
        type: "string",
        description: "A few words on why that level, in terms of how the problem affects the home and its occupants.",
      },
    },
  },
  {
    name: "log_unmatched_caller",
    description:
      "Records a caller who could not be matched to a unit by caller ID or by the property and unit " +
      "they gave. Passes their details to an asset manager for a callback. It creates no " +
      "maintenance request. Ask for a callback phone (and email if offered) only to record it, and " +
      "read the number back. Never use them to look anyone up. Safe to call again to add details.",
    url: `${siteUrl}/tools/log-unmatched-caller`,
    required: ["conversation_id", "issue_summary"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      issue_summary: { type: "string", description: "One or two plain sentences on what the caller needs." },
      reason: { type: "string", description: "Why they could not be matched, in a few words. Optional." },
      caller_name: { type: "string", description: "The caller's name, if they gave it." },
      callback_phone: { type: "string", description: "The number to call them back on, as digits, read back." },
      caller_email: { type: "string", description: "Their email address, if they gave one." },
      spoken_unit: { type: "string", description: "The unit number they said, if any." },
      severity: {
        type: "string",
        description:
          "Optional. Set to 'emergency' ONLY when the issue is life-safety (fire, gas leak, flooding, " +
          "break-in, someone in danger). The team is then alerted. Leave it out otherwise.",
      },
    },
  },
  {
    name: "send_photo_link",
    description:
      "Use ONLY when the caller says they are willing to send photos or video of the problem. It sends " +
      "nothing to the caller: it records the offer on the maintenance request logged on this call and " +
      "tells their asset manager, who decides what to do and follows up. Call it only after " +
      "log_maintenance_request has run. Put the caller's own words, limits or caveats in note (for " +
      "for example what they can and cannot send, and when). Never tell the caller you will text them a link; " +
      "say what the tool's say line says.",
    url: `${siteUrl}/tools/send-photo-link`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      note: {
        type: "string",
        description: "What the caller said about photos or video, in a short sentence, including any limits.",
      },
      callback_phone: {
        type: "string",
        description: "A number the caller gave for the asset manager to reach them on, as digits. Leave out if none.",
      },
      caller_email: { type: "string", description: "Their email address, only if they gave one." },
    },
  },
  {
    name: "log_lead",
    description:
      "Records a prospective tenant's answers as you learn them. Capture only: it never says whether " +
      "they qualify. Call it after the first useful answer and again as you learn more, with everything " +
      "you have so far; later calls add to the same lead. Returns available_units (the only units you " +
      "may offer) and who the lead is assigned to.",
    url: `${siteUrl}/tools/log-lead`,
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      caller_name: { type: "string", description: "The caller's name." },
      caller_phone: { type: "string", description: "A callback number for the caller, as digits." },
      caller_email: { type: "string", description: "Their email address, if they gave one." },
      bedrooms: { type: "string", description: "The bedroom count they want: 'studio', '1br', '2br', or '3br+'." },
      move_in_date: { type: "string", description: "When they want to move in, in their own words." },
      budget: { type: "number", description: "Their monthly budget in dollars." },
      pets_wanted: { type: "boolean", description: "Whether they have or plan to bring pets." },
      pet_type: { type: "string", description: "The kind of pet, if they have one." },
      pet_count: { type: "number", description: "How many pets." },
      third_party_payer: {
        type: "boolean",
        description: "Whether someone else (an agency, employer or family member) will pay some or all of the rent.",
      },
      payer_name: { type: "string", description: "That payer's name, only if third_party_payer is true." },
      payer_phone: { type: "string", description: "That payer's phone number, as digits." },
      payer_email: { type: "string", description: "That payer's email address." },
      preferred_area: {
        type: "string",
        description:
          "The city or area they want to rent in, in their words, or 'no preference' for 'anywhere', " +
          "'not sure' or 'the Capital Region'. If they settle on another city after hearing what is " +
          "open, include every place they named, in their words.",
      },
      preferred_communities: {
        type: "string",
        description: "Older name for preferred_area. Send preferred_area instead.",
      },
      avoid_communities: { type: "string", description: "Communities in the Capital Region they want to avoid." },
      other_info: { type: "string", description: "Anything else the caller wants the team to know." },
    },
  },
  {
    name: "route_owner_prospect",
    description:
      "Records a property owner who wants this company to manage their property, and alerts " +
      "the team. Not for renters. Ask for their name and the best number to reach them first; " +
      "never pass a placeholder like 'unknown' — leave a field out instead.",
    url: `${siteUrl}/tools/owner-prospect`,
    required: ["conversation_id", "name"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      name: { type: "string", description: "The owner's full name, as they gave it." },
      phone: {
        type: "string",
        description:
          "The best number to reach them on, as digits, read back and confirmed. Leave it out " +
          "only if they say to use the number they called from.",
      },
      email: { type: "string", description: "Their email address, if they offered it." },
      property_address: { type: "string", description: "The address of the property, if they gave it." },
      property_details: {
        type: "string",
        description: "What they said about the property: type, number of units, current situation.",
      },
      notes: { type: "string", description: "Anything else useful for the team, in one or two sentences." },
    },
  },
];

/**
 * The owner call menu's three tools (Sarah Configuration section 13). Attached ONLY while the menu is
 * live (see routingForPush): while it is off the agent has none of them, so its tool list is unchanged.
 */
const ROUTING_TOOL_DEFS = (siteUrl: string): el.ToolDefinition[] => [
  {
    name: "verify_owner",
    description:
      "Owner call menu only. Verifies an EXISTING property owner before any transfer: the property they own " +
      "(matched like find_unit) and the email address on file for it. " + OWNER_ADDRESS_RULE + " Call it first " +
      "with the address only, and say its say line to confirm the property. Then, after reading the email back and " +
      "the caller confirming it, call it again with the confirmed address and the email. Returns ask_property, " +
      "verified, needs_property_confirmation, not_verified or no_match_take_message. Read the phone menu only after " +
      "verified. Never for tenants, prospects or anyone else.",
    url: `${siteUrl}/tools/verify-owner`,
    // Not required: a required field pushes the model to fill it before the caller has said one.
    // Missing or empty returns ask_property (no attempt counted).
    required: ["conversation_id"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      spoken_property_address: {
        type: "string",
        description:
          "The street address of the property the caller owns, in the caller's own words from this call, or the " +
          "option they confirmed. Never an example or a guess; leave it out if they have not said one.",
      },
      email: {
        type: "string",
        description:
          "The email address on file, exactly as the caller confirmed it after your read-back, written out or as " +
          "spoken (letters, 'at', 'dot'). Leave it out on the first call, while confirming the property.",
      },
      caller_name: {
        type: "string",
        description: "The owner's name, if they gave it. Optional, for the record only; never used to verify. Leave it out if they did not say.",
      },
    },
  },
  {
    name: "check_staff_availability",
    description:
      "Owner call menu only. Checks whether the staff member a VERIFIED existing property owner asked for can be " +
      "put through right now; their number and hours come from the directory, in New York time. Call it only " +
      "after verify_owner returned verified in this call, with who they asked for: a name, a role such as " +
      "the department they named, or the key they pressed. " +
      (TRANSFER_MECHANISM === "twilio_dial"
        ? "If available is true, call transfer_owner_call with the same person straight away. "
        : "If available is true, call transfer_to_number with its transfer_number and its say line as client_message. ") +
      "Otherwise say its say line and take a message with take_staff_message. Never for tenants, prospects, vendors or anyone else.",
    url: `${siteUrl}/tools/check-staff-availability`,
    required: ["conversation_id", "person"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      person: {
        type: "string",
        description:
          "Who the owner asked for, as they said it: a name, a role or department, or the key they pressed.",
      },
    },
    // Dynamic mode only (ownerRoutingLib.TRANSFER_DESTINATION_MODE): the transfer destination is these
    // variables, which only this tool's result sets. In static mode none ([] clears old ones on PATCH).
    assignments:
      TRANSFER_DESTINATION_MODE === "dynamic"
        ? [
            { dynamicVariable: OWNER_TRANSFER_VAR, valuePath: "transfer_number" },
            { dynamicVariable: OWNER_TRANSFER_DIGITS_VAR, valuePath: "transfer_digits" },
          ]
        : [],
  },
  // Our own transfer (ownerRoutingLib.TRANSFER_MECHANISM "twilio_dial"): the server rings the staff
  // member through Twilio and keeps the caller on the line if nobody picks up.
  ...(TRANSFER_MECHANISM === "twilio_dial"
    ? [
        {
          name: "transfer_owner_call",
          description:
            "Owner call menu only. Puts a VERIFIED existing property owner through to the staff member " +
            "check_staff_availability just returned available for. Call it straight away after that, with the " +
            "same person, then say its say line and nothing else. If it does not return connecting, say its say " +
            "line and take a message with take_staff_message. Never for tenants, prospects, vendors or anyone else.",
          url: `${siteUrl}/tools/transfer-owner-call`,
          required: ["conversation_id", "call_sid", "person"],
          properties: {
            conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
            agent_id: { type: "string", dynamicVariable: "system__agent_id" },
            call_sid: { type: "string", dynamicVariable: "system__call_sid" },
            person: {
              type: "string",
              description: "The same person you passed to check_staff_availability (a name, a role or the key they pressed).",
            },
          },
        } satisfies el.ToolDefinition,
      ]
    : []),
  {
    name: "take_staff_message",
    description:
      "Owner call menu only. Saves a message for a staff member an existing owner could not be put through " +
      "to, so that person can call them back. Ask for their name, the best callback number (read it back) " +
      "and what it is about first. Never say the message was passed on unless this returns logged true.",
    url: `${siteUrl}/tools/take-staff-message`,
    required: ["conversation_id", "person", "message"],
    properties: {
      conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      agent_id: { type: "string", dynamicVariable: "system__agent_id" },
      caller_id: { type: "string", dynamicVariable: "system__caller_id" },
      person: { type: "string", description: "Who the message is for, as in check_staff_availability's person." },
      caller_name: { type: "string", description: "The owner's name, as they gave it. Leave it out if they did not say." },
      callback_phone: {
        type: "string",
        description:
          "The best number to call them back on, as digits, read back and confirmed. Leave it out if they " +
          "said to use the number they are calling from.",
      },
      message: { type: "string", description: "One or two plain sentences: what the message is about, in their words." },
    },
  },
];

/** Every webhook tool the agent gets: the routing tools only while the owner menu is live. Exported for the tests. */
export function toolDefsFor(siteUrl: string, routing: boolean): el.ToolDefinition[] {
  return [...TOOL_DEFS(siteUrl), ...(routing ? ROUTING_TOOL_DEFS(siteUrl) : [])];
}

/**
 * The owner call menu for a push, or null while it is off (then the agent gets no transfer tool, no
 * routing tools and no keypad input). Numbers that ring Sarah herself are never transfer targets:
 * her line from env and, as a second check, every number ElevenLabs has assigned to this agent.
 */
async function routingForPush(sarah: SarahConfig | null, elevenLabsAgentId: string | null): Promise<MenuEntry[] | null> {
  if (!sarah || !ownerRoutingMenu(sarah)) return null;
  const blocked: string[] = [...ownLines()];
  try {
    for (const n of await el.listPhoneNumbers()) {
      if (n.phone_number && (!elevenLabsAgentId || n.assigned_agent?.agent_id === elevenLabsAgentId)) blocked.push(n.phone_number);
    }
  } catch (err) {
    console.error("[agents] could not list phone numbers; only the env line is excluded from transfers:", err);
  }
  return ownerRoutingMenu(sarah, blocked);
}

/**
 * The keypad setting for a push. On with the menu. With the menu off it is switched off explicitly
 * only if the agent still has it on; otherwise it is left out of the request, so an off menu sends
 * nothing new to the live agent.
 */
/**
 * The agent's dynamic-variable placeholders for a push: the transfer variables only for a live menu in
 * dynamic mode, otherwise {} (always sent, so ones left by an earlier push are cleared).
 */
function placeholdersForPush(menuLive: boolean): Record<string, string> {
  return menuLive && TRANSFER_DESTINATION_MODE === "dynamic" ? transferPlaceholders() : {};
}

async function dtmfForPush(menuLive: boolean, elevenLabsAgentId: string | null): Promise<boolean | undefined> {
  if (menuLive) return true;
  if (!elevenLabsAgentId) return undefined;
  try {
    return (await el.getAgentDtmfEnabled(elevenLabsAgentId)) ? false : undefined;
  } catch (err) {
    console.error("[agents] could not read the keypad setting; switching it off explicitly:", err);
    return false;
  }
}

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
  // routing: also the owner call menu's tools (only while the menu is live).
  args: { routing: v.optional(v.boolean()) },
  handler: async (_ctx, args): Promise<string[]> => {
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not set on this deployment.");

    const { tools: existing } = await el.listTools();
    // Every webhook tool carries the shared secret that convex/http.ts requires on /tools/*.
    const toolSecret = process.env.ELEVENLABS_TOOL_SECRET;
    if (!toolSecret) {
      throw new Error(
        "ELEVENLABS_TOOL_SECRET is not set on this deployment. Set it, then re-save the agent " +
          "so the tools are re-published with the x-simplr-tool-secret header.",
      );
    }
    const defs = toolDefsFor(siteUrl, !!args.routing).map((d) => ({
      ...d,
      requestHeaders: { "x-simplr-tool-secret": toolSecret },
    }));
    // Only the tools in TOOL_DEFS are returned, and callers send that list as the agent's full
    // tool_ids on every publish. A tool that was removed from TOOL_DEFS (find_resident, route
    // /tools/find-resident) is therefore detached from the agent on its next save; it is never
    // looked up here again. The orphaned workspace tool is left in ElevenLabs (it may still be
    // attached to agents that have not been re-saved) and its route now answers 404.
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

/**
 * The full ElevenLabs config for one org's agent: published Sarah config, screening questions,
 * disabled core questions, synced knowledge base, tool ids, tunings. Shared by saveAgent and
 * createDedicatedAgent so a new setting can't land on only one of them.
 *
 * `sourcePrompt` is returned separately on purpose: it is what gets stored, while `config.prompt`
 * has the screening block rendered in. Storing the composed one would bake the render into the
 * editable text and duplicate the block on every subsequent save.
 */
async function buildAgentConfig(
  ctx: ActionCtx,
  orgId: string,
  overrides: { name?: string; prompt?: string; firstMessage?: string; voiceId?: string },
): Promise<{ config: el.AgentConfig; sourcePrompt: string }> {
  const existing = await ctx.runQuery(internal.agents.currentInternal, { orgId });
  const knowledgeBase: el.KnowledgeBaseEntry[] = await ctx.runQuery(
    internal.docs.syncedEntries,
    { orgId },
  );
  const sarah: SarahConfig | null = await ctx.runQuery(internal.sarahConfig.publishedForOrg, { orgId });
  const menu = await routingForPush(sarah, existing?.elevenLabsAgentId ?? null);
  const toolIds: string[] = await ctx.runAction(internal.agents.ensureTools, { routing: menu !== null });
  const questions: ScreeningQuestion[] = await ctx.runQuery(
    internal.screening.activeForOrg,
    { orgId },
  );
  const disabledCore: string[] = await ctx.runQuery(
    internal.screening.disabledBuiltinsForOrg,
    { orgId },
  );
  const sourcePrompt = overrides.prompt ?? existing?.prompt ?? LEASING_PROMPT;

  const config: el.AgentConfig = {
    name: overrides.name ?? existing?.name ?? "Sarah",
    prompt: composePrompt(sourcePrompt, questions, disabledCore, sarah),
    firstMessage: overrides.firstMessage ?? existing?.firstMessage ?? DEFAULT_FIRST_MESSAGE,
    voiceId: overrides.voiceId ?? existing?.voiceId ?? DEFAULT_VOICE_ID,
    knowledgeBase,
    toolIds,
    voice: VOICE_TUNING,
    turn: TURN_TUNING,
    vad: VAD_TUNING,
    llm: LLM_TUNING,
    transfer: menu && TRANSFER_MECHANISM === "elevenlabs_system" ? transferToolConfig(menu) : null,
    dtmfInput: await dtmfForPush(menu !== null, existing?.elevenLabsAgentId ?? null),
    dynamicVariablePlaceholders: placeholdersForPush(menu !== null),
  };
  return { config, sourcePrompt };
}

/** Creates the caller's own agent on first run, updates it thereafter. Safe to call repeatedly. */
export const saveAgent = action({
  args: {
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    firstMessage: v.optional(v.string()),
    voiceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const org = await requireOrgId(ctx);
    if (!isAdminView(org)) throw new ConvexError("You don't have access to that.");
    const { orgId, userId } = org;
    // A no-op if this user already has an agent. Guarantees that even someone who opens
    // Settings and hits Save before ever placing a call still starts from the same seeded
    // setup (property + knowledge base included) as everyone else — not a bare prompt with
    // nothing behind it.
    await ctx.runAction(internal.agents.ensure, { orgId, userId });
    const existing = await ctx.runQuery(internal.agents.currentInternal, { orgId });
    // Still none means another setup run is mid-flight. Creating one here would give the team a
    // second ElevenLabs agent, so ask them to retry once that run has finished.
    if (!existing) throw new ConvexError("Your assistant is still being set up. Try saving again in a few seconds.");
    const { config, sourcePrompt } = await buildAgentConfig(ctx, orgId, {
      name: args.name,
      prompt: args.prompt,
      firstMessage: args.firstMessage,
      voiceId: args.voiceId,
    });

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

/** Agent rows with their team names, so an operator can find the orgId for createDedicatedAgent. */
export const listForOps = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agents").collect();
    return Promise.all(
      rows.map(async (a) => {
        const orgDocId = ctx.db.normalizeId("organizations", a.orgId);
        const org = orgDocId ? await ctx.db.get(orgDocId) : null;
        return {
          orgId: a.orgId,
          orgName: org?.name ?? null,
          elevenLabsAgentId: a.elevenLabsAgentId,
          name: a.name,
          previousElevenLabsAgentId: a.previousElevenLabsAgentId ?? null,
        };
      }),
    );
  },
});

/** Points the org's agents row at a freshly created ElevenLabs agent and audits it. */
export const recordAgentRecreated = internalMutation({
  args: {
    orgId: v.string(),
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
    if (!existing) throw new Error("This team has no agent row to re-create. Run agents.ensure first.");
    await ctx.db.patch(existing._id, {
      elevenLabsAgentId: args.elevenLabsAgentId,
      previousElevenLabsAgentId: existing.elevenLabsAgentId,
      name: args.name,
      prompt: args.prompt,
      firstMessage: args.firstMessage,
      voiceId: args.voiceId,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "config",
      entityId: "agent",
      action: "agent_recreated",
      from: existing.elevenLabsAgentId,
      to: args.elevenLabsAgentId,
      note: args.name,
    });
  },
});

/**
 * Creates a NEW, separate ElevenLabs agent for one team (e.g. a dedicated 518 Property Pro agent
 * instead of one inherited from the old Voice-Agent project), with the same full config saveAgent
 * would push (see buildAgentConfig), and re-points the team's agents row at it. Always creates;
 * never updates. The previous ElevenLabs agent is NOT deleted -- its id is kept in
 * previousElevenLabsAgentId, and it can be removed by hand in ElevenLabs once nothing uses it.
 *
 * Mid-call tools and webhooks find the team through orgByElevenLabsAgentId, so they follow the
 * new id as soon as the row is updated; calls still reaching the old agent stop resolving to
 * this team.
 *
 *   npx convex run agents:listForOps
 *   npx convex run agents:createDedicatedAgent '{"orgId":"<id>","name":"518 Property Pro – Sarah"}'
 *
 * Then, in ElevenLabs -> Phone numbers, assign the 518 number to the new agent. The post-call
 * webhook is workspace-level and unchanged.
 */
export const createDedicatedAgent = internalAction({
  args: { orgId: v.string(), name: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ orgId: string; elevenLabsAgentId: string; previousElevenLabsAgentId: string | null }> => {
    const existing = await ctx.runQuery(internal.agents.currentInternal, { orgId: args.orgId });
    if (!existing || existing.orgId !== args.orgId) {
      throw new Error("No agent row for that orgId. Run agents:listForOps to find it.");
    }
    const { config, sourcePrompt } = await buildAgentConfig(ctx, args.orgId, {
      name: args.name ?? "518 Property Pro – Sarah",
    });
    const created = await el.createAgent(config);
    await ctx.runMutation(internal.agents.recordAgentRecreated, {
      orgId: args.orgId,
      elevenLabsAgentId: created.agent_id,
      name: config.name,
      prompt: sourcePrompt,
      firstMessage: config.firstMessage,
      voiceId: config.voiceId,
    });
    return {
      orgId: args.orgId,
      elevenLabsAgentId: created.agent_id,
      previousElevenLabsAgentId: existing.elevenLabsAgentId,
    };
  },
});

/** Audit row for a phone number being (re)assigned. Only the last 4 digits are ever stored. */
export const recordPhoneNumberConnected = internalMutation({
  args: {
    orgId: v.string(),
    previousAgentId: v.string(),
    agentId: v.string(),
    last4: v.string(),
  },
  handler: async (ctx, args) => {
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "config",
      entityId: "phone_number",
      action: "phone_number_connected",
      from: args.previousAgentId,
      to: args.agentId,
      note: args.last4,
    });
  },
});

/**
 * Connects the Twilio number to the org's current ElevenLabs agent: imports it into ElevenLabs
 * if it is not there yet, then assigns it. Defaults to TWILIO_SMS_FROM_NUMBER. Twilio credentials
 * are read from server-side env only and never returned or logged; the result carries only the
 * last 4 digits of the number.
 *
 *   npx convex run agents:connectPhoneNumber '{"orgId":"<id>"}'
 */
export const connectPhoneNumber = internalAction({
  args: { orgId: v.string(), phoneNumber: v.optional(v.string()), label: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    phoneNumberLast4: string;
    phoneNumberId: string;
    previousAgentId: string | null;
    previousAgentName: string | null;
    agentId: string;
  }> => {
    const raw = args.phoneNumber ?? process.env.TWILIO_SMS_FROM_NUMBER;
    if (!raw?.trim()) {
      throw new Error("No phone number given and TWILIO_SMS_FROM_NUMBER is not set.");
    }
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw new Error("That is not a valid phone number.");
    // A bare 10-digit number is assumed to be North American.
    const e164 = `+${digits.length === 10 ? `1${digits}` : digits}`;
    const last4 = e164.slice(-4);

    const agent = await ctx.runQuery(internal.agents.currentInternal, { orgId: args.orgId });
    if (!agent || agent.orgId !== args.orgId) {
      throw new Error("No agent row for that orgId. Run agents:listForOps to find it.");
    }

    const numbers = await el.listPhoneNumbers();
    const found = numbers.find((n) => n.phone_number?.replace(/\D/g, "") === e164.slice(1));

    let phoneNumberId: string;
    let previousAgentId: string | null = null;
    let previousAgentName: string | null = null;
    if (found?.phone_number_id) {
      phoneNumberId = found.phone_number_id;
      previousAgentId = found.assigned_agent?.agent_id ?? null;
      previousAgentName = found.assigned_agent?.agent_name ?? null;
    } else {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.");
      const created = await el.importTwilioPhoneNumber({
        phoneNumber: e164,
        label: args.label ?? "518 Property Pro",
        sid,
        token,
      });
      phoneNumberId = created.phone_number_id;
    }

    await el.assignPhoneNumberAgent(phoneNumberId, agent.elevenLabsAgentId);

    await ctx.runMutation(internal.agents.recordPhoneNumberConnected, {
      orgId: args.orgId,
      previousAgentId: previousAgentId ?? "none",
      agentId: agent.elevenLabsAgentId,
      last4,
    });

    return {
      phoneNumberLast4: last4,
      phoneNumberId,
      previousAgentId,
      previousAgentName,
      agentId: agent.elevenLabsAgentId,
    };
  },
});

/**
 * Re-attaches one user's current set of synced docs to their agent. Called after a doc
 * finishes indexing or is deleted; a no-op when that user has no agent yet.
 */
export const pushKnowledgeBase = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<{ resynced: boolean }> => {
    const agent = await ctx.runQuery(internal.agents.currentInternal, { orgId: args.orgId });
    if (!agent) return { resynced: false };

    let resynced = false;
    let knowledgeBase: el.KnowledgeBaseEntry[] = await ctx.runQuery(
      internal.docs.syncedEntries,
      { orgId: args.orgId },
    );
    // Self-healing: drop any entry whose ElevenLabs document is gone and queue a re-upload,
    // rather than letting the agent PATCH 404 on it.
    const alive: el.KnowledgeBaseEntry[] = [];
    for (const entry of knowledgeBase) {
      if (await el.kbDocExists(entry.id)) {
        alive.push(entry);
      } else {
        resynced = true;
        await ctx.runMutation(internal.docs.invalidateKbDoc, {
          orgId: args.orgId,
          kbDocumentId: entry.id,
        });
      }
    }
    knowledgeBase = alive;
    const sarah: SarahConfig | null = await ctx.runQuery(internal.sarahConfig.publishedForOrg, {
      orgId: args.orgId,
    });
    // The owner call menu: transfer tool, its two webhook tools and keypad input only while it is live.
    const menu = await routingForPush(sarah, agent.elevenLabsAgentId);
    const transfer = menu && TRANSFER_MECHANISM === "elevenlabs_system" ? transferToolConfig(menu) : null;
    const dtmfInput = await dtmfForPush(menu !== null, agent.elevenLabsAgentId);
    const toolIds: string[] = await ctx.runAction(internal.agents.ensureTools, { routing: menu !== null });
    const questions: ScreeningQuestion[] = await ctx.runQuery(
      internal.screening.activeForOrg,
      { orgId: args.orgId },
    );
    const disabledCore: string[] = await ctx.runQuery(
      internal.screening.disabledBuiltinsForOrg,
      { orgId: args.orgId },
    );
    const prompt = composePrompt(agent.prompt, questions, disabledCore, sarah);
    // Belt and braces: a doc can still vanish between the check and the PATCH. On a
    // document_not_found 404 drop that id, queue its re-upload, and retry.
    for (let attempt = 0; ; attempt++) {
      try {
        await el.updateAgent(agent.elevenLabsAgentId, {
          name: agent.name,
          prompt,
          firstMessage: agent.firstMessage,
          voiceId: agent.voiceId,
          knowledgeBase,
          toolIds,
          voice: VOICE_TUNING,
          turn: TURN_TUNING,
          vad: VAD_TUNING,
          llm: LLM_TUNING,
          transfer,
          dtmfInput,
          dynamicVariablePlaceholders: placeholdersForPush(menu !== null),
        });
        return { resynced };
      } catch (err) {
        const missing = el.missingKbDocId(err);
        if (!missing || attempt >= 3) throw err;
        resynced = true;
        knowledgeBase = knowledgeBase.filter((k) => k.id !== missing);
        await ctx.runMutation(internal.docs.invalidateKbDoc, {
          orgId: args.orgId,
          kbDocumentId: missing,
        });
      }
    }
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
      throw new ConvexError(
        orgId
          ? "Your assistant is still being set up. Try again in a few seconds."
          : "We couldn't start the assistant for this call. Try again in a moment.",
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
    vad: VAD_TUNING,
    llm: LLM_TUNING,
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

/** Patches the stored prompt and first message together, for resetToDefaultPrompt below. */
export const setPromptAndFirstMessage = internalMutation({
  args: { agentId: v.id("agents"), prompt: v.string(), firstMessage: v.string() },
  handler: (ctx, args) =>
    ctx.db.patch(args.agentId, {
      prompt: args.prompt,
      firstMessage: args.firstMessage,
      updatedAt: Date.now(),
    }),
});

/**
 * Replaces an agent's stored prompt and first message with the current LEASING_PROMPT and
 * DEFAULT_FIRST_MESSAGE, then pushes the result (and the tool list) to ElevenLabs.
 *
 * Needed because agents.prompt lives in the database: editing LEASING_PROMPT only changes agents
 * created afterwards, and saveAgent prefers the stored snapshot forever. Without this, an existing
 * team keeps the old prompt (and its old company name) even though the new tools are registered.
 * It OVERWRITES any hand edits made in Settings, so pass `orgId` to do one team at a time:
 *   npx convex run agents:resetToDefaultPrompt '{"orgId":"<organizations id>"}'
 * Omit orgId to reset every agent in the deployment.
 */
export const resetToDefaultPrompt = internalAction({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ reset: number; failed: string[] }> => {
    const agents = await ctx.runQuery(internal.agents.allForMigration, {});
    const targets = agents.filter((a) => !args.orgId || a.orgId === args.orgId);
    const failed: string[] = [];
    let reset = 0;
    for (const agent of targets) {
      try {
        if (!agent.orgId) throw new Error("no organization yet");
        await ctx.runMutation(internal.agents.setPromptAndFirstMessage, {
          agentId: agent._id,
          prompt: LEASING_PROMPT,
          firstMessage: DEFAULT_FIRST_MESSAGE,
        });
        await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: agent.orgId });
        reset += 1;
      } catch (err) {
        failed.push(`${agent.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { reset, failed };
  },
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
