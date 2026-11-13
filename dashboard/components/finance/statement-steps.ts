// The statement page's guided steps (pure, no React or Convex imports, so node tests load it).
// Spec: docs/specs/ros-build-spec.md 6.3. The page splits the draft into five steps:
//   1 Check · 2 Money in · 3 Money out · 4 Fees & payout · 5 Review & finalize
// This module decides which step is open, each step's status dot, which warnings go where (and the
// one-click action each one offers), the per-property line groups, and the totals bar figures.
// Every amount here is a server figure: totals are read from the engine's result, and a subtotal is
// only a sum of the server's own line amounts.
import { warningTarget, ANCHOR } from "./warning-links";

export type StepId = "check" | "in" | "out" | "payout" | "review";

export const STEPS: readonly { id: StepId; label: string; hint: string }[] = [
  { id: "check", label: "Check", hint: "Things to fix or confirm" },
  { id: "in", label: "Money in", hint: "Rent and other income" },
  { id: "out", label: "Money out", hint: "Work orders and expenses" },
  { id: "payout", label: "Fees & payout", hint: "Fee, owner draw, adjustments" },
  { id: "review", label: "Review & finalize", hint: "Summary, finalize, PDF" },
];

const STEP_IDS = new Set<string>(STEPS.map((s) => s.id));

export function isStepId(s: unknown): s is StepId {
  return typeof s === "string" && STEP_IDS.has(s);
}

/**
 * The step to show for `?step=`. A draft opens on Check; a final (or discarded) statement opens on
 * Review. Any step can be opened directly (the steps are not forced).
 */
export function readStep(raw: string | null | undefined, status: string): StepId {
  if (isStepId(raw)) return raw;
  return status === "draft" ? "check" : "review";
}

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

export function nextStep(id: StepId): StepId | null {
  const i = stepIndex(id);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1].id : null;
}

export function prevStep(id: StepId): StepId | null {
  const i = stepIndex(id);
  return i > 0 ? STEPS[i - 1].id : null;
}

export function stepLabel(id: StepId): string {
  return STEPS.find((s) => s.id === id)?.label ?? id;
}

// --- warnings --------------------------------------------------------------------------------------

export type WarningInput = { code: string; message: string; propertyId?: string; workOrderId?: string; rentMonth?: string };

/**
 * "fix" = blocking (red); "look" = worth a look (amber, a to-do the accountant can clear);
 * "note" = informational only, collapsed under Notes (nothing to do on this statement).
 */
export type Tone = "fix" | "look" | "note";

/** Info warnings that are context, not a to-do. */
const NOTE_CODES = new Set(["NO_DRAW", "PERIOD_OPEN"]);

export function warningTone(code: string, blocking: boolean): Tone {
  if (blocking) return "fix";
  return NOTE_CODES.has(code) ? "note" : "look";
}

/** The step a warning is about (its status dot shows there). Anything not listed is a Check item. */
const WARNING_STEP: Readonly<Record<string, StepId>> = {
  RENT_UNPAID: "in",
  RENT_PAYMENT_BEFORE_START: "in",
  WO_MISSING_BILL: "out",
  WO_AWAITING_REVIEW: "out",
  WO_BEFORE_START: "out",
  WO_BEFORE_START_MISSING_BILL: "out",
  AMOUNT_TOO_LARGE: "payout",
  PAYEE_MISSING: "payout",
  FEE_NOT_SET: "payout",
  NO_DRAW: "payout",
  NEGATIVE_ENDING: "payout",
  DEPOSITS_NOT_SET: "payout",
  PERIOD_OPEN: "review",
};

export function warningStep(code: string): StepId {
  return WARNING_STEP[code] ?? "check";
}

/**
 * What the Check step offers for a warning:
 * - "opening": set the property's opening balance in place (owners.updateLinkSettings); `offerZero`
 *   adds the one-click "It's $0.00".
 * - "deposits": "None held" (every unit's deposit = 0, owners.setUnitDeposit) or "Enter deposits…".
 * - "href": another page (warning-links.ts).
 * - "step": another step of this page, optionally revealing a section there.
 */
export type QuickAction =
  | { kind: "opening"; propertyId: string; offerZero: boolean }
  | { kind: "deposits"; propertyId: string }
  | { kind: "href"; href: string; label: string }
  | { kind: "step"; step: StepId; reveal: string | null; label: string };

export function warningAction(w: WarningInput, ownerId: string): QuickAction | null {
  const pid = w.propertyId;
  if (w.code === "OPENING_BALANCE_NOT_SET" && pid) return { kind: "opening", propertyId: pid, offerZero: true };
  if (w.code === "PREV_OWNER_BALANCE" && pid) return { kind: "opening", propertyId: pid, offerZero: false };
  if (w.code === "DEPOSITS_NOT_SET" && pid) return { kind: "deposits", propertyId: pid };
  const step = warningStep(w.code);
  const t = warningTarget(w, ownerId);
  if (t === null) {
    // Nowhere else to fix it, but it is about another step: offer to open that step.
    if (step === "in" || step === "out" || step === "payout") {
      return { kind: "step", step, reveal: null, label: `Open ${stepLabel(step)} →` };
    }
    return null;
  }
  if (t.kind === "href") return t;
  // The only in-page target is the "Left off this statement" section, which lives on Money in
  // (rent payments) and Money out (work orders) now.
  return {
    kind: "step",
    step: step === "out" ? "out" : "in",
    reveal: t.anchor === ANCHOR.leftOff ? ANCHOR.leftOff : null,
    label: t.label,
  };
}

export type CheckItem = {
  key: string;
  code: string;
  message: string;
  tone: Tone;
  step: StepId;
  propertyId: string | null;
  action: QuickAction | null;
};

export type CheckGroup = {
  /** null = about the whole statement (owner, payee, unpaid rent, accounts …). */
  propertyId: string | null;
  name: string;
  fix: CheckItem[];
  look: CheckItem[];
};

export type GroupedWarnings = {
  statement: CheckGroup;
  /** One per statement property, in statement order (including properties with nothing to do). */
  properties: CheckGroup[];
  notes: CheckItem[];
  fixCount: number;
  lookCount: number;
};

/**
 * The Check step's lists: blocking first then worth-a-look, grouped by property; the statement-wide
 * ones in their own group; notes apart. A warning about a property that isn't on the statement goes
 * in the statement group (never dropped).
 */
export function groupWarnings(
  warnings: { blocking: WarningInput[]; info: WarningInput[] },
  properties: readonly { propertyId: string; name: string }[],
  ownerId: string,
): GroupedWarnings {
  const statement: CheckGroup = { propertyId: null, name: "This statement", fix: [], look: [] };
  const groups = properties.map((p): CheckGroup => ({ propertyId: p.propertyId, name: p.name, fix: [], look: [] }));
  const byId = new Map(groups.map((g) => [g.propertyId as string, g]));
  const notes: CheckItem[] = [];
  const all: [WarningInput, boolean][] = [
    ...warnings.blocking.map((w): [WarningInput, boolean] => [w, true]),
    ...warnings.info.map((w): [WarningInput, boolean] => [w, false]),
  ];
  all.forEach(([w, blocking], i) => {
    const group = (w.propertyId && byId.get(w.propertyId)) || statement;
    const item: CheckItem = {
      key: `${w.code}:${w.propertyId ?? ""}:${w.workOrderId ?? w.rentMonth ?? ""}:${i}`,
      code: w.code,
      message: w.message,
      tone: warningTone(w.code, blocking),
      step: warningStep(w.code),
      propertyId: group.propertyId,
      action: warningAction(w, ownerId),
    };
    if (item.tone === "note") notes.push(item);
    else if (item.tone === "fix") group.fix.push(item);
    else group.look.push(item);
  });
  const every = [statement, ...groups];
  return {
    statement,
    properties: groups,
    notes,
    fixCount: every.reduce((n, g) => n + g.fix.length, 0),
    lookCount: every.reduce((n, g) => n + g.look.length, 0),
  };
}

// --- step status -----------------------------------------------------------------------------------

/** ✓ done · ! needs attention (something blocks finalizing) · • info (worth a look / not finished). */
export type StepStatus = "done" | "attention" | "info";

export type StepState = { status: StepStatus; fix: number; look: number };

/**
 * Each step's dot. Check counts every warning (it is the to-do list); the other steps count the
 * warnings about them. Review is "attention" while anything blocks, otherwise "info" until the
 * statement is final. A final or discarded statement is read-only: every step is done.
 */
export function stepStates(input: {
  status: string;
  warnings: { blocking: readonly WarningInput[]; info: readonly WarningInput[] };
}): Record<StepId, StepState> {
  const out = Object.fromEntries(STEPS.map((s) => [s.id, { status: "done", fix: 0, look: 0 }])) as Record<StepId, StepState>;
  if (input.status !== "draft") return out;
  const count = (w: WarningInput, blocking: boolean) => {
    const tone = warningTone(w.code, blocking);
    if (tone === "note") return;
    const step = warningStep(w.code);
    const targets: StepId[] = step === "check" ? ["check"] : ["check", step];
    for (const t of targets) {
      if (tone === "fix") out[t].fix += 1;
      else out[t].look += 1;
    }
  };
  for (const w of input.warnings.blocking) count(w, true);
  for (const w of input.warnings.info) count(w, false);
  for (const s of STEPS) {
    const st = out[s.id];
    st.status = st.fix > 0 ? "attention" : st.look > 0 ? "info" : "done";
  }
  const blocking = input.warnings.blocking.length;
  out.review = { status: blocking > 0 ? "attention" : "info", fix: blocking, look: 0 };
  return out;
}

// --- lines -----------------------------------------------------------------------------------------

export type StepLine = { side: "addition" | "subtraction"; kind: string; propertyId: string; amountCents: number };

/** Money in = every addition; Money out = subtractions except the management fee and owner draw (Fees & payout). */
export function linesForStep<L extends StepLine>(lines: readonly L[], step: "in" | "out"): L[] {
  return step === "in"
    ? lines.filter((l) => l.side === "addition")
    : lines.filter((l) => l.side === "subtraction" && l.kind !== "fee" && l.kind !== "draw");
}

export type PropertyLines<L> = { propertyId: string; name: string; lines: L[]; subtotalCents: number };

/**
 * Lines grouped by property in statement order (every property, even one with no lines). The
 * subtotal is the sum of the server's line amounts. A line for a property not on the list gets its
 * own group at the end (never dropped).
 */
export function groupByProperty<L extends StepLine & { propertyName?: string }>(
  lines: readonly L[],
  properties: readonly { propertyId: string; name: string }[],
): PropertyLines<L>[] {
  const groups = properties.map((p): PropertyLines<L> => ({ propertyId: p.propertyId, name: p.name, lines: [], subtotalCents: 0 }));
  const byId = new Map(groups.map((g) => [g.propertyId, g]));
  for (const l of lines) {
    let g = byId.get(l.propertyId);
    if (!g) {
      g = { propertyId: l.propertyId, name: l.propertyName ?? "Other property", lines: [], subtotalCents: 0 };
      byId.set(l.propertyId, g);
      groups.push(g);
    }
    g.lines.push(l);
    g.subtotalCents += l.amountCents;
  }
  return groups;
}

/** What finalizing writes, for the Review step's "What gets locked" list. */
export function lockSummary(
  lines: readonly { kind: string; sourceLabel: string; rentForMonth?: string }[],
): { workOrders: string[]; rentPayments: number; transactions: number; fees: number; draws: number } {
  const out = { workOrders: [] as string[], rentPayments: 0, transactions: 0, fees: 0, draws: 0 };
  for (const l of lines) {
    if (l.kind === "wo") out.workOrders.push(l.sourceLabel);
    else if (l.kind === "fee") out.fees += 1;
    else if (l.kind === "draw") out.draws += 1;
    else if (l.kind === "entry" && typeof l.rentForMonth === "string" && l.rentForMonth !== "") out.rentPayments += 1;
    else out.transactions += 1;
  }
  return out;
}

// --- totals bar ------------------------------------------------------------------------------------

type Cols = { byProperty: number[]; total: number };

export type Totals = {
  incomeCents: number;
  /** The engine's expenses, which include the management fee. */
  expensesCents: number;
  feeCents: number;
  drawCents: number;
  endingCents: number;
  availableCents: number;
};

/**
 * The totals bar, read from the engine's result (never recomputed): the summary rows, and the fee
 * as the sum of each property's generated fee (0 when skipped).
 */
export function totalsOf(result: {
  summary: { income: Cols; expenses: Cols; ownerDraws: Cols; ending: Cols; available: Cols };
  generated: readonly { fee: { amountCents: number } }[];
}): Totals {
  return {
    incomeCents: result.summary.income.total,
    expensesCents: result.summary.expenses.total,
    feeCents: result.generated.reduce((n, g) => n + g.fee.amountCents, 0),
    drawCents: result.summary.ownerDraws.total,
    endingCents: result.summary.ending.total,
    availableCents: result.summary.available.total,
  };
}
