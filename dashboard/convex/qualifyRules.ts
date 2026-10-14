/**
 * The property's qualification rules, as a pure function.
 *
 * Extracted so the voice agent and the WhatsApp bot cannot drift apart on who qualifies.
 * Two copies of this logic would mean a caller could be told "yes" on WhatsApp and "no" on the
 * phone for the same facts, which is exactly the failure this boundary exists to prevent:
 * the model never decides qualification, this code does.
 *
 * Deliberately knows nothing about either channel — no conversation ids, no database, no
 * network. Inputs in, decision out.
 */

export type Unit = {
  bedrooms: string;
  rentMin: number;
  rentMax: number;
  available: boolean;
};

export type Property = {
  name: string;
  units: Unit[];
  petsAllowed: boolean;
};

export type QualifyInput = {
  bedrooms?: string;
  budget?: number;
  petsWanted?: boolean;
};

/**
 * A property manager's own pre-screening question, defined in the dashboard.
 *
 * `criterion` is what separates the two kinds. Absent, the answer is recorded on the lead and
 * is incapable of affecting the decision. Present, it is a real rule applied here — by this
 * function, never by the model.
 */
export type ScreeningCriterion =
  | { kind: "yes_no"; mustBe: boolean }
  | { kind: "number"; op: "gte" | "lte"; value: number }
  | { kind: "choice"; allowed: string[] };

export type ScreeningQuestion = {
  key: string;
  question: string;
  answerKind: "yes_no" | "number" | "choice" | "text";
  choices?: string[];
  criterion?: ScreeningCriterion;
};

/** One spoken answer, already normalized to a real type by the model's tool-call schema. */
export type ScreeningAnswer = {
  key: string;
  value: string | number | boolean;
};

export type QualifyResult = {
  qualifies: boolean;
  disqualifyReason?: string;
  // True when a numeric answer (budget, or a property manager's own number criterion) missed
  // the mark by only a small margin — worth telling the agent to say so warmly and offer a
  // human follow-up, rather than a flat no. Never set for a categorical failure (no unit of
  // that type, pets not allowed, a choice/yes-no criterion) — those have no notion of "close",
  // and the qualification decision itself never changes because of this: rules stay rules.
  nearMiss?: boolean;
  // Only ever set alongside a near miss on budget specifically — never on a property manager's
  // own numeric question (credit score, income, ...). A stated budget is something the caller
  // can reconsider on the spot; a fact like a credit score is not, so only budget gets asked
  // "would you be able to go up to X?" This is always the unit's real minimum rent, never a
  // number invented for the moment — asking it and having them revise their own answer is not
  // the model deciding qualification, it's the caller changing their input.
  nearMissBudgetTarget?: number;
};

// How close a numeric shortfall must be to the threshold to count as "close enough to be worth
// a follow-up" rather than a flat no. A fraction of the threshold itself, not a fixed dollar
// figure, since a $100 gap means something different on a $700 studio than a $3,000 unit. This
// is a tone judgment call, not a fact about any one property — a manager who wants a different
// band should say so.
const NEAR_MISS_BAND = 0.1;

function isNearMiss(shortfall: number, threshold: number): boolean {
  return threshold > 0 && shortfall > 0 && shortfall <= threshold * NEAR_MISS_BAND;
}

/**
 * Only three things can disqualify someone: no available unit of the type they want, a budget
 * below that unit's floor, or pets at a property that doesn't allow them. Nothing about how
 * the person writes, their name, or anything else they mention may ever factor in.
 *
 * Note `moveInDate` is captured elsewhere but is deliberately not a rule — it never has been.
 *
 * On top of those three, a property manager may define their own questions and mark some of
 * them as criteria. Those are applied after the built-ins, so a hard availability or budget
 * failure still wins and still gives the clearer reason. A custom question with no criterion,
 * or with no answer captured, can never disqualify anyone.
 *
 * The decision itself is exactly as strict as before — a near miss still means qualifies: false.
 * `nearMiss` only changes how the agent is told to talk about it, never whether a tour gets
 * offered; see convex/tourPrompt.ts and the LEASING_PROMPT step this feeds.
 */
export function evaluateQualification(
  property: Property,
  input: QualifyInput,
  questions: ScreeningQuestion[] = [],
  answers: ScreeningAnswer[] = [],
): QualifyResult {
  const unit = property.units.find((u) => u.bedrooms === input.bedrooms);

  if (!unit || !unit.available) {
    return {
      qualifies: false,
      disqualifyReason: `No available ${input.bedrooms} units right now.`,
    };
  }

  if (typeof input.budget === "number" && input.budget < unit.rentMin) {
    const nearMiss = isNearMiss(unit.rentMin - input.budget, unit.rentMin);
    return {
      qualifies: false,
      disqualifyReason: `Rent for a ${input.bedrooms} starts at $${unit.rentMin}, above the stated budget.`,
      nearMiss,
      nearMissBudgetTarget: nearMiss ? unit.rentMin : undefined,
    };
  }

  if (input.petsWanted === true && !property.petsAllowed) {
    return {
      qualifies: false,
      disqualifyReason: `${property.name} does not allow pets.`,
    };
  }

  for (const question of questions) {
    if (!question.criterion) continue;
    const answer = answers.find((a) => a.key === question.key);
    // No answer is not a failure. A caller who was never asked, or whose answer the model
    // could not type, must not be disqualified by silence — completeness is enforced up front
    // by missingScreeningKeys instead.
    if (answer === undefined) continue;

    const failure = failedCriterion(question, answer.value);
    if (failure) return { qualifies: false, disqualifyReason: failure.reason, nearMiss: failure.nearMiss };
  }

  return { qualifies: true };
}

/**
 * Applies one manager-defined criterion to one answer. Returns the reason it failed plus
 * whether it was close, or undefined if it passed.
 *
 * A value of the wrong runtime type passes rather than fails, for the same reason a missing
 * answer does: the caller answered something, we just could not read it, and a person should
 * never be turned away by our own parsing gap.
 */
function failedCriterion(
  question: ScreeningQuestion,
  value: string | number | boolean,
): { reason: string; nearMiss: boolean } | undefined {
  const criterion = question.criterion;
  if (!criterion) return undefined;

  switch (criterion.kind) {
    case "yes_no": {
      if (typeof value !== "boolean") return undefined;
      if (value === criterion.mustBe) return undefined;
      return {
        reason: `${question.question} — answered ${value ? "yes" : "no"}, which does not meet this property's requirement.`,
        nearMiss: false, // a yes/no answer has no notion of "close"
      };
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return undefined;
      const passes = criterion.op === "gte" ? value >= criterion.value : value <= criterion.value;
      if (passes) return undefined;
      const bound = criterion.op === "gte" ? "at least" : "no more than";
      return {
        reason: `${question.question} — answered ${value}, but this property requires ${bound} ${criterion.value}.`,
        nearMiss: isNearMiss(Math.abs(value - criterion.value), criterion.value),
      };
    }
    case "choice": {
      if (typeof value !== "string") return undefined;
      const normalized = value.trim().toLowerCase();
      const ok = criterion.allowed.some((a) => a.trim().toLowerCase() === normalized);
      if (ok) return undefined;
      return {
        reason: `${question.question} — answered "${value}", which this property does not accept.`,
        nearMiss: false, // one option from a list isn't "close" to another
      };
    }
  }
}

/**
 * Which criteria questions have not been answered yet. Used to stop a decision being made on
 * a half-filled screening: an unanswered criterion cannot disqualify (see above), so without
 * this check a caller could qualify simply by never being asked.
 *
 * Capture-only questions are deliberately absent from this — a manager who wants a note for
 * their own reference should not be able to block a lead by adding one.
 */
export function missingScreeningKeys(
  questions: ScreeningQuestion[],
  answers: ScreeningAnswer[],
): string[] {
  return questions
    .filter((q) => q.criterion && !answers.some((a) => a.key === q.key))
    .map((q) => q.key);
}

/** The five fields that must all be present before a qualification decision is meaningful. */
export function hasAllQualificationFields(input: {
  bedrooms?: string;
  moveInDate?: string;
  budget?: number;
  petsWanted?: boolean;
  callerName?: string;
  callerPhone?: string;
}): boolean {
  return (
    Boolean(input.bedrooms) &&
    Boolean(input.moveInDate) &&
    typeof input.budget === "number" &&
    typeof input.petsWanted === "boolean" &&
    Boolean(input.callerName) &&
    Boolean(input.callerPhone)
  );
}

/**
 * Turns whatever the model put in `screening_answers` into typed values the rules can use.
 *
 * The model is asked for a JSON object keyed by question key, and usually delivers exactly
 * that. This exists for when it doesn't: "yes" instead of true, "$1,200" instead of 1200, a
 * choice in different casing than the manager typed. The stored answerKind tells us what the
 * value was supposed to be, so the conversion is deterministic rather than a guess.
 *
 * Anything that cannot be converted is DROPPED rather than coerced to a default. A dropped
 * answer reads downstream as "not answered", which means the caller gets asked again instead
 * of being judged on a value we invented for them.
 */
export function coerceScreeningAnswers(
  questions: ScreeningQuestion[],
  raw: unknown,
): ScreeningAnswer[] {
  const parsed = parseAnswerBag(raw);
  if (!parsed) return [];

  const answers: ScreeningAnswer[] = [];
  for (const question of questions) {
    const value = coerceOne(question, parsed[question.key]);
    if (value !== undefined) answers.push({ key: question.key, value });
  }
  return answers;
}

/** Accepts the JSON string the tool schema asks for, or an already-parsed object. */
function parseAnswerBag(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A non-JSON string means the model ignored the format. Nothing here is salvageable
    // without guessing which answer belongs to which question, so treat it as no answers.
  }
  return undefined;
}

const TRUEY = new Set(["true", "yes", "y", "yeah", "yep", "correct", "1"]);
const FALSEY = new Set(["false", "no", "n", "nope", "none", "0"]);

function coerceOne(
  question: ScreeningQuestion,
  value: unknown,
): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;

  switch (question.answerKind) {
    case "yes_no": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
      if (typeof value !== "string") return undefined;
      const word = value.trim().toLowerCase();
      if (TRUEY.has(word)) return true;
      if (FALSEY.has(word)) return false;
      return undefined;
    }
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value !== "string") return undefined;
      // Strips currency symbols, thousands separators and stray words ("about 720").
      const digits = value.replace(/[^0-9.\-]/g, "");
      if (!digits || digits === "-" || digits === ".") return undefined;
      const parsed = Number.parseFloat(digits);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "choice": {
      if (typeof value !== "string") return undefined;
      const word = value.trim().toLowerCase();
      if (!word) return undefined;
      // Returns the manager's own spelling, not the caller's, so stored answers and the
      // criterion's allowed list stay directly comparable.
      const match = (question.choices ?? []).find((c) => c.trim().toLowerCase() === word);
      return match ?? undefined;
    }
    case "text": {
      const text = typeof value === "string" ? value.trim() : String(value).trim();
      return text || undefined;
    }
  }
}
