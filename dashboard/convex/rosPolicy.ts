/**
 * Rental Owner Statement (ROS): rules as pure functions. Convex handlers call these and the
 * node tests cover them. Spec: docs/specs/ros-build-spec.md sections 4.4, 5.2, 5.3, 5.6 and 5.8.
 *
 * Pure: no Convex imports, erasable TypeScript only. Every user-facing string here is exact spec
 * wording; client forms and server handlers both use these functions, so their messages match.
 */

import {
  MAX_AMOUNT_CENTS,
  formatBps,
  formatCurrency,
  formatDate,
  formatMonth,
  isIsoDate,
  isMonth,
  monthOf,
  monthStart,
  naturalCompare,
  nextMonth,
  normalizeNameKey,
  parseDollarsToCents,
  parsePercentToBpsUnbounded,
} from "./rosFormat";

// --- row types -----------------------------------------------------------------------------------

/** Must equal the literals of rowTypeValidator (rosValidators.ts checks this at compile time). */
export type RowType =
  | "income"
  | "owner_contribution"
  | "other_addition"
  | "expense"
  | "owner_draw"
  | "other_subtraction";

export const ROW_TYPES: readonly RowType[] = [
  "income",
  "owner_contribution",
  "other_addition",
  "expense",
  "owner_draw",
  "other_subtraction",
];

export const ADDITION_TYPES: ReadonlySet<RowType> = new Set<RowType>([
  "income",
  "owner_contribution",
  "other_addition",
]);
export const SUBTRACTION_TYPES: ReadonlySet<RowType> = new Set<RowType>([
  "expense",
  "owner_draw",
  "other_subtraction",
]);

export function isRowType(s: unknown): s is RowType {
  return typeof s === "string" && (ROW_TYPES as readonly string[]).includes(s);
}

/** Account kind labels (UI and ledgerAccounts.list `kindLabel`). Spec 5.1. */
export const KIND_LABELS: Readonly<Record<RowType, string>> = {
  income: "Income",
  expense: "Expense",
  owner_contribution: "Owner contribution",
  other_addition: "Other addition",
  other_subtraction: "Other subtraction",
  owner_draw: "Owner draw",
};

export const MAX_STATEMENT_LINES = 2000;

/** Finance (owner statements) is for the admin and accountant views only. */
export function canUseFinanceView(view: string): boolean {
  return view === "admin" || view === "accountant";
}

/** Column order: naturalCompare(name), then id. Returns a new array. */
export function sortProperties<T extends { id: string; name: string }>(ps: T[]): T[] {
  return [...ps].sort((a, b) => naturalCompare(a.name, b.name) || cmpStr(a.id, b.id));
}

/** Plain code-unit string order (deterministic, locale-free) for ids and keys. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- exact messages (spec 5.8) ---------------------------------------------------------------------

/** Builders for every 5.8 message, so server and client share one wording. */
export const MSG = {
  CO_OWNED: (property: string, ownerNames: string[]): string =>
    `${property} is listed under ${ownerNames.length} owners (${ownerNames.join(", ")}). Statements for it are paused until the ownership split is set.`,
  CREATE_NOT_OWNER: (property: string, legalName: string): string => `${property} doesn't belong to ${legalName}.`,
  CREATE_EXISTS: (property: string, status: "draft" | "final", month: string, ownerLegalName: string): string =>
    `${property} already has a ${status} statement for ${formatMonth(month)} (${ownerLegalName}). Open it instead.`,
  CREATE_OPEN_DRAFT: (property: string, draftMonth: string): string =>
    `${property} already has an open draft for ${formatMonth(draftMonth)}. Finalize or discard it first.`,
  CREATE_ALREADY_FINAL: (property: string, month: string): string =>
    `${formatMonth(month)} is already final for ${property}.`,
  CREATE_GAP: (property: string, lockedThrough: string): string =>
    `${property} has no final statement for ${formatMonth(nextMonth(lockedThrough))}. Generate and finalize that month first.`,
  CREATE_START_MONTH: (property: string, startMonth: string): string =>
    `Statements for ${property} start in ${formatMonth(startMonth)}. Create that month first.`,
  CREATE_FUTURE_MONTH: "You can't create a statement for a month that hasn't started.",
  CREATE_MONTH_MISSING: "Select the statement month.",
  PRIOR_NOT_FINAL: (property: string, prevMonthValue: string): string =>
    `${property} has no final statement for ${formatMonth(prevMonthValue)}. Finalize that month first.`,
  OWNER_CHANGED: (property: string, legalName: string): string =>
    `${property} is no longer linked to ${legalName}. Discard this draft and generate it again.`,
  WO_MISSING_BILL: (woNumber: number, property: string, unitLabel: string | null): string =>
    `WO-${woNumber} (${property}${unitLabel ? `, Unit ${unitLabel}` : ""}) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.`,
  FEE_NOT_SET: (legalName: string): string => `Set the management fee % for ${legalName} before finalizing.`,
  PAYEE_MISSING: (legalName: string): string => `Set the owner draw payee for ${legalName} before finalizing.`,
  ACCOUNTS_MISSING: "The account list isn't set up yet. Open Accounts once to create it.",
  TOO_MANY_LINES: "This statement has more than 2,000 transactions. Split it into fewer properties.",
  PERIOD_OPEN: (month: string): string =>
    `You can finalize ${formatMonth(month)} from ${formatDate(monthStart(nextMonth(month)))}.`,
  WO_AWAITING_REVIEW: (woNumber: number, property: string, completedDate: string): string =>
    `WO-${woNumber} (${property}) was completed on ${formatDate(completedDate)} but hasn't been closed by the office yet. It will go on a later statement once closed.`,
  OPENING_BALANCE_NOT_SET: (property: string): string =>
    `The opening cash balance for ${property} isn't set, so it starts at $0.00.`,
  DEPOSITS_NOT_SET: (property: string): string => `No security deposits are recorded for any unit at ${property}.`,
  NEGATIVE_ENDING: (property: string, endingCents: number): string =>
    `The ending cash balance for ${property} is negative (${formatCurrency(endingCents)}).`,
  NO_DRAW: (property: string, cashCents: number): string =>
    `No owner draw is suggested for ${property}: cash after expenses is ${formatCurrency(cashCents)}.`,
  ENTRY_LOCKED: (property: string, lockedThrough: string): string =>
    `${formatMonth(lockedThrough)} is final for ${property}. Date this transaction in ${formatMonth(nextMonth(lockedThrough))} or later.`,
  ENTRY_BEFORE_START: (property: string, startMonth: string): string =>
    `Statements for ${property} start in ${formatMonth(startMonth)}. Use a date on or after ${formatDate(monthStart(startMonth))}.`,
  ENTRY_FUTURE: "The date can't be in the future.",
  AMOUNT_TOO_LARGE: (which: "fee" | "draw", property: string): string =>
    `${which === "fee" ? "Management fee" : "Owner draw"} for ${property} is over $1,000,000.00. Check the transactions.`,
  PREV_OWNER_BALANCE: (prevOwner: string, endingCents: number, property: string): string =>
    `Previous owner ${prevOwner} ended with ${formatCurrency(endingCents)} for ${property}. Settle it on their statement or set this owner's opening balance.`,
  BEFORE_START_NOTE: "Completed before this owner's first statement month — include it only if it wasn't billed in Buildium",
  ENTRY_BEFORE_START_NOTE: "Dated before this owner's first statement month — include it only if it wasn't billed in Buildium",
  WO_BEFORE_START: (woNumbers: number[], property: string, startMonth: string): string =>
    `${woList(woNumbers)} (${property}) ${woNumbers.length === 1 ? "was" : "were"} completed before this owner's first statement month (${formatMonth(startMonth)}) and ${woNumbers.length === 1 ? "is" : "are"} left off this statement. Put ${woNumbers.length === 1 ? "it" : "them"} back from “Left off this statement” only if ${woNumbers.length === 1 ? "it wasn't" : "they weren't"} billed in Buildium.`,
  WO_BEFORE_START_MISSING_BILL: (woNumbers: number[], property: string, startMonth: string): string =>
    `${woList(woNumbers)} (${property}) ${woNumbers.length === 1 ? "was" : "were"} completed before this owner's first statement month (${formatMonth(startMonth)}) and ${woNumbers.length === 1 ? "has" : "have"} no bill amount, account or description, so ${woNumbers.length === 1 ? "it isn't" : "they aren't"} on this statement.`,
  START_MONTH_AFTER: (property: string, startMonth: string, month: string): string =>
    `Statements for ${property} start in ${formatMonth(startMonth)}, after ${formatMonth(month)}. Discard this draft, then check the first statement month.`,
  START_MONTH_DRAFT_OPEN: (property: string): string =>
    `${property} has an open draft statement. Finalize or discard it before changing the first statement month.`,
} as const;

function woList(numbers: number[]): string {
  return numbers.map((n) => `WO-${n}`).join(", ");
}

// --- creating a draft ------------------------------------------------------------------------------

export type PropertyStatementState = {
  id: string;
  name: string;
  ownerLinkCount: number;
  linkedToThisOwner: boolean;
  /** Legal names of ALL owners linked to the property (this owner included), for CO_OWNED. */
  coOwnerNames: string[];
  startMonth: string | null; // ownerProperties.startMonth
  /**
   * Final statements for this property (any owner): month + that statement's owner legal name.
   * (Spec 4.4 has `finalMonths: string[]`; the owner name is needed for the CREATE_EXISTS text.)
   */
  finals: { month: string; ownerName: string }[];
  openDrafts: { month: string; ownerName: string }[];
};

/**
 * null = OK, else the exact user message (5.8 CREATE_*). `today` = business date (YYYY-MM-DD).
 * Check order: month shape, future month, then rules 1-6 of spec 5.4.
 */
export function createDraftProblem(
  month: string,
  today: string,
  p: PropertyStatementState,
  ownerName: string,
): string | null {
  if (!isMonth(month)) return MSG.CREATE_MONTH_MISSING;
  if (month > monthOf(today)) return MSG.CREATE_FUTURE_MONTH;
  // 1. not this owner's property
  if (!p.linkedToThisOwner) return MSG.CREATE_NOT_OWNER(p.name, ownerName);
  // 2. co-owned
  if (p.ownerLinkCount >= 2) return MSG.CO_OWNED(p.name, p.coOwnerNames);
  // 3. a draft or final already exists for (p, month)
  const finalHere = p.finals.find((f) => f.month === month);
  if (finalHere) return MSG.CREATE_EXISTS(p.name, "final", month, finalHere.ownerName);
  const draftHere = p.openDrafts.find((d) => d.month === month);
  if (draftHere) return MSG.CREATE_EXISTS(p.name, "draft", month, draftHere.ownerName);
  // 4. an open draft in another month
  const otherDraft = [...p.openDrafts].sort((a, b) => cmpStr(a.month, b.month))[0];
  if (otherDraft) return MSG.CREATE_OPEN_DRAFT(p.name, otherDraft.month);
  // 5. months in order after the last final
  const locked = lockedThroughMonth(p.finals.map((f) => f.month));
  if (locked !== null) {
    if (month <= locked) return MSG.CREATE_ALREADY_FINAL(p.name, month);
    if (month !== nextMonth(locked)) return MSG.CREATE_GAP(p.name, locked);
    return null;
  }
  // 6. first statement must be the start month, when one is set
  if (p.startMonth && month !== p.startMonth) return MSG.CREATE_START_MONTH(p.name, p.startMonth);
  return null;
}

/**
 * Can this owner's link setting change? (owners.updateLinkSettings; only called when the value
 * actually changes.) null = OK.
 * - Only THIS owner's finals lock its opening balance and first statement month: after a property
 *   changes hands, the new owner can still set them although the property has the old owner's finals.
 * - The first statement month can't change while the property has an open draft (any owner): the
 *   draft was built with the old one.
 */
export function linkSettingProblem(
  field: "openingBalanceCents" | "startMonth",
  propertyName: string,
  ownerFinalCount: number,
  openDraftCount: number,
): string | null {
  if (ownerFinalCount > 0) {
    return field === "openingBalanceCents"
      ? `The opening balance can't change after ${propertyName} has a final statement.`
      : `The first statement month can't change after ${propertyName} has a final statement.`;
  }
  if (field === "startMonth" && openDraftCount > 0) return MSG.START_MONTH_DRAFT_OPEN(propertyName);
  return null;
}

/** Latest final month for the property, or null. Months <= it are locked. */
export function lockedThroughMonth(finalMonths: string[]): string | null {
  let max: string | null = null;
  for (const m of finalMonths) if (max === null || m > max) max = m;
  return max;
}

/**
 * Ledger date rule for add/edit (5.8 ENTRY_*). null = OK. `date` must already be a real
 * YYYY-MM-DD (validateEntryFields checks that). Order: future, locked month, before start month.
 */
export function entryDateProblem(
  date: string,
  today: string,
  p: { name: string; lockedThrough: string | null; startMonth: string | null },
): string | null {
  if (date > today) return MSG.ENTRY_FUTURE;
  if (p.lockedThrough !== null && monthOf(date) <= p.lockedThrough) return MSG.ENTRY_LOCKED(p.name, p.lockedThrough);
  if (p.startMonth && date < monthStart(p.startMonth)) return MSG.ENTRY_BEFORE_START(p.name, p.startMonth);
  return null;
}

/**
 * The date rule for ADD (`currentDate` undefined) or EDIT of an unbilled manual row. On edit the
 * rule runs only when the date changes: an unbilled row dated in a locked month (it is carried
 * forward) keeps its date and can have its other fields corrected; moving it into or within a
 * locked month is still refused.
 */
export function entryChangeDateProblem(
  date: string,
  currentDate: string | undefined,
  today: string,
  p: { name: string; lockedThrough: string | null; startMonth: string | null },
): string | null {
  if (currentDate !== undefined && date === currentDate) return null;
  return entryDateProblem(date, today, p);
}

/** Finalizing needs the period to have ended. null = OK, else PERIOD_OPEN. */
export function finalizeProblem(month: string, today: string): string | null {
  return today < monthStart(nextMonth(month)) ? MSG.PERIOD_OPEN(month) : null;
}

// --- work orders onto a draft ----------------------------------------------------------------------

export type WoForBilling = {
  id: string;
  number: number;
  propertyId: string;
  unitLabel: string;
  status: string;
  completedDate: string | null;
  billAmountCents?: number;
  noOwnerCharge?: boolean;
  billedStatementId?: string;
  workCompletedDescription?: string;
  rosAccountId?: string;
};

/**
 * True when a work order is waiting to go on an owner statement: closed, chargeable, not billed.
 * workOrders.rosPending stores it so the ROS build reads only these (index by_property_and_rosPending);
 * reviewClose / updateBilling set it, finalize clears it, workOrderBilling.backfillRosPending fills old rows.
 */
export function rosPendingOf(wo: { status: string; noOwnerCharge?: boolean; billedStatementId?: string }): boolean {
  return wo.status === "reviewed_closed" && wo.noOwnerCharge !== true && wo.billedStatementId === undefined;
}

/**
 * The month a ledger row belongs to in the ledger list: its posted date (set at finalize: the date
 * on the statement) when it has one, else its own date.
 */
export function ledgerRowInMonth(e: { date: string; postedDate?: string }, from: string, to: string): boolean {
  const d = e.postedDate ?? e.date;
  return d >= from && d <= to;
}

function hasBillingFields(wo: WoForBilling): boolean {
  const amt = wo.billAmountCents;
  return (
    typeof amt === "number" &&
    Number.isSafeInteger(amt) &&
    amt > 0 &&
    amt <= MAX_AMOUNT_CENTS &&
    typeof wo.rosAccountId === "string" &&
    wo.rosAccountId !== "" &&
    typeof wo.workCompletedDescription === "string" &&
    wo.workCompletedDescription.trim() !== ""
  );
}

const byCompletion = (a: WoForBilling, b: WoForBilling): number =>
  cmpStr(a.completedDate ?? "", b.completedDate ?? "") || a.number - b.number || cmpStr(a.id, b.id);

/**
 * Splits WOs for one draft. floorDate = monthStart(startMonth ?? statement month) (ASSUMPTION A9).
 * - billable: reviewed_closed, not noOwnerCharge, not billed, floorDate <= completedDate <= periodEnd,
 *   with bill amount (integer 1..MAX), account and description.
 * - missingBill: same, but bill amount / account / description missing -> blocking WO_MISSING_BILL.
 * - awaitingReview: status "completed", floorDate <= completedDate <= periodEnd -> info WO_AWAITING_REVIEW.
 *   (The floor also applies here: the "will go on a later statement" text is about the owner's
 *   statements, and a WO completed before the start month is handled by the two lists below.)
 * - beforeFloor: like billable, but completed before floorDate. These are NOT dropped: the build
 *   shows them as lines that are excluded by default (they may have been billed in Buildium before
 *   the switch), so the accountant can include them with one click.
 * - beforeFloorMissingBill: like missingBill, but completed before floorDate -> info only.
 * Each list is sorted by completedDate, then WO number.
 */
export function selectWorkOrders(
  wos: WoForBilling[],
  periodEnd: string,
  floorDate: string,
): {
  billable: WoForBilling[];
  missingBill: WoForBilling[];
  awaitingReview: WoForBilling[];
  beforeFloor: WoForBilling[];
  beforeFloorMissingBill: WoForBilling[];
} {
  const billable: WoForBilling[] = [];
  const missingBill: WoForBilling[] = [];
  const awaitingReview: WoForBilling[] = [];
  const beforeFloor: WoForBilling[] = [];
  const beforeFloorMissingBill: WoForBilling[] = [];
  for (const wo of wos) {
    const d = wo.completedDate;
    if (d === null || !isIsoDate(d) || d > periodEnd) continue;
    if (wo.billedStatementId) continue;
    const early = d < floorDate;
    if (wo.status === "reviewed_closed") {
      if (wo.noOwnerCharge === true) continue;
      const ok = hasBillingFields(wo);
      if (early) (ok ? beforeFloor : beforeFloorMissingBill).push(wo);
      else (ok ? billable : missingBill).push(wo);
    } else if (wo.status === "completed" && !early) {
      awaitingReview.push(wo);
    }
  }
  for (const list of [billable, missingBill, awaitingReview, beforeFloor, beforeFloorMissingBill]) list.sort(byCompletion);
  return { billable, missingBill, awaitingReview, beforeFloor, beforeFloorMissingBill };
}

// --- field validation ------------------------------------------------------------------------------

export type FieldResult<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

type Check = { field: string; run: () => string | null };

function firstFailure(checks: Check[]): { field: string; message: string } | null {
  for (const c of checks) {
    const m = c.run();
    if (m !== null) return { field: c.field, message: m };
  }
  return null;
}

function allFailures(checks: Check[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of checks) {
    if (c.field in out) continue;
    const m = c.run();
    if (m !== null) out[c.field] = m;
  }
  return out;
}

/** "", null, undefined and whitespace-only are all "not given". */
function blank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function trimmed(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Money from a form (typed text) or from the server (cents). Text goes through
 * parseDollarsToCents; a number must already be an integer. Returns:
 * "missing" | "invalid" | cents (a non-negative or negative safe integer).
 */
function readMoney(v: string | number | null | undefined): "missing" | "invalid" | number {
  if (blank(v)) return "missing";
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : "invalid";
  if (typeof v === "string") {
    const c = parseDollarsToCents(v);
    return c === null ? "invalid" : c;
  }
  return "invalid";
}

// Entry (manual ledger transaction), spec 5.3 -----------------------------------------------------

export const ENTRY_MSG = {
  propertyMissing: "Select the property this transaction belongs to.",
  unitNotInProperty: (property: string): string => `That unit isn't part of ${property}.`,
  dateMissing: "Enter the transaction date.",
  dateInvalid: "Enter a real date.",
  dateFuture: "The date can't be in the future.",
  accountMissing: "Select the account for this transaction.",
  accountOff: (name: string): string => `The account “${name}” is turned off. Pick another account.`,
  /** Rent Income is recorded only on the Payments page (2026-11-12); other income accounts are fine. */
  rentOnPaymentsPage: "Record rent on the Payments page.",
  counterpartyMissing: "Enter the name that prints on the statement (tenant, vendor or payee).",
  counterpartyLong: "Keep the name under 120 characters.",
  memoMissing: "Enter a memo (it prints on the statement).",
  memoLong: "Keep the memo under 300 characters.",
  amountMissing: "Enter the amount.",
  amountInvalid: "Enter the amount like 1,250.00.",
  amountNotPositive: "The amount must be more than $0.00.",
  amountTooBig: "The amount can't be more than $1,000,000.00.",
  propertyChange: "To move a transaction to another property, delete it and add it again.",
  billed: "This transaction is on a final statement and can't be changed. Add a correction in a later month instead.",
  notManual: "Only transactions entered by hand can be changed here.",
  voided: "This transaction was deleted.",
  voidReasonMissing: "Enter why you're deleting this transaction.",
  voidReasonLong: "Keep the reason under 300 characters.",
} as const;

export const MAX_COUNTERPARTY = 120;
export const MAX_MEMO = 300;

export type EntryFieldsRaw = {
  propertyId?: string | null;
  unitId?: string | null; // "" / null / undefined = Property level
  date?: string | null;
  accountId?: string | null;
  counterparty?: string | null;
  memo?: string | null;
  /** Typed text on the client ("1,250.00"), integer cents on the server. */
  amount?: string | number | null;
  /** Business date today (YYYY-MM-DD). */
  today: string;
  /** The resolved property for propertyId; null = not found (treated as not chosen). */
  property: { name: string } | null;
  /**
   * The resolved account for accountId; null = not found (treated as not chosen). systemKey
   * "rent_income" is refused: rent is recorded on the Payments page.
   */
  account: { name: string; active: boolean; systemKey?: string | null } | null;
  /** Whether unitId belongs to the property. Ignored when unitId is blank. */
  unitInProperty: boolean;
};

export type EntryFields = {
  propertyId: string;
  unitId: string | null;
  date: string;
  accountId: string;
  counterparty: string;
  memo: string;
  amountCents: number;
};

function entryChecks(i: EntryFieldsRaw): Check[] {
  return [
    {
      field: "propertyId",
      run: () => (blank(i.propertyId) || !i.property ? ENTRY_MSG.propertyMissing : null),
    },
    {
      field: "unitId",
      run: () =>
        blank(i.unitId) || i.unitInProperty || !i.property ? null : ENTRY_MSG.unitNotInProperty(i.property.name),
    },
    {
      field: "date",
      run: () => {
        if (blank(i.date)) return ENTRY_MSG.dateMissing;
        const d = trimmed(i.date);
        if (!isIsoDate(d)) return ENTRY_MSG.dateInvalid;
        if (d > i.today) return ENTRY_MSG.dateFuture;
        return null;
      },
    },
    {
      field: "accountId",
      run: () => {
        if (blank(i.accountId) || !i.account) return ENTRY_MSG.accountMissing;
        if (i.account.systemKey === "rent_income") return ENTRY_MSG.rentOnPaymentsPage;
        if (!i.account.active) return ENTRY_MSG.accountOff(i.account.name);
        return null;
      },
    },
    {
      field: "counterparty",
      run: () => {
        const s = trimmed(i.counterparty);
        if (s === "") return ENTRY_MSG.counterpartyMissing;
        if (s.length > MAX_COUNTERPARTY) return ENTRY_MSG.counterpartyLong;
        return null;
      },
    },
    {
      field: "memo",
      run: () => {
        const s = trimmed(i.memo);
        if (s === "") return ENTRY_MSG.memoMissing;
        if (s.length > MAX_MEMO) return ENTRY_MSG.memoLong;
        return null;
      },
    },
    {
      field: "amountCents",
      run: () => {
        const m = readMoney(i.amount);
        if (m === "missing") return ENTRY_MSG.amountMissing;
        if (m === "invalid") return ENTRY_MSG.amountInvalid;
        if (m <= 0) return ENTRY_MSG.amountNotPositive;
        if (m > MAX_AMOUNT_CENTS) return ENTRY_MSG.amountTooBig;
        return null;
      },
    },
  ];
}

/** First failing field in form order, or the cleaned value. */
export function validateEntryFields(input: EntryFieldsRaw): FieldResult<EntryFields> {
  const bad = firstFailure(entryChecks(input));
  if (bad) return { ok: false, ...bad };
  return {
    ok: true,
    value: {
      propertyId: trimmed(input.propertyId),
      unitId: blank(input.unitId) ? null : trimmed(input.unitId),
      date: trimmed(input.date),
      accountId: trimmed(input.accountId),
      counterparty: trimmed(input.counterparty),
      memo: trimmed(input.memo),
      amountCents: readMoney(input.amount) as number,
    },
  };
}

/** Every failing field (field -> message), for marking all bad fields at once. */
export function validateEntryFieldsAll(input: EntryFieldsRaw): Record<string, string> {
  return allFailures(entryChecks(input));
}

// Roster-rent prefill (until Stripe) ---------------------------------------------------------------
//
// Every draft gets one Rent Income line per occupied unit from the roster rent (units.rent, in
// DOLLARS). The accountant edits / removes ("didn't pay") / adds rows, then confirms the rent lines
// once (RENT_NOT_CHECKED blocks finalize until she does).

export const ROSTER_RENT_MEMO = "Payment";
export const ROSTER_RENT_LABEL = "Roster rent";

/**
 * Roster rent (dollars, a JS number) to integer cents WITHOUT float drift, or null when it isn't a
 * clean dollar amount: not a finite number, <= 0, more than 2 decimals, or over MAX_AMOUNT_CENTS.
 * The decimal text of the number must be plain digits with at most 2 decimals (so 1e-3, 1e21 and
 * 950.875 are refused), and the rounded cents must give back exactly the same number.
 */
export function rosterRentToCents(rent: unknown): number | null {
  if (typeof rent !== "number" || !Number.isFinite(rent) || rent <= 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(String(rent))) return null;
  const cents = Math.round(Number(rent) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  if (cents / 100 !== rent) return null;
  return cents;
}

export type RentSkipCode =
  | "owner_direct"
  | "included_in_other_unit"
  | "already_recorded"
  | "roster_vacant"
  | "vacant"
  | "no_rent"
  | "invalid_rent";

/** Why a unit got no roster-rent line (shown as "Unit 2B — {reason}" in the "Not prefilled" card). */
export const RENT_SKIP_TEXT = {
  owner_direct: "owner collects rent directly",
  included_in_other_unit: "rent is included in another unit",
  already_recorded: (month: string): string => `rent is already recorded for ${formatMonth(month)}`,
  roster_vacant: "unit is marked vacant on the roster",
  vacant: "no active tenant",
  no_rent: "no rent on the roster",
  invalid_rent: "the roster rent isn't a valid dollar amount",
} as const;

export type RentUnitInput = {
  rent?: number | null;
  rentPaidTo?: string | null;
  /** Active residents' full names. */
  tenants: string[];
  /** A non-voided Rent Income ledger row for this unit is dated inside the period. */
  alreadyRecorded: boolean;
  /** units.occupancy from the roster ("vacant" / "vacant_not_ready" = vacant). */
  occupancy?: string | null;
  /** units.leaseType from the roster ("vacant" = vacant). */
  leaseType?: string | null;
};

/** The roster says the unit is vacant (occupancy Vacant / Vacant – not rent ready, or lease type Vacant). */
export function rosterSaysVacant(u: { occupancy?: string | null; leaseType?: string | null }): boolean {
  return u.occupancy === "vacant" || u.occupancy === "vacant_not_ready" || u.leaseType === "vacant";
}

/**
 * The prefill decision for one unit, rules in this order: rent paid to the owner directly /
 * included in another unit, already recorded in the ledger, marked vacant on the roster (even when
 * an active resident is still on file), no active tenant, no rent, invalid rent.
 */
export function rentPrefillDecision(u: RentUnitInput): { ok: true; amountCents: number; counterparty: string } | { ok: false; code: RentSkipCode } {
  if (u.rentPaidTo === "owner_direct") return { ok: false, code: "owner_direct" };
  if (u.rentPaidTo === "included_in_other_unit") return { ok: false, code: "included_in_other_unit" };
  if (u.alreadyRecorded) return { ok: false, code: "already_recorded" };
  if (rosterSaysVacant(u)) return { ok: false, code: "roster_vacant" };
  const names = u.tenants.map((n) => n.trim()).filter((n) => n !== "");
  if (names.length === 0) return { ok: false, code: "vacant" };
  if (u.rent === undefined || u.rent === null) return { ok: false, code: "no_rent" };
  const cents = rosterRentToCents(u.rent);
  if (cents === null) return { ok: false, code: "invalid_rent" };
  return { ok: true, amountCents: cents, counterparty: rentCounterparty(names) };
}

/** Several tenants: natural order, joined with " & " ("Ann Lee & Bob Ray"). */
export function rentCounterparty(names: string[]): string {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))].sort(naturalCompare).join(" & ");
}

export const RENT_MSG = {
  NOT_CHECKED: (month: string): string => `Check the rent lines for ${formatMonth(month)} and confirm them before finalizing.`,
  INVALID: (unit: string, property: string): string =>
    `Unit ${unit} (${property}) has a roster rent that isn't a valid dollar amount, so no rent line was added. Fix the rent on the unit, or add the payment with “Add transaction”.`,
  ACCOUNT_MISSING: "The Rent Income account is missing, so rent wasn't prefilled from the roster. Open Accounts once to create it.",
  lineNotOnStatement: "That rent line isn't on this statement.",
  amountMissing: "Enter the rent amount.",
  amountInvalid: "Enter the amount like 1,250.00.",
  amountNotPositive: "The amount must be more than $0.00. If the tenant didn't pay, remove the line instead.",
  amountTooBig: "The amount can't be more than $1,000,000.00.",
  dateMissing: "Enter the payment date.",
  dateInvalid: "Enter a real date.",
  dateOutside: (month: string): string => `The payment date must be in ${formatMonth(month)}.`,
  dateFuture: "The date can't be in the future.",
  counterpartyMissing: "Enter the tenant name that prints on the statement.",
  counterpartyLong: "Keep the name under 120 characters.",
  memoMissing: "Enter a memo (it prints on the statement).",
  memoLong: "Keep the memo under 300 characters.",
  confirmMissing: "Tick the box to confirm the rent lines.",
  noRentLines: "This statement has no roster rent lines to confirm.",
  changed: "The rent lines changed while you were reviewing them. Check them again, then confirm.",
  REMOVED_NOTE: "Removed: the tenant didn't pay this month. Put it back if the payment came in.",
} as const;

export type RentLineFieldsRaw = {
  /** Typed text on the client ("1,250.00"), integer cents on the server. */
  amount?: string | number | null;
  date?: string | null;
  counterparty?: string | null;
  memo?: string | null;
  /** The statement month "YYYY-MM"; the date must be inside it. */
  month: string;
  periodStart: string;
  periodEnd: string;
  /** Business date today (YYYY-MM-DD). */
  today: string;
};

export type RentLineFields = { amountCents: number; date: string; counterparty: string; memo: string };

function rentLineChecks(i: RentLineFieldsRaw): Check[] {
  return [
    {
      field: "amountCents",
      run: () => {
        const m = readMoney(i.amount);
        if (m === "missing") return RENT_MSG.amountMissing;
        if (m === "invalid") return RENT_MSG.amountInvalid;
        if (m <= 0) return RENT_MSG.amountNotPositive;
        if (m > MAX_AMOUNT_CENTS) return RENT_MSG.amountTooBig;
        return null;
      },
    },
    {
      field: "date",
      run: () => {
        if (blank(i.date)) return RENT_MSG.dateMissing;
        const d = trimmed(i.date);
        if (!isIsoDate(d)) return RENT_MSG.dateInvalid;
        if (d < i.periodStart || d > i.periodEnd) return RENT_MSG.dateOutside(i.month);
        if (d > i.today) return RENT_MSG.dateFuture;
        return null;
      },
    },
    {
      field: "counterparty",
      run: () => {
        const s = trimmed(i.counterparty);
        if (s === "") return RENT_MSG.counterpartyMissing;
        if (s.length > MAX_COUNTERPARTY) return RENT_MSG.counterpartyLong;
        return null;
      },
    },
    {
      field: "memo",
      run: () => {
        const s = trimmed(i.memo);
        if (s === "") return RENT_MSG.memoMissing;
        if (s.length > MAX_MEMO) return RENT_MSG.memoLong;
        return null;
      },
    },
  ];
}

/** First failing field (amount, date, name, memo), or the cleaned values. */
export function validateRentLineFields(input: RentLineFieldsRaw): FieldResult<RentLineFields> {
  const bad = firstFailure(rentLineChecks(input));
  if (bad) return { ok: false, ...bad };
  return {
    ok: true,
    value: {
      amountCents: readMoney(input.amount) as number,
      date: trimmed(input.date),
      counterparty: trimmed(input.counterparty),
      memo: trimmed(input.memo),
    },
  };
}

/** Every failing field (field -> message), for marking all bad fields at once. */
export function validateRentLineFieldsAll(input: RentLineFieldsRaw): Record<string, string> {
  return allFailures(rentLineChecks(input));
}

// Work-order billing, spec 5.6 --------------------------------------------------------------------

export const BILLING_MSG = {
  descriptionMissing: "Describe the work completed (it prints on the owner statement).",
  descriptionLong: "Keep the description under 2,000 characters.",
  billMissing: "Enter the bill amount (what the owner is charged), or tick “No charge to owner”.",
  billInvalid: "Enter the bill amount like 395.00.",
  billNotPositive: "The bill amount must be more than $0.00. Tick “No charge to owner” instead.",
  billTooBig: "The bill amount can't be more than $1,000,000.00.",
  costInvalid: "Enter the cost like 245.00, or leave it blank.",
  accountMissing: "Select the account for this work order (usually Repairs).",
  accountOff: (name: string): string => `The account “${name}” is turned off. Pick another account.`,
  accountNotExpense: "Pick an expense account for a work order.",
} as const;

export const MAX_WORK_DESCRIPTION = 2000;

export type BillingFieldsRaw = {
  workCompletedDescription?: string | null;
  noOwnerCharge?: boolean | null;
  /** Typed text on the client ("395.00"), integer cents on the server. */
  billAmount?: string | number | null;
  /** Optional. Typed text or integer cents. */
  cost?: string | number | null;
  rosAccountId?: string | null;
  billPropertyLevel?: boolean | null;
  /** The resolved account for rosAccountId; null = not found (treated as not chosen). */
  account: { name: string; active: boolean; kind: RowType } | null;
};

export type BillingFields = {
  workCompletedDescription: string;
  noOwnerCharge: boolean;
  /** null when noOwnerCharge (the amount is not used). */
  billAmountCents: number | null;
  /** null = not given. */
  costCents: number | null;
  /** null when noOwnerCharge (the account is not used). */
  rosAccountId: string | null;
  billPropertyLevel: boolean;
};

function billingChecks(i: BillingFieldsRaw): Check[] {
  const noCharge = i.noOwnerCharge === true;
  return [
    {
      field: "workCompletedDescription",
      run: () => {
        const s = trimmed(i.workCompletedDescription);
        if (s === "") return BILLING_MSG.descriptionMissing;
        if (s.length > MAX_WORK_DESCRIPTION) return BILLING_MSG.descriptionLong;
        return null;
      },
    },
    {
      field: "billAmountCents",
      run: () => {
        if (noCharge) return null;
        const m = readMoney(i.billAmount);
        if (m === "missing") return BILLING_MSG.billMissing;
        if (m === "invalid") return BILLING_MSG.billInvalid;
        if (m <= 0) return BILLING_MSG.billNotPositive;
        if (m > MAX_AMOUNT_CENTS) return BILLING_MSG.billTooBig;
        return null;
      },
    },
    {
      field: "costCents",
      run: () => {
        const m = readMoney(i.cost);
        if (m === "missing") return null;
        if (m === "invalid" || m < 0 || m > MAX_AMOUNT_CENTS) return BILLING_MSG.costInvalid;
        return null;
      },
    },
    {
      field: "rosAccountId",
      run: () => {
        if (noCharge) return null;
        if (blank(i.rosAccountId) || !i.account) return BILLING_MSG.accountMissing;
        if (!i.account.active) return BILLING_MSG.accountOff(i.account.name);
        if (i.account.kind !== "expense") return BILLING_MSG.accountNotExpense;
        return null;
      },
    },
  ];
}

/** First failing field in form order, or the cleaned value. */
export function validateBillingFields(input: BillingFieldsRaw): FieldResult<BillingFields> {
  const bad = firstFailure(billingChecks(input));
  if (bad) return { ok: false, ...bad };
  const noOwnerCharge = input.noOwnerCharge === true;
  const cost = readMoney(input.cost);
  return {
    ok: true,
    value: {
      workCompletedDescription: trimmed(input.workCompletedDescription),
      noOwnerCharge,
      billAmountCents: noOwnerCharge ? null : (readMoney(input.billAmount) as number),
      costCents: cost === "missing" ? null : (cost as number),
      rosAccountId: noOwnerCharge ? null : trimmed(input.rosAccountId),
      billPropertyLevel: input.billPropertyLevel === true,
    },
  };
}

/** Every failing field (field -> message). */
export function validateBillingFieldsAll(input: BillingFieldsRaw): Record<string, string> {
  return allFailures(billingChecks(input));
}

// Owner, spec 5.2 ----------------------------------------------------------------------------------

export const OWNER_MSG = {
  legalNameMissing: "Enter the owner's legal name (the LLC or person the statement is for).",
  legalNameLong: "Keep the legal name under 160 characters.",
  legalNameTaken: (name: string): string => `An owner named “${name}” already exists.`,
  contactLong: "Keep the name under 80 characters.",
  emailInvalid: (raw: string): string => `“${raw}” isn't a valid email address.`,
  emailsTooMany: "Add at most 5 email addresses.",
  payeeLong: "Keep the payee name under 120 characters.",
} as const;

export const MAX_LEGAL_NAME = 160;
export const MAX_CONTACT_NAME = 80;
export const MAX_PAYEE_NAME = 120;
export const MAX_EMAILS = 5;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OwnerFieldsRaw = {
  /**
   * "create": every field is read; a missing legal name is an error.
   * "update": a field that is `undefined` is not being changed and is skipped; "" / null on the
   * legal name is an error, and "" / null on an optional one clears it.
   * The management fee is no longer an owner field (it is per property: readFeeInput).
   */
  mode: "create" | "update";
  legalName?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  /** string[] from the server, or one comma-separated string from the form. */
  emails?: string[] | string | null;
  payeeName?: string | null;
  /** True when another owner in the org already has normalizeNameKey(legalName). */
  nameTaken?: boolean;
};

export type OwnerFields = {
  legalName?: string;
  nameKey?: string;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  emails?: string[];
  payeeName?: string | null;
};

function splitEmails(v: string[] | string | null | undefined): string[] {
  const parts = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [];
  return parts.map((s) => (typeof s === "string" ? s.trim() : "")).filter((s) => s !== "");
}

function ownerChecks(i: OwnerFieldsRaw): Check[] {
  const skip = (v: unknown): boolean => i.mode === "update" && v === undefined;
  return [
    {
      field: "legalName",
      run: () => {
        if (skip(i.legalName)) return null;
        const s = trimmed(i.legalName);
        if (s === "") return OWNER_MSG.legalNameMissing;
        if (s.length > MAX_LEGAL_NAME) return OWNER_MSG.legalNameLong;
        if (i.nameTaken) return OWNER_MSG.legalNameTaken(s);
        return null;
      },
    },
    {
      field: "contactFirstName",
      run: () => (trimmed(i.contactFirstName).length > MAX_CONTACT_NAME ? OWNER_MSG.contactLong : null),
    },
    {
      field: "contactLastName",
      run: () => (trimmed(i.contactLastName).length > MAX_CONTACT_NAME ? OWNER_MSG.contactLong : null),
    },
    {
      field: "emails",
      run: () => {
        const list = splitEmails(i.emails);
        for (const raw of list) if (!EMAIL_RE.test(raw)) return OWNER_MSG.emailInvalid(raw);
        if (new Set(list.map((e) => e.toLowerCase())).size > MAX_EMAILS) return OWNER_MSG.emailsTooMany;
        return null;
      },
    },
    {
      field: "payeeName",
      run: () => (trimmed(i.payeeName).length > MAX_PAYEE_NAME ? OWNER_MSG.payeeLong : null),
    },
  ];
}

/**
 * First failing field in form order, or the cleaned value. In "update" mode fields passed as
 * `undefined` are left out of the value (not changed). Emails are trimmed, lowercased and
 * de-duplicated; blank optional names become null.
 */
export function validateOwnerFields(input: OwnerFieldsRaw): FieldResult<OwnerFields> {
  const bad = firstFailure(ownerChecks(input));
  if (bad) return { ok: false, ...bad };
  const include = (v: unknown): boolean => input.mode === "create" || v !== undefined;
  const optional = (v: string | null | undefined): string | null => (trimmed(v) === "" ? null : trimmed(v));
  const value: OwnerFields = {};
  if (include(input.legalName)) {
    value.legalName = trimmed(input.legalName);
    value.nameKey = normalizeNameKey(value.legalName);
  }
  if (include(input.contactFirstName)) value.contactFirstName = optional(input.contactFirstName);
  if (include(input.contactLastName)) value.contactLastName = optional(input.contactLastName);
  if (include(input.emails)) value.emails = [...new Set(splitEmails(input.emails).map((e) => e.toLowerCase()))];
  if (include(input.payeeName)) value.payeeName = optional(input.payeeName);
  return { ok: true, value };
}

/** Every failing field (field -> message). */
export function validateOwnerFieldsAll(input: OwnerFieldsRaw): Record<string, string> {
  return allFailures(ownerChecks(input));
}

// Management fee (user decision 2026-11-11) --------------------------------------------------------
//
// One org-wide default (financeSettings.rosDefaultFeeBps, absent = 5.00%) and an optional own fee
// per property (ownerProperties.managementFeeBps). Effective fee = own fee ?? default. Fees are
// integer basis points 0..10000 (500 = 5.00%).

export const DEFAULT_FEE_BPS = 500;

export const FEE_MSG = {
  unparseable: "Enter the management fee as a percentage like 5.00.",
  range: "The management fee must be between 0.00% and 100.00%.",
  defaultMissing: "Enter the new management fee % for all properties (for example 5.00).",
  defaultUnchanged: (pct: string): string => `The default management fee is already ${pct}%. Enter a different fee.`,
  propertyUnchanged: "That is already this property's fee.",
  countsChanged: "The properties changed while you were deciding. Check the numbers and confirm again.",
} as const;

function isBps(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 10000;
}

/**
 * A typed fee ("5", "5.00", "6.25%") from a form, or integer basis points from the server.
 * Blank (undefined / null / "") = no fee given: `{ ok: true, bps: null }` (a property then uses the
 * default; the "change for all" dialog treats it as missing). Text goes through
 * parsePercentToBpsUnbounded so "not a number" and "over 100%" get different messages; at most two
 * decimals.
 */
export function readFeeInput(raw: string | number | null | undefined): { ok: true; bps: number | null } | { ok: false; message: string } {
  if (blank(raw)) return { ok: true, bps: null };
  if (typeof raw === "number") return isBps(raw) ? { ok: true, bps: raw } : { ok: false, message: FEE_MSG.range };
  if (typeof raw !== "string") return { ok: false, message: FEE_MSG.unparseable };
  const bps = parsePercentToBpsUnbounded(raw);
  if (bps === null) return { ok: false, message: FEE_MSG.unparseable };
  return bps <= 10000 ? { ok: true, bps } : { ok: false, message: FEE_MSG.range };
}

/** The org default: a stored valid value, else DEFAULT_FEE_BPS. */
export function orgDefaultFeeBps(stored: number | null | undefined): number {
  return isBps(stored) ? stored : DEFAULT_FEE_BPS;
}

/**
 * The fee a property's statement uses: the link's own fee when it is a valid value, else the org
 * default. `own` says which one it is.
 */
export function effectiveFee(
  linkBps: number | null | undefined,
  defaultBps: number | null | undefined,
): { bps: number; own: boolean } {
  if (isBps(linkBps)) return { bps: linkBps, own: true };
  return { bps: orgDefaultFeeBps(defaultBps), own: false };
}

/** "5.00%" for one fee, "5.00–6.00%" for several, null for none (an owner with no properties). */
export function feeRangeLabel(bpsList: number[]): string | null {
  const ok = bpsList.filter(isBps);
  if (ok.length === 0) return null;
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  return lo === hi ? `${formatBps(lo)}%` : `${formatBps(lo)}–${formatBps(hi)}%`;
}

export type FeeCounts = {
  /** Every property of the org. */
  totalProperties: number;
  /** Owner-property links with their own fee. */
  ownFeeCount: number;
};

/** The confirmation text of "Change fee for all properties" (one wording for the dialog and tests). */
export function defaultFeeConfirmText(oldBps: number, newBps: number, counts: FeeCounts): string {
  const n = counts.totalProperties;
  const m = counts.ownFeeCount;
  const head = `Change the management fee from ${formatBps(oldBps)}% to ${formatBps(newBps)}% for all ${n} ${n === 1 ? "property" : "properties"}?`;
  if (m === 0) return head;
  return `${head} ${m} ${m === 1 ? "property has its" : "properties have their"} own fee and won't change.`;
}

/** The "Also reset those M" checkbox label. */
export function resetOverridesLabel(m: number, newBps: number): string {
  return `Also reset ${m === 1 ? "that 1 property" : `those ${m} properties`} to ${formatBps(newBps)}%`;
}

export const DEFAULT_FEE_DRAFT_NOTE = "Open drafts will recalculate. Final statements are not affected.";

/**
 * Why setDefaultFee must refuse, or null. `expected` is what the person saw when they confirmed;
 * `actual` is the database now (counts and the current default).
 */
export function setDefaultFeeProblem(input: {
  bps: number | null | undefined;
  alsoResetOverrides: boolean;
  currentBps: number;
  actual: FeeCounts;
  expected: (FeeCounts & { currentBps: number }) | null | undefined;
}): { field: "bps" | "expectedCounts"; message: string } | null {
  const { bps, actual, expected } = input;
  if (bps === null || bps === undefined) return { field: "bps", message: FEE_MSG.defaultMissing };
  if (!isBps(bps)) return { field: "bps", message: FEE_MSG.range };
  if (
    !expected ||
    expected.totalProperties !== actual.totalProperties ||
    expected.ownFeeCount !== actual.ownFeeCount ||
    expected.currentBps !== input.currentBps
  ) {
    return { field: "expectedCounts", message: FEE_MSG.countsChanged };
  }
  const resets = input.alsoResetOverrides && actual.ownFeeCount > 0;
  if (bps === input.currentBps && !resets) return { field: "bps", message: FEE_MSG.defaultUnchanged(formatBps(bps)) };
  return null;
}

// Ledger account (Accounts page "Add account" / rename), spec 5.1 --------------------------------

export const ACCOUNT_MSG = {
  nameMissing: "Enter the account name.",
  nameLong: "Keep the account name under 60 characters.",
  nameTaken: (name: string): string => `An account named “${name}” already exists.`,
  kindMissing: "Select the account type.",
  secondOwnerDraw: "Owner Draw is the only owner-draw account. Pick another type.",
} as const;

export const MAX_ACCOUNT_NAME = 60;

export type AccountFieldsRaw = {
  name?: string | null;
  kind?: string | null;
  /** True when another account in the org already has normalizeNameKey(name). */
  nameTaken?: boolean;
  /** "rename" skips the kind (it is immutable after create). */
  mode: "create" | "rename";
};

export type AccountFields = { name: string; nameKey: string; kind?: RowType };

function accountChecks(i: AccountFieldsRaw): Check[] {
  return [
    {
      field: "name",
      run: () => {
        const s = trimmed(i.name);
        if (s === "") return ACCOUNT_MSG.nameMissing;
        if (s.length > MAX_ACCOUNT_NAME) return ACCOUNT_MSG.nameLong;
        if (i.nameTaken) return ACCOUNT_MSG.nameTaken(s);
        return null;
      },
    },
    {
      field: "kind",
      run: () => {
        if (i.mode === "rename") return null;
        if (!isRowType(i.kind)) return ACCOUNT_MSG.kindMissing;
        if (i.kind === "owner_draw") return ACCOUNT_MSG.secondOwnerDraw;
        return null;
      },
    },
  ];
}

/** First failing field in form order, or the cleaned value. */
export function validateAccountFields(input: AccountFieldsRaw): FieldResult<AccountFields> {
  const bad = firstFailure(accountChecks(input));
  if (bad) return { ok: false, ...bad };
  const name = trimmed(input.name);
  const value: AccountFields = { name, nameKey: normalizeNameKey(name) };
  if (input.mode === "create") value.kind = input.kind as RowType;
  return { ok: true, value };
}

/** Every failing field (field -> message). */
export function validateAccountFieldsAll(input: AccountFieldsRaw): Record<string, string> {
  return allFailures(accountChecks(input));
}
