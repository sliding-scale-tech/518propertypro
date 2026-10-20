import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * Sarah's question flows: the ordered, conditional question lists per call type.
 *
 * Pure module (no server imports) shared by the Convex schema validator, the prompt composer and
 * the /sarah question-flow editor. A flow is an ordered list of steps. Each step is a question
 * Sarah asks (or a short statement she makes), is REQUIRED or OPTIONAL, and may carry "ask only
 * if" conditions that look at an earlier answer or at a situation fact (top floor, raining, ...).
 * A step whose condition points at an earlier question is a follow-up of that question; the editor
 * draws it indented under it.
 *
 * Composition renders this as numbered steps with explicit "Ask ONLY IF ..." lines, so the model
 * never sees a bulk list of questions it could read out.
 */

// --- Flows ---------------------------------------------------------------------------------------

export const QFLOW_IDS = ["maint_basic", "maint_electrical", "maint_water_leak", "maint_broken_item", "leasing", "tour"] as const;
export type QFlowId = (typeof QFLOW_IDS)[number];

export type QFlowMeta = {
  id: QFlowId;
  label: string;
  group: "maintenance" | "leasing";
  /** When this flow applies, in words. Shown in the editor and written into the prompt. */
  applies: string;
  /** The built-in situation that gates the whole flow (shown as a badge in the diagram). */
  gate?: string;
};

export const QFLOW_META: readonly QFlowMeta[] = [
  { id: "maint_basic", label: "General intake", group: "maintenance", applies: "every maintenance call" },
  {
    id: "maint_electrical",
    label: "Electrical",
    group: "maintenance",
    applies: "the issue is electrical (no power, outlets, switches)",
    gate: "IF electrical",
  },
  {
    id: "maint_water_leak",
    label: "Water leak",
    group: "maintenance",
    applies: "the issue is a non-emergency water leak",
    gate: "IF water leak",
  },
  {
    id: "maint_broken_item",
    label: "Broken item",
    group: "maintenance",
    applies: "the issue is a broken item (window, door, cabinet, ceiling tile and the like)",
    gate: "IF broken item",
  },
  { id: "leasing", label: "Leasing inquiry", group: "leasing", applies: "the caller wants to rent an apartment" },
  { id: "tour", label: "Tour request", group: "leasing", applies: "the caller wants a tour" },
];

export function isQFlowId(x: string): x is QFlowId {
  return (QFLOW_IDS as readonly string[]).includes(x);
}

// --- Conditions -----------------------------------------------------------------------------------

/** Situations Sarah works out during the call. Each can be used as an "ask only if" condition. */
export const FACTS = [
  { key: "issue_electrical", label: "Issue is electrical", say: "the issue is electrical" },
  { key: "issue_water_leak", label: "Issue is a water leak", say: "the issue is a water leak" },
  { key: "issue_broken_item", label: "Issue is a broken item", say: "the issue is a broken item" },
  { key: "unit_above_exists", label: "There is an apartment above", say: "there is an apartment above the caller's unit" },
  { key: "top_floor", label: "Caller lives on the top floor", say: "the caller lives on the top floor" },
  {
    key: "raining",
    label: "It is raining, storming or snowing",
    say: "it is raining, storming or there is standing snow on the roof",
  },
  { key: "leak_in_bath_kitchen", label: "Leak is in a bathroom or kitchen", say: "the leak is in a bathroom or a kitchen" },
  {
    key: "safe_nonemergency",
    label: "Safe and not an emergency",
    say: "it is safe and not an emergency (no sparking, burning smell, smoke or anything dangerous)",
  },
  { key: "caller_unmatched", label: "Caller was not matched to a unit", say: "the caller could not be matched to a unit" },
] as const;
export type FactKey = (typeof FACTS)[number]["key"];
const FACT_KEYS: string[] = FACTS.map((f) => f.key);
export function factOf(key: string) {
  return FACTS.find((f) => f.key === key);
}

export const OPS = [
  { key: "is", label: "is", needsValue: true },
  { key: "is_not", label: "is not", needsValue: true },
  { key: "contains", label: "contains", needsValue: true },
  { key: "answered", label: "was answered", needsValue: false },
  { key: "not_answered", label: "was not answered", needsValue: false },
] as const;
export type OpKey = (typeof OPS)[number]["key"];

// --- Validators / types -----------------------------------------------------------------------------

export const condValidator = v.object({
  type: v.union(v.literal("answer"), v.literal("fact")),
  // type "answer": an EARLIER question in the same flow, how to compare, and with what
  questionId: v.optional(v.string()),
  op: v.optional(
    v.union(v.literal("is"), v.literal("is_not"), v.literal("contains"), v.literal("answered"), v.literal("not_answered")),
  ),
  value: v.optional(v.string()),
  // type "fact": one of FACTS, optionally negated
  fact: v.optional(v.string()),
  not: v.optional(v.boolean()),
});

export const questionValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal("ask"), v.literal("say")),
  text: v.string(),
  required: v.boolean(),
  answerKind: v.optional(v.union(v.literal("text"), v.literal("yesno"))),
  /** Where the answer is recorded (a tool argument name), when there is one. */
  field: v.optional(v.string()),
  /** All must hold (AND) for the step to be asked. */
  when: v.optional(v.array(condValidator)),
});

const flowArray = v.optional(v.array(questionValidator));
export const questionFlowsValidator = v.object({
  maint_basic: flowArray,
  maint_electrical: flowArray,
  maint_water_leak: flowArray,
  maint_broken_item: flowArray,
  leasing: flowArray,
  tour: flowArray,
});

export type QCond = Infer<typeof condValidator>;
export type QNode = Infer<typeof questionValidator>;
export type QuestionFlows = Record<QFlowId, QNode[]>;
export type StoredQuestionFlows = Infer<typeof questionFlowsValidator>;

// --- Seeds (Sarah Configuration document, sections 1 and 2) -----------------------------------------

const ask = (id: string, text: string, required: boolean, more: Partial<QNode> = {}): QNode => ({
  id,
  kind: "ask",
  text,
  required,
  ...more,
});
const say = (id: string, text: string, required: boolean, more: Partial<QNode> = {}): QNode => ({
  id,
  kind: "say",
  text,
  required,
  ...more,
});
const ans = (questionId: string, op: OpKey, value?: string): QCond => ({
  type: "answer",
  questionId,
  op,
  ...(value !== undefined ? { value } : {}),
});
const fact = (key: FactKey, not = false): QCond => ({ type: "fact", fact: key, ...(not ? { not: true } : {}) });

export function defaultQuestionFlows(): QuestionFlows {
  return {
    maint_basic: [
      ask("mb_name", "What is your name?", true, { field: "caller_name" }),
      ask("mb_address", "What is your apartment address?", true, { field: "spoken_address" }),
      ask("mb_unit", "What is your unit number?", true, { field: "spoken_unit" }),
      ask("mb_issue", "What maintenance issue are you concerned about?", true, { field: "description" }),
      ask("mb_first", "When did you first notice or report the issue?", true, { field: "first_noticed" }),
      ask("mb_pet", "Do you have a pet?", false, { answerKind: "yesno" }),
      ask("mb_pet_detail", "What type of pet, and how many?", false, { field: "pets", when: [ans("mb_pet", "is", "yes")] }),
      ask("mb_time", "When would it be convenient to meet a technician, if necessary?", false, {
        field: "preferred_access_times",
      }),
    ],
    maint_electrical: [
      ask("me_breaker", "Did you check your electrical breaker box or the GFI outlet to see if a breaker has tripped?", true, {
        answerKind: "yesno",
        field: "answers.breaker_checked",
        when: [fact("safe_nonemergency")],
      }),
    ],
    maint_water_leak: [
      ask("mw_floor", "What floor do you live on?", true, { field: "answers.floor" }),
      ask("mw_where", "Where exactly is the leak?", true, { field: "answers.leak_location" }),
      ask("mw_above", "Is there an apartment above you, or do you live on the top floor?", true, {
        field: "answers.unit_above",
      }),
      ask("mw_bathkit", "Is there a bathroom or kitchen directly above the leak?", false, {
        answerKind: "yesno",
        field: "answers.bath_or_kitchen_above",
        when: [fact("leak_in_bath_kitchen"), fact("unit_above_exists")],
      }),
      ask("mw_flowing", "Is the water flowing right now?", false, { answerKind: "yesno", field: "answers.actively_flowing" }),
      say("mw_bucket", "Please put a bucket under the leak, if it is safe to do so.", true),
      ask("mw_photo", "Would you be able to send a photo or short video of the leak?", false, {
        answerKind: "yesno",
        field: "send_photo_link (only if they say yes)",
      }),
      say(
        "mw_roof",
        "Because you are on the top floor and the weather is bad, the roof assessment may have to wait until conditions improve. I can't promise a repair time.",
        true,
        { when: [fact("top_floor"), fact("raining")] },
      ),
    ],
    maint_broken_item: [
      ask("mi_what", "What is broken?", true, { field: "description" }),
      ask("mi_where", "Where exactly is it?", true, { field: "answers.location" }),
      ask("mi_long", "How long has it been broken?", true, { field: "answers.how_long" }),
      ask("mi_photo", "Would you be able to send a photo?", false, { answerKind: "yesno", field: "send_photo_link (only if they say yes)" }),
    ],
    leasing: [
      ask("ls_beds", "How many bedrooms are you looking for?", true, { field: "bedrooms" }),
      ask("ls_budget", "What is your monthly budget?", true, { field: "budget" }),
      ask("ls_move", "When would you like to move in?", true, { field: "move_in_date" }),
      ask("ls_pets", "Do you have any pets?", true, { answerKind: "yesno", field: "pets_wanted" }),
      ask("ls_pet_detail", "What type of pet, and how many?", true, {
        field: "pet_type, pet_count",
        when: [ans("ls_pets", "is", "yes")],
      }),
      ask("ls_name", "May I have your name?", true, { field: "caller_name" }),
      ask("ls_phone", "What is the best number to reach you on?", true, { field: "caller_phone" }),
      ask("ls_payer", "Will a third party, like an agency, employer or family member, pay some or all of the rent?", false, {
        answerKind: "yesno",
        field: "third_party_payer",
      }),
      ask("ls_payer_name", "What is the payer's name?", false, { field: "payer_name", when: [ans("ls_payer", "is", "yes")] }),
      ask("ls_payer_phone", "What is the payer's phone number?", false, {
        field: "payer_phone",
        when: [ans("ls_payer", "is", "yes")],
      }),
      ask("ls_payer_email", "What is the payer's email address?", false, {
        field: "payer_email",
        when: [ans("ls_payer", "is", "yes")],
      }),
      ask("ls_prefer", "Which communities in the Capital Region do you prefer?", false, { field: "preferred_communities" }),
      ask("ls_avoid", "Are there any communities you want to avoid?", false, { field: "avoid_communities" }),
      ask("ls_other", "Is there anything else you would like us to know?", false, { field: "other_info" }),
    ],
    tour: [
      ask("tr_want", "Would you like to schedule a tour?", false, { answerKind: "yesno" }),
      ask("tr_when", "What day and time works best?", true, { when: [ans("tr_want", "is", "yes")] }),
    ],
  };
}

/** The earlier plain-text lists (before question flows existed): used to detect an unedited default. */
const LEGACY_DEFAULTS: Record<"basic" | "electrical" | "water_leak" | "broken_item", string[]> = {
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
};
const LEGACY_TO_FLOW = {
  basic: "maint_basic",
  electrical: "maint_electrical",
  water_leak: "maint_water_leak",
  broken_item: "maint_broken_item",
} as const;

type LegacyLists = Record<keyof typeof LEGACY_DEFAULTS, string[]>;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Brings stored flows up to date. A flow that was never stored is seeded from the document. If the
 * admin had edited the OLD plain-text list for it, every line they left is kept as a required step
 * in the same order (nothing they wrote is lost); an unedited old default becomes the new seed.
 * A flow that has been stored is authoritative and returned unchanged.
 */
export function normalizeQuestionFlows(stored: StoredQuestionFlows | undefined, legacy?: LegacyLists): QuestionFlows {
  const seeds = defaultQuestionFlows();
  const out = { ...seeds };
  for (const id of QFLOW_IDS) {
    const s = stored?.[id];
    if (s) {
      out[id] = s;
      continue;
    }
    if (legacy) {
      for (const k of Object.keys(LEGACY_TO_FLOW) as Array<keyof LegacyLists>) {
        if (LEGACY_TO_FLOW[k] !== id) continue;
        const list = legacy[k];
        if (!sameList(list, LEGACY_DEFAULTS[k]) && list.length > 0) {
          out[id] = list
            .filter((t) => t.trim())
            .map((t, i) => ({ id: `legacy_${id}_${i + 1}`, kind: "ask" as const, text: t.trim(), required: true }));
        }
      }
    }
  }
  return out;
}

// --- Validation ---------------------------------------------------------------------------------------

const MAX_STEPS = 40;
const MAX_WHEN = 3;

export function validateQuestionFlows(flows: StoredQuestionFlows | undefined): void {
  if (!flows) return;
  for (const id of QFLOW_IDS) {
    const list = flows[id];
    if (!list) continue;
    if (list.length > MAX_STEPS) throw new Error("Too many steps in one question flow.");
    const seen = new Set<string>();
    for (const n of list) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(n.id)) throw new Error("A question has an invalid id.");
      if (seen.has(n.id)) throw new Error("Each question in a flow needs its own id.");
      if (!n.text.trim()) throw new Error("Questions cannot be empty.");
      if (n.text.length > 400) throw new Error("A question is too long (400 characters at most).");
      if ((n.field ?? "").length > 80) throw new Error("A question's field name is too long.");
      const when = n.when ?? [];
      if (when.length > MAX_WHEN) throw new Error("A question can have at most 3 conditions.");
      for (const c of when) {
        if (c.type === "fact") {
          if (!c.fact || !FACT_KEYS.includes(c.fact)) throw new Error("A condition uses an unknown situation.");
        } else {
          if (!c.questionId || !seen.has(c.questionId)) {
            throw new Error("A condition must point at a question that comes earlier in the same flow.");
          }
          const op = OPS.find((o) => o.key === c.op);
          if (!op) throw new Error("A condition is missing its comparison.");
          if (op.needsValue && !(c.value ?? "").trim()) throw new Error("A condition is missing its value.");
          if ((c.value ?? "").length > 200) throw new Error("A condition value is too long.");
        }
      }
      seen.add(n.id);
    }
  }
}

// --- Editing helpers (used by the editor, pure) ----------------------------------------------------------

/** Ids of the steps that depend, directly or through follow-ups, on the step at `index`. */
export function dependentsOf(nodes: QNode[], id: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (out.has(n.id)) continue;
      if ((n.when ?? []).some((c) => c.type === "answer" && c.questionId && (c.questionId === id || out.has(c.questionId)))) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/** True when every answer-condition points at a step that comes earlier. */
export function orderIsValid(nodes: QNode[]): boolean {
  const seen = new Set<string>();
  for (const n of nodes) {
    for (const c of n.when ?? []) {
      if (c.type === "answer" && !(c.questionId && seen.has(c.questionId))) return false;
    }
    seen.add(n.id);
  }
  return true;
}

export function newId(nodes: QNode[], prefix = "q"): string {
  const used = new Set(nodes.map((n) => n.id));
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}${Date.now().toString(36).slice(-4)}${i}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

export type TreeRow = { node: QNode; index: number; depth: number; parent?: QNode };

/** The steps in list order, each with an indent depth: a follow-up sits one level under its first answer-condition parent. */
export function treeRows(nodes: QNode[]): TreeRow[] {
  const depth = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((node, index) => {
    const pc = (node.when ?? []).find((c) => c.type === "answer" && c.questionId && byId.has(c.questionId));
    const parent = pc?.questionId ? byId.get(pc.questionId) : undefined;
    const d = parent ? (depth.get(parent.id) ?? 0) + 1 : 0;
    depth.set(node.id, d);
    return { node, index, depth: d, parent };
  });
}

// --- Evaluation (editor preview) ---------------------------------------------------------------------------

export type Sample = {
  /** undefined = answered with something that matches nothing; "" = not answered; otherwise the answer. */
  answers: Record<string, string | undefined>;
  facts: Record<string, boolean>;
};

export function visibleSteps(nodes: QNode[], sample: Sample): Array<{ node: QNode; index: number }> {
  const asked = new Set<string>();
  const out: Array<{ node: QNode; index: number }> = [];
  nodes.forEach((node, index) => {
    const ok = (node.when ?? []).every((c) => {
      if (c.type === "fact") return (sample.facts[c.fact ?? ""] === true) !== (c.not === true);
      const id = c.questionId ?? "";
      const wasAsked = asked.has(id);
      const raw = wasAsked ? sample.answers[id] : "";
      const val = (raw ?? "\u0000").trim().toLowerCase();
      const want = (c.value ?? "").trim().toLowerCase();
      switch (c.op) {
        case "is":
          return wasAsked && val === want;
        case "is_not":
          return wasAsked && val !== want;
        case "contains":
          return wasAsked && want !== "" && val.includes(want);
        case "answered":
          return wasAsked && val !== "";
        case "not_answered":
          return !wasAsked || val === "";
        default:
          return false;
      }
    });
    if (ok) {
      asked.add(node.id);
      out.push({ node, index });
    }
  });
  return out;
}

/** Required steps first, then optional ones, each group in list order: the order Sarah asks in. */
export function promptOrder<T extends { node: QNode }>(rows: T[]): T[] {
  return [...rows.filter((r) => r.node.required), ...rows.filter((r) => !r.node.required)];
}

// --- Prompt composition ----------------------------------------------------------------------------------

/** Text that is safe to put between double quotes in the prompt. */
function q(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/"/g, "'").replace(/\s{2,}/g, " ").trim();
}

function short(s: string, max = 60): string {
  const t = q(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

export function conditionText(c: QCond, nodes: QNode[]): string {
  if (c.type === "fact") {
    const f = factOf(c.fact ?? "");
    const say = f?.say ?? "a condition holds";
    return c.not ? `it is NOT true that ${say}` : say;
  }
  const idx = nodes.findIndex((n) => n.id === c.questionId);
  const ref = idx >= 0 ? `step ${idx + 1} ("${short(nodes[idx].text)}")` : "an earlier step";
  const val = q(c.value ?? "");
  switch (c.op) {
    case "is":
      return `the answer to ${ref} was "${val}"`;
    case "is_not":
      return `the answer to ${ref} was not "${val}"`;
    case "contains":
      return `the answer to ${ref} mentions "${val}"`;
    case "answered":
      return `${ref} has been answered`;
    case "not_answered":
      return `${ref} has not been answered`;
    default:
      return `a condition on ${ref} holds`;
  }
}

/** Short human label for a condition (editor badges), e.g. "water leak" or "Do you have a pet? is yes". */
export function conditionBadge(c: QCond, nodes: QNode[]): string {
  if (c.type === "fact") {
    const f = factOf(c.fact ?? "");
    return `${c.not ? "NOT " : ""}${f?.label ?? "condition"}`;
  }
  const n = nodes.find((x) => x.id === c.questionId);
  const op = OPS.find((o) => o.key === c.op)?.label ?? "";
  const needs = OPS.find((o) => o.key === c.op)?.needsValue;
  return `${short(n?.text ?? "earlier question", 40)} ${op}${needs ? ` "${c.value ?? ""}"` : ""}`;
}

/**
 * The numbered steps for one flow. Every step is on its own numbered block with REQUIRED or
 * OPTIONAL, and "Ask ONLY IF ..." wherever it has conditions, so the branches survive intact.
 */
export function composeFlowSteps(nodes: QNode[]): string {
  if (nodes.length === 0) return "(no steps)";
  return nodes
    .map((n, i) => {
      const tag = n.required ? "REQUIRED" : "OPTIONAL";
      const isQuestion = n.kind === "ask";
      const body = isQuestion
        ? /\?\s*$/.test(n.text.trim())
          ? `Ask: "${q(n.text)}"`
          : `Ask about: ${q(n.text)} (as ONE short question)`
        : `Say (a statement, not a question): "${q(n.text)}"`;
      const lines = [`${i + 1}. ${tag}. ${body}`];
      if (isQuestion && n.answerKind === "yesno") lines.push("   Expect a yes or no.");
      if (isQuestion && n.field?.trim()) lines.push(`   Record the answer in: ${q(n.field)}`);
      const when = n.when ?? [];
      if (when.length) {
        lines.push(`   Ask ONLY IF ${when.map((c) => conditionText(c, nodes)).join(" AND ")}. Otherwise skip this step completely.`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

/** The step rules that go under every flow. */
export const STEP_RULES =
  "How to run these steps: work down them in order, ONE step per turn. Do a step only when it applies (check its \"Ask ONLY IF\" line) and is not already answered or known. REQUIRED steps come first; OPTIONAL steps only after every applicable REQUIRED step is done, and never when the caller sounds rushed or upset. If the caller answers several steps at once, accept them all and move on to the next one still missing.";

/** One titled flow section for the prompt. */
export function composeFlowSection(title: string, applies: string, nodes: QNode[]): string {
  return `${title} (use when ${applies}):
${composeFlowSteps(nodes)}
${STEP_RULES}`;
}
