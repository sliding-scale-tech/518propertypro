import { v } from "convex/values";
import type { Infer } from "convex/values";
import { SEVERITY_LEVELS } from "./severity";
import type { SeverityLevel } from "./severity";

/**
 * Sarah configuration (build plan P17): everything Pat can change about Sarah without a
 * developer. Pure module (no server imports) so the schema, the Convex functions, the prompt
 * composer and the /sarah page all share one definition, the same reason severity.ts and
 * residentTriage.ts are pure.
 *
 * The defaults below are the CURRENT hard-coded behaviour (LIFE_SAFETY_BLOCK, the questions in
 * RESIDENT_TRIAGE_BLOCK, SEVERITY_RUBRIC, the tourSchedule constants) so that opening /sarah
 * for the first time shows what Sarah does today.
 */

// --- Call types ---------------------------------------------------------------------------

export const CALL_TYPES = [
  { key: "leasing_inquiry", label: "Leasing inquiry", defaultOn: true },
  { key: "owner_prospect", label: "Owner prospect (wants 518 to manage)", defaultOn: true },
  { key: "maint_general", label: "Maintenance: general", defaultOn: true },
  { key: "maint_electrical", label: "Maintenance: electrical", defaultOn: true },
  { key: "maint_water_leak", label: "Maintenance: water leak", defaultOn: true },
  { key: "maint_broken_item", label: "Maintenance: broken item", defaultOn: true },
  { key: "maint_tenant_responsibility", label: "Maintenance: tenant-responsibility items", defaultOn: false },
  { key: "emergency", label: "Emergency: fire / flooding / gas", defaultOn: false },
  { key: "neighbor_dispute", label: "Neighbor dispute", defaultOn: false },
  { key: "rent_fees", label: "Rent due / late fees", defaultOn: false },
  { key: "portal_login", label: "Portal login", defaultOn: false },
  { key: "application", label: "Applying for an apartment", defaultOn: false },
  { key: "eviction", label: "Eviction notice / late rent (legal)", defaultOn: false },
  { key: "non_renewal", label: "Lease non-renewal", defaultOn: false },
  { key: "work_order_status", label: "Work-order status", defaultOn: false },
  { key: "renewal", label: "Lease renewal", defaultOn: false },
  { key: "vendor_payment", label: "Vendor payment status", defaultOn: false },
  { key: "owner_routing", label: "Owner call routing menu", defaultOn: false },
] as const;

export type CallTypeKey = (typeof CALL_TYPES)[number]["key"];
export const CALL_TYPE_KEYS: string[] = CALL_TYPES.map((c) => c.key);

/** Types that cannot be switched on until someone with authority has signed them off. Enforced server-side. */
export const APPROVAL_REQUIRED: readonly CallTypeKey[] = [
  "emergency",
  "eviction",
  "neighbor_dispute",
  "owner_routing",
];

/** The value Sarah's log_tenant_issue tool takes as call_type, for the non-maintenance types. */
const TENANT_CALL_TYPE: Partial<Record<CallTypeKey, string>> = {
  rent_fees: "rent",
  portal_login: "portal_login",
  application: "application",
  eviction: "eviction",
  non_renewal: "non_renewal",
  renewal: "renewal",
  work_order_status: "work_order_status",
  vendor_payment: "vendor_payment",
  neighbor_dispute: "neighbor_dispute",
};

// --- Validators ----------------------------------------------------------------------------

const approvalFields = {
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
};

const levelValidator = v.union(
  v.literal("emergency"),
  v.literal("urgent"),
  v.literal("routine"),
  v.literal("informational"),
);

export const sarahConfigValidator = v.object({
  identity: v.object({ companyName: v.string(), firstMessage: v.string() }),
  callTypes: v.array(
    v.object({ key: v.string(), enabled: v.boolean(), notes: v.optional(v.string()), ...approvalFields }),
  ),
  maintenanceQuestions: v.object({
    basic: v.array(v.string()),
    electrical: v.array(v.string()),
    water_leak: v.array(v.string()),
    broken_item: v.array(v.string()),
  }),
  tenantResponsibility: v.object({
    items: v.array(v.string()),
    wording: v.string(),
    approved: v.boolean(),
    ...approvalFields,
  }),
  severityLevels: v.array(
    v.object({
      level: levelValidator,
      definition: v.string(),
      examples: v.string(),
      responseTarget: v.string(),
    }),
  ),
  emergencyScripts: v.array(
    v.object({
      incident: v.union(
        v.literal("fire"),
        v.literal("flooding"),
        v.literal("gas_hissing"),
        v.literal("gas_slight"),
        v.literal("other"),
      ),
      wording: v.string(),
      phone: v.optional(v.string()),
      ...approvalFields,
    }),
  ),
  escalationContacts: v.array(
    v.object({ level: levelValidator, userIds: v.array(v.id("users")), externalPhones: v.array(v.string()) }),
  ),
  routingDirectory: v.object({
    enabled: v.boolean(),
    entries: v.array(v.object({ label: v.string(), phone: v.string(), hours: v.optional(v.string()) })),
  }),
  leasing: v.object({
    tourMinutes: v.number(),
    bufferMinutes: v.number(),
    slotStepMinutes: v.number(),
    minLeadMinutes: v.number(),
    captureOnly: v.boolean(),
  }),
});

export type SarahConfig = Infer<typeof sarahConfigValidator>;
export type EmergencyScript = SarahConfig["emergencyScripts"][number];

// --- Defaults (the current hard-coded behaviour) ---------------------------------------------

export const DEFAULT_COMPANY_NAME = "518 Property Pro";
export const DEFAULT_FIRST_MESSAGE = `Thanks for calling ${DEFAULT_COMPANY_NAME}, this is Sarah! Are you calling about renting an apartment, a maintenance issue, or something else?`;

export function defaultConfig(): SarahConfig {
  return {
    identity: { companyName: DEFAULT_COMPANY_NAME, firstMessage: DEFAULT_FIRST_MESSAGE },
    callTypes: CALL_TYPES.map((c) => ({ key: c.key, enabled: c.defaultOn })),
    maintenanceQuestions: {
      basic: [
        "their name",
        "the property address and unit number",
        "what the issue is",
        "when they first noticed it",
        "whether they have pets, what type, and how many",
        "a convenient time for a technician to come by",
      ],
      electrical: [
        "whether they have checked the breaker or the GFI outlet (only when it is safe and there is no sparking, burning smell or smoke)",
      ],
      water_leak: [
        "which floor they are on",
        "exactly where in the unit the water is coming from",
        "whether there is a unit above them and whether theirs is the top floor",
        "whether the unit above has a bathroom or kitchen over the leak",
        "whether the water is actively flowing right now",
        "to put a bucket under it, and whether they have one",
        "for a photo or video, if they can",
      ],
      broken_item: ["what is broken", "where it is", "how long it has been broken", "for a photo, if they can"],
    },
    tenantResponsibility: {
      items: ["light bulbs", "blinds", "taking trash to the curb"],
      wording:
        "Those are the tenant's responsibility, so the team doesn't send someone for them, but I'll make a note of your call.",
      approved: false,
    },
    severityLevels: [
      {
        level: "emergency",
        definition:
          "Fire, gas smell, flooding, sewage backup, no heat in freezing weather, a break-in; anything with a safety or medical dimension.",
        examples: "Fire, gas smell, flooding, sewage backup, no heat in freezing weather, a break-in",
        responseTarget: "Immediately",
      },
      {
        level: "urgent",
        definition:
          "Unlivable within a day: no hot water, no power, no A/C in heat, dead fridge, lockout, broken exterior door or lock.",
        examples: "No hot water, no power, no A/C in heat, dead fridge, lockout",
        responseTarget: "Same day",
      },
      {
        level: "routine",
        definition:
          "Needs a repair or is minor and schedulable, and the unit is livable: contained leak, broken appliance, pests, dripping faucet, squeaky door, a chirping low-battery alarm.",
        examples: "Contained leak, broken appliance, pests, dripping faucet",
        responseTarget: "Within a few business days",
      },
      {
        level: "informational",
        definition: "No repair needed: billing question, lease copy, a package, a general question.",
        examples: "Billing question, lease copy, a package",
        responseTarget: "Staff follow up when convenient",
      },
    ],
    emergencyScripts: [
      {
        incident: "fire",
        wording: "Leave the building right now and call 911 from outside.",
        phone: "911",
      },
      {
        incident: "flooding",
        wording: "Move to a safe place away from the water, and call 518-365-0996.",
        phone: "518-365-0996",
      },
      {
        incident: "gas_hissing",
        wording:
          "Leave immediately and call 911 from outside. If you can do it safely from outside, warn your neighbors.",
        phone: "911",
      },
      {
        incident: "gas_slight",
        wording: "Leave immediately and contact your gas utility provider from outside.",
      },
      {
        incident: "other",
        wording: "Get somewhere safe and call 911.",
        phone: "911",
      },
    ],
    escalationContacts: SEVERITY_LEVELS.map((level) => ({ level, userIds: [], externalPhones: [] })),
    routingDirectory: {
      enabled: false,
      entries: ["Pat Fiore", "Alex Buell", "Nikki", "Nina", "Delia (Accounting)", "Alyssa"].map((label) => ({
        label,
        phone: "",
      })),
    },
    leasing: {
      tourMinutes: 45,
      bufferMinutes: 15,
      slotStepMinutes: 30,
      minLeadMinutes: 120,
      captureOnly: true,
    },
  };
}

/** Keeps a config loaded from the database complete if a call type or script was added later. */
export function normalizeConfig(c: SarahConfig): SarahConfig {
  const d = defaultConfig();
  return {
    ...c,
    callTypes: d.callTypes.map((t) => c.callTypes.find((x) => x.key === t.key) ?? t),
    severityLevels: d.severityLevels.map((s) => c.severityLevels.find((x) => x.level === s.level) ?? s),
    emergencyScripts: d.emergencyScripts.map((s) => c.emergencyScripts.find((x) => x.incident === s.incident) ?? s),
    escalationContacts: d.escalationContacts.map((e) => c.escalationContacts.find((x) => x.level === e.level) ?? e),
  };
}

// --- Validation ------------------------------------------------------------------------------

const MAX_TEXT = 2000;
const MAX_LIST = 30;

/** 911, or an E.164 number, or a North American number with the usual punctuation. */
export function isValidPhone(p: string): boolean {
  const s = p.trim();
  if (s === "911") return true;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return true;
  const digits = s.replace(/\D/g, "");
  return /^[\d\s().+-]+$/.test(s) && (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")));
}

/**
 * Shape and limit checks that the validator cannot express. Throws a message fit for a person.
 * Does NOT check approvals: those depend on stored state, see sarahConfig.saveDraft.
 */
export function validateConfigShape(c: SarahConfig): void {
  const text = (s: string, what: string, max = MAX_TEXT) => {
    if (s.length > max) throw new Error(`${what} is too long.`);
  };
  text(c.identity.companyName, "Company name", 100);
  if (!c.identity.companyName.trim()) throw new Error("Company name cannot be empty.");
  text(c.identity.firstMessage, "First message");
  if (!c.identity.firstMessage.trim()) throw new Error("First message cannot be empty.");

  const seen = new Set<string>();
  for (const t of c.callTypes) {
    if (!CALL_TYPE_KEYS.includes(t.key)) throw new Error("Unknown call type.");
    if (seen.has(t.key)) throw new Error("Each call type can only appear once.");
    seen.add(t.key);
    text(t.notes ?? "", "Call type notes");
  }

  for (const list of Object.values(c.maintenanceQuestions)) {
    if (list.length > MAX_LIST) throw new Error("Too many questions in one list.");
    for (const q of list) {
      text(q, "A question", 400);
      if (!q.trim()) throw new Error("Questions cannot be empty.");
    }
  }
  if (c.tenantResponsibility.items.length > MAX_LIST) throw new Error("Too many tenant-responsibility items.");
  for (const i of c.tenantResponsibility.items) text(i, "A tenant-responsibility item", 200);
  text(c.tenantResponsibility.wording, "Tenant-responsibility wording");

  const levels = new Set<string>();
  for (const s of c.severityLevels) {
    if (levels.has(s.level)) throw new Error("Each severity level can only appear once.");
    levels.add(s.level);
    text(s.definition, "A severity definition");
    text(s.examples, "Severity examples");
    text(s.responseTarget, "A response target", 200);
  }

  const incidents = new Set<string>();
  for (const s of c.emergencyScripts) {
    if (incidents.has(s.incident)) throw new Error("Each incident can only have one script.");
    incidents.add(s.incident);
    text(s.wording, "An emergency script");
    if (s.phone !== undefined && s.phone.trim() !== "" && !isValidPhone(s.phone)) {
      throw new Error(`"${s.phone}" is not a valid phone number. Use 911 or a full number like 518-365-0996.`);
    }
  }

  for (const e of c.escalationContacts) {
    if (e.userIds.length > 20 || e.externalPhones.length > 10) throw new Error("Too many escalation contacts.");
    for (const p of e.externalPhones) {
      if (!isValidPhone(p) || p.trim() === "911") throw new Error(`"${p}" is not a valid phone number.`);
    }
  }

  if (c.routingDirectory.entries.length > 40) throw new Error("Too many routing entries.");
  for (const e of c.routingDirectory.entries) {
    text(e.label, "A routing label", 100);
    text(e.hours ?? "", "Routing hours", 200);
    if (e.phone.trim() !== "" && !isValidPhone(e.phone)) throw new Error(`"${e.phone}" is not a valid phone number.`);
  }
  if (c.routingDirectory.enabled && c.routingDirectory.entries.some((e) => e.phone.trim() === "")) {
    throw new Error("The routing directory cannot be enabled while any entry has no phone number.");
  }

  const l = c.leasing;
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!inRange(l.tourMinutes, 15, 240)) throw new Error("Tour length must be 15 to 240 minutes.");
  if (!inRange(l.bufferMinutes, 0, 120)) throw new Error("Buffer must be 0 to 120 minutes.");
  if (![15, 20, 30, 60].includes(l.slotStepMinutes)) throw new Error("Slot step must be 15, 20, 30 or 60 minutes.");
  if (!inRange(l.minLeadMinutes, 0, 7 * 24 * 60)) throw new Error("Minimum lead time is out of range.");
}

// --- Prompt composition ----------------------------------------------------------------------

function enabled(c: SarahConfig, key: CallTypeKey): boolean {
  return c.callTypes.find((t) => t.key === key)?.enabled === true;
}

/** Whether a call type is switched on AND (where required) signed off. */
function live(c: SarahConfig, key: CallTypeKey): boolean {
  const t = c.callTypes.find((x) => x.key === key);
  if (!t?.enabled) return false;
  if (APPROVAL_REQUIRED.includes(key) && !t.approvedBy) return false;
  return true;
}

const bullets = (items: string[]) => items.filter((i) => i.trim()).map((i) => `- ${i.trim()}`).join("\n");

function scriptFor(c: SarahConfig, incident: EmergencyScript["incident"]): string {
  const s = c.emergencyScripts.find((x) => x.incident === incident);
  const approved = live(c, "emergency") && !!s?.approvedBy && s.wording.trim() !== "";
  if (!approved) {
    // The safest generic line. Never a phone number from memory.
    return "tell them to leave the building right now and call 911 from outside. (This incident's script is not approved yet: say only this, give no other number, and make sure escalate is called.)";
  }
  const phone = s!.phone?.trim();
  return `say this, word for word: "${s!.wording.trim()}"${
    phone ? ` The only number you may give is ${phone}; never give any other number.` : " Give no phone number."
  }`;
}

/** The life-safety section. Mirrors LIFE_SAFETY_BLOCK's ordering rules; only the scripts come from config. */
export function composeLifeSafety(c: SarahConfig): string {
  return `LIFE-SAFETY EMERGENCIES:
This section comes before every other instruction here, including the resident questions below.
It applies from the moment you hear it — whether or not you know yet that they rent here, and
whether or not you have their name.

Treat it as an emergency if they describe a fire or smoke, a gas smell, flooding, a break-in or
someone in the building, a medical problem, or anything else where a person could be hurt right
now. If you are unsure whether something qualifies, treat it as an emergency.

Do these in order:
1. Say the short safety script for what they described, before any question. Nothing comes before
   this line. Read phone numbers only from the scripts below, never from memory.
   - Fire or smoke: ${scriptFor(c, "fire")}
   - Flooding: ${scriptFor(c, "flooding")}
   - Gas smell: tell them to leave immediately. Then ask once, "Do you hear a hissing sound?"
     - Hissing: ${scriptFor(c, "gas_hissing")}
     - A slight smell with no hissing: ${scriptFor(c, "gas_slight")}${
       c.emergencyScripts.find((s) => s.incident === "gas_slight")?.phone?.trim() &&
       live(c, "emergency") &&
       c.emergencyScripts.find((s) => s.incident === "gas_slight")?.approvedBy
         ? ""
         : " Do not give any phone number for the utility; you do not have it, so never make one up."
     }
   - Anything else where someone could be hurt (a break-in, someone in the building, a medical
     problem): ${scriptFor(c, "other")}
2. Call log_maintenance_request immediately, with severity emergency and issue_type fire,
   flooding or gas (or other for anything else), and one sentence on what they told you. Do this
   even when you have no name, no address, no unit and no number — the rule about getting those
   first does NOT apply to an emergency. Never delay this to ask a question first.
3. Ask once, plainly, for their name, their address and unit, and the best number to reach them on.
4. Call escalate with reason 'urgent_tenant_issue' and what they told you in step 3.
5. Call log_maintenance_request again with the full details, so the record has their name and unit.
6. Tell them it is logged for the team.

Never say anyone has been alerted, paged or dispatched — say only that it is logged for the team.

Never keep them on the phone. Once they are safe and it is logged, close the call: being free to
talk to emergency services matters more than anything you still need. If they stop responding,
say one short line telling them to call 911 and to call us back when they are safe, then end the
call with end_call. Never ask "are you still there?" twice.

Never troubleshoot, never ask them to check or do anything in the unit, and never tell them to go
back inside for any reason.`;
}

function severityText(c: SarahConfig): string {
  return c.severityLevels
    .map((s) => `  ${s.level} — ${s.definition.trim()}${s.examples.trim() ? ` Examples: ${s.examples.trim()}.` : ""}`)
    .join("\n");
}

/** The resident-calls section, built from the enabled call types, question lists and severity levels. */
export function composeResidentCalls(c: SarahConfig): string {
  const mq = c.maintenanceQuestions;
  const maintOn =
    live(c, "maint_general") ||
    live(c, "maint_electrical") ||
    live(c, "maint_water_leak") ||
    live(c, "maint_broken_item") ||
    live(c, "maint_tenant_responsibility");

  const intro = `RESIDENT CALLS:
This section supersedes any earlier instruction to escalate resident issues directly.

Once you know you're talking to a current resident, don't run the leasing questions. First call
lookup_caller. If it returns a match, CONFIRM it, never assume it: ask "Am I speaking with
[first_name], in unit [unit_label]?" and wait for a yes. If they say no, or there is no match,
say nothing about the match and ask for their name, address and unit instead. Never read out
anything about a resident beyond the first name and unit that lookup_caller returned, and never
confirm or deny who lives in any unit. If they give you an address and unit, you may call
find_unit to check it; it only tells you whether it matched.`;

  let maint = "";
  if (maintOn) {
    const kinds: string[] = [];
    if (live(c, "maint_electrical")) {
      kinds.push(
        `- Electrical (no power, outlets, switches): ask about these only when it is safe and there is no sparking, burning smell, smoke or anything else dangerous; if there is, treat it as an emergency instead (see LIFE-SAFETY EMERGENCIES). Do not tell them how to do any of it or to do anything else with the electrical.\n${bullets(mq.electrical).replace(/^/gm, "  ")}`,
      );
    }
    if (live(c, "maint_water_leak")) {
      kinds.push(
        `- Water leak: ask about each of these. If it is a top-floor unit and the weather is bad, a roof leak may have to wait for the weather: tell them that honestly and that the team will follow up. Do not promise a repair time.\n${bullets(mq.water_leak).replace(/^/gm, "  ")}`,
      );
    }
    if (live(c, "maint_broken_item")) {
      kinds.push(`- Broken item: ask\n${bullets(mq.broken_item).replace(/^/gm, "  ")}`);
    }
    maint = `

MAINTENANCE ISSUES — something is broken, leaking, not working or unsafe:
Ask these basic questions, one or two at a time, in a natural order. Skip any you already have.
${bullets(mq.basic)}
Also ask for the best number to reach them on, even if they are calling from a phone: read it
back digit by digit, then pass it as callback_phone. If they say to use the number they are
calling from, leave callback_phone out.
${
  kinds.length
    ? `
Then ask the questions for the kind of issue. Put each answer in the answers argument as a short
key and a short value, for example {"breaker_checked": "yes, still no power"}.
${kinds.join("\n")}
Those are the only things you ask them to do. Never suggest a fix, never guess at a cause, and
never diagnose. Don't make any promise beyond what is written here.`
    : `
Never suggest a fix, never guess at a cause, and never diagnose. Don't make any promise beyond
what is written here.`
}`;

    // Tenant-responsibility: the approved wording only. Otherwise log it and hand to staff.
    const tr = c.tenantResponsibility;
    const items = tr.items.filter((i) => i.trim()).join(", ");
    if (live(c, "maint_tenant_responsibility") && tr.approved && tr.wording.trim()) {
      maint += `

Tenant-responsibility items — ${items || "light bulbs, blinds and the like"}:
Say this, in these words or very close to them, and add nothing to it and offer no exceptions:
"${tr.wording.trim()}"
Then log it with issue_type tenant_responsibility and severity informational.`;
    } else {
      maint += `

Tenant-responsibility items — ${items || "light bulbs, blinds and the like"}:
Do not say whose responsibility it is and do not promise anything. Say the team will follow up,
then log it with issue_type tenant_responsibility and severity informational.`;
    }

    maint += `

Once you have the basics and the questions for the issue, call log_maintenance_request, with
conversation_id and:
- issue_type: electrical, water_leak, broken_item, gas, fire, flooding, tenant_responsibility
  or other
- description: one or two plain sentences, in their words
- severity: one of these four levels
${severityText(c)}
- optionally severity_reason, caller_name, spoken_address, spoken_unit, first_noticed, pets,
  preferred_access_times, callback_phone and answers.
Score the issue, never the caller. A calm person with no heat is urgent or worse; someone
furious about a parking space is still routine. If two things are wrong, score the worse one.
If you're between two levels, take the lower one. Never say the level out loud — it's for
staff, not the caller.

Never pass "unknown" or a made-up value to satisfy the tool — leave a field out instead. It is
safe to call log_maintenance_request more than once in the same call: a second call updates
the same request. If you find something out after you have logged it, call it again with the
full details. Never tell the caller you have recorded something unless you have actually called
log_maintenance_request. After it succeeds, tell them the request is logged and the team will
follow up, then close the call. Only escalate an emergency or urgent issue, using escalate
after logging it; routine requests are logged and the call closed.`;
  } else {
    maint = `

MAINTENANCE ISSUES: maintenance requests are not enabled. Get their name, unit and callback
number, say the team will follow up, and call log_tenant_issue with call_type other.`;
  }

  // Other resident calls: only enabled types are handled; everything else is logged for staff.
  const handled = (Object.keys(TENANT_CALL_TYPE) as CallTypeKey[]).filter((k) => live(c, k));
  const names = handled.map((k) => TENANT_CALL_TYPE[k]!);
  const other = `

OTHER RESIDENT CALLS — anything that is not a maintenance issue:
Get their name, unit and best callback number, and one plain sentence on why they called. Say
you'll pass it to the team, and call log_tenant_issue with call_type set to ${
    names.length ? `${names.join(", ")} or other` : "other"
  }. ${
    names.length === 0
      ? "Use call_type other for every non-maintenance call. "
      : "Use call_type other for any topic not in that list. "
  }Use a severity from 1 to 10 where 1-2 is informational and 3-6 is routine. Do not discuss
lease terms, fees, balances, deadlines or legal matters, never give legal advice, and never
promise a payment plan or a deposit outcome. Never say what the status of anything is unless a
tool just told you.`;

  const routing =
    live(c, "owner_routing") && c.routingDirectory.enabled
      ? `

OWNER CALL ROUTING:
If an owner asks for a particular person or department, give only the number listed for them
here, and only the hours listed. Never give a number that is not in this list.
${c.routingDirectory.entries
  .filter((e) => e.phone.trim())
  .map((e) => `- ${e.label}: ${e.phone.trim()}${e.hours?.trim() ? ` (${e.hours.trim()})` : ""}`)
  .join("\n")}`
      : "";

  return `${intro}${maint}${other}${routing}`;
}

/** Short statement of which call flows are on. Anything not listed must be handed to staff. */
export function composeCallTypes(c: SarahConfig): string {
  const on = CALL_TYPES.filter((t) => live(c, t.key)).map((t) => `- ${t.label}`);
  const off = CALL_TYPES.filter((t) => !live(c, t.key)).map((t) => t.label);
  return `CALL TYPES YOU HANDLE:
${on.join("\n") || "- none"}
Anything outside these (${off.join("; ") || "none"}) you do not discuss: take their name, unit and
callback number, say someone will follow up, and log it.`;
}

/** Leasing settings that belong in the prompt. Tour length and buffer are enforced in code, not here. */
export function composeLeasing(c: SarahConfig): string {
  return c.leasing.captureOnly
    ? `LEASING MODE: CAPTURE ONLY. Record every answer. Never tell a caller they qualify or do not
qualify, and never turn anyone away. The team reviews every inquiry.`
    : "";
}

/**
 * The whole Sarah-config contribution: what replaces the hard-coded LIFE_SAFETY_BLOCK and
 * RESIDENT_TRIAGE_BLOCK, plus the call-type list and leasing mode.
 */
export function composeSarahSections(c: SarahConfig): { lifeSafety: string; resident: string; extra: string } {
  return {
    lifeSafety: composeLifeSafety(c),
    resident: composeResidentCalls(c),
    extra: [composeCallTypes(c), composeLeasing(c)].filter(Boolean).join("\n\n"),
  };
}

export function severityOf(level: string): SeverityLevel | null {
  return (SEVERITY_LEVELS as readonly string[]).includes(level) ? (level as SeverityLevel) : null;
}

export function isApprovalRequired(key: string): boolean {
  return (APPROVAL_REQUIRED as readonly string[]).includes(key);
}

export { enabled as isCallTypeEnabled };
