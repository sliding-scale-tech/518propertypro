/**
 * Rent payments (Payments page): rules as pure functions. convex/rentPayments.ts (server), the
 * statement builder (rosBuild.ts, the "no rent marked received" info warning) and the Payments page
 * (client validation) all use these, so the messages match everywhere. Spec:
 * docs/specs/ros-build-spec.md section 5.9.
 *
 * Decisions (user, 2026-11-12):
 * - Cash basis like Buildium: a payment is a Rent Income ledger row dated the day it was RECEIVED,
 *   so it lands on that month's statement, whatever month the rent is for (`rentForMonth`).
 * - No partial payments: one payment per unit per rent month, always the full roster rent.
 * - Units whose rent the owner collects directly (or that is included in another unit) can't be
 *   marked; vacant units and units with no / an invalid roster rent can't either.
 * - A payment can be changed or undone until the statement covering its received date is final.
 *
 * Pure: no Convex imports, erasable TypeScript only (Node's test runner loads it).
 */

import { formatDate, formatMonth, isIsoDate, isMonth, monthOf, monthStart, nextMonth, prevMonth } from "./rosFormat";
import { RENT_SKIP_TEXT, rentCounterparty, rosterRentToCents, rosterSaysVacant, type FieldResult } from "./rosPolicy";

// --- constants -----------------------------------------------------------------------------------

export type PaymentMethod = "cash" | "check" | "money_order" | "other";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "check", "money_order", "other"];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: "Cash",
  check: "Check",
  money_order: "Money order",
  other: "Other",
};

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Memo of every rent payment row (it prints on the statement). */
export const RENT_PAYMENT_MEMO = "Payment";
export const MAX_PAYMENT_NOTE = 200;
export const MAX_UNDO_REASON = 300;
/** "Mark selected received": at most this many units per call (all or nothing). */
export const MAX_BULK_MARK = 100;
/** A payment can be received up to this many months before the rent month starts (early payers). */
export const RECEIVED_WINDOW_MONTHS = 2;

export type Team = "gold" | "silver" | "make_up";
export const TEAM_LABELS: Readonly<Record<Team, string>> = { gold: "Gold", silver: "Silver", make_up: "Make Up" };
const TEAM_ORDER: Readonly<Record<Team, number>> = { gold: 0, silver: 1, make_up: 2 };

export function teamRank(t: string | null | undefined): number {
  return t === "gold" || t === "silver" || t === "make_up" ? TEAM_ORDER[t] : 3;
}

export function teamLabel(t: string | null | undefined): string {
  return t === "gold" || t === "silver" || t === "make_up" ? TEAM_LABELS[t] : "No team";
}

// --- messages (exact wording, server and client) ---------------------------------------------------

/** "Unit 2B at 108 Jackson Avenue". */
export function unitAt(unit: string, property: string): string {
  return `Unit ${unit} at ${property}`;
}

export const RENT_PAY_MSG = {
  monthMissing: "Select the rent month.",
  monthInvalid: "Select a real month (like October 2026).",
  monthTooFar: (month: string): string => `You can't mark rent for ${formatMonth(month)} yet.`,
  unitMissing: "Select the unit to mark rent for.",
  unitNotFound: "Unit not found.",
  dateMissing: "Enter the date the rent was received.",
  dateInvalid: "Enter a real date.",
  dateFuture: "The received date can't be in the future.",
  dateTooEarly: (month: string, earliest: string): string =>
    `For ${formatMonth(month)} rent, the received date must be on or after ${formatDate(earliest)}.`,
  dateLocked: (property: string, lockedThrough: string): string =>
    `${formatMonth(lockedThrough)} is final for ${property}. Use a received date in ${formatMonth(nextMonth(lockedThrough))} or later.`,
  dateBeforeStart: (property: string, startMonth: string): string =>
    `Statements for ${property} start in ${formatMonth(startMonth)}. Use a received date on or after ${formatDate(monthStart(startMonth))}.`,
  methodMissing: "Select how the rent was paid.",
  noteLong: "Keep the note under 200 characters.",
  noOwner: (property: string): string => `${property} has no owner yet. Link it on the Owners page first.`,
  notMarkable: (unitLabel: string, reason: string): string => `Rent can't be marked for ${unitLabel}: ${reason}.`,
  alreadyPaid: (unitLabel: string, month: string): string =>
    `${unitLabel} already has rent marked received for ${formatMonth(month)}.`,
  alreadyInLedger: (unitLabel: string, month: string): string =>
    `${unitLabel} already has rent recorded in the ledger for ${formatMonth(month)}. Check it on the Ledger page.`,
  noneSelected: "Select at least one unit to mark received.",
  tooMany: "Select at most 100 units at a time.",
  bulkFailed: (failed: number, details: string): string =>
    `Nothing was saved: ${failed} of the selected ${failed === 1 ? "unit" : "units"} can't be marked received. ${details}`,
  entryNotFound: "Payment not found.",
  notAPayment: "That transaction isn't a rent payment from the Payments page.",
  voided: "This payment was already undone.",
  billed: "This payment is on a final statement and can't be changed. Put a correction on a later statement.",
  lockedMonth: (property: string, lockedThrough: string): string =>
    `${formatMonth(lockedThrough)} is final for ${property}, so this payment can't be changed.`,
  undoReasonMissing: "Enter why you're undoing this payment.",
  undoReasonLong: "Keep the reason under 300 characters.",
  /** setRentLine / confirmRent (the old roster-rent prefill) now refuse with this. */
  onPaymentsPage: "Rent is recorded on the Payments page.",
  /** A statement line from the Payments page can't be left off: undo the payment instead. */
  leaveOffRefused: "Rent is recorded on the Payments page. To take this payment off the statement, undo it there.",
  /** Draft info warning RENT_UNPAID. */
  UNPAID: (count: number, month: string): string =>
    `${count} ${count === 1 ? "unit has" : "units have"} no rent marked received for ${formatMonth(month)}.`,
  /** Lock reasons shown on the Payments page. */
  lockedLegacy: "Entered in the ledger. Change it on the Ledger page.",
  lockedBilled: (statementMonth: string | null): string =>
    statementMonth ? `On the ${formatMonth(statementMonth)} final statement.` : "On a final statement.",
  lockedMonthShort: (property: string, lockedThrough: string): string => `${formatMonth(lockedThrough)} is final for ${property}.`,
} as const;

// --- which units can be marked ---------------------------------------------------------------------

export type NotMarkableCode = "owner_direct" | "included_in_other_unit" | "roster_vacant" | "vacant" | "no_rent" | "invalid_rent";

/** The reason a unit's row is greyed out (Payments page). */
export const NOT_MARKABLE_REASON: Readonly<Record<NotMarkableCode, string>> = {
  owner_direct: "Owner collects rent directly",
  included_in_other_unit: "Rent is included in another unit",
  roster_vacant: "Vacant on the roster",
  vacant: "Vacant (no active tenant)",
  no_rent: "No rent on the roster",
  invalid_rent: "Roster rent isn't a valid dollar amount",
};

export type MarkUnitInput = {
  /** units.rent, DOLLARS. */
  rent?: number | null;
  rentPaidTo?: string | null;
  occupancy?: string | null;
  leaseType?: string | null;
};

export type Markability =
  | { markable: true; amountCents: number; counterparty: string }
  | { markable: false; code: NotMarkableCode; reason: string; sentence: string };

/**
 * Can rent be marked received for this unit, and for how much? Rules in this order: rent paid to
 * the owner directly / included in another unit, vacant on the roster (even with an active resident
 * on file), no active tenant, no rent, invalid rent. The amount is ALWAYS the roster rent in integer
 * cents (rosterRentToCents: no float drift), never a typed amount.
 */
export function rentMarkability(u: MarkUnitInput, tenants: string[]): Markability {
  const no = (code: NotMarkableCode): Markability => ({
    markable: false,
    code,
    reason: NOT_MARKABLE_REASON[code],
    sentence: RENT_SKIP_TEXT[code],
  });
  if (u.rentPaidTo === "owner_direct") return no("owner_direct");
  if (u.rentPaidTo === "included_in_other_unit") return no("included_in_other_unit");
  if (rosterSaysVacant(u)) return no("roster_vacant");
  const names = tenants.map((n) => n.trim()).filter((n) => n !== "");
  if (names.length === 0) return no("vacant");
  if (u.rent === undefined || u.rent === null) return no("no_rent");
  const cents = rosterRentToCents(u.rent);
  if (cents === null) return no("invalid_rent");
  return { markable: true, amountCents: cents, counterparty: rentCounterparty(names) };
}

// --- months and dates ------------------------------------------------------------------------------

/** The latest rent month that can be marked: next month (rent paid early). */
export function latestRentMonth(today: string): string {
  return nextMonth(monthOf(today));
}

/** The earliest received date for a rent month: the 1st of the month two months before it. */
export function earliestReceivedDate(month: string): string {
  let m = month;
  for (let i = 0; i < RECEIVED_WINDOW_MONTHS; i++) m = prevMonth(m);
  return monthStart(m);
}

/** null = OK. The rent month: given, a real month, not after next month. */
export function rentMonthProblem(raw: string | null | undefined, today: string): string | null {
  const m = typeof raw === "string" ? raw.trim() : "";
  if (m === "") return RENT_PAY_MSG.monthMissing;
  if (!isMonth(m)) return RENT_PAY_MSG.monthInvalid;
  if (m > latestRentMonth(today)) return RENT_PAY_MSG.monthTooFar(m);
  return null;
}

/**
 * null = OK. The received date on its own (no property rules): given, real, not in the future, and
 * from `earliestReceivedDate(month)` on. `month` must already be a valid month.
 */
export function receivedDateProblem(raw: string | null | undefined, month: string, today: string): string | null {
  const d = typeof raw === "string" ? raw.trim() : "";
  if (d === "") return RENT_PAY_MSG.dateMissing;
  if (!isIsoDate(d)) return RENT_PAY_MSG.dateInvalid;
  if (d > today) return RENT_PAY_MSG.dateFuture;
  const earliest = earliestReceivedDate(month);
  if (d < earliest) return RENT_PAY_MSG.dateTooEarly(month, earliest);
  return null;
}

/**
 * null = OK. The property's locks on a received date: a month that is final for the property (the
 * existing locked-month rule), or a date before the owner's first statement month.
 */
export function receivedDateLockProblem(
  date: string,
  p: { name: string; lockedThrough: string | null; startMonth: string | null },
): string | null {
  if (p.lockedThrough !== null && monthOf(date) <= p.lockedThrough) return RENT_PAY_MSG.dateLocked(p.name, p.lockedThrough);
  if (p.startMonth && date < monthStart(p.startMonth)) return RENT_PAY_MSG.dateBeforeStart(p.name, p.startMonth);
  return null;
}

// --- the form fields -------------------------------------------------------------------------------

export type PaymentFieldsRaw = {
  /** The rent month "YYYY-MM". */
  month?: string | null;
  receivedDate?: string | null;
  method?: string | null;
  note?: string | null;
  /** Business date today (YYYY-MM-DD). */
  today: string;
};

export type PaymentFields = { month: string; receivedDate: string; method: PaymentMethod; note: string | null };

type Check = { field: string; run: () => string | null };

function checks(i: PaymentFieldsRaw): Check[] {
  return [
    { field: "month", run: () => rentMonthProblem(i.month, i.today) },
    {
      field: "receivedDate",
      run: () => (rentMonthProblem(i.month, i.today) === null ? receivedDateProblem(i.receivedDate, (i.month as string).trim(), i.today) : null),
    },
    { field: "method", run: () => (isPaymentMethod(typeof i.method === "string" ? i.method.trim() : i.method) ? null : RENT_PAY_MSG.methodMissing) },
    {
      field: "note",
      run: () => (typeof i.note === "string" && i.note.trim().length > MAX_PAYMENT_NOTE ? RENT_PAY_MSG.noteLong : null),
    },
  ];
}

/** First failing field (month, receivedDate, method, note), or the cleaned values. */
export function validatePaymentFields(input: PaymentFieldsRaw): FieldResult<PaymentFields> {
  for (const c of checks(input)) {
    const m = c.run();
    if (m !== null) return { ok: false, field: c.field, message: m };
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  return {
    ok: true,
    value: {
      month: (input.month as string).trim(),
      receivedDate: (input.receivedDate as string).trim(),
      method: (input.method as string).trim() as PaymentMethod,
      note: note === "" ? null : note,
    },
  };
}

/** Every failing field (field -> message), for marking all bad fields at once. */
export function validatePaymentFieldsAll(input: PaymentFieldsRaw): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of checks(input)) {
    const m = c.run();
    if (m !== null) out[c.field] = m;
  }
  return out;
}

// --- what is recorded for a unit and month ---------------------------------------------------------

/** A ledger row as far as rent status needs it (Convex Docs are assignable). */
export type RentRecord = {
  _id: string;
  unitId?: string;
  date: string;
  accountId: string;
  source: string;
  amountCents: number;
  rentForMonth?: string;
  voided?: boolean;
};

/**
 * What is recorded for a unit's rent month:
 * - `payment`: the non-voided rent_payment with rentForMonth = month (at most one; the first if the
 *   data were ever doubled);
 * - `ledger`: non-voided rows on a Rent Income account entered any other way (by hand in the ledger
 *   before the Payments page, old roster rent, Stripe later) DATED inside the month.
 */
export function rentRecordsFor(
  unitId: string,
  month: string,
  records: readonly RentRecord[],
  rentAccountIds: ReadonlySet<string>,
): { payment: RentRecord | null; ledger: RentRecord[] } {
  let payment: RentRecord | null = null;
  const ledger: RentRecord[] = [];
  for (const r of records) {
    if (r.voided === true || r.unitId !== unitId) continue;
    if (r.source === "rent_payment") {
      if (r.rentForMonth === month && payment === null) payment = r;
      continue;
    }
    if (rentAccountIds.has(r.accountId) && monthOf(r.date) === month) ledger.push(r);
  }
  return { payment, ledger };
}

export type PaymentStatus = "paid" | "unpaid" | "not_markable";

/** Paid wins (a payment stays visible even if the roster changed since); else markable -> unpaid. */
export function paymentStatus(markable: boolean, rec: { payment: RentRecord | null; ledger: RentRecord[] }): PaymentStatus {
  if (rec.payment !== null || rec.ledger.length > 0) return "paid";
  return markable ? "unpaid" : "not_markable";
}

/**
 * Is a rent_payment row locked? Billed on a final statement, or dated in a month that is final for
 * the property (lockedThrough). null reason = editable.
 */
export function paymentLock(
  e: { statementId?: string | null; date: string },
  p: { name: string; lockedThrough: string | null; statementMonth?: string | null },
): { locked: boolean; reason: string | null; message: string | null } {
  if (e.statementId) {
    return { locked: true, reason: RENT_PAY_MSG.lockedBilled(p.statementMonth ?? null), message: RENT_PAY_MSG.billed };
  }
  if (p.lockedThrough !== null && monthOf(e.date) <= p.lockedThrough) {
    return {
      locked: true,
      reason: RENT_PAY_MSG.lockedMonthShort(p.name, p.lockedThrough),
      message: RENT_PAY_MSG.lockedMonth(p.name, p.lockedThrough),
    };
  }
  return { locked: false, reason: null, message: null };
}

/**
 * The rent months a draft checks for units with no rent marked received (info warning RENT_UNPAID):
 * the statement month and up to RECEIVED_WINDOW_MONTHS before it, never before the property's first
 * statement month (`startMonth`, or the statement month itself when it isn't set yet). Oldest first.
 */
export function unpaidCheckMonths(statementMonth: string, startMonth: string | null | undefined): string[] {
  const floor = startMonth && startMonth <= statementMonth ? startMonth : statementMonth;
  const out: string[] = [];
  let m = statementMonth;
  for (let i = 0; i <= RECEIVED_WINDOW_MONTHS && m >= floor; i++) {
    out.unshift(m);
    m = prevMonth(m);
  }
  return out;
}

/** The Payments page URL, filtered (statement links use it). */
export function paymentsHref(f: { month?: string; ownerId?: string; propertyId?: string; status?: PaymentStatus }): string {
  const q = new URLSearchParams();
  if (f.month) q.set("month", f.month);
  if (f.ownerId) q.set("owner", f.ownerId);
  if (f.propertyId) q.set("property", f.propertyId);
  if (f.status) q.set("status", f.status);
  const s = q.toString();
  return s ? `/owner-statements/payments?${s}` : "/owner-statements/payments";
}
