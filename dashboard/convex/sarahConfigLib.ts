import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { SEVERITY_LEVELS } from "./severity";
import type { SeverityLevel } from "./severity";
import {
  composeFlowSection,
  defaultQuestionFlows,
  normalizeQuestionFlows,
  questionFlowsValidator,
  validateQuestionFlows,
} from "./questionFlowLib";
import type { QuestionFlows } from "./questionFlowLib";
import { composeOwnerRoutingBlock, menuOf, routingProblems, routingWarnings } from "./ownerRoutingLib";
import type { MenuEntry, RoutingCheckOptions } from "./ownerRoutingLib";

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
export const APPROVAL_REQUIRED: readonly CallTypeKey[] = ["emergency", "owner_routing"];

/**
 * Call types that are driven by Pat-approved wording (Sarah Config sections 5-12 and the neighbor
 * dispute rule). Each can only be live while its wording is approved; editing the wording clears
 * the approval (and switches the type off). Seeded from the Sarah Configuration document.
 */
export const FLOW_KEYS = [
  "rent_fees",
  "portal_login",
  "application",
  "eviction",
  "non_renewal",
  "work_order_status",
  "renewal",
  "vendor_payment",
  "neighbor_dispute",
] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
export function isFlowKey(key: string): key is FlowKey {
  return (FLOW_KEYS as readonly string[]).includes(key);
}

// --- Validators ----------------------------------------------------------------------------

const approvalFields = {
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
};

export const levelValidator = v.union(
  v.literal("emergency"),
  v.literal("urgent"),
  v.literal("routine"),
  v.literal("informational"),
);

/** Texts Sarah's team sends to a tenant. Each needs Pat's approval before any SMS goes out. */
export const TENANT_MESSAGE_KEYS = ["photoRequest", "outOfScope", "received"] as const;
export type TenantMessageKey = (typeof TENANT_MESSAGE_KEYS)[number];

const tenantMessageValidator = v.object({
  wording: v.string(),
  approved: v.boolean(),
  ...approvalFields,
});

const flowValidator = v.object({
  key: v.string(),
  wording: v.string(),
  approved: v.boolean(),
  ...approvalFields,
});

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
    // In key order: the first entry is key 1. `phone` is E.164 once saved ("" = no number yet).
    // `hours` uses the format in ownerRoutingLib.ts ("Mon-Fri 09:00-17:00", America/New_York; empty =
    // any time). `extension` is dialled after the transfer connects. `userId` is the team member whose
    // callback list gets the message when this person cannot be reached. All optional so older
    // stored configs stay valid.
    entries: v.array(
      v.object({
        label: v.string(),
        phone: v.string(),
        hours: v.optional(v.string()),
        extension: v.optional(v.string()),
        userId: v.optional(v.id("users")),
      }),
    ),
    // What happens when nobody answers, and what callers get after hours. Both optional so older
    // stored configs stay valid. Only used on a live call once the owner routing menu is approved.
    fallback: v.optional(v.string()),
    afterHours: v.optional(v.string()),
    // The client's main office number, which their carrier forwards to Sarah's line. Never a
    // transfer target: a transfer there would loop back to Sarah.
    mainOfficeNumber: v.optional(v.string()),
  }),
  leasing: v.object({
    tourMinutes: v.number(),
    bufferMinutes: v.number(),
    slotStepMinutes: v.number(),
    minLeadMinutes: v.number(),
    captureOnly: v.boolean(),
  }),
  // Optional so configs stored before tenant messages existed stay valid; normalizeConfig fills
  // the draft defaults on read.
  tenantMessages: v.optional(
    v.object({
      photoRequest: tenantMessageValidator,
      outOfScope: tenantMessageValidator,
      received: tenantMessageValidator,
    }),
  ),
  // Approved wording for the config-driven call types (rent, portal, apply, eviction, ...).
  // Optional so configs stored before this existed stay valid; normalizeConfig fills the defaults.
  flows: v.optional(v.array(flowValidator)),
  // What Sarah does when information is missing or a system lookup fails (Sarah Config section 14).
  behavior: v.optional(v.object({ missingInfo: v.string(), lookupFailure: v.string() })),
  // The ordered, conditional question flows per call type (see questionFlowLib.ts). Optional so
  // configs stored before they existed stay valid: normalizeConfig seeds them (or converts the old
  // plain-text maintenanceQuestions lists, which stay in the stored blob but are no longer read
  // once questionFlows exists). The flow is draft content until Publish; it has no approval stamp.
  questionFlows: v.optional(questionFlowsValidator),
});

export type SarahConfig = Infer<typeof sarahConfigValidator>;
export type TenantMessage = Infer<typeof tenantMessageValidator>;
export type TenantMessages = Record<TenantMessageKey, TenantMessage>;
export type EmergencyScript = SarahConfig["emergencyScripts"][number];
export type FlowConfig = Infer<typeof flowValidator>;

// --- Defaults (the current hard-coded behaviour) ---------------------------------------------

export const DEFAULT_COMPANY_NAME = "518 Property Pro";
export const DEFAULT_FIRST_MESSAGE = `Thanks for calling ${DEFAULT_COMPANY_NAME}, this is Sarah! Are you calling about renting an apartment, a maintenance issue, as a property owner, or something else?`;

/** Draft wording only: nothing is ever texted to a tenant until Pat approves it. */
export function defaultTenantMessages(): TenantMessages {
  return {
    photoRequest: {
      wording:
        "Hi, this is 518 Property Pro. To help us with your repair request, please upload a photo or short video of the issue here:",
      approved: false,
    },
    outOfScope: {
      wording:
        "Hi, this is 518 Property Pro. We reviewed your request and it isn't something our maintenance team can send someone for. Please call us if you have questions.",
      approved: false,
    },
    received: {
      wording: "Hi, this is 518 Property Pro. We received your maintenance request and the team will follow up.",
      approved: false,
    },
  };
}


const PAYMENT_METHODS =
  "mail or bring a check to the office, mail or bring a certified check to the office, bring cash to the office, call the office with a debit or credit card, or pay online with a debit or credit card";

/** Payment methods as short spoken sentences, one idea each (Sarah Config section 5). */
const PAYMENT_SENTENCES =
  "You can mail or bring a check to the office. You can mail or bring a certified check to the office. You can bring cash to the office. You can call the office to pay with a debit or credit card. You can also pay online with a debit or credit card.";

/** Placeholder in the slight-gas script. Never spoken as text: see spokenWording. */
export const UTILITY_PLACEHOLDER = "{UTILITY_PHONE_FOR_PROPERTY}";

/** Removes the placeholder, so a missing per-property number never reaches a caller. */
export function spokenWording(w: string): string {
  return w.split(UTILITY_PLACEHOLDER).join("").replace(/[ \t]{2,}/g, " ").replace(/ +([.,])/g, "$1").trim();
}

/**
 * Drafts proposed by Simplr. They are only DRAFTS: nothing here reaches a caller until Pat approves
 * it. The only phone numbers allowed in any draft are 911 and 518-365-0996 (flooding, from the
 * Sarah Configuration document).
 */
export const SCRIPT_DRAFTS: Record<"fire" | "flooding" | "gas_hissing" | "gas_slight" | "other", { wording: string; phone?: string }> = {
  fire: {
    wording:
      "If there is a fire or smoke, leave the building right now and call 911. Once you are safe, tell me your name and the address so we can alert the team.",
    phone: "911",
  },
  flooding: {
    wording:
      "Please move to a safe place away from the water right now. Then call 518-365-0996 straight away. Once you are safe, tell me your name, address and unit so I can alert the team.",
    phone: "518-365-0996",
  },
  gas_hissing: {
    wording:
      "Leave the building immediately and call 911. If you can do it safely from outside, warn your neighbors. Once you are outside, tell me your name and the address.",
    phone: "911",
  },
  gas_slight: {
    wording: `Please leave the building now and contact your gas utility provider from outside. ${UTILITY_PLACEHOLDER} Tell me your name and the address so we can alert the team.`,
  },
  other: {
    wording:
      "If anyone is in danger, hang up and call 911 now. Once everyone is safe, tell me your name and address so we can alert the team.",
    phone: "911",
  },
};

export const TENANT_RESPONSIBILITY_DRAFT =
  "Under our current policy, expired lightbulbs, broken window blinds, and trash that needs to be taken to the curb are the tenant's responsibility. Property Pro does not replace these.";

/** Proposals for the two decisions that are not caller wording. Not spoken by Sarah. */
export const DECISION_DRAFTS = {
  "am-fallback":
    "If the assigned asset manager cannot be reached, the request stays with that asset manager and is flagged to Pat. Requests are never reassigned automatically. Alex and Pat decide the final rule.",
  "pilot-flows":
    "Proposed pilot scope: leasing inquiries, owner prospects and maintenance calls. Emergency scripts go live once Pat approves them. Rent, portal login, applying, eviction, non-renewal, work-order status, renewal, vendor payment and neighbor disputes stay off until each wording is approved.",
} as const;

/** Earlier built-in defaults. A draft that still equals one of these (and is not approved) is upgraded to the current draft. */
const LEGACY_WORDINGS: Record<string, string[]> = {
  "script-fire": [
    "Leave the building right now and call 911 from outside.",
    "If there is a fire or smoke, leave the building right now and call 911. Don't stop to collect anything. Once you are safe, tell me your name and the address so we can alert the team.",
  ],
  "script-flooding": ["Move to a safe place away from the water, and call 518-365-0996."],
  "script-gas_hissing": ["Leave immediately and call 911 from outside. If you can do it safely from outside, warn your neighbors."],
  "script-gas_slight": ["Leave immediately and contact your gas utility provider from outside."],
  "script-other": ["Get somewhere safe and call 911."],
  "tenant-responsibility": [
    "Property Pro doesn't replace expired light bulbs or broken window blinds, and doesn't take trash to the curb, so those are the tenant's responsibility. I'll make a note of your call.",
    "Property Pro doesn't replace light bulbs or window blinds, and trash needs to be taken to the curb by the resident. I can't log this as a repair, but I've noted your call.",
  ],
  "flow-rent_fees": [
    `Rent is due on the 1st of each month. There is a five-day grace period, and a computer-generated late notice goes out on the 6th day. Rent that is not paid in full before the 6th day carries a $50 late fee. You can pay by any of these: ${PAYMENT_METHODS}.`,
  ],
  "flow-portal_login": [
    "I'm sorry you're having trouble getting into the portal. I'll take down the email address on your account and pass it to the office so they can get you back in.",
  ],
  "flow-application": [
    "To apply, go to 518propertypro.com and look for the yellow View tab at the top right corner. Double-click View to open the rental application, then complete it and submit it on the website.",
  ],
  "flow-eviction": [
    `That notice is about unpaid rent or late fees under your lease. You can pay the outstanding amount in any of these ways: ${PAYMENT_METHODS}. Or you can contact your asset manager right away to talk about a payment plan. Our current policy is that at least some payment is needed before a payment plan is set up. I can't give legal advice, and I can't promise a payment plan will be approved. If you expect to be late with rent, please contact your asset manager as soon as you can.`,
    `That notice is about unpaid rent or late fees under your lease. You can pay the amount owed. ${PAYMENT_SENTENCES} Or you can contact your asset manager right away to talk about a payment plan. Our current policy is that some payment is needed before a payment plan is set up. I can't give legal advice. I can't promise a payment plan will be approved. If you expect to be late with rent, please contact your asset manager as soon as you can.`,
  ],
  "flow-non_renewal": [
    "Thank you for letting us know. On move-out day, or within a day or two afterward, you'll meet your asset manager or another Property Pro employee. The team does a walkthrough and collects the keys, and then assesses whether any security deposit will be returned. I can't say what that outcome will be.",
  ],
  "flow-work_order_status": [
    "I can't see the live status of a work order from here, so I'll pass your question to the right team member and they'll get back to you.",
    "I can't see the live status of a work order from this call. I'll pass your question to the right team member. They will get back to you.",
    "Once I've confirmed your name, address and unit, I can tell you the recorded status of your request. If I can't confirm them, or I can't find it: I can't see the live status of a work order from this call. I'll pass your question to the right team member. They will get back to you.",
  ],
  "flow-renewal": [
    "The team will prepare a new lease for your review and email it to you. If you have questions or concerns about the lease, your asset manager can help. If you agree to the lease, sign it, date it and return it. A lease is only binding once it is signed by both you and a Property Pro Realty Group Inc. representative.",
  ],
  "flow-vendor_payment": ["Questions about payment status go to Delia in our accounting department."],
  "flow-neighbor_dispute": [
    "I'm sorry you're dealing with that. Property Pro can't step in on arguments or noise between neighbors. For those, please contact your local police non-emergency line, or 911 if anyone is in danger.",
  ],
};

/**
 * The seven-plus config-driven call types, seeded word for word from the Sarah Configuration
 * document. Every wording is a DRAFT until Pat approves it: nothing here reaches a caller before then.
 * `confirm` is what the document says Pat or engineering still has to confirm; it shows in the
 * "Missing from Pat" panel.
 */
export const FLOW_DEFS: ReadonlyArray<{
  key: FlowKey;
  label: string;
  section: string;
  wording: string;
  confirm: string;
}> = [
  {
    key: "rent_fees",
    label: "Rent due and late fees",
    section: "5",
    wording: `Rent is due on the 1st of each month. There is a five-day grace period. A computer-generated late notice goes out on the 6th day. If rent is not paid in full before the 6th day, there is a $50 late fee. ${PAYMENT_SENTENCES}`,
    confirm: "Pat to confirm the exact policy wording and the current payment instructions.",
  },
  {
    key: "portal_login",
    label: "Portal login problems",
    section: "6",
    wording:
      "I'm sorry you're having trouble getting into the portal. I'll take the email address on your account. I'll pass it to the office, and they will help you get back in. I can't reset your password from this call.",
    confirm:
      "Engineering to confirm whether a password-reset email can be triggered directly. Until then Sarah only collects the email and routes it to the office, and never says a reset was sent.",
  },
  {
    key: "application",
    label: "Applying for an apartment",
    section: "7",
    wording:
      "To apply, go to 518propertypro.com. Look for the yellow View tab in the top right corner. Double-click View to open the rental application. Then complete the application and submit it on the website.",
    confirm: "Pat to confirm these website instructions are still current.",
  },
  {
    key: "eviction",
    label: "Eviction notice or late rent (legal)",
    section: "8",
    wording: `That notice is about unpaid rent or late fees under your lease. You can pay the amount owed. ${PAYMENT_SENTENCES} Or you can contact your asset manager right away to talk about a payment plan. Our current policy requires at least some payment before a payment plan is entered into. I can't give legal advice. I can't promise a payment plan will be approved. If you expect to be late with rent, please contact your asset manager as soon as you can.`,
    confirm: "Pat must approve this wording before activation, because it concerns eviction and legal matters.",
  },
  {
    key: "non_renewal",
    label: "Lease non-renewal",
    section: "9",
    wording:
      "Thank you for letting us know. On move-out day, or a day or two after, you will meet your asset manager or another Property Pro employee. The team will do a walkthrough and collect the keys. The team will then assess whether any security deposit is returned. I can't say what that outcome will be.",
    confirm: "Pat to approve the wording.",
  },
  {
    key: "work_order_status",
    label: "Work-order status",
    section: "10",
    wording:
      "Once I've found your unit, I can tell you the recorded status of your request. If a technician visit is scheduled, your asset manager will confirm the exact time with you. If the lookup isn't working: I can't see the live status of a work order from this call. I'll pass your question to the right team member. They will get back to you.",
    confirm:
      "Pat to approve the wording. Live lookup is built (Sarah v13): an exact address and unit is enough for the recorded status. A caller verified against the unit (caller ID or a resident's name) also hears the visit day and time; the name never blocks anything.",
  },
  {
    key: "renewal",
    label: "Lease renewal",
    section: "11",
    wording:
      "The usual process is that the team prepares a new lease for your review and emails it to you. I can't confirm that a lease has been sent. If you have questions about the lease, your asset manager can help. If you agree to the lease, sign it, date it and return it. A lease is only binding once both you and a Property Pro Realty Group Inc. representative have signed it.",
    confirm:
      "Pat to confirm whether lease generation and emailing are part of the first release. Sarah never says a lease has been generated or sent.",
  },
  {
    key: "vendor_payment",
    label: "Vendor payment status",
    section: "12",
    wording:
      "Questions about payment status go to Delia in our accounting department. I can't check a payment status on this call. I can take your name, company and a callback number and pass your message to Delia.",
    confirm: "Pat to provide Delia's correct contact details (enter them in the Routing directory).",
  },
  {
    key: "neighbor_dispute",
    label: "Neighbor disputes",
    section: "2",
    wording:
      "I'm sorry you're dealing with that. Arguments, loud or offensive behavior and similar neighbor disputes should be directed to your local law enforcement.",
    confirm: "Pat must approve the exact response before it is activated.",
  },
];

export function defaultFlows(): FlowConfig[] {
  return FLOW_DEFS.map((f) => ({ key: f.key, wording: f.wording, approved: false }));
}

export function defaultBehavior(): { missingInfo: string; lookupFailure: string } {
  return {
    missingInfo:
      "If the caller cannot or will not give something, do not push and never guess. Log what you have, say the team will follow up, and move on.",
    lookupFailure:
      "If a lookup or tool fails or finds nothing, do not guess and do not invent an answer. Say you will pass it to the team, log what you have, and keep the call short.",
  };
}

export function flowOf(c: SarahConfig, key: FlowKey): FlowConfig {
  return (c.flows ?? []).find((f) => f.key === key) ?? defaultFlows().find((f) => f.key === key)!;
}

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
      items: ["expired lightbulbs", "broken window blinds", "trash that needs to be taken to the curb"],
      wording: TENANT_RESPONSIBILITY_DRAFT,
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
    emergencyScripts: (["fire", "flooding", "gas_hissing", "gas_slight", "other"] as const).map((incident) => ({
      incident,
      wording: SCRIPT_DRAFTS[incident].wording,
      ...(SCRIPT_DRAFTS[incident].phone ? { phone: SCRIPT_DRAFTS[incident].phone } : {}),
    })),
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
    tenantMessages: defaultTenantMessages(),
    flows: defaultFlows(),
    behavior: defaultBehavior(),
    questionFlows: defaultQuestionFlows(),
  };
}

/** Keeps a config loaded from the database complete if a call type or script was added later. */
export function normalizeConfig(c: SarahConfig): SarahConfig {
  const d = defaultConfig();
  const upgraded = (id: string, wording: string, approved: boolean, fresh: string): string =>
    !approved && LEGACY_WORDINGS[id]?.includes(wording) ? fresh : wording;
  return {
    ...c,
    callTypes: d.callTypes.map((t) => c.callTypes.find((x) => x.key === t.key) ?? t),
    severityLevels: d.severityLevels.map((s) => c.severityLevels.find((x) => x.level === s.level) ?? s),
    emergencyScripts: d.emergencyScripts.map((s) => {
      const x = c.emergencyScripts.find((y) => y.incident === s.incident);
      if (!x) return s;
      const wording = upgraded(`script-${s.incident}`, x.wording, !!x.approvedBy, s.wording);
      return wording === x.wording ? x : { ...x, wording };
    }),
    escalationContacts: d.escalationContacts.map((e) => c.escalationContacts.find((x) => x.level === e.level) ?? e),
    tenantMessages: { ...defaultTenantMessages(), ...(c.tenantMessages ?? {}) },
    flows: defaultFlows().map((f) => {
      const x = (c.flows ?? []).find((y) => y.key === f.key);
      if (!x) return f;
      const wording = upgraded(`flow-${f.key}`, x.wording, x.approved, f.wording);
      return wording === x.wording ? x : { ...x, wording };
    }),
    tenantResponsibility: {
      ...c.tenantResponsibility,
      wording: upgraded(
        "tenant-responsibility",
        c.tenantResponsibility.wording,
        c.tenantResponsibility.approved,
        d.tenantResponsibility.wording,
      ),
    },
    behavior: c.behavior ?? defaultBehavior(),
    questionFlows: normalizeQuestionFlows(c.questionFlows, c.maintenanceQuestions),
  };
}

/** The question flows of a config, seeded where missing. Pure; for the prompt composer and the editor. */
export function flowsOf(c: SarahConfig): QuestionFlows {
  return normalizeQuestionFlows(c.questionFlows, c.maintenanceQuestions);
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

/** A phone number as above, or a short internal extension like 101 or ext. 204. */
export function isValidPhoneOrExt(p: string): boolean {
  return isValidPhone(p) || /^(ext\.?\s*)?\d{2,6}$/i.test(p.trim());
}

/** Control characters removed (newlines and tabs kept), CRLF normalised, then trimmed. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, "")
    .trim();
}

/**
 * Shape and limit checks that the validator cannot express. Throws a message fit for a person.
 * Does NOT check approvals: those depend on stored state, see sarahConfig.saveDraft.
 */
export function validateConfigShape(c: SarahConfig, opts: RoutingCheckOptions = {}): void {
  const text = (s: string, what: string, max = MAX_TEXT) => {
    if (s.length > max) throw new ConvexError(`${what} is too long.`);
  };
  text(c.identity.companyName, "Company name", 100);
  if (!c.identity.companyName.trim()) throw new ConvexError("Company name cannot be empty.");
  text(c.identity.firstMessage, "First message");
  if (!c.identity.firstMessage.trim()) throw new ConvexError("First message cannot be empty.");

  const seen = new Set<string>();
  for (const t of c.callTypes) {
    if (!CALL_TYPE_KEYS.includes(t.key)) throw new ConvexError("That call type is not recognized. Refresh the page and try again.");
    if (seen.has(t.key)) throw new ConvexError("Each call type can only appear once.");
    seen.add(t.key);
    text(t.notes ?? "", "Call type notes");
  }

  for (const list of Object.values(c.maintenanceQuestions)) {
    if (list.length > MAX_LIST) throw new ConvexError("Too many questions in one list.");
    for (const q of list) {
      text(q, "A question", 400);
      if (!q.trim()) throw new ConvexError("Questions cannot be empty.");
    }
  }
  if (c.tenantResponsibility.items.length > MAX_LIST) throw new ConvexError("Too many tenant-responsibility items.");
  for (const i of c.tenantResponsibility.items) text(i, "A tenant-responsibility item", 200);
  text(c.tenantResponsibility.wording, "Tenant-responsibility wording");

  const levels = new Set<string>();
  for (const s of c.severityLevels) {
    if (levels.has(s.level)) throw new ConvexError("Each severity level can only appear once.");
    levels.add(s.level);
    text(s.definition, "A severity definition");
    text(s.examples, "Severity examples");
    text(s.responseTarget, "A response target", 200);
  }

  const incidents = new Set<string>();
  for (const s of c.emergencyScripts) {
    if (incidents.has(s.incident)) throw new ConvexError("Each incident can only have one script.");
    incidents.add(s.incident);
    text(s.wording, "An emergency script");
    if (s.phone !== undefined && s.phone.trim() !== "" && !isValidPhone(s.phone)) {
      throw new ConvexError(`"${s.phone}" is not a valid phone number. Use 911 or a full number like 518-365-0996.`);
    }
  }

  for (const e of c.escalationContacts) {
    if (e.userIds.length > 20 || e.externalPhones.length > 10) throw new ConvexError("Too many escalation contacts.");
    for (const p of e.externalPhones) {
      if (!isValidPhone(p) || p.trim() === "911") throw new ConvexError(`"${p}" is not a valid phone number.`);
    }
  }

  // Owner call routing: one shared rule set (ownerRoutingLib.routingProblems), so the editor marks the
  // same field with the same message the server would throw. The first problem is reported.
  for (const e of c.routingDirectory.entries) text(e.hours ?? "", "Routing hours", 400);
  const routingProblem = routingProblems(c.routingDirectory, opts)[0];
  if (routingProblem) throw new ConvexError(routingProblem.message);

  for (const key of TENANT_MESSAGE_KEYS) {
    const m = c.tenantMessages?.[key];
    if (!m) continue;
    text(m.wording, "A tenant message", 320); // one SMS segment-ish; keeps the link and wording in range
  }

  const flowSeen = new Set<string>();
  for (const f of c.flows ?? []) {
    if (!isFlowKey(f.key)) throw new ConvexError("That call-type wording is not recognized. Refresh the page and try again.");
    if (flowSeen.has(f.key)) throw new ConvexError("Each call type can only have one wording.");
    flowSeen.add(f.key);
    text(f.wording, "Call-type wording");
  }
  validateQuestionFlows(c.questionFlows);
  if (c.behavior) {
    text(c.behavior.missingInfo, "Missing-information behavior");
    text(c.behavior.lookupFailure, "Lookup-failure behavior");
  }

  const l = c.leasing;
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!inRange(l.tourMinutes, 15, 240)) throw new ConvexError("Tour length must be 15 to 240 minutes.");
  if (!inRange(l.bufferMinutes, 0, 120)) throw new ConvexError("Buffer must be 0 to 120 minutes.");
  if (![15, 20, 30, 60].includes(l.slotStepMinutes)) throw new ConvexError("Slot step must be 15, 20, 30 or 60 minutes.");
  if (!inRange(l.minLeadMinutes, 0, 7 * 24 * 60)) throw new ConvexError("Minimum lead time is out of range.");
}

// --- Prompt composition ----------------------------------------------------------------------

function companyOf(c: SarahConfig): string {
  return c.identity.companyName.trim() || DEFAULT_COMPANY_NAME;
}

function enabled(c: SarahConfig, key: CallTypeKey): boolean {
  return c.callTypes.find((t) => t.key === key)?.enabled === true;
}

/** Whether a call type is switched on AND (where required) signed off. */
function live(c: SarahConfig, key: CallTypeKey): boolean {
  const t = c.callTypes.find((x) => x.key === key);
  if (!t?.enabled) return false;
  if (isFlowKey(key)) {
    const f = flowOf(c, key);
    return f.approved && !!f.approvedBy && f.wording.trim() !== "";
  }
  if (APPROVAL_REQUIRED.includes(key) && !t.approvedBy) return false;
  return true;
}

/** Exported for the policy document and the "Missing from Pat" panel. */
export function isCallTypeLive(c: SarahConfig, key: CallTypeKey): boolean {
  return live(c, key);
}

/**
 * The owner call menu while it is live: the owner_routing call type switched on AND approved, the
 * routing directory enabled, and at least one person with a dialable number. null otherwise, and
 * then Sarah gets no menu, no transfer tool and no keypad input. `blocked` numbers are never dialled.
 */
export function ownerRoutingMenu(c: SarahConfig, blocked: Array<string | null | undefined> = []): MenuEntry[] | null {
  if (!live(c, "owner_routing") || !c.routingDirectory.enabled) return null;
  const menu = menuOf(c.routingDirectory, blocked);
  return menu.some((m) => m.phone) ? menu : null;
}

/** Why the owner menu is or is not live in this config, for the /sarah editor. */
export function ownerRoutingStatus(c: SarahConfig): { live: boolean; reason: string } {
  const t = c.callTypes.find((x) => x.key === "owner_routing");
  if (!t?.enabled) return { live: false, reason: "The \"Owner call routing menu\" call type is switched off (Call types tab)." };
  if (!t.approvedBy) return { live: false, reason: "The owner call routing menu is not approved yet." };
  if (!c.routingDirectory.enabled) return { live: false, reason: "The routing directory is switched off." };
  const menu = ownerRoutingMenu(c);
  if (!menu) return { live: false, reason: "Nobody in the directory has a phone number yet." };
  const n = menu.filter((m) => m.phone).length;
  return { live: true, reason: `In this draft, existing owners can be put through to ${n} ${n === 1 ? "person" : "people"}.` };
}

export function approvedScript(c: SarahConfig, incident: EmergencyScript["incident"]): EmergencyScript | null {
  const s = c.emergencyScripts.find((x) => x.incident === incident);
  return live(c, "emergency") && !!s?.approvedBy && s.wording.trim() !== "" ? s : null;
}

function scriptFor(c: SarahConfig, incident: EmergencyScript["incident"]): string {
  const s = approvedScript(c, incident);
  if (!s) {
    // The only life-safety line that is always safe. Never a phone number from memory.
    return "tell them to leave the area right now and call 911. (This incident's script is not approved yet: say only this, give no other number, and make sure escalate is called.)";
  }
  const phone = s.phone?.trim();
  return `say this, word for word: "${spokenWording(s.wording)}"${
    phone ? ` The only number you may give is ${phone}; never give any other number.` : " Give no phone number."
  }`;
}

/** The life-safety section. Mirrors LIFE_SAFETY_BLOCK's ordering rules; only the scripts come from config. */
export function composeLifeSafety(c: SarahConfig): string {
  const slightApproved = !!approvedScript(c, "gas_slight")?.phone?.trim();
  return `LIFE-SAFETY EMERGENCIES:
This section comes before every other instruction here, including the resident questions below,
and it overrides the conversation-style rules about asking one question at a time and about
looking the caller up first. It applies from the moment you hear it, whether or not you know yet
that they rent here, and whether or not you have their name.

Treat it as an emergency if they describe a fire or smoke, a gas smell, flooding, a break-in or
someone in the building, a medical problem, or anything else where a person could be hurt right
now. If you are unsure whether something qualifies, treat it as an emergency.

Do these in order:
1. Say the short safety script for what they described, before any question. Nothing comes before
   this line. Read phone numbers only from the scripts below, never from memory, and never guess
   a number.
   - Fire or smoke: ${scriptFor(c, "fire")}
   - Flooding: ${scriptFor(c, "flooding")}
   - Gas smell: tell them to leave immediately. Then ask once, "Do you hear a hissing sound?"
     - Hissing: ${scriptFor(c, "gas_hissing")}
     - A slight smell with no hissing: ${scriptFor(c, "gas_slight")}${
       slightApproved ? "" : " Do not give any phone number for the utility; you do not have it, so never make one up."
     }
   - Anything else where someone could be hurt (a break-in, someone in the building, a medical
     problem): ${scriptFor(c, "other")}
2. Call log_maintenance_request immediately, with severity emergency and issue_type fire,
   flooding or gas (or other for anything else), and one sentence on what they told you. Do this
   even when you have no name, no address, no unit and no number. The rule about identifying the
   caller first does NOT apply to an emergency. Never delay this to ask a question first.
3. Ask once, plainly, for their name, their address and unit, and the best number to reach them on.
4. Call escalate with reason 'urgent_tenant_issue' and what they told you in step 3.
5. Call log_maintenance_request again with the full details, so the record has their name and unit.
   If they gave a number in step 3 and said yes when you read it back, also send it as confirmed_phone
   with confirmed_phone_yes true. Do not ask for a number a second time.
6. Tell them it is logged for the team.

Say the team has been alerted only when the tool result says team_alerted is true. Otherwise say only that it is logged and the team will follow up. Never say anyone has been paged or dispatched.

Never keep them on the phone. Once they are safe and it is logged, close the call: being free to
talk to emergency services matters more than anything you still need. Then end the call with
end_call. If they stop responding, say one short line telling them to call 911 and to call us back
when they are safe, then end the call with end_call. Never ask "are you still there?" twice.

For an emergency, never troubleshoot, never ask them to check or do anything in the unit, and
never tell them to go back inside for any reason. (The breaker question and the bucket
instruction below are for non-emergency calls only.)`;
}

/**
 * The one-question-at-a-time rules. They sit at the TOP of the composed prompt and again at the
 * END (see applySarahConfig), so no instruction between them can outweigh them. Every other piece
 * of pacing text in the prompt defers to these.
 */
export const HARD_RULES = `HARD RULES FOR EVERY TURN (they override any other line in these instructions that sounds different):
TURN RULE: A reply either calls a tool or speaks to the caller, never both. Tools run first, in
silence. After the last result, speak once, and if that ends in a question, stop and wait. A tool
result is never the caller's answer: if one arrives while your question is unanswered, call skip_turn
and say nothing. Only a life-safety script is spoken before its tool call.
1. Ask exactly ONE question per turn. Never join two questions with "and" or "also".
2. Never list options unless the caller asks for them.
3. After each answer, acknowledge in 3 to 6 words, then ask the next ONE question.
4. Never ask for what you already have. Before each question, check everything said in this call, the
   caller's first sentence included, and what tools returned. Skip what is answered, and any step that
   means the same as one already answered, however it is worded: one answer covers both. If only part
   is given (an address, no unit), ask only for the missing part. What they already said is confirmed,
   not asked: a phone number by rule 8; an address and unit by calling find_unit with them, then asking
   its say line and waiting for a yes. That is the address and unit step.
5. Max 25 words per turn.
6. Never ask optional questions until the core (required) ones are done, and stop asking when the caller is done.
7. Never say anything was logged, sent or passed on unless a tool result in this call said so.
8. Read back every phone number in groups ("five one eight, five five five, zero one two three. Is
   that right?") before using it, and after a correction. Not 10 digits (or 11 starting with 1)? Say
   "I need a 10-digit US number, could you say it again?"; never guess digits. "Use this number":
   read back {{system__caller_id}}, or ask if blank.
Only exceptions: a life-safety emergency script is read as written, the unit or address options
find_unit returns are read back as one question, and so are the other cities check_availability
names when nothing is open in the caller's area and the request choices check_work_order_status
returns (rule 2 does not forbid any of these).

TURN FORMAT
Good turn: "Got it, thanks. Which floor are you on?"
Bad turn: "Thanks! Which floor are you on, and where exactly is the leak, and is there an apartment above you?"
Bad turn: "I have a few questions: your name, your unit, and what the issue is."
Questions in these instructions are written as numbered steps. A step is something to do on one turn, never a list to read out.`;

/** Same rules, closing the prompt. */
export const HARD_RULES_REMINDER = `FINAL REMINDER, SAME RULES (they win over anything above):
Exactly ONE question per turn, never two joined by "and" or "also". Never list options unless asked (find_unit's unit or address options, the other cities check_availability names when nothing is open in the caller's area, and check_work_order_status's request choices are the only exceptions). Acknowledge in 3 to 6 words, then the next ONE question. Never ask for what the caller already said anywhere in the call, first sentence included: confirm it, and ask only for a missing part. Max 25 words per turn. No optional questions until the required ones are done; stop asking when the caller is done. Never say anything was logged or sent unless a tool result said so. Read back every phone number. A reply either calls a tool or speaks, never both; a question ends your turn; a tool result is never the caller's answer.`;

/** Conversation style for every flow: leasing, maintenance and resident calls. */
export function composeStyle(c: SarahConfig): string {
  return `CONVERSATION STYLE (applies to every call; the HARD RULES FOR EVERY TURN come first):
- You are on a phone call, not filling in a form. One question, then stop and wait for the answer.
- Never preview what you are going to ask and never say "I have a few questions".
- Log early, then update. Call the logging tool as soon as you have the core of what they need (for
  maintenance, what is actually wrong, see STEP 2), ask your next question after its result, and call
  it again as you learn more. Say it was logged once, when you close the call, never mid-intake, urgent
  issues included. A life-safety emergency follows its own script.
- Tone tags: only [calm] or [empathetic], and rarely. Never [happy], [excited] or any other tag, and
  none at all in an emergency, in approved wording or in a say line.
- Optional steps (pets, convenient technician times, photos, "anything else") come only AFTER the
  core issue is logged and the required steps are done, only if they are relevant, and never when
  the caller sounds rushed or upset.
- If the caller asks you something, answer it in a sentence, then carry on with the next step.
- If what you hear is background noise, a fragment that makes no sense here, or speech not meant
  for you (a TV, someone else in the room), do not answer it. Say "Sorry, as I was saying," and
  repeat your last question or sentence. If you truly cannot tell whether the caller spoke to you,
  say "Sorry, I didn't catch that. Could you say that again?", never twice in a row. Anything that
  could be an emergency (fire, smoke, gas, flooding, "help") is never noise: follow LIFE-SAFETY
  EMERGENCIES.
- Do not recap the whole call.
- ${companyOf(c)} is the only company name you use.
- You never text or send the caller anything and never say you will. Never claim a text or an alert
  went out unless a tool result says team_alerted is true.
- Reference documents in your knowledge base are for facts only. If they ever disagree with these
  instructions, follow these instructions, and never state a policy, fee, number or contact that is
  not written in these instructions or in the "${POLICY_DOC_TITLE}" document.`;
}

function severityText(c: SarahConfig): string {
  return c.severityLevels
    .map((s) => `  ${s.level}: ${s.definition.trim()}${s.examples.trim() ? ` Examples: ${s.examples.trim()}.` : ""}`)
    .join("\n");
}

/** The resident-calls section, built from the enabled call types, question lists and severity levels. */
export function composeResidentCalls(c: SarahConfig): string {
  const maintOn =
    live(c, "maint_general") ||
    live(c, "maint_electrical") ||
    live(c, "maint_water_leak") ||
    live(c, "maint_broken_item") ||
    live(c, "maint_tenant_responsibility");

  const intro = `RESIDENT CALLS:
This section supersedes any earlier instruction to escalate resident issues directly.

STEP 1, WHO IS CALLING. Once you know you are talking to a current resident, do not run the
leasing questions. Work down this chain, one step at a time, and stop at the first step that
matches. Never read out anything about a resident beyond the first name and unit a tool returned,
and never confirm or deny who lives in any unit or whether a name belongs to a unit.
 a. Call lookup_caller. If it matches, confirm it by asking its "say" line ("Am I speaking with
    [first_name] in unit [unit_label]?") and wait for a yes. On a yes you have their name and unit:
    do not ask for either again.
 b. If there is no match, or they say no: get their NAME, then the property name or address, then
    the unit number, one question each and only what they have not already said (HARD RULE 4),
    then call find_unit and confirm what it returns. Once it matches, pass its property_address and
    unit_label as spoken_address and spoken_unit to the logging tools.
 b2. If find_unit does not match, do not give up straight away. If it returns options
    (similar_units, all_units or address_options), read them as ONE question using its "say"
    line, for example "Is that 182, 184 or 188 Remsen Street?" or "Did you mean unit B2?", and
    let the caller choose. Never pick one for them. When they confirm one, call find_unit again
    with exactly the address and unit they confirmed: only matched true identifies the unit. If it
    returns no options, ask what its "say" line asks (repeat or spell the unit, or say the floor)
    and call find_unit once more. Never offer buildings or units the tool did not give you, never
    offer a list to a caller who has not named a building, and never say whether a unit is
    occupied or who lives there.
 c. If find_unit still does not match, or the caller says none of the options is theirs or is
    unsure: ask for a callback phone number (and an email if they
    offer one) ONLY so it can be recorded. Never use them to look anyone up. Call
    log_unmatched_caller with a one-sentence summary of what they needed, tell them an asset
    manager will call them back, and end the call politely with end_call. Make no promise about
    when, make no further lookups, and do not log a maintenance request for an unmatched caller.`;

  let maint = "";
  if (maintOn) {
    const flows = flowsOf(c);
    const kinds: string[] = [];
    if (live(c, "maint_electrical")) {
      kinds.push(
        composeFlowSection(
          "ELECTRICAL FLOW",
          "the issue is electrical (no power, outlets, switches). If there is sparking, a burning smell, smoke or anything dangerous it is an emergency instead, see LIFE-SAFETY EMERGENCIES",
          flows.maint_electrical,
        ) + "\nDo not tell them how to check it or to do anything else with the electrical.",
      );
    }
    if (live(c, "maint_water_leak")) {
      kinds.push(
        composeFlowSection(
          "WATER LEAK FLOW",
          "the issue is a non-emergency water leak (flooding or water pouring in is an emergency, see LIFE-SAFETY EMERGENCIES)",
          flows.maint_water_leak,
        ) + "\nPromise no repair time.",
      );
    }
    if (live(c, "maint_broken_item")) {
      kinds.push(
        composeFlowSection(
          "BROKEN ITEM FLOW",
          "the issue is a broken window, door, cabinet, ceiling tile or the like",
          flows.maint_broken_item,
        ) + "\nCollect enough for the team to decide which technician is needed.",
      );
    }
    maint = `

STEP 2, THE MAINTENANCE REQUEST (something is broken, leaking, not working or unsafe):
Once they are identified, ask the one question "What's going on?" (skip it if they already said what
is wrong) and listen. Decide the issue_type and the severity level from what they say.
Call log_maintenance_request only once the caller said yes to the unit in STEP 1 AND they have said what is actually
wrong ("the kitchen sink is leaking"). "A maintenance issue" or "a complaint" is not a description:
ask what's going on first. Then log it right away, with the issue, the severity and the unit
details (spoken_address, spoken_unit, caller_name). Do not wait for the rest.
After that, follow the flows below. Call log_maintenance_request again every time you learn
something worth recording.

${composeFlowSection("GENERAL INTAKE FLOW", "every maintenance call; steps already answered anywhere in the call are skipped", flows.maint_basic)}
Put the best callback number in callback_phone; if they say to use the number they are calling
from, leave callback_phone out.
${
  kinds.length
    ? `
Then the flow for the specific kind of issue. Run ONLY the flow that matches the issue. Put each
answer in the answers argument as a short key and a short value, for example
{"breaker_checked": "yes, still no power"}:

${kinds.join("\n\n")}

Some steps ask for the same fact, so one answer covers them all and you never ask the second: when
they first noticed it and how long it has lasted; what the issue is and what is broken; where it is,
if they already named the spot ("my front door knob", "under the sink"); an apartment above, if they
said top floor. Put that answer in each step's field.

These are the only things you ever ask them to do. Never suggest a fix, never guess at a cause, and
never diagnose. Make no promise beyond what is written here.`
    : `
Never suggest a fix, never guess at a cause, and never diagnose. Make no promise beyond what is
written here.`
}

Photos or video (optional, before STEP 3 and the close): only when a flow step asks for them, after
the issue is logged, and never in a life-safety emergency. If they say yes, call send_photo_link with
note set to what they said (including any limits, such as "photos only, no video"), then say its
"say" line word for word and in full, spelled letters included, even past 25 words. It either tells
them which email address to send the photos to, or says their asset manager will follow up about
photos. If they ask to hear the address again, say its "repeat_line" once, word for word. Never say
an email address that is not in that result, never guess or spell one yourself, and never change it.
You never text or send the caller anything and never say you will. Never promise a link, a text or a
time. If they say no, move on.

Questions that are not repairs (a lease question, a package, a parking question): once matched,
call log_maintenance_request with issue_type other, severity informational, severity_score 1, and
a description that begins "Question, not a repair:" followed by what they asked. The asset manager
reviews it. Do not call it a task, do not promise an answer or a time, and do not ask the repair
questions.`;

    const tr = c.tenantResponsibility;
    const items = tr.items.filter((i) => i.trim()).join(", ");
    if (live(c, "maint_tenant_responsibility") && tr.approved && tr.wording.trim()) {
      maint += `

Tenant-responsibility items (${items || "expired light bulbs, broken window blinds, trash to the curb"}):
Say this, in these words or very close to them, and add nothing to it and offer no exceptions:
"${tr.wording.trim()}"
Then log it with issue_type tenant_responsibility (it is closed as the tenant's responsibility).`;
    } else {
      maint += `

Tenant-responsibility items (${items || "expired light bulbs, broken window blinds, trash to the curb"}):
The wording for these is not approved yet. Do not say whose responsibility it is and do not
promise anything. Say a neutral line such as "Thanks, I'll make a note of that for the team," then
log it with issue_type tenant_responsibility.`;
    }

    maint += `

Classifying and logging (log_maintenance_request, with conversation_id and):
- issue_type: electrical, water_leak, broken_item, gas, fire, flooding, tenant_responsibility or other
- description: one or two plain sentences, in their words
- severity: one of these four levels
${severityText(c)}
- severity_score: a 1-10 score consistent with the level (emergency 9-10, urgent 7-8, routine 3-6,
  informational 1-2)
- optionally title, severity_reason, caller_name, caller_email, spoken_address, spoken_unit,
  first_noticed, pets, preferred_access_times, callback_phone, confirmed_phone and
  confirmed_phone_yes (STEP 3 only) and answers.
Score the issue, never the caller. A calm person with no heat is urgent or worse; someone furious
about a parking space is still routine. If two things are wrong, score the worse one. If you are
between two levels, take the lower one. Never say the level out loud.

Never pass "unknown" or a made-up value to satisfy a tool; leave the field out. It is safe to call
log_maintenance_request many times in one call: each call updates the same request and changes only
what you send. If it returns logged false, nothing was logged: do what its say and message tell you.

STEP 3, CONFIRM THE BEST NUMBER (every repair request that is not a life-safety emergency, after the
flow and optional steps above and before you close the call. Not for a tenant-responsibility item, a
question that is not a repair, or an unmatched caller. A life-safety emergency follows its own steps.)
1. If a number was already read back and the caller said yes to it earlier in this call, do not ask
   again: use that number in step 4.
2. Otherwise ask the one question "What's the best number for us to reach you about this request?"
   You may instead offer the number they are calling from once: "Is the number you're calling from the
   best one?" On a yes, or if they say to use it, read back {{system__caller_id}}; if that is blank, ask
   for the number. The number they are calling from still needs the read-back and their yes.
3. Read the whole number back in groups, digit by digit: "I have five one eight, five five five, one
   two three four. Is that right?" Then stop and wait.
   - If they correct any part, take the corrected number and read the whole number back again. Repeat
     until they clearly say yes. Only a clear yes counts: "I think so", a pause or silence is not a
     yes, so ask "Is that right?" once more.
   - Not 10 digits (or 11 starting with 1)? Say "I need a 10-digit US number, could you say it
     again?" Never guess or fill in digits.
4. Once they say yes, call log_maintenance_request again with confirmed_phone set to that number and
   confirmed_phone_yes true (and the same number in callback_phone, unless it is the number they are
   calling from). If the result has confirmed_phone_saved false, do what confirmed_phone_message says:
   for a number that is not complete, ask for it again and go back to step 3.
5. If they will not give a number, do not push: close the call. Never send a number they did not say
   yes to, and never send the number they are calling from just because you have it.
Never say anything will be texted or sent to this number.

Closing a maintenance call (only after log_maintenance_request returned logged true, and after STEP 3): say the request has been logged and goes to the property's asset
manager for review, and the team will follow up. Never say it goes to Pat directly, never give a
time frame or promise a technician visit, and never diagnose. Only escalate an emergency or urgent
issue, with escalate after logging; routine requests are logged and the call closed. Escalating an
urgent issue that is not life-safety does not end the intake: finish the steps, then close.`;
  } else {
    maint = `

MAINTENANCE ISSUES: maintenance requests are not enabled. Get their name, unit and callback
number, say the team will follow up, and call log_tenant_issue with call_type other.`;
  }

  return `${intro}${maint}`;
}

const FLOW_RULES: Record<FlowKey, { tool: string; how: string }> = {
  rent_fees: {
    tool: "rent",
    how: "Answer rent, grace-period, late-fee and payment-method questions using only the approved wording. Never quote a balance, a deadline for a specific person or anything not in the wording. If they want something more, take their name, unit and callback number and log it.",
  },
  portal_login: {
    tool: "portal_login",
    how: "Ask for the current email address on their account (one question). Then, one question at a time, their name and unit if you do not have them. You cannot reset a password yourself: pass the details to the office and never say a reset email was sent. Log it, and put the email address in the reason, because the tool has no email field.",
  },
  application: {
    tool: "application",
    how: "Give the application instructions in short steps, one step at a time if they want them repeated. Do not discuss fees, income requirements or approval.",
  },
  eviction: {
    tool: "eviction",
    how: "Use only the approved wording. Never give legal advice, never promise a payment plan or any outcome, and never discuss the legal process. If they expect to be late with rent, give the same guidance about contacting their asset manager. Log what they said.",
  },
  non_renewal: {
    tool: "non_renewal",
    how: "Ask, one at a time and skipping what they already said: 'May I ask why?', then their anticipated move-out date, then what days and times they are available for the move-out walkthrough. Put the answers in the log reason. Then give the process in the approved wording. Never promise any security-deposit outcome.",
  },
  work_order_status: {
    tool: "work_order_status",
    how: "Ask, one at a time and skipping what you already know: their name, the address, the unit number, what the maintenance issue is, and when they first reported it. Confirm the unit with find_unit (only matched true counts). Then call check_work_order_status with caller_name, find_unit's property_address and unit_label, issue_description and first_reported. Say only what it returns: the summary, the date it was reported and the status sentence. Never add a day, date, time, cause, name or promise, never read out a ref, and never mention identity checks or say a name did or did not match. If it returns choices, ask which one with its say line (one question), then call it again with request_ref and describe only that one. If it finds nothing, say you don't see an open request for their unit and offer to log one; if they want to, run the maintenance request flow. If the unit is not identified, never say whether a request exists: say you'll pass their question to the right team member. Say the 'can't see the live status' line only when the lookup itself fails. Always log the call with log_tenant_issue, and put the address, the issue and when it was first reported in the reason, because the tool has no fields for them. That only records their question: never tell the caller a request was logged or created.",
  },
  renewal: {
    tool: "renewal",
    how: "Ask, one at a time and skipping what they already said: their name, address, unit number, when their lease expires and their current email address. Then explain the process in the approved wording. If they do not know who their asset manager is, say staff will pass it to the right person. Never say a lease has been generated or sent, and never say anything is binding until both signatures are in. Log it, and put the address, the lease expiry date and the email address in the reason, because the tool has no fields for them.",
  },
  vendor_payment: {
    tool: "vendor_payment",
    how: "Direct them to Delia in the accounting department. Give a phone number or email for Delia only if it is listed in the owner routing directory; otherwise take their name, company and a callback number as a message. Never state a payment status. Log it, and put the company name and what they asked in the reason.",
  },
  neighbor_dispute: {
    tool: "neighbor_dispute",
    how: "Use only the approved wording and do not take sides, investigate or promise any action. Log it briefly.",
  },
};

/** Config-driven resident/other call types: only live (switched on AND approved) ones are described. */
export function composeFlows(c: SarahConfig): string {
  const onFlows = FLOW_DEFS.filter((f) => live(c, f.key));
  const names = onFlows.map((f) => FLOW_RULES[f.key].tool);

  const sections = onFlows.map((f) => {
    const w = flowOf(c, f.key).wording.trim();
    const r = FLOW_RULES[f.key];
    return `${f.label.toUpperCase()}:
Approved wording (use these facts and no others, in short natural sentences, not as one long speech):
"${w}"
How to handle it: ${r.how}
Log it with log_tenant_issue, call_type ${r.tool}.`;
  });

  // Only while the owner menu is live and someone can be put through; otherwise nothing at all, so
  // the prompt is unchanged while it is off.
  const menu = ownerRoutingMenu(c);
  const routing = menu
    ? `\n\n${composeOwnerRoutingBlock(menu, companyOf(c))}\nIf a caller only says they are a property owner, ask once whether they already own a property with ${companyOf(c)} or want it to manage one: an existing owner goes to OWNER CALL ROUTING, one who wants management goes to route_owner_prospect.`
    : "";

  const generic = `OTHER RESIDENT CALLS (anything that is not a maintenance issue and not described above):
Get whichever of their name, unit and best callback number they have not already said, one at a
time, and one plain sentence on why they called. Say you will pass it to the team, and call log_tenant_issue with call_type ${
    names.length ? `${names.join(", ")} or other` : "other"
  }. ${
    names.length === 0 ? "Use call_type other for every non-maintenance call. " : "Use call_type other for any topic not in that list. "
  }Use a severity from 1 to 10 where 1-2 is informational and 3-6 is routine. For any topic without
approved wording above, do not discuss lease terms, fees, balances, deadlines or legal matters,
never give legal advice, and never promise a payment plan or a deposit outcome. Never state what the
status of anything is unless a tool just told you.`;

  return [...sections, generic].join("\n\n") + routing;
}

/** Short statement of which call flows are on. Anything not listed must be handed to staff. */
export function composeCallTypes(c: SarahConfig): string {
  // The owner menu counts as handled only while it is really live (someone can be put through).
  const handled = (key: CallTypeKey) => (key === "owner_routing" ? ownerRoutingMenu(c) !== null : live(c, key));
  const on = CALL_TYPES.filter((t) => handled(t.key)).map((t) => `- ${t.label}`);
  const off = CALL_TYPES.filter((t) => !handled(t.key)).map((t) => t.label);
  const b = c.behavior ?? defaultBehavior();
  return `CALL TYPES YOU HANDLE:
${on.join("\n") || "- none"}
Anything outside these (${off.join("; ") || "none"}) you do not discuss: take their name, unit and
callback number, say someone will follow up, and log it.

WHEN INFORMATION IS MISSING OR A LOOKUP FAILS:
${b.missingInfo.trim()}
${b.lookupFailure.trim()}
Do not offer to connect anyone to Pat or "press 0": the team follows up on every logged request.`;
}

/** Leasing instructions for the 518 flow. They replace the older check_qualification steps. */
/** How Sarah handles the city or area answer. Only when the leasing flow has a preferred_area step. */
const AREA_RULES = `   CITY OR AREA (the step recorded in preferred_area):
   - "Anywhere", "not sure", "the Capital Region" or anything like it is no preference: record
     preferred_area as "no preference", do not ask again, and call check_availability without city.
   - Once they name a city or area, call check_availability with it as city and offer only what it
     returns for that city.
   - If city_status is none_available or unknown_city, say its say line (or very close to it): there
     is nothing open there, or we don't currently have properties there, then the cities that do have
     openings, and ask if any of those would work. Never call a city nearby or close, and never say
     how far away anything is.
   - If they pick one of those cities, call check_availability again with it, and log both places in
     preferred_area (for example "Clifton Park, open to Albany").`;

export function composeLeasing(c: SarahConfig): string {
  const co = companyOf(c);
  const flows = flowsOf(c);
  const asksArea = flows.leasing.some((n) => n.kind === "ask" && /\bpreferred_area\b/.test(n.field ?? ""));
  return `LEASING CALLS (${co}; this replaces any earlier leasing steps that mention check_qualification):
1. Once they say they want to rent, go straight to the first step of the question flow below. Do not
   ask a separate open question first.
2. Run this question flow, ONE step per turn. Skip any step they have already answered and any
   question the property has switched off under WHAT TO ASK EVERY LEASING CALLER.

${composeFlowSection("LEASING QUESTION FLOW", "the caller wants to rent an apartment", flows.leasing)}
${asksArea ? `\n${AREA_RULES}\n` : ""}
3. Call log_lead as soon as you have the first useful answer, and again after every one or two new
   answers, always with everything you know so far. preferred_area (the city or area, in their
   words, or "no preference") and avoid_communities; bedrooms as studio, 1br, 2br or 3br+; budget as
   a number; third_party_payer with payer_name, payer_phone and payer_email; pets_wanted, pet_type
   and pet_count; move_in_date; caller_name and caller_phone; other_info. Do not wait until the end.
   (Only if EXTRA SCREENING QUESTIONS are listed, also record those answers with check_qualification.)
4. Availability: answer only from check_availability or the available_units log_lead returns.
   Never offer a unit or size that is not in a result. Once you know their city or area, always
   pass it to check_availability as city. If nothing matches, offer the closest available option
   or to note their interest.
   If they ask about bathrooms, the floor, laundry, heat or who pays for utilities for a unit they
   like, call get_unit_details with the building. Only those questions, never every field
   unprompted, and for any null say you don't have that detail and the team will follow up.
5. You only RECORD. Never say or hint that they do or do not qualify, are approved, eligible or
   turned down. If asked, say the team reviews every inquiry and will follow up.
6. Tours: offer one, then run this flow, ONE step per turn.

${composeFlowSection("TOUR REQUEST FLOW", "the caller wants a tour", flows.tour)}

   Then follow TOUR BOOKING: call find_tour_times with their date and time. If requested_time is
   available, read it back, and after a clear yes book it with request_tour. If it is not
   available, offer at most two or three of the alternatives it returns in a natural sentence, not
   a list. After booking, confirm the day and time and say who it is with, by first name, only if
   the result gives a name.
7. A property owner who wants ${co} to manage their property is not a renter: ask their name, then
   the best number, then the property address, one question each, and call route_owner_prospect.
   Tell them Alex will follow up. Do not discuss fees or terms.
8. Once the reason for the call is done, ask once whether there is anything else, then say a short
   goodbye and call end_call.`;
}

/**
 * The whole Sarah-config contribution: what replaces the hard-coded LIFE_SAFETY_BLOCK and
 * RESIDENT_TRIAGE_BLOCK, plus the style rules, leasing flow, call-type list and wording flows.
 */
/** The find_unit example in composeResidentCalls, and what it reads while the owner menu is live. */
const REAL_ADDRESS_EXAMPLE = '"Is that 182, 184 or 188 Remsen Street?"';
const PLACEHOLDER_ADDRESS_EXAMPLE = '"Is that 12, 14 or 16 Example Street?"';

export function composeSarahSections(c: SarahConfig): {
  top: string;
  lifeSafety: string;
  resident: string;
  extra: string;
  bottom: string;
} {
  // The owner phone menu is a list read past 25 words, so while it is live it joins the exceptions
  // to rules 2 and 5. Off: the HARD RULES are byte-identical to the constants.
  const menuLive = ownerRoutingMenu(c) !== null;
  return {
    top: menuLive
      ? HARD_RULES.replace(
          "returns (rule 2 does not forbid any of these).",
          "returns, and the OWNER CALL ROUTING phone menu is read once as written (rules 2 and 5 do not\nforbid any of these).",
        )
      : HARD_RULES,
    bottom: menuLive
      ? HARD_RULES_REMINDER.replace(
          "and check_work_order_status's request choices are the only exceptions",
          "check_work_order_status's request choices and the owner phone menu are the only exceptions",
        )
      : HARD_RULES_REMINDER,
    lifeSafety: composeLifeSafety(c),
    // While live, the find_unit example names no real street: a real call copied one into
    // verify_owner (conv_5201m6gvmsxafxssy2xrjzjgxten). Off: unchanged, so the prompt is byte-identical.
    resident: menuLive ? composeResidentCalls(c).replace(REAL_ADDRESS_EXAMPLE, PLACEHOLDER_ADDRESS_EXAMPLE) : composeResidentCalls(c),
    extra: [
      composeFlows(c),
      composeCallTypes(c),
      c.leasing.captureOnly
        ? `LEASING MODE: CAPTURE ONLY. Record every answer. Never tell a caller they qualify or do not
qualify, and never turn anyone away. The team reviews every inquiry.`
        : "",
      composeLeasing(c),
      composeStyle(c),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// --- "Missing from Pat" ------------------------------------------------------------------------

/** Which editor an item opens in the /sarah modal. */
export type ItemModal = "text" | "contacts" | "routing" | "severity";

/**
 * Per-item approval workflow: draft -> pending_approval -> approved | changes_requested
 * (-> edit -> draft). "needs_contact" and "complete" are only for contact items, which have no
 * approval step: they are done when the details are in.
 */
export type ItemStatus =
  | "needs_contact"
  | "draft"
  | "pending_approval"
  | "changes_requested"
  | "approved"
  | "complete"
  | "decided";

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  needs_contact: "Needs contact details",
  draft: "Needs approval",
  pending_approval: "Pending approval",
  changes_requested: "Changes requested",
  approved: "Approved",
  complete: "Details added",
  decided: "Decided for you",
};

export type MissingItem = {
  id: string;
  /** The /sarah tab where it gets fixed. */
  area: "call-types" | "maintenance" | "emergency" | "escalation" | "routing" | "other-calls" | "tenant-messages";
  label: string;
  detail: string;
  kind: "approval" | "contact" | "confirm";
  modal: ItemModal;
  /** Short type chip shown in the modal. */
  chip: string;
  /** Contact items need no approval; everything else does. */
  approval: boolean;
  /** What Sarah does while this stays unapproved. */
  fallback: string;
  status: ItemStatus;
  /**
   * True for items Simplr decided with a safe default (they are never "missing from Pat"). The
   * stored behaviour is unchanged: flows stay off, unapproved scripts fall back to 911.
   */
  decidedByDefault?: boolean;
  /** One plain-English line for the "Decided for you" section. */
  decidedNote?: string;
};

/** One stored workflow row (sarahConfigItems), as far as the pure code needs it. */
export type WorkflowRow = {
  itemId: string;
  status: "draft" | "pending_approval" | "changes_requested" | "approved";
  fingerprint: string;
  text?: string;
  lastEditedBy?: string;
  lastEditedByLabel?: string;
  lastEditedAt?: number;
  note?: string;
  noteBy?: string;
  noteAt?: number;
  updatedAt: number;
};

export type ItemExtra = {
  workflow: Record<string, WorkflowRow>;
  properties: Array<{ id: string; name: string; phone: string }>;
};

const INCIDENT_TEXT: Record<EmergencyScript["incident"], string> = {
  fire: "Fire or smoke",
  flooding: "Flooding",
  gas_hissing: "Gas smell with hissing",
  gas_slight: "Slight gas smell, no hissing",
  other: "Other life-threatening emergency",
};

export const NO_PRESS_ZERO_WARNING = "Conflicts with the PRD's no 'press 0' rule — Alex/Pat must approve.";

const ROUTING_MENU_FALLBACK =
  "The owner routing menu stays off. Sarah gives no staff number and never offers to transfer or 'press 0'.";

/** Order-independent JSON, so content that merely round-tripped through the database compares equal. */
export function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

/** Small non-cryptographic hash (two 32-bit lanes). Only detects "this changed", never secures anything. */
export function hashStr(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + ch) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}${s.length.toString(16)}`;
}

const isDelia = (e: { label: string }) => /delia/i.test(e.label);

/** The text of the two decision items; stored on the workflow row, never in the Sarah config. */
export function decisionText(id: "am-fallback" | "pilot-flows", wf?: WorkflowRow): string {
  return wf?.text ?? DECISION_DRAFTS[id];
}

/**
 * What an item's approval covers, as a hash. An approval or a submission only holds while this is
 * unchanged, so editing anywhere (this modal or a tab) drops the item back to draft.
 */
export function itemFingerprint(c: SarahConfig, id: string, wf?: WorkflowRow): string {
  let basis: unknown = "";
  if (id === "emergency-type" || id === "severity-signoff") {
    basis = { sev: c.severityLevels, esc: c.escalationContacts };
  } else if (id.startsWith("script-")) {
    const s = c.emergencyScripts.find((x) => x.incident === id.slice(7));
    basis = { w: s?.wording.trim(), p: (s?.phone ?? "").trim() };
  } else if (id === "tenant-responsibility") {
    basis = { w: c.tenantResponsibility.wording.trim(), i: c.tenantResponsibility.items };
  } else if (id.startsWith("flow-")) {
    basis = flowOf(c, id.slice(5) as FlowKey).wording.trim();
  } else if (id === "delia-contact") {
    basis = c.routingDirectory.entries.find(isDelia) ?? null;
  } else if (id === "routing-phones" || id === "owner-routing") {
    // m is undefined (and so left out of the hash) until a main office number is entered, so older approvals hold.
    basis = {
      e: c.routingDirectory.entries,
      f: c.routingDirectory.fallback ?? "",
      a: c.routingDirectory.afterHours ?? "",
      m: c.routingDirectory.mainOfficeNumber || undefined,
    };
  } else if (id.startsWith("escalation-")) {
    basis = c.escalationContacts.find((x) => x.level === id.slice(11)) ?? null;
  } else if (id === "am-fallback" || id === "pilot-flows") {
    basis = decisionText(id, wf);
  }
  return hashStr(stableJson(basis));
}

/** Whether the config itself carries this item's approval stamp. null = the item has no stamp (workflow-only). */
function stampOf(c: SarahConfig, id: string): boolean | null {
  const typeOf = (key: CallTypeKey) => c.callTypes.find((t) => t.key === key);
  if (id === "emergency-type") return !!typeOf("emergency")?.approvedBy;
  if (id === "owner-routing") return !!typeOf("owner_routing")?.approvedBy;
  if (id.startsWith("script-")) return !!c.emergencyScripts.find((s) => s.incident === id.slice(7))?.approvedBy;
  if (id === "tenant-responsibility") return c.tenantResponsibility.approved && !!c.tenantResponsibility.approvedBy;
  if (id.startsWith("flow-")) {
    const f = flowOf(c, id.slice(5) as FlowKey);
    return f.approved && !!f.approvedBy;
  }
  return null;
}

/** Contact items: true once the details are in. null = not a contact item. */
function contactDone(c: SarahConfig, id: string, extra: ItemExtra): boolean | null {
  const entries = c.routingDirectory.entries;
  if (id === "utility-number") {
    if ((c.emergencyScripts.find((s) => s.incident === "gas_slight")?.phone ?? "").trim()) return true;
    return extra.properties.length > 0 && extra.properties.every((p) => p.phone.trim() !== "");
  }
  if (id === "delia-contact") return !!entries.find(isDelia)?.phone.trim();
  // A shared (test) number keeps the item open, so "replace with real numbers" stays on the list.
  if (id === "routing-phones") {
    return entries.filter((e) => !isDelia(e)).every((e) => e.phone.trim() !== "") && routingWarnings(c.routingDirectory).length === 0;
  }
  if (id.startsWith("escalation-")) {
    const e = c.escalationContacts.find((x) => x.level === id.slice(11));
    return !!e && (e.userIds.length > 0 || e.externalPhones.length > 0);
  }
  return null;
}

/** Every item the Sarah Configuration document says Pat (or engineering) still owes, with its status. */
export function allItems(c: SarahConfig, extra?: Partial<ItemExtra>): MissingItem[] {
  const ex: ItemExtra = { workflow: extra?.workflow ?? {}, properties: extra?.properties ?? [] };
  const defs: Array<Omit<MissingItem, "status">> = [];
  const add = (d: Omit<MissingItem, "status">) => defs.push(d);

  add({
    id: "emergency-type",
    area: "call-types",
    kind: "approval",
    modal: "severity",
    chip: "Emergency handling",
    approval: true,
    label: "Emergency handling not approved",
    detail:
      "Until Pat approves the scripts, severity definitions, contact numbers and escalation rules, Sarah only says: leave the area and call 911.",
    fallback: "Sarah only says: leave the area and call 911, and the team is escalated.",
  });
  for (const s of c.emergencyScripts) {
    add({
      id: `script-${s.incident}`,
      area: "emergency",
      kind: "approval",
      modal: "text",
      chip: "Emergency script",
      approval: true,
      label: `Emergency script: ${INCIDENT_TEXT[s.incident]}`,
      detail: "Not approved. Sarah falls back to: leave the area and call 911.",
      fallback: "Sarah falls back to: leave the area and call 911.",
    });
  }
  add({
    id: "utility-number",
    area: "emergency",
    kind: "contact",
    modal: "contacts",
    chip: "Contact details",
    approval: false,
    label: "Gas utility provider number",
    detail:
      "The slight-gas script says to contact the utility provider. The number is per property and has not been provided; Sarah never guesses it.",
    fallback: "Sarah says to contact the gas utility provider and gives no number.",
  });
  add({
    id: "tenant-responsibility",
    area: "maintenance",
    kind: "approval",
    modal: "text",
    chip: "Maintenance wording",
    approval: true,
    label: "Tenant-responsibility wording (light bulbs, blinds, trash to the curb)",
    detail: "Not approved. Sarah says a neutral line, still logs it as tenant responsibility.",
    fallback: "Sarah says a neutral line (\"I'll make a note of that for the team\") and logs it as tenant responsibility.",
  });
  for (const f of FLOW_DEFS) {
    add({
      id: `flow-${f.key}`,
      area: "other-calls",
      kind: "approval",
      modal: "text",
      chip: "Call type wording",
      approval: true,
      label: `${f.label} wording`,
      detail: `Not approved, so this call type stays off. ${f.confirm}`,
      fallback:
        "This call type stays off. Sarah takes a name, unit and callback number, says the team will follow up, and logs it.",
    });
  }
  add({
    id: "delia-contact",
    area: "routing",
    kind: "contact",
    modal: "contacts",
    chip: "Contact details",
    approval: false,
    label: "Delia's contact details (accounting)",
    detail:
      "Vendor payment questions go to Delia. Her number or extension is still to be provided; until then Sarah takes a message.",
    fallback: "Sarah takes a message for Delia and gives no number.",
  });
  const missingPhones = c.routingDirectory.entries.filter((e) => !e.phone.trim() && !isDelia(e));
  const sharedNumbers = routingWarnings(c.routingDirectory);
  add({
    id: "routing-phones",
    area: "routing",
    kind: "contact",
    modal: "routing",
    chip: "Routing menu",
    approval: false,
    label: missingPhones.length
      ? `Phone numbers or extensions for ${missingPhones.map((e) => e.label).join(", ")}`
      : sharedNumbers.length
        ? "Routing menu: real phone numbers (test number in use)"
        : "Phone numbers or extensions for the routing menu",
    detail:
      "The owner call routing menu (press 1 Pat, 2 Alex, 3 Nikki, 4 Nina, 5 Delia, 6 Alyssa) offers only the people with a number. For the others Sarah takes a message." +
      (sharedNumbers.length ? ` ${sharedNumbers.join(" ")}` : ""),
    fallback: ROUTING_MENU_FALLBACK,
  });
  add({
    id: "owner-routing",
    area: "routing",
    kind: "confirm",
    modal: "routing",
    chip: "Routing menu",
    approval: true,
    label: "Owner call routing: approval and rules",
    detail:
      "Conflict to resolve: the PRD says no general press-0 route to Pat unless Alex and Pat approve. Also needed: each person's hours, after-hours behavior and what happens if someone does not answer. The menu is offered to existing property owners only.",
    fallback: ROUTING_MENU_FALLBACK,
  });
  for (const level of ["emergency", "urgent"] as const) {
    add({
      id: `escalation-${level}`,
      area: "escalation",
      kind: "contact",
      modal: "contacts",
      chip: "Contact details",
      approval: false,
      label: `Escalation contacts for ${level} requests`,
      detail: "No one extra is set to be texted. All admins are still texted for an emergency.",
      fallback: "No one extra is texted. All admins are still texted for an emergency.",
    });
  }
  add({
    id: "severity-signoff",
    area: "call-types",
    kind: "confirm",
    modal: "severity",
    chip: "Severity levels",
    approval: true,
    label: "Severity definitions and who is notified at each level",
    detail: "Pre-filled from the current rubric; Pat to sign off.",
    fallback: "Sarah keeps using the current severity rubric. Nothing changes on live calls.",
  });
  add({
    id: "am-fallback",
    area: "call-types",
    kind: "confirm",
    modal: "text",
    chip: "Decision",
    approval: true,
    label: "Fallback when the assigned asset manager is unavailable",
    detail: "Alex and Pat to decide; requests are never silently reassigned.",
    fallback: "Requests are never silently reassigned. They stay with the assigned asset manager.",
  });
  add({
    id: "pilot-flows",
    area: "call-types",
    kind: "confirm",
    modal: "text",
    chip: "Decision",
    approval: true,
    label: "Which resident call types are in the pilot",
    detail:
      "Rent, portal login, applying, eviction, non-renewal, work-order status, renewal and vendor payment are not part of the pilot until Pat confirms.",
    fallback: "Those call types stay off until each wording is approved.",
  });

  return defs.map((d) => {
    const note = DECIDED_NOTES[d.id];
    return {
      ...d,
      status: itemStatus(c, d.id, d.approval, ex),
      ...(note || d.id.startsWith("flow-") ? { decidedByDefault: true } : {}),
      ...(note ? { decidedNote: note } : {}),
    };
  });
}

/** Plain-English defaults chosen by Simplr. Shown under "Decided for you (change anytime)". */
export const DECIDED_NOTES: Record<string, string> = {
  "am-fallback": "If the asset manager is unavailable, the request is never rerouted silently. Admins are flagged.",
  "pilot-flows": "Pilot scope: maintenance, leasing and tours, emergencies, owner prospects and the resident FAQ topics.",
  "owner-routing": "The owner call menu stays off. There is no general \"press 0\" route to Pat.",
  "routing-phones": "Staff numbers for the call menu stay off until added.",
  "delia-contact": "Vendor payments: Sarah takes a message until a contact is added.",
};

/** The id of the stored "Skip, admins only" mark for the alert-contacts card. Not a catalog item. */
export const SKIP_ESCALATION_ID = "skip-escalation";

/** The alert-contacts question is done when extra contacts were added or the admin chose "admins only". */
export function alertsDone(c: SarahConfig, extra: ItemExtra): boolean {
  if (extra.workflow[SKIP_ESCALATION_ID]?.status === "approved") return true;
  return c.escalationContacts.some((e) => e.userIds.length > 0 || e.externalPhones.length > 0);
}

/** The effective status of one item. See ItemStatus. */
export function itemStatus(c: SarahConfig, id: string, approval: boolean, extra: ItemExtra): ItemStatus {
  const base = baseItemStatus(c, id, approval, extra);
  if (base !== "draft" && base !== "needs_contact") return base;
  // Safe defaults: not approved, but nothing is owed. Behaviour is unchanged (off, or the 911 fallback).
  if (id in DECIDED_NOTES || id.startsWith("flow-")) return "decided";
  if (id.startsWith("escalation-") && alertsDone(c, extra)) return "decided";
  return base;
}

function baseItemStatus(c: SarahConfig, id: string, approval: boolean, extra: ItemExtra): ItemStatus {
  if (!approval) return contactDone(c, id, extra) ? "complete" : "needs_contact";
  const wf = extra.workflow[id];
  const stamp = stampOf(c, id);
  if (stamp === true) return "approved";
  const fresh = !!wf && wf.fingerprint === itemFingerprint(c, id, wf);
  // A workflow-only item (no stamp in the config) is approved while its stored approval matches the content.
  if (stamp === null && fresh && wf!.status === "approved") return "approved";
  if (fresh && wf!.status !== "approved") return wf!.status;
  return "draft";
}

/**
 * Everything still owed by Pat (or engineering), computed from the config and the workflow rows so it
 * empties as things get approved. Shown on /sarah as a checklist; nothing here blocks a publish, it
 * only says what Sarah will NOT say until it is resolved.
 */
export function missingFromPat(c: SarahConfig, extra?: Partial<ItemExtra>): MissingItem[] {
  return allItems(c, extra).filter(
    (i) => !i.decidedByDefault && i.status !== "approved" && i.status !== "complete" && i.status !== "decided",
  );
}

/** The five emergency parts approved together: 5 scripts, emergency handling and the severity sign-off. */
export const EMERGENCY_BUNDLE_IDS = [
  "script-fire",
  "script-flooding",
  "script-gas_hissing",
  "script-gas_slight",
  "script-other",
  "emergency-type",
  "severity-signoff",
] as const;

export type PilotCardId = "emergency" | "gas" | "tenant" | "alerts" | "flows";

export type PilotCard = {
  id: PilotCardId;
  done: boolean;
  /** Emergency card: parts (5 scripts + the severity levels) approved, out of total. */
  approved?: number;
  total?: number;
  /** Emergency card: parts that dropped back to draft after an approval and need approving again. */
  needsReapproval?: number;
  /** Flows card: how many resident questions are switched on. */
  flowsOn?: number;
};

/** The five questions the /sarah panel shows. Computed, so it fills in as things are answered. */
export function pilotProgress(c: SarahConfig, extra?: Partial<ItemExtra>): { cards: PilotCard[]; done: number; total: number } {
  const ex: ItemExtra = { workflow: extra?.workflow ?? {}, properties: extra?.properties ?? [] };
  const items = allItems(c, ex);
  const st = (id: string) => items.find((i) => i.id === id)?.status;
  const scriptsOk = c.emergencyScripts.map((s) => st(`script-${s.incident}`) === "approved");
  const sevOk = st("emergency-type") === "approved" && st("severity-signoff") === "approved";
  const approved = scriptsOk.filter(Boolean).length + (sevOk ? 1 : 0);
  const total = scriptsOk.length + 1;
  const emergencyDone = approved === total;
  const flowsOn = FLOW_DEFS.filter((f) => live(c, f.key)).length;
  const cards: PilotCard[] = [
    { id: "emergency", done: emergencyDone, approved, total, needsReapproval: !emergencyDone && approved > 0 ? total - approved : 0 },
    { id: "gas", done: st("utility-number") === "complete" },
    { id: "tenant", done: st("tenant-responsibility") === "approved" },
    { id: "alerts", done: alertsDone(c, ex) },
    { id: "flows", done: true, flowsOn },
  ];
  return { cards, done: cards.filter((x) => x.done).length, total: cards.length };
}

// --- Knowledge-base policy document -------------------------------------------------------------

export const POLICY_DOC_TITLE = "518 Property Pro — policies";

/**
 * The text of the policies document that is synced to the voice agent's knowledge base. Built from
 * the PUBLISHED config, and only from approved, switched-on content: anything pending is named in
 * the "not approved" list with no detail, so Sarah cannot state it by accident.
 */
export function composePolicyDoc(c: SarahConfig): string {
  const co = companyOf(c);
  const parts: string[] = [];
  parts.push(
    `${co} — policies and facts Sarah may state.\nThis document lists only wording that the maintenance lead (Pat) has approved. Anything listed under NOT APPROVED must not be stated, discussed or guessed at. Sarah gives no phone number that is not written in this document or in her instructions.`,
  );

  parts.push(`STAFF AND ROLES
Pat Fiore: maintenance lead.
Alex Buell: business oversight and owner relationships. Property owners who want ${co} to manage their property are followed up by Alex.
Nikki, Nina and Alyssa: members of the ${co} team (roles to be confirmed).
Delia: accounting department.
Each unit has one designated asset manager. Maintenance requests go to the property's asset manager for review. No staff phone numbers are listed in this document.`);

  parts.push(`HOW MAINTENANCE REQUESTS WORK
Sarah takes the request over the phone and logs it. The request goes to the property's asset manager for review. A resident's question that is not a repair is logged the same way, as an informational request for the asset manager to review; Sarah promises no answer or time. The asset manager may ask for more information or photos, or close the request if it is not the company's responsibility. Sarah never promises a time frame, never promises a technician visit and never diagnoses a problem.`);

  const tr = c.tenantResponsibility;
  if (tr.approved && tr.wording.trim()) {
    parts.push(`TENANT-RESPONSIBILITY ITEMS
${tr.items.filter((i) => i.trim()).join("; ")}.
Approved wording: "${tr.wording.trim()}"`);
  }

  const scripts = c.emergencyScripts
    .map((s) => ({ s, ok: approvedScript(c, s.incident) }))
    .filter((x) => x.ok)
    .map(
      ({ s }) =>
        `${INCIDENT_TEXT[s.incident]}: "${spokenWording(s.wording)}"${s.phone?.trim() ? ` Number: ${s.phone.trim()}.` : ""}`,
    );
  if (scripts.length) {
    parts.push(`EMERGENCY SCRIPTS (approved; the only emergency numbers Sarah may give)
${scripts.join("\n")}
Sarah never sends anyone back inside and never gives an emergency number that is not listed here.`);
  }

  const pending: string[] = [];
  for (const f of FLOW_DEFS) {
    if (live(c, f.key)) {
      let extra = "";
      if (f.key === "vendor_payment") {
        const d = c.routingDirectory.entries.find((e) => /delia/i.test(e.label) && e.phone.trim());
        if (d) extra = `\nDelia's contact: ${d.phone.trim()}.`;
      }
      parts.push(`${f.label.toUpperCase()} (approved)\n${flowOf(c, f.key).wording.trim()}${extra}`);
    } else {
      pending.push(f.label);
    }
  }
  if (!tr.approved) pending.push("Tenant-responsibility items (light bulbs, blinds, trash)");
  for (const s of c.emergencyScripts) {
    if (!approvedScript(c, s.incident)) pending.push(`Emergency script: ${INCIDENT_TEXT[s.incident]} (say only: leave the area and call 911)`);
  }
  parts.push(`NOT APPROVED, do not state or discuss, say the team will follow up
${pending.length ? pending.map((p) => `- ${p}`).join("\n") : "- nothing pending"}`);

  return parts.join("\n\n");
}

/** The config's tenant messages, defaults filled in. Pure; the approved check lives in sarahConfigRead. */
export function tenantMessagesOf(c: SarahConfig): TenantMessages {
  return { ...defaultTenantMessages(), ...(c.tenantMessages ?? {}) };
}

export function severityOf(level: string): SeverityLevel | null {
  return (SEVERITY_LEVELS as readonly string[]).includes(level) ? (level as SeverityLevel) : null;
}

export function isApprovalRequired(key: string): boolean {
  return (APPROVAL_REQUIRED as readonly string[]).includes(key);
}

export { enabled as isCallTypeEnabled };
