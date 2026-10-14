/**
 * The five questions Sarah has always asked, as data rather than prose.
 *
 * A pure module with no Convex function definitions so the Screening page can import the
 * labels directly — same shape as convex/waPrompt.ts and convex/screeningPrompt.ts.
 *
 * Two of the five cannot be switched off, and the reason is mechanical rather than a policy
 * choice. `bedrooms` is the lookup key evaluateQualification uses to find the unit, so without
 * it no unit matches, every caller is disqualified as "No available undefined units", and the
 * rent check that hangs off that same unit dies with it. `contact` is what request_tour sends
 * the confirmation text to. Both are structural; the other three are genuinely optional and
 * their rules simply do not fire when the answer is absent.
 */

export type CoreKey = "bedrooms" | "move_in_date" | "budget" | "pets" | "contact";

export type CoreQuestion = {
  key: CoreKey;
  label: string;
  /** Plain-English description of what Sarah asks, for the Screening page. */
  asks: string;
  /** The bullet rendered into the agent's prompt. */
  promptLine: string;
  canDisable: boolean;
  /** Shown in the UI next to a locked toggle, so it reads as a reason and not a bug. */
  lockedReason?: string;
  /** Whether turning this off also removes a qualification rule. */
  affectsQualification: boolean;
};

export const CORE_QUESTIONS: CoreQuestion[] = [
  {
    key: "bedrooms",
    label: "Unit type",
    asks: "Which unit type or bedroom count they want.",
    promptLine: "the unit type or bedroom count they want",
    canDisable: false,
    lockedReason:
      "This is how availability and rent are looked up. Without it every caller would be turned away.",
    affectsQualification: true,
  },
  {
    key: "move_in_date",
    label: "Move-in timeline",
    asks: "When they are looking to move in.",
    promptLine: "their move-in timeline",
    canDisable: true,
    affectsQualification: false,
  },
  {
    key: "budget",
    label: "Budget",
    asks: "Their monthly budget.",
    promptLine: "their budget range",
    canDisable: true,
    affectsQualification: true,
  },
  {
    key: "pets",
    label: "Pets",
    asks: "Whether they have pets, and what kind.",
    promptLine: "whether they have pets, and what kind if they do",
    canDisable: true,
    affectsQualification: true,
  },
  {
    key: "contact",
    label: "Name & phone",
    asks: "Their name and a callback number.",
    promptLine: "their name plus a callback number",
    canDisable: false,
    lockedReason:
      "Tour confirmations are texted to this number, and a lead with no way to reach it is not a lead.",
    affectsQualification: false,
  },
];

/** Keys a manager is allowed to switch off. Anything else in `disabled` is ignored. */
export const DISABLEABLE_KEYS: CoreKey[] = CORE_QUESTIONS.filter((q) => q.canDisable).map(
  (q) => q.key,
);

export function isEnabled(key: CoreKey, disabled: string[]): boolean {
  const question = CORE_QUESTIONS.find((q) => q.key === key);
  if (!question || !question.canDisable) return true;
  return !disabled.includes(key);
}

export function enabledCoreQuestions(disabled: string[]): CoreQuestion[] {
  return CORE_QUESTIONS.filter((q) => isEnabled(q.key, disabled));
}

/**
 * Renders the WHAT TO ASK block.
 *
 * The closing line is the important one. Without it, a model that has seen ten thousand
 * leasing conversations will ask about pets anyway out of sheer convention, and the manager
 * who switched pets off would still get pet questions on every call.
 */
export function coreBlock(disabled: string[]): string {
  const lines = enabledCoreQuestions(disabled).map((q) => `- ${q.promptLine}`);

  return `WHAT TO ASK EVERY LEASING CALLER:
${lines.join("\n")}

Ask for these conversationally, one or two at a time, not as an interrogation. If they
already told you one in passing, don't ask again. This list is exhaustive: if something is
not on it and not under EXTRA SCREENING QUESTIONS, this property has deliberately chosen not
to collect it — do not ask about it, do not bring it up, and do not send it to
check_qualification even if the caller volunteers it.`;
}
